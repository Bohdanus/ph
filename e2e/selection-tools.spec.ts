import { expect, type Page, test, type TestInfo } from '@playwright/test';
import {
  type BoundingBox,
  type BoundsResult,
  type ClipOptions,
  drawLine,
  getColorAtPoint,
  getSelectionBounds,
  getWorkspaceCanvas,
  hasRedPixels,
  type ImageDataResult,
  loadImageData,
  scanPixelsForBounds,
  type SelectionBounds,
  STROKE_ANALYSIS,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { hexToRgb, setForegroundColor } from './helpers/color-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import {
  clickToolButton,
  navigateAndSelectInFlyout,
  openToolFlyout,
  openToolFlyoutViaKeyboard,
  selectFromFlyout,
} from './helpers/toolbar-helpers';

/*
 * Gesture coordinates in this file are CANVAS-RELATIVE PAGE PIXELS, derived from the
 * workspace canvas box, and never document pixels. The document (800x600) is letterboxed
 * inside that box at whatever scale the viewport implies, and the scale changes with the
 * viewport, so a document coordinate baked in here would silently mean a different point on
 * another host. A page coordinate does not need the scale: the pointer handler converts it
 * with the same contain arithmetic the box was measured against.
 *
 * The two places that are genuinely in DOCUMENT space are named as such: the tool's own
 * `Fixed Size` Width/Height fields, which the implementation compares against document
 * pixels. Everywhere else, a capture's pixel space is reached through `toImagePoint`, which
 * derives its ratio from the DECODED image dimensions — never `devicePixelRatio`.
 */

/** Saturated red: far from the document's white, from the store's initial black, and from every other colour asserted on here, so a wrong answer is unmistakable. */
const KNOWN_RED = '#cc0000';
/** The store's initial foreground. A sampler that reported a transparent pixel as `0,0,0` would produce exactly this, which is what the transparent-pixel test watches for. */
const BLACK = '#000000';
/**
 * A foreground colour deliberately unlike everything the tests paint.
 *
 * The band in these tests is painted with `KNOWN_RED`, which SETS the foreground on the way
 * past — so with no sentinel the swatch already holds the expected answer before the
 * eyedropper is ever clicked, and "the eyedropper set the colour" would pass on a build where
 * it does nothing at all. The sentinel is what makes the change observable. Green is far from
 * the band, from the document's white, and from black, so a wrong answer is unmistakable.
 */
const SENTINEL_FOREGROUND = '#00ff00';
/** Per-channel agreement allowed between a colour this spec measured off a capture and the colour the app reported. The capture round-trip (document -> scaled display -> CDP png -> sharp) and one 8-bit rounding step are the only error sources over a flat interior, and every plausible wrong answer here is more than 100 away on at least one channel. */
const COLOR_CHANNEL_TOLERANCE = 6;
/** How long a negative assertion samples before concluding "never". Every "must not happen" claim in this file is a poll window, not an instant: a commit that is about to be dispatched has not been at the instant after the gesture. */
const NEGATIVE_WINDOW_MS = 1_200;
const NEGATIVE_POLL_MS = 120;
/** Client-side margin added around a small capture so a sample at its exact centre is never on the clip edge, and a 1px capture rounding cannot reach it. */
const PROBE_CLIP_PX = 16;
/** Draw-tool brush width for the specs that need a fat, flat interior to sample and to grow a region from. */
const DRAW_BRUSH_SIZE = 40;
/** The draw tool's default opacity is 0.9, which composites the stroke over the white bedrock; at 1.0 the layer raster and the composite are the same RGB, so a sampled pixel and a sampled layer pixel are the same colour. */
const DRAW_OPACITY = 1;
/** Marquee drag, in canvas-relative page pixels: a 2:1 box, so a locked ratio and a circle constraint are both visibly different from it. */
const MARQUEE_DRAG_LEFT = 0.43;
const MARQUEE_DRAG_TOP = 0.3;
const MARQUEE_DRAG_WIDTH_FRACTION = 0.22;
const MARQUEE_DRAG_HEIGHT_RATIO = 0.5;
/** The lock `Fixed Ratio` is set to for the aspect test. Deliberately neither 1 nor 2:1, so a bar that ignored the field, or a hardcoded square, both fail. */
const FIXED_RATIO_VALUE = '1.5';
/** `Fixed Size` field values in DOCUMENT pixels, which is the space `resolveEllipseRect` reads them in. Deliberately about half the drag's size, so a committed ellipse of the drag's size is distinguishable from one of the fixed size, and still large enough for its outline to be detected. */
const FIXED_SIZE_WIDTH = '90';
const FIXED_SIZE_HEIGHT = '45';
/** Clip margin around a marquee drag. It has to cover what a fixed-size ellipse adds around the press point (half its width) and what a circle constraint adds below the drag, or the capture clips the very outline the assertions read. */
const MARQUEE_CLIP_MARGIN_PX = 110;
/** Tolerance when matching a committed outline's bounding box against a rectangle this spec computed in page pixels. The tessellated ellipse's extreme vertices sit exactly on the rectangle, and only the 2px stroke straddling the path extends past them, by about one pixel. */
const OUTLINE_BOUNDS_TOLERANCE_PX = 5;
/** Radius, in capture pixels, of the window scanned for selection-coloured pixels when testing whether an outline passes through a point. The committed outline is DASHED (6 on, 4 off in document pixels, about a 12px period once the document is scaled into the canvas box), so a window narrower than one period can land entirely in a gap and report a missing outline for geometry that is correct. Nine pixels either side spans more than a period. Nine is still nowhere near the ~200px gap between a drag rectangle's corner and the ellipse inscribed in it, so the negative half of the same probe is unaffected. */
const OUTLINE_PROBE_RADIUS_PX = 9;
/** A band is a painted region of `KNOWN_RED`; the predicate is deliberately loose so antialiased edge pixels count as band, which makes the containment assertion below run in the safe direction. */
const isBandPixel = (red: number, green: number, blue: number, alpha: number) =>
  alpha !== 0 && red > green + 30 && red > blue + 30;
