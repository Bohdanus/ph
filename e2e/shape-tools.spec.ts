import { expect, type Page, test } from '@playwright/test';
import {
  type BoundingBox,
  type ClipOptions,
  documentToCanvasOffset,
  drawLine,
  getColorAtPoint,
  getDarkPixelBounds,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  loadImageData,
} from './helpers/canvas-helpers';
import { type CanvasPixelPredicate, waitForCanvasPixels } from './helpers/canvas-redraw';
import { openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

const THIN_THICKNESS = '4';
const WIDE_THICKNESS = '40';

/**
 * The authored ratio is 40/4 = 10x. Three is asserted, which is a third of that: the tip is
 * authored in document pixels and measured in capture ones, so the measurement also carries
 * the canvas scale and the device pixel ratio, and the ratio is taken on the OUTER bounds of
 * a stroke, where the round caps and the antialiasing add to both ends.
 */
const WIDE_TO_THIN_MIN_RATIO = 3;

const BLUE = '#0000ff';
const STROKE_BLACK = '#000000';

type Point = { x: number; y: number };
type Rect = { from: Point; to: Point };

/**
 * The half-width of the square the sample window averages, in capture pixels. 3 is a 7x7
 * average: wide enough to absorb a capture's resampling, narrow enough that a 20px shape
 * stroke still has a solid interior in it.
 */
const SAMPLE_RADIUS = 3;

const hasPaintedPixel: CanvasPixelPredicate = async (screenshot) => {
  const { width, height, data } = await loadImageData(screenshot);
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * 4;
      if (data[index + 3] !== 0 && (data[index] < 240 || data[index + 1] < 240 || data[index + 2] < 240)) return true;
    }
  }
  return false;
};

/**
 * The three helpers below — `canvasBox`, `documentClip`, `sampleDocumentPoint` — are
 * deliberately local rather than added to `e2e/helpers/`: nothing in the shared module
 * changes, so no existing spec's behaviour can move underneath a commit that is only
 * adding coverage. `filter-tools.spec.ts` carries byte-identical copies; if one of them is
 * promoted into the shared module, all three go together, because two same-named helpers
 * that differ by a sampling radius is the trap this comment exists to prevent.
 */
async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box, so the gesture cannot be placed');
  return box;
}

/** A page clip over a rectangle named in DOCUMENT coordinates, with a margin in document units. */
function documentClip(box: BoundingBox, rect: Rect, margin = 20): Required<ClipOptions> {
  const topLeft = documentToCanvasOffset(
    box,
    Math.min(rect.from.x, rect.to.x) - margin,
    Math.min(rect.from.y, rect.to.y) - margin
  );
  const bottomRight = documentToCanvasOffset(
    box,
    Math.max(rect.from.x, rect.to.x) + margin,
    Math.max(rect.from.y, rect.to.y) + margin
  );
  return {
    x: box.x + topLeft.x,
    y: box.y + topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * A 17px window centred on a DOCUMENT point. The box is re-measured per sample, because the
 * shape bar is a different height from the bar that precedes it and a stale box maps every
 * document point onto the wrong pixel — the defect `e2e/OPEN_PROBLEMS.md` records.
 */
async function sampleDocumentPoint(
  page: Page,
  documentX: number,
  documentY: number
): Promise<{ red: number; green: number; blue: number } | null> {
  const box = await canvasBox(page);
  const offset = documentToCanvasOffset(box, documentX, documentY);
  const half = 8;
  const screenshot = await page.screenshot({
    clip: { x: box.x + offset.x - half, y: box.y + offset.y - half, width: half * 2 + 1, height: half * 2 + 1 },
  });
  return getColorAtPoint(screenshot, half, half, SAMPLE_RADIUS);
}

/** A drag given in document coordinates, performed at the box's own contain scale. */
async function dragAcrossDocument(page: Page, from: Point, to: Point): Promise<void> {
  const box = await canvasBox(page);
  const start = documentToCanvasOffset(box, from.x, from.y);
  const end = documentToCanvasOffset(box, to.x, to.y);
  await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: 10 });
}

/** Drags a shape, then waits for its own clip to hold something the background does not. */
async function dragShape(page: Page, rect: Rect, name: string): Promise<void> {
  await dragAcrossDocument(page, rect.from, rect.to);
  await waitForCanvasPixels(page, documentClip(await canvasBox(page), rect), hasPaintedPixel, { description: name });
}

/**
 * Every member of the shape group is named `shape` in the mapping and told apart by its
 * FIGURE, so the flyout item's testid carries `shape` and the slug of the label — not the
 * figure. `selectFromFlyout` is given both because it needs the internal name for the id.
 */
