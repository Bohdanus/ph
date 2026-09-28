import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';
const nonComparisonFormats = exportFormats.filter((f) => !f.comparePixels);

for (const format of nonComparisonFormats) {
  test(`exports to ${format.label} (${format.extension}) without pixel verification`, async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);
  });
}
