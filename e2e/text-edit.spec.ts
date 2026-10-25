import { expect, type Locator, type Page, type TestInfo, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type CssBounds,
  type PixelPredicate,
  STROKE_ANALYSIS,
  containFit,
  drawLine,
  getWorkspaceCanvas,
  loadImageData,
  scanPixelsForBounds,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';
import { getUndoButton, getRedoButton } from './helpers/history-helpers';

/**
 * Photoshop's IN-PLACE type editor, and what it claims about the string being typed.
 *
 * **What this file is not.** It is not a second `text-tool.spec.ts`. That file owns the two
 * creation gestures, the style controls and the committed ink, and it is being rewritten against
 * this same overlay work in parallel — this file shares none of its helpers and duplicates none of
 * its assertions. What is here is only what the overlay makes possible and the old textarea could
 * not do: a caret, a selection, a pre-selected placeholder, and the keyboard's own commit keys.
 *
 * **The one thing every test here needs is the DOM.** A `contenteditable` keeps its text in the
 * LIGHT DOM, so `textContent` and `window.getSelection()` both address it. That is the load-bearing
 * reason the editor is a `div[contenteditable]` and not a `<textarea>` — a textarea's value lives in
 * a CLOSED shadow root, so neither a per-character `Range` nor a selection offset is reachable there.
 * Every read below goes through the light DOM for that reason, and the parity test could not be
 * written at all without it.
 */

/**
 * The suite default is 30s. Each test here is a page load, a tool click, one or two gestures and a
 * commit, which measures at 1-2s on this host, so 30s is not the binding constraint. 60s is what
 * the two sibling specs that drive the canvas already ask for, and it leaves room for a dev-server
 * cold start and font rasterisation on CI's runner.
 */
const TEXT_EDIT_TIMEOUT_MS = 60_000;

/** Where the Type tool's control is addressed; see {@link selectTextTool}. */
const TEXT_TOOL_MOUNTED_PROOF = '#font-size-input';

/** The overlay, addressed by the id the component publishes. */
const overlay = (page: Page): Locator => page.locator('#text-edit-overlay');

/**
 * Adobe's placeholder, `PLACEHOLDER_TEXT` in `src/tools/text.ts`. Written out rather than imported
 * because nothing under `e2e/` imports app source — `vitest.e2e.config.ts` records that boundary —
 * and it is the string the whole file is about, so it is worth asserting as a literal rather than
 * agreeing with the app by construction.
 */
const PLACEHOLDER = 'Lorem ipsum';

/** `TEXT_PADDING` from `src/util/constants.ts`, and why it is a copy. See {@link TEXT_PADDING_DOC_PX}. */
const TEXT_PADDING_DOC_PX = 5;

/** Interpolated moves for a drag. `useRect` recomputes the rect on pointer-up. */
const DRAG_STEPS = 10;

/** A dragged draft rectangle in canvas-box coordinates, the space `drawLine`'s arguments are in. */
interface DraftRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A page-CSS region, which is what `page.screenshot`'s clip and `imageBoundsToCss` both take. */
interface PageRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The Type tool is a ONE-tool group in `toolbar-mapping.ts`, so it never publishes a flyout of its
 * own. Whether it has a TILE is a different question, and at this viewport the answer is no: the
 * rail drops whole rows that do not fit, and Type is the fourteenth of fifteen groups while 1280x720
 * fits seven of them, so at this viewport it is reached through the three-dots flyout. The flyout's
 * own `onKeyDown` activates the focused entry with Enter, which holds at any viewport because focus
 * does not require the entry to be on screen.
 *
 * This is a LOCAL copy rather than an import because `e2e/text-tool.spec.ts` owns the original and
 * another agent is rewriting that file right now; sharing a helper across two files another agent
 * is editing is how two specs end up disagreeing about the same setup. The divergence that matters
 * is the mount proof: `#text-input` is gone with the options-bar textarea, so this waits on
 * `#font-size-input`, which is a control `Text.tsx` renders unconditionally while the bar is mounted.
 */
async function selectTextTool(page: Page): Promise<void> {
  const tile = page.getByTestId('tool-button-text');
  if (await tile.count()) {
    await tile.click();
  } else {
    await page.getByTestId('tool-overflow-tile').click({ button: 'right' });
    const menu = page.getByTestId('tool-flyout-overflow');
    await expect(menu).toBeVisible();
    const item = page.getByTestId('tool-flyout-item-text-horizontal-type-tool');
    await expect(item).toBeAttached();
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
  }
  await expect(page.locator(TEXT_TOOL_MOUNTED_PROOF), 'the Text toolbar should be mounted').toBeVisible();
}

/**
 * The contain fit the APP computed, read from the attributes `usePointerPosition` publishes.
 *
 * `FIT_ATTRIBUTES` in `src/hooks/usePointerPosition.ts` writes these on the container from the same
 * values `getLocalCoords` uses, so reading them is how a spec learns the scale the app's own pointer
 * mapping is in without re-deriving `containFit` — a second copy of that rule is exactly the thing
 * that goes stale. `crop-history.spec.ts` reads the same nine attributes; this is a local copy for
 * the same ownership reason as {@link selectTextTool}.
 */
interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
  documentWidth: number;
  documentHeight: number;
}

async function readFit(page: Page): Promise<Fit> {
  const container = page.getByTestId('workspace-container');
  await expect(container, 'the tool area publishes the contain fit').toHaveAttribute('data-fit-scale', /.+/);
  return await container.evaluate((node) => {
    const read = (name: string) => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
    };
  });
}

/** The workspace canvas element's own box, in page CSS. Every gesture below is expressed in it. */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('text-edit: the workspace canvas has no visible coordinates');
  return box;
}

/**
 * A press with no travel, which is what places POINT type.
 *
 * `TextToolArea`'s `onChangeEnd` classifies the gesture by the POINTER's travel in CSS px against
 * `POINT_TYPE_MAX_DRAG_PX`, so `page.mouse.click` — a move, a down and an up at one coordinate — is
 * a click by construction rather than by a threshold this spec has to stay under.
 */
async function clickToPlace(page: Page, box: BoundingBox, at: { x: number; y: number }): Promise<void> {
  await page.mouse.click(box.x + at.x, box.y + at.y);
}

/**
 * A press that travels further than the threshold, which is what places PARAGRAPH type.
 *
 * `drawLine` is the suite's only pointer-drag primitive and `TextToolArea` reads the same
 * down/move/up trio through `useRect`'s handlers, so this is the gesture the tool already sees.
 */
async function dragToPlace(page: Page, box: BoundingBox, rect: DraftRect): Promise<void> {
  await drawLine(page, box, rect.x1, rect.y1, rect.x2, rect.y2, { steps: DRAG_STEPS });
}

/**
 * The overlay's text, read as an EXACT string rather than through `toHaveText`.
 *
 * Playwright's `toHaveText` normalises whitespace, and this file's subject is whitespace: a test
 * that asked `toHaveText('alpha beta')` could not tell a collapsed double space from a single one,
 * which is the exact difference the parity test is about.
 */
async function overlayText(page: Page): Promise<string> {
  return await overlay(page).evaluate((node) => node.textContent ?? '');
}

/** What `window.getSelection()` says, in the terms the assertions need. */
interface SelectionState {
  /** `Selection.toString()` — the SELECTED text, which is `''` for a collapsed selection. */
  string: string;
  collapsed: boolean;
  /** Both ends of the selection are inside the overlay, which is what makes the string about it. */
  inside: boolean;
  /** The caret's index into the overlay's own text, or `null` when there is no selection at all. */
  caretIndex: number | null;
  /** Selection endpoints as UTF-16 offsets, preserving their direction. */
  anchorIndex: number | null;
  focusIndex: number | null;
}

async function selectionState(page: Page): Promise<SelectionState> {
  return await page.evaluate(() => {
    const host = document.querySelector('#text-edit-overlay');
    const selection = window.getSelection();
    if (!host || !selection || selection.rangeCount === 0) {
      return { string: '', collapsed: true, inside: false, caretIndex: null, anchorIndex: null, focusIndex: null };
    }
    const range = selection.getRangeAt(0);
    // The caret index, measured as the length of the text from the host's start to the selection's
    // start — the one number that says WHERE in the overlay's own string the caret is, and reachable
    // only because a `div[contenteditable]` keeps its text in the light DOM. Derived here rather than
    // imported: nothing under `e2e/` imports app source (`vitest.e2e.config.ts` records that
    // boundary), and the helper this comment used to attribute the arithmetic to has since been
    // deleted from the app, so there is no longer anything in the product to point at.
    const before = range.cloneRange();
    before.selectNodeContents(host);
    before.setEnd(range.startContainer, range.startOffset);
    const offsetOf = (node: Node | null, offset: number): number | null => {
      if (!node || (node !== host && !host.contains(node))) return null;
      const endpoint = document.createRange();
      endpoint.selectNodeContents(host);
      endpoint.setEnd(node, offset);
      return endpoint.toString().length;
    };
    return {
      string: selection.toString(),
      collapsed: selection.isCollapsed,
      inside: host.contains(range.startContainer) && host.contains(range.endContainer),
      caretIndex: before.toString().length,
      anchorIndex: offsetOf(selection.anchorNode, selection.anchorOffset),
      focusIndex: offsetOf(selection.focusNode, selection.focusOffset),
    };
  });
}

/** Return a point inside a rendered glyph, not the text box origin or its padding. */
async function overlayPositionForText(
  page: Page,
  target: string,
  characterOffset = Math.floor(target.length / 2)
): Promise<{ x: number; y: number }> {
  return await overlay(page).evaluate(
    (host, { needle, offsetInTarget }) => {
      const text = host.textContent ?? '';
      const start = text.indexOf(needle);
      if (start < 0) throw new Error(`overlayPositionForText: ${needle} is not in the editor`);
      let offset = start + offsetInTarget;
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const length = node.textContent?.length ?? 0;
        if (offset < length) break;
        offset -= length;
        node = walker.nextNode();
      }
      if (!(node instanceof Text)) throw new Error(`overlayPositionForText: no text node contains ${needle}`);

      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const glyph = range.getBoundingClientRect();
      const hostBounds = host.getBoundingClientRect();
      const glyphX = offsetInTarget === 0 ? Math.min(1, glyph.width / 4) : glyph.width / 2;
      return {
        x: glyph.left - hostBounds.left + glyphX,
        y: glyph.top - hostBounds.top + glyph.height / 2,
      };
    },
    { needle: target, offsetInTarget: characterOffset }
  );
}

