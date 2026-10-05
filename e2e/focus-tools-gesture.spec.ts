import { expect, type Locator, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  DEFAULT_DOCUMENT_SIZE,
  documentToCanvasOffset,
  DRAW_TOOL_STROKE_WIDTH,
  getWorkspaceCanvas,
  type ImageDataResult,
  loadImageData,
} from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * GESTURES, not filters: what separates Blur, Sharpen and Smudge from their whole-layer forms is
 * that ONE press/move/release paints a stroke, and that stroke carries three properties a
 * whole-layer processor has none of.
 *
 * - It is CONFINED. `compositeStrokeFootprint` clips the filter result to the union of the
 *   brush's dab discs, so everything under the layer but outside the footprint keeps its own
 *   pixels. "Some pixel in the clip changed" cannot see that: one changed pixel anywhere
 *   satisfies it, and so does a filter that was never masked at all. The confinement test below
 *   is the only place the property can be proven, because no unit-test canvas double models
 *   `clip()`.
 * - It is ONE undoable action. `updateLayerByTool` appends exactly one `TOOL_ACTION` per commit,
 *   and a stroke that painted outside that path would be permanently un-undoable with no error
 *   and no visible sign of it.
 * - The SMUDGE one is that it can WIDEN a tight layer, so a stroke reaches document pixels the
 *   layer did not previously address at all.
 *
 * ## Why every coordinate here is a DOCUMENT coordinate
 *
 * A canvas box measured before something reflows the workspace names a different page rect after
 * it, and every clip and pointer target derived from a stale box then photographs and strokes
 * somewhere else entirely. `documentGeometry` re-solves on demand and converts through the same
 * contain fit `usePointerPosition` reads, so a gesture and the pixel sample that judges it cannot
 * drift apart and a reflow cannot silently invalidate a measurement.
 *
 * ## Why `drawLine` waits for the TIMELINE rather than for a dark pixel
 *
 * `DrawToolArea` paints the live stroke into the shared overlay and commits on pointer-up, so
 * "some pixel in the box is dark" is already true of the PREVIEW. Waiting on it returned while
 * the commit was still in flight, and the tool switch that followed unmounts `DrawToolArea`,
 * whose cleanup clears the overlay — so the line could vanish before the blur ever saw it. A
 * history row titled with the tool's own name cannot be produced by the overlay at all.
 *
 * ## Why the undo test's baseline is taken BEFORE the tool is armed
 *
 * The Blur bar previews its radius on the active layer the moment the slider moves, and that
 * preview is uncommitted: `resetHistoryTo` clears it. So the state one undo restores is the one
 * the document was committed at, not the armed-and-previewing state a baseline captured after the
 * slider would name. The test therefore takes two baselines and asserts one thing about each.
 */

/** `[DOCUMENT]` — the seeded document's own size. Every clip below is expressed in it. */
const DOCUMENT = DEFAULT_DOCUMENT_SIZE;

/** `[DOCUMENT]` — the centre of the boot document, which the before hook polls for. */
const BOOT_DOCUMENT_CLIP = { x: 380, y: 280, width: 40, height: 40 };

/**
 * What a fresh document composites to everywhere: `DEFAULT_BLANK_IMAGE.color` is `#ffffff` at
 * opacity 1, so the before hook can wait for the document to exist rather than for a tool to
 * refuse to paint.
 */
const BOOT_PAPER_LEVEL = 255;

/**
 * `[DOCUMENT]` — the fixture stroke every test starts from.
 *
 * `pointsBoundingPos` pads a stroke's bounding box by the WHOLE `lineWidth` on every side, so
 * this drag produces a layer whose document extent is exactly `LAYER_*` below. Every clip in
 * this file is placed against that extent, which is why the extent is stated rather than
 * eyeballed: the confinement clip has to sit ON the line (a region of bare paper is satisfied by
 * "nothing changed" whether the filter was masked or not), and the smudge clip has to sit PAST
 * it (so that only widening can reach it).
 */