/** The same predicate `getSelectionBounds` uses by default, so "a selection pixel" means one thing in this file. */
const isSelectionPixel = (red: number, green: number, blue: number, alpha: number) =>
  alpha !== 0 &&
  red <= STROKE_ANALYSIS.SELECTION_RED_MAX &&
  green >= STROKE_ANALYSIS.SELECTION_GREEN_MIN &&
  blue >= STROKE_ANALYSIS.SELECTION_BLUE_MIN;

type PageRect = { left: number; top: number; width: number; height: number };

/** A page point, for the mouse. */
type PagePoint = { x: number; y: number };

/** Puts the window back at the top of the document. */
async function scrollToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * The workspace canvas box, measured at a known scroll position.
 *
 * The app is taller than Playwright's 720px default window, so the WINDOW scrolls, and
 * `boundingBox()` is viewport-relative: every `fill()` on a colour or slider input scrolls
 * its element into view first, and the sidebar's colour pickers sit near the bottom of a
 * tall page. A box measured before such an interaction describes a point 440px above where
 * the canvas actually is, and a drag built from it lands on the header — silently, with no
 * error anywhere. Scrolling to a fixed position first makes the box a function of the layout
 * rather than of the interaction history, and every other measurement here assumes scroll 0.
 *
 * This is also the OPEN_PROBLEMS re-measure rule, for the same reason: the options panel
 * lands in the toolbar row and the canvas box is only valid after it has settled.
 */
async function measureCanvas(page: Page): Promise<BoundingBox> {
  await scrollToTop(page);
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('the workspace canvas has no box');
  return box;
}

/** Canvas-relative page pixels, converted to an absolute page point. */
function inCanvas(box: BoundingBox, rect: PageRect): PageRect {
  return { left: box.x + rect.left, top: box.y + rect.top, width: rect.width, height: rect.height };
}

/**
 * A capture clip, in absolute page pixels, around a canvas-relative rectangle.
 *
 * `page.screenshot({ clip })` only reliably covers what is inside the viewport, and the
 * workspace canvas is taller than the viewport in the default Playwright window, so a clip
 * spanning the whole canvas box would be reading outside the rendered page. Every clip here
 * is therefore built from a rectangle this spec chose to be in view, not from the box.
 */
function clipAround(box: BoundingBox, rect: PageRect, margin: number): Required<ClipOptions> {
  const absolute = inCanvas(box, rect);
  const left = Math.round(absolute.left - margin);
  const top = Math.round(absolute.top - margin);
  return {
    x: left,
    y: top,
    width: Math.round(absolute.width + margin * 2),
    height: Math.round(absolute.height + margin * 2),
  };
}

const clipCorners = (clip: Required<ClipOptions>) => ({
  left: clip.x,
  right: clip.x + clip.width - 1,
  top: clip.y,
  bottom: clip.y + clip.height - 1,
});

/**
 * A capture clip over the whole VISIBLE part of the workspace canvas.
 *
 * The canvas is taller than Playwright's viewport, so a clip spanning the whole box reaches
 * past the rendered page; this truncates at the viewport instead. Both readings a quick
 * selection test needs — the painted band and the committed region — come out of ONE such
 * capture, and it is wide enough that a region which grew out of the band is read at its
 * real size and fails a containment assertion with numbers, rather than falling outside the
 * capture and being reported as a missing outline after a ten-second timeout.
 */
async function visibleCanvasClip(page: Page, box: BoundingBox): Promise<Required<ClipOptions>> {
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(Math.max(0, Math.min(box.height, viewportHeight - box.y))),
  };
}

/**
 * Converts an ABSOLUTE page point into a capture's own pixel space.
 *
 * `image.width / clip.width` is the capture's scale, and the ratio comes from the decoded
 * image dimensions rather than from `devicePixelRatio`: capture scale and rounding break that
 * assumption, which is the single rule `screenshot-scale.ts` exists to enforce. The clip
 * origin is subtracted first, so a caller can hand over a page coordinate it already has
 * (a canvas-box measurement) without having to re-derive where the capture started.
 */
function toImagePoint(
  image: { width: number; height: number },
  clip: Required<ClipOptions>,
  pagePoint: PagePoint
): PagePoint {
  return {
    x: ((pagePoint.x - clip.x) * image.width) / clip.width,
    y: ((pagePoint.y - clip.y) * image.height) / clip.height,
  };
}

type Channels = { red: number; green: number; blue: number };

const channelsFromHex = (hex: string): Channels => {
  const { r, g, b } = hexToRgb(hex);
  return { red: r, green: g, blue: b };
};

/** Largest absolute per-channel difference between two colours. */
function channelDelta(measured: Channels, reference: Channels): number {
  return Math.max(
    Math.abs(measured.red - reference.red),
    Math.abs(measured.green - reference.green),
    Math.abs(measured.blue - reference.blue)
  );
}