async function selectShape(page: Page, label: string): Promise<void> {
  await openToolFlyout(page, 'shape');
  await selectFromFlyout(page, { toolName: 'shape', label });
}

const thickness = (page: Page) => page.locator('#thickness-slider');
const filledToggle = (page: Page) => page.locator('#filled-toggle');
const dashToggle = (page: Page) => page.locator('#dash-toggle');

/** The measured dark bounds of one shape, from a clip that holds only that shape. */
async function measureShape(page: Page, rect: Rect, name: string): Promise<{ width: number; height: number }> {
  const clip = documentClip(await canvasBox(page), rect);
  await waitForCanvasPixels(page, clip, hasPaintedPixel, { description: name });
  const bounds = await getDarkPixelBounds(await page.screenshot({ clip }));
  expect(bounds, `${name} has to leave something on the canvas`).not.toBeNull();
  return { width: bounds!.width, height: bounds!.height };
}

test.describe('Shape tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    await selectShape(page, 'Rectangle Tool');
    // The foreground is the stroke, and it is set after the tool is active: the shape bar
    // mirrors the store's colour into the tool args, so the order is what puts it there.
    await setForegroundColor(page, STROKE_BLACK, true);
  });

  test('the drawn rectangle keeps the drag aspect ratio, and Shift constrains it to a square', async ({ page }) => {
    test.setTimeout(60_000);
    // The drags are 300x140 and 300x300 in DOCUMENT units, and the contain fit is not
    // square, so a screen-space ratio would not survive the scale. The two shapes sit apart
    // so each clip holds exactly one of them.
    const plain: Rect = { from: { x: 40, y: 40 }, to: { x: 340, y: 180 } };
    const constrained: Rect = { from: { x: 430, y: 40 }, to: { x: 730, y: 180 } };
    // The constrained shape is measured over a region that holds its whole possible extent.
    // Shift keeps the drag's quadrant and snaps the LONGER axis, so a 300x140 drag becomes a
    // 300x300 square hanging BELOW the drag — clipping to the drag's own rect would cut its
    // bottom two thirds off and measure a shape that is not the one on the canvas.
    const constrainedExtent: Rect = { from: { x: 410, y: 20 }, to: { x: 750, y: 360 } };

    await dragShape(page, plain, 'the unconstrained rectangle');
    const drawn = await measureShape(page, plain, 'the unconstrained rectangle');
    expect(
      drawn.width / drawn.height,
      `expected about 2.14, measured ${drawn.width}x${drawn.height} in capture pixels`
    ).toBeGreaterThan(1.9);
    expect(drawn.width / drawn.height).toBeLessThan(2.35);

    // Shift is read on the RELEASE event, so it has to still be held at pointerup.
    await page.keyboard.down('Shift');
    await dragShape(page, constrained, 'the Shift-constrained rectangle');
    await page.keyboard.up('Shift');
    const squared = await measureShape(page, constrainedExtent, 'the Shift-constrained rectangle');
    expect(
      Math.abs(squared.width - squared.height) / Math.max(squared.width, squared.height),
      `a Shift-constrained rectangle must be a square, measured ${squared.width}x${squared.height}`
    ).toBeLessThan(0.08);
  });

  test('a thicker tip lays down a proportionally thicker band', async ({ page }) => {
    test.setTimeout(60_000);
    await selectShape(page, 'Line Tool');
    const thin: Rect = { from: { x: 40, y: 120 }, to: { x: 340, y: 120 } };
    const wide: Rect = { from: { x: 40, y: 420 }, to: { x: 340, y: 420 } };

    await thickness(page).fill(THIN_THICKNESS);
    await dragShape(page, thin, 'the thin line');
    const thinBounds = await measureShape(page, thin, 'the thin line');

    await thickness(page).fill(WIDE_THICKNESS);
    await dragShape(page, wide, 'the wide line');
    const wideBounds = await measureShape(page, wide, 'the wide line');

    expect(
      wideBounds.height,
      `a ${WIDE_THICKNESS}px tip measures ${wideBounds.height} against the ${THIN_THICKNESS}px tip's ${thinBounds.height}`
    ).toBeGreaterThan(thinBounds.height * WIDE_TO_THIN_MIN_RATIO);
  });

  test('the Dash toggle turns a solid line into segments', async ({ page }) => {
    test.setTimeout(60_000);
    await selectShape(page, 'Line Tool');
    const solid: Rect = { from: { x: 40, y: 120 }, to: { x: 340, y: 120 } };
    const dashed: Rect = { from: { x: 40, y: 420 }, to: { x: 340, y: 420 } };

    await dragShape(page, solid, 'the solid line');
    const solidClip = documentClip(await canvasBox(page), solid, 10);
    const solidAnalysis = await getStrokeAnalysis(await page.screenshot({ clip: solidClip }));
    expect(solidAnalysis, 'the solid line has to be analysable').not.toBeNull();
    expect(solidAnalysis!.type, 'an undashed line is one segment').toBe('solid');
    expect(solidAnalysis!.segments).toBe(1);

    await dashToggle(page).check();
    await expect(dashToggle(page)).toBeChecked();
    await dragShape(page, dashed, 'the dashed line');
    const dashedClip = documentClip(await canvasBox(page), dashed, 10);
    const dashedAnalysis = await getStrokeAnalysis(await page.screenshot({ clip: dashedClip }));
    expect(dashedAnalysis, 'the dashed line has to be analysable').not.toBeNull();
    // The dash and gap seed at 10/10, so a 300-unit drag is around fifteen marks.
    expect(dashedAnalysis!.type, 'the gaps are what make it dashed').toBe('dashed');
    expect(dashedAnalysis!.segments, 'a dashed line is many segments').toBeGreaterThan(2);
  });

  test('the Filled checkbox paints the interior, and leaving it alone does not', async ({ page }) => {
    test.setTimeout(60_000);
    // A filled shape paints with the BACKGROUND colour, so the interior is only observable
    // once the background is something other than the white the canvas already is.
    await page.getByTestId('background-color-input').fill(BLUE);
    await expect(page.getByTestId('background-color-input')).toHaveValue(BLUE);

    const hollow: Rect = { from: { x: 40, y: 60 }, to: { x: 340, y: 300 } };
    const filled: Rect = { from: { x: 430, y: 60 }, to: { x: 730, y: 300 } };
    const centreOf = (rect: Rect): Point => ({
      x: (rect.from.x + rect.to.x) / 2,
      y: (rect.from.y + rect.to.y) / 2,
    });

    await dragShape(page, hollow, 'the outlined rectangle');
    const interior = await sampleDocumentPoint(page, centreOf(hollow).x, centreOf(hollow).y);
    expect(interior, 'the interior has to be reachable to be sampled').toBeTruthy();
    expect(
      interior!.red,
      `an unfilled shape leaves its interior alone, read ${JSON.stringify(interior)}`
    ).toBeGreaterThan(240);

    await filledToggle(page).check();
    await expect(filledToggle(page)).toBeChecked();
    await dragShape(page, filled, 'the filled rectangle');
    const centre = centreOf(filled);
    await expect
      .poll(
        async () => {
          const sample = await sampleDocumentPoint(page, centre.x, centre.y);
          return sample ? sample.blue : 0;
        },
        { message: 'the background colour has to reach the interior of the shape' }
      )
      .toBeGreaterThan(200);
    const painted = await sampleDocumentPoint(page, centre.x, centre.y);
    expect(painted!.red, 'a blue interior is not red').toBeLessThan(80);
  });

  test('an oval is inscribed in its drag, so the drag corner is outside the shape', async ({ page }) => {
    test.setTimeout(60_000);
    // Both figures are drawn from the SAME shape of drag, so the only thing deciding whether
    // the corner is painted is what the geometry does with it: a rectangle's corner sits on
    // its own stroke, an oval's corner is outside the curve. They are drawn in different
    // places because each shape is a layer of its own and the earlier one would still be
    // under the later one at the very point being compared.
    const rectangle: Rect = { from: { x: 40, y: 100 }, to: { x: 340, y: 340 } };
    const oval: Rect = { from: { x: 440, y: 100 }, to: { x: 740, y: 340 } };
    // A 20px stroke is 10 document units across, so a sample 5 units in from the corner sits
    // well inside it. At the 5px seed a 5x5 sample window straddles the stroke's outer edge
    // and averages the corner against the background it is supposed to be contrasted with.
    await thickness(page).fill('20');
    const cornerOf = (rect: Rect): Point => ({ x: rect.from.x + 5, y: rect.from.y + 5 });

    await dragShape(page, rectangle, 'the rectangle');
    const corner = await sampleDocumentPoint(page, cornerOf(rectangle).x, cornerOf(rectangle).y);
    expect(corner, 'the corner has to be reachable to be sampled').toBeTruthy();
    expect(corner!.red, `a rectangle's corner is on its own stroke, read ${JSON.stringify(corner)}`).toBeLessThan(120);

    await selectShape(page, 'Ellipse Tool');
    await dragShape(page, oval, 'the oval');
    const ovalCorner = await sampleDocumentPoint(page, cornerOf(oval).x, cornerOf(oval).y);
    expect(ovalCorner, 'the corner has to be reachable to be sampled').toBeTruthy();
    expect(
      ovalCorner!.red,
      `an oval's corner is outside the curve, read ${JSON.stringify(ovalCorner)}`
    ).toBeGreaterThan(240);
  });
});
