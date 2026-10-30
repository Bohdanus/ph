import { expect, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas, type BoundingBox, type ImageDataResult, loadImageData } from './helpers/canvas-helpers';
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
 * Dodge and Burn tools (the Tonal bar), focusing on four gaps not covered by `paint-tools.spec.ts`:
 *
 * 1. The "brush, not a filter" assertion: pixels outside the brush footprint are byte-identical.
 * 2. The intentional absence of Photoshop's "Protect Skin Tone" checkbox.
 * 3. The shared-bar identity switch: only the active tool's id prefix appears in the DOM.
 * 4. The keyboard Range shortcuts (Alt+Shift+S/M/H) fire only when a tonal tool is active.
 *
 * Existing coverage in `paint-tools.spec.ts` (Dodge at ~942, Burn at ~1014) already tests
 * lightening/darkening, undo, the Range selectivity, and the Exposure-0 no-op, so those are NOT
 * re-asserted here.
 *
 * This spec mirrors the structure and helpers from `sponge-tool.spec.ts`, which shares the same
 * `O` flyout group and coordinate-space needs.
 */

const DOCUMENT_WIDTH = 800;
const DOCUMENT_HEIGHT = 600;

const BAND_LINE_WIDTH = 60;
const BAND_START_X = 200;
const BAND_END_X = 500;
const BAND_Y = 200;
const BAND_MID_X = (BAND_START_X + BAND_END_X) / 2;
const LAYER_RIGHT = BAND_END_X + BAND_LINE_WIDTH;

const BAND_GREY = '#808080';
const BAND_LEVEL = 128;

const PIXEL_POLL_TIMEOUT_MS = 15_000;
const PIXEL_POLL_INTERVAL_MS = 100;
const pollOptions = { timeout: PIXEL_POLL_TIMEOUT_MS, intervals: [PIXEL_POLL_INTERVAL_MS] };

const STROKE_START_X = 250;
const STROKE_END_X = 400;
const STROKE_MID_X = (STROKE_START_X + STROKE_END_X) / 2;

const INSIDE = { x: STROKE_MID_X, y: BAND_Y };
/**
 * A probe 80 document pixels past the end of a 30px tip — five tip radii clear — still inside
 * the drawn band and inside the layer's raster. This is the "brush, not a filter" probe.
 */
const OUTSIDE = { x: STROKE_END_X + 80, y: BAND_Y };
const OUTSIDE_IS_INSIDE_THE_RASTER = OUTSIDE.x < LAYER_RIGHT;

const DODGE_ITEM: FlyoutItem = { toolName: 'dodge', label: 'Dodge Tool' };
const BURN_ITEM: FlyoutItem = { toolName: 'burn', label: 'Burn Tool' };
const SPONGE_ITEM: FlyoutItem = { toolName: 'sponge', label: 'Sponge Tool' };
const TONAL_GROUP = ['dodge', 'burn', 'sponge'] as const;

type DocPoint = { x: number; y: number };

type Geometry = {
  box: BoundingBox;
  scale: number;
  toCss: (point: DocPoint) => { x: number; y: number };
};

async function workspaceGeometry(page: Page): Promise<Geometry> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('the workspace canvas has no box');
  const scale = Math.min(box.width / DOCUMENT_WIDTH, box.height / DOCUMENT_HEIGHT);
  const offsetX = (box.width - DOCUMENT_WIDTH * scale) / 2;
  const offsetY = (box.height - DOCUMENT_HEIGHT * scale) / 2;
  return {
    box,
    scale,
    toCss: (point: DocPoint) => ({ x: box.x + offsetX + point.x * scale, y: box.y + offsetY + point.y * scale }),
  };
}

function windowClip(
  geometry: Geometry,
  point: DocPoint,
  halfDocument = 4
): { x: number; y: number; width: number; height: number } {
  const centre = geometry.toCss(point);
  const half = Math.max(2, Math.round(halfDocument * geometry.scale));
  return {
    x: Math.max(0, Math.round(centre.x - half)),
    y: Math.max(0, Math.round(centre.y - half)),
    width: half * 2,
    height: half * 2,
  };
}

async function readWindow(page: Page, geometry: Geometry, point: DocPoint, halfDocument = 4): Promise<ImageDataResult> {
  return loadImageData(await page.screenshot({ clip: windowClip(geometry, point, halfDocument) }));
}

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