/**
 * Samples a predicate repeatedly and reports whether it was EVER true.
 *
 * `expect.poll` returns on the first match, so it can express "this happened" and never
 * "this never happened" — and every negative assertion here is the second shape: a gesture
 * that must not commit, a swatch that must not fall back to black. A single instant read
 * would pass on a run where the event had not been dispatched yet.
 */
async function neverHappened(page: Page, read: () => Promise<boolean>, windowMs: number): Promise<boolean> {
  const deadline = Date.now() + windowMs;
  for (;;) {
    if (await read()) return false;
    if (Date.now() >= deadline) return true;
    await page.waitForTimeout(NEGATIVE_POLL_MS);
  }
}

/** Presses, drags and releases on the canvas, optionally with modifier keys held throughout. */
async function dragOnCanvas(
  page: Page,
  from: PagePoint,
  to: PagePoint,
  { steps = 1, modifiers = [] as ('Shift' | 'Alt')[] } = {}
): Promise<void> {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
}

const marqueeRect = (box: BoundingBox): PageRect => {
  const width = Math.round(box.width * MARQUEE_DRAG_WIDTH_FRACTION);
  return {
    left: Math.round(box.width * MARQUEE_DRAG_LEFT),
    top: Math.round(box.height * MARQUEE_DRAG_TOP),
    width,
    height: Math.round(width * MARQUEE_DRAG_HEIGHT_RATIO),
  };
};

const marqueeTopLeft = (box: BoundingBox, rect: PageRect): PagePoint => {
  const absolute = inCanvas(box, rect);
  return { x: absolute.left, y: absolute.top };
};
const marqueeBottomRight = (box: BoundingBox, rect: PageRect): PagePoint => {
  const absolute = inCanvas(box, rect);
  return { x: absolute.left + rect.width, y: absolute.top + rect.height };
};

/** The drag's outline, read from `clip` and converted to absolute page-pixel bounds. */
async function readOutline(
  page: Page,
  testInfo: TestInfo,
  name: string,
  clip: Required<ClipOptions>
): Promise<SelectionBounds | null> {
  await scrollToTop(page);
  const bounds = await getSelectionBounds(await captureCanvasScreenshot(page, clip, testInfo, name));
  if (!bounds) return null;
  const corners = clipCorners(clip);
  return {
    ...bounds,
    left: corners.left + (bounds.left * clip.width) / bounds.imageWidth,
    right: corners.left + (bounds.right * clip.width) / bounds.imageWidth,
    top: corners.top + (bounds.top * clip.height) / bounds.imageHeight,
    bottom: corners.top + (bounds.bottom * clip.height) / bounds.imageHeight,
  };
}

const outlineWidth = (bounds: SelectionBounds) => bounds.right - bounds.left;
const outlineHeight = (bounds: SelectionBounds) => bounds.bottom - bounds.top;
const outlineAspect = (bounds: SelectionBounds) => outlineWidth(bounds) / outlineHeight(bounds);
const outlineCenter = (bounds: SelectionBounds): PagePoint => ({
  x: (bounds.left + bounds.right) / 2,
  y: (bounds.top + bounds.bottom) / 2,
});

/** Waits for a selection outline to reach the backing store inside `clip`. */
async function waitForOutline(page: Page, clip: Required<ClipOptions>): Promise<void> {
  await scrollToTop(page);
  await waitForCanvasPixels(page, clip, async (shot) => (await getSelectionBounds(shot)) !== null, {
    description: 'a selection outline',
  });
}

const outlineExists = async (page: Page, clip: Required<ClipOptions>) => {
  await scrollToTop(page);
  return (await getSelectionBounds(await page.screenshot({ clip }))) !== null;
};

/** Whether any selection-coloured pixel lies within `radius` capture pixels of a clip-relative point. */
async function hasSelectionPixelNear(
  image: ImageDataResult,
  pointX: number,
  pointY: number,
  radius: number
): Promise<boolean> {
  for (let y = pointY - radius; y <= pointY + radius; y++) {
    for (let x = pointX - radius; x <= pointX + radius; x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const index = (y * image.width + x) * 4;
      if (isSelectionPixel(image.data[index], image.data[index + 1], image.data[index + 2], image.data[index + 3]))
        return true;
    }
  }
  return false;
}

const marqueeBar = (page: Page) => page.getByRole('combobox', { name: 'Style' });
const quickSelectionBar = (page: Page) => page.getByRole('slider', { name: 'Size', exact: true });

async function selectEllipticalMarqueeFromSidebar(page: Page): Promise<void> {
  await openToolFlyout(page, 'rectangular-selection');
  await selectFromFlyout(page, { toolName: 'elliptical-selection', label: 'Elliptical Marquee Tool' });
  await expect(marqueeBar(page)).toBeVisible();
}

async function selectQuickSelectionFromSidebar(page: Page): Promise<void> {
  await openToolFlyout(page, 'magic-wand');
  await selectFromFlyout(page, { toolName: 'quick-selection', label: 'Quick Selection Tool' });
  await expect(quickSelectionBar(page)).toBeVisible();
}

/**
 * Paints a horizontal `KNOWN_RED` band and returns the canvas-relative rectangle it should
 * occupy, so a caller can place a later gesture on the measured band rather than on the
 * rectangle it hoped for.
 */
