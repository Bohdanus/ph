import { describe, expect, it } from 'vitest';

import {
  COLOR_SAMPLER_HIT_RADIUS,
  COLOR_SAMPLER_MAX_SAMPLES,
  COLOR_SAMPLER_SAMPLE_SIZE_OPTIONS,
  parseHexColor,
  roundChannel,
  sampleColorAt,
  samplerAt,
  samplerCapReached,
  samplerReadout,
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
});
