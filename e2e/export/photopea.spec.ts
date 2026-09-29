import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify, verifyPsdInPhotopea } from './helpers';

import { THIRD_PARTY_PAGE_TEST_TIMEOUT_MS } from '../helpers/timeouts';
const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;

// Skipped: Photopea raises its consent modal asynchronously after "Start using
// Photopea", so the file input is not interactable when the upload runs. The full
// rationale, the approaches already tried and the options for re-enabling this are on
// `verifyPsdInPhotopea` in `./helpers` — including that `ag-psd` is a root dependency,
// which makes local PSD verification the first of those options.
test.skip('exports to PSD and verifies in Photopea', async ({ page }, testInfo) => {
  test.setTimeout(THIRD_PARTY_PAGE_TEST_TIMEOUT_MS);

  const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
  const psdPath = await exportAndVerify(page, psdFormat, sourceDataUrl, downloadDirectory, testInfo);
  await verifyPsdInPhotopea(page, psdPath);
});
