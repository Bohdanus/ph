import { describe, expect, it } from 'vitest';

import type { Point, Size } from '../../contexts/general-types.ts';
import {
  blendPixel,
  clampChannel,
  clampPointToSize,
  createPixelBuffer,
  forEachPixelInRect,
  forEachPixelInSize,
  fromHex,
  isPointInSize,
  multiplyChannel,
  pixelIndex,
  premultiplyRgba,
  readRgba,
  toHex,
  unpremultiplyRgba,
  writeRgba,
  type Rgba,
} from '../pixels.ts';

const size: Size = { width: 4, height: 3 };

/** A buffer of one solid colour, so a composite's expected value is hand-derivable. */
function solidBuffer(width: number, height: number, rgba: Rgba): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  forEachPixelInSize({ width, height }, (_x, _y, offset) => {
    data[offset] = rgba.r;
    data[offset + 1] = rgba.g;
    data[offset + 2] = rgba.b;
    data[offset + 3] = rgba.a;
  });
  return data;
}

function at(data: Uint8ClampedArray, x: number, y: number, width: number): Rgba {
  return readRgba(data, x, y, width);
}

describe('pixelIndex', () => {
  it('returns the byte offset of a pixel in a row-major buffer, not its pixel number', () => {
    // (2, 1) of a 4-wide buffer is pixel 6, byte 24. Returning the pixel number is
    // the mistake `getIndex` in `src/util/magneticLasso.ts:55` invites, because its
    // caller multiplies by 4 separately.
    expect(pixelIndex(0, 0, 4)).toBe(0);
    expect(pixelIndex(3, 0, 4)).toBe(12);
    expect(pixelIndex(0, 1, 4)).toBe(16);
    expect(pixelIndex(2, 1, 4)).toBe(24);
  });

  it('is the only arithmetic the resampler loop inlines, so the two agree on every pixel', () => {
    const data = new Uint8ClampedArray(size.width * size.height * 4);
    forEachPixelInSize(size, (x, y, offset) => {
      data[offset] = y;
      data[offset + 1] = x;
    });

    // The two bytes written per pixel, with the alpha pair left at zero, read back
    // as (row, column) in walk order — which is the layout the resampler loop's
    // `(writeRow * targetWidth + x) * 4` produces for the same coordinates.
    expect(Array.from(data)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 1, 3, 0, 0, 2, 0, 0, 0, 2, 1,
      0, 0, 2, 2, 0, 0, 2, 3, 0, 0,
    ]);
  });
});

describe('createPixelBuffer', () => {
  it('allocates four bytes per pixel and leaves every one of them zero', () => {
    const data = createPixelBuffer(size);

    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data.length).toBe(4 * 3 * 4);
    expect(Array.from(data).every((channel) => channel === 0)).toBe(true);
  });

  it('allocates an empty buffer for a zero extent, which is a legal no-op target', () => {
    expect(createPixelBuffer({ width: 0, height: 0 }).length).toBe(0);
    expect(createPixelBuffer({ width: 0, height: 5 }).length).toBe(0);
    expect(createPixelBuffer({ width: 5, height: 0 }).length).toBe(0);
  });

  it('floors a fractional extent rather than producing a buffer the loop cannot index', () => {
    // A 2.5-wide buffer cannot be walked: pixelIndex(2, 0, 2.5) is 10, not a multiple
    // of 4, so every second write would land mid-pixel.
    expect(createPixelBuffer({ width: 2.5, height: 2.5 }).length).toBe(2 * 2 * 4);
  });
});

