import { expect, type Page, test } from '@playwright/test';
import { type BoundingBox, getWorkspaceCanvas, type ImageDataResult, loadImageData } from './helpers/canvas-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import {
  clickToolButton,
  FLYOUT_VISIBLE_TIMEOUT_MS,
  type FlyoutItem,
  navigateAndSelectInFlyout,
  openToolFlyoutViaKeyboard,
  selectFromFlyout,
} from './helpers/toolbar-helpers';

/**
 * The six Photoshop paint tools on `ps/tool-expansion`.
 *
 * ## Why the undo tripwires dominate this file
 *
 * `tempUpdateLayer` (`src/contexts/useLayer.ts:473`) is the only writer of
 * `previewLayersRef`, and `updateLayerByTool` (`:264`) is the only path that dispatches a
 * `TOOL_ACTION` history item. A tool that paints pixels without going through the second one
 * commits them with NO history entry: the stroke is permanently un-undoable, and
 * `commitDirtyTool` (`:323`) never warns, because from its point of view nothing is missing.
 * So every tool here gets a test that strokes, undoes, redoes and compares PIXELS. No other
 * e2e spec in this repository touches history at all, which is why these drive
 * `[data-testid="undo-button"]` / `[data-testid="redo-button"]` (`HistoryControls.tsx:44-55`)
 * rather than reading the store.
 *
 * ## Why the fixtures are drawn rather than uploaded
 *
 * Every one of the six refuses a bedrock layer (`isEnabled = !!activeLayer &&
 * !activeLayer.isBedrock` in each `*ToolArea.tsx`), and the only layer on a fresh document is
 * the bedrock one from `DEFAULT_BLANK_IMAGE` (`src/App.tsx:16-21`). The Draw tool is the
 * cheapest way to get a non-bedrock layer, and — see `LAYER_*` below — it hands back a layer
 * at a NON-ORIGIN `pos` for free, which is exactly the fixture the coordinate-space test
 * needs and no upload fixture in this suite provides.
 *
 * ## Why the geometry is solved rather than assumed
 *
 * The 800x600 document is CONTAINED in the workspace box, so it is scaled by the smaller axis
 * ratio and centred, and `getLocalCoords` (`src/hooks/usePointerPosition.ts:167-182`) reads
 * every sample through that. Solving it from the live box is what lets one DOCUMENT coordinate
 * drive both a pointer target and a pixel sample without either drifting, and it is why an
 * options bar reflowing the workspace is harmless: every helper here re-solves. This file never
 * divides by `devicePixelRatio` — `screenshot-scale.ts` owns that conversion, and this file
 * does not need one, because every clip is requested in CSS pixels and read at face value.
 */

/** `DEFAULT_BLANK_IMAGE.size` (`src/App.tsx:19`): the space every document coordinate lives in. */
const DOCUMENT_WIDTH = 800;
const DOCUMENT_HEIGHT = 600;

/** The Draw tool's `Size`, i.e. `lineWidth`. Wide enough that one drag is a solid field. */
const BAND_LINE_WIDTH = 60;

/** The drawn band's stroke, in DOCUMENT pixels. Every non-ramp fixture probes on this row. */
const BAND_START_X = 200;
const BAND_END_X = 500;
const BAND_Y = 200;

/**
 * `#808080` is the only `#rrggbb` value whose three channels are equal, so at `Opacity` 1 the
 * composite mean over any window is also the exact channel value — which is what lets a
 * sampled number be compared against one derived by hand.
 */
const BAND_GREY = '#808080';
const BAND_LEVEL = 128;

/** `DEFAULT_BLANK_IMAGE.color` (`src/App.tsx:17`): what an erased pixel composites to. */
const BACKGROUND_LEVEL = 255;

/**
 * The layer a `BAND_LINE_WIDTH`-wide drag from (BAND_START_X, BAND_Y) to (BAND_END_X, BAND_Y)
 * actually creates, derived from `pointsBoundingPos` (`src/util/draw.ts:6-27`), which pads the
 * stroke's bounding box by `lineWidth` on every side — not by half of it:
 *
 *     pos  = (200 - 60, 200 - 60)        = (140, 140)
 *     size = (500 - 200 + 120, 0 + 120)  = (420, 120)
 *
 * So the raster a paint processor is handed is 420x120 at (140, 140), and the document-space
 * extent of the layer is x 140..560, y 140..260. The coordinate-space test depends on these
 * numbers being exact, and says so where it uses them.
 */
const LAYER_LEFT = BAND_START_X - BAND_LINE_WIDTH;
const LAYER_RIGHT = BAND_END_X + BAND_LINE_WIDTH;

/**
 * The `Amount 0` state of a ramp built by dragging the gradient axis from `LAYER_LEFT` to here.
 * 100 document pixels is wide enough that the 30px clone tips have room to read from two
 * different places on it, and narrow enough that both ends are clear of the clamps.
 */
const RAMP_AXIS_END_X = LAYER_LEFT + 100;

/**
 * The unsharp mask is `source - factor * (source - blurred)` (`src/tools/sharpen.ts:216-223`),
 * so with `Amount 0` the tool returns before the kernel runs, and with any non-zero amount it
 * moves the pixels within `radius` of a local contrast edge. Four levels is four whole 8-bit
 * steps: far above the ±1 a 1.2x capture resample can introduce, far below the tens of levels
 * the halo actually moves.
 */
const SHARPEN_MOVE_THRESHOLD = 4;

/** `SHARPEN_AMOUNT` for these tests: 100 is a factor of 1.0 and radius 2 a 5x5 window. */
const SHARPEN_AMOUNT = '100';
const SHARPEN_RADIUS = '2';

/** Exposure above which a dodge/burn stroke is visible; 0 is the exact no-op one test compares against. */
const EXPOSURE_WORKING = '60';

/** `BRUSH_SIZE` for the tonal tools: a 30px tip, so a stroke moves a measurable patch. */
const TONAL_SIZE = '30';

/** How long a pixel poll waits, in ms. Generous: a poll succeeds on the first frame that agrees. */
const PIXEL_POLL_TIMEOUT_MS = 15_000;

