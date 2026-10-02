import { test } from '../fixtures/extended-test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';
const rasterFormats = exportFormats.filter((f) => f.comparePixels && !['.svg', '.ico'].includes(f.extension));

for (const format of rasterFormats) {
  test(`exports to ${format.label} (${format.extension}) with pixel verification`, async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);
  });
}