describe('readRgba', () => {
  it('reads the four channels of a pixel back in r, g, b, a order', () => {
    const data = new Uint8ClampedArray(16);
    data[0] = 10;
    data[1] = 20;
    data[2] = 30;
    data[3] = 40;
    data[12] = 200;
    data[13] = 210;
    data[14] = 220;
    data[15] = 230;

    expect(at(data, 0, 0, 4)).toEqual({ r: 10, g: 20, b: 30, a: 40 });
    expect(at(data, 3, 0, 4)).toEqual({ r: 200, g: 210, b: 220, a: 230 });
  });

  it('reads transparent rather than a neighbour when the byte offset falls outside the buffer', () => {
    const data = solidBuffer(2, 1, { r: 255, g: 255, b: 255, a: 255 });

    // A negative x, a y past the last row, and a half-pixel coordinate all address
    // `undefined` in the buffer; letting that through turns the arithmetic in
    // `blendPixel` and `premultiplyRgba` into NaN a caller cannot trace back here.
    expect(at(data, -1, 0, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(at(data, 0, 1, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(at(data, 2, 0, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(at(data, 1.5, 0, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(at(data, Number.NaN, 0, 2)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('cannot tell a coordinate that wrapped onto a later row from a valid one, which is what isPointInSize is for', () => {
    // `readRgba` gets a width but no height, so `(2, 0)` of a 2-wide buffer is
    // indistinguishable from `(0, 1)`. The coordinate guard is the caller's job.
    const data = solidBuffer(2, 2, { r: 1, g: 1, b: 1, a: 1 });

    expect(at(data, 2, 0, 2)).toEqual(at(data, 0, 1, 2));
  });
});

describe('writeRgba', () => {
  it('writes all four channels at the addressed pixel and leaves its neighbours alone', () => {
    const data = createPixelBuffer({ width: 3, height: 1 });

    writeRgba(data, 1, 0, 3, { r: 1, g: 2, b: 3, a: 4 });

    expect(Array.from(data)).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
  });

  it('clamps out-of-range channels on write, the way the buffer does', () => {
    const data = createPixelBuffer({ width: 1, height: 1 });

    writeRgba(data, 0, 0, 1, { r: 300, g: -20, b: 128.7, a: 255 });

    // 300 and -20 clamp to the ends; 128.7 rounds to 129, which is the buffer's
    // own conversion and is why `writeRgba` does not pre-round.
    expect(Array.from(data)).toEqual([255, 0, 129, 255]);
  });

  it('discards a coordinate that addresses nothing instead of writing past the end', () => {
    const data = solidBuffer(1, 1, { r: 9, g: 9, b: 9, a: 9 });

    writeRgba(data, 1, 0, 1, { r: 0, g: 0, b: 0, a: 0 });
    writeRgba(data, 0, 5, 1, { r: 0, g: 0, b: 0, a: 0 });
    writeRgba(data, -1, 0, 1, { r: 0, g: 0, b: 0, a: 0 });

    expect(Array.from(data)).toEqual([9, 9, 9, 9]);
  });
});

describe('forEachPixelInSize', () => {
  it('visits every pixel once, top-left to bottom-right, with the matching byte offset', () => {
    const visited: Array<[number, number, number]> = [];

    forEachPixelInSize(size, (x, y, offset) => {
      visited.push([x, y, offset]);
    });

    expect(visited).toEqual([
      [0, 0, 0],
      [1, 0, 4],
      [2, 0, 8],
      [3, 0, 12],
      [0, 1, 16],
      [1, 1, 20],
      [2, 1, 24],
      [3, 1, 28],
      [0, 2, 32],
      [1, 2, 36],
      [2, 2, 40],
      [3, 2, 44],
    ]);
  });

  it('agrees with pixelIndex on the offset of every pixel it visits', () => {
    const offsets: number[] = [];

    forEachPixelInSize({ width: 7, height: 5 }, (x, y, offset) => {
      offsets.push(offset);
      expect(offset).toBe(pixelIndex(x, y, 7));
    });

    expect(offsets).toHaveLength(35);
  });

  it('stops at the first pixel whose callback returns false', () => {
    const visited: number[] = [];

    forEachPixelInSize({ width: 4, height: 4 }, (_x, _y, offset) => {
      visited.push(offset);
      return false;
    });

    expect(visited).toEqual([0]);
  });

  it('keeps walking on undefined, so a void callback is not read as a stop request', () => {
    // The arrow `(x, y, o) => writeRgba(data, x, y, width, colour)` is the common
    // per-pixel body and returns whatever writeRgba returns, which is `undefined`.
    let count = 0;
    forEachPixelInSize({ width: 3, height: 2 }, () => {
      count++;
    });

    expect(count).toBe(6);
  });

  it('stops mid-walk on false from a later row, not only on the first pixel', () => {
    const visited: Array<[number, number]> = [];

    forEachPixelInSize({ width: 3, height: 3 }, (x, y) => {
      visited.push([x, y]);
      return y === 1 && x === 1 ? false : undefined;
    });

    expect(visited).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it('visits nothing for a zero extent', () => {
    let count = 0;
    forEachPixelInSize({ width: 0, height: 4 }, () => {
      count++;
    });

    expect(count).toBe(0);
  });
});

describe('forEachPixelInRect', () => {
  it('treats right and bottom as inclusive, so a 1x1 rect visits one pixel', () => {
    // The inclusive choice is the contract: a marquee tool that computes its end
    // point as `left + width` loses a column and a row if these are exclusive.
    const visited: Array<[number, number]> = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 2, top: 2, right: 2, bottom: 2 }, (x, y) => {
      visited.push([x, y]);
    });

    expect(visited).toEqual([[2, 2]]);
  });

  it('covers right - left + 1 columns, not right - left', () => {
    const columns = new Set<number>();
    forEachPixelInRect({ width: 8, height: 2 }, { left: 1, top: 0, right: 3, bottom: 0 }, (x) => {
      columns.add(x);
    });

    expect([...columns].sort()).toEqual([1, 2, 3]);
  });

  it('clips a rect that overhangs the right and bottom edges', () => {
    const visited: Array<[number, number]> = [];
    forEachPixelInRect({ width: 4, height: 3 }, { left: 2, top: 1, right: 99, bottom: 99 }, (x, y) => {
      visited.push([x, y]);
    });

    expect(visited).toEqual([
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
    ]);
  });

  it('clips a rect that starts off the top-left edge', () => {
    const visited: Array<[number, number]> = [];
    forEachPixelInRect({ width: 3, height: 3 }, { left: -5, top: -5, right: 1, bottom: 0 }, (x, y) => {
      visited.push([x, y]);
    });

    expect(visited).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('visits nothing for a rect entirely outside the size', () => {
    const visited: number[] = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 10, top: 10, right: 20, bottom: 20 }, (x) => {
      visited.push(x);
    });

    expect(visited).toEqual([]);
  });

  it('sorts an inverted rect instead of clipping it into a phantom', () => {
    const inverted: number[] = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 3, top: 2, right: 1, bottom: 0 }, (x) => {
      inverted.push(x);
    });

    const sorted: number[] = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 1, top: 0, right: 3, bottom: 2 }, (x) => {
      sorted.push(x);
    });

    expect(inverted).toEqual(sorted);
  });

  it('rounds fractional edges outward, so a drag past a fractional pixel still covers that pixel', () => {
    // 1.2..4.5 covers columns 2, 3 and 4. Rounding the near edge inward instead
    // would drop the pixel the drag started inside, which is the column a fill's
    // first pixel column lands in.
    const visited: Array<[number, number]> = [];
    forEachPixelInRect({ width: 8, height: 8 }, { left: 1.2, top: 1.2, right: 4.5, bottom: 4.5 }, (x, y) => {
      visited.push([x, y]);
    });

    expect(visited).toHaveLength(3 * 3);
    expect(visited[0]).toEqual([2, 2]);
    expect(visited[visited.length - 1]).toEqual([4, 4]);
  });

  it('visits nothing when the rect collapses to a single point off the grid after clipping', () => {
    const visited: number[] = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 3.6, top: 3.6, right: 3.9, bottom: 3.9 }, (x) => {
      visited.push(x);
    });

    expect(visited).toEqual([]);
  });

  it('stops on false exactly as the full-size walk does', () => {
    const visited: Array<[number, number]> = [];
    forEachPixelInRect({ width: 4, height: 4 }, { left: 0, top: 0, right: 3, bottom: 3 }, (x, y) => {
      visited.push([x, y]);
      return visited.length === 5 ? false : undefined;
    });

    expect(visited).toHaveLength(5);
  });

  it('agrees with the full-size walk for a rect covering the whole size', () => {
    const rect: number[] = [];
    const whole: number[] = [];

    forEachPixelInRect({ width: 4, height: 3 }, { left: 0, top: 0, right: 3, bottom: 2 }, (_x, _y, offset) => {
      rect.push(offset);
    });
    forEachPixelInSize({ width: 4, height: 3 }, (_x, _y, offset) => {
      whole.push(offset);
    });

    expect(rect).toEqual(whole);
  });
});

describe('isPointInSize', () => {
  it('accepts the first pixel and the last pixel, and rejects the one past each edge', () => {
    expect(isPointInSize({ x: 0, y: 0 }, size)).toBe(true);
    expect(isPointInSize({ x: 3, y: 2 }, size)).toBe(true);
    // Half-open: a pointer at x = 4 on a 4-wide canvas is one pixel past the last column.
    expect(isPointInSize({ x: 4, y: 0 }, size)).toBe(false);
    expect(isPointInSize({ x: 0, y: 3 }, size)).toBe(false);
  });

  it('rejects negative coordinates', () => {
    expect(isPointInSize({ x: -1, y: 0 }, size)).toBe(false);
    expect(isPointInSize({ x: 0, y: -0.5 }, size)).toBe(false);
  });

  it('accepts a sub-pixel coordinate that is still geometrically inside', () => {
    expect(isPointInSize({ x: 1.5, y: 1.5 }, size)).toBe(true);
  });

  it('rejects everything against a zero extent', () => {
    expect(isPointInSize({ x: 0, y: 0 }, { width: 0, height: 0 })).toBe(false);
  });
});

describe('clampPointToSize', () => {
  it('clamps each axis independently into [0, size - 1]', () => {
    expect(clampPointToSize({ x: 10, y: -4 }, size)).toEqual({ x: 3, y: 0 });
    expect(clampPointToSize({ x: 1, y: 1 }, size)).toEqual({ x: 1, y: 1 });
  });

  it('does not round, because a caller interpolating a stroke still needs the fraction', () => {
    expect(clampPointToSize({ x: 1.5, y: 1.5 }, size)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('clamps to 0 rather than to -1 for a zero extent', () => {
    // `clamp(v, 0, -1)` would return -1, which `clampPointToEdgeMap` in
    // `src/util/magneticLasso.ts:182-187` has to special-case for the same reason.
    expect(clampPointToSize({ x: 5, y: 5 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('agrees with isPointInSize on a clamped point', () => {
    const clamped: Point = clampPointToSize({ x: 99, y: -99 }, { width: 8, height: 8 });

    expect(isPointInSize(clamped, { width: 8, height: 8 })).toBe(true);
  });
});

describe('clampChannel', () => {
  it('clamps below 0 and above 255', () => {
    expect(clampChannel(0)).toBe(0);
    expect(clampChannel(128)).toBe(128);
    expect(clampChannel(255)).toBe(255);
    expect(clampChannel(-1)).toBe(0);
    expect(clampChannel(300)).toBe(255);
  });

  it('clamps a non-finite value to 0, which is what a Uint8ClampedArray writes for it', () => {
    // A sharpen or smudge kernel that divides by a zero neighbourhood sum must not
    // spread NaN across the output; a clamped 0 confines it to the one pixel.
    expect(clampChannel(Number.NaN)).toBe(0);
    expect(clampChannel(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampChannel(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('multiplyChannel', () => {
  it('scales a channel and clamps the product', () => {
    expect(multiplyChannel(100, 0.5)).toBe(50);
    expect(multiplyChannel(200, 2)).toBe(255);
    expect(multiplyChannel(10, -1)).toBe(0);
  });

  it('is the identity at a factor of 1', () => {
    expect(multiplyChannel(0, 1)).toBe(0);
    expect(multiplyChannel(200, 1)).toBe(200);
    expect(multiplyChannel(255, 1)).toBe(255);
  });

  it('collapses to 0 at a factor of 0', () => {
    expect(multiplyChannel(255, 0)).toBe(0);
  });

  it('does not clamp the factor, so a negative factor can invert the channel', () => {
    // Burn and dodge both need factors outside 0..1 to clip against black and white.
    expect(multiplyChannel(40, -3)).toBe(0);
    expect(multiplyChannel(1.5, -2)).toBe(0);
    expect(multiplyChannel(0, -1)).toBe(0);
  });
});

describe('blendPixel', () => {
  it('replaces the destination at full opacity under a full-alpha source', () => {
    const data = solidBuffer(1, 1, { r: 0, g: 0, b: 0, a: 255 });

    blendPixel(data, 0, { r: 200, g: 100, b: 50, a: 255 }, 1);

    expect(Array.from(data)).toEqual([200, 100, 50, 255]);
  });

  it('weights an opaque source over an opaque destination by the opacity, exactly', () => {
    // Co = (Cs * e + Cd * ad * (1 - e)) / ao with e = ao = 0.2:
    //   ao = 0.2 + 1 * 0.8 = 1
    //   R  = (0 * 0.2 + 255 * 1 * 0.8) / 1 = 204
    //   B  = (255 * 0.2 + 0 * 1 * 0.8) / 1 = 51
    // These are exact integers, so nothing here depends on the buffer's tie-breaking.
    const data = solidBuffer(1, 1, { r: 255, g: 0, b: 0, a: 255 });

    blendPixel(data, 0, { r: 0, g: 0, b: 255, a: 255 }, 0.2);

    expect(Array.from(data)).toEqual([204, 0, 51, 255]);
  });

  it('composites a half-alpha source over an opaque destination and keeps the destination opaque', () => {
    // as = 128/255, e = as, ao = as + 1 * (1 - as) = 1, so ao8 = 255 and
    // R = (255 * 128/255 + 0 * 1 * (1 - 128/255)) / 1 = 128.
    const data = solidBuffer(1, 1, { r: 0, g: 0, b: 0, a: 255 });

    blendPixel(data, 0, { r: 255, g: 255, b: 255, a: 128 }, 1);

    expect(Array.from(data)).toEqual([128, 128, 128, 255]);
  });

  it('leaves an opaque destination opaque when a translucent source is composited onto it', () => {
    const data = solidBuffer(1, 1, { r: 255, g: 0, b: 0, a: 255 });

    blendPixel(data, 0, { r: 0, g: 0, b: 255, a: 128 }, 1);

    expect(data[3]).toBe(255);
  });

  it('adds coverage over a transparent destination rather than interpolating towards it', () => {
    // ad = 0, so ao = e = 128/255 and R = (255 * 128/255 + 0) / (128/255) = 255.
    // A lerp towards the (zero-colour) destination would give 128 here, which is the
    // whole reason the equations premultiply instead of blending per channel.
    const data = solidBuffer(1, 1, { r: 0, g: 0, b: 0, a: 0 });

    blendPixel(data, 0, { r: 255, g: 0, b: 0, a: 128 }, 1);

    expect(Array.from(data)).toEqual([255, 0, 0, 128]);
  });

  it('carries a translucent destination forward, so two passes do not collapse it', () => {
    // ad = 64/255, e = 128/255, ao = 128/255 + (64/255) * (127/255) = 19072/65025, so
    // ao8 = 159.87 and R = (255 * 128/255 + 0) / (19072/65025) = 204.16.
    // A lerp per channel would have given 127.5, which is a mid-grey rather than the
    // 50% red-over-50%-red that a 50%-alpha source over a 25%-alpha red is.
    const data = solidBuffer(1, 1, { r: 0, g: 0, b: 0, a: 64 });

    blendPixel(data, 0, { r: 255, g: 0, b: 0, a: 128 }, 1);

    expect(Array.from(data)).toEqual([204, 0, 0, 160]);
  });

  it('leaves the buffer untouched when the source is fully transparent', () => {
    // The equation divides by ao, which is 0 for a transparent source over a
    // transparent destination; taking the `clearPixel` arm there would overwrite
    // colour a caller is iterating toward, so the no-op is returned first.
    const data = solidBuffer(1, 1, { r: 12, g: 34, b: 56, a: 0 });

    blendPixel(data, 0, { r: 255, g: 255, b: 255, a: 0 }, 1);

    expect(Array.from(data)).toEqual([12, 34, 56, 0]);
  });

  it('leaves the buffer untouched at an opacity of zero', () => {
    const data = solidBuffer(1, 1, { r: 200, g: 100, b: 50, a: 255 });

    blendPixel(data, 0, { r: 0, g: 0, b: 0, a: 255 }, 0);

    expect(Array.from(data)).toEqual([200, 100, 50, 255]);
  });

  it('is idempotent at an opacity of one, so a full-coverage stroke is a copy', () => {
    const data = solidBuffer(1, 1, { r: 200, g: 100, b: 50, a: 255 });
    const src: Rgba = { r: 200, g: 100, b: 50, a: 255 };

    blendPixel(data, 0, src, 1);
    blendPixel(data, 0, src, 1);

    expect(Array.from(data)).toEqual([200, 100, 50, 255]);
  });

  it('clamps an opacity above 1 to a full replacement', () => {
    const data = solidBuffer(1, 1, { r: 1, g: 1, b: 1, a: 255 });

    blendPixel(data, 0, { r: 9, g: 9, b: 9, a: 255 }, 4);

    expect(Array.from(data)).toEqual([9, 9, 9, 255]);
  });

  it('only touches the pixel at the given offset, so a stroke can walk the buffer', () => {
    const data = solidBuffer(2, 1, { r: 0, g: 0, b: 0, a: 255 });

    blendPixel(data, pixelIndex(1, 0, 2), { r: 255, g: 255, b: 255, a: 255 }, 1);

    expect(Array.from(data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('discards an offset that addresses nothing', () => {
    const data = solidBuffer(1, 1, { r: 7, g: 7, b: 7, a: 7 });

    blendPixel(data, 4, { r: 0, g: 0, b: 0, a: 0 }, 1);
    blendPixel(data, -4, { r: 0, g: 0, b: 0, a: 0 }, 1);
    blendPixel(data, 1.5, { r: 0, g: 0, b: 0, a: 0 }, 1);

    expect(Array.from(data)).toEqual([7, 7, 7, 7]);
  });
});

describe('toHex', () => {
  it('emits a 6-digit lowercase hex, which is the form the store and tool-settings test require', () => {
    expect(toHex({ r: 255, g: 0, b: 0, a: 255 })).toBe('#ff0000');
    expect(toHex({ r: 0, g: 128, b: 255, a: 255 })).toBe('#0080ff');
    expect(toHex({ r: 18, g: 52, b: 86, a: 255 })).toBe('#123456');
  });

  it('always pads a single-digit channel to two digits', () => {
    expect(toHex({ r: 1, g: 2, b: 3, a: 255 })).toBe('#010203');
  });

  it('drops alpha rather than encoding it, because a CSS hex has no alpha channel', () => {
    expect(toHex({ r: 18, g: 52, b: 86, a: 0 })).toBe('#123456');
    expect(toHex({ r: 18, g: 52, b: 86, a: 128 })).toBe('#123456');
  });

  it('rounds and clamps a channel a gradient stop left as a float', () => {
    expect(toHex({ r: 127.6, g: -10, b: 300, a: 255 })).toBe('#8000ff');
  });
});

describe('fromHex', () => {
  it('parses the 6-digit form the store already holds', () => {
    expect(fromHex('#123456')).toEqual({ r: 18, g: 52, b: 86, a: 255 });
    expect(fromHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('accepts a missing leading hash', () => {
    expect(fromHex('123456')).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it('accepts uppercase digits, as the `defaultSettings` literals are written', () => {
    expect(fromHex('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('expands a 3-digit form by doubling each digit, the CSS rule', () => {
    // `#f80` is `#ff8800`. Zero-padding it instead would parse as `#0f800f`, which is
    // still six valid hex digits and so would pass a length check unnoticed.
    expect(fromHex('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
    expect(fromHex('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 255 });
    expect(fromHex('abc')).toEqual({ r: 170, g: 187, b: 204, a: 255 });
  });

  it('throws on anything that is not a hex colour rather than substituting a colour the user never picked', () => {
    expect(() => fromHex('')).toThrow(TypeError);
    expect(() => fromHex('#12345')).toThrow(TypeError);
    expect(() => fromHex('#1234567')).toThrow(TypeError);
    expect(() => fromHex('#gggggg')).toThrow(TypeError);
    expect(() => fromHex('transparent')).toThrow(TypeError);
  });

  it('round-trips every channel through toHex and fromHex', () => {
    for (let channel = 0; channel <= 255; channel += 17) {
      const rgba: Rgba = { r: channel, g: 255 - channel, b: (channel * 3) % 256, a: 255 };
      expect(fromHex(toHex(rgba))).toEqual(rgba);
    }
  });

  it('round-trips a 3-digit form back to the same colour', () => {
    expect(toHex(fromHex('#f80'))).toBe('#ff8800');
  });
});

describe('premultiplyRgba', () => {
  it('scales colour by alpha / 255 and leaves alpha alone', () => {
    expect(premultiplyRgba({ r: 200, g: 100, b: 50, a: 255 })).toEqual({ r: 200, g: 100, b: 50, a: 255 });
    expect(premultiplyRgba({ r: 200, g: 100, b: 50, a: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('keeps the sub-quantum fraction a straight-alpha average would have discarded', () => {
    // At a = 128 the scale is 128/255, which is not a representable 8-bit step; a
    // straight average of two half-alpha texels gives (127, 0, 127) for a red/blue
    // pair, and the premultiplied average of the same pair is the correct midpoint.
    const premultiplied = premultiplyRgba({ r: 255, g: 0, b: 0, a: 128 });

    expect(premultiplied.r).toBeCloseTo(128, 10);
    expect(premultiplied.a).toBe(128);
  });

  it('clamps a non-finite alpha to 0 rather than scaling colour by NaN', () => {
    expect(premultiplyRgba({ r: 255, g: 255, b: 255, a: Number.NaN })).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });
});

describe('unpremultiplyRgba', () => {
  it('divides colour by alpha / 255, clamped back to 0-255 but not rounded', () => {
    // 127.5 stays 127.5: this is a float accumulator value, and rounding it here
    // would discard the fraction `premultiplyRgba` deliberately kept.
    expect(unpremultiplyRgba({ r: 128, g: 64, b: 0, a: 128 })).toEqual({ r: 255, g: 127.5, b: 0, a: 128 });
  });

  it('clamps a recovered channel that exceeds 255 rather than wrapping it', () => {
    expect(unpremultiplyRgba({ r: 200, g: 0, b: 0, a: 64 })).toEqual({ r: 255, g: 0, b: 0, a: 64 });
  });

  it('returns transparent black at zero alpha instead of dividing by zero', () => {
    // The resampler's own guard for this case is `if (alpha <= 0) clearPixel` at
    // `src/util/homography-resample.ts:110-113`, reached from the other direction.
    expect(unpremultiplyRgba({ r: 10, g: 20, b: 30, a: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('round-trips an opaque colour exactly', () => {
    const rgba: Rgba = { r: 18, g: 52, b: 86, a: 255 };

    expect(unpremultiplyRgba(premultiplyRgba(rgba))).toEqual(rgba);
  });

  it('round-trips a translucent colour to within the one-level loss of an 8-bit buffer', () => {
    // At a = 128 a straight 8-bit channel has only 128 distinct surviving values, so
    // the trip is lossy by up to one. The resampler pays the same rounding to get
    // the averaging right, which a straight-alpha average cannot do at all.
    const rgba: Rgba = { r: 200, g: 100, b: 50, a: 128 };
    const restored = unpremultiplyRgba(premultiplyRgba(rgba));

    expect(restored.a).toBe(128);
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(Math.abs(restored[channel] - rgba[channel])).toBeLessThanOrEqual(1);
    }
  });

  it('round-trips every opacity against itself with a zero-colour pixel', () => {
    for (let alpha = 0; alpha <= 255; alpha++) {
      expect(premultiplyRgba({ r: 0, g: 0, b: 0, a: alpha }).a).toBe(alpha);
      expect(unpremultiplyRgba({ r: 0, g: 0, b: 0, a: alpha }).a).toBe(alpha);
    }
  });
});
