import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { exportFormats, setupExportTest, exportAndVerify } from './helpers';

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
 * `exportAndVerify` stops at "a download landed, the extension matches, the file is not
 * tiny" - which a flat, layerless or truncated PSD satisfies, since a blank 300x100 TIFF is
 * kilobytes. For a format with no pixel comparison the container signature is the only
 * content assertion available, so it is checked against the bytes on disk rather than
 * assumed. Keyed by extension: a `comparePixels: false` format with no entry below is a gap
 * in the suite, and the test says so rather than passing quietly.
 */
const CONTAINER_SIGNATURES: Record<string, ContainerSignature> = {
  '.tiff': {
    name: 'a TIFF byte-order signature (II*\\0 or MM\\0*)',
    allowed: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ],
    notVerified: 'pixel content',
  },
  '.psd': {
    name: 'the 8BPS PSD signature',
    allowed: [[0x38, 0x42, 0x50, 0x53]],
    notVerified: 'pixel content or PSD layer structure (layer count, composite)',
  },
};

const toHex = (bytes: readonly number[]): string => bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

const nonComparisonFormats = exportFormats.filter((f) => !f.comparePixels);

for (const format of nonComparisonFormats) {
  const container = CONTAINER_SIGNATURES[format.extension];
  const coverage = container
    ? `with ${container.name}, without verifying ${container.notVerified}`
    : 'with NO container signature check, because CONTAINER_SIGNATURES has no entry for it';

  test(`exports to ${format.label} (${format.extension}) ${coverage}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);

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
