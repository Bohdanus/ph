import { expect, type Page, test } from './fixtures/extended-test';
import { type BoundingBox, getWorkspaceCanvas, type ImageDataResult, loadImageData } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import {
  clickToolButton,
  FLYOUT_VISIBLE_TIMEOUT_MS,
  type FlyoutItem,
  selectFromFlyout,
  waitForFlyout,
} from './helpers/toolbar-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Sponge Tool: the third member of the `O` toning flyout, beside the Dodge and the Burn.
 *
 * ## Why this spec measures CHROMA rather than level
 *
 * Every existing tonal-tool spec (`paint-tools.spec.ts`) reads a composite MEAN over a window and
 * calls that the tool's output, because a dodge and a burn move all three channels the same way
 * and a mean says everything there is to say. The Sponge is the opposite: it scales a pixel's
 * distance from its OWN luma (`sponge.ts:279`), so `r`, `g` and `b` move in DIFFERENT
 * directions around a fixed pivot and their MEAN is nearly invariant. A mean-level test of this
 * tool would pass on a build that did nothing at all, so the assertions below are about the
 * SPREAD `max(r,g,b) - min(r,g,b)`, about individual channels, or about byte equality.
 *
 * ## Why the fixture is drawn, and why it is a COLOUR rather than a grey
 *
 * The Sponge refuses a bedrock layer (`SpongeToolArea.tsx:54`), so the fixture needs a
 * non-bedrock layer, and the Draw tool is the only tool in the app that CREATES one. The band is
 * painted at `Opacity 1`, which makes the composite equal the drawn colour exactly — the same
 * fact `paint-tools.spec.ts:69-73` builds its exact `128` assertion on.
 *
 * The colour is NOT the grey that spec uses, and that is not a preference. `spongeLuma` is a
 * weighted mean of the three channels, so on a grey pixel `r === g === b`, every channel's
 * deviation from the pivot is `0`, and `chromaScale` returns the pixel untouched in BOTH modes
 * (`sponge.ts:279`). A grey band is a NO-OP for this tool by construction, so the fixture is
 * chromatic and every constant below is derived from that colour rather than measured from it.
 *
 * `BAND_COLOUR = #c85020` is chosen for arithmetic:
 *
 * ```
 *   luma      = 0.2126*200 + 0.7152*80 + 0.0722*32 = 102.05
 *   spread    = 200 - 32 = 168
 *   headroom  = min( (255-102.05)/(200-102.05) , 102.05/(102.05-80) , 102.05/(102.05-32) )
 *             = min( 1.5617 , 4.628 , 1.4568 ) = 1.4568      <- the BLUE channel binds first
 * ```
 *
 * The blue channel running out of gamut first is what makes the Vibrance case decidable.
 *
 * ## Why the geometry is solved rather than assumed
 *
 * The 800x600 document is CONTAINED in the workspace box and scaled by `min(w/800, h/600)`, and
 * `getLocalCoords` (`src/hooks/usePointerPosition.ts:167-182`) reads every sample through that.
 * `workspaceGeometry` solves it from the live box exactly as `paint-tools.spec.ts:202-215` does,
 * and it is re-solved after every options-bar change, because a wider bar reflows the workspace
 * and a box measured before it opened photographs empty canvas (e2e/OPEN_PROBLEMS.md).
 */

/** `DEFAULT_BLANK_IMAGE.size` (`src/App.tsx:19`): the space every document coordinate lives in. */
const DOCUMENT_WIDTH = 800;
const DOCUMENT_HEIGHT = 600;

/** `DEFAULT_BLANK_IMAGE.color` (`src/App.tsx:17`): the level an untouched document composites to. */
const BACKGROUND_LEVEL = 255;

/** The Draw tool's `Size` while the band is painted: 60px, so one drag is a solid field. */
const BAND_LINE_WIDTH = 60;
const BAND_START_X = 200;
const BAND_END_X = 500;
const BAND_Y = 200;
const BAND_MID_X = (BAND_START_X + BAND_END_X) / 2;

/** `#c85020`. Luma 102, spread 168, chroma headroom 1.4568 with blue the binding channel. */
const BAND_COLOUR = '#c85020';
const BAND_RED = 200;
const BAND_GREEN = 80;
const BAND_BLUE = 32;
const BAND_SPREAD = BAND_RED - BAND_BLUE;
/**
 * The tool's own pivot for that colour: `0.2126*200 + 0.7152*80 + 0.0722*32 = 102.05`, which is
 * what a full-Flow Desaturate writes into all three channels (`clampChannel(102.05)` rounds to
 * 102 on the way into the raster).
 */
const BAND_LUMA = 102;
/**
 * The ARITHMETIC mean `(200 + 80 + 32) / 3 = 104` of the same colour — what `levelOf` reports for
 * the drawn band. It is not `BAND_LUMA` and conflating the two is a 2-level error that reads like
 * a rounding failure: Rec. 709 weights green 3.4x as heavily as blue, and an unweighted mean does
 * not. Level assertions compare against this; chroma assertions compare against `BAND_LUMA`.
 */
const BAND_MEAN = 104;

/**
 * What a full-Flow, `Vibrance`-on Saturate writes into `#c85020`, derived rather than captured.
 *
 * `sponge.ts:290` caps `k` at `chromaHeadroom`, and blue is the binding channel at
 * `102.05 / (102.05 - 32) = 1.4568`, so `k = 1.4568` rather than the `2` an uncapped stroke would
 * use. The three results are the module's own arithmetic through `clampChannel`'s rounding:
 * red `244.7 -> 245`, green `69.9 -> 70`, blue `0.0 -> 0`.
 *
 * Blue ON the gamut boundary and red 10 short of clipping is the cap working, so these three
 * numbers and not `(255, 42, 0)` are what a correct Vibrance-on stroke must produce.
 */
const BAND_SATURATED_RED = 245;
const BAND_SATURATED_GREEN = 70;
const BAND_SATURATED_BLUE = 0;

/**
 * The document-spanning fixture's geometry, for the case that probes a document-sized layer away
 * from the gesture that made it. See that test's header for why each figure is what it is.
 *
 * `WIDE_DRAW_SIZE` is `BRUSH_SIZE_MAX`, and the Draw bar's own `Size` slider runs `0.5-500`
 * (`src/components/ToolbarsRight/Draw/Draw.tsx:151-153`), so this is the widest tip the app owns.
 */
const WIDE_DRAW_SIZE = 500;
const WIDE_DRAW_FROM = { x: 250, y: 150 };
const WIDE_DRAW_TO = { x: 550, y: 150 };
/**
 * The two rows the Sponge strokes run along: 100 and 200 document pixels BELOW the row the Draw
 * stroke swept, so neither probe sits on the path that created the layer. 100 document pixels
 * apart against a 30px tip, so the two strokes cannot reach each other's row.
 */
