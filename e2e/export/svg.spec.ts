import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';
const svgFormat = exportFormats.find((f) => f.extension === '.svg')!;

test('exports to SVG (flattened) with pixel verification', async ({ page }, testInfo) => {
  test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

  const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
  await exportAndVerify(page, svgFormat, sourceDataUrl, downloadDirectory, testInfo);
});
