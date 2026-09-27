import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

const rasterFormats = exportFormats.filter((f) => f.comparePixels && !['.svg', '.ico'].includes(f.extension));

for (const format of rasterFormats) {
  test(`exports to ${format.label} (${format.extension}) with pixel verification`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);
  });
}