/** Ask Chromium where the caret would land at an absolute page-CSS point. */
async function browserCaretIndexAtPoint(page: Page, point: { x: number; y: number }): Promise<number | null> {
  return await page.evaluate(({ x, y }) => {
    const host = document.querySelector('#text-edit-overlay');
    const position = document.caretPositionFromPoint(x, y);
    if (!host || !position || !host.contains(position.offsetNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(host);
    range.setEnd(position.offsetNode, position.offset);
    return range.toString().length;
  }, point);
}

/** Read the visual line containing a target glyph and how many lines the paragraph actually uses. */
async function overlayVisualLineAtText(page: Page, target: string): Promise<{ line: string; lineCount: number }> {
  return await overlay(page).evaluate((host, needle) => {
    const text = host.textContent ?? '';
    const start = text.indexOf(needle);
    if (start < 0) throw new Error(`overlayVisualLineAtText: ${needle} is not in the editor`);
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const nodeForOffset = (wanted: number): { node: Text; offset: number } => {
      let offset = wanted;
      let node = walker.nextNode();
      while (node) {
        const length = node.textContent?.length ?? 0;
        if (offset < length && node instanceof Text) return { node, offset };
        offset -= length;
        node = walker.nextNode();
      }
      throw new Error(`overlayVisualLineAtText: no text node contains offset ${wanted}`);
    };
    const targetPosition = nodeForOffset(start + Math.floor(needle.length / 2));
    const targetRange = document.createRange();
    targetRange.setStart(targetPosition.node, targetPosition.offset);
    targetRange.setEnd(targetPosition.node, targetPosition.offset + 1);
    const targetTop = Math.round(targetRange.getBoundingClientRect().top);
    const placed: { index: number; top: number }[] = [];
    const lineTops = new Set<number>();
    const characters = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let absolute = 0;
    let node = characters.nextNode();
    while (node) {
      const length = node.textContent?.length ?? 0;
      if (node instanceof Text) {
        for (let offset = 0; offset < length; offset += 1) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const top = Math.round(rect.top);
          placed.push({ index: absolute + offset, top });
          lineTops.add(top);
        }
      }
      absolute += length;
      node = characters.nextNode();
    }
    const onTargetLine = placed.filter((entry) => entry.top === targetTop).map((entry) => entry.index);
    if (onTargetLine.length === 0) throw new Error(`overlayVisualLineAtText: no characters on ${needle}'s line`);
    const first = Math.min(...onTargetLine);
    const last = Math.max(...onTargetLine);
    return { line: text.slice(first, last + 1).trim(), lineCount: lineTops.size };
  }, target);
}

/** Ensure the actual glyph rects remain inside both their paragraph frame and the document canvas. */
async function overlayTextFitsFrame(page: Page, canvas: BoundingBox): Promise<boolean> {
  return await overlay(page).evaluate((host, canvasBounds) => {
    const frame = host.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(host);
    const glyphs = Array.from(range.getClientRects());
    const tolerance = 1;
    const frameContainsGlyphs = glyphs.every(
      (glyph) =>
        glyph.left >= frame.left - tolerance &&
        glyph.right <= frame.right + tolerance &&
        glyph.top >= frame.top - tolerance &&
        glyph.bottom <= frame.bottom + tolerance
    );
    const canvasContainsFrame =
      frame.left >= canvasBounds.x - tolerance &&
      frame.top >= canvasBounds.y - tolerance &&
      frame.right <= canvasBounds.x + canvasBounds.width + tolerance &&
      frame.bottom <= canvasBounds.y + canvasBounds.height + tolerance;
    return frameContainsGlyphs && canvasContainsFrame;
  }, canvas);
}

/**
 * The colour the Text tool paints with, written through the Text bar's OWN swatch.
 *
 * A local copy of `text-tool.spec.ts`'s `setTextToolColor` rather than an import, for the same
 * ownership reason as {@link selectTextTool}: that file is being rewritten right now. What is
 * load-bearing in the copy is the native value SETTER taken off `HTMLInputElement.prototype` rather
 * than assigned to `input.value` — React installs its own instance-level setter that keeps its value
 * tracker in step, so the assignment would leave `onChange` unfired and the colour would silently
 * stay black, which every red-pixel assertion below would then read as "no ink".
 */
async function setTextToolColor(page: Page, hex: string): Promise<void> {
  await page.evaluate((color) => {
    const input = document.querySelector<HTMLInputElement>('#text-color');
    if (!(input instanceof window.HTMLInputElement)) {
      throw new Error('setTextToolColor: no HTMLInputElement matched #text-color; is the Text toolbar mounted?');
    }
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('Native value setter not found on HTMLInputElement.prototype');
    descriptor.set.call(input, color);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await expect(page.locator('#text-color'), "the Text bar's own swatch did not take the colour under test").toHaveValue(
    hex
  );
}

/** Red, as a predicate over a decoded capture. The constants are the ones `STROKE_ANALYSIS` names. */
const { RED_PIXEL_RED_MIN, RED_PIXEL_GREEN_MAX, RED_PIXEL_BLUE_MAX } = STROKE_ANALYSIS;
const isRedInk: PixelPredicate = (red, green, blue, alpha) =>
  alpha !== 0 && red > RED_PIXEL_RED_MIN && green < RED_PIXEL_GREEN_MAX && blue < RED_PIXEL_BLUE_MAX;

/** Find an actual committed glyph pixel and convert it back to page CSS coordinates. */
async function committedInkPoint(page: Page, box: BoundingBox): Promise<{ x: number; y: number }> {
  const image = await loadImageData(
    await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    })
  );
  let pixelOffset = -1;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (isRedInk(image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3])) {
      pixelOffset = offset;
      break;
    }
  }
  if (pixelOffset < 0) throw new Error('committedInkPoint: no committed red glyph pixel was found');
  const pixelIndex = pixelOffset / 4;
  const pixelX = pixelIndex % image.width;
  const pixelY = Math.floor(pixelIndex / image.width);
  return {
    x: box.x + ((pixelX + 0.5) * box.width) / image.width,
    y: box.y + ((pixelY + 0.5) * box.height) / image.height,
  };
}

/**
 * The draft box's own `#007bff`, as a predicate: the same three constants `getSelectionBounds`
 * reads, so a pixel this matches is the same pixel that helper reports. It cannot be confused with
 * the type's red, because the frame's red channel is 0 against the ink's 180+.
 */
const isDraftFrame: PixelPredicate = (red, green, blue, alpha) =>
  alpha !== 0 &&
  red <= STROKE_ANALYSIS.SELECTION_RED_MAX &&
  green >= STROKE_ANALYSIS.SELECTION_GREEN_MIN &&
  blue >= STROKE_ANALYSIS.SELECTION_BLUE_MIN;

/** The only colour the tool's ink is written in, so one predicate can find it on the canvas. */
const TEXT_COLOR = '#ff0000';

/** `HANDLE_SIZE` from `src/util/constants.ts`; see {@link TEXT_PADDING_DOC_PX} for why it is a copy. */
const HANDLE_SIZE_DOC_PX = 12;

/**
 * How far outside the box the draft frame reaches, in CSS px, on every side.
 *
 * The outline is centred on the box edge, but the corner handles are deliberately drawn OUTSIDE the
 * contenteditable box so their hit area is not covered by the editor. `useRect`'s `drawMask` fills
 * `HANDLE_SIZE / scale` squares from each corner outward, so the handle contributes `HANDLE_SIZE`
 * CSS px on screen whatever the fit is and dominates the one-pixel outline overhang.
 *
 * Used only as a DERIVATION of where the box's own edge is from where the blue stops, never as a
 * tolerance, so it does not widen any margin in this file.
 */
const FRAME_OVERHANG_CSS_PX = HANDLE_SIZE_DOC_PX;

/**
 * How far two independently measured ink widths may differ and still be the same ink, in CSS px.
 *
 * MEASURED, not guessed, and the measurement is one-directional: the committed layer's ink comes
 * back consistently NARROWER than a reference drawn at document size. `'First'` measures 115.0 CSS px
 * on screen against a 117.6 CSS px reference — 2.6 px — and the reference is drawn by this page's own
 * `fillText` at the app's own font size, so the difference is not a different glyph and not a
 * different string: the document canvas is rasterised at document px and then DISPLAYED at the
 * contain fit of 0.97, and the antialiased fringe on each glyph edge falls below the red predicate's
 * thresholds on the way down. It is therefore a bias in one direction, not a spread in both, and 4
 * covers it with 1.4 px of slack.
 *
 * Nothing here leans on the slack to tell two strings apart. The SMALLEST gap between any two
 * references this file compares is 148 CSS px (`Kept` against `Discarded`), and the other is 207 and
 * 234; the tolerance would have to grow by a factor of thirty-seven to let a wrong string through.
 */
const INK_WIDTH_TOLERANCE_CSS_PX = 4;

/** The page region a box-relative rectangle covers, grown by `margin` on every side. */
function regionOf(box: BoundingBox, rect: DraftRect, margin: number): PageRegion {
  return {
    left: box.x + rect.x1 - margin,
    top: box.y + rect.y1 - margin,
    right: box.x + rect.x2 + margin,
    bottom: box.y + rect.y2 + margin,
  };
}

/**
 * The ink bounds inside a page region, in page CSS, or `null` when the region holds none.
 *
 * `page.screenshot({ clip })` takes VIEWPORT coordinates and the decoded image is scaled by the
 * capture's own scale, which `imageBoundsToCss` divides out against the region's own extent rather
 * than against `devicePixelRatio` — the same derivation every other spec here uses.
 *
 * The `null` return is what keeps the assertions falsifiable: a caller that asserts on a width has to
 * have found ink first, so a commit that put nothing on the canvas is a failure rather than a width
 * of zero.
 */
async function inkBoundsIn(page: Page, region: PageRegion): Promise<CssBounds | null> {
  const clip = {
    x: region.left,
    y: region.top,
    width: region.right - region.left,
    height: region.bottom - region.top,
  };
  const image = await loadImageData(await page.screenshot({ clip }));
  const bounds = await scanPixelsForBounds(image, isRedInk);
  if (!bounds.found) return null;
  return imageBoundsToCss(
    { width: image.width, height: image.height },
    { x: region.left, y: region.top, width: clip.width, height: clip.height },
    bounds
  );
}

/** The measured width of a region of red ink. */
async function inkWidthIn(
  page: Page,
  box: BoundingBox,
  rect: DraftRect,
  margin: number,
  label: string
): Promise<number> {
  const bounds = await inkBoundsIn(page, regionOf(box, rect, margin));
  if (!bounds) throw new Error(`${label}: no committed ink in the ${rect.x1},${rect.y1}..${rect.x2},${rect.y2} region`);
  return bounds.right - bounds.left;
}

/**
 * What one region of a decoded capture says about the ink in it, and why that is three numbers.
 *
 * - `maxRed` is the highest RED channel value anywhere in the region, paper included. A dim is a
 *   CHANNEL measurement and not a shape measurement: `rgba(0, 0, 0, 0.7)` over white leaves red at
 *   76, and over red ink it leaves red at 76 as well, so this number separates "the whole region was
 *   darkened" from "the ink is exactly where it was and is as bright as it was".
 * - `inkPixels` counts the pixels {@link isRedInk} accepts, which are the layer's own glyphs and
 *   nothing else. It is what keeps the other two honest: a region that moved and a layer that
 *   vanished can both leave the same brightest pixel behind, and only the count says how many there
 *   were. `RED_PIXEL_RED_MIN` is 180, so a dimmed glyph at 76 is not accepted at all and the count
 *   falls to zero — which is the loud failure this file wants, not a number to be tolerated.
 * - `brightest` is the accepted pixel with the highest red, with its other channels attached, so a
 *   dim that left green and blue at zero is visible as a measured value rather than inferred.
 */
