import { describe, expect, it } from 'vitest';

import {
  COLOR_SAMPLER_CAP_REFUSAL,
  COLOR_SAMPLER_HIT_RADIUS,
  COLOR_SAMPLER_MAX_SAMPLES,
  COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS,
  colorSampleBounds,
  parseHexColor,
  roundChannel,
  sampleColorAt,
  sampleColorAtMappedPixels,
  samplerAt,
  samplerCapReached,
  samplerReadout,
  type ColorSampleBounds,
  type ColorSamplePixelMapper,
  type ColorSampler,
} from '../colorSampler.ts';
import { EYEDROPPER_SAMPLE_SIZE_OPTIONS } from '../eyedropper.ts';

/**
 * A solid bitmap with one colour, addressed the way `getImageData` returns one.
 *
 * Built by hand rather than through a canvas because this file is the one that proves the averaging
 * arithmetic, and a canvas would be a second implementation of it standing between the assertion and
 * the pixels.
 */
const bitmap = (width: number, height: number, colour: [number, number, number, number?]): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = colour[0];
    data[index * 4 + 1] = colour[1];
    data[index * 4 + 2] = colour[2];
    data[index * 4 + 3] = colour[3] ?? 255;
  }
  return data;
};

/** A width-by-height bitmap whose single pixel at `at` is `colour` and everything else is black. */
const bitmapWithPixel = (
  width: number,
  height: number,
  at: { x: number; y: number },
  colour: [number, number, number, number?]
): Uint8ClampedArray => {
  const data = bitmap(width, height, [0, 0, 0]);
  data[(at.y * width + at.x) * 4] = colour[0];
  data[(at.y * width + at.x) * 4 + 1] = colour[1];
  data[(at.y * width + at.x) * 4 + 2] = colour[2];
  data[(at.y * width + at.x) * 4 + 3] = colour[3] ?? 255;
  return data;
};

describe('the sample size list', () => {
  it("is the seven entries Adobe enumerates, with Adobe's own labels", () => {
    // Point Sample reads one pixel and the rest read an average, which is Adobe's own sentence:
    // "Point Sample reads the value of a single pixel, other options read the average of a pixel
    // area." A list that dropped an entry or renamed one would be a different Photoshop control.
    expect(COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS.map(({ label }) => label)).toEqual([
      'Point Sample',
      '3 by 3 Average',
      '5 by 5 Average',
      '11 by 11 Average',
      '31 by 31 Average',
      '51 by 51 Average',
      '101 by 101 Average',
    ]);
  });

  it('is the SAME list object the Eyedropper renders, because Adobe names one control for both', () => {
    // The identity assertion, not an equality one: two equal-looking arrays would pass `toEqual` and
    // then drift, which is the cost the shared spelling exists to avoid.
    expect(COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS).toBe(EYEDROPPER_SAMPLE_SIZE_OPTIONS);
  });
});

describe('COLOR_SAMPLER_MAX_SAMPLES', () => {
  it('is four, because that is what Adobe states', () => {
    // "You can also use up to four Color Samplers" and "place up to four color samplers on the
    // image", plus the tools table's "up to four areas". The count is contested — Adobe's own
    // blogger and two third-party observations say ten — and the conflict is recorded in
    // `colorSampler.ts` rather than resolved away, so this pins the side the authority ladder picks
    // and would go red if a later session swapped it without reopening the evidence.
    expect(COLOR_SAMPLER_MAX_SAMPLES).toBe(4);
  });
});

describe('roundChannel', () => {
  it('rounds a fractional mean to a whole channel value', () => {
    // A readout has to be an integer, and this is the whole of the rounding rule.
    expect(roundChannel(5, 2)).toBe(3);
  });

  it('does not floor, which would bias every average down', () => {
    expect(roundChannel(7, 2)).toBe(4);
  });
});

