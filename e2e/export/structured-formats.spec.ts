import { test } from '@playwright/test';
import { containerVerifiedFormats, exportAndVerify, INTEGRATION_TEST_TIMEOUT_MS, setupExportTest } from './helpers';

// TIFF and PSD: no browser decodes either, so `exportAndVerify` parses their bytes in Node
// against `exportByteVerifiers` instead of drawing them onto a canvas. Until that existed
// these two formats had no content verification at all — `exportAndVerify` stopped at a
// `> 100` byte floor and a file extension, and the only other check was a four-byte
// signature. Measured on the 800x600 fixture, a BLANK export is 11,841 bytes as a PNG,
// 1,921,000 as a TIFF and 67,408 as a PSD, so all three cleared the floor: an all-white
// TIFF, a zero-layer PSD, and a PSD with its byte order broken all passed.
//
// This replaces `non-comparison-formats.spec.ts`, whose own test titles named what it did
// not verify ("without verifying pixel content or PSD layer structure").
for (const format of containerVerifiedFormats) {
  test(`exports to ${format.label} (${format.extension}) with container structure verification`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);
  });
}