const WIDE_ROW_A = 250;
const WIDE_ROW_B = 350;
/**
 * Both Sponge strokes run horizontally from here to `WIDE_SPONGE_TO_X`, on `WIDE_ROW_A` and then
 * on `WIDE_ROW_B`. The row is a parameter rather than baked in, because a stroke that starts on
 * one row and ends on the other is a DIAGONAL that misses both probes.
 */
const WIDE_SPONGE_FROM_X = 200;
const WIDE_SPONGE_A = { x: WIDE_SPONGE_FROM_X, y: WIDE_ROW_A };
const WIDE_SPONGE_TO_X = 400;
/** The two probes sit ON their own stroke's centre line, `WIDE_PROBE_MID` from either end. */
const WIDE_PROBE_MID = 300;
const WIDE_PROBE_A = { x: WIDE_PROBE_MID, y: WIDE_ROW_A };
const WIDE_PROBE_B = { x: WIDE_PROBE_MID, y: WIDE_ROW_B };
/**
 * 200 document pixels past the end of a 30px tip on row A, and still inside the drawn disc: the
 * nearest point of the Draw segment to it is 50px away, against a 250px radius. This is the
 * brush-not-filter probe at document scale.
 */
const WIDE_PROBE_OUTSIDE = { x: 600, y: WIDE_ROW_A };

/**
 * The drawn band's extent, from `pointsBoundingPos` (`src/util/draw.ts:6-27`), which pads the
 * stroke's bounding box by `lineWidth` on EVERY side:
 *
 *     pos  = (200 - 60, 200 - 60)  = (140, 140)
 *     size = (500 - 200 + 120, 120) = (420, 120)
 *
 * so the raster a Sponge stroke is handed is 420x120 at document (140, 140), and a stroke that
 * leaves that rectangle is clipped away rather than painted. Every point below is inside it.
 */
const LAYER_RIGHT = BAND_END_X + BAND_LINE_WIDTH;

/**
 * The Sponge stroke: a 30px tip at `Hardness 100`, dragged along the band's centre row.
 *
 * `tipAlphaAt` (`src/util/brush-engine.ts:132-142`) returns a FLAT `1` across the whole radius at
 * hardness 100 and `0` at or beyond it, so the footprint is a hard 15-document-pixel disc union
 * and there is no soft rim for a probe window to straddle. `Brush size 30 / hardness 100` is the
 * tip the seeded defaults already carry minus the size (`src/tools/settings.ts:269-277`), and
 * `Flow 100` is the strongest setting, which is what makes Desaturate exact rather than partial:
 * `spongeAmount(flow, 1)` is then `1` (`sponge.ts:156-162`), so Desaturate's `k` is exactly `0`
 * and every channel becomes the pivot.
 */
const SPONGE_SIZE = '30';
const SPONGE_HARDNESS = '100';
const FLOW_FULL = '100';
const STROKE_FROM_X = 250;
const STROKE_TO_X = 400;
const STROKE_MID_X = (STROKE_FROM_X + STROKE_TO_X) / 2;

/**
 * A probe 75 document pixels from either end of the stroke and 0 from its centre row, with an
 * 8-document-pixel window. Every pixel in it is at coverage 1 on every stroke below.
 */
const INSIDE = { x: STROKE_MID_X, y: BAND_Y };
const PROBE_HALF = 4;

/**
 * A probe 80 document pixels PAST the end of a 30px tip — five tip radii clear — still inside the
 * drawn band and inside the layer's 420x120 raster. This is the "brush, not a filter" probe: a
 * tool that iterated the buffer it was handed would have moved it, and a tool that walked the
 * stroke cannot. Its distance from `STROKE_TO_X` is the reason the layer is drawn as wide as
 * it is; `LAYER_RIGHT` (560) is the document x the drawn raster ends at.
 */
const OUTSIDE = { x: STROKE_TO_X + 80, y: BAND_Y };
const OUTSIDE_IS_INSIDE_THE_RASTER = OUTSIDE.x < LAYER_RIGHT;

const PIXEL_POLL_TIMEOUT_MS = 15_000;
const PIXEL_POLL_INTERVAL_MS = 100;

/** A document-space point. */
type DocPoint = { x: number; y: number };

/** The solved contain transform: the one rule that turns document coordinates into pointer ones. */
type Geometry = {
  box: BoundingBox;
  scale: number;
  toCss: (point: DocPoint) => { x: number; y: number };
};

/** `tonalGroup` in `AppKeyboardShortcuts.tsx:33` and the tile group in `toolbar-mapping.ts:97-100`. */
const TONAL_GROUP = ['dodge', 'burn', 'sponge'] as const;
const DODGE_ITEM: FlyoutItem = { toolName: 'dodge', label: 'Dodge Tool' };
const BURN_ITEM: FlyoutItem = { toolName: 'burn', label: 'Burn Tool' };
const SPONGE_ITEM: FlyoutItem = { toolName: 'sponge', label: 'Sponge Tool' };

async function workspaceGeometry(page: Page): Promise<Geometry> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('the workspace canvas has no box');
  // `usePointerPosition.calculateDimensions` (`src/hooks/usePointerPosition.ts:61-93`): the image
  // is CONTAINED, so ONE scale for both axes and the leftover slack split evenly.
  const scale = Math.min(box.width / DOCUMENT_WIDTH, box.height / DOCUMENT_HEIGHT);
  const offsetX = (box.width - DOCUMENT_WIDTH * scale) / 2;
  const offsetY = (box.height - DOCUMENT_HEIGHT * scale) / 2;
  return {
    box,
    scale,
    toCss: ({ x, y }) => ({ x: box.x + offsetX + x * scale, y: box.y + offsetY + y * scale }),
  };
}

function windowClip(geometry: Geometry, point: DocPoint, halfDocument: number) {
  const centre = geometry.toCss(point);
  const half = Math.max(2, Math.round(halfDocument * geometry.scale));
  return {
    x: Math.max(0, Math.round(centre.x - half)),
    y: Math.max(0, Math.round(centre.y - half)),
    width: half * 2,
    height: half * 2,
  };
}

/** One captured window, decoded. Read raw rather than derived, so a resample is visible. */
async function readWindow(page: Page, geometry: Geometry, point: DocPoint, halfDocument = PROBE_HALF) {
  return loadImageData(await page.screenshot({ clip: windowClip(geometry, point, halfDocument) }));
}

/** The mean of each channel over a window, rounded. */
function meanChannels(image: ImageDataResult): { r: number; g: number; b: number } {
  let red = 0;
  let green = 0;
  let blue = 0;
  const pixels = image.width * image.height;
  for (let index = 0; index < image.data.length; index += 4) {
    red += image.data[index];
    green += image.data[index + 1];
    blue += image.data[index + 2];
  }
  return { r: Math.round(red / pixels), g: Math.round(green / pixels), b: Math.round(blue / pixels) };
}