function levelOf(image: ImageDataResult): number {
  const { r, g, b } = meanChannels(image);
  return Math.round((r + g + b) / 3);
}

async function strokeDocument(page: Page, geometry: Geometry, from: DocPoint, to: DocPoint, steps = 20): Promise<void> {
  const start = geometry.toCss(from);
  const end = geometry.toCss(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
}

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

async function selectTonal(page: Page, item: FlyoutItem): Promise<Geometry> {
  await openTonalFlyout(page);
  await selectFromFlyout(page, item);
  return workspaceGeometry(page);
}

async function setSlider(page: Page, name: RegExp, value: string): Promise<void> {
  const slider = page.getByRole('slider', { name });
  await expect(slider).toBeVisible();
  await slider.fill(value);
  await expect(slider).toHaveValue(value);
}

async function paintGreyBand(page: Page): Promise<Geometry> {
  await clickToolButton(page, 'draw');
  await setSlider(page, /^Size/, String(BAND_LINE_WIDTH));
  await setSlider(page, /^Opacity/, '1');

  await setForegroundColor(page, BAND_GREY, true);

  const geometry = await workspaceGeometry(page);
  await strokeDocument(page, geometry, { x: BAND_START_X, y: BAND_Y }, { x: BAND_END_X, y: BAND_Y }, 20);
  await expect
    .poll(
      async () => {
        return levelOf(await readWindow(page, geometry, { x: BAND_MID_X, y: BAND_Y }));
      },
      { ...pollOptions, message: 'the grey band was drawn and the workspace repainted' }
    )
    .toBe(BAND_LEVEL);

  return geometry;
}

test.describe('Dodge/Burn Tonal tools - gap coverage', () => {
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });

  /**
   * GAP 1: Brush, not a filter.
   *
   * A dodge/burn stroke is a brush over a soft disc, not a per-pixel filter over a buffer. The
   * probe at OUTSIDE sits 80 document pixels past a 30px tip — five tip radii clear — on the SAME
   * layer and inside the SAME raster the processor was handed. A tool that iterated that buffer
   * would have moved it; a brush walk cannot. The comparison is byte equality on the decoded capture.
   */
  test('Dodge leaves pixels outside the brush footprint byte-identical', async ({ page }) => {
    expect.soft(OUTSIDE_IS_INSIDE_THE_RASTER, 'the brush-not-filter probe must be inside the layer raster').toBe(true);

    await paintGreyBand(page);
    const dodged = await selectTonal(page, DODGE_ITEM);
    const before = await readWindow(page, dodged, OUTSIDE);

    await setSlider(page, /^Size/, '30');
    await setSlider(page, /^Exposure/, '60');
    await page.getByRole('combobox', { name: 'Range' }).selectOption('midtones');

    await strokeDocument(page, dodged, INSIDE, { x: STROKE_END_X, y: BAND_Y });

    await expect
      .poll(
        async () => {
          return levelOf(await readWindow(page, dodged, INSIDE)) > BAND_LEVEL;
        },
        { ...pollOptions, message: 'dodge must lighten the covered pixels' }
      )
      .toBe(true);

    await expect
      .poll(async () => readWindow(page, dodged, OUTSIDE), {
        ...pollOptions,
        message: 'pixels outside the brush footprint must be byte-identical',
      })
      .toEqual(before);
  });

  test('Burn leaves pixels outside the brush footprint byte-identical', async ({ page }) => {
    expect.soft(OUTSIDE_IS_INSIDE_THE_RASTER, 'the brush-not-filter probe must be inside the layer raster').toBe(true);

    await paintGreyBand(page);
    const burned = await selectTonal(page, BURN_ITEM);
    const before = await readWindow(page, burned, OUTSIDE);

    await setSlider(page, /^Size/, '30');
    await setSlider(page, /^Exposure/, '60');
    await page.getByRole('combobox', { name: 'Range' }).selectOption('midtones');

    await strokeDocument(page, burned, INSIDE, { x: STROKE_END_X, y: BAND_Y });

    await expect
      .poll(
        async () => {
          return levelOf(await readWindow(page, burned, INSIDE)) < BAND_LEVEL;
        },
        { ...pollOptions, message: 'burn must darken the covered pixels' }
      )
      .toBe(true);

    await expect
      .poll(async () => readWindow(page, burned, OUTSIDE), {
        ...pollOptions,
        message: 'pixels outside the brush footprint must be byte-identical',
      })
      .toEqual(before);
  });

  /**
   * GAP 2: The shared Tonal bar intentionally omits Photoshop's "Protect Skin Tone" checkbox.
   *
   * `DodgeBurnToolArgs` has no field for it, so rendering the checkbox would be a control whose
   * state is silently dropped on the next commit. This test documents that absence as deliberate.
   */
  test('the Tonal bar omits Protect Skin Tone because the args have no skin-tone field', async ({ page }) => {
    await selectTonal(page, DODGE_ITEM);

    await expect(
      page.getByRole('checkbox', { name: 'Protect Skin Tone' }),
      'the Tonal bar intentionally omits Protect Skin Tone — DodgeBurnToolArgs has no field for it'
    ).toHaveCount(0);

    await selectTonal(page, BURN_ITEM);

    await expect(
      page.getByRole('checkbox', { name: 'Protect Skin Tone' }),
      'the shared bar omits Protect Skin Tone for Burn as well'
    ).toHaveCount(0);
  });

  /**
   * GAP 3: The shared bar uses id prefixes to signal which tool is active.
   *
   * After selecting Dodge, `#burn-range` has count 0; after selecting Burn, `#dodge-range` has count 0.
   * This is the only DOM signal of tool identity, since the four controls share accessible names.
   */
  test('selecting Dodge shows the dodge id prefix and hides the burn one, and vice versa', async ({ page }) => {
    await selectTonal(page, DODGE_ITEM);

    await expect(page.locator('#dodge-range'), 'Dodge is active, so #dodge-range is in the DOM').toBeVisible();
    await expect(page.locator('#burn-range'), 'the burn controls are not mounted while Dodge is active').toHaveCount(0);

    await selectTonal(page, BURN_ITEM);

    await expect(page.locator('#burn-range'), 'Burn is active, so #burn-range is in the DOM').toBeVisible();
    await expect(page.locator('#dodge-range'), 'the dodge controls are not remounted while Burn is active').toHaveCount(
      0
    );
  });

  /**
   * GAP 4: The Range keyboard shortcuts (Alt+Shift+S/M/H) fire only when a tonal tool is active.
   *
   * `AppKeyboardShortcuts.tsx` gates these on `toolName` being dodge or burn. With the Sponge up
   * (a sibling in the same `O` flyout), the same chords must not switch the Sponge's range —
   * there is no range control to switch on the Sponge bar.
   */
  test('Range keyboard shortcuts only take effect while a Dodge/Burn tool is active', async ({ page }) => {
    await selectTonal(page, DODGE_ITEM);
    await page.getByRole('combobox', { name: 'Range' }).selectOption('midtones');

    await page.keyboard.press('Alt+Shift+s');
    await expect
      .soft(page.getByRole('combobox', { name: 'Range' }), 'Alt+Shift+S must set Shadows on the Dodge')
      .toHaveValue('shadows');

    await page.keyboard.press('Alt+Shift+m');
    await expect(page.getByRole('combobox', { name: 'Range' }), 'Alt+Shift+M must set Midtones').toHaveValue(
      'midtones'
    );

    await page.keyboard.press('Alt+Shift+h');
    await expect(page.getByRole('combobox', { name: 'Range' }), 'Alt+Shift+H must set Highlights').toHaveValue(
      'highlights'
    );

    await selectTonal(page, BURN_ITEM);
    await page.getByRole('combobox', { name: 'Range' }).selectOption('highlights');

    await page.keyboard.press('Alt+Shift+s');
    await expect(page.getByRole('combobox', { name: 'Range' }), 'Alt+Shift+S must set Shadows on the Burn').toHaveValue(
      'shadows'
    );

    await selectTonal(page, SPONGE_ITEM);

    await expect(page.getByRole('combobox', { name: 'Range' }), 'the Sponge bar has no Range control').toHaveCount(0);

    await page.keyboard.press('Alt+Shift+s');
    await page.keyboard.press('Alt+Shift+m');
    await page.keyboard.press('Alt+Shift+h');

    await expect(
      page.getByRole('combobox', { name: 'Range' }),
      'no Range control should appear while the Sponge is active'
    ).toHaveCount(0);
  });
});
