/**
 * Save-path coverage for `src/contexts/image-load-save-utils.ts`: the failure arms of
 * `saveImageToDisk` that the Gold `image-load-save-utils.test.ts` does not reach, plus the
 * quality-clamp table. The sibling file already pins the happy-path MIME/extension mapping, so
 * these tests only assert the three rejection arms, the clamp, and the object-URL lifecycle
 * guarantee that `downloadBlob` makes even when the download itself fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveImageToDisk } from '../image-load-save-utils.ts';

const { encodeAvif, encodeBmp, encodeGif, encodeIco, encodeSvg, encodeTiff } = vi.hoisted(() => ({
  encodeAvif: vi.fn(),
  encodeBmp: vi.fn(),
  encodeGif: vi.fn(),
  encodeIco: vi.fn(),
  encodeSvg: vi.fn(),
  encodeTiff: vi.fn(),
}));

vi.mock('../tiff-utils.ts', () => ({ encodeTiff }));
vi.mock('../bmp-utils.ts', () => ({ encodeBmp }));
vi.mock('../gif-utils.ts', () => ({ encodeGif }));
vi.mock('../avif-utils.ts', () => ({ encodeAvif }));
vi.mock('../ico-utils.ts', () => ({ encodeIco }));
vi.mock('../svg-utils.ts', async (importOriginal) => ({ ...(await importOriginal()), encodeSvg }));

describe('saveImageToDisk failure paths', () => {
  const createObjectURL = vi.fn(() => 'blob:export');
  const revokeObjectURL = vi.fn();
  let downloads: { name: string }[];

  beforeEach(() => {
    vi.useFakeTimers();
    downloads = [];
    for (const encoder of [encodeAvif, encodeBmp, encodeGif, encodeIco, encodeSvg, encodeTiff]) {
      encoder.mockReset();
    }
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download });
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['image/tiff', encodeTiff, 'async'],
    ['image/bmp', encodeBmp, 'async'],
    ['image/gif', encodeGif, 'async'],
    ['image/avif', encodeAvif, 'async'],
    ['image/x-icon', encodeIco, 'async'],
    // `encodeSvg` is synchronous, so "no blob" is an undefined return rather than a rejection.
    ['image/svg+xml', encodeSvg, 'sync'],
  ])('rejects when the %s encoder produces no blob', async (format, encoder, mode) => {
    if (mode === 'async') vi.mocked(encoder).mockResolvedValue(undefined);
    else vi.mocked(encoder).mockReturnValue(undefined);
    const canvas = document.createElement('canvas');

    await expect(saveImageToDisk(canvas, 'design', format)).rejects.toThrow(`Unsupported image format: ${format}`);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('rejects a synchronous canvas failure without downloading', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation(() => {
      throw new Error('canvas is tainted');
    });

    await expect(saveImageToDisk(canvas, 'design', 'image/png')).rejects.toThrow('canvas is tainted');

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('rejects when the download itself throws, and still revokes the object URL', async () => {
    const blob = new Blob(['raster'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(blob));
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      throw new Error('download blocked');
    });

    await expect(saveImageToDisk(canvas, 'design', 'image/png')).rejects.toThrow('download blocked');

    // `downloadBlob` revokes in a `finally`, so a failed click cannot leak the blob URL.
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:export');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('revokes the object URL exactly once, only after the anchor has been removed', async () => {
    const blob = new Blob(['raster'], { type: 'image/png' });
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(blob));

    await saveImageToDisk(canvas, 'design', 'image/png');

    expect(downloads).toEqual([{ name: 'design.png' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:export');
    vi.advanceTimersByTime(10_000);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('saveImageToDisk quality handling', () => {
  beforeEach(() => {
    vi.spyOn(globalThis.URL, 'createObjectURL').mockImplementation(() => 'blob:export');
    vi.spyOn(globalThis.URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['a quality below zero', -2, 0],
    ['a quality above one', 4, 1],
    ['the exact lower bound', 0, 0],
    ['the exact upper bound', 1, 1],
    ['a quality in range', 0.42, 0.42],
  ])('clamps %s for JPEG', async (_label, quality, expected) => {
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'])));

    await saveImageToDisk(canvas, 'design', 'image/jpeg', quality);

    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jpeg', expected);
  });

  it.each([
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
  ])('omits a quality that is %s', async (_label, quality) => {
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob(['jpeg'])));

    await saveImageToDisk(canvas, 'design', 'image/jpeg', quality);

    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jpeg');
  });

  it('ignores quality for a format that does not support it', async () => {
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob(['webp'])));

    await saveImageToDisk(canvas, 'design', 'image/webp', 0.3);

    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/webp');
  });

  it('passes an unknown but image/* format straight to the canvas encoder', async () => {
    const canvas = document.createElement('canvas');
    const toBlob = vi.spyOn(canvas, 'toBlob').mockImplementation((callback) => callback(new Blob(['jxl'])));

    await saveImageToDisk(canvas, 'design.jpeg', 'image/jxl', 0.5);

    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/jxl');
  });
});