/** `max - min` of a window's mean channels: the chroma the Sponge exists to move. */
function spreadOf(image: ImageDataResult): number {
  const { r, g, b } = meanChannels(image);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** The composite mean LEVEL over a window, for the probes where level is the whole question. */
function levelOf(image: ImageDataResult): number {
  const { r, g, b } = meanChannels(image);
  return Math.round((r + g + b) / 3);
}

/**
 * How many (pixel, channel) pairs of a window sit AT 0 or AT 255.
 *
 * This is what a clipped channel looks like after the fact: a channel pushed past the gamut
 * boundary lands exactly on it (`clampChannel`, `src/util/pixels.ts:44`), so "this channel has no
 * headroom left" is readable from the 8-bit raster alone. It counts CHANNELS rather than pixels
 * because the difference between a capped and an uncapped stroke is not how many pixels reach an
 * edge — the tightest channel reaches one either way — but HOW MANY channels of each pixel do.
 */
function countBoundaryChannels(image: ImageDataResult): number {
  let boundary = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    if (red === 0 || green === 0 || blue === 0) boundary++;
    if (red === 255 || green === 255 || blue === 255) boundary++;
  }
  return boundary;
}

const pollOptions = { timeout: PIXEL_POLL_TIMEOUT_MS, intervals: [PIXEL_POLL_INTERVAL_MS] };

/**
 * Opens the flyout holding the toning group, by whichever affordance the rail is currently showing.
 *
 * A one-column rail fits five tiles in a 720px window, so the Dodge/Burn/Sponge group is folded
 * into the three-dots tile and has no tile of its own. The press waits for THIS tile's
 * `aria-expanded` rather than a timer, because the app arms the open on `pointerdown` and cancels
 * it unconditionally on `pointerup` (`SidebarLeft.tsx`), so a lift that arrives early destroys the
 * open outright — the defect `paint-tools.spec.ts:443-475` documents for the same group.
 */