/** How often a pixel poll reads, in ms. */
const PIXEL_POLL_INTERVAL_MS = 100;

/**
 * A `<role>:<accessible name>` pair, because the options bars carry no `data-testid` by house
 * rule and are located by role + name everywhere in this repository.
 */
type OptionsControl = `${'slider' | 'combobox' | 'checkbox'}:${string}`;

const SMUDGE_CONTROLS: readonly OptionsControl[] = ['slider:Size', 'slider:Hardness', 'slider:Strength'];
const SHARPEN_CONTROLS: readonly OptionsControl[] = ['slider:Amount', 'slider:Radius'];
const TONAL_CONTROLS: readonly OptionsControl[] = [
  'combobox:Range',
  'slider:Exposure',
  'slider:Size',
  'slider:Hardness',
];
const CLONE_STAMP_CONTROLS: readonly OptionsControl[] = [
  'slider:Size',
  'slider:Hardness',
  'slider:Opacity',
  'checkbox:Aligned',
];

/**
 * Every tool this spec owns. `group` is the WHOLE sidebar tile a tool shares, not one name: the
 * tile's test id is `tool-button-${primaryTool.name}` and the primary is the LAST tool chosen
 * from that group (`SidebarLeft.tsx:153`), so after a test picks the Smudge the Focus tile
 * reads `tool-button-smudge` and a spec that hard-codes `tool-button-blur` starts failing the
 * moment it selects a second tool from the same group.
 */
type PaintToolCase = {
  /** Short name, used in test titles and as the flyout item's `toolName`. */
  readonly key: string;
  /** The label `toolbar-mapping.ts` gives the tool; the flyout item slug is built from it. */
  readonly label: string;
  /** The tools in the same sidebar tile, in map order. The first is the default primary. */
  readonly group: readonly string[];
  /** The options-bar controls only this tool's bar renders. */
  readonly controls: readonly OptionsControl[];
  /** True when the tool sits in a tile of its own, so there is no flyout to open. */
  readonly ownTile: boolean;
};

const FOCUS_GROUP = ['blur', 'sharpen', 'smudge'] as const;
const DODGE_GROUP = ['dodge', 'burn'] as const;
/** The tile the Gradient tool lives in. Only the ramp fixtures need it. */

// The eraser is deliberately absent: it is not one of this tranche's new tools, it is already
// owned by `erase-fill-eyedropper.spec.ts`, and the production eraser bar is Mode/Size/Opacity/Flow
// rather than the Size/Hardness/Opacity/Spacing set a soft-tip engine would expose.
const PAINT_TOOLS: readonly PaintToolCase[] = [
  {
    key: 'clone-stamp',
    label: 'Clone Stamp Tool',
    group: ['clone-stamp'],
    controls: CLONE_STAMP_CONTROLS,
    ownTile: true,
  },
  { key: 'sharpen', label: 'Sharpen Tool', group: FOCUS_GROUP, controls: SHARPEN_CONTROLS, ownTile: false },
  { key: 'smudge', label: 'Smudge Tool', group: FOCUS_GROUP, controls: SMUDGE_CONTROLS, ownTile: false },
  { key: 'dodge', label: 'Dodge Tool', group: DODGE_GROUP, controls: TONAL_CONTROLS, ownTile: false },
  { key: 'burn', label: 'Burn Tool', group: DODGE_GROUP, controls: TONAL_CONTROLS, ownTile: false },
];

const FLYOUT_ITEM = (key: string, label: string): FlyoutItem => ({ toolName: key, label });

const SHARPEN_ITEM = FLYOUT_ITEM('sharpen', 'Sharpen Tool');
const SMUDGE_ITEM = FLYOUT_ITEM('smudge', 'Smudge Tool');
const DODGE_ITEM = FLYOUT_ITEM('dodge', 'Dodge Tool');
const BURN_ITEM = FLYOUT_ITEM('burn', 'Burn Tool');

/** A document-space point. */
type DocPoint = { x: number; y: number };

/** The solved contain transform: the one rule that turns document coordinates into pointer ones. */
type Geometry = {
  box: BoundingBox;
  /** Document pixels -> capture pixels, from `usePointerPosition`. */
  scale: number;
  toCss: (point: DocPoint) => { x: number; y: number };
};

async function workspaceGeometry(page: Page): Promise<Geometry> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Canvas not found');
  // `usePointerPosition.calculateDimensions` (`src/hooks/usePointerPosition.ts:61-93`): the
  // image is contained, so ONE scale for both axes, and the slack is split evenly.
  const scale = Math.min(box.width / DOCUMENT_WIDTH, box.height / DOCUMENT_HEIGHT);
  const offsetX = (box.width - DOCUMENT_WIDTH * scale) / 2;
  const offsetY = (box.height - DOCUMENT_HEIGHT * scale) / 2;
  return {
    box,
    scale,
    toCss: ({ x, y }) => ({ x: box.x + offsetX + x * scale, y: box.y + offsetY + y * scale }),
  };
}

const BAND_MID_X = (BAND_START_X + BAND_END_X) / 2;

/** The composite mean level over a square window, rounded to a whole 0-255 level. */
function meanLevel(image: ImageDataResult): number {
  let total = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    total += (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
  }
  return Math.round(total / (image.width * image.height));
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

/**
 * The mean level of a `halfDocument`-radius window at a DOCUMENT point.
 *
 * Every caller treats the return as a synchronisation point: this is a one-shot capture, so a
 * caller that needs a specific state polls for it (`expectLevel`) rather than reading once and
 * hoping the backing store caught up. On a LINEAR ramp a symmetric window's mean is the value at
 * its centre, which is what lets a level read at one document x be the level of the layer
 * pixel the same x maps to.
 */
async function readLevel(page: Page, geometry: Geometry, point: DocPoint, halfDocument = 3): Promise<number> {
  return meanLevel(await loadImageData(await page.screenshot({ clip: windowClip(geometry, point, halfDocument) })));
}

/**
 * The computed cursor of whatever element a page point actually hits, read through
 * `elementFromPoint` so the answer comes from hit testing rather than from a selector that
 * could be describing some other element. The options bars carry no `data-testid` by house
 * rule, and the tool area is the only thing mounted over the workspace, so a class selector
 * would be asserting the layout rather than the gate.
 */
async function cursorAt(page: Page, point: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit ? getComputedStyle(hit).cursor : null;
  }, point);
}