interface RegionInk {
  maxRed: number;
  inkPixels: number;
  brightest: { red: number; green: number; blue: number } | null;
}

/**
 * {@link RegionInk} for a page region, through the same capture pipeline as {@link inkBoundsIn} —
 * `page.screenshot({ clip })` in viewport coordinates, `loadImageData` for the decode, and the
 * file's own `isRedInk` for the decision. A second pipeline would be a second set of thresholds.
 */
async function regionInk(page: Page, region: PageRegion): Promise<RegionInk> {
  const clip = {
    x: region.left,
    y: region.top,
    width: region.right - region.left,
    height: region.bottom - region.top,
  };
  const { data } = await loadImageData(await page.screenshot({ clip }));
  let maxRed = 0;
  let inkPixels = 0;
  let brightest: RegionInk['brightest'] = null;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    if (red > maxRed) maxRed = red;
    if (!isRedInk(red, green, blue, alpha)) continue;
    inkPixels += 1;
    if (!brightest || red > brightest.red) brightest = { red, green, blue };
  }
  return { maxRed, inkPixels, brightest };
}

/**
 * How wide each candidate string's ink is, measured by THIS page's own canvas and reported in the
 * same CSS px the screenshot measurement above reports.
 *
 * This is how a committed text layer's string is read, and it is worth being explicit about why
 * nothing simpler was available: a text layer's content lives in `layer.source.args`, which no
 * surface in the DOM renders — the Layers panel row shows the layer's NAME (`text 2`), not its text,
 * and the History panel shows a history entry's name. So the ink is the only observable, and it is a
 * good one: rendered by the app's own `renderText` in the app's own face, over a canvas that IS the
 * layer, composited into the document. Measuring it against a reference this page drew with the same
 * `fillText`, the same font shorthand and the same pixel predicate turns "some red pixels appeared"
 * into a statement about WHICH string.
 *
 * The predicate crosses the boundary as three numbers rather than as a function, because
 * `page.evaluate` serialises the callback and cannot carry a closure.
 */
