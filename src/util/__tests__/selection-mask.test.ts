import { describe, expect, it } from 'vitest';
import type { Pos } from '../../contexts/general-types.ts';
import {
  countSelectionBoundaryEdges,
  createRasterSelectionBoundaryMask,
  decodeRasterSelectionMask,
  encodeRasterSelectionMask,
  isCanonicalRasterSelectionMask,
  isRasterSelectionPixelSelected,
} from '../selection-mask.ts';

describe('packed raster selection masks', () => {
  it('round-trips a cropped, row-major one-bit mask', () => {
    const source = Uint8Array.from([0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1]);
    const bounds: Pos = { x: 1, y: 0, width: 4, height: 3 };

    const encoded = encodeRasterSelectionMask(source, 5, 3, bounds);
    const decoded = encoded ? decodeRasterSelectionMask(encoded) : null;

    expect(encoded).not.toBeNull();
    expect(isCanonicalRasterSelectionMask(encoded)).toBe(true);
    expect(decoded).toEqual(Uint8Array.from([81, 12]));
    expect(decodeRasterSelectionMask({ ...encoded! })).toBe(decoded);
    expect(isRasterSelectionPixelSelected(encoded!, decoded!, 2, 1)).toBe(true);
    expect(isRasterSelectionPixelSelected(encoded!, decoded!, 1, 0)).toBe(false);
    expect(isRasterSelectionPixelSelected(encoded!, decoded!, -1, 0)).toBe(false);
  });

  it('counts exposed pixel edges and builds a two-sided outline without contours', () => {
    const block = Uint8Array.from([1, 1, 0, 1, 1, 0, 0, 0, 0]);
    const bounds: Pos = { x: 0, y: 0, width: 3, height: 3 };
    const encoded = encodeRasterSelectionMask(block, 3, 3, bounds)!;
    const packed = decodeRasterSelectionMask(encoded)!;

    expect(countSelectionBoundaryEdges(block, 3, 3, bounds)).toBe(8);
    expect(createRasterSelectionBoundaryMask(encoded, packed)).toEqual(
      Uint8Array.from([0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0])
    );
  });

  it('rejects malformed, over-budget, and non-canonical masks before decoding', () => {
    expect(decodeRasterSelectionMask({ width: 2, height: 2, data: 'AAAA' })).toBeNull();
    expect(isCanonicalRasterSelectionMask({ width: 2, height: 2, data: '!!!!' })).toBe(false);
    expect(isCanonicalRasterSelectionMask({ width: 2, height: 2, data: 'AAAA' })).toBe(false);
    expect(isCanonicalRasterSelectionMask({ width: 1, height: 1, data: 'AR==' })).toBe(false);
    expect(isCanonicalRasterSelectionMask({ width: 1, height: 1, data: 'Ag==' })).toBe(false);
    expect(isCanonicalRasterSelectionMask({ width: 2, height: 2, data: 'AAAA', extra: true })).toBe(false);
    expect(isCanonicalRasterSelectionMask({ width: 4097, height: 4096, data: '' })).toBe(false);
    expect(encodeRasterSelectionMask(new Uint8Array(1), 1, 1, { x: 0, y: 0, width: 4097, height: 4096 })).toBeNull();
  });

  it('rejects oversized payloads before scanning their contents', () => {
    expect(isCanonicalRasterSelectionMask({ width: 1, height: 1, data: 'A'.repeat(4 * 1024 * 1024) })).toBe(false);
  });

  it('rejects empty masks at validation and encoding boundaries', () => {
    expect(isCanonicalRasterSelectionMask({ width: 1, height: 1, data: 'AA==' })).toBe(false);
    expect(encodeRasterSelectionMask(new Uint8Array(4), 2, 2, { x: 0, y: 0, width: 2, height: 2 })).toBeNull();
  });
});