const LINE_Y = 300;
const LINE_START = { x: 200, y: LINE_Y };
const LINE_END = { x: 560, y: LINE_Y };
const LAYER_LEFT = LINE_START.x - DRAW_TOOL_STROKE_WIDTH;
const LAYER_RIGHT = LINE_END.x + DRAW_TOOL_STROKE_WIDTH;
const LAYER_TOP = LINE_Y - DRAW_TOOL_STROKE_WIDTH;
const LAYER_BOTTOM = LINE_Y + DRAW_TOOL_STROKE_WIDTH;

/** `[DOCUMENT]` — the line's own extent, grown by a document pixel either side so no edge is cut. */
const LINE_CLIP = {
  x: LAYER_LEFT - 1,
  y: LAYER_TOP - 1,
  width: LAYER_RIGHT - LAYER_LEFT + 2,
  height: LAYER_BOTTOM - LAYER_TOP + 2,
};

/**
 * `[DOCUMENT]` — the part of the line a focus stroke is painted over.
 *
 * `FOCUS_STROKE_BRUSH_SIZE` is the tip a focus stroke clips to, so the footprint reaches 20
 * document pixels either side of the path. This clip holds the path from 240 to 380 and stops at
 * 410, which is past the footprint's right edge with room to spare.
 */
const FOOTPRINT_START = { x: 240, y: LINE_Y };
const FOOTPRINT_END = { x: 380, y: LINE_Y };
const FOOTPRINT_CLIP = { x: 210, y: 275, width: 200, height: 50 };

/**
 * `[DOCUMENT]` — the far end of the SAME line, 50 document pixels clear of the footprint.
 *
 * Same layer, not a different one: confinement is a claim about the mask on the pixels the tool
 * was handed, and a region belonging to some other layer would stay untouched under a whole-layer
 * filter too, so it would prove layer isolation instead.
 */
const CLEAR_CLIP = { x: 450, y: 285, width: 110, height: 30 };

/** `[DOCUMENT]` — the smudge path: it starts on the line and travels out past the layer's edge. */
const SMUDGE_START = { x: 540, y: LINE_Y };
const SMUDGE_END = { x: 700, y: LINE_Y };

/**
 * `[DOCUMENT]` — bare padding two document pixels past `LAYER_RIGHT`.
 *
 * The carry in `smudgeStroke` is honoured for exactly one dab past the last opaque sample, so at
 * `Size 40` and the default spacing the deposited band reaches some thirty document pixels past
 * the layer's edge. This clip sits inside that band and well outside the layer.
 */
const SMUDGE_CLIP = { x: LAYER_RIGHT + 2, y: 292, width: 20, height: 16 };

/**
 * A composite level below which a pixel counts as INK.
 *
 * The Draw tool's default pen is `#000000` at `alpha: 0.9`, so a committed stroke composites to
 * `0.9 * 0 + 0.1 * 255 = 25.5` over the boot document's white, and every anti-aliased pixel
 * between the stroke and the paper is higher but still far below this. It is the widest band that
 * separates "the line is here" from "this region is bare paper", and it is the number this file's
 * two emptiness claims rest on: a fixture that is not drawn yet, and a smudge clip nothing else
 * can reach.
 */
const INK_LEVEL = 200;

/**
 * How much darker the darkest pixel of a capture is than its brightest, in levels.
 *
 * This is the non-vacuity test for a region a filter is asserted not to touch, and it is
 * deliberately not an INK count. A whole-layer Blur or Sharpen over a UNIFORM region changes
 * nothing, so "nothing changed" there is true of a tool that never masked as well as of one that
 * masked perfectly, and an ink count read against a fixed threshold only asks how dark the edge
 * happens to be — which a radius slider decides. A region with any real tonal gradient is one a
 * filter has to move; the boot paper has none at all.
 */
const TONE_SPREAD_FLOOR = 8;