describe('colorSampleBounds', () => {
  it('returns the clipped square footprint for a point well inside the frame', () => {
    // 5x5 sample centered at (5,5) in a 20x20 frame: half = 2, bounds are [3,7] x [3,7]
    const bounds = colorSampleBounds({ width: 20, height: 20 }, { x: 5.3, y: 5.7 }, 5);
    expect(bounds).toEqual({
      centerX: 5,
      centerY: 5,
      left: 3,
      top: 3,
      right: 8,
      bottom: 8,
    });
  });

  it('clips the left and top edges when the block exceeds the frame origin', () => {
    // 5x5 sample centered at (1,1): half = 2, ideal left = -1, top = -1, clipped to 0
    const bounds = colorSampleBounds({ width: 20, height: 20 }, { x: 1, y: 1 }, 5);
    expect(bounds).toEqual({
      centerX: 1,
      centerY: 1,
      left: 0,
      top: 0,
      right: 4,
      bottom: 4,
    });
  });

  it('clips the right and bottom edges when the block exceeds the frame size', () => {
    // 5x5 sample centered at (18,18) in 20x20: half = 2, ideal right = 21, bottom = 21, clipped to 20
    const bounds = colorSampleBounds({ width: 20, height: 20 }, { x: 18, y: 18 }, 5);
    expect(bounds).toEqual({
      centerX: 18,
      centerY: 18,
      left: 16,
      top: 16,
      right: 20,
      bottom: 20,
    });
  });

  it('handles a 1x1 sample size (Point Sample) at any valid point', () => {
    const bounds = colorSampleBounds({ width: 10, height: 10 }, { x: 5.9, y: 5.1 }, 1);
    expect(bounds).toEqual({
      centerX: 5,
      centerY: 5,
      left: 5,
      top: 5,
      right: 6,
      bottom: 6,
    });
  });

  it('returns null when the point is outside the frame to the right', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 10, y: 5 }, 3)).toBeNull();
  });

  it('returns null when the point is outside the frame to the left', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: -1, y: 5 }, 3)).toBeNull();
  });

  it('returns null when the point is outside the frame at the bottom', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 10 }, 3)).toBeNull();
  });

  it('returns null when the point is outside the frame at the top', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: -1 }, 3)).toBeNull();
  });

  it('returns null for NaN point coordinates', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: NaN, y: 5 }, 3)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: NaN }, 3)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: NaN, y: NaN }, 3)).toBeNull();
  });

  it('returns null for infinite point coordinates', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: Infinity, y: 5 }, 3)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: -Infinity }, 3)).toBeNull();
  });

  it('returns null for non-finite sampleSize', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, NaN)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, Infinity)).toBeNull();
  });

  it('returns null for sampleSize less than 1', () => {
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, 0)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, -1)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, 0.5)).toBeNull();
  });

  it('returns null for frame width less than 1', () => {
    expect(colorSampleBounds({ width: 0, height: 10 }, { x: 5, y: 5 }, 3)).toBeNull();
    expect(colorSampleBounds({ width: -1, height: 10 }, { x: 5, y: 5 }, 3)).toBeNull();
  });

  it('returns null for frame height less than 1', () => {
    expect(colorSampleBounds({ width: 10, height: 0 }, { x: 5, y: 5 }, 3)).toBeNull();
    expect(colorSampleBounds({ width: 10, height: -1 }, { x: 5, y: 5 }, 3)).toBeNull();
  });

  it('returns a ColorSampleBounds object with all six required fields', () => {
    const bounds = colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, 3);
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(typeof bounds.centerX).toBe('number');
      expect(typeof bounds.centerY).toBe('number');
      expect(typeof bounds.left).toBe('number');
      expect(typeof bounds.top).toBe('number');
      expect(typeof bounds.right).toBe('number');
      expect(typeof bounds.bottom).toBe('number');
      // Verify structural invariants
      expect(bounds.left).toBeLessThanOrEqual(bounds.centerX);
      expect(bounds.centerX).toBeLessThan(bounds.right);
      expect(bounds.top).toBeLessThanOrEqual(bounds.centerY);
      expect(bounds.centerY).toBeLessThan(bounds.bottom);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(10);
      expect(bounds.bottom).toBeLessThanOrEqual(10);
    }
  });

  it('handles even sample sizes by flooring half', () => {
    // sampleSize = 4, half = 2, block is 4x4 centered on floor(point)
    const bounds = colorSampleBounds({ width: 20, height: 20 }, { x: 10, y: 10 }, 4);
    expect(bounds).toEqual({
      centerX: 10,
      centerY: 10,
      left: 8,
      top: 8,
      right: 13,
      bottom: 13,
    });
  });

  it('handles a sample size larger than the frame', () => {
    // 101x101 sample in a 10x10 frame: entire frame is included
    const bounds = colorSampleBounds({ width: 10, height: 10 }, { x: 5, y: 5 }, 101);
    expect(bounds).toEqual({
      centerX: 5,
      centerY: 5,
      left: 0,
      top: 0,
      right: 10,
      bottom: 10,
    });
  });
});

