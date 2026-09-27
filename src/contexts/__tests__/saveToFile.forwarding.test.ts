/**
 * Forwarding and failure-propagation coverage for `src/contexts/saveToFile.ts`.
 *
 * The sibling `saveToFile.test.ts` is Solid: it pins the two early returns and the happy-path
 * argument forwarding. What it does not pin is that the wrapper adds no normalisation of its
 * own - it forwards the format and quality verbatim, defaults only on `undefined`, and lets a
 * failed export reject rather than swallowing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { saveImageToDisk } = vi.hoisted(() => ({ saveImageToDisk: vi.fn() }));

vi.mock('../image-load-save-utils.ts', () => ({ saveImageToDisk }));

import { saveImage } from '../saveToFile.ts';

describe('saveImage forwarding', () => {
  let canvas: HTMLCanvasElement;
  let getContext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveImageToDisk.mockReset();
    saveImageToDisk.mockResolvedValue(undefined);
    getContext = vi.fn(() => ({}) as unknown as CanvasRenderingContext2D);
    canvas = { getContext, width: 10, height: 10 } as unknown as HTMLCanvasElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves to true only after the export has finished', async () => {
    let release!: () => void;
    saveImageToDisk.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );
    let settled = false;
    const pending = saveImage(canvas, 'design', 'image/png').then((value) => {
      settled = true;
      return value;
    });

    await vi.waitFor(() =>
      expect(saveImageToDisk).toHaveBeenCalledExactlyOnceWith(canvas, 'design', 'image/png', undefined)
    );
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toBe(true);
  });

  it('propagates a failed export instead of reporting success', async () => {
    saveImageToDisk.mockRejectedValue(new Error('Failed to create blob from canvas'));

    await expect(saveImage(canvas, 'design', 'image/png')).rejects.toThrow('Failed to create blob from canvas');
  });

  it('consults the 2d context before attempting the export', async () => {
    await saveImage(canvas, 'design');

    expect(getContext).toHaveBeenCalledExactlyOnceWith('2d');
    expect(saveImageToDisk).toHaveBeenCalledExactlyOnceWith(canvas, 'design', 'image/png', undefined);
  });

  it.each([
    ['a bare extension', 'jpeg', undefined],
    ['a MIME type', 'image/jpeg', 0.9],
    ['the PSD marker value', 'psd', undefined],
    ['an empty format string', '', undefined],
  ])('forwards %s (%s) verbatim without normalising it', async (_label, format, quality) => {
    await saveImage(canvas, 'design', format, quality);

    expect(saveImageToDisk).toHaveBeenCalledExactlyOnceWith(canvas, 'design', format, quality);
  });

  it.each([
    ['zero', 0],
    ['one', 1],
    ['a negative quality', -1],
    ['a quality above one', 5],
    ['NaN', Number.NaN],
  ])('forwards %s quality unchanged; clamping belongs to the encoder', async (_label, quality) => {
    await saveImage(canvas, 'design', 'image/jpeg', quality);

    expect(saveImageToDisk).toHaveBeenCalledExactlyOnceWith(canvas, 'design', 'image/jpeg', quality);
  });

  it('leaves the caller with a truthy result only for a real canvas', async () => {
    await expect(saveImage(null, 'design')).resolves.toBeUndefined();
    await expect(
      saveImage({ getContext: () => null } as unknown as HTMLCanvasElement, 'design')
    ).resolves.toBeUndefined();
    expect(saveImageToDisk).not.toHaveBeenCalled();
  });
});
