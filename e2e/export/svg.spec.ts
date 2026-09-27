import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

const svgFormat = exportFormats.find((f) => f.extension === '.svg')!;

test('exports to SVG (flattened) with pixel verification', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
  await exportAndVerify(page, svgFormat, sourceDataUrl, downloadDirectory, testInfo);
});