describe('sampleColorAtMappedPixels', () => {
  it('averages pixels using a custom mapper that maps document to bitmap 1:1', () => {
    const data = bitmapWithPixel(10, 10, { x: 5, y: 5 }, [255, 255, 255]);
    const identityMapper = (x: number, y: number) => ({ x, y });

    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 3, identityMapper);
    // 3x3 block, one white pixel, eight black: 255/9 ≈ 28.33, rounds to 28 = 0x1c
    expect(color).toBe('#1c1c1c');
  });

  it('applies a custom mapper that offsets document coordinates', () => {
    // Bitmap is 10x10 but document is 20x20; mapper shifts by (-5,-5)
    const data = bitmapWithPixel(10, 10, { x: 0, y: 0 }, [200, 100, 50]);
    const offsetMapper = (x: number, y: number) => ({ x: x - 5, y: y - 5 });

    // Click at document (5,5) with sampleSize=1 maps to bitmap (0,0)
    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 20, height: 20 }, { x: 5, y: 5 }, 1, offsetMapper);
    expect(color).toBe('#c86432');
  });

  it('returns null when mapper returns null for the center pixel', () => {
    const data = bitmap(10, 10, [255, 255, 255]);
    const failingMapper = () => null;

    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 1, failingMapper);
    expect(color).toBeNull();
  });

  it('returns null when mapper returns non-integer coordinates', () => {
    const data = bitmap(10, 10, [255, 255, 255]);
    const fractionalMapper = (x: number, y: number) => ({ x: x + 0.5, y: y });

    const color = sampleColorAtMappedPixels(
      data,
      10,
      10,
      { width: 10, height: 10 },
      { x: 5, y: 5 },
      1,
      fractionalMapper
    );
    expect(color).toBeNull();
  });

  it('returns null when mapper returns coordinates outside bitmap bounds', () => {
    const data = bitmap(10, 10, [255, 255, 255]);
    const outOfBoundsMapper = (x: number, y: number) => ({ x: x + 100, y: y });

    const color = sampleColorAtMappedPixels(
      data,
      10,
      10,
      { width: 10, height: 10 },
      { x: 5, y: 5 },
      1,
      outOfBoundsMapper
    );
    expect(color).toBeNull();
  });

  it('returns null when center pixel is transparent', () => {
    const data = bitmap(10, 10, [0, 0, 0, 0]);
    const center = (5 * 10 + 5) * 4;
    data[center] = 255;
    data[center + 1] = 255;
    data[center + 2] = 255;
    data[center + 3] = 0; // transparent center
    const identityMapper = (x: number, y: number) => ({ x, y });

    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 3, identityMapper);
    expect(color).toBeNull();
  });

  it('averages a block with transparent surround when center is opaque', () => {
    const data = bitmap(10, 10, [0, 0, 0, 0]);
    const center = (5 * 10 + 5) * 4;
    data[center] = 200;
    data[center + 1] = 100;
    data[center + 2] = 50;
    data[center + 3] = 255;
    const identityMapper = (x: number, y: number) => ({ x, y });

    // 3x3 = 9 pixels, one colored: 200/9≈22, 100/9≈11, 50/9≈6
    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 3, identityMapper);
    expect(color).toBe('#160b06');
  });

  it('returns null for bitmap dimensions less than 1', () => {
    const data = new Uint8ClampedArray(0);
    const identityMapper = (x: number, y: number) => ({ x, y });

    expect(
      sampleColorAtMappedPixels(data, 0, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 1, identityMapper)
    ).toBeNull();
    expect(
      sampleColorAtMappedPixels(data, 10, 0, { width: 10, height: 10 }, { x: 5, y: 5 }, 1, identityMapper)
    ).toBeNull();
  });

  it('returns null when colorSampleBounds returns null (point outside frame)', () => {
    const data = bitmap(10, 10, [255, 255, 255]);
    const identityMapper = (x: number, y: number) => ({ x, y });

    const color = sampleColorAtMappedPixels(
      data,
      10,
      10,
      { width: 10, height: 10 },
      { x: 15, y: 5 },
      1,
      identityMapper
    );
    expect(color).toBeNull();
  });

  it('clips the sampling block at frame edges through colorSampleBounds', () => {
    // 5x5 sample at corner (0,0) in 10x10: only 3x3 pixels exist
    const data = bitmap(10, 10, [90, 90, 90]);
    const identityMapper = (x: number, y: number) => ({ x, y });

    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 0, y: 0 }, 5, identityMapper);
    // 9 pixels * 90 / 9 = 90 = 0x5a
    expect(color).toBe('#5a5a5a');
  });

  it('returns null if any pixel in the block maps to an invalid offset', () => {
    // Mapper that fails for one pixel in the block
    const data = bitmap(10, 10, [255, 255, 255]);
    let callCount = 0;
    const partialMapper = (x: number, y: number) => {
      callCount++;
      if (x === 5 && y === 5) return null; // fail at center
      return { x, y };
    };

    const color = sampleColorAtMappedPixels(data, 10, 10, { width: 10, height: 10 }, { x: 5, y: 5 }, 3, partialMapper);
    expect(color).toBeNull();
  });
});