async function paintRedBand(page: Page): Promise<PageRect> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, KNOWN_RED, true);
  // Both sliders are filled before the box is measured: a `fill()` scrolls its input into
  // view, so measuring in between would capture a scrolled, stale box.
  await page.getByRole('slider', { name: /^Opacity/ }).fill(String(DRAW_OPACITY));
  await page.getByRole('slider', { name: /^Size/ }).fill(String(DRAW_BRUSH_SIZE));
  const drawBox = await measureCanvas(page);
  const rect: PageRect = {
    left: Math.round(drawBox.width * 0.35),
    top: Math.round(drawBox.height * 0.36),
    width: Math.round(drawBox.width * 0.3),
    height: 0,
  };
  await drawLine(page, drawBox, rect.left, rect.top, rect.left + rect.width, rect.top, { steps: 12 });
  // The clip only has to contain the band for the redraw wait; its extent is what the
  // measured band bounds are compared against, and an undersized clip would cut the ends off.
  const clip = clipAround(drawBox, { ...rect, height: DRAW_BRUSH_SIZE }, 40);
  await waitForCanvasPixels(page, clip, hasRedPixels, { description: 'the red band' });
  return { ...rect, height: DRAW_BRUSH_SIZE };
}

/** Draws a diagonal band, whose layer bounding box then has transparent interior corners to sample. */
async function paintRedDiagonal(page: Page): Promise<PageRect> {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, KNOWN_RED, true);
  await page.getByRole('slider', { name: /^Opacity/ }).fill(String(DRAW_OPACITY));
  const drawBox = await measureCanvas(page);
  const start = { left: Math.round(drawBox.width * 0.3), top: Math.round(drawBox.height * 0.28) };
  const reach = Math.round(Math.min(drawBox.width, drawBox.height) * 0.18);
  await drawLine(page, drawBox, start.left, start.top, start.left + reach, start.top + reach, { steps: 12 });
  const rect = { left: start.left, top: start.top, width: reach, height: reach };
  const clip = clipAround(drawBox, rect, 40);
  await waitForCanvasPixels(page, clip, hasRedPixels, { description: 'the red diagonal' });
  return rect;
}

const bandBoundsIn = async (image: ImageDataResult): Promise<BoundsResult> => scanPixelsForBounds(image, isBandPixel);

async function foregroundHex(page: Page): Promise<string> {
  return page.getByTestId('foreground-color-input').inputValue();
}

/** The colour of one capture pixel, read through the shared `getColorAtPoint` sampler. */
async function pixelColourAt(image: ImageDataResult, x: number, y: number): Promise<Channels | null> {
  return getColorAtPoint(image, x, y, 0);
}

