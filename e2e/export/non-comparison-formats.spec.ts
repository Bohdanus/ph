import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

const nonComparisonFormats = exportFormats.filter((f) => !f.comparePixels);

for (const format of nonComparisonFormats) {
  test(`exports to ${format.label} (${format.extension}) without pixel verification`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);
  });
}