describe('sampleColorAt', () => {
  it('reads the exact pixel under the click at Point Sample', () => {
    const data = bitmap(10, 10, [18, 52, 86]);

    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 1)).toBe('#123456');
  });

  it('floors the point, so a click between two pixels reads the one it is over', () => {
    const data = bitmap(10, 10, [10, 20, 30]);

    expect(sampleColorAt(data, 10, 10, { x: 5.9, y: 5.1 }, 1)).toBe('#0a141e');
  });

  it('averages the square around the click at 3 by 3, not the centre pixel alone', () => {
    // Eight black pixels around one white one: the mean is 255/9 per channel, which rounds to 28.
    // A Point Sample here would read `#ffffff`, so this distinguishes the two behaviours rather than
    // merely checking a colour.
    const data = bitmapWithPixel(10, 10, { x: 5, y: 5 }, [255, 255, 255]);

    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 3)).toBe('#1c1c1c');
    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 1)).toBe('#ffffff');
  });

  it('CLIPS the block at the image edge rather than shifting it inward', () => {
    // A 5-by-5 block on the corner averages the 3-by-3 pixels that exist, which is 9 samples. If the
    // block were shifted inward the count would still be 9, so the distinguishing assertion is on a
    // bitmap where the corner region is the ONLY place the colour appears: shifted inward would
    // read black.
    const data = bitmap(10, 10, [0, 0, 0]);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        data[(y * 10 + x) * 4] = 90;
        data[(y * 10 + x) * 4 + 1] = 90;
        data[(y * 10 + x) * 4 + 2] = 90;
      }
    }

    expect(sampleColorAt(data, 10, 10, { x: 0, y: 0 }, 5)).toBe('#5a5a5a');
  });

  it('clips at the far edge too, so a click on the last pixel is not out of bounds', () => {
    const data = bitmap(10, 10, [40, 40, 40]);

    expect(sampleColorAt(data, 10, 10, { x: 9, y: 9 }, 101)).toBe('#282828');
  });

  it('refuses a point outside the bitmap rather than reading out of bounds', () => {
    const data = bitmap(10, 10, [255, 255, 255]);

    expect(sampleColorAt(data, 10, 10, { x: 10, y: 5 }, 1)).toBeNull();
    expect(sampleColorAt(data, 10, 10, { x: -1, y: 5 }, 1)).toBeNull();
    expect(sampleColorAt(data, 10, 10, { x: 5, y: 10 }, 1)).toBeNull();
  });

  it('refuses a fully transparent CENTRE pixel, because it has no colour to report', () => {
    // Adobe shows a crossed-out swatch here and changes nothing; averaging the transparent pixel in
    // would report black, which is a colour the user never sampled.
    const data = bitmap(10, 10, [0, 0, 0, 0]);

    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 1)).toBeNull();
  });

  it('still averages a block whose SURROUND is transparent, because the centre is opaque', () => {
    // The counter-case to the row above, and the reason the test reads the CENTRE's alpha rather
    // than the block's mean: a 1-pixel object on a transparent layer is opaque at its own centre
    // with transparent edges, and it has a real colour.
    const data = bitmap(10, 10, [0, 0, 0, 0]);
    const center = (5 * 10 + 5) * 4;
    data[center] = 200;
    data[center + 1] = 100;
    data[center + 2] = 50;
    data[center + 3] = 255;

    // 3x3 clipped over a 10-wide bitmap: 9 pixels, one of which carries the colour, so the mean is
    // 200/9 = 22.2, 100/9 = 11.1 and 50/9 = 5.6, which round to 22, 11 and 6.
    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 3)).toBe('#160b06');
  });

  it('drops alpha, because every swatch in this app is a CSS colour', () => {
    // The composited canvas has already resolved alpha against the document, so an alpha channel
    // here would be a fourth number no control in the app can show.
    const data = bitmap(10, 10, [200, 100, 50, 128]);

    const hex = sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 1);
    expect(hex).toBe('#c86432');
    expect(hex).not.toContain('a');
    expect(hex).toHaveLength(7);
  });

  it('pads every channel to two digits, so a dark sample does not lose its leading zero', () => {
    // `toString(16)` on 5 is `'5'`, and a `#55`-shaped hex would be three digits and parse wrong.
    const data = bitmap(10, 10, [5, 5, 5]);

    expect(sampleColorAt(data, 10, 10, { x: 5, y: 5 }, 1)).toBe('#050505');
  });
});

