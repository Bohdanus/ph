import { expect, type Page, test } from './fixtures/extended-test';
import {
  type ClipOptions,
  documentToCanvasOffset,
  drawLine,
  getStrokeAnalysis,
  getWorkspaceCanvas,
  hasDarkPixels,
  loadImageData,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

const STROKE_START_X = 150;
const STROKE_END_X = 400;
const STROKE_STEPS = 20;

/** Synchronizes with the backing store before the one-shot capture that is analyzed below. */
type PenWait = (page: Page, clip: Required<ClipOptions>) => Promise<void>;

/** Pen and dashed pen lay down dark pixels, so the shared dark-pixel wait is enough. */
const waitForDarkPixels: PenWait = (page, clip) =>
  waitForCanvasPixels(page, clip, hasDarkPixels, { description: 'dark pixels' });

const getSprayAnalysis = (screenshot: Buffer, clip: Required<ClipOptions>) =>
  getStrokeAnalysis(screenshot, clip, { tool: 'spray' });

/**
 * Spray output depends on its selected opacity and colour, so it may be mid-tone or saturated.
 * Poll with the tool-specific classifier until it finds non-background pixels.
 *
 * The clip is handed to the classifier as the region it captured, which is what makes the
 * thresholds scale-correct: a 2x host decodes this clip at twice its CSS size, and the
 * analysis is over the stroke, not over the capture's resolution.
 */
const waitForSprayPixels: PenWait = (page, clip) =>
  waitForCanvasPixels(page, clip, async (screenshot) => (await getSprayAnalysis(screenshot, clip)) !== null, {
    description: 'a non-null spray stroke analysis (no spray ink has been classified)',
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

      const start = documentToCanvasOffset(box, STROKE_START_X, y);
      const end = documentToCanvasOffset(box, STROKE_END_X, y);

      await drawLine(page, box, start.x, start.y, end.x, end.y, { steps: STROKE_STEPS });

      const clip = {
        x: box.x + Math.min(start.x, end.x) - 50,
        y: box.y + Math.min(start.y, end.y) - 50,
        width: Math.abs(end.x - start.x) + 70,
        height: Math.abs(end.y - start.y) + 120,
      };
      // The screenshot below is a one-shot read, so synchronize with the
      // backing store first or a slow frame silently weakens the assertions.
      await wait(page, clip);

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, name, clip);
      const analysis =
        value === 'spray' ? await getSprayAnalysis(screenshot, clip) : await getStrokeAnalysis(screenshot, clip);

      expect(analysis, 'Stroke analysis should not be null').not.toBeNull();
      if ('segments' in exp) expect.soft(analysis!.segments).toBe(exp.segments);
      if ('segmentsMin' in exp) expect.soft(analysis!.segments).toBeGreaterThanOrEqual(exp.segmentsMin);
      if ('verticalSpreadMin' in exp) {
        // `verticalSpread` is returned in capture (image) pixels, not CSS pixels,
        // so it doubles at 2x. Divide it by the capture's own Y scale — measured
        // from the decoded image, never assumed — to get a CSS-pixel figure that
        // holds across DPIs. The threshold below is expressed in CSS pixels.
        const image = await loadImageData(screenshot);
        const scale = image.height / clip.height;
        expect.soft(analysis!.verticalSpread / scale).toBeGreaterThanOrEqual(exp.verticalSpreadMin);
      }
      expect.soft(analysis!.type).toBe(exp.type);
    });
  });
}
