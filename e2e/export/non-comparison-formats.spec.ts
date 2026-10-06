import { expect, test } from '../fixtures/extended-test';
import { readFile } from 'node:fs/promises';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from '../helpers/timeouts';

/** How many leading bytes a container signature occupies. */
const SIGNATURE_BYTES = 4;

interface ContainerSignature {
  /** How the signature reads in the assertion message and in the test title. */
  readonly name: string;
  /** Every accepted byte order. TIFF is legal in either, so one is not enough. */
  readonly allowed: readonly (readonly number[])[];
  /** What this test still does NOT verify, named in the title so the title cannot overstate it. */
  readonly notVerified: string;
}

/**
 * First bytes that prove the file is the container the save dialog claimed.
 *
 * `exportAndVerify` proves the container is not blank and is this document — it decodes the
 * export, rejects one carrying no ink, and for a `container` format applies the drawing oracle
 * against the source canvas. What it does not do is say WHERE that ink is, and this file adds no
 * second oracle that does: the signature is the only content assertion here, so it is checked
 * against the bytes on disk rather than assumed. Keyed by extension: a `verification: 'container'`
 * format with no entry below is a gap in the suite, and the test says so rather than passing
 * quietly.
 *
 * The structure neither entry claims — a TIFF's IFD, a PSD's layer table and its flat composite
 * — is `structured-formats.spec.ts`'s subject, which drives the same two formats through
 * `exportAndVerify` and runs the byte verifiers. Between the two files every raster claim is made
 * somewhere; neither title may imply the other one is not running.
 */
const CONTAINER_SIGNATURES: Record<string, ContainerSignature> = {
  '.tiff': {
    name: 'a TIFF byte-order signature (II*\\0 or MM\\0*)',
    allowed: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ],
    notVerified: 'where the ink is',
  },
  '.psd': {
    name: 'the 8BPS PSD signature',
    allowed: [[0x38, 0x42, 0x50, 0x53]],
    notVerified: 'where the ink is',
  },
};

const toHex = (bytes: readonly number[]): string => bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

// The signature oracle's own set, re-keyed onto the `verification` field that replaced
// `comparePixels`. `comparePixels: false` used to be the value the schema deleted, so the
// filter is now stated as the mechanism it actually named: a format the browser cannot
// decode, whose bytes are checked in Node.
const nonComparisonFormats = exportFormats.filter((f) => f.verification === 'container');

for (const format of nonComparisonFormats) {
  const container = CONTAINER_SIGNATURES[format.extension];
  const coverage = container
    ? `with ${container.name}, without verifying ${container.notVerified}`
    : 'with NO container signature check, because CONTAINER_SIGNATURES has no entry for it';

  test(`exports to ${format.label} (${format.extension}) ${coverage}`, async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
    const target = await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);

    if (!container) {
      throw new Error(
        `non-comparison-formats.spec.ts verifies ${format.label} by its container signature alone, ` +
          `but CONTAINER_SIGNATURES has no entry for ${format.extension}.`
      );
    }

    const observed = toHex([...(await readFile(target)).subarray(0, SIGNATURE_BYTES)]);
    const accepted = container.allowed.map((bytes) => toHex(bytes));
    expect(
      accepted.includes(observed),
      `${format.label}: first ${SIGNATURE_BYTES} bytes are "${observed}", expected one of "${accepted.join('", "')}"`
    ).toBe(true);
  });
}