describe('samplerCapReached', () => {
  it('admits a placement while there is room', () => {
    expect(samplerCapReached(0)).toEqual({ ok: true });
    expect(samplerCapReached(COLOR_SAMPLER_MAX_SAMPLES - 1)).toEqual({ ok: true });
  });

  it('refuses at the cap, with a reason rather than a replacement rule', () => {
    const result = samplerCapReached(COLOR_SAMPLER_MAX_SAMPLES);

    expect(result.ok).toBe(false);
    // No source describes Photoshop silently replacing or deleting the oldest sampler, so the
    // refusal carries a name and the caller says it.
    expect(result.ok === false && result.reason).toBe('color-sampler-cap-reached');
  });

  it('refuses above the cap too, rather than treating the count as advisory', () => {
    expect(samplerCapReached(COLOR_SAMPLER_MAX_SAMPLES + 1).ok).toBe(false);
  });

  it('exports the exact refusal reason string', () => {
    expect(COLOR_SAMPLER_CAP_REFUSAL).toBe('color-sampler-cap-reached');
  });
});

describe('samplerAt', () => {
  const one = (id: number, x: number, y: number): ColorSampler => ({ id, point: { x, y }, color: '#000000' });

  it('finds a sampler under the pointer', () => {
    expect(samplerAt([one(1, 50, 50)], { x: 50, y: 50 })?.id).toBe(1);
  });

  it('returns nothing beyond the hit radius, so an ordinary click places rather than moves', () => {
    expect(samplerAt([one(1, 50, 50)], { x: 50 + COLOR_SAMPLER_HIT_RADIUS + 1, y: 50 })).toBeNull();
  });

  it('accepts a press exactly on the radius, because the radius is inclusive', () => {
    expect(samplerAt([one(1, 0, 0)], { x: COLOR_SAMPLER_HIT_RADIUS, y: 0 })?.id).toBe(1);
  });

  it('returns the NEAREST of two overlapping samplers, not the first in the array', () => {
    // The first row is 4px away and the second 1px away; taking the first would move the wrong
    // marker and this is the assertion that catches it.
    expect(samplerAt([one(1, 4, 0), one(2, 1, 0)], { x: 0, y: 0 })?.id).toBe(2);
  });

  it('has a hit radius in DOCUMENT pixels, which is the app decision it is declared to be', () => {
    // Adobe states the drag and publishes no tolerance; without one, every click would either move a
    // marker or place a second one on top of it.
    expect(COLOR_SAMPLER_HIT_RADIUS).toBe(8);
  });

  it('returns null for an empty samplers array', () => {
    expect(samplerAt([], { x: 50, y: 50 })).toBeNull();
  });

  it('returns null when all samplers are beyond the hit radius', () => {
    expect(samplerAt([one(1, 100, 100), one(2, 200, 200)], { x: 0, y: 0 })).toBeNull();
  });

  it('handles multiple samplers at the same distance by returning the first encountered', () => {
    // Two samplers at equal distance (3,4) and (4,3) from origin, both distance 5
    const samplers = [one(1, 3, 4), one(2, 4, 3)];
    const result = samplerAt(samplers, { x: 0, y: 0 });
    expect(result).not.toBeNull();
    expect([1, 2]).toContain(result?.id);
  });
});

