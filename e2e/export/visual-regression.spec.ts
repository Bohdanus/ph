import { expect, test, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareScreenshots } from '../helpers/image-comparison';
import {
  exportAndVerify,
  exportFormats,
  exportIcoAndVerify,
  fillSaveDialog,
  INTEGRATION_TEST_TIMEOUT_MS,
  mimeType,
  openSaveDialog,
  setupExportTest,
  setupIcoTest,
  submitSaveDialogForDownload,
  type ExportFormat,
} from './helpers';

const formats = exportFormats.filter((f) => f.comparePixels);

/**
 * The shell's `lg` breakpoint, 1024px. `src/index.scss:38` pins it in px deliberately:
 * Tailwind emitted `max-lg:` as `48rem`, a media feature that resolves against the user's
 * default font size, so at a 20px default the stylesheet hid the desktop regions at 960px
 * while the JS still read 768.
 */
const LG_BREAKPOINT_PX = 1024;

/**
 * Viewport widths the layout-independence test sweeps, and why each one is here.
 *
 * A width is here because it either sits on a side of `lg` or is a width the rest of the suite
 * depends on. 1023 and 1024 are adjacent on purpose: one pixel apart, and the canvas box jumps
 * from 967px to 718px across them because the right panel appears at `250px`.
 */
const LAYOUT_WIDTHS = [900, 1023, 1024, 1280, 1600] as const;

/** PNG, the lossless format with no third-party encoder in the path. See the test's docblock. */
const layoutInvarianceFormat: ExportFormat = { label: 'PNG', extension: '.png', comparePixels: false };

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
   * every layout the shell can produce.
   *
   * WHY WIDTHS, AND WHY THIS PARTICULAR SET. The shell's structural boundary is `lg` at
   * 1024px (`src/index.scss:38`, pinned in px rather than the `rem` Tailwind would have
   * emitted), and crossing it is not a resize — it is a different shell. Measured at
   * height 720: below 1024 the right panel is `display: none` and the canvas is 844px wide
   * at a 900px viewport and 967px at 1023px; at 1024 the panel appears at `250px` and the
   * canvas drops to 718px. One pixel of viewport width therefore moves the canvas by 249,
   * which no fixed geometry survives. A HEIGHT sweep cannot see any of this: the right
   * panel's width, and therefore the canvas box, is a function of width alone, so at a
   * fixed width of 1280 every height agreed and the height-only version of this test was
   * green while the property it names was unprotected. 1280 is kept because it is the width
   * the committed baselines were recorded at, so a regression that broke the baselines would
   * fail both this test and the seven above it.
   *
   * WHY ONLY THE SIDEBAR STATE ABOVE 1024. `toolbar-layout-toggle` is rendered behind
   * `!isTablet` in `SidebarLeft`, so below `lg` there is no second left-rail layout to enter
   * and the test asserts that absence rather than skipping past it — see below.
   *
   * WHY THE EXPORTED BYTES AND NOT THE CANVAS. `sourceDataUrl` is `canvas.toDataURL()` of the
   * workspace canvas, which is the drawing, not the file. The property is about the export:
   * `src/contexts/useFile.tsx` resolves the format, lazily `import()`s an encoder
   * (`src/contexts/image-load-save-utils.ts:145-178`) and downloads the result. PNG is the
   * format asserted on because it is the only lossless one that never leaves the browser —
   * `imageFormat.encoding === 'canvas'` takes a plain `canvas.toBlob(blob, 'image/png')` with
   * no dynamic import — where TIFF, GIF and AVIF pull in `utif`, `gifenc` and
   * `@jsquash/avif`. A byte comparison against a third-party codec would be a test of the
   * codec, not of the geometry. The canvas comparison is kept as well, because it is already
   * computed and it localises a failure to the drawing rather than the encoder.
   */
  test('the export is independent of the shell layout', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const configurations: { label: string; width: number; height: number; toolbarLayout: 'default' | 'toggled' }[] = [];
    for (const height of [720, 560]) {
      for (const width of LAYOUT_WIDTHS) {
        // The toggle does not exist below `lg`, so the second rail layout is only entered where
        // the control is rendered — and the reason is asserted at the end of this test rather
        // than assumed, so the matrix cannot quietly stop covering a rail layout.
        for (const toolbarLayout of width >= LG_BREAKPOINT_PX
          ? (['default', 'toggled'] as const)
          : (['default'] as const)) {
          configurations.push({ label: `${width}x${height}/${toolbarLayout}`, width, height, toolbarLayout });
        }
      }
    }

    const exports: {
      label: string;
      sourceDataUrl: string;
      bytes: Buffer;
      canvas: { width: number; height: number };
    }[] = [];

    for (const { label, width, height, toolbarLayout } of configurations) {
      await page.setViewportSize({ width, height });
      const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo, { toolbarLayout });

      // The encoded file, through the same dialog a user drives. PNG: `exportFormats` already
      // offers it as a lossless format, and reading its bytes back off disk is the only way to
      // assert on the export rather than on the drawing.
      await openSaveDialog(page);
      await fillSaveDialog(page, 'layout-invariance', 'PNG');
      const download = await submitSaveDialogForDownload(page, layoutInvarianceFormat);
      const target = path.join(downloadDirectory, path.basename(download.suggestedFilename()));
      await download.saveAs(target);
      await expect(page.getByRole('heading', { name: 'Save File As...' })).toHaveCount(0);

      const bytes = await readFile(target);
      expect(bytes.byteLength, `${label}: the exported file should not be empty`).toBeGreaterThan(100);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="workspace-canvas"]') as HTMLCanvasElement;
        return { width: c.width, height: c.height };
      });
      exports.push({ label, sourceDataUrl, bytes, canvas });
    }

    // The backing store is the document size at any viewport, so a difference below is geometry
    // and not a differently-sized document being encoded.
    for (const { label, canvas } of exports) {
      expect(canvas, `${label}: the backing store is the document size at any viewport`).toEqual({
        width: 800,
        height: 600,
      });
    }

    // The property, on the export.
    const [reference, ...rest] = exports;
    for (const { label, bytes } of rest) {
      expect(
        bytes.equals(reference.bytes),
        `${label}: the exported PNG must be byte-identical to ${reference.label}. A difference here is ` +
          `layout-dependent geometry: the line is specified in document space, so the document point it marks ` +
          `cannot depend on the canvas box. If the constants are on the pixel grid the exported anti-aliasing ` +
          `in the round caps splits with viewport width, and a height-only sweep cannot see it.`
      ).toBe(true);
    }

    // And, free, on the drawing: localises the same failure to before the encoder.
    for (const { label, sourceDataUrl } of rest) {
      expect(sourceDataUrl, `${label}: the same document line must render identically on the canvas`).toBe(
        reference.sourceDataUrl
      );
    }

    // Why only one sidebar state below `lg`. If the toggle were ever rendered in the tablet band
    // the matrix above would silently stop covering a rail layout it claims to, and the reason
    // it is covered above `lg` would stop being true.
    await page.setViewportSize({ width: LAYOUT_WIDTHS[0], height: 720 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeHidden();
    await expect(page.locator('#right-panel')).toBeHidden();
    await page.setViewportSize({ width: LAYOUT_WIDTHS[LAYOUT_WIDTHS.length - 1], height: 720 });
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeVisible();
    await expect(page.locator('#right-panel')).toBeVisible();
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
