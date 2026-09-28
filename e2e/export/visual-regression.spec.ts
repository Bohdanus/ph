import { expect, test, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareScreenshots } from '../helpers/image-comparison';
import {
  exportAndVerify,
  exportFormats,
  exportIcoAndVerify,
  INTEGRATION_TEST_TIMEOUT_MS,
  mimeType,
  setupExportTest,
  setupIcoTest,
} from './helpers';

const formats = exportFormats.filter((f) => f.comparePixels);

/** Sub-directory of the committed snapshot directory that holds the baseline PNGs. */
const BASELINE_DIR = 'export-baselines';

/**
 * Absolute path of a committed baseline PNG.
 *
 * `testInfo.snapshotDir` is Playwright's own per-file snapshot directory and already
 * resolves to `tests/export/visual-regression.spec.ts-snapshots`, which is where the
 * baselines are committed. `testInfo.snapshotPath` is deliberately not used: its default
 * template appends `-<projectName>-<platform>` to the stem, so it resolves to
 * `drawing.png-Google-Chrome-darwin.png` — a file that is not committed, and one that
 * would differ per operating system, leaving a baseline committed on one OS to read as
 * "missing" on every other one.
 */
function baselineFile(testInfo: TestInfo, fileName: string): string {
  return path.join(testInfo.snapshotDir, BASELINE_DIR, fileName);
}

test.describe('Export visual regression', () => {
  for (const format of formats) {
    test(`exports to ${format.label} (${format.extension}) matches visual baseline`, async ({ page }, testInfo) => {
      test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

      const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
      const artifactPath = await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);

      const file = await readFile(artifactPath);
      const exportedScreenshot = await page.evaluate(
        async ({ data, mime }) => {
          const loadImage = (src: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error('Failed to load image'));
              image.src = src;
            });
          const exportedImage = await loadImage(`data:${mime};base64,${data}`);
          const canvas = document.createElement('canvas');
          canvas.width = exportedImage.width;
          canvas.height = exportedImage.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(exportedImage, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { data: file.toString('base64'), mime: mimeType(format.extension) }
      );

      const exportedBuffer = Buffer.from(exportedScreenshot, 'base64');
      const baselineFilePath = baselineFile(testInfo, `drawing${format.extension}.png`);

      // `updateSnapshots` is a string union ('all' | 'changed' | 'missing' | 'none')
      // whose DEFAULT is 'missing', which is truthy. A bare truthiness check therefore
      // always took this branch: every run rewrote the committed baseline and returned
      // before comparing, so `compareScreenshots` and the assertion below it were
      // unreachable and the committed oracle was disposable. Only an explicit
      // --update-snapshots ('all') may re-record a baseline.
      if (testInfo.config.updateSnapshots === 'all') {
        await mkdir(path.dirname(baselineFilePath), { recursive: true });
        await writeFile(baselineFilePath, exportedBuffer);
        testInfo.annotations.push({ type: 'baseline-recorded', description: baselineFilePath });
        return;
      }

      const baseline = await readFile(baselineFilePath).catch(() => null);
      if (!baseline) {
        await testInfo.attach(`${format.label}-baseline-missing`, { body: exportedBuffer, contentType: 'image/png' });
        throw new Error(`Baseline missing for ${format.label}. Run with --update-snapshots to create.`);
      }

      const result = await compareScreenshots(exportedBuffer, baseline, {
        threshold: 0.01,
        maxDiffPixels: 100,
      });
      expect(
        result.matches,
        `Visual mismatch for ${format.label}: ${result.diffPixels} diff pixels (ratio: ${result.diffRatio.toFixed(4)})`
      ).toBe(true);
    });
  }

  /**
   * The export must be a function of the document, not of the window.
   *
   * This is the pin for the decoupling, and it is stated as a property rather than as a
   * baseline because a baseline cannot express it: the original failure was that fixing a
   * desktop overflow changed the canvas from 974x890 to 974x583, which moved a
   * canvas-relative test line and failed seven pixel comparisons with no change in the
   * export path. The same line, specified in document space, must render identically at
   * both canvas heights.
   *
   * 890 and 583 are the two measured canvas heights for a 1280x720 window, before and after
   * the grid-overflow fix. Any future change to the shell's layout is therefore covered: if
   * it moves the canvas, this test still passes, and so do the seven baseline comparisons
   * above.
   */
  test('the export is independent of the canvas height', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const dataUrlAtHeight = async (height: number) => {
      await page.setViewportSize({ width: 1280, height });
      const { sourceDataUrl } = await setupExportTest(page, testInfo);
      return sourceDataUrl;
    };

    const tall = await dataUrlAtHeight(720);
    const short = await dataUrlAtHeight(560);

    // A different canvas height really is in play, or this proves nothing.
    const canvases = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="workspace-canvas"]') as HTMLCanvasElement;
      return { w: c.width, h: c.height };
    });
    expect(canvases, 'the backing store is the document size at any viewport').toEqual({
      w: 800,
      h: 600,
    });

    expect(short, 'the same document line must export identically at a different canvas height').toBe(tall);
  });

  test('ICO export matches the source canvas', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const sourceDataUrl = await setupIcoTest(page);
    // The ICO flow never uses the workspace export fixture, so prepare its download
    // directory the same way `setupExportTest` does.
    const downloadDirectory = path.join(testInfo.outputDir, 'exports');
    await mkdir(downloadDirectory, { recursive: true });

    await exportIcoAndVerify(page, sourceDataUrl, downloadDirectory);
  });
});