async function referenceInkWidths(
  page: Page,
  strings: string[],
  options: { fontSize: number; fontFamily: string; scale: number }
): Promise<Record<string, number>> {
  const { fontSize, fontFamily, scale } = options;
  return await page.evaluate(
    ({ texts, size, family, fit, thresholds, padding }) => {
      const longest = texts.reduce((widest, text) => Math.max(widest, text.length), 1);
      const width = Math.ceil(size * 1.2 * longest) + 4 * padding;
      const height = Math.ceil(size * 2.5);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      // `willReadFrequently` is what keeps this context from logging Chromium's "multiple readback
      // operations using getImageData" console warning: the ink scan below reads this same context
      // once per candidate string, which is exactly the pattern the warning is about, and the suite's
      // `consolePolice` fixture surfaces stray console output.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('referenceInkWidths: no 2d context');
      ctx.font = `${size}px ${family}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ff0000';
      // `renderText` puts a line's baseline at `rect.y1 + TEXT_PADDING + ascent`, so the reference
      // is drawn at the same baseline the app drew its layer at. The baseline only has to be INSIDE
      // the canvas for the bounds to come out whole; it is reproduced so the reference is the app's
      // own placement and not a convenient one.
      const ascent = ctx.measureText('').fontBoundingBoxAscent ?? size * 0.8;
      ctx.fillText(texts[0] ?? '', padding, padding + ascent);

      const out: Record<string, number> = {};
      for (const text of texts) {
        ctx.clearRect(0, 0, width, height);
        ctx.fillText(text, padding, padding + ascent);
        const data = ctx.getImageData(0, 0, width, height).data;
        let left = -1;
        let right = -1;
        // EVERY ROW, and that is the half this got wrong first: a scan of row 0 alone reads an empty
        // strip above the first baseline and finds no ink at all, because the reference draws its
        // text at `TEXT_PADDING + ascent`, not in the top scanline.
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const alpha = data[i + 3];
            const isInk =
              alpha !== 0 &&
              data[i] > thresholds.redMin &&
              data[i + 1] < thresholds.greenMax &&
              data[i + 2] < thresholds.blueMax;
            if (!isInk) continue;
            if (left < 0 || x < left) left = x;
            if (x > right) right = x;
          }
        }
        if (left < 0) throw new Error(`referenceInkWidths: the reference drew no ink for ${JSON.stringify(text)}`);
        // Reported in CSS px, which is the space `inkWidthIn` reports in: the layer is rendered at
        // DOCUMENT px and the document is displayed at the contain fit, so the same ink is `fit`
        // times narrower on screen.
        out[text] = (right - left + 1) * fit;
      }
      return out;
    },
    {
      texts: strings,
      size: fontSize,
      family: fontFamily,
      fit: scale,
      padding: TEXT_PADDING_DOC_PX,
      thresholds: {
        redMin: RED_PIXEL_RED_MIN,
        greenMax: RED_PIXEL_GREEN_MAX,
        blueMax: RED_PIXEL_BLUE_MAX,
      },
    }
  );
}

/** The type size the tool is actually rendering with, read off the CONTROLLED input that owns it. */
async function toolFontSize(page: Page): Promise<number> {
  const fontSize = Number(await page.locator('#font-size-input').inputValue());
  expect(Number.isFinite(fontSize) && fontSize > 0, `#font-size-input reads "${fontSize}"`).toBe(true);
  return fontSize;
}

/**
 * The string the parity test lays out, chosen off the three characters that make a naive DOM overlay
 * and this app's canvas layout disagree.
 *
 * - **a DOUBLE SPACE** — CSS collapses a whitespace run to one space and so does `layoutText`'s
 *   `wrapLine`, which rejoins every break opportunity as a single U+0020. A `white-space: pre-wrap`
 *   overlay keeps the run and therefore charges two spaces of width where the canvas charges one, so
 *   it breaks a line earlier than the canvas does. This is the mutation the parity test must catch.
 * - **a TAB** — the same collapse, reached through a character whose CSS rendering under
 *   `pre-wrap` is `tab-size` columns wide rather than one space. `BREAK_OPPORTUNITY` matches it as
 *   whitespace, so the canvas charges it one space.
 * - **an NBSP-joined token** (`1\u00A0kg`) — the one that goes the OTHER way. NBSP is in the ES
 *   `WhiteSpace` production, so `\s` matches it and a naive break opportunity would split `1` from
 *   `kg`; `BREAK_OPPORTUNITY` excludes it by character class, so the token is one unit to the canvas
 *   and one unbreakable run to CSS `pre-line`. A test that only had the first two characters would
 *   pass against an overlay that broke `1 kg` in half, because nothing about the double space or the
 *   tab distinguishes the two.
 *
 * Long enough to wrap several times in the narrow box below, because a single-line string cannot
 * disagree with anything.
 */
const PARITY_TEXT = 'alpha  beta\tgamma 1 kg delta epsilon zeta eta theta iota kappa lambda mu nu xi';

/**
 * The narrow PARAGRAPH box the parity test lays out into.
 *
 * Wide enough that the string above wraps into five or six lines at 64px Arial, and placed high and
 * left enough that the box the content grows to (`lineCount * fontSize * lineHeight + 2 * TEXT_PADDING`,
 * which `calculateNewRect`'s paragraph arm computes) stays inside the 800x600 document. A box that
 * ran off the bottom edge would be clamped, and the clamp would change the wrap width under the
 * comparison without saying so.
 */
const PARITY_RECT: DraftRect = { x1: 120, y1: 60, x2: 716, y2: 420 };

/**
 * The string the vertical-caret test lays out into {@link PARITY_RECT}: long enough to wrap onto at
 * least two lines, short enough that the box does not have to grow to hold it.
 */
const WRAPPING_CARET_TEXT = 'alpha beta gamma delta epsilon zeta eta theta';

/** Where the caret test places its point draft. Box-relative, and the box grows to fit the text. */
// Keep point-text geometry away from the contained document's left letterbox. The layer origin is
// intentionally clamped to the document, so an oversized line near that edge cannot stay centred.
const CARET_CLICK = { x: 450, y: 250 };

/** Where the second box of the commit-on-click test goes: far enough from the first to be a placement. */
const FIRST_BOX_CLICK = { x: 200, y: 200 };
const SECOND_BOX_CLICK = { x: 150, y: 450 };
const CANVAS_REENTRY_TEXT = 'Canvas route';
const CLICK_LADDER_TEXT = 'Alpha beta gamma delta epsilon';
const CLICK_LADDER_RECT: DraftRect = { x1: 120, y1: 60, x2: 440, y2: 520 };

/**
 * The two strings the commit-on-click test commits, and WHY they were chosen to be this different.
 *
 * The assertion below has to tell "the first box's text landed in the first layer" from "the two
 * layers' ink are indistinguishable", and a pair like `First`/`Second` at 64px Arial measures about
 * 145px against 210px — 65px of separation, which is real but is a smaller share of it than it
 * looks. `First` against `SecondLine` is about 145px against 350px, so the two references are more
 * than twice `INK_WIDTH_TOLERANCE_CSS_PX` apart and either one landing in the other's region fails
 * loudly rather than marginally.
 */
const FIRST_TEXT = 'First';
const SECOND_TEXT = 'SecondLine';

/** The regions the commit-on-click test measures, in canvas-box coordinates. */
const FIRST_BOX_REGION: DraftRect = { x1: 120, y1: 100, x2: 700, y2: 380 };
const SECOND_BOX_REGION: DraftRect = { x1: 120, y1: 400, x2: 760, y2: 600 };

/** How far outside each of those regions the capture reaches, in CSS px. */
const REGION_MARGIN = 8;

/**
 * The brightest red a committed glyph may read and still be UNDIMMED, and where the number comes
 * from.
 *
 * The equality between the two measurements below is the claim, and equality ALONE cannot carry it:
 * `useRect`'s dim multiplies every channel by 0.3, so a dimmed document reads `maxRed` 76 both times
 * and a test that compared the two numbers to each other would be green on the very defect it exists
 * to catch. The floor is what separates them, and 200 sits far clear of 255 × (1 − 0.7) = 76.5 while
 * staying far below the 255 an undimmed `#ff0000` glyph on white paper reports.
 */
const UNDIMMED_RED_FLOOR = 200;

/**
 * The two CSS whitespace rules the parity test has to apply to a line the BROWSER measured, written
 * as named constants because they are the rule and not a string replacement.
 *
 * `BREAK_OPPORTUNITY` in `src/tools/text.ts` is the character class the app's own `layoutText` splits
 * a line on, and both patterns here are its complement: whitespace that is NOT a break opportunity is
 * a collapsible run, and a collapsible run at the end of a line is removed rather than rendered. CSS
 * `white-space: pre-line` collapses an interior run to one space and removes a run at a line end, and
 * the app's `wrapLine` and `trimTrailingCollapsibleSpace` do the same, so these two lines are what
 * "the same string, rendered" means on both sides of the comparison.
 *
 * The THREE ends, because CSS `pre-line` has three rules and `layoutText` has two of them by
 * construction: an interior run renders as one space, a run at the end of a line is removed, and a run
 * at the START of a line is removed as well — the browser still hands back a rect for such a space, so
 * without this one a measured line arrives with a leading blank on it.
 *
 * `\S` excludes NBSP and the `\u00A0` exclusion excludes it again, so `1\u00A0kg` stays one token on both
 * sides. All three are literal rather than a `new RegExp` from a string so the escapes are in the
 * source a reader can see — a bare NBSP character in a character class is invisible, trips ESLint's
 * `no-irregular-whitespace`, and survives exactly until something normalises it.
 */
const COLLAPSIBLE_RUN = /[^\S\u00A0]+/g;
const COLLAPSIBLE_RUN_AT_END = /[^\S\u00A0]+$/;
const COLLAPSIBLE_RUN_AT_START = /^[^\S\u00A0]+/;

test.describe('Text tool in-place editing', () => {
  test.describe.configure({ timeout: TEXT_EDIT_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(getWorkspaceCanvas(page), 'the app mounted a document canvas').toBeVisible();
    await selectTextTool(page);
    // Every ink measurement in this file needs a colour nothing else on this canvas is, and the
    // tool's OWN swatch is the control that owns it — the same control a user reaches for.
    await setTextToolColor(page, TEXT_COLOR);
  });

  test('the box arrives holding the Adobe placeholder', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);

    const element = overlay(page);
    await expect(element).toBeVisible();
    await expect(element).toHaveAttribute('data-text-kind', 'point');
    await expect(element).toHaveAttribute('role', 'textbox');
    await expect(element).toHaveAttribute('aria-multiline', 'true');
    // Read as an EXACT string, not through `toHaveText`, which normalises whitespace — this file's
    // subject is whitespace and the placeholder's shape is half of the claim.
    expect(await overlayText(page), 'the box did not arrive holding the Adobe placeholder').toBe(PLACEHOLDER);
  });

  test('the placeholder is SELECTED, not merely focused', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();

    // Asserted SEPARATELY from the text above, and that separation is the whole point of the test.
    // `focus()` alone would satisfy "the overlay exists" and "the overlay holds the placeholder",
    // and typing would then APPEND to the placeholder — which is the defect
    // `TextToolArea`'s `placing ? PLACEHOLDER_TEXT : args.text` and the overlay's `selectAllIn` on
    // entry exist to prevent. A test that read the text and stopped there would be green on the bug.
    const selection = await selectionState(page);
    expect(selection.inside, 'the selection is not inside the overlay at all').toBe(true);
    expect(selection.string, 'nothing is selected, so typing would append rather than replace').toBe(PLACEHOLDER);
    expect(selection.collapsed, 'the selection is collapsed, so nothing would be replaced').toBe(false);
  });

  test('typing replaces the placeholder rather than appending to it', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Hi');

    // Asserted as an EXACT equality, which is what rules out both failure shapes at once:
    // `HiLorem ipsum` is "appended", `Lorem ipsumHi` is "typed before the selection" and the
    // third shape, `Hi` with the placeholder still somewhere in the element, is excluded because
    // the string is compared whole rather than by substring.
    expect(await overlayText(page), 'typing did not replace the selected placeholder').toBe('Hi');
  });

  test('ArrowLeft moves the caret and the character lands where the caret was', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('abc');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await selectionState(page)).caretIndex, 'two presses of ArrowLeft did not move the caret to index 1').toBe(
      1
    );
    await page.keyboard.type('X');

    // Read back from the OVERLAY, not from a re-read of what was typed: the value under test is what
    // the element holds after four keystrokes and two caret moves, and a test that asserted the
    // keystroke sequence instead would pass with a caret that never moved at all.
    expect(await overlayText(page), 'the caret did not move, so the character landed at the end').toBe('aXbc');
  });

  test('repeated Enter then typing keeps each character after its hard break', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await page.keyboard.type('I');
    await page.keyboard.press('Enter');
    await page.keyboard.type('I');
    await page.keyboard.press('Enter');
    await page.keyboard.type('I');

    expect(await overlayText(page), 'typing after repeated hard breaks moved above the caret').toBe('I\nI\nI');
  });

  test('ArrowRight, ArrowUp and ArrowDown move the caret', async ({ page }) => {
    const box = await canvasBox(page);

    // A PARAGRAPH box narrow enough that the string below WRAPS, because a vertical caret move needs
    // a second visual line to move to. Hard-break behavior is covered separately above.
    await dragToPlace(page, box, PARITY_RECT);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.insertText(WRAPPING_CARET_TEXT);
    const end = WRAPPING_CARET_TEXT.length;

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect((await selectionState(page)).caretIndex, 'two presses of ArrowLeft did not move the caret back two').toBe(
      end - 2
    );
    await page.keyboard.press('ArrowRight');
    expect((await selectionState(page)).caretIndex, 'ArrowRight did not move the caret forward').toBe(end - 1);

    // The vertical moves, measured as a ROUND TRIP rather than as an absolute index. Chromium takes
    // the caret to the same horizontal position one line up and clamps it at that line's end, so the
    // index ArrowUp lands on is a function of where in the line the caret was — and pinning that
    // arithmetic here would be a claim about the browser's editing commands rather than about this
    // app. What is this app's: the caret leaves the last line and comes back to exactly where it
    // started.
    await page.keyboard.press('ArrowUp');
    const up = (await selectionState(page)).caretIndex;
    expect(up, `ArrowUp left the caret on the last line at ${end - 1}, so it did not move vertically`).toBeLessThan(
      end - 1
    );
    await page.keyboard.press('ArrowDown');
    expect((await selectionState(page)).caretIndex, 'ArrowDown did not bring the caret back to the last line').toBe(
      end - 1
    );
  });

  test('Home and End move the caret to the ends of the line', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('abcd');

    await page.keyboard.press('End');
    expect((await selectionState(page)).caretIndex, 'End did not move the caret to the end of the line').toBe(4);
    expect((await selectionState(page)).collapsed, 'End left a selection behind').toBe(true);

    await page.keyboard.press('Home');
    expect((await selectionState(page)).caretIndex, 'Home did not move the caret to the start of the line').toBe(0);
  });

  test('Shift with an arrow key extends the selection, and it is readable as a string', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('abcd');

    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const whole = await selectionState(page);
    expect(whole.string, 'Shift+End did not select the whole line').toBe('abcd');
    expect(whole.collapsed, 'Shift+End left a collapsed selection').toBe(false);

    // And a PARTIAL extension, so the assertion above cannot be satisfied by a selection that is
    // either everything or nothing — which is the only two states a broken implementation would
    // produce here.
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    const partial = await selectionState(page);
    expect(partial.string, 'two Shift+ArrowLeft presses did not select the last two characters').toBe('cd');
    expect(partial.caretIndex, 'the selection anchor did not stay at the end of the line').toBe(2);
  });

  test('Command+Shift+Arrow selects the next word', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Alpha beta');
    await page.keyboard.press('Home');
    await page.keyboard.press('Meta+Shift+ArrowRight');

    const selected = await selectionState(page);
    expect(selected.string, 'the shortcut did not select exactly one word').toBe('Alpha');
    expect(selected.collapsed, 'word selection remained collapsed').toBe(false);
  });

  test('five clicks select all text in the editor', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Alpha beta');
    const bounds = await overlay(page).boundingBox();
    if (!bounds) throw new Error('the text editor has no clickable bounds');
    await page.mouse.click(bounds.x + 4, bounds.y + 4, { clickCount: 5 });

    const selected = await selectionState(page);
    expect(selected.string, 'five clicks did not select all text').toBe('Alpha beta');
    expect(selected.collapsed, 'select-all left a collapsed caret').toBe(false);
  });

  test('Escape commits the draft instead of discarding it', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Kept');

    // Adobe's shipped default, not the historical folklore: "Note that the Esc key is set to commit
    // text by default. You can change this to cancel the changes by going to Edit > Preferences >
    // Type … Then uncheck Use Esc key to commit text" (https://helpx.adobe.com/photoshop/using/
    // editing-text.html). There is no preferences store in this app, so the default IS the behaviour.
    await page.keyboard.press('Escape');

    // THREE separate pieces of evidence, because "a layer exists" and "the layer holds the typed
    // words" are different claims and the Layers panel only ever shows a layer's name. The count,
    // the name shape, and the ink measured against a reference of `Kept` are: a commit that created
    // an EMPTY text layer passes the first two and fails the third.
    await expect(overlay(page), 'the overlay is still up, so nothing was committed').toHaveCount(0);
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a tool layer').toHaveText(
      /^text \d+$/
    );

    const fit = await readFit(page);
    const fontSize = await toolFontSize(page);
    const references = await referenceInkWidths(page, ['Kept', 'Discarded'], {
      fontSize,
      fontFamily: 'Arial',
      scale: fit.scale,
    });
    const measured = await inkWidthIn(page, box, { x1: 120, y1: 150, x2: 620, y2: 340 }, 20, 'the Escape commit');
    expect(
      Math.abs(measured - references.Kept),
      `the committed ink is ${measured.toFixed(1)} CSS px wide, which is not the width of "Kept" (${references.Kept.toFixed(1)})`
    ).toBeLessThanOrEqual(INK_WIDTH_TOLERANCE_CSS_PX);
    expect(
      Math.abs(measured - references.Discarded),
      'the committed ink is the width of a different string, so the layer did not carry what was typed'
    ).toBeGreaterThan(INK_WIDTH_TOLERANCE_CSS_PX);
  });

  test('Control+Enter commits the draft', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Kept');

    // A SEPARATE test from Escape's, deliberately: one `it` per commit key is what says both are
    // wired. Folded into a single test, a regression that removed the Escape arm would still leave
    // Control+Enter committing and the test green.
    await page.keyboard.press('Control+Enter');

    await expect(overlay(page), 'the overlay is still up, so nothing was committed').toHaveCount(0);
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a tool layer').toHaveText(
      /^text \d+$/
    );
  });

  test('a committed text layer can be re-entered from its Layers row', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await page.keyboard.type('Reenter');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows).toHaveCount(2);

    // The row is the layer thumbnail/name surface in this app. Double-clicking it must hydrate the
    // retained source args rather than create a second layer or place a fresh draft at the origin.
    await layerRows.nth(0).dblclick();
    await expect(overlay(page), 'double-clicking the committed text row did not reopen the editor').toBeVisible();
    expect(await overlayText(page), 're-entry did not hydrate the committed characters').toBe('Reenter');
    await page.keyboard.type('Edited');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows, 're-entry created a replacement layer').toHaveCount(2);
  });

  test('a click elsewhere on the canvas COMMITS the open draft and then places a new box', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type(FIRST_TEXT);
    await expect(layerRows, 'the open draft is not a layer yet').toHaveCount(1);

    // THE DATA-LOSS FIX. `TextToolArea`'s `onChangeEnd` used to overwrite `args` with a fresh box on
    // the second placement, and because a draft is not yet a layer nothing had recorded it: the
    // typed words were gone with no history entry and no row in the panel. The count below is the
    // whole claim, and it is read BEFORE anything else happens, so a fix that committed the NEW box
    // with the OLD text — the opposite order, and the one the component's own comment names — could
    // not satisfy it either.
    await clickToPlace(page, box, SECOND_BOX_CLICK);
    await expect(layerRows, 'the first draft was discarded rather than committed').toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a tool layer').toHaveText(
      /^text \d+$/
    );
    await expect(overlay(page), 'the second placement did not open a new editor').toHaveCount(1);

    /**
     * THE NEW DRAFT IS USABLE, which is what `flushSync` in `TextToolArea`'s `onChangeEnd` bought and
     * what an earlier version of this test declined to check.
     *
     * Without the `flushSync` the commit and the new placement were ONE batched render, so
     * the editor was never unmounted between the two drafts, and
     * the overlay's entry effect — which seeds the placeholder, focuses the element and selects its
     * contents — had nothing to fire on when the outgoing draft was still holding the untouched
     * placeholder. MEASURED there: the second box came up unfocused and unselected, showing the FIRST
     * box's words while the model held `'Lorem ipsum'`, and every keystroke was swallowed. That
     * comment sat here and stopped the test short of the claim. The element is now a genuinely new one,
     * so all three halves are assertable.
     */
    expect(
      await overlayText(page),
      'the second placement did not arrive holding the Adobe placeholder, so this is not a new draft at all'
    ).toBe(PLACEHOLDER);
    const secondDraft = await selectionState(page);
    expect(secondDraft.inside, 'the new draft holds no selection, so typing would append to the placeholder').toBe(
      true
    );
    expect(secondDraft.string, 'the new draft is not SELECTED, so typing would append rather than replace').toBe(
      PLACEHOLDER
    );
    expect(secondDraft.collapsed, 'the new draft left a collapsed selection, so nothing would be replaced').toBe(false);

    // Typed into the SECOND box and read back from the element. An exact string, which rules out all
    // three failure shapes at once: the placeholder still present, the first box's words still there,
    // and the typed characters appended after them.
    await page.keyboard.type(SECOND_TEXT);
    expect(await overlayText(page), 'typing into the new draft did not land as the typed string alone').toBe(
      SECOND_TEXT
    );

    // The second draft is committed too, so BOTH layers are measurable — which is what turns "the two
    // regions" from one measurement and one absence into a claim about which string is in which layer.
    await page.keyboard.press('Escape');
    await expect(overlay(page), 'the second draft is still open, so nothing was committed').toHaveCount(0);
    await expect(layerRows, 'the second draft did not become a layer').toHaveCount(3);

    /**
     * The ink, measured with NO draft open, and only here.
     *
     * With a draft open, every ALREADY-COMMITTED text layer used to be DIMMED, and this paragraph used
     * to report that as a bigger defect than it is: the claim here was that the glyphs re-render in
     * BLACK rather than in the colour their args carry, because the measurement read `rgb(0,0,0)`.
     * That was the `rgb(76,76,76)` DOCUMENT being read through a scan that had already lost the glyphs,
     * not the glyphs' own channels. MEASURED again, glyph core and all, with the same capture and the
     * same predicate: the committed `'First'` reads `rgb(76,0,0)` with a draft open and `rgb(255,0,0)`
     * with none, and green and blue are 0 in BOTH. So the layer keeps its own `#ff0000` and is dimmed to
     * 30% by `useRect`'s crop blend — 255 × (1 − 0.7) = 76.5 — which is why it matched no ink predicate
     * (`RED_PIXEL_RED_MIN` is 180). That is the WHOLE defect, it is fixed, and it is pinned by
     * `a committed layer keeps its full ink colour while a SECOND draft is open` below, which measures
     * the committed layer's channel values rather than its ink bounds.
     *
     * The measurement still waits for no draft open, for a different reason and a narrower one: this
     * test's subject is WHICH STRING landed in which layer, and its oracle is a set of references
     * measured through `isRedInk`. A dim does not move a string or change its width, but it empties
     * that oracle outright, so the two subjects would be sharing one measurement.
     *
     * The Layers panel shows a layer's NAME, never its text, and `layer.source.args.text` reaches no DOM
     * surface at all, so the ink is the only observable — and a good one: rendered by the app's own
     * `renderText` into a canvas that IS the layer, then composited into the document. Measured against
     * references this page drew with the same `fillText`, the same font shorthand and the same pixel
     * predicate, it says which string landed.
     */
    const fit = await readFit(page);
    const fontSize = await toolFontSize(page);
    const references = await referenceInkWidths(page, [FIRST_TEXT, SECOND_TEXT, PLACEHOLDER], {
      fontSize,
      fontFamily: 'Arial',
      scale: fit.scale,
    });

    for (const [region, own, label] of [
      [FIRST_BOX_REGION, FIRST_TEXT, 'the committed first box'],
      [SECOND_BOX_REGION, SECOND_TEXT, 'the committed second box'],
    ] as const) {
      const measured = await inkWidthIn(page, box, region, REGION_MARGIN, label);
      // Against the OTHER TWO strings, so a measurement that happened to fit more than one cannot pass.
      for (const other of [FIRST_TEXT, SECOND_TEXT, PLACEHOLDER].filter((candidate) => candidate !== own)) {
        expect(
          Math.abs(measured - references[other]),
          `${label} is ${measured.toFixed(1)} CSS px wide, which is also the width of "${other}" (${references[other].toFixed(1)})`
        ).toBeGreaterThan(INK_WIDTH_TOLERANCE_CSS_PX);
      }
      expect(
        Math.abs(measured - references[own]),
        `${label} carries ${measured.toFixed(1)} CSS px of ink, which is not "${own}" (${references[own].toFixed(1)})`
      ).toBeLessThanOrEqual(INK_WIDTH_TOLERANCE_CSS_PX);
    }
  });

  /**
   * THE CROP DIM, measured on a layer that is already COMMITTED.
   *
   * `useRect`'s `drawMask` lays `rgba(0, 0, 0, 0.7)` over the WHOLE document and then `clearRect`s a
   * hole at the frame. That dim is the crop tool's "everything outside the crop is not part of the
   * result", and it is the DEFAULT because most of `useRect`'s consumers are crop-shaped — which is
   * why the Type tool has to opt out of it explicitly. It did not, so every committed layer was dimmed
   * to 30% for as long as ANY draft was open, across the whole document rather than the box being
   * edited.
   *
   * MEASURED, headless Chromium, on a committed red glyph: `maxRed` 76 with a draft open against 255
   * with none, and 255 × (1 − 0.7) = 76.5, which is the arithmetic of that fill and nothing else.
   *
   * The claim pinned here is an ABSENCE, so it is asserted as one: the region's three numbers must be
   * IDENTICAL with and without a second draft open. That equality is what says "nothing about this
   * region changed"; the `UNDIMMED_RED_FLOOR` is what stops 76-against-76 from passing; and the ink
   * COUNT is what keeps "the region moved" and "the layer vanished" distinguishable from a dim,
   * because all three can leave the same brightest pixel behind and only the count says how many
   * pixels there were.
   *
   * The second box goes at {@link SECOND_BOX_CLICK}, whose whole ink and whose frame sit below
   * `FIRST_BOX_REGION` — so the region under measurement holds the first layer and nothing else, and a
   * failure here cannot be one box's ink standing in for another's.
   */
  test('a committed layer keeps its full ink colour while a SECOND draft is open', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type(FIRST_TEXT);
    await page.keyboard.press('Escape');
    await expect(overlay(page), 'the draft is still open, so nothing was committed').toHaveCount(0);
    await expect(layerRows, 'the first box did not become a layer').toHaveCount(2);

    // BASELINE, with NO draft open — the state the product renders a committed layer correctly in, and
    // the only reading this file takes before the second box is placed.
    const committed = await regionInk(page, regionOf(box, FIRST_BOX_REGION, REGION_MARGIN));
    expect(
      committed.inkPixels,
      'the committed layer put no red ink in the region, so nothing was measured'
    ).toBeGreaterThan(0);
    expect(
      committed.maxRed,
      `the committed layer reads maxRed ${committed.maxRed} with no draft open, so it is already dimmed before any draft exists`
    ).toBeGreaterThanOrEqual(UNDIMMED_RED_FLOOR);

    // THE ONLY DIFFERENCE. A click elsewhere places a second box, and a placement is all it takes:
    // the draft it opens is the trigger, and it is opened while the first layer is already committed,
    // so the dim (if any) has nothing to do with the layer under measurement.
    await clickToPlace(page, box, SECOND_BOX_CLICK);
    await expect(overlay(page), 'the second placement did not open a draft, so nothing was dimmed').toBeVisible();
    await expect(layerRows, 'the second placement committed a layer, so it was not a draft').toHaveCount(2);

    const withDraft = await regionInk(page, regionOf(box, FIRST_BOX_REGION, REGION_MARGIN));

    expect(
      withDraft.maxRed,
      `the committed layer's brightest red fell from ${committed.maxRed} to ${withDraft.maxRed} while a second draft was open. 255 x (1 - 0.7) = 76.5: this is useRect's crop dim, which a text box must not ask for.`
    ).toBe(committed.maxRed);
    expect(
      withDraft.inkPixels,
      `the committed layer held ${committed.inkPixels} red pixels with no draft open and ${withDraft.inkPixels} with one open. A dim moves every glyph under RED_PIXEL_RED_MIN (180), so a fall to zero is a dim and not a region that moved or a layer that vanished.`
    ).toBe(committed.inkPixels);
    expect(
      withDraft.brightest,
      `the brightest ink pixel changed from ${JSON.stringify(committed.brightest)} to ${JSON.stringify(withDraft.brightest)} while a second draft was open`
    ).toEqual(committed.brightest);
    expect(
      withDraft.maxRed,
      'a dimmed document reads 76 against 255 undimmed, so equal readings alone would pass on the defect'
    ).toBeGreaterThanOrEqual(UNDIMMED_RED_FLOOR);
  });

  test('the overlay is gone after a commit and comes back on the next placement', async ({ page }) => {
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page), 'the first placement did not open an editor').toBeVisible();
    await page.keyboard.type('One');
    await page.keyboard.press('Escape');
    await expect(overlay(page), 'the overlay survived the commit').toHaveCount(0);

    // Edit mode is DERIVED — `hasPendingText(args)`, the same predicate the dirty-document check and
    // the options bar's Commit button use — so there is no flag anywhere that could be left set after
    // a commit or unset after one. This second placement is what makes that claim falsifiable: a
    // sticky flag would render the overlay over a box that does not exist, or not at all.
    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await expect(overlay(page), 'the next placement did not open a fresh editor').toBeVisible();
    await expect(overlay(page)).toHaveAttribute('data-text-kind', 'point');
    expect(await overlayText(page), 'the fresh editor did not arrive holding the placeholder').toBe(PLACEHOLDER);

    // And a Cancel, which is the OTHER way out of edit mode, must clear it as well rather than leave
    // the overlay up over a draft that is no longer there.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(overlay(page), 'Cancel left the overlay up over a draft that was discarded').toHaveCount(0);
  });

  test('an UNTOUCHED placeholder is discarded by a click elsewhere but committed by the Commit button', async ({
    page,
  }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    /**
     * THE ASYMMETRY, and it is deliberate: `commitDirtyTool`'s text branch checks the explicit
     * `placeholderUntouched` flag before clearing the args instead of calling `createLayerFromTool`.
     * Clicking with the Type tool and then clicking away leaves the
     * document unchanged, because the placeholder previews the font rather than being content. The
     * EXPLICIT Commit button deliberately still commits it, because there the user has said "take
     * this", and the same function serves both callers.
     *
     * Both halves are in this one test, and in this order, because the claim is the DIFFERENCE: a
     * change that made the implicit path commit would satisfy the second half and silently break the
     * first, and a change that made the explicit path discard would satisfy the first and silently
     * break the second.
     */
    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await expect(overlay(page), 'the first placement did not open an editor').toBeVisible();
    expect(await overlayText(page), 'the draft did not arrive holding the placeholder').toBe(PLACEHOLDER);
    await expect(layerRows, 'an open draft is not a layer yet').toHaveCount(1);

    // THE IMPLICIT HALF: a second placement, with NOTHING typed into the first.
    await clickToPlace(page, box, SECOND_BOX_CLICK);
    await expect(
      layerRows,
      'the untouched placeholder was committed by the second placement rather than discarded'
    ).toHaveCount(1);
    // And the new draft is genuinely open, so the count above is a discard rather than a crash or a
    // tool switch that quietly took the draft away.
    await expect(overlay(page), 'the second placement did not open a new editor').toHaveCount(1);

    /**
     * THE NEW DRAFT IS USABLE, and THIS is the only case in the file where `flushSync` is the whole
     * reason. `TextEditOverlay` re-seeds when the element's text no longer matches the model's, so an
     * untouched placeholder handing over to another untouched placeholder has NOTHING to fire on: the
     * element already holds `'Lorem ipsum'` and so does the model, the mismatch guard short-circuits,
     * and the new box comes up unfocused and unselected. Without the synchronous render between the two
     * writes the editor is never unmounted either, so there is no second line of defence.
     *
     * It is worth being explicit that the TYPED case does not depend on `flushSync` and this one does:
     * `a click elsewhere on the canvas COMMITS the open draft` still passes with the `flushSync`
     * deleted, because there the outgoing text and the incoming placeholder genuinely differ and the
     * re-entry fires on its own. Mutated and measured — that test green, this one red.
     */
    expect(await overlayText(page), 'the second placement did not arrive holding the placeholder').toBe(PLACEHOLDER);
    const secondDraft = await selectionState(page);
    expect(secondDraft.inside, 'the new draft holds no selection, so typing would append to the placeholder').toBe(
      true
    );
    expect(secondDraft.string, 'the new draft is not SELECTED, so typing would append rather than replace').toBe(
      PLACEHOLDER
    );
    expect(secondDraft.collapsed, 'the new draft left a collapsed selection, so nothing would be replaced').toBe(false);

    // Typed into it and read back from the element, which is the half that fails outright on a lost
    // re-entry: with nothing selected, the keystrokes land at the caret instead of over the string.
    await page.keyboard.type('Hi');
    expect(await overlayText(page), 'typing into the new draft did not replace the placeholder').toBe('Hi');
    await expect(layerRows, 'typing into an open draft created a layer').toHaveCount(1);

    // Back out of the second draft, so the next half starts from a clean document and the only
    // difference between the two is HOW the draft is ended.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows, 'Cancel created a layer').toHaveCount(1);

    // THE EXPLICIT HALF: the same untouched placeholder, ended on purpose through the button.
    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await expect(overlay(page), 'the third placement did not open an editor').toBeVisible();
    expect(await overlayText(page), 'the draft did not arrive holding the placeholder').toBe(PLACEHOLDER);
    await expect(layerRows).toHaveCount(1);

    await page.getByRole('button', { name: 'Commit' }).click();
    await expect(overlay(page), 'the overlay is still up, so the Commit button committed nothing').toHaveCount(0);
    await expect(layerRows, 'the Commit button discarded an untouched placeholder').toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a tool layer').toHaveText(
      /^text \d+$/
    );
  });

  test('the overlay is laid over the box the canvas drew', async ({ page }, testInfo: TestInfo) => {
    const box = await canvasBox(page);
    const fit = await readFit(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();

    // The box is read from the PIXELS rather than from the overlay's own geometry, which is the
    // whole point: an overlay that computed its own position from the same rect it is being checked
    // against would agree with itself under any arithmetic. The frame is drawn by `useRect` into the
    // tool overlay in DOCUMENT px from `args.rect`, and the document is displayed at the fit, so the
    // two are independent readings of the same box.
    const capture = await captureCanvasScreenshot(page, box, testInfo, 'text-edit-frame');
    const image = await loadImageData(capture);
    const frame = await scanPixelsForBounds(image, isDraftFrame);
    expect(frame.found, 'the draft box drew no frame, so there is nothing to compare the overlay against').toBe(true);
    const frameCss = imageBoundsToCss({ width: image.width, height: image.height }, box, frame);

    const element = overlay(page);
    const bounds = await element.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });

    // `containFit` here is a TRIPWIRE rather than a derivation: the fit used for the mapping below is
    // the one the APP published, and this asserts the two agree, so a change to the fit rule cannot
    // silently move the overlay off its box while this test still passes on the app's own numbers.
    const derived = containFit(
      { width: fit.documentWidth * 0 + box.width, height: box.height },
      {
        width: fit.documentWidth,
        height: fit.documentHeight,
      }
    );
    expect(derived.scale, "the published fit and the suite's containFit rule disagree on the scale").toBeCloseTo(
      fit.scale,
      5
    );
    expect(derived.offsetX, "the published fit and the suite's containFit rule disagree on the letterbox").toBeCloseTo(
      fit.offsetX,
      5
    );

    // Containment, in the form that cannot pass on a shifted overlay: each edge of the box, DERIVED
    // from where the blue stops plus the handle's own overhang, has to sit within a pixel of the
    // overlay's edge. A document-point-to-client-pixel mapping bug — the letterbox offset dropped,
    // the scale inverted, a `rect.y1`/`rect.x1` transposition — moves these by tens of pixels, which
    // is why the margin here is a pixel rather than a tolerance anyone would widen.
    const edge = (actual: number, derivedFromFrame: number, label: string) =>
      expect(
        Math.abs(actual - derivedFromFrame),
        `${label}: the overlay edge is ${(actual - derivedFromFrame).toFixed(2)} CSS px from the box's own edge`
      ).toBeLessThanOrEqual(2);

    edge(bounds.left, frameCss.left + FRAME_OVERHANG_CSS_PX, 'left');
    edge(bounds.top, frameCss.top + FRAME_OVERHANG_CSS_PX, 'top');
    edge(bounds.right, frameCss.right - FRAME_OVERHANG_CSS_PX, 'right');
    edge(bounds.bottom, frameCss.bottom - FRAME_OVERHANG_CSS_PX, 'bottom');

    // And the SIZE, which is the half a pure containment check misses: an overlay twice as wide as
    // its box contains the box perfectly and puts the user's caret in the wrong place. The handles
    // are `HANDLE_SIZE` outside each edge, so the box is the frame narrowed by twice that.
    // The frame comes from a device-pixel screenshot while the overlay uses CSS layout, so the
    // mapped width can carry a fractional-pixel rounding remainder.
    expect(
      Math.abs(bounds.width - (frameCss.right - frameCss.left - 2 * FRAME_OVERHANG_CSS_PX)),
      'the overlay is not as wide as the box the canvas drew'
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(bounds.height - (frameCss.bottom - frameCss.top - 2 * FRAME_OVERHANG_CSS_PX)),
      'the overlay is not as tall as the box the canvas drew'
    ).toBeLessThanOrEqual(2);
  });

  test('the overlay wraps where layoutText breaks, on the characters the two rules disagree about', async ({
    page,
  }) => {
    const box = await canvasBox(page);

    await dragToPlace(page, box, PARITY_RECT);
    await expect(overlay(page)).toHaveAttribute('data-text-kind', 'paragraph');
    await expect(overlay(page)).toBeVisible();

    // `insertText`, not `keyboard.type`. A literal TAB typed as a key press is the focus key: it
    // would leave the overlay and put the caret in the rail, and the string under test would be a
    // different one. `keyboard.insertText` commits text through the input pipeline without key
    // handling, which is also exactly how an IME delivers a candidate.
    await page.keyboard.insertText(PARITY_TEXT);

    // Asserted as an EXACT string, and this is load-bearing rather than incidental: the parity test
    // below would happily report agreement between two renderings of a DIFFERENT string. A dropped
    // tab or a normalised NBSP would change the widths and therefore the breaks, so the parity
    // comparison would be comparing the wrong thing — and this is the assertion that says so.
    expect(await overlayText(page), 'the tab, the double space or the NBSP did not survive the insert').toBe(
      PARITY_TEXT
    );

    /**
     * The line sets, one pair per WRAP WIDTH — measured, not reported.
     *
     * The width sweep is what makes this falsifiable, and it is not decoration. A single width samples
     * the break function at one point, and a point can be insensitive: MEASURED here, at the width the
     * drag above produces, `white-space: pre-wrap` produces the SAME five lines as `pre-line` — the
     * preserved double space and the expanded tab are each a few dozen document px on a 603px wrap, and
     * neither is enough to move a break there. A mutation that changed nothing the test can see is a
     * test that pins nothing. So the wrap width is swept, and every sample has to agree: an overlay
     * whose rule differs from the canvas's differs from it at SOME width, and a sweep of eleven widths
     * is where "some" is looked for rather than assumed.
     *
     * Only the WIDTH is varied, by writing `host.style.width` on the element the app rendered. That
     * is the one variable the claim is about, it is what a resize of the box does, and nothing else
     * about the overlay's typography moves — the font, its size, its leading, its tracking and its
     * alignment are read back from the element's OWN computed style, so a sweep cannot accidentally
     * compare two differently-styled renderings. The original inline width and height are restored
     * before returning.
     */
    const samples = await page.evaluate(
      async ({ runSource, endSource, startSource }) => {
        const host = document.querySelector('#text-edit-overlay');
        const container = document.querySelector('[data-testid="workspace-container"]');
        if (!(host instanceof window.HTMLDivElement) || !container) {
          throw new Error('the overlay or the workspace container is not in the document');
        }
        const scale = Number(container.getAttribute('data-fit-scale'));
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('the app published no usable data-fit-scale');

        const collapsibleRun = new RegExp(runSource, 'g');
        const collapsibleRunAtEnd = new RegExp(endSource);
        const collapsibleRunAtStart = new RegExp(startSource);
        const text = host.textContent ?? '';
        const draggedWidth = parseFloat(host.style.width);

        /**
         * The overlay's RENDERED lines, measured rather than read back from anything.
         *
         * ONE RANGE PER CHARACTER, grouped by rect top. The overlay's text is in the LIGHT DOM, so a
         * `Range` can be asked where each character is and the answer is a client rect — the whole
         * reason this is a `div[contenteditable]` and not a textarea, whose value is in a closed shadow
         * root where no `Range` can reach it. Grouping by top is what makes this a measurement of the
         * BROWSER's line breaking rather than a re-read of anything the app believes.
         */
        const measuredLines = (): string[] => {
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
          const placed: { index: number; top: number }[] = [];
          let offset = 0;
          let node = walker.nextNode();
          while (node) {
            const length = node.textContent?.length ?? 0;
            for (let i = 0; i < length; i++) {
              const range = document.createRange();
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              const rects = range.getClientRects();
              // A character with NO rect is one CSS collapsed away — a whitespace run under `pre-line`,
              // or a space at the end of a soft-wrapped line. Those characters belong to no rendered
              // line and are skipped rather than invented onto one.
              if (rects.length > 0) placed.push({ index: offset + i, top: Math.round(rects[0].top) });
            }
            offset += length;
            node = walker.nextNode();
          }
          const byTop = new Map<number, number[]>();
          for (const entry of placed) {
            const group = byTop.get(entry.top);
            if (group) group.push(entry.index);
            else byTop.set(entry.top, [entry.index]);
          }
          return [...byTop.keys()]
            .sort((a, b) => a - b)
            .map((top) => {
              const indices = byTop.get(top)!.sort((a, b) => a - b);
              // The line is the SLICE of the ORIGINAL string between the first and last character the
              // browser placed on it, and only then are its whitespace runs collapsed and its trailing
              // run removed — which is what CSS `pre-line` renders, and what the app's own `wrapLine`
              // and `trimTrailingCollapsibleSpace` do to its line. Both run AFTER the break has been
              // measured, which is what keeps the test honest: neither can move a character from one
              // line to another, so an overlay that wrapped on a PRESERVED run still fails below.
              const slice = text.slice(indices[0], indices[indices.length - 1] + 1);
              return slice
                .replace(collapsibleRun, ' ')
                .replace(collapsibleRunAtStart, '')
                .replace(collapsibleRunAtEnd, '');
            });
        };

        // The app's own layout, run here against a canvas this page created. The module is fetched
        // FROM the dev server rather than imported by this spec, because nothing under `e2e/` imports
        // app source — `vitest.e2e.config.ts` records that boundary — and the point of the test is to
        // compare against the REAL `layoutText`, not against a second implementation of it. It is the
        // same function `renderText` draws from.
        const specifier: string = ['/src', 'tools', 'text.ts'].join('/');
        const module = (await import(/* @vite-ignore */ specifier)) as {
          layoutText: (
            ctx: CanvasRenderingContext2D,
            style: unknown,
            text: string,
            wrapWidth: number,
            boxHeight: number
          ) => { lines: string[]; overflow: boolean };
        };

        const computed = window.getComputedStyle(host);
        const fontSize = parseFloat(computed.fontSize) / scale;
        const lineStep = parseFloat(computed.lineHeight) / scale;
        // `letter-spacing: 0px` and `letter-spacing: normal` are the same declaration as far as
        // Chromium is concerned and it reports the second one. `parseFloat('normal')` is `NaN`, a
        // `NaN` tracking makes `inkWidth` return `NaN`, `fits` is then false for EVERY candidate, and
        // `layoutText` answers with one word per line — a layout nobody is rendering, compared
        // against. The guard is what keeps a computed style this spec has not seen from silently
        // becoming a wrong answer rather than an error.
        const computedTracking = Number.parseFloat(computed.letterSpacing);
        const style = {
          align: computed.textAlign,
          allCaps: computed.textTransform === 'uppercase',
          bold: computed.fontWeight === '700',
          color: computed.color,
          fontFamily: computed.fontFamily,
          fontSize,
          italic: computed.fontStyle === 'italic',
          lineHeight: fontSize > 0 ? lineStep / fontSize : 0,
          smallCaps: computed.fontVariantCaps === 'small-caps',
          strikethrough: computed.textDecorationLine.includes('line-through'),
          tracking: Number.isFinite(computedTracking) ? computedTracking / scale : 0,
          underline: computed.textDecorationLine.includes('underline'),
        };

        const canvas = document.createElement('canvas');
        // A canvas created HERE rather than the app's, because `layoutText` is pure with respect to
        // the context — it only sets font properties on it and calls `measureText` — and a fresh
        // context cannot be perturbed by whatever the tool overlay last drew through it.
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context for layoutText');

        // `TEXT_PADDING` is `5` in `src/util/constants.ts`, written out because nothing outside the
        // page is in scope inside a `page.evaluate` body: the callback is serialised and runs with no
        // access to this module. The wrap width is `textWrapWidth` in `src/tools/text.ts` —
        // `rect.x2 - rect.x1 - TEXT_PADDING * 2` — read off the overlay's own BOX rather than its
        // `clientWidth`, because `clientWidth` is an integer and a one-document-pixel error in the
        // wrap width is exactly a word moving to the next line.
        const originalHeight = host.style.height;
        const fractions = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25];
        const collected: { wrapWidth: number; overlay: string[]; canvas: string[] }[] = [];
        for (const fraction of fractions) {
          host.style.width = `${draggedWidth * fraction}px`;
          host.style.height = `${Math.ceil(fontSize * 40)}px`;
          // Reading a rect forces the layout the measurement depends on, so the next call sees the
          // width just written rather than the one before it.
          const rect = host.getBoundingClientRect();
          const wrapWidth = rect.width / scale - 2 * 5;
          collected.push({
            wrapWidth,
            overlay: measuredLines(),
            canvas: module.layoutText(ctx, style, text, wrapWidth, rect.height / scale).lines,
          });
        }
        host.style.width = `${draggedWidth}px`;
        host.style.height = originalHeight;
        return collected;
      },
      {
        runSource: COLLAPSIBLE_RUN.source,
        endSource: COLLAPSIBLE_RUN_AT_END.source,
        startSource: COLLAPSIBLE_RUN_AT_START.source,
      }
    );

    // The sweep has to have swept. Every sample agrees vacuously if every sample is one line long,
    // which is what a string too short for the narrowest width would give, and which would make all
    // eleven comparisons below prove nothing about wrapping.
    const wrapped = samples.filter((sample) => sample.overlay.length > 2 && sample.canvas.length > 2);
    expect(
      wrapped.length,
      'the wrap-width sweep produced no multi-line sample, so nothing was compared'
    ).toBeGreaterThanOrEqual(4);
    const widths = samples.map((sample) => Math.round(sample.wrapWidth));
    expect(
      new Set(widths).size,
      `the sweep produced ${new Set(widths).size} distinct wrap widths out of ${widths.length} samples`
    ).toBe(widths.length);

    for (const sample of samples) {
      const at = `at a wrap width of ${Math.round(sample.wrapWidth)} document px`;
      // TWO INDEPENDENT SETS OF STRINGS, compared as strings. A LINE COUNT would pass on the wrong
      // strings, which is the entire failure this test exists to catch: two rules can produce the
      // same NUMBER of lines and break each one somewhere else, and it is the strings that disagree,
      // not the count. Sorted for a readable diff; the line ORDER is asserted separately below,
      // because a set cannot express it.
      expect(
        [...new Set(sample.overlay)].sort(),
        `the overlay wrapped the text at different lines than layoutText ${at}\n  overlay: ${JSON.stringify(
          sample.overlay
        )}\n  layoutText: ${JSON.stringify(sample.canvas)}`
      ).toEqual([...new Set(sample.canvas)].sort());
      expect(
        sample.overlay,
        `the overlay's lines are right but in the wrong order ${at}\n  overlay: ${JSON.stringify(
          sample.overlay
        )}\n  layoutText: ${JSON.stringify(sample.canvas)}`
      ).toEqual(sample.canvas);
    }
  });

  /**
   * The keypad Enter key (`code: 'NumpadEnter'`) commits, while the main Enter
   * (`code: 'Enter'`) inserts a line break. The two share `key: 'Enter'`, and the
   * app distinguishes them solely by `event.nativeEvent.code`, which is the
   * browser's only way to tell them apart — both report the same `key` and `keyCode`.
   *
   * This is a SEPARATE test from `Control+Enter commits` and `Escape commits`:
   * one `it` per commit key is what says each is wired. A regression that removed the
   * `NumpadEnter` arm would leave Escape and Control+Enter committing and the test
   * green.
   *
   * Adobe's rule is stated in `TextEditOverlay`: "Press the Enter key on the numeric
   * keypad" commits, and the main Enter "begins a new line".
   */
  test('the numeric keypad Enter commits the draft', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const commit = page.getByRole('button', { name: 'Commit', exact: true });
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('Kept');

    // NumpadEnter, not Enter: `page.keyboard.press('NumpadEnter')` sends an event
    // with `code: 'NumpadEnter'` and `key: 'Enter'`, which the handler splits on.
    await page.keyboard.press('NumpadEnter');

    // Three pieces of evidence: the overlay is unmounted, a layer exists, and it is
    // a text layer. An empty text layer passes the first two and fails the third.
    await expect(overlay(page), 'the draft outlived the numeric keypad Enter').toHaveCount(0);
    await expect(commit, 'Commit is still mounted after the draft was committed').toHaveCount(0);
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a text layer').toHaveText(
      /^text \d+$/
    );
  });

  /**
   * Switching tools commits the open draft: `goToTool` calls `commitDirtyTool()`
   * before dispatching the new tool, and `commitDirtyTool`'s text arm creates a layer
   * for any non-empty, non-placeholder draft.
   *
   * This is the IMPLICIT commit path — the draft is committed by an action other than
   * the Commit button, Escape, Control+Enter, or a canvas click elsewhere. It is
   * distinct from `a click elsewhere on the canvas COMMITS the open draft` because
   * that test commits a point box through the rect overlay's pointer-up handler,
   * while this test commits through the tool-bar's `goToTool` path. A regression
   * that broke only the pointer-up commit would leave this passing, and vice versa.
   */
  test('switching tools commits the open draft', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('ToolSwitch');
    await expect(layerRows, 'the open draft is not a layer yet').toHaveCount(1);

    // Switch to the Draw tool. `clickToolButton` resolves the tile through the
    // overflow flyout if the rail does not fit it, and `goToTool('draw')` calls
    // `commitDirtyTool()` before the dispatch — so the draft is committed by the
    // switch, not discarded.
    await clickToolButton(page, 'draw');

    await expect(overlay(page), 'the draft outlived the tool switch').toHaveCount(0);
    await expect(layerRows, 'the tool switch did not commit the draft').toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a text layer').toHaveText(
      /^text \d+$/
    );
  });

  /**
   * Undo removes a committed text layer and redo restores it.
   *
   * The Layers panel row count is the primary assertion — the panel shows a layer's
   * NAME, never its text. But for THIS test the row count is the claim: one undo
   * removes the layer the user just committed, and one redo brings it back. A history
   * cursor that is off by one in either direction would leave the count unchanged or
   * wrong, and the two assertions together pin the forward and back edges of the
   * text layer's history entry.
   */
  test('undo removes a committed text layer and redo restores it', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, CARET_CLICK);
    await expect(overlay(page)).toBeVisible();
    await page.keyboard.type('UndoRedo');
    await page.keyboard.press('Escape');

    // The commit that undo will remove.
    await expect(overlay(page), 'the draft outlived its commit').toHaveCount(0);
    await expect(layerRows, 'the text was not committed').toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the committed layer is not a text layer').toHaveText(
      /^text \d+$/
    );

    // Undo removes the layer created by the commit above.
    const undo = getUndoButton(page);
    await expect(undo, 'undo is unavailable after a commit').toBeEnabled();
    await undo.click();
    await expect(layerRows, 'undo did not remove the text layer').toHaveCount(1);
    await expect(getRedoButton(page), 'redo is unavailable after an undo').toBeEnabled();

    // Redo restores it.
    await getRedoButton(page).click();
    await expect(layerRows, 'redo did not restore the text layer').toHaveCount(2);
    await expect(layerRows.nth(0).getByTestId('layer-name'), 'the restored layer is not a text layer').toHaveText(
      /^text \d+$/
    );
  });
});