test.describe('Eyedropper', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('the eyedropper sets the foreground to the colour of the pixel under the click', async ({ page }, testInfo) => {
    const band = await paintRedBand(page);
    const bandBox = await measureCanvas(page);
    const probe = {
      x: bandBox.x + band.left + band.width / 2,
      y: bandBox.y + band.top,
    };

    // The colour the eyedropper is expected to report is MEASURED here, not assumed: the
    // band is sampled off a capture, so the later assertion compares the app's answer
    // against an independent reading of the same pixel rather than against a constant this
    // spec wrote down.
    const probeClip = {
      x: Math.round(probe.x - PROBE_CLIP_PX),
      y: Math.round(probe.y - PROBE_CLIP_PX),
      width: PROBE_CLIP_PX * 2,
      height: PROBE_CLIP_PX * 2,
    };
    await waitForCanvasPixels(page, probeClip, hasRedPixels, { description: 'the red band under the probe' });
    const image = await loadImageData(await captureCanvasScreenshot(page, probeClip, testInfo, 'eyedropper-source'));
    const probeImagePoint = toImagePoint(image, probeClip, probe);
    const measured = await pixelColourAt(image, Math.round(probeImagePoint.x), Math.round(probeImagePoint.y));
    expect.soft(measured, 'the painted band should be readable at the probe point').not.toBeNull();
    expect
      .soft(
        channelDelta(measured!, channelsFromHex(KNOWN_RED)) <= COLOR_CHANNEL_TOLERANCE,
        `measured ${JSON.stringify(measured)} should be within ${COLOR_CHANNEL_TOLERANCE} per channel of ${KNOWN_RED}`
      )
      .toBe(true);

    await clickToolButton(page, 'eyedropper');
    // The eyedropper's bar is a real panel, not the `PlaceholderTool` the other unimplemented
    // tools render, so the signal that the tool is active is its own Sample Size select.
    await expect(page.getByRole('combobox', { name: 'Sample Size' })).toBeVisible();
    // Put a colour on the swatch that the band cannot produce, so a later read of the
    // band colour is evidence the click did something rather than a restatement of the
    // colour the band was painted with.
    await setForegroundColor(page, SENTINEL_FOREGROUND, true);
    await page.mouse.click(probe.x, probe.y);

    const reported = await foregroundHex(page);
    const reportedColour = channelsFromHex(reported);
    expect.soft(reported, 'the eyedropper should have moved the swatch off the sentinel').not.toBe(SENTINEL_FOREGROUND);
    expect
      .soft(
        channelDelta(reportedColour, channelsFromHex(KNOWN_RED)) <= COLOR_CHANNEL_TOLERANCE,
        `foreground ${reported} should be within ${COLOR_CHANNEL_TOLERANCE} per channel of ${KNOWN_RED}`
      )
      .toBe(true);
    expect
      .soft(
        channelDelta(reportedColour, measured!) <= COLOR_CHANNEL_TOLERANCE,
        `foreground ${reported} should match the independently measured ${JSON.stringify(measured)}`
      )
      .toBe(true);
  });

  test('the eyedropper samples the composite, so a transparent part of the draw layer reads through to the base', async ({
    page,
  }) => {
    const diagonal = await paintRedDiagonal(page);
    const bandBox = await measureCanvas(page);
    const inside = inCanvas(bandBox, diagonal);
    const centre = { x: inside.left + inside.width / 2, y: inside.top + inside.height / 2 };
    // The draw tool's layer is a tight bounding box around the stroke, so a point just inside the
    // box's top-right corner is inside the LAYER and far off the stroke.
    const transparent = { x: inside.left + inside.width - 3, y: inside.top + 3 };

    await clickToolButton(page, 'eyedropper');
    await expect(page.getByRole('combobox', { name: 'Sample Size' })).toBeVisible();

    // The composited canvas is what the eyedropper reads, and the document's bedrock layer is
    // opaque, so there is no fully transparent composite pixel to sample anywhere in this app
    // today. This test used to assert the opposite — that a click there changes nothing — which
    // is only true of an eyedropper that samples the ACTIVE LAYER. The production one samples the
    // composite, which is Photoshop's default (`Sample: All Layers`), and there is no
    // hide-layer control with which to build a transparent composite in the first place.
    //
    // What IS reachable, and what this pins now: the click samples whatever the user can
    // actually see at that point. The stale-sentinel and the store's black initial value are both
    // excluded, because either would mean the tool reported a colour it did not read.
    await setForegroundColor(page, SENTINEL_FOREGROUND, true);
    await page.mouse.click(centre.x, centre.y);
    await expect
      .poll(async () => (await foregroundHex(page)) === KNOWN_RED, {
        message: 'the opaque sample should set the foreground off the sentinel',
      })
      .toBe(true);

    await setForegroundColor(page, SENTINEL_FOREGROUND, true);
    await page.mouse.click(transparent.x, transparent.y);
    await expect
      .poll(async () => (await foregroundHex(page)) !== SENTINEL_FOREGROUND, {
        message: 'the composite sample should read through the transparent part of the draw layer',
      })
      .toBe(true);
    expect(await foregroundHex(page)).not.toBe(BLACK);

    // The guard that a truly transparent composite would need — `EyedropperToolArea` reads the
    // sampled pixel's alpha and dispatches nothing when it is 0 — cannot be reached through this
    // UI, because no control makes the composite transparent. It is pinned directly instead, by
    // `src/components/Main/__tests__/EyedropperToolArea.test.tsx`, which builds a transparent
    // pixel in the fixture and asserts no `SET_COLOR` is dispatched.
  });

  test('the eyedropper is reachable with the I shortcut', async ({ page }) => {
    await page.keyboard.press('i');
    // The eyedropper's bar is a real panel, not the `PlaceholderTool` the other unimplemented
    // tools render, so the signal that the tool is active is its own Sample Size select.
    await expect(page.getByRole('combobox', { name: 'Sample Size' })).toBeVisible();
  });

  test('the eyedropper is reachable from its own sidebar tile', async ({ page }) => {
    await expect(page.getByTestId('tool-button-eyedropper')).toBeVisible();
    await clickToolButton(page, 'eyedropper');
    // The eyedropper's bar is a real panel, not the `PlaceholderTool` the other unimplemented
    // tools render, so the signal that the tool is active is its own Sample Size select.
    await expect(page.getByRole('combobox', { name: 'Sample Size' })).toBeVisible();
  });
});