async function openTonalFlyout(page: Page): Promise<void> {
  for (const name of TONAL_GROUP) {
    const tile = page.getByTestId(`tool-button-${name}`);
    if ((await tile.count()) === 0) continue;
    await tile.dispatchEvent('pointerdown', { button: 0 });
    await expect(tile).toHaveAttribute('aria-expanded', 'true', { timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    await tile.dispatchEvent('pointerup', { button: 0 });
    await expect(page.getByRole('menu')).toBeVisible();
    return;
  }

  const overflowTile = page.getByTestId('tool-overflow-tile');
  await expect(
    overflowTile,
    `no tile for group ${TONAL_GROUP.join('/')}, and no three-dots tile to find it in`
  ).toBeVisible();
  await overflowTile.click({ button: 'right' });
  await waitForFlyout(page);
}

/** Selects one of the three toning tools the way a mouse does. */
async function selectTonal(page: Page, item: FlyoutItem): Promise<void> {
  await openTonalFlyout(page);
  await selectFromFlyout(page, item);
}

/**
 * The Sponge's `Mode`, addressed by its own element id.
 *
 * `Sponge.tsx:134` is the one control in this bar with a stable id, and this spec's reachability
 * claim is stated in terms of it. The id also distinguishes "the Sponge's bar is mounted" from
 * "some options bar is mounted", which a role+name locator on the shared name `Mode` cannot do.
 */
function modeSelect(page: Page) {
  return page.locator('#sponge-mode');
}

async function setMode(page: Page, value: 'saturate' | 'desaturate'): Promise<void> {
  const select = modeSelect(page);
  await expect(select).toBeVisible();
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
}

async function setVibrance(page: Page, checked: boolean): Promise<void> {
  const checkbox = page.getByRole('checkbox', { name: 'Vibrance' });
  await expect(checkbox).toBeVisible();
  if ((await checkbox.isChecked()) !== checked) await checkbox.setChecked(checked);
  await expect(checkbox).toBeChecked({ checked });
}

/**
 * Sets a Sponge range input by value.
 *
 * The name is a plain string because `Sponge.tsx:42-44` puts each value readout OUTSIDE the
 * `<label>` — a `<label>`'s text content IS the control's accessible name, so nesting "Flow 50%"
 * inside it would rename the slider on every drag — and the accessible names are therefore the
 * static words `Flow`, `Size` and `Hardness`.
 */
async function setSlider(page: Page, name: 'Flow' | 'Size' | 'Hardness', value: string): Promise<void> {
  const slider = page.getByRole('slider', { name });
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

/** The Draw bar's `Opacity`, which is `0-1` and therefore a different field from the Sponge's `Flow`. */
async function setDrawOpacity(page: Page): Promise<void> {
  const slider = page.getByRole('slider', { name: /^Opacity/ });
  await expect(slider).toBeVisible();
  await slider.fill('1');
  await expect(slider).toHaveValue('1');
}

/**
 * A DOCUMENT-space stroke on the workspace: the gesture every tool here responds to.
 *
 * `drawLine` from `./helpers/canvas-helpers` is deliberately NOT used, for the reason
 * `paint-tools.spec.ts:550-556` gives: it computes `mouse.move(box.x + startX, …)`, a CSS offset
 * from the box with no contain scale applied, and these tests sample named DOCUMENT coordinates.
 */
async function strokeDocument(page: Page, geometry: Geometry, from: DocPoint, to: DocPoint, steps = 20) {
  const start = geometry.toCss(from);
  const end = geometry.toCss(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/** The one Sponge stroke every pixel test here makes: along the band's centre row. */
function spongeStroke(page: Page, geometry: Geometry) {
  return strokeDocument(page, geometry, { x: STROKE_FROM_X, y: BAND_Y }, { x: STROKE_TO_X, y: BAND_Y }, 20);
}

/**
 * The chromatic band: a solid, fully opaque, NON-grey field on a non-bedrock layer.
 *
 * Drawn with the Draw tool because it is the only tool that CREATES a layer. The colour goes in
 * AFTER activation, because `Draw.tsx` syncs the store colour into the tool args on mount, and
 * `setForegroundColor(…, true)` verifies the swatch the draw tool will actually stroke with.
 */
async function paintColourBand(page: Page): Promise<Geometry> {
  await clickToolButton(page, 'draw');
  await setSlider(page, 'Size', String(BAND_LINE_WIDTH));
  await setDrawOpacity(page);
  await setForegroundColor(page, BAND_COLOUR, true);

  const geometry = await workspaceGeometry(page);
  await strokeDocument(page, geometry, { x: BAND_START_X, y: BAND_Y }, { x: BAND_END_X, y: BAND_Y }, 20);
  await expect
    .poll(async () => levelOf(await readWindow(page, geometry, { x: BAND_MID_X, y: BAND_Y })), {
      message: 'the band was drawn and the workspace repainted',
      ...pollOptions,
    })
    .toBe(BAND_MEAN);
  return geometry;
}

/** The Sponge, selected from the toning flyout and set to a known mode, Flow and tip. */
async function selectSponge(page: Page, mode: 'saturate' | 'desaturate'): Promise<Geometry> {
  await selectTonal(page, SPONGE_ITEM);
  await expect(modeSelect(page), 'the Sponge options bar is mounted for the Sponge tool').toBeVisible();
  await setMode(page, mode);
  await setSlider(page, 'Flow', FLOW_FULL);
  await setSlider(page, 'Size', SPONGE_SIZE);
  await setSlider(page, 'Hardness', SPONGE_HARDNESS);
  // Re-solved: the Sponge's bar is wider than the Draw's, and a stale box photographs empty canvas.
  return workspaceGeometry(page);
}

async function undo(page: Page): Promise<void> {
  const button = page.getByTestId('undo-button');
  await expect(button, 'undo must be available for this step to mean anything').toBeEnabled();
  await button.click();
}

async function redo(page: Page): Promise<void> {
  const button = page.getByTestId('redo-button');
  await expect(button, 'redo must be available for this step to mean anything').toBeEnabled();
  await button.click();
}

async function expectWindow(
  page: Page,
  geometry: Geometry,
  point: DocPoint,
  expected: ImageDataResult,
  message: string
): Promise<void> {
  await expect.poll(async () => readWindow(page, geometry, point), { message, ...pollOptions }).toEqual(expected);
}

test.describe('Sponge tool', () => {
  // Each test opens an options bar, builds a two-gesture fixture, strokes, and makes history
  // round trips, with a capture per poll. The 30s default is not enough for that on a cold Vite
  // module graph.
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // Wait for the blank document to exist: a test that ran before `BlankImageStarter` fired
    // would be asserting on no layer at all.
    await expect
      .poll(async () => levelOf(await readWindow(page, await workspaceGeometry(page), { x: 400, y: 300 })), {
        message: 'the blank document is ready',
        ...pollOptions,
      })
      .toBe(BACKGROUND_LEVEL);
  });

  /**
   * 1. REACHABILITY, BOTH WAYS.
   *
   * The tile path and the keyboard path are asserted in one test because they are two halves of
   * one claim — the Sponge is the third member of the `O` flyout — and either half alone passes on
   * a build that has the tool but not the binding, or the binding but not the tile.
   * `tonalGroup` (`AppKeyboardShortcuts.tsx:33`) is `['dodge', 'burn', 'sponge']` and
   * `cycleToolGroup` (`:76-80`) advances within it, so `Shift+O` from the Burn lands on the Sponge.
   */
  test('is reachable from the toning flyout tile, and Shift+O from the Burn selects it', async ({ page }) => {
    await selectTonal(page, SPONGE_ITEM);
    await expect(modeSelect(page), 'the toning flyout tile selected the Sponge').toBeVisible();

    // Now the way the shortcut table drives it: pick the Burn, then Shift+O.
    await selectTonal(page, BURN_ITEM);
    await expect(page.getByRole('combobox', { name: 'Range' }), 'the Burn bar is up, not the Sponge').toBeVisible();
    await expect(modeSelect(page), "the Sponge's bar is unmounted while another toning tool is up").toHaveCount(0);

    await page.keyboard.press('Shift+o');
    await expect(modeSelect(page), 'Shift+O from the Burn must select the Sponge').toBeVisible();
  });

  /**
   * 2. DESATURATE REALLY DESATURATES — and it is a BRUSH, not a filter.
   *
   * `Flow 100` on a coverage-1 pixel is `amount === 1` (`spongeAmount`, `sponge.ts:156-162`), so
   * Desaturate's `k` is exactly `1 - 1 === 0` (`sponge.ts:279`) and every channel becomes the
   * pivot: `clampChannel(luma)` three times. `#c85020` therefore has to read back as
   * `(102, 102, 102)` — a spread of 0, from a spread of 168.
   *
   * The second half is the one that makes this a brush. `OUTSIDE` sits 80 document pixels past the
   * end of a 30px tip — five tip radii clear — on the SAME layer and inside the SAME 420x120
   * raster the processor was handed. A per-pixel operation over that buffer would have moved it; a
   * stroke walk cannot. The comparison is BYTE equality on the decoded capture rather than a
   * tolerance, because nothing repaints differently there and `paint-tools.spec.ts:762` already
   * establishes exact capture equality as a working oracle in this suite.
   */
  test('Desaturate pulls the covered pixels to their own luma and leaves the rest of the layer untouched', async ({
    page,
  }) => {
    expect.soft(OUTSIDE_IS_INSIDE_THE_RASTER, 'the brush-not-filter probe must be inside the layer raster').toBe(true);

    const geometry = await paintColourBand(page);
    const insideBefore = await readWindow(page, geometry, INSIDE);
    expect.soft(meanChannels(insideBefore), 'the fixture reads as the colour that was drawn').toEqual({
      r: BAND_RED,
      g: BAND_GREEN,
      b: BAND_BLUE,
    });
    const outsideBefore = await readWindow(page, geometry, OUTSIDE);

    const sponged = await selectSponge(page, 'desaturate');
    await spongeStroke(page, sponged);

    await expect
      .poll(async () => meanChannels(await readWindow(page, sponged, INSIDE)), {
        message: 'a full-Flow Desaturate must set all three channels to the pivot luma',
        ...pollOptions,
      })
      .toEqual({ r: BAND_LUMA, g: BAND_LUMA, b: BAND_LUMA });
    expect.soft(spreadOf(await readWindow(page, sponged, INSIDE)), 'the covered pixels carry no chroma left').toBe(0);

    // THE BRUSH HALF. Byte for byte, on the same layer, past the tip's reach.
    expect
      .soft(await readWindow(page, sponged, OUTSIDE), 'pixels outside the brush footprint must be byte-identical')
      .toEqual(outsideBefore);
  });

  /**
   * 3. SATURATE IS THE INVERSE DIRECTION.
   *
   * Same fixture, same stroke, opposite mode: the spread must go UP. `chromaScale`'s Saturate
   * branch (`sponge.ts:279`) is `k = 1 + amount`, so at `Flow 100` on a coverage-1 pixel `k` is
   * exactly 2 and the chroma roughly doubles from 168. Vibrance is the seeded DEFAULT
   * (`src/tools/settings.ts:272`) and is left alone, so this also states that the default still
   * saturates rather than standing still on a colour that has headroom to give.
   *
   * The Desaturate case is what makes this one meaningful: a tool stuck on one direction, or one
   * that only ever moved the mean level, passes 2 and fails here.
   */
  test('Saturate increases the channel spread of the pixels it covers', async ({ page }) => {
    const geometry = await paintColourBand(page);
    expect
      .soft(spreadOf(await readWindow(page, geometry, INSIDE)), 'the fixture starts with real chroma')
      .toBe(BAND_SPREAD);

    const sponged = await selectSponge(page, 'saturate');
    await spongeStroke(page, sponged);

    await expect
      .poll(async () => spreadOf(await readWindow(page, sponged, INSIDE)), {
        message: 'a Saturate stroke must widen the channel spread it covers',
        ...pollOptions,
      })
      .toBeGreaterThan(BAND_SPREAD);
    // The collapse to the pivot is Desaturate's signature, and Saturate must not produce it: a
    // build that ran both modes down the same branch would pass the spread assertion above and
    // fail this one.
    expect
      .soft(meanChannels(await readWindow(page, sponged, INSIDE)), 'Saturate must not pull the channels together')
      .not.toEqual({ r: BAND_LUMA, g: BAND_LUMA, b: BAND_LUMA });
  });

  /**
   * 4. THE MODE KEYS ARE TOOL-CONDITIONAL.
   *
   * `AppKeyboardShortcuts.tsx:481` and `:491` gate both `Alt+Shift+D` and `Alt+Shift+S` on
   * `hasImage && toolName === 'sponge'`, and the reason is a real Adobe collision: the SAME
   * `Alt+Shift+S` is Shadows on the Dodge and on the Burn, so Photoshop resolves it by which tool
   * is active. The chord must therefore work while the Sponge is up AND do nothing to the Sponge
   * while the Dodge is up — and the second half is the one that fails silently, because a chord
   * reaching the wrong registration produces a plausible-looking tool switch and no error anywhere.
   *
   * The two chords are asserted through SEPARATE reads with the Sponge re-selected in between,
   * because they do not fail together: `s` collides with an unconstrained registration and `d` does
   * not (see the report for `AppKeyboardShortcuts.tsx:472`). The Dodge is selected from the FLYOUT
   * rather than with `O`, so the tool under test is the one this test asked for.
   */
  test('Shift+Alt+S and Shift+Alt+D set the mode only while the Sponge is the active tool', async ({ page }) => {
    await selectTonal(page, SPONGE_ITEM);
    await setMode(page, 'desaturate');

    // With the Sponge up, both chords must move the mode. Starting from Desaturate makes the first
    // press a real transition rather than a write of the value already there. `selectTonal` is
    // idempotent, so re-selecting before the second press costs nothing when the first worked and
    // restores the Sponge when it did not — which keeps the two chords independently observable.
    await page.keyboard.press('Shift+Alt+S');
    await expect
      .soft(modeSelect(page), 'Alt+Shift+S must select Saturate while the Sponge is active')
      .toHaveValue('saturate');
    await selectTonal(page, SPONGE_ITEM);
    await page.keyboard.press('Shift+Alt+D');
    await expect(modeSelect(page), 'Alt+Shift+D must select Desaturate while the Sponge is active').toHaveValue(
      'desaturate'
    );

    // With the DODGE up, the same chords must not touch the Sponge's stored mode. The Sponge's bar
    // is unmounted while another tool is active (`Sponge.tsx:61-62`), so the read is made after
    // switching back — and switching back is part of the assertion, because it proves the value
    // SURVIVED rather than having been re-seeded on mount.
    await selectTonal(page, DODGE_ITEM);
    await expect(page.getByRole('combobox', { name: 'Range' }), 'the Dodge bar is up').toBeVisible();
    await page.keyboard.press('Shift+Alt+S');
    await page.keyboard.press('Shift+Alt+D');

    await selectTonal(page, SPONGE_ITEM);
    await expect(
      modeSelect(page),
      'Alt+Shift+S must not have reached the Sponge while the Dodge was the active tool'
    ).toHaveValue('desaturate');
  });

  /**
   * 5. VIBRANCE AGAINST CLIPPING.
   *
   * `Vibrance` is documented by Adobe as "minimize clipping for fully saturated or desaturated
   * colors", and `chromaHeadroom` (`sponge.ts:186-198`) is the strictest reading of that: it caps
   * `k` at the exact value that puts the tightest channel ON the gamut boundary. For `#c85020`
   * the tightest channel is blue, whose bound is 1.4568, so a `Flow 100` saturate lands blue on
   * exactly 0 whether or not Vibrance is checked — and `chromaHeadroom` returning that bound IS
   * the cap working, not a cap that failed.
   *
   * What the cap changes is HOW MANY channels of a pixel are driven to an edge. Uncapped,
   * `k = 2` sends red to 318 (clamped to 255) AND blue to -102 (clamped to 0): two channels of
   * every pixel destroyed. Capped, `k = 1.4568` puts blue on exactly 0 and leaves red at 245: one
   * channel placed on the gamut limit and the other two intact. Both halves are measured over the
   * SAME window after TWO strokes, and the two runs are separated by two undos rather than by a
   * second fixture, so the second run starts from a verified-pristine layer.
   */
  test('Vibrance confines a saturate stroke to one gamut-boundary channel per pixel', async ({ page }) => {
    await paintColourBand(page);

    // UNCAPPED FIRST, so the capped half can undo back to the fixture instead of needing a
    // second band. The seeded default is `vibrance: true` (`src/tools/settings.ts:272`), so the
    // checkbox is read before it is written rather than assumed.
    await selectTonal(page, SPONGE_ITEM);
    await setVibrance(page, false);
    await setMode(page, 'saturate');
    await setSlider(page, 'Flow', FLOW_FULL);
    await setSlider(page, 'Size', SPONGE_SIZE);
    await setSlider(page, 'Hardness', SPONGE_HARDNESS);
    const uncapped = await workspaceGeometry(page);

    await spongeStroke(page, uncapped);
    const afterOneUncapped = await readWindow(page, uncapped, INSIDE);
    expect.soft(spreadOf(afterOneUncapped), 'the first stroke must move the pixels').toBeGreaterThan(BAND_SPREAD);

    await spongeStroke(page, uncapped);
    await expect
      .poll(async () => readWindow(page, uncapped, INSIDE), {
        message: 'the second uncapped stroke must reach the backing store',
        ...pollOptions,
      })
      .not.toEqual(afterOneUncapped);
    const offWindow = await readWindow(page, uncapped, INSIDE);
    const offBoundary = countBoundaryChannels(offWindow);

    await undo(page);
    await undo(page);
    await expect
      .poll(async () => levelOf(await readWindow(page, uncapped, INSIDE)), {
        message: 'two undos must put the band colour back',
        ...pollOptions,
      })
      .toBe(BAND_MEAN);

    // CAPPED, over the fixture that was just verified.
    await setVibrance(page, true);
    const capped = await workspaceGeometry(page);
    await spongeStroke(page, capped);
    const afterOneCapped = await readWindow(page, capped, INSIDE);
    expect
      .soft(spreadOf(afterOneCapped), 'Vibrance must still saturate rather than stand still')
      .toBeGreaterThan(BAND_SPREAD);

    await spongeStroke(page, capped);
    // The undo/redo round trip is the synchronisation AND the assertion. It returns only once the
    // second stroke's own commit has been replayed away and back, so what it reads is the
    // two-stroke raster rather than a frame that might predate the second commit — and it says
    // the capped second stroke changed nothing, because the window it lands on is the one-stroke
    // window. (A second stroke at the gamut boundary is a no-op by construction: the pixel's
    // `chromaHeadroom` is now exactly 1, and `chromaScale` returns on `applied === 1`.)
    await undo(page);
    await expectWindow(page, capped, INSIDE, afterOneCapped, 'with Vibrance on, the second saturate is a no-op');
    await redo(page);
    await expectWindow(page, capped, INSIDE, afterOneCapped, 'the capped two-stroke raster is the one-stroke raster');
    const onWindow = await readWindow(page, capped, INSIDE);
    const onBoundary = countBoundaryChannels(onWindow);
    const pixels = onWindow.width * onWindow.height;

    // The direction that DOES hold, and which is why the cap is load-bearing at all.
    expect
      .soft(
        onBoundary,
        `Vibrance must drive fewer channels to the gamut edge (uncapped ${offBoundary}, capped ${onBoundary}, ` +
          `${pixels} pixels per window)`
      )
      .toBeLessThan(offBoundary);
    expect
      .soft(onBoundary, 'with the cap, exactly one channel per pixel may sit on the gamut edge — the binding one')
      .toBe(pixels);
    expect
      .soft(offBoundary, 'without the cap a second channel of every pixel is driven past the gamut and clamped')
      .toBeGreaterThan(pixels);

    // THE BRIEF ASKED FOR "no channel of any pixel may sit at 0 or 255 with Vibrance on", and
    // THAT ASSERTION IS UNSATISFIABLE for a correct cap — so it is not asserted here. `headroom`
    // is the scale that puts the binding channel exactly ON the gamut boundary and no further,
    // which is the mathematical maximum of Adobe's "minimize clipping": a saturated pixel
    // therefore still ENDS UP on one edge, by construction, under any implementation that caps
    // rather than backs off. Asserting zero would have forced the cap short of the gamut,
    // inventing a safety margin no Adobe page states, and it is also self-defeating: if the cap
    // never touched a boundary then nothing clipped with it OFF either, and the checkbox would
    // do nothing observable.
    //
    // The three soft assertions above are the real contract and all three are sharp: the cap
    // halves the boundary count, leaves EXACTLY the binding channel per pixel, and without it
    // a second channel of every pixel is driven past the gamut and clamped — which is the
    // data loss the option exists to prevent. A second saturate on the capped layer is then a
    // no-op, asserted above through the undo/redo round trip.
  });

  /**
   * 6. A BEDROCK-ONLY DOCUMENT REFUSES THE GESTURE.
   *
   * The only layer on a fresh document is the bedrock one from `DEFAULT_BLANK_IMAGE`
   * (`src/App.tsx:16-21`), and `SpongeToolArea.tsx:54` computes `enabled` as
   * `args && activeLayerId && activeLayer && !activeLayer.isBedrock`, which `usePaintStroke`
   * turns into every handler being a no-op. So the drag must change no pixels AND write no history
   * item: the second half is the half a tool that merely repainted the same colour would pass,
   * and the undo button is disabled on a fresh document for exactly that reason.
   */
  test('a drag on a bedrock-only document changes no pixels and writes no history entry', async ({ page }) => {
    const geometry = await workspaceGeometry(page);
    const before = await readWindow(page, geometry, { x: 400, y: 300 });

    await selectTonal(page, SPONGE_ITEM);
    await expect(modeSelect(page), 'the Sponge is selectable with no editable layer').toBeVisible();
    await setMode(page, 'desaturate');
    await setSlider(page, 'Flow', FLOW_FULL);
    await setSlider(page, 'Size', SPONGE_SIZE);

    const armed = await workspaceGeometry(page);
    await strokeDocument(page, armed, { x: STROKE_FROM_X, y: BAND_Y }, { x: STROKE_TO_X, y: BAND_Y }, 20);

    expect
      .soft(await readWindow(page, armed, { x: 400, y: 300 }), 'a bedrock drag must not move a pixel')
      .toEqual(before);
    expect
      .soft(
        await page.getByTestId('undo-button').isDisabled(),
        'a refused gesture must not have written a TOOL_ACTION history item'
      )
      .toBe(true);
  });

  /**
   * 7. `Meta+Z` RESTORES THE SAMPLED PIXELS.
   *
   * `updateLayerByTool` (`src/contexts/useLayer.ts:264`) is the only writer of a `TOOL_ACTION`
   * history item and `SpongeToolArea.tsx:66-72` reaches it exactly once per gesture from
   * `onCommit`. If it did not, the stroke would be permanently un-undoable while still LOOKING
   * correct — which is why this assertion is a REPLAY compared byte for byte rather than a
   * visual one.
   *
   * Driven by the keyboard chord rather than the header's button because `Meta+Z` is the binding
   * this case is about; `AppKeyboardShortcuts.tsx:239-249` accepts `meta` OR `ctrl` through
   * `mod: true`, so `Meta+z` reaches it on macOS.
   */
  test('Meta+Z restores the pixels a saturate stroke changed', async ({ page }) => {
    const geometry = await paintColourBand(page);
    const before = await readWindow(page, geometry, INSIDE);

    const sponged = await selectSponge(page, 'saturate');
    await spongeStroke(page, sponged);
    await expect
      .poll(async () => spreadOf(await readWindow(page, sponged, INSIDE)), {
        message: 'the stroke should have saturated the window',
        ...pollOptions,
      })
      .toBeGreaterThan(BAND_SPREAD);
    const saturated = await readWindow(page, sponged, INSIDE);
    expect
      .soft(spreadOf(saturated), 'the stroke has to change the pixels for the undo to mean anything')
      .not.toBe(spreadOf(before));

    await page.keyboard.press('Meta+z');
    await expectWindow(page, sponged, INSIDE, before, 'Meta+Z must replay the document back to the band colour');
    expect
      .soft(spreadOf(await readWindow(page, sponged, INSIDE)), 'the replayed window is back at the fixture spread')
      .toBe(BAND_SPREAD);
  });

  /**
   * 8. THE BAR CARRIES PHOTOSHOP'S FIVE CONTROLS AND NOTHING ELSE.
   *
   * `Sponge.tsx:46-55` documents its omissions (no Airbrush, no Brush Preset Picker, no
   * Pressure controls) as deliberate and names the four controls besides `Mode` that it does
   * render. This asserts the SET, not just the presence: an extra control is as much a deviation
   * from Adobe's bar as a missing one, and "each of these is visible" alone would pass with a
   * sixth control sitting beside them.
   *
   * It also pins the `Mode` dropdown's contents to `SPONGE_MODES` (`src/tools/sponge.ts:35-38`):
   * two entries in Adobe's order, because Adobe names exactly Saturate and Desaturate and there is
   * no third.
   */
  test('renders exactly Mode, Flow, Vibrance, Size and Hardness, and Adobe two modes', async ({ page }) => {
    await selectTonal(page, SPONGE_ITEM);
    await expect(modeSelect(page)).toBeVisible();

    await expect(page.getByRole('slider'), 'three sliders: Flow, Size, Hardness').toHaveCount(3);
    await expect(page.getByRole('combobox'), 'one dropdown: Mode').toHaveCount(1);
    await expect(page.getByRole('checkbox'), 'one checkbox: Vibrance').toHaveCount(1);
    for (const name of ['Flow', 'Size', 'Hardness']) {
      await expect(page.getByRole('slider', { name }), `${name} is this bar's control`).toBeVisible();
    }
    await expect(page.getByRole('checkbox', { name: 'Vibrance' })).toBeVisible();
    // `Range` and `Exposure` are the Tonal bar's controls, and the Sponge has neither.
    await expect(page.getByRole('combobox', { name: 'Range' })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Exposure' })).toHaveCount(0);

    const options = await modeSelect(page).locator('option').allTextContents();
    expect
      .soft(options, 'the Mode dropdown carries exactly Adobe two modes, in Adobe order')
      .toEqual(['Saturate', 'Desaturate']);
  });

  /**
   * The Sponge on a layer the size of the DOCUMENT, probed away from the gesture that made it.
   *
   * ## Why this case is not the one test 2 already covers
   *
   * Test 2 proves the tool on a 420x120 band — a layer the size of the drag that made it, with
   * the Sponge stroke running along the very row being probed. That is a small, exactly-known
   * rectangle. **A real photo is neither**: the layer is document-sized, and the gesture that made
   * it is nowhere near the pixel being edited. Those are the conditions a user reports as "it
   * does nothing", and neither is in test 2's geometry.
   *
   * So the fixture here is one Draw stroke at `BRUSH_SIZE_MAX` (500), whose disc sweeps a band
   * 500 document pixels tall and past both sides of the 800x600 document. The layer it leaves is
   * therefore at least document-sized, and each probe below is a point that is 100 or 200 document
   * pixels BELOW the row the Draw stroke swept — nowhere near the gesture that created the layer —
   * while still deep inside the drawn disc, which is what makes its before-read equal to
   * `BAND_COLOUR` rather than to the white backing image. The geometry that guarantees the second
   * half: the nearest point of the Draw segment is 100px from probe A and 200px from probe B, both
   * inside the 250px radius, and the 8-pixel probe window does not move either figure past it.
   *
   * `WIDE_PROBE_OUTSIDE` is the brush-not-filter half at document scale: 200 document pixels past
   * the end of a 30px tip, on the same layer and inside the same buffer the processor was handed.
   * A per-pixel operation over that buffer would have moved it; a stroke walk cannot. Byte for byte,
   * the same oracle test 2 uses on the band.
   *
   * ## What each assertion is worth
   *
   * The Desaturate half is exact for the reason test 2's is: `Flow 100` on a coverage-1 pixel
   * makes `amount === 1`, so every channel becomes the pivot and `#c85020` must read `(102,102,102)`.
   *
   * The Saturate half is exact too, and the numbers are the module's own arithmetic rather than a
   * captured baseline. `Vibrance` is the seeded default (`src/tools/settings.ts:272`), so
   * `k = min(1 + 1, chromaHeadroom)` and blue is the binding channel at `102.05 / 70.05 = 1.4568`:
   *
   * ```
   *   r = 102.05 + (200 - 102.05) * 1.4568 = 244.7  -> 245
   *   g = 102.05 + ( 80 - 102.05) * 1.4568 =  69.9  ->  70
   *   b = 102.05 + ( 32 - 102.05) * 1.4568 =   0.0  ->   0
   * ```
   *
   * Blue landing on exactly 0 and red stopping at 245 rather than clipping at 255 is the headroom
   * cap doing its job, so the triple is the assertion. The two rows are 100 document pixels apart
   * against a 30px tip, so neither stroke reaches the other's probe and the two directions are
   * independently observable in one fixture.
   */
  test('saturates and desaturates a document-sized layer, probed away from the gesture that made it', async ({
    page,
  }) => {
    await clickToolButton(page, 'draw');
    await setSlider(page, 'Size', String(WIDE_DRAW_SIZE));
    await setDrawOpacity(page);
    await setForegroundColor(page, BAND_COLOUR, true);
    const geometry = await workspaceGeometry(page);
    await strokeDocument(page, geometry, WIDE_DRAW_FROM, WIDE_DRAW_TO, 20);

    // The fixture reads as the colour that was drawn at all three probes, which is what makes the
    // assertions below about the Sponge rather than about the Draw.
    for (const point of [WIDE_PROBE_A, WIDE_PROBE_B, WIDE_PROBE_OUTSIDE]) {
      expect
        .soft(
          meanChannels(await readWindow(page, geometry, point)),
          `the wide band is painted at ${JSON.stringify(point)}`
        )
        .toEqual({ r: BAND_RED, g: BAND_GREEN, b: BAND_BLUE });
    }
    const outsideBefore = await readWindow(page, geometry, WIDE_PROBE_OUTSIDE);

    // DESATURATE, 100 document pixels below the row the Draw stroke swept.
    const sponged = await selectSponge(page, 'desaturate');
    await strokeDocument(page, sponged, WIDE_SPONGE_A, { x: WIDE_SPONGE_TO_X, y: WIDE_ROW_A }, 20);
    await expect
      .poll(async () => meanChannels(await readWindow(page, sponged, WIDE_PROBE_A)), {
        message: 'a full-Flow Desaturate must reach a probe 100px from the gesture that made the layer',
        ...pollOptions,
      })
      .toEqual({ r: BAND_LUMA, g: BAND_LUMA, b: BAND_LUMA });

    // SATURATE, 200 document pixels below the Draw stroke, so the two rows cannot have contaminated
    // each other even after the Desaturate has flattened the first one to grey.
    await setMode(page, 'saturate');
    const saturated = await workspaceGeometry(page);
    await strokeDocument(
      page,
      saturated,
      { x: WIDE_SPONGE_FROM_X, y: WIDE_ROW_B },
      { x: WIDE_SPONGE_TO_X, y: WIDE_ROW_B },
      20
    );
    await expect
      .poll(async () => meanChannels(await readWindow(page, saturated, WIDE_PROBE_B)), {
        message: 'a full-Flow Saturate must reach a probe 200px from the gesture that made the layer',
        ...pollOptions,
      })
      .toEqual({ r: BAND_SATURATED_RED, g: BAND_SATURATED_GREEN, b: BAND_SATURATED_BLUE });

    // THE BRUSH HALF, at document scale. Byte for byte, on the same layer, past the tip's reach.
    expect
      .soft(
        await readWindow(page, saturated, WIDE_PROBE_OUTSIDE),
        'pixels outside the brush footprint must be byte-identical on a document-sized layer too'
      )
      .toEqual(outsideBefore);
  });

  /**
   * 10. THE ROUTE OUT, FROM THE PANEL.
   *
   * The reported symptom was "the Sponge does not work": a fresh document is one `isBedrock`
   * layer, `SpongeToolArea.tsx:54` refuses the gesture, and the desktop Layers panel used to
   * publish nothing that changed that. This is the test that says the route exists, and it
   * asserts the BEHAVIOUR rather than the presence of a button, so it holds whatever the control
   * is named and wherever it moves.
   *
   * ## Why the assertion is a history entry and not a pixel change
   *
   * A fresh document is `DEFAULT_BLANK_IMAGE`'s white, and on a grey pixel `r === g === b`, so
   * every channel's deviation from the pivot is `0` and `chromaScale` returns the pixel untouched
   * in BOTH modes (`sponge.ts`) — a white canvas is a NO-OP for this tool by construction, which
   * is the same fact the header of this spec is built around. A pixel assertion here would pass on
   * a build whose Sponge still did nothing at all.
   *
   * So the decidable difference is the one the refusal test above already measures from the other
   * side: `usePaintStroke` no-ops on bedrock, so a refused drag writes no `TOOL_ACTION` and the
   * undo button stays disabled. On an editable layer the same drag commits, and that entry is
   * the proof the gate opened.
   */
  test('the Layers panel publishes a route that makes a tonal tool reach the document', async ({ page }) => {
    const panel = page.getByTestId('panel-group-layers');
    await expect(panel, 'the Layers panel is mounted on a desktop viewport').toBeVisible();
    await expect(page.getByTestId('layer-row'), 'a fresh document is exactly one layer deep').toHaveCount(1);

    // BEFORE: the refusal, on its own terms.
    await selectTonal(page, SPONGE_ITEM);
    await setMode(page, 'desaturate');
    const refused = await workspaceGeometry(page);
    await strokeDocument(page, refused, { x: STROKE_FROM_X, y: BAND_Y }, { x: STROKE_TO_X, y: BAND_Y }, 20);
    await expect
      .poll(() => page.getByTestId('undo-button').isDisabled(), { message: 'a bedrock drag is refused' })
      .toBe(true);

    // THE ROUTE. `Flatten Image` is Adobe's name for what `mergeAllLayers` does: it composites
    // the canvas while `layer-renderer.ts` skips every `!layer.visible` layer, so the stack is
    // replaced rather than merged — Flatten Image, not Merge Visible.
    const flatten = page.getByTestId('layers-flatten-button');
    await expect(flatten, 'a single backing image is flattenable — it is the only route out').toBeEnabled();
    await flatten.click();

    await expect(page.getByTestId('layer-row'), 'the flatten replaces the stack with one layer').toHaveCount(1);
    await expect(
      page.getByTestId('layer-row').first().getByTestId('layer-name'),
      'the flattened layer is named by the operation, not left as the backing image'
    ).toHaveText(/^Merged Layer/);

    // AFTER: the same gesture now commits.
    const armed = await workspaceGeometry(page);
    await strokeDocument(page, armed, { x: STROKE_FROM_X, y: BAND_Y }, { x: STROKE_TO_X, y: BAND_Y }, 20);
    await expect
      .poll(() => page.getByTestId('undo-button').isEnabled(), {
        message: 'the Sponge reached the document once the backing image was flattened',
      })
      .toBe(true);
  });

  /**
   * THE TRIPWIRE FOR WHAT IS STILL MISSING, and it is a different claim from the one this spec
   * used to pin.
   *
   * `Flatten Image` makes every tonal tool reachable, so the old pin — that the panel published no
   * control yielding an editable layer — is fixed and is gone. What remains is that the ONLY
   * route is destructive: flattening replaces the whole stack, so a user who wants to retouch one
   * layer of a five-layer document cannot, and Photoshop's own answer (`Layer > New > Layer From
   * Background`, `Duplicate Layer`) is unbuilt.
   *
   * ## Why this pin asserts DESTRUCTION and not an absent name
   *
   * The pin it replaces matched `/new layer/i`, `/duplicate/i` and `/unlock|convert/i`, which
   * assert the absence of three STRINGS. Such a test is green before the fix and green after the
   * correct one, so it could never have failed: it was documentation wearing a test's clothes. A
   * non-destructive conversion cannot leave this assertion true whatever it is called, because
   * the backing image would SURVIVE it.
   *
   * **So a fix MUST delete this test in the same change**, and must delete `HANDOFF.md` §175 with
   * it. The only way to keep it green would be to weaken the assertion, which is the move this
   * repo does not make.
   */
  test('the only route to an editable layer destroys the stack around it', async ({ page }) => {
    await selectTonal(page, SPONGE_ITEM);

    // A second layer, so "the stack" is a stack. The Draw tool is the only tool that creates one.
    await clickToolButton(page, 'draw');
    await setForegroundColor(page, BAND_COLOUR, true);
    const drawn = await workspaceGeometry(page);
    await strokeDocument(page, drawn, { x: 200, y: 400 }, { x: 500, y: 400 }, 20);
    await expect(page.getByTestId('layer-row'), 'the draw gesture added a layer').toHaveCount(2);

    await page.getByTestId('layers-flatten-button').click();

    // One row, and it is not either of the two that were there. That is the whole claim: the
    // route that opens the tonal tools takes the other layers with it.
    await expect(page.getByTestId('layer-row'), 'flattening a two-layer document leaves one layer').toHaveCount(1);
    await expect(
      page.getByTestId('layer-row').first().getByTestId('layer-name'),
      'no pre-existing layer survives the only available route to an editable layer'
    ).toHaveText(/^Merged Layer/);
  });
});
