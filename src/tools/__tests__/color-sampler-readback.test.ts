import { describe, expect, it, vi } from 'vitest';

import type { Size } from '../../contexts/general-types.ts';
import { COLOR_SAMPLER_READBACK_UNAVAILABLE, readColorSampler } from '../color-sampler-readback.ts';

/**
 * A canvas whose 2D context hands back a solid field, so the readback's own concerns are what is
 * under test rather than the averaging arithmetic (which `colorSampler.test.ts` owns).
 *
 * The `readWindow` shape is deliberate: it honours the requested rectangle, which is what makes the
 * whole-bitmap read this module performs observable. A stub that ignored the rectangle and returned
 * the full field regardless would pass every assertion here.
 */
const canvasOf = (width: number, height: number, colour: [number, number, number, number] = [10, 20, 30, 255]) => {
  const calls: { x: number; y: number; width: number; height: number }[] = [];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = colour[0];
    data[index * 4 + 1] = colour[1];
    data[index * 4 + 2] = colour[2];
    data[index * 4 + 3] = colour[3];
  }
  const imageData = { data, width, height, colorSpace: 'srgb' } as ImageData;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext = vi.fn(() => ({
    getImageData: (x: number, y: number, w: number, h: number) => {
      calls.push({ x, y, width: w, height: h });
      return imageData;
    },
  })) as unknown as HTMLCanvasElement['getContext'];

  return { canvas, calls };
};

type Rgba = [number, number, number, number];

const logicalColor = (x: number, y: number): Rgba => [
  20 + x * 30 + y * 10,
  10 + x * 15 + y * 20,
  5 + x * 20 + y * 10,
  255,
];
const cssColor = ([red, green, blue]: Rgba): string =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
const mapCenter = (pixel: number, scale: number, extent: number): number =>
  Math.max(0, Math.min(extent - 1, Math.floor((pixel + 0.5) * scale)));

const expectedAverage = (left: number, top: number, right: number, bottom: number): string => {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const [pixelRed, pixelGreen, pixelBlue] = logicalColor(x, y);
      red += pixelRed;
      green += pixelGreen;
      blue += pixelBlue;
      count++;
    }
  }
  return cssColor([Math.round(red / count), Math.round(green / count), Math.round(blue / count), 255]);
};

const expectedBackingAverage = (
  source: Uint8ClampedArray,
  bitmapWidth: number,
  bitmapHeight: number,
  scale: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): string => {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const bitmapX = mapCenter(x, scale, bitmapWidth);
      const bitmapY = mapCenter(y, scale, bitmapHeight);
      const offset = (bitmapY * bitmapWidth + bitmapX) * 4;
      red += source[offset];
      green += source[offset + 1];
      blue += source[offset + 2];
      count++;
    }
  }
  return cssColor([Math.round(red / count), Math.round(green / count), Math.round(blue / count), 255]);
};