/** How long a pixel poll waits, in ms. Generous: a poll succeeds on the first frame that agrees. */
const PIXEL_POLL_TIMEOUT_MS = 15_000;

/** How often a pixel poll reads, in ms. */
const PIXEL_POLL_INTERVAL_MS = 100;

/** `Amount`/`Radius` for Sharpen and `Radius` for Blur: a tip far wider than the 10px line. */
const SHARPEN_AMOUNT = '100';
const SHARPEN_RADIUS = '2';
const BLUR_RADIUS = '12';

/** `Size`/`Hardness`/`Strength` for Smudge: a hard 40px tip carrying a full share per dab. */
const SMUDGE_SIZE = '40';
const SMUDGE_HARDNESS = '100';
const SMUDGE_STRENGTH = '100';

/** A point in the app's own document space. */
type DocPoint = { x: number; y: number };

/** A rectangle in the app's own document space. */
type DocRect = { x: number; y: number; width: number; height: number };

/**
 * The solved contain transform, re-measured on demand. `[DOCUMENT]` in, `[PAGE]` out — the two
 * spaces `page.screenshot` and `page.mouse` speak.
 */
type Geometry = {
  box: BoundingBox;
  toPage: (point: DocPoint) => { x: number; y: number };
  clip: (rect: DocRect) => Required<ClipOptions>;
};

async function documentGeometry(page: Page): Promise<Geometry> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Workspace canvas is not measurable');
  const toPage = ({ x, y }: DocPoint) => {
    const offset = documentToCanvasOffset(box, x, y, DOCUMENT);
    return { x: box.x + offset.x, y: box.y + offset.y };
  };
  const clip = (rect: DocRect): Required<ClipOptions> => {
    const origin = toPage({ x: rect.x, y: rect.y });
    const far = toPage({ x: rect.x + rect.width, y: rect.y + rect.height });
    return {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      width: Math.max(1, Math.round(far.x - origin.x)),
      height: Math.max(1, Math.round(far.y - origin.y)),
    };
  };
  return { box, toPage, clip };
}

/** One clipped capture, decoded. The pixels every assertion below reads. */
const readClip = async (page: Page, clip: Required<ClipOptions>): Promise<ImageDataResult> =>
  loadImageData(await page.screenshot({ clip }));

/** The composite mean level over a capture, rounded to a whole 0-255 level. */
function meanLevel(image: ImageDataResult): number {
  let total = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    total += (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
  }
  return Math.round(total / (image.width * image.height));
}

/** How many pixels of a capture are INK. A count over the whole capture, not a proportion. */
function inkPixels(image: ImageDataResult): number {
  let ink = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const level = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
    if (level < INK_LEVEL) ink += 1;
  }
  return ink;
}

/** How much darker the darkest pixel of a capture is than its brightest, in levels. */
function toneSpread(image: ImageDataResult): number {
  let darkest = 255;
  let brightest = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const level = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
    if (level < darkest) darkest = level;
    if (level > brightest) brightest = level;
  }
  return Math.round(brightest - darkest);
}

/**
 * How many pixels of two captures of the SAME clip differ, over ALL FOUR channels.
 *
 * Alpha is in the comparison because a stroke that paints into a layer's newly transparent padding
 * changes nothing else, and a comparator that steps `index += 4` and reads three of the four
 * channels cannot see that at all.
 */
const changedPixels = (before: Uint8ClampedArray, after: Uint8ClampedArray): number => {
  let changed = 0;
  for (let index = 0; index < before.length; index += 4) {
    if (
      before[index] !== after[index] ||
      before[index + 1] !== after[index + 1] ||
      before[index + 2] !== after[index + 2] ||
      before[index + 3] !== after[index + 3]
    ) {
      changed += 1;
    }
  }
  return changed;
};