test.describe('Canvas Type-tool re-entry', () => {
  test.describe.configure({ timeout: TEXT_EDIT_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectTextTool(page);
    await setTextToolColor(page, TEXT_COLOR);
  });

  test('the Type tool re-enters the original layer at the clicked glyph insertion point', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await page.keyboard.type(CANVAS_REENTRY_TEXT);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows).toHaveCount(2);
    const committedLayerCount = await layerRows.count();

    const glyphPoint = await committedInkPoint(page, box);
    const inkBounds = await inkBoundsIn(page, {
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    });
    expect(inkBounds, 'the committed layer has no measurable text bounds').not.toBeNull();
    expect(glyphPoint.x).toBeGreaterThanOrEqual(inkBounds!.left);
    expect(glyphPoint.x).toBeLessThanOrEqual(inkBounds!.right);
    expect(glyphPoint.y).toBeGreaterThanOrEqual(inkBounds!.top);
    expect(glyphPoint.y).toBeLessThanOrEqual(inkBounds!.bottom);

    await page.mouse.click(glyphPoint.x, glyphPoint.y);
    await expect(overlay(page), 'clicking committed glyph ink did not reopen the Type editor').toBeVisible();
    expect(await overlayText(page)).toBe(CANVAS_REENTRY_TEXT);
    const expectedCaret = await browserCaretIndexAtPoint(page, glyphPoint);
    expect(expectedCaret, 'the browser could not resolve an insertion point at the measured glyph').not.toBeNull();
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    expect(selection.collapsed, 'canvas re-entry selected text instead of placing an insertion point').toBe(true);
    expect(selection.caretIndex).toBe(expectedCaret);

    const editedText = `${CANVAS_REENTRY_TEXT.slice(0, expectedCaret!)}X${CANVAS_REENTRY_TEXT.slice(expectedCaret!)}`;
    await page.keyboard.type('X');
    expect(await overlayText(page)).toBe(editedText);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows, 're-entry created a duplicate committed text layer').toHaveCount(committedLayerCount);

    const editedGlyphPoint = await committedInkPoint(page, box);
    await page.mouse.click(editedGlyphPoint.x, editedGlyphPoint.y);
    await expect(overlay(page)).toBeVisible();
    expect(await overlayText(page), 'the edit did not survive commit on the original layer').toBe(editedText);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows).toHaveCount(committedLayerCount);
  });
});