const scaledCanvasOf = (frameSize: Size, scale: number) => {
  const width = Math.round(frameSize.width * scale);
  const height = Math.round(frameSize.height * scale);
  const source = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const documentX = Math.min(frameSize.width - 1, Math.floor((x + 0.5) / scale));
      const documentY = Math.min(frameSize.height - 1, Math.floor((y + 0.5) / scale));
      source.set(logicalColor(documentX, documentY), (y * width + x) * 4);
    }
  }

  const calls: { x: number; y: number; width: number; height: number }[] = [];
  const getImageData = vi.fn((x: number, y: number, readWidth: number, readHeight: number): ImageData => {
    calls.push({ x, y, width: readWidth, height: readHeight });
    if (x < 0 || y < 0 || readWidth < 1 || readHeight < 1 || x + readWidth > width || y + readHeight > height) {
      throw new Error('getImageData rectangle is outside the bitmap');
    }
    const data = new Uint8ClampedArray(readWidth * readHeight * 4);
    for (let row = 0; row < readHeight; row++) {
      const from = ((y + row) * width + x) * 4;
      data.set(source.subarray(from, from + readWidth * 4), row * readWidth * 4);
    }
    return { data, width: readWidth, height: readHeight, colorSpace: 'srgb' } as ImageData;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (scale !== 1) canvas.setAttribute('data-hidpi-ratio', String(scale));
  canvas.getContext = vi.fn(() => ({ getImageData })) as unknown as HTMLCanvasElement['getContext'];
  return { canvas, calls, source, width, height };
};

describe('readColorSampler', () => {
  it('reads only the clipped sample rectangle from the backing bitmap', () => {
    // The logical sample is clipped against the frame before its backing-pixel bounds are read.
    const { canvas, calls } = canvasOf(64, 48);

    readColorSampler(canvas, { x: 10, y: 10 }, 101, { width: 64, height: 48 });

    expect(calls).toEqual([{ x: 0, y: 0, width: 61, height: 48 }]);
  });

  it('returns the sampled colour for a readable canvas', () => {
    const { canvas } = canvasOf(8, 8, [18, 52, 86, 255]);

    expect(readColorSampler(canvas, { x: 4, y: 4 }, 1, { width: 8, height: 8 })).toEqual({
      ok: true,
      color: '#123456',
    });
  });

  it('refuses with a NAMED reason when there is no canvas at all', () => {
    // Not a crash and not a silent nothing: a sampler with no colour is a tool that looks broken,
    // and the caller logs this exact string.
    expect(readColorSampler(null, { x: 1, y: 1 }, 1, { width: 8, height: 8 })).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('refuses when the canvas yields no 2D context', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1, { width: 8, height: 8 })).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('refuses when the context has no getImageData, rather than throwing a TypeError', () => {
    // The guard the Eyedropper's area also carries, for the same reason: a 2D context without
    // `getImageData` is reachable under a stub, and without this check the caller would see an
    // exception rather than the named reason it is supposed to report.
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => ({})) as unknown as HTMLCanvasElement['getContext'];

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1, { width: 8, height: 8 })).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('reports a quiet nothing for a point outside the bitmap, distinct from a refusal', () => {
    // The two failure kinds must not collapse: `ok: false` is loud, `color: null` is Adobe's
    // crossed-out swatch where nothing is drawn and nothing is logged.
    const { canvas } = canvasOf(8, 8);

    expect(readColorSampler(canvas, { x: 99, y: 99 }, 1, { width: 8, height: 8 })).toEqual({ ok: true, color: null });
  });

  it('reports a quiet nothing for a fully transparent pixel, again distinct from a refusal', () => {
    const { canvas } = canvasOf(8, 8, [255, 255, 255, 0]);

    expect(readColorSampler(canvas, { x: 4, y: 4 }, 1, { width: 8, height: 8 })).toEqual({ ok: true, color: null });
  });

  it('maps a logical pixel to the rounded backing store at fractional scale', () => {
    const frameSize = { width: 5, height: 3 };
    const { canvas, calls } = scaledCanvasOf(frameSize, 1.25);

    expect(readColorSampler(canvas, { x: 4, y: 2 }, 1, frameSize)).toEqual({
      ok: true,
      color: cssColor(logicalColor(4, 2)),
    });
    expect(calls).toEqual([{ x: 5, y: 3, width: 1, height: 1 }]);
  });

  it('uses the representative backing texel for each logical pixel below 1x', () => {
    // A downscaled composite cannot recover independent source colours for logical pixels that
    // share one backing texel. The sampler reports the composited value at each logical pixel's
    // center; averaging still weights each document pixel once, including repeated texels.
    const frameSize = { width: 4, height: 4 };
    const scale = 0.5;
    const { canvas, calls, source, width, height } = scaledCanvasOf(frameSize, scale);

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 3, frameSize)).toEqual({
      ok: true,
      color: expectedBackingAverage(source, width, height, scale, 0, 0, 3, 3),
    });
    expect(calls).toEqual([{ x: 0, y: 0, width: 2, height: 2 }]);
  });

  it.each([1, 1.25, 1.5, 2, 3])('averages each document pixel once at scale %s', (scale) => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls, width, height } = scaledCanvasOf(frameSize, scale);

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 3, frameSize)).toEqual({
      ok: true,
      color: expectedAverage(0, 0, 3, 3),
    });
    const left = mapCenter(0, scale, width);
    const top = mapCenter(0, scale, height);
    const right = mapCenter(2, scale, width) + 1;
    const bottom = mapCenter(2, scale, height) + 1;
    expect(calls).toEqual([{ x: left, y: top, width: right - left, height: bottom - top }]);
  });

  it.each([1, 1.25, 1.5, 2, 3])('clips an oversized sample to frame pixels at scale %s', (scale) => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls, width, height } = scaledCanvasOf(frameSize, scale);

    expect(readColorSampler(canvas, { x: 0, y: 0 }, 5, frameSize)).toEqual({
      ok: true,
      color: expectedAverage(0, 0, 3, 3),
    });
    const firstX = mapCenter(0, scale, width);
    const firstY = mapCenter(0, scale, height);
    const lastX = mapCenter(2, scale, width);
    const lastY = mapCenter(2, scale, height);
    expect(calls).toEqual([{ x: firstX, y: firstY, width: lastX - firstX + 1, height: lastY - firstY + 1 }]);
  });

  it('treats a missing scale attribute as 1x when the bitmap matches the frame', () => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls } = scaledCanvasOf(frameSize, 1);

    expect(canvas.hasAttribute('data-hidpi-ratio')).toBe(false);
    expect(readColorSampler(canvas, { x: 1, y: 2 }, 1, frameSize)).toEqual({
      ok: true,
      color: cssColor(logicalColor(1, 2)),
    });
    expect(calls).toEqual([{ x: 1, y: 2, width: 1, height: 1 }]);
  });

  it('refuses a published scale that does not describe the bitmap', () => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls } = scaledCanvasOf(frameSize, 2);
    canvas.setAttribute('data-hidpi-ratio', '1.5');

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1, frameSize)).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
    expect(calls).toEqual([]);
  });

  it('refuses an untagged bitmap whose dimensions are not 1x frame size', () => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls } = scaledCanvasOf(frameSize, 2);
    canvas.removeAttribute('data-hidpi-ratio');

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1, frameSize)).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
    expect(calls).toEqual([]);
  });

  it('returns no colour for an out-of-frame point without reading pixels', () => {
    const frameSize = { width: 4, height: 4 };
    const { canvas, calls } = scaledCanvasOf(frameSize, 2);

    expect(readColorSampler(canvas, { x: 4, y: 1 }, 101, frameSize)).toEqual({ ok: true, color: null });
    expect(calls).toEqual([]);
  });

  it('returns a named refusal when getImageData throws', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    canvas.getContext = vi.fn(() => ({
      getImageData: () => {
        throw new Error('tainted');
      },
    })) as unknown as HTMLCanvasElement['getContext'];

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1, { width: 4, height: 4 })).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('names one reason string for every refusal, so a test can pin the exact value', () => {
    // One string rather than a per-cause message: the caller's log line carries the context, and a
    // second spelling of the same refusal is what makes a refusal untestable.
    expect(COLOR_SAMPLER_READBACK_UNAVAILABLE).toBe('color-sampler-readback-unavailable');
  });
});
