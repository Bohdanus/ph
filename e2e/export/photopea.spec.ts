import { test } from '@playwright/test';
import { exportFormats, setupExportTest, exportAndVerify, verifyPsdInPhotopea } from './helpers';

const psdFormat = exportFormats.find((f) => f.extension === '.psd')!;

test.skip('exports to PSD and verifies in Photopea', async ({ page }, testInfo) => {
  test.setTimeout(90_000);

  const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
  const psdPath = await exportAndVerify(page, psdFormat, sourceDataUrl, downloadDirectory, testInfo);
  await verifyPsdInPhotopea(page, psdPath);
});

// SKIPPED: Photopea external dependency - GDPR/cookie consent modal blocks automation.
//
// WHAT WAS TRIED AND FAILED:
// 1. File upload approach (current verifyPsdInPhotopea): navigates to photopea.com, clicks "Start using Photopea",
//    waits for editor canvas, then uploads PSD via <input type="file">. Fails because consent modal appears
//    AFTER "Start using Photopea" but BEFORE editor is ready, blocking file input interaction.
// 2. Consent button handling attempts:
//    - "Do not consent" button (sometimes visible, sometimes not)
//    - "Consent" / "Accept all" buttons (timing issues - modal appears after delay)
//    - Multiple wait strategies (waitForSelector, waitForFunction, polling)
// 3. Iframe + postMessage approach (recent rewrite in helpers.ts): tried to bypass UI by using
//    Photopea's iframe API directly. Complex due to cross-origin restrictions and Photopea's
//    internal initialization sequence.
//
// ROOT CAUSE: Photopea loads consent modal asynchronously after the "Start using Photopea" click.
// The modal timing is non-deterministic (sometimes instant, sometimes 5-10s delay).
// File input is not interactable while modal is present.
//
// POTENTIAL FIXES (in order of viability):
// 1. Mock verification: Skip actual Photopea, verify PSD structure locally (psd.js / psd-tools)
// 2. Photopea API direct: Use window.pea.loadFromUrl or similar if API stabilizes
// 3. Consent handling: Robust wait + click for consent buttons with retry logic
// 4. Pre-consented session: Use browser context with pre-accepted cookies (complex)
//
// Re-enable when ONE of the above is implemented in verifyPsdInPhotopea.