test.describe('Elliptical marquee', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('an elliptical marquee drag commits exactly one selection', async ({ page }) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);

    // Many pointer moves, because "one commit per gesture" is only a claim if the drag is
    // long enough that a per-move commit would have left several entries behind.
    await dragOnCanvas(page, marqueeTopLeft(box, rect), marqueeBottomRight(box, rect), { steps: 20 });
    await waitForOutline(page, clip);
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    await page.getByTestId('undo-button').click();
    expect
      .soft(
        await neverHappened(page, () => outlineExists(page, clip), NEGATIVE_WINDOW_MS),
        'one undo must remove the whole selection, which it cannot if the drag committed per pointer move'
      )
      .toBe(true);
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('the committed elliptical marquee is an ellipse inscribed in the drag, not the drag itself', async ({
    page,
  }, testInfo) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);

    await dragOnCanvas(page, marqueeTopLeft(box, rect), marqueeBottomRight(box, rect), { steps: 12 });
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'elliptical-inscribed', clip);
    expect.soft(outline, 'the drag should have committed an outline').not.toBeNull();

    const image = await loadImageData(
      await captureCanvasScreenshot(page, clip, testInfo, 'elliptical-inscribed-pixels')
    );
    const scaleX = image.width / clip.width;
    const scaleY = image.height / clip.height;
    const absolute = inCanvas(box, rect);
    const tolerance = OUTLINE_BOUNDS_TOLERANCE_PX * Math.max(scaleX, scaleY);

    // Inscribed: every extreme vertex of the tessellated ellipse sits on the drag rectangle.
    expect.soft(Math.abs(outline!.left - absolute.left) <= tolerance, 'outline left').toBe(true);
    expect.soft(Math.abs(outline!.top - absolute.top) <= tolerance, 'outline top').toBe(true);
    expect.soft(Math.abs(outline!.right - (absolute.left + rect.width)) <= tolerance, 'outline right').toBe(true);
    expect.soft(Math.abs(outline!.bottom - (absolute.top + rect.height)) <= tolerance, 'outline bottom').toBe(true);

    // Round, not rectangular: an axis-aligned rectangle outline of the same box would put
    // selection pixels in all four corners, and an inscribed ellipse puts none there while
    // still passing through the middle of all four edges.
    const cornerInImage = toImagePoint(image, clip, { x: absolute.left, y: absolute.top });
    const leftEdgeInImage = toImagePoint(image, clip, { x: absolute.left, y: absolute.top + rect.height / 2 });
    const topEdgeInImage = toImagePoint(image, clip, { x: absolute.left + rect.width / 2, y: absolute.top });
    expect
      .soft(
        await hasSelectionPixelNear(
          image,
          Math.round(cornerInImage.x),
          Math.round(cornerInImage.y),
          OUTLINE_PROBE_RADIUS_PX
        ),
        'the drag rectangle corner should be outside an inscribed ellipse'
      )
      .toBe(false);
    expect
      .soft(
        await hasSelectionPixelNear(
          image,
          Math.round(leftEdgeInImage.x),
          Math.round(leftEdgeInImage.y),
          OUTLINE_PROBE_RADIUS_PX
        ),
        'the middle of the drag rectangle left edge should be on the ellipse'
      )
      .toBe(true);
    expect
      .soft(
        await hasSelectionPixelNear(
          image,
          Math.round(topEdgeInImage.x),
          Math.round(topEdgeInImage.y),
          OUTLINE_PROBE_RADIUS_PX
        ),
        'the middle of the drag rectangle top edge should be on the ellipse'
      )
      .toBe(true);
  });

  test('the Style select swaps which fields the elliptical marquee bar renders', async ({ page }) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const style = marqueeBar(page);
    const ratio = page.getByRole('spinbutton', { name: 'Ratio' });
    const width = page.getByRole('spinbutton', { name: 'Width' });
    const height = page.getByRole('spinbutton', { name: 'Height' });

    // Located by accessible role and name because the options bar carries no data-testid.
    // `toBeHidden` is the assertion for a field that must NOT be rendered: a greyed-out
    // field would claim a control the tool is not reading.
    await expect(style).toBeVisible();
    await expect(ratio).toBeHidden();
    await expect(width).toBeHidden();
    await expect(height).toBeHidden();

    await style.selectOption('fixed-ratio');
    await expect(ratio).toBeVisible();
    await expect(width).toBeHidden();
    await expect(height).toBeHidden();

    await style.selectOption('fixed-size');
    await expect(width).toBeVisible();
    await expect(height).toBeVisible();
    await expect(ratio).toBeHidden();
  });

  test('a fixed-ratio elliptical marquee locks the committed aspect to the Ratio field', async ({ page }, testInfo) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const style = marqueeBar(page);
    await style.selectOption('fixed-ratio');
    const ratio = page.getByRole('spinbutton', { name: 'Ratio' });
    await expect(ratio).toBeVisible();
    await ratio.fill(FIXED_RATIO_VALUE);
    await expect(ratio).toHaveValue(FIXED_RATIO_VALUE);

    // Re-measured after the options panel opened, for the reason `measureCanvas` documents.
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);

    await dragOnCanvas(page, marqueeTopLeft(box, rect), marqueeBottomRight(box, rect), { steps: 12 });
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'elliptical-fixed-ratio', clip);
    expect.soft(outline, 'the locked drag should have committed an outline').not.toBeNull();

    const dragAspect = rect.width / rect.height;
    expect
      .soft(dragAspect, 'the drag itself is deliberately not the locked ratio')
      .not.toBeCloseTo(Number(FIXED_RATIO_VALUE), 1);
    expect
      .soft(outlineAspect(outline!), `committed aspect should be ${FIXED_RATIO_VALUE}, not the drag's`)
      .toBeCloseTo(Number(FIXED_RATIO_VALUE), 1);
    expect
      .soft(outlineHeight(outline!), 'the short side should have been grown to the locked ratio')
      .toBeGreaterThan(rect.height);
  });

  test('a fixed-size elliptical marquee ignores the drag and commits Width x Height centred on the press', async ({
    page,
  }, testInfo) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const style = marqueeBar(page);
    await style.selectOption('fixed-size');
    const width = page.getByRole('spinbutton', { name: 'Width' });
    const height = page.getByRole('spinbutton', { name: 'Height' });
    await width.fill(FIXED_SIZE_WIDTH);
    await height.fill(FIXED_SIZE_HEIGHT);
    await expect(width).toHaveValue(FIXED_SIZE_WIDTH);
    await expect(height).toHaveValue(FIXED_SIZE_HEIGHT);

    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);
    const press = marqueeTopLeft(box, rect);

    await dragOnCanvas(page, press, marqueeBottomRight(box, rect), { steps: 12 });
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'elliptical-fixed-size', clip);
    expect.soft(outline, 'the fixed-size drag should have committed an outline').not.toBeNull();

    const absolutePress = inCanvas(box, rect);
    const pressPoint = { x: absolutePress.left, y: absolutePress.top };
    const centre = outlineCenter(outline!);
    const tolerance = OUTLINE_BOUNDS_TOLERANCE_PX;

    // The drag must not be what got committed, and the press point must be the CENTRE of
    // what did — a committed rect with a corner on the press point is the drag.
    expect
      .soft(outlineWidth(outline!), 'the committed ellipse should be much smaller than the drag')
      .toBeLessThan(rect.width * 0.7);
    expect.soft(Math.abs(centre.x - pressPoint.x) <= tolerance, 'committed centre x').toBe(true);
    expect.soft(Math.abs(centre.y - pressPoint.y) <= tolerance, 'committed centre y').toBe(true);
    expect
      .soft(outlineAspect(outline!), 'the committed ellipse should hold the configured ratio')
      .toBeCloseTo(Number(FIXED_SIZE_WIDTH) / Number(FIXED_SIZE_HEIGHT), 1);
  });

  test('holding Shift constrains an elliptical marquee drag to a circle', async ({ page }, testInfo) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);

    await dragOnCanvas(page, marqueeTopLeft(box, rect), marqueeBottomRight(box, rect), {
      steps: 12,
      modifiers: ['Shift'],
    });
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'elliptical-shift', clip);
    expect.soft(outline, 'the Shift drag should have committed an outline').not.toBeNull();

    const dragAspect = rect.width / rect.height;
    expect.soft(dragAspect, 'the drag is deliberately not square').not.toBeCloseTo(1, 1);
    // The circle constraint grows the SHORT side and leaves the long one alone, so the width
    // is the only part of the committed geometry that still matches the drag.
    expect.soft(Math.abs(outlineWidth(outline!) - rect.width) <= OUTLINE_BOUNDS_TOLERANCE_PX).toBe(true);
    expect
      .soft(outlineAspect(outline!), 'Shift should have squared the committed ellipse off a 2:1 drag')
      .toBeCloseTo(1, 1);
    expect.soft(outlineHeight(outline!)).toBeGreaterThan(rect.height);
  });

  test('holding Alt draws an elliptical marquee from its press point outwards', async ({ page }, testInfo) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);
    const press = marqueeTopLeft(box, rect);

    await dragOnCanvas(page, press, marqueeBottomRight(box, rect), { steps: 12, modifiers: ['Alt'] });
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'elliptical-alt', clip);
    expect.soft(outline, 'the Alt drag should have committed an outline').not.toBeNull();

    // Same size as the drag — Alt changes where the ellipse grows from, not how big it is —
    // but centred on the press point rather than laid out from it towards the pointer.
    const centre = outlineCenter(outline!);
    const absolutePress = inCanvas(box, rect);
    expect.soft(Math.abs(outlineWidth(outline!) - rect.width) <= OUTLINE_BOUNDS_TOLERANCE_PX).toBe(true);
    expect.soft(Math.abs(outlineHeight(outline!) - rect.height) <= OUTLINE_BOUNDS_TOLERANCE_PX).toBe(true);
    expect.soft(Math.abs(centre.x - absolutePress.left) <= OUTLINE_BOUNDS_TOLERANCE_PX, 'centre x').toBe(true);
    expect.soft(Math.abs(centre.y - absolutePress.top) <= OUTLINE_BOUNDS_TOLERANCE_PX, 'centre y').toBe(true);
    // A corner-anchored drag would put the press point on the boundary, half a size away
    // from the centre on both axes.
    expect
      .soft(Math.abs(centre.x - absolutePress.left) <= OUTLINE_BOUNDS_TOLERANCE_PX)
      .not.toBe(outlineWidth(outline!) / 2);
  });

  test('an elliptical marquee click without movement commits nothing', async ({ page }) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);
    const press = {
      x: box.x + rect.left + rect.width / 2,
      y: box.y + rect.top + rect.height / 2,
    };
    // The baseline, asserted before the gesture: the blank document's history is a single
    // entry, so undo is disabled until something is committed, and a selection DRAFT on its
    // own cannot enable it. Asserting the baseline explicitly means a failure after the
    // gesture names the gesture rather than a precondition that was never checked.
    await expect(page.getByTestId('undo-button')).toBeDisabled();

    await page.mouse.click(press.x, press.y);

    expect
      .soft(
        await neverHappened(page, () => outlineExists(page, clip), NEGATIVE_WINDOW_MS),
        'a click with no movement encloses nothing, so it must not commit a selection'
      )
      .toBe(true);
    // Nothing entered the timeline either.
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('an elliptical marquee drag that returns to its start point commits nothing', async ({ page }) => {
    await selectEllipticalMarqueeFromSidebar(page);
    const box = await measureCanvas(page);
    const rect = marqueeRect(box);
    const clip = clipAround(box, rect, MARQUEE_CLIP_MARGIN_PX);
    const press = { x: box.x + rect.left + rect.width / 2, y: box.y + rect.top + rect.height / 2 };
    const away = { x: press.x + 80, y: press.y + 60 };
    // See the sibling test: the baseline is asserted, not assumed.
    await expect(page.getByTestId('undo-button')).toBeDisabled();

    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(away.x, away.y, { steps: 8 });
    await page.mouse.move(press.x, press.y, { steps: 8 });
    await page.mouse.up();

    expect
      .soft(
        await neverHappened(page, () => outlineExists(page, clip), NEGATIVE_WINDOW_MS),
        'a drag back to its start point encloses nothing, so it must not commit a selection'
      )
      .toBe(true);
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  });

  test('an elliptical marquee is reachable with the M shortcut', async ({ page }) => {
    // M is the marquee TILE, not the elliptical member of it: the tile's primary tool is the
    // rectangular marquee, and Shift+M cycles within the group. Reaching the elliptical tool
    // therefore needs both keys, and asserting the elliptical bar is what proves the cycle
    // advanced rather than merely re-selecting the primary.
    await page.keyboard.press('m');
    await expect(page.getByText('Draw a rectangle and copy selected bitmap area.')).toBeVisible();
    await expect(marqueeBar(page)).toHaveCount(0);
    await page.keyboard.press('Shift+m');
    await expect(marqueeBar(page)).toBeVisible();
  });

  test('an elliptical marquee is reachable from the sidebar flyout by keyboard', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'rectangular-selection');
    await navigateAndSelectInFlyout(page, 'elliptical-selection', 'Elliptical Marquee Tool');
    await expect(marqueeBar(page)).toBeVisible();
  });
});