test.describe('Tablet Type-tool touch re-entry', () => {
  test.use({
    viewport: { width: 834, height: 1194 },
    hasTouch: true,
    isMobile: false,
  });
  test.describe.configure({ timeout: TEXT_EDIT_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await page.getByTestId('right-panel-toggle').click();
    await selectTextTool(page);
    await setTextToolColor(page, TEXT_COLOR);
  });

  test('a tablet touch tap at measured committed glyph ink re-enters the original layer', async ({ page }) => {
    const layerRows = page.getByTitle('Drag to reorder');
    const box = await canvasBox(page);

    await clickToPlace(page, box, FIRST_BOX_CLICK);
    await page.keyboard.type('Tablet touch route');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows).toHaveCount(2);
    const committedLayerCount = await layerRows.count();

    const touchPoint = await committedInkPoint(page, box);
    expect(touchPoint.x).toBeGreaterThanOrEqual(box.x);
    expect(touchPoint.x).toBeLessThanOrEqual(box.x + box.width);
    expect(touchPoint.y).toBeGreaterThanOrEqual(box.y);
    expect(touchPoint.y).toBeLessThanOrEqual(box.y + box.height);

    await page.touchscreen.tap(touchPoint.x, touchPoint.y);
    await expect(overlay(page), 'a measured tablet glyph tap did not enter Type edit mode').toBeVisible();
    await expect(overlay(page)).toBeFocused();
    expect(await overlayText(page)).toBe('Tablet touch route');
    const expectedCaret = await browserCaretIndexAtPoint(page, touchPoint);
    expect(expectedCaret, 'the browser could not resolve a caret at the measured touch point').not.toBeNull();
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    expect(selection.collapsed, 'tablet re-entry selected text instead of placing an insertion point').toBe(true);
    expect(selection.caretIndex).toBe(expectedCaret);
    await expect(layerRows, 'touch re-entry created a duplicate committed text layer').toHaveCount(committedLayerCount);

    const editedText = 'Tablet touch edited';
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(editedText);
    expect(await overlayText(page)).toBe(editedText);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows, 'committing the touch edit duplicated the text layer').toHaveCount(committedLayerCount);

    const editedTouchPoint = await committedInkPoint(page, box);
    await page.touchscreen.tap(editedTouchPoint.x, editedTouchPoint.y);
    await expect(overlay(page)).toBeVisible();
    expect(await overlayText(page), 'the touch edit did not survive commit on the original layer').toBe(editedText);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    await expect(layerRows).toHaveCount(committedLayerCount);
  });
});