/**
 * Polls one clip until it differs from `before`.
 *
 * Undo and redo are asynchronous replays and a stroke publishes its pixels through
 * `tempUpdateLayer` on a later frame, so a single read straight after either can land on the
 * frame before the write. Polling is the synchronisation, and `message` is the only signal a
 * failing run gives, so it names the assertion that broke.
 */
async function expectPixelsChanged(
  page: Page,
  clip: Required<ClipOptions>,
  before: Uint8ClampedArray,
  message: string
): Promise<void> {
  await expect
    .poll(async () => changedPixels(before, (await readClip(page, clip)).data), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBeGreaterThan(0);
}

/** Polls one clip until it is back to `before` exactly, alpha channel included. */
async function expectPixelsRestored(
  page: Page,
  clip: Required<ClipOptions>,
  before: Uint8ClampedArray,
  message: string
): Promise<void> {
  await expect
    .poll(async () => changedPixels(before, (await readClip(page, clip)).data), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBe(0);
}

async function setSlider(page: Page, name: string | RegExp, value: string): Promise<void> {
  const slider = page.getByRole('slider', { name });
  await expect(slider, `${String(name)} is this tool's options-bar control`).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

/** The history panel mints one row per committed edit, each titled with the way back to it. */
const historyRows = (page: Page): Locator => page.getByTitle('Click to go back to this state');

/**
 * The rows a Draw stroke produces. `getHistoryItemTitle` names a tool entry after its tool, so a
 * stroke made with the draw tool is the one row that reads exactly "draw" — which also excludes
 * the document's own opening entry.
 */
const drawHistoryRows = (page: Page): Locator => historyRows(page).filter({ hasText: /^draw/ });

/**
 * The fixture line, drawn and WAITED FOR.
 *
 * The two waits are both load-bearing and they wait for different moments. The row count is the
 * commit: the overlay preview is painted without touching the store, so it cannot produce a
 * history row, while `createLayerFromTool` runs on pointer-up. The ink poll is the repaint that
 * follows it, over a clip that names the line's OWN extent rather than the whole canvas box, so a
 * dark pixel in the letterbox cannot satisfy it.
 */
async function drawLine(page: Page): Promise<Geometry> {
  await clickToolButton(page, 'draw');
  // Solved AFTER the tool click, because the options row a tool opens can reflow the workspace
  // and a box measured before it names a page rect the stroke would miss.
  const geometry = await documentGeometry(page);
  const start = geometry.toPage(LINE_START);
  const end = geometry.toPage(LINE_END);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await page.mouse.up();

  await expect(drawHistoryRows(page), 'the draw stroke has reached the timeline').toHaveCount(1);
  await expect
    .poll(async () => inkPixels(await readClip(page, geometry.clip(LINE_CLIP))), {
      message: 'the committed line is on the canvas',
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBeGreaterThan(0);
  return geometry;
}

/** A document-space drag on the workspace: the gesture all three tools respond to. */
async function stroke(page: Page, geometry: Geometry, from: DocPoint, to: DocPoint, steps = 20): Promise<void> {
  const start = geometry.toPage(from);
  const end = geometry.toPage(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

async function selectBlur(page: Page): Promise<void> {
  await clickToolButton(page, 'blur');
  // The Blur bar nests its readout in the label, so the accessible name is "Blur Radius 0px" and
  // a prefix match on "Radius" never resolves. Sharpen's bar names its controls outright, which is
  // why the two arms below do not spell their names the same way.
  await setSlider(page, /blur radius/i, BLUR_RADIUS);
}

async function selectSharpen(page: Page): Promise<void> {
  await openToolFlyout(page, 'blur');
  await selectFromFlyout(page, { toolName: 'sharpen', label: 'Sharpen Tool' });
  await setSlider(page, 'Amount', SHARPEN_AMOUNT);
  await setSlider(page, 'Radius', SHARPEN_RADIUS);
}

async function selectSmudge(page: Page): Promise<void> {
  await openToolFlyout(page, 'blur');
  await selectFromFlyout(page, { toolName: 'smudge', label: 'Smudge Tool' });
  await setSlider(page, 'Size', SMUDGE_SIZE);
  await setSlider(page, 'Hardness', SMUDGE_HARDNESS);
  await setSlider(page, 'Strength', SMUDGE_STRENGTH);
}

/** The two tools the confinement claim is made about, so one failing run names which. */
const FOCUS_TOOLS = [
  { title: 'Blur', select: selectBlur },
  { title: 'Sharpen', select: selectSharpen },
] as const;

/**
 * Undo and redo through the toolbar buttons, which is what `paint-tools.spec.ts` sends and which
 * exercises the same `resetHistoryTo` a keyboard shortcut reaches.
 */
async function undo(page: Page): Promise<void> {
  const button = page.getByTestId('undo-button');
  await expect(button, 'undo must be available for this test to mean anything').toBeEnabled();
  await button.click();
}

async function redo(page: Page): Promise<void> {
  const button = page.getByTestId('redo-button');
  await expect(button, 'redo must be available for this test to mean anything').toBeEnabled();
  await button.click();
}

test.describe('focus tool gestures', () => {
  // Each test draws the fixture line, opens an options bar, strokes, and reads pixels with a
  // capture per poll; the undo round trip adds two more of those.
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // All three refuse a BEDROCK layer, and the only layer on a fresh document is the boot one
    // `BlankImageStarter` creates, so a test that ran before it fired would be stroking nothing.
    const geometry = await documentGeometry(page);
    await expect
      .poll(async () => meanLevel(await readClip(page, geometry.clip(BOOT_DOCUMENT_CLIP))), {
        message: 'the blank document is ready',
        timeout: PIXEL_POLL_TIMEOUT_MS,
        intervals: [PIXEL_POLL_INTERVAL_MS],
      })
      .toBe(BOOT_PAPER_LEVEL);
  });

  test('Blur changes pixels when painted over a line', async ({ page }) => {
    await drawLine(page);
    await selectBlur(page);
    const geometry = await documentGeometry(page);
    const clip = geometry.clip(FOOTPRINT_CLIP);

    const before = await readClip(page, clip);
    await stroke(page, geometry, LINE_START, LINE_END);
    await expectPixelsChanged(page, clip, before.data, 'a blur stroke has to move the pixels under the brush');
  });

  test('Sharpen changes pixels when painted over a line', async ({ page }) => {
    await drawLine(page);
    await selectSharpen(page);
    const geometry = await documentGeometry(page);
    const clip = geometry.clip(FOOTPRINT_CLIP);

    const before = await readClip(page, clip);
    await stroke(page, geometry, LINE_START, LINE_END);
    await expectPixelsChanged(page, clip, before.data, 'a sharpen stroke has to move the pixels under the brush');
  });

  for (const tool of FOCUS_TOOLS) {
    test(`${tool.title} leaves the pixels outside the brush footprint bit-identical`, async ({ page }) => {
      await drawLine(page);
      await tool.select(page);
      const armed = await documentGeometry(page);
      const footprint = armed.clip(FOOTPRINT_CLIP);
      const clear = armed.clip(CLEAR_CLIP);

      // THE WARM-UP STROKE, and what it is for. A raster stroke publishes its layer at the frame
      // `rasterBoundsForStroke` computes, which floors an origin the draw tool left fractional —
      // so the FIRST stroke re-registers the whole layer in the composite. Measuring bit-identity
      // across that would be measuring the re-registration rather than the brush mask, and the
      // whole layer moves with it. Stroking once first makes the second stroke's frame identical
      // to the first's, which is the frame the confinement claim is actually about.
      const beforeWarmUp = await readClip(page, footprint);
      await stroke(page, armed, FOOTPRINT_START, FOOTPRINT_END);
      await expectPixelsChanged(page, footprint, beforeWarmUp.data, `${tool.title} painted inside its footprint`);

      // NON-VACUOUS BY CONSTRUCTION. The clear region carries a real tonal edge, so a filter that
      // was not masked to the footprint would change it; a region of bare paper would read
      // "unchanged" whether the mask worked or the tool filtered the whole layer.
      const clearBefore = await readClip(page, clear);
      expect
        .soft(
          toneSpread(clearBefore),
          'the clear region has to hold a tonal edge, or "unchanged" is true of bare paper too'
        )
        .toBeGreaterThan(TONE_SPREAD_FLOOR);

      const footprintBefore = await readClip(page, footprint);
      await stroke(page, armed, FOOTPRINT_START, FOOTPRINT_END);
      // The positive half FIRST, because it is the synchronisation the negative half needs: "no
      // pixel changed out here" is already true of the clear region before the stroke lands, so a
      // poll on it alone would pass on the frame that proves nothing.
      await expectPixelsChanged(
        page,
        footprint,
        footprintBefore.data,
        `${tool.title} painted inside its footprint a second time`
      );

      expect
        .soft(
          changedPixels(clearBefore.data, (await readClip(page, clear)).data),
          `${tool.title} must confine the filter to the brush footprint it painted`
        )
        .toBe(0);
    });
  }

  test('a stroked focus tool is one undoable action', async ({ page }) => {
    const geometry = await drawLine(page);
    const clip = geometry.clip(FOOTPRINT_CLIP);

    // The state one undo has to land on: the document as it was COMMITTED. Captured before the
    // tool is armed, because the Blur bar previews its radius on the active layer the moment the
    // slider moves and `resetHistoryTo` clears that uncommitted preview — so a baseline taken
    // after arming names a state no undo restores, and the test would be measuring the preview's
    // disposal instead of the stroke's.
    const committed = (await readClip(page, clip)).data;

    await selectBlur(page);
    expect(
      (await documentGeometry(page)).box,
      'a workspace reflowed by arming the tool would make the baseline above name a different page rect'
    ).toEqual(geometry.box);

    // The second baseline, for the other half of the claim: the stroke's own effect is measured
    // from here, so arming the tool cannot be what satisfies it.
    const armed = (await readClip(page, clip)).data;
    await stroke(page, geometry, LINE_START, LINE_END);
    await expectPixelsChanged(page, clip, armed, 'the stroke itself has to move pixels on top of the arming');

    // ONE undo, not a sequence of them: a stroke committed as anything other than a single
    // `TOOL_ACTION` entry would leave pixels behind that no single undo removes, and the pixels
    // are the only thing here that can say so. Bit-identical, because a replay that rebuilds the
    // same line a fraction of a pixel away is a different answer to the same question.
    await undo(page);
    await expectPixelsRestored(page, clip, committed, 'one undo must put every pixel the stroke moved back');

    await redo(page);
    await expectPixelsChanged(page, clip, committed, 'redo has to re-apply the blurred pixels');
  });

  test('Smudge widens a tight layer into the stroke footprint', async ({ page }) => {
    await drawLine(page);
    await selectSmudge(page);
    const armed = await documentGeometry(page);
    const clip = armed.clip(SMUDGE_CLIP);

    const before = await readClip(page, clip);
    // THE SUBJECT IS THE PADDING, so the padding is asserted rather than assumed. The clip sits
    // past the drawn layer's own extent, and nothing but widening can reach it — unless a line
    // pixel ever falls inside, in which case an ordinary in-layer drag changes it and this test
    // goes green with the widening deleted.
    expect(inkPixels(before), 'the smudge clip has to start out clear of the drawn line').toBe(0);

    await stroke(page, armed, SMUDGE_START, SMUDGE_END);
    await expectPixelsChanged(page, clip, before.data, 'a smudge stroke has to widen a tight layer');
    expect
      .soft(
        inkPixels(await readClip(page, clip)),
        'the widened region has to carry the line, not merely differ by a resample'
      )
      .toBeGreaterThan(0);
  });
});