test.describe('Quick selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  test('a quick selection stroke commits the region it brushed and not the rest of the document', async ({
    page,
  }, testInfo) => {
    await paintRedBand(page);
    await selectQuickSelectionFromSidebar(page);
    const bandBox = await measureCanvas(page);
    const clip = await visibleCanvasClip(page, bandBox);

    // The stroke is placed on the MEASURED band, not on the rectangle the paint hoped for,
    // so a canvas reflow between the two tools cannot quietly move the brush off the region.
    const band = await bandBoundsIn(
      await loadImageData(await captureCanvasScreenshot(page, clip, testInfo, 'qs-band'))
    );
    expect.soft(band.found, 'the painted band should be present in the capture').toBe(true);
    const bandLeft = clip.x + band.left;
    const bandRight = clip.x + band.right;
    const bandTop = clip.y + band.top;
    const bandBottom = clip.y + band.bottom;
    const bandCentreY = (bandTop + bandBottom) / 2;

    await dragOnCanvas(
      page,
      { x: bandLeft + (bandRight - bandLeft) * 0.35, y: bandCentreY },
      { x: bandLeft + (bandRight - bandLeft) * 0.65, y: bandCentreY },
      { steps: 12 }
    );
    await waitForOutline(page, clip);
    const outline = await readOutline(page, testInfo, 'quick-selection-region', clip);
    expect.soft(outline, 'the brushed region should have committed an outline').not.toBeNull();

    // "Covers the near region": the committed boundary traces the band's own edges, and takes
    // in nearly all of its width. Containment with a small margin is the direction that
    // tolerates the two measurements disagreeing about antialiased edge pixels.
    const margin = OUTLINE_BOUNDS_TOLERANCE_PX * 2;
    expect.soft(outline!.left).toBeGreaterThanOrEqual(bandLeft - margin);
    expect.soft(outline!.right).toBeLessThanOrEqual(bandRight + margin);
    expect.soft(outline!.top).toBeGreaterThanOrEqual(bandTop - margin);
    expect.soft(outline!.bottom).toBeLessThanOrEqual(bandBottom + margin);
    expect
      .soft(outlineWidth(outline!), 'the committed region should span the band')
      .toBeGreaterThan((bandRight - bandLeft) * 0.8);
    expect
      .soft(outlineHeight(outline!), 'the committed region should be the band, not the document')
      .toBeLessThan((bandBottom - bandTop) * 3);

    // "Not the far region": the white field around the band is contiguous and a click away,
    // so a grow that leaked out of the band would have taken all of it and the committed
    // region would reach the canvas edges. Bounding it away from the top and the bottom of
    // the canvas is the observable form of that.
    expect.soft(outline!.top).toBeGreaterThan(bandBox.y + bandBox.height * 0.2);
    expect.soft(outline!.bottom).toBeLessThan(bandBox.y + bandBox.height * 0.6);
  });

  test('a quick selection stroke is one commit that a single undo removes', async ({ page }, testInfo) => {
    await paintRedBand(page);
    await selectQuickSelectionFromSidebar(page);
    const bandBox = await measureCanvas(page);
    const clip = await visibleCanvasClip(page, bandBox);
    const band = await bandBoundsIn(
      await loadImageData(await captureCanvasScreenshot(page, clip, testInfo, 'qs-commit-band'))
    );
    const centreY = clip.y + (band.top + band.bottom) / 2;
    const left = clip.x + band.left;
    const right = clip.x + band.right;

    // A long stroke: a per-pointer-move commit would leave one history entry per sample, and
    // a single undo would then leave a selection behind.
    await dragOnCanvas(page, { x: left + 20, y: centreY }, { x: right - 20, y: centreY }, { steps: 24 });
    await waitForOutline(page, clip);
    await expect(page.getByTestId('undo-button')).toBeEnabled();

    await page.getByTestId('undo-button').click();
    expect
      .soft(
        await neverHappened(page, () => outlineExists(page, clip), NEGATIVE_WINDOW_MS),
        'one undo must remove the whole brushed region'
      )
      .toBe(true);
    // Undo is NOT asserted to be disabled here: this test paints a band first, and that
    // layer creation is its own history entry, so the cursor is still on it after the undo
    // that removed the selection.
  });

  test('a quick selection is reachable with the W shortcut', async ({ page }) => {
    // W is the object-selection TILE; its primary is the Magic Wand, and Shift+W cycles to
    // the quick selection. Asserting both bars is what proves the cycle advanced.
    await page.keyboard.press('w');
    await expect(page.getByText('Click a color area to select connected similar pixels.')).toBeVisible();
    await expect(quickSelectionBar(page)).toHaveCount(0);
    await page.keyboard.press('Shift+w');
    await expect(quickSelectionBar(page)).toBeVisible();
  });

  test('a quick selection is reachable from the sidebar flyout by keyboard', async ({ page }) => {
    await openToolFlyoutViaKeyboard(page, 'magic-wand');
    await navigateAndSelectInFlyout(page, 'quick-selection', 'Quick Selection Tool');
    await expect(quickSelectionBar(page)).toBeVisible();
  });
});
