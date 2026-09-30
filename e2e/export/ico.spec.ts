import { test } from '@playwright/test';
import {
  INTEGRATION_TEST_TIMEOUT_MS,
  exportIcoAndVerify,
  prepareExportDownloadDirectory,
  setupIcoTest,
} from './helpers';

test('exports to ICO with pixel verification', async ({ page }, testInfo) => {
  test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

  // `setupIcoTest` opens its own 256x256 document through File > New, so running
  // `setupExportTest` first drew the export line, encoded a source data URL and
  // navigated a second time for the ICO flow to throw all of it away. Only the
  // download directory was kept, so it is prepared here directly — the same thing
  // `visual-regression.spec.ts` does for this helper, and now through the one
  // function that clears the directory before recreating it.
  const downloadDirectory = await prepareExportDownloadDirectory(testInfo);
  const sourceDataUrl = await setupIcoTest(page);

  await exportIcoAndVerify(page, sourceDataUrl, downloadDirectory, testInfo);
});