test.describe('Desktop Type click-count selection', () => {
  test.describe.configure({ timeout: TEXT_EDIT_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectTextTool(page);

    const fit = await readFit(page);
    expect(CLICK_LADDER_RECT.x1).toBeGreaterThanOrEqual(0);
    expect(CLICK_LADDER_RECT.y1).toBeGreaterThanOrEqual(0);
    expect(CLICK_LADDER_RECT.x2).toBeLessThanOrEqual(fit.documentWidth);
    expect(CLICK_LADDER_RECT.y2).toBeLessThanOrEqual(fit.documentHeight);

    const box = await canvasBox(page);
    await dragToPlace(page, box, CLICK_LADDER_RECT);
    await expect(overlay(page)).toHaveAttribute('data-text-kind', 'paragraph');
    await page.keyboard.insertText(CLICK_LADDER_TEXT);
    expect(await overlayText(page)).toBe(CLICK_LADDER_TEXT);
    const visualLine = await overlayVisualLineAtText(page, 'gamma');
    expect(visualLine.lineCount, 'the paragraph fixture did not wrap into multiple visual lines').toBeGreaterThan(1);
    expect(
      await overlayTextFitsFrame(page, box),
      'the click-count fixture has glyphs outside its paragraph frame or document canvas'
    ).toBe(true);

    await page.keyboard.press('Escape');
    await expect(overlay(page)).toHaveCount(0);
    const layerRows = page.getByTitle('Drag to reorder');
    await expect(layerRows).toHaveCount(2);
    await layerRows.nth(0).dblclick();
    await expect(overlay(page)).toBeVisible();
    expect(await overlayText(page)).toBe(CLICK_LADDER_TEXT);
    expect(
      await overlayTextFitsFrame(page, box),
      'the committed click-count fixture no longer fits its paragraph frame'
    ).toBe(true);
  });

  test('double-click selects the word at the measured glyph point', async ({ page }) => {
    const point = await overlayPositionForText(page, 'gamma');
    await overlay(page).click({ clickCount: 2, position: point });
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    // Native word selection may include the one collapsed separator under `pre-line`, but no
    // additional text or whitespace is allowed.
    expect(selection.string).toMatch(/^gamma ?$/);
  });

  test('triple-click selects only the visual line in a wrapped paragraph', async ({ page }) => {
    const visualLine = await overlayVisualLineAtText(page, 'gamma');
    expect(visualLine.lineCount).toBeGreaterThan(1);
    const point = await overlayPositionForText(page, 'gamma');
    await overlay(page).click({ clickCount: 3, position: point });
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    expect(selection.string.trim()).toBe(visualLine.line);
    expect(selection.string.trim()).not.toBe(CLICK_LADDER_TEXT);
  });

  test('quadruple-click selects the whole wrapped paragraph, not just its visual line', async ({ page }) => {
    const visualLine = await overlayVisualLineAtText(page, 'gamma');
    expect(visualLine.lineCount).toBeGreaterThan(1);
    const point = await overlayPositionForText(page, 'gamma');
    await overlay(page).click({ clickCount: 4, position: point });
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    expect(selection.string.trim()).toBe(CLICK_LADDER_TEXT);
    expect(selection.string.trim()).not.toBe(visualLine.line);
  });

  test('quintuple-click selects every character in the wrapped type layer', async ({ page }) => {
    const point = await overlayPositionForText(page, 'gamma');
    await overlay(page).click({ clickCount: 5, position: point });
    const selection = await selectionState(page);
    expect(selection.inside).toBe(true);
    expect(selection.string).toBe(CLICK_LADDER_TEXT);
  });

  test('Control/Command+Shift+Arrow selects one word from a measured insertion point', async ({ page }) => {
    const point = await overlayPositionForText(page, 'gamma', 0);
    const bounds = await overlay(page).boundingBox();
    expect(bounds).not.toBeNull();
    const expectedCaret = await browserCaretIndexAtPoint(page, {
      x: bounds!.x + point.x,
      y: bounds!.y + point.y,
    });
    expect(expectedCaret).not.toBeNull();

    await overlay(page).click({ position: point });
    expect((await selectionState(page)).caretIndex).toBe(expectedCaret);
    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');

    const selection = await selectionState(page);
    expect(selection.string).toBe('gamma');
    expect(selection.anchorIndex).toBe(expectedCaret);
    expect(selection.focusIndex).toBe(expectedCaret! + 'gamma'.length);
  });
});