/**
 * A cross-section of the composite along one axis, one entry per capture pixel across it, each
 * entry averaged over the window PERPENDICULAR to the axis. Averaging that way removes the
 * resampling noise a single-row read picks up at the capture scale, and it leaves the axis
 * itself at full resolution — which is what a section is for.
 *
 * `axis` picks the direction the section runs; `fixed` is the document coordinate on the other
 * axis. A section has to CROSS a contrast edge to say anything about a filter, which is the
 * whole reason this is a function of two arguments and not of a row.
 */
async function readSection(
  page: Page,
  geometry: Geometry,
  axis: 'x' | 'y',
  fixed: number,
  fromDocument: number,
  toDocument: number,
  halfDocument = 3
): Promise<number[]> {
  const half = Math.max(2, Math.round(halfDocument * geometry.scale));
  const from = geometry.toCss({ x: axis === 'x' ? fromDocument : fixed, y: axis === 'x' ? fixed : fromDocument });
  const to = geometry.toCss({ x: axis === 'x' ? toDocument : fixed, y: axis === 'x' ? fixed : toDocument });
  const length = Math.max(4, Math.round(to.x - from.x || to.y - from.y));
  const clip =
    axis === 'x'
      ? {
          x: Math.max(0, Math.round(from.x)),
          y: Math.max(0, Math.round(from.y - half)),
          width: length,
          height: half * 2,
        }
      : {
          x: Math.max(0, Math.round(from.x - half)),
          y: Math.max(0, Math.round(from.y)),
          width: half * 2,
          height: length,
        };
  const image = await loadImageData(await page.screenshot({ clip }));
  const entries: number[] = [];
  const outer = axis === 'x' ? image.width : image.height;
  const inner = axis === 'x' ? image.height : image.width;
  for (let along = 0; along < outer; along++) {
    let total = 0;
    for (let across = 0; across < inner; across++) {
      const index = (axis === 'x' ? across * image.width + along : along * image.width + across) * 4;
      total += (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
    }
    entries.push(total / inner);
  }
  return entries;
}

/** A horizontal cross-section along a document row: it crosses a VERTICAL contrast edge. */

/** A vertical cross-section down a document column: it crosses a HORIZONTAL contrast edge. */
function readColumnProfile(
  page: Page,
  geometry: Geometry,
  docX: number,
  fromDocY: number,
  toDocY: number,
  halfDocument = 3
): Promise<number[]> {
  return readSection(page, geometry, 'y', docX, fromDocY, toDocY, halfDocument);
}

/** How many entries of `after` differ from `before` by more than `threshold`. */
function movedCount(after: readonly number[], before: readonly number[], threshold: number): number {
  let moved = 0;
  for (let index = 0; index < before.length; index++) {
    if (Math.abs(after[index] - before[index]) > threshold) moved++;
  }
  return moved;
}

/**
 * Polls one window until it reads `expected`.
 *
 * Undo and redo are asynchronous replays (`useHistory.resetHistoryTo`), and a stroke publishes
 * its pixels through `tempUpdateLayer` on a later frame, so a single read straight after either
 * can land on the frame before the write. Polling is the synchronisation, and `message` is the
 * only signal a failing run gives, so it names the assertion that broke.
 */
async function expectLevel(page: Page, geometry: Geometry, point: DocPoint, expected: number, message: string) {
  await expect
    .poll(() => readLevel(page, geometry, point), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBe(expected);
}

/** Polls one window until it has moved off `previous`. */
async function expectLevelMoved(page: Page, geometry: Geometry, point: DocPoint, previous: number, message: string) {
  await expect
    .poll(() => readLevel(page, geometry, point), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .not.toBe(previous);
}

/** Polls one window until it is strictly lighter than `level`, for a tool that lightens. */
async function expectLevelAbove(page: Page, geometry: Geometry, point: DocPoint, level: number, message: string) {
  await expect
    .poll(() => readLevel(page, geometry, point), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBeGreaterThan(level);
}

/** Polls one window until it is strictly darker than `level`, for a tool that darkens. */
async function expectLevelBelow(page: Page, geometry: Geometry, point: DocPoint, level: number, message: string) {
  await expect
    .poll(() => readLevel(page, geometry, point), {
      message,
      timeout: PIXEL_POLL_TIMEOUT_MS,
      intervals: [PIXEL_POLL_INTERVAL_MS],
    })
    .toBeLessThan(level);
}

/**
 * Polls one window until it is within `tolerance` levels of `expected`.
 *
 * Only for a window that straddles a gradient rather than a flat region: a 4-capture-pixel read
 * of a cosine-squared tip falloff samples a pixel or two either side of the dab centre, so the
 * mean lands a level or two off the tip's maximum even though the tool did exactly the right
 * thing. A tolerance used where the region IS flat would only ever hide something, which is why
 * the other assertions in this file are exact.
 */
async function expectLevelWithin(
  page: Page,
  geometry: Geometry,
  point: DocPoint,
  expected: number,
  tolerance: number,
  message: string
) {
  const options = {
    message,
    timeout: PIXEL_POLL_TIMEOUT_MS,
    intervals: [PIXEL_POLL_INTERVAL_MS],
  };
  await expect.poll(() => readLevel(page, geometry, point), options).toBeLessThanOrEqual(expected + tolerance);
  await expect.poll(() => readLevel(page, geometry, point), options).toBeGreaterThanOrEqual(expected - tolerance);
}

async function longPressGroupTile(page: Page, group: readonly string[]): Promise<void> {
  for (const name of group) {
    const tile = page.getByTestId(`tool-button-${name}`);
    if ((await tile.count()) === 0) continue;
    // Press, wait for THIS tile's flyout, then lift — in that order, because that is the
    // gesture the app's own handler requires.
    await tile.dispatchEvent('pointerdown', { button: 0 });
    // `aria-expanded` is set from `openGroup === groupIndex` on the pressed tile, so it is
    // true only once this group is the open one. This used to be a fixed
    // `waitForTimeout(FLYOUT_LONG_PRESS_MS)`, which raced the app's 300ms timer with a
    // margin — and `onPointerUp` calls `clearLongPressFlyout()` unconditionally, so a lift
    // that arrived first cancelled the open outright: the menu never appeared, and the
    // failure surfaced as a `toBeVisible()` timeout on a menu that had not been opened yet.
    // That reads as a product defect rather than as a bad wait, which is how it kept being
    // blamed on whichever tool the run happened to be on.
    await expect(tile).toHaveAttribute('aria-expanded', 'true', { timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    await tile.dispatchEvent('pointerup', { button: 0 });
    await expect(page.getByRole('menu')).toBeVisible();
    return;
  }
  throw new Error(`No sidebar tile found for group ${group.join('/')}`);
}

/** Selects a grouped tool the way a mouse does: sustained press on the tile, then the flyout item. */
async function selectGroupedTool(page: Page, group: readonly string[], item: FlyoutItem): Promise<void> {
  await longPressGroupTile(page, group);
  await selectFromFlyout(page, item);
}

async function expectOptionsBar(page: Page, controls: readonly OptionsControl[]): Promise<void> {
  for (const control of controls) {
    const [role, name] = control.split(':') as ['slider' | 'combobox' | 'checkbox', string];
    await expect(page.getByRole(role, { name }), `${control} is this tool's options-bar control`).toBeVisible();
  }
}

/**
 * Sets a range input by value. `name` is a RegExp where the bar nests its readout inside the
 * label — the Draw bar's sliders read "Size 60px" and "Opacity 90%", so matching the static
 * prefix is what survives a drag — and a plain string where an `aria-label` carries the name on
 * its own, which is how every one of the six paint bars is built.
 */
async function setSlider(page: Page, name: string | RegExp, value: string): Promise<void> {
  const slider = page.getByRole('slider', { name });
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

async function setTonalRange(page: Page, value: string): Promise<void> {
  const select = page.getByRole('combobox', { name: 'Range' });
  await expect(select).toBeVisible();
  await select.selectOption(value);
  await expect(select).toHaveValue(value);
}

async function setAligned(page: Page, checked: boolean): Promise<void> {
  const checkbox = page.getByRole('checkbox', { name: 'Aligned' });
  await expect(checkbox).toBeVisible();
  if ((await checkbox.isChecked()) !== checked) await checkbox.setChecked(checked);
  await expect(checkbox).toBeChecked({ checked });
}

/**
 * A DOCUMENT-space stroke on the workspace: the gesture all six tools respond to.
 *
 * `drawLine` is deliberately NOT used here even though it is the house helper for exactly this.
 * It computes `mouse.move(box.x + startX, box.y + startY)`, so the numbers it is given are CSS
 * offsets from the box with NO contain scale applied. The other e2e specs can afford that — a
 * stroke that lands a few dozen pixels off still lands on the canvas — but these tests sample
 * specific document coordinates, and an unscaled pointer offset shifts the stroke to a different
 * document point than the one the assertion names. Going through `toCss` keeps the pointer and
 * the pixel sample on the same solved transform.
 */
async function strokeDocument(page: Page, geometry: Geometry, from: DocPoint, to: DocPoint, steps = 20): Promise<void> {
  const start = geometry.toCss(from);
  const end = geometry.toCss(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

/**
 * The band fixture: a solid, fully opaque, mid-grey field on a non-bedrock layer at a
 * NON-ORIGIN `pos` (see `LAYER_*`).
 *
 * Drawn with the Draw tool because it is the only tool that CREATES a layer — every one of the
 * six edits the active layer in place — and at `Opacity 1` so the composite IS the drawn colour
 * rather than a blend of it with the white bedrock.
 */
async function paintBand(page: Page): Promise<Geometry> {
  await clickToolButton(page, 'draw');
  await setSlider(page, /^Size/, String(BAND_LINE_WIDTH));
  await setSlider(page, /^Opacity/, '1');
  // The colour goes in AFTER activation: `Draw.tsx:29-33` syncs the store colour into the tool
  // args on mount, and `verifySwatch` asserts the store the draw tool actually strokes with.
  await setForegroundColor(page, BAND_GREY, true);

  const geometry = await workspaceGeometry(page);
  await strokeDocument(page, geometry, { x: BAND_START_X, y: BAND_Y }, { x: BAND_END_X, y: BAND_Y }, 20);
  await expectLevel(
    page,
    geometry,
    { x: BAND_MID_X, y: BAND_Y },
    BAND_LEVEL,
    'the grey band was drawn and the workspace repainted'
  );
  return geometry;
}

/**
 * The band plus a black-to-white linear gradient across it, from `defaultSettings.gradient`
 * (`src/tools/settings.ts:204-211`: `colorA: '#000000'`, `colorB: '#FFFFFF'`, `alpha: 1`).
 *
 * This exists because a smudge and a tonal `Range` are both identity maps on a FLAT field: a
 * smudge blends each texel with the one behind it (`src/tools/smudge.ts:150-158`), and
 * `tonalWeight` is 1 for every pixel of a uniform grey, so a flat band can show neither. The
 * gradient supplies both a real colour gradient to displace and two luma extremes to select
 * between. `gradient()` clamps outside its axis (`src/tools/gradient.ts:139-140`), so the field
 * is a ramp over the axis and then `colorB` for the rest of the layer.
 *
 * `endDocX` is the axis end: pass `LAYER_RIGHT` for a ramp across the whole layer, or
 * `RAMP_AXIS_END_X` for a short axis with a hard step at its end.
 */
async function paintRampBand(page: Page, endDocX: number): Promise<Geometry> {
  await paintBand(page);
  // The Gradient is its own single-tool tile, so it has no flyout to long-press: a plain
  // click on the tile selects it. The bucket stays in the erase-and-fill flyout it has
  // always shared, so there is no group to open here.
  await clickToolButton(page, 'gradient');
  // Re-solve: the Gradient bar is wide enough to reflow the workspace, and a box measured
  // before it opened clips empty canvas (e2e/OPEN_PROBLEMS.md).
  const ramped = await workspaceGeometry(page);
  await strokeDocument(page, ramped, { x: LAYER_LEFT, y: BAND_Y }, { x: endDocX, y: BAND_Y }, 10);
  return ramped;
}

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

/**
 * The undo/redo contract, driven identically for all six tools.
 *
 * `before` is read, the tool strokes, `after` is polled until it differs (so it is never a
 * pre-repaint frame), then undo is polled back to `before` and redo back to `after`. The soft
 * pair is what makes one failed run report both directions instead of stopping at the first.
 */
async function assertUndoRestoresPixels(
  page: Page,
  geometry: Geometry,
  point: DocPoint,
  before: number,
  after: number,
  subject: string
): Promise<void> {
  expect.soft(await readLevel(page, geometry, point), `${subject}: the stroke changed the pixels`).toBe(after);
  await undo(page);
  await expectLevel(page, geometry, point, before, `${subject}: undo did not restore the original pixels`);
  await redo(page);
  await expectLevel(page, geometry, point, after, `${subject}: redo did not re-apply the pixels`);
}

test.describe('Paint tools', () => {
  // Each of these tests opens an options bar, builds a one or two layer fixture, strokes, and
  // then makes three history round trips, with a capture per poll. The suite's 30s default is
  // not enough for that on a cold Vite module graph.
  test.describe.configure({ timeout: 120_000 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    // Wait for the blank document to exist. Every one of the six refuses a bedrock layer, so a
    // test that ran before `BlankImageStarter` fired would be asserting on no layer at all.
    await expectLevel(
      page,
      await workspaceGeometry(page),
      { x: 400, y: 300 },
      BACKGROUND_LEVEL,
      'the blank document is ready'
    );
  });

  test.describe('Toolbar reachability', () => {
    for (const tool of PAINT_TOOLS) {
      test(`the ${tool.key} tool is selectable from the sidebar`, async ({ page }) => {
        if (tool.ownTile) {
          await clickToolButton(page, tool.key);
        } else {
          await selectGroupedTool(page, tool.group, FLYOUT_ITEM(tool.key, tool.label));
        }
        await expectOptionsBar(page, tool.controls);
      });

      test(`the ${tool.key} tool is reachable by keyboard alone`, async ({ page }) => {
        if (tool.ownTile) {
          // A single-tool group has no flyout, so its keyboard path is Enter on its own tile.
          const tile = page.getByTestId(`tool-button-${tool.key}`);
          await tile.focus();
          await tile.press('Enter');
        } else {
          // `openToolFlyoutViaKeyboard` waits for the FOCUS to land, which is the whole point:
          // the opener waits one requestAnimationFrame after the menu becomes visible, and an
          // Enter arriving in that frame is handled by the tool button again — it re-opens the
          // flyout instead of activating an item. Never pair `waitForFlyout` with `Enter`.
          await openToolFlyoutViaKeyboard(page, tool.group[0]);
          await navigateAndSelectInFlyout(page, tool.key, tool.label);
          await expect(page.getByRole('menu')).toBeHidden();
        }
        await expectOptionsBar(page, tool.controls);
      });
    }
  });

  test.describe('Sharpen', () => {
    /**
     * The section runs DOWN a column through the middle of the band, so it crosses both
     * horizontal edges of the stroke (document y 170 and 230, the band's `BAND_Y` +/- its
     * `BAND_LINE_WIDTH` / 2). A section along the band's own centre row would be 128 from end
     * to end and could not see a filter that only moves pixels within its radius of an edge.
     */
    const COLUMN_X = BAND_MID_X;
    const COLUMN_FROM_Y = BAND_Y - BAND_LINE_WIDTH / 2 - 20;
    const COLUMN_TO_Y = BAND_Y + BAND_LINE_WIDTH / 2 + 20;

    async function bandEdgeProfile(page: Page): Promise<number[]> {
      return readColumnProfile(page, await workspaceGeometry(page), COLUMN_X, COLUMN_FROM_Y, COLUMN_TO_Y);
    }

    test('a non-zero Amount moves the pixels along the band edge', async ({ page }) => {
      await paintBand(page);
      const before = await bandEdgeProfile(page);

      await selectGroupedTool(page, FOCUS_GROUP, SHARPEN_ITEM);
      await setSlider(page, 'Amount', SHARPEN_AMOUNT);
      await setSlider(page, 'Radius', SHARPEN_RADIUS);
      const after = await bandEdgeProfile(page);

      expect
        .soft(
          movedCount(after, before, SHARPEN_MOVE_THRESHOLD),
          'an unsharp mask must move the pixels within its radius of a contrast edge'
        )
        .toBeGreaterThan(0);
    });

    test('Amount back at zero is an exact no-op', async ({ page }) => {
      await paintBand(page);
      await selectGroupedTool(page, FOCUS_GROUP, SHARPEN_ITEM);
      await setSlider(page, 'Amount', '0');
      await setSlider(page, 'Radius', SHARPEN_RADIUS);
      const atZero = await bandEdgeProfile(page);

      await setSlider(page, 'Amount', SHARPEN_AMOUNT);
      const moved = await bandEdgeProfile(page);
      expect
        .soft(
          movedCount(moved, atZero, SHARPEN_MOVE_THRESHOLD),
          'the trip through a non-zero Amount has to change something, or the exactness below is vacuous'
        )
        .toBeGreaterThan(0);

      await setSlider(page, 'Amount', '0');
      const backAtZero = await bandEdgeProfile(page);
      // Exact, not approximate: `src/tools/sharpen.ts:222-225` returns before the kernel runs
      // when the factor is zero, so the raster has to come back byte for byte. A tolerance here
      // would hide the only failure that matters — a filter that leaves a residue behind.
      expect.soft(backAtZero, 'Amount 0 must restore the raster exactly').toEqual(atZero);
    });

    test('undo restores the pixels that sharpening changed', async ({ page }) => {
      await paintBand(page);
      const pristine = await bandEdgeProfile(page);

      await selectGroupedTool(page, FOCUS_GROUP, SHARPEN_ITEM);
      await setSlider(page, 'Amount', SHARPEN_AMOUNT);
      await setSlider(page, 'Radius', SHARPEN_RADIUS);
      const sharpened = await bandEdgeProfile(page);
      expect
        .soft(
          movedCount(sharpened, pristine, SHARPEN_MOVE_THRESHOLD),
          'sharpening has to change pixels for the undo to mean anything'
        )
        .toBeGreaterThan(0);

      // Sharpen is a one-shot FILTER, not a gesture. Nothing is in history until
      // `commitDirtyTool` (`src/contexts/useLayer.ts:323`) promotes the preview, and a tool
      // switch is what calls it (`goToTool`, `src/hooks/useApp.ts:155-158`). Undo BEFORE the
      // switch would pop the draw instead, so the bake is part of the contract under test
      // rather than a convenience.
      await clickToolButton(page, 'reposition');
      await expect(page.getByRole('slider', { name: 'Amount' })).toHaveCount(0);
      const baked = await bandEdgeProfile(page);
      expect
        .soft(
          movedCount(baked, pristine, SHARPEN_MOVE_THRESHOLD),
          'the tool switch must bake the sharpen into the layer'
        )
        .toBeGreaterThan(0);

      await undo(page);
      const undone = await bandEdgeProfile(page);
      expect
        .soft(movedCount(undone, pristine, SHARPEN_MOVE_THRESHOLD), 'undo must take the sharpening off the layer')
        .toBe(0);
      expect
        .soft(
          movedCount(undone, baked, SHARPEN_MOVE_THRESHOLD),
          'undo must have undone the sharpening rather than the draw'
        )
        .toBeGreaterThan(0);

      await redo(page);
      const redone = await bandEdgeProfile(page);
      expect
        .soft(movedCount(redone, baked, SHARPEN_MOVE_THRESHOLD), 'redo must re-apply the sharpening exactly')
        .toBe(0);
    });
  });

  test.describe('Smudge', () => {
    /** The ramp axis is 100 document pixels wide, so a document x inside it reads `255 * x / 100`. */
    const ON_PATH = { x: 180, y: BAND_Y };
    /** Behind the drag start, outside every 30px dab's 15px radius. */
    const BEHIND_THE_PATH = { x: 150, y: BAND_Y };
    /** Past the end of the axis, so the field there is `colorB` all the way to the drag's end. */
    const PAST_THE_AXIS = { x: 300, y: BAND_Y };

    async function selectSmudge(page: Page): Promise<Geometry> {
      await selectGroupedTool(page, FOCUS_GROUP, SMUDGE_ITEM);
      await setSlider(page, 'Size', TONAL_SIZE);
      await setSlider(page, 'Hardness', '100');
      await setSlider(page, 'Strength', '100');
      return workspaceGeometry(page);
    }

    test('a smudge stroke displaces the ramp along the drag and leaves the rest alone', async ({ page }) => {
      const geometry = await paintRampBand(page, RAMP_AXIS_END_X);
      const onPathBefore = await readLevel(page, geometry, ON_PATH);
      const behindBefore = await readLevel(page, geometry, BEHIND_THE_PATH);
      const pastBefore = await readLevel(page, geometry, PAST_THE_AXIS);
      // A linear ramp is what makes the control points meaningful. The axis is 100 document
      // pixels wide, so these three probes sit at 10%, at 40% and past its end — `255 * x / 100`
      // puts them at 26, 102 and 255. They are NOT asserted as exact values: a read window
      // straddles its centre by up to half a capture pixel and the ramp climbs 2.55 levels per
      // document pixel, so a derived constant would be asserting the capture resampling as much
      // as the ramp. What has to hold is that the three are distinct and ordered, so a
      // displacement at one of them cannot be a displacement of either of the others.
      expect.soft(behindBefore, 'the probe behind the drag is the darkest of the three').toBeLessThan(onPathBefore);
      expect.soft(onPathBefore, 'the probe on the path is the middle of the three').toBeLessThan(pastBefore);
      expect.soft(pastBefore, 'past the axis the field is colorB').toBe(BACKGROUND_LEVEL);

      const smudged = await selectSmudge(page);
      await strokeDocument(page, smudged, ON_PATH, { x: PAST_THE_AXIS.x, y: BAND_Y }, 30);

      // `smudgeDab` reads the texel one stroke-segment BEHIND each dab centre and writes it
      // forward, so a rightward drag over a ramp that darkens to the left pulls DARKER colour
      // in: the start of the path has to darken, a point behind the start has to stay put, and
      // the far end — whose dabs all read from further white — has to stay white too.
      await expectLevelBelow(
        page,
        smudged,
        ON_PATH,
        onPathBefore,
        'a rightward smudge over a left-darkening ramp should darken the start of the path'
      );
      expect
        .soft(
          await readLevel(page, smudged, BEHIND_THE_PATH),
          'a point behind the drag start is outside every dab and must be untouched'
        )
        .toBe(behindBefore);
      expect
        .soft(
          await readLevel(page, smudged, PAST_THE_AXIS),
          'colour is only displaced along the drag, so the far end keeps the value it had'
        )
        .toBe(pastBefore);
    });

    test('undo restores the pixels a smudge stroke displaced', async ({ page }) => {
      const geometry = await paintRampBand(page, RAMP_AXIS_END_X);
      const before = await readLevel(page, geometry, ON_PATH);

      const smudged = await selectSmudge(page);
      await strokeDocument(page, smudged, ON_PATH, { x: PAST_THE_AXIS.x, y: BAND_Y }, 30);
      await expectLevelMoved(page, smudged, ON_PATH, before, 'the smudge should have displaced the ramp');

      const after = await readLevel(page, smudged, ON_PATH);
      await assertUndoRestoresPixels(page, smudged, ON_PATH, before, after, 'smudge');
    });
  });

  test.describe('Dodge', () => {
    /** `t = (180 - 140) / 420 = 0.0952`, so the full-axis ramp reads `255 * 0.0952 = 24` here. */
    const DARK_END = { x: 180, y: BAND_Y };
    /** `t = (520 - 140) / 420 = 0.9048` -> 231, past the 128 split and short of the white stop. */
    const LIGHT_END = { x: 520, y: BAND_Y };

    async function selectDodge(page: Page, range: string): Promise<Geometry> {
      await selectGroupedTool(page, DODGE_GROUP, DODGE_ITEM);
      await setTonalRange(page, range);
      await setSlider(page, 'Size', TONAL_SIZE);
      await setSlider(page, 'Exposure', EXPOSURE_WORKING);
      return workspaceGeometry(page);
    }

    test('a dodge stroke lightens the pixels it covers', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const before = await readLevel(page, geometry, DARK_END);
      expect.soft(before, 'the probe sits in the dark end of the ramp').toBe(24);

      const dodged = await selectDodge(page, 'shadows');
      await strokeDocument(page, dodged, DARK_END, { x: DARK_END.x + 2, y: DARK_END.y }, 2);

      await expectLevelAbove(page, dodged, DARK_END, before, 'a dodge stroke must lighten the pixels it covers');
    });

    test('undo restores the pixels a dodge stroke lightened', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const before = await readLevel(page, geometry, DARK_END);

      const dodged = await selectDodge(page, 'shadows');
      await strokeDocument(page, dodged, DARK_END, { x: DARK_END.x + 2, y: DARK_END.y }, 2);
      await expectLevelMoved(page, dodged, DARK_END, before, 'the dodge should have lightened the pixels');

      const after = await readLevel(page, dodged, DARK_END);
      await assertUndoRestoresPixels(page, dodged, DARK_END, before, after, 'dodge');
    });

    test('Range decides which end of the ramp a dodge stroke moves', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const darkBefore = await readLevel(page, geometry, DARK_END);
      const lightBefore = await readLevel(page, geometry, LIGHT_END);
      // The whole point of the range is the 128 split of `tonalWeight`
      // (`src/tools/dodgeBurn.ts:53-59`), so the two probes are stated as the measured fact
      // they are: one on each side of it, and neither at a stop, which is what makes "untouched"
      // an observation rather than a property of white or black.
      expect.soft(darkBefore, 'the dark probe is below the 128 tonal split').toBeLessThan(128);
      expect.soft(lightBefore, 'the light probe is above the 128 tonal split').toBeGreaterThan(128);

      const shadows = await selectDodge(page, 'shadows');
      await strokeDocument(page, shadows, DARK_END, { x: DARK_END.x + 2, y: DARK_END.y }, 2);
      // Read the light end only once the dark end has settled, so the two are not read off
      // different frames of the same stroke.
      await expectLevelAbove(
        page,
        shadows,
        DARK_END,
        darkBefore,
        'a Shadows dodge has to move the dark end for the untouched light end to mean anything'
      );

      expect
        .soft(
          await readLevel(page, shadows, LIGHT_END),
          'a Shadows dodge must leave the highlights end of the ramp exactly where it was'
        )
        .toBe(lightBefore);
    });
  });

  test.describe('Burn', () => {
    /** The middle of the full-axis ramp: `t = 0.5` -> 128, which straddles the split either way. */
    const MID = { x: 350, y: BAND_Y };

    async function selectBurn(page: Page, exposure: string): Promise<Geometry> {
      await selectGroupedTool(page, DODGE_GROUP, BURN_ITEM);
      await setTonalRange(page, 'midtones');
      await setSlider(page, 'Size', TONAL_SIZE);
      await setSlider(page, 'Exposure', exposure);
      return workspaceGeometry(page);
    }

    test('a burn stroke darkens the pixels it covers', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const before = await readLevel(page, geometry, MID);

      const burned = await selectBurn(page, EXPOSURE_WORKING);
      await strokeDocument(page, burned, MID, { x: MID.x + 2, y: MID.y }, 2);

      await expectLevelBelow(page, burned, MID, before, 'a burn stroke must darken the pixels it covers');
    });

    test('undo restores the pixels a burn stroke darkened', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const before = await readLevel(page, geometry, MID);

      const burned = await selectBurn(page, EXPOSURE_WORKING);
      await strokeDocument(page, burned, MID, { x: MID.x + 2, y: MID.y }, 2);
      await expectLevelMoved(page, burned, MID, before, 'the burn should have darkened the pixels');

      const after = await readLevel(page, burned, MID);
      await assertUndoRestoresPixels(page, burned, MID, before, after, 'burn');
    });

    test('Exposure at zero leaves the pixels exactly as they were', async ({ page }) => {
      const geometry = await paintRampBand(page, LAYER_RIGHT);
      const before = await readLevel(page, geometry, MID);

      const zero = await selectBurn(page, '0');
      await strokeDocument(page, zero, MID, { x: MID.x + 2, y: MID.y }, 2);
      // `src/tools/dodgeBurn.ts:157-166` returns before the kernel when the exposure is zero, so
      // not one level may move. A tolerance would make the test a weaker version of every other
      // assertion in this file, which is why it is exact.
      expect.soft(await readLevel(page, zero, MID), 'Exposure 0 must not move a single level').toBe(before);

      const working = await selectBurn(page, EXPOSURE_WORKING);
      await strokeDocument(page, working, MID, { x: MID.x + 2, y: MID.y }, 2);
      await expectLevelMoved(
        page,
        working,
        MID,
        before,
        'a non-zero Exposure has to move the very same stroke, or the zero case above proves nothing'
      );
    });
  });

  test.describe('Clone stamp', () => {
    /**
     * The source is Alt-clicked at document x 200 and the stroke runs 160 -> 180, all on the
     * 100-pixel ramp axis, so every one of the four numbers below is a position on a KNOWN ramp
     * rather than a value derived from the clone algorithm:
     *
     *   source        document 200 -> layer 60
     *   stroke start  document 160 -> layer 20
     *   stroke end    document 180 -> layer 40   (a 20px displacement)
     *
     * `cloneAligned` offsets by `source - points[0]` (`src/tools/cloneStamp.ts:88-94`), so the
     * first dab — which writes at layer 20 — reads layer 60, the source itself. `cloneUnaligned`
     * offsets by `source - points[n-1]` (`:96-102`), so the same dab reads layer 20 + (60 - 40) =
     * 40. The two arms therefore read 20 layers apart on a ramp that spans 0..255, which is
     * 51 levels apart and unmissable.
     */
    const SOURCE = { x: 200, y: BAND_Y };
    const DRAG_FROM = { x: 160, y: BAND_Y };
    const DRAG_TO = { x: 180, y: BAND_Y };

    /** The level the ramp holds at the layer pixel a document x maps to, read from the document. */
    function rampLevelAt(page: Page, geometry: Geometry, docX: number): Promise<number> {
      return readLevel(page, geometry, { x: docX, y: BAND_Y });
    }

    async function selectCloneStamp(page: Page): Promise<Geometry> {
      await clickToolButton(page, 'clone-stamp');
      await setSlider(page, 'Size', TONAL_SIZE);
      return workspaceGeometry(page);
    }

    async function altClickSource(page: Page, geometry: Geometry): Promise<void> {
      // `CloneStampToolArea.tsx:186-195` accepts EITHER the Alt modifier on the pointer event or
      // a tracked Alt keypress, so the real key is held and the app sees both.
      await page.keyboard.down('Alt');
      const point = geometry.toCss(SOURCE);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up('Alt');
    }

    test('a clone stamp stroke with no source set changes nothing and throws nothing', async ({ page }) => {
      const unsourced = await paintRampBand(page, RAMP_AXIS_END_X);
      const probe = { x: 400, y: BAND_Y };
      const before = await readLevel(page, unsourced, probe);
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const armed = await selectCloneStamp(page);
      // `source` is null until Alt-clicked, and the hook runs with `enabled: false`, so the
      // gesture is IGNORED rather than refused: no pixels, no history item, no error.
      //
      // THE CURSOR IS THE GATE, and it is the only observable. `buildLayerArgs` returns null for
      // a null source, so `onMove` and `onCommit` both return on it and an unsourced stroke
      // changes nothing whether or not `isEnabled` consulted `args.source` — the gate and its
      // absence are pixel-identical. `CloneStampToolArea` puts `cursor-not-allowed` on the
      // tool area exactly when `isEnabled` is false, and the source is the only one of its
      // three conditions missing here, so this is the one thing a broken gate moves.
      await expect
        .poll(() => cursorAt(page, armed.toCss(probe)), {
          message: 'the tool area must refuse the gesture while no source is set',
        })
        .toBe('not-allowed');
      await strokeDocument(page, armed, probe, { x: probe.x + 20, y: probe.y }, 8);

      expect.soft(pageErrors, 'an unsourced stroke must not raise').toEqual([]);
      // Kept as a regression guard on the callbacks themselves, not as the test of the gate:
      // see above, this read is the same whether the gate is there or not.
      expect.soft(await readLevel(page, armed, probe), 'an unsourced stroke must not stamp').toBe(before);
    });

    test('an aligned clone stamp stroke copies the source under the pointer', async ({ page }) => {
      const geometry = await paintRampBand(page, RAMP_AXIS_END_X);
      // Both levels are read off the ramp in the same test rather than derived from
      // `255 * layerX / 100`, so the assertion is about WHERE the stroke read from and not about
      // whether the derivation of the gradient's projection agrees with it.
      const sourceLevel = await rampLevelAt(page, geometry, SOURCE.x);
      const destinationBefore = await rampLevelAt(page, geometry, DRAG_FROM.x);
      expect
        .soft(
          Math.abs(sourceLevel - destinationBefore),
          'the source and the destination have to be different levels or the copy proves nothing'
        )
        .toBeGreaterThan(40);

      const armed = await selectCloneStamp(page);
      await setAligned(page, true);
      await altClickSource(page, armed);
      await strokeDocument(page, armed, DRAG_FROM, DRAG_TO, 8);

      // Compared with a two-level tolerance rather than exactly, and the tolerance is the READ
      // WINDOW, not the copy: the destination is 40 document pixels from the source, so these are
      // two different windows and each straddles its own centre by up to half a capture pixel,
      // which on this ramp is worth about one level. It cannot hide a swapped arm: the two arms
      // land 50+ levels apart, and the destination started 50+ levels from both.
      await expectLevelWithin(
        page,
        armed,
        DRAG_FROM,
        sourceLevel,
        2,
        'an aligned stroke should have stamped the source level onto the destination'
      );
    });

    test('an unaligned clone stamp stroke reads from the point the drag displaces', async ({ page }) => {
      const geometry = await paintRampBand(page, RAMP_AXIS_END_X);
      // Layer 40 is the source layer (60) less the 20px displacement of the drag, so this is the
      // level the unaligned arm has to read — a different point on the ramp from the source.
      const displacedLevel = await rampLevelAt(page, geometry, DRAG_TO.x);
      const sourceLevel = await rampLevelAt(page, geometry, SOURCE.x);
      expect
        .soft(
          Math.abs(sourceLevel - displacedLevel),
          'the displaced read position has to differ from the source or the checkbox proves nothing'
        )
        .toBeGreaterThan(40);

      const armed = await selectCloneStamp(page);
      await setAligned(page, false);
      await altClickSource(page, armed);
      await strokeDocument(page, armed, DRAG_FROM, DRAG_TO, 8);

      // Same two-level read-window tolerance as the aligned arm above, and the same reason it
      // cannot hide a failure: the source level and the displaced level are more than 40 levels
      // apart on this ramp, so landing on the wrong one is not within reach of the tolerance.
      await expectLevelWithin(
        page,
        armed,
        DRAG_FROM,
        displacedLevel,
        2,
        'an unaligned stroke should have read from the displaced point rather than the source'
      );
    });

    test('undo restores the pixels a clone stamp stroke copied', async ({ page }) => {
      const ramped = await paintRampBand(page, RAMP_AXIS_END_X);
      const before = await rampLevelAt(page, ramped, DRAG_FROM.x);

      const armed = await selectCloneStamp(page);
      await setAligned(page, true);
      await altClickSource(page, armed);
      await strokeDocument(page, armed, DRAG_FROM, DRAG_TO, 8);
      await expectLevelMoved(
        page,
        armed,
        DRAG_FROM,
        before,
        'the aligned clone should have stamped over the destination'
      );

      const after = await readLevel(page, armed, DRAG_FROM);
      await assertUndoRestoresPixels(page, armed, DRAG_FROM, before, after, 'clone stamp');
    });
  });
});
