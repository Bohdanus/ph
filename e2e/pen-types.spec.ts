import { expect, type Page, test } from './fixtures/extended-test';
import {
  type ClipOptions,
  drawLine,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  hasDarkPixels,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

const STROKE_START_X = 150;
const STROKE_END_X = 400;
const STROKE_STEPS = 20;

const CLIP_X = 100;
const CLIP_Y_OFFSET = -50;
const CLIP_WIDTH = 320;
const CLIP_HEIGHT = 120;

/** Synchronizes with the backing store before the one-shot capture that is analyzed below. */
type PenWait = (page: Page, clip: Required<ClipOptions>) => Promise<void>;

/** Pen and dashed pen lay down dark pixels, so the shared dark-pixel wait is enough. */
const waitForDarkPixels: PenWait = (page, clip) =>
  waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'dark pixels' });

/**
 * Spray lays down light-gray pixels, so a dark-pixel wait can never observe it. Poll the
 * clip until stroke analysis finds any non-background pixels instead.
 *
 * The clip is handed to the classifier as the region it captured, which is what makes the
 * thresholds scale-correct: a 2x host decodes this clip at twice its CSS size, and the
 * analysis is over the stroke, not over the capture's resolution.
 */
const waitForSprayPixels: PenWait = (page, clip) =>
  waitForCanvasPixels(page, clip, async (screenshot) => (await getStrokeAnalysis(screenshot, clip)) !== null, {
    description: 'analysable pixels from the spray stroke',
  });

const PEN_TYPES = [
  {
    label: 'Pen - solid line',
    test: 'draws one solid segment',
    value: 'pen',
    name: 'pen-type-pen',
    y: 150,
    expect: { segments: 1, type: 'solid' as const },
    wait: waitForDarkPixels,
  },
  {
    label: 'Dashed Pen - dashed line',
    test: 'draws at least two dash segments',
    value: 'pen-dashed',
    name: 'pen-type-dashed',
    y: 250,
    expect: { segmentsMin: 2, type: 'dashed' as const },
    wait: waitForDarkPixels,
  },
  {
    label: 'Spray - spray',
    test: 'spreads non-background pixels over the clip',
    value: 'spray',
    name: 'pen-type-spray',
    y: 350,
    expect: { verticalSpreadMin: 11, type: 'spray' as const },
    wait: waitForSprayPixels,
  },
] as const;

for (const { label, test: testTitle, value, name, y, expect: exp, wait } of PEN_TYPES) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      const canvas = getWorkspaceCanvas(page);
      await expect(canvas).toBeVisible();
      // Select Draw tool to show pen type options
      await clickToolButton(page, 'draw');
    });

    test(testTitle, async ({ page }, testInfo) => {
      const canvas = getWorkspaceCanvas(page);
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas not found');

      // Select pen type from the dropdown in the Draw tool component
      const penTypeSelect = page.getByRole('combobox', { name: 'Pen Type' });
      await expect(penTypeSelect).toBeVisible();
      await penTypeSelect.selectOption(value);

      await drawLine(page, box, STROKE_START_X, y, STROKE_END_X, y, { steps: STROKE_STEPS });

      // Clip around the drawn stroke (y-50 to y+50 to capture full spray radius)
      const clip = {
        x: box.x + CLIP_X,
        y: box.y + y + CLIP_Y_OFFSET,
        width: CLIP_WIDTH,
        height: CLIP_HEIGHT,
      };
      // The screenshot below is a one-shot read, so synchronize with the
      // backing store first or a slow frame silently weakens the assertions.
      await wait(page, clip);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, name, clip);
      const analysis = await getStrokeAnalysis(screenshot, clip);

      expect(analysis, 'Stroke analysis should not be null').not.toBeNull();
      if ('segments' in exp) expect.soft(analysis!.segments).toBe(exp.segments);
      if ('segmentsMin' in exp) expect.soft(analysis!.segments).toBeGreaterThanOrEqual(exp.segmentsMin);
      if ('verticalSpreadMin' in exp)
        // `verticalSpread` is the one field `getStrokeAnalysis` returns RAW rather than
        // scale-corrected, so this is a floor on a capture-pixel count and a 2x capture
        // can only raise it. It cannot false-pass; it can only be looser than intended
        // on a HiDPI host. `segments` and `type` beside it ARE corrected, which is why
        // they are the load-bearing assertions here and this is a floor.
        expect.soft(analysis!.verticalSpread).toBeGreaterThanOrEqual(exp.verticalSpreadMin);
      expect.soft(analysis!.type).toBe(exp.type);
    });
  });
}
