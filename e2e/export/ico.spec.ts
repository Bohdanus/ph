import { test } from '@playwright/test';
import { setupExportTest, setupIcoTest, exportIcoAndVerify } from './helpers';

test('exports to ICO with pixel verification', async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const { downloadDirectory } = await setupExportTest(page, testInfo);
  const sourceDataUrl = await setupIcoTest(page);
  await exportIcoAndVerify(page, sourceDataUrl, downloadDirectory);
});