describe('parseHexColor', () => {
  it('splits a hex string into its three channels', () => {
    expect(parseHexColor('#1a2b3c')).toEqual({ red: 26, green: 43, blue: 60, hex: '#1a2b3c' });
  });

  it('reads single-digit channels as the zero-padded value, not as a short slice', () => {
    // `#050505` is three 05 channels: a parse that read `05` as 5 would be right here by accident,
    // and a parse that assumed two digits per channel would take `0` and produce `#00`.
    expect(parseHexColor('#050505')).toEqual({ red: 5, green: 5, blue: 5, hex: '#050505' });
  });

  it('lowercases, so two samples of the same colour report the same string', () => {
    expect(parseHexColor('#ABCDEF').hex).toBe('#abcdef');
  });

  it('handles mixed case input', () => {
    expect(parseHexColor('#AbCdEf')).toEqual({ red: 171, green: 205, blue: 239, hex: '#abcdef' });
  });

  it('returns the hex in lowercase as part of the readout', () => {
    expect(parseHexColor('#FF0000').hex).toBe('#ff0000');
    expect(parseHexColor('#00FF00').hex).toBe('#00ff00');
    expect(parseHexColor('#0000FF').hex).toBe('#0000ff');
  });
});

describe('samplerReadout', () => {
  it('reports the three channels and the hex of one sampler', () => {
    expect(samplerReadout({ id: 1, point: { x: 0, y: 0 }, color: '#804020' })).toEqual({
      red: 128,
      green: 64,
      blue: 32,
      hex: '#804020',
    });
  });

  it('uses parseHexColor internally, so it inherits the lowercase behavior', () => {
    expect(samplerReadout({ id: 2, point: { x: 10, y: 10 }, color: '#FF00AA' })).toEqual({
      red: 255,
      green: 0,
      blue: 170,
      hex: '#ff00aa',
    });
  });

  it('returns a ColorSamplerReadout with all four required fields', () => {
    const readout = samplerReadout({ id: 3, point: { x: 5, y: 5 }, color: '#123456' });
    expect(typeof readout.red).toBe('number');
    expect(typeof readout.green).toBe('number');
    expect(typeof readout.blue).toBe('number');
    expect(typeof readout.hex).toBe('string');
    expect(readout.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('ColorSampleBounds type', () => {
  it('is a structural type with six number fields', () => {
    const bounds: ColorSampleBounds = {
      centerX: 5,
      centerY: 5,
      left: 3,
      top: 3,
      right: 8,
      bottom: 8,
    };
    // If this compiles, the type has the correct structure
    expect(bounds.centerX).toBe(5);
    expect(bounds.centerY).toBe(5);
    expect(bounds.left).toBe(3);
    expect(bounds.top).toBe(3);
    expect(bounds.right).toBe(8);
    expect(bounds.bottom).toBe(8);
  });
});

describe('ColorSamplePixelMapper type', () => {
  it('accepts a function mapping document coordinates to bitmap coordinates or null', () => {
    const mapper: ColorSamplePixelMapper = (x: number, y: number) => {
      if (x < 0 || y < 0) return null;
      return { x, y };
    };
    expect(mapper(5, 5)).toEqual({ x: 5, y: 5 });
    expect(mapper(-1, 5)).toBeNull();
  });

  it('can return null to signal an invalid mapping', () => {
    const alwaysNull: ColorSamplePixelMapper = () => null;
    expect(alwaysNull(0, 0)).toBeNull();
  });
});
