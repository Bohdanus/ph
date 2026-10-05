import { describe, expect, it, vi } from 'vitest';

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

describe('readColorSampler', () => {
  it('reads the WHOLE bitmap, not a block, because the footprint belongs to sampleColorAt', () => {
    // The readback's only job beyond validating the context is to hand the sampler the full frame.
    // A read sized to the sample block here would clip a footprint whose centre is near an edge, and
    // the clipping rule would be duplicated in two places.
    const { canvas, calls } = canvasOf(64, 48);

    readColorSampler(canvas, { x: 10, y: 10 }, 101);

    expect(calls).toEqual([{ x: 0, y: 0, width: 64, height: 48 }]);
  });

  it('returns the sampled colour for a readable canvas', () => {
    const { canvas } = canvasOf(8, 8, [18, 52, 86, 255]);

    expect(readColorSampler(canvas, { x: 4, y: 4 }, 1)).toEqual({ ok: true, color: '#123456' });
  });

  it('refuses with a NAMED reason when there is no canvas at all', () => {
    // Not a crash and not a silent nothing: a sampler with no colour is a tool that looks broken,
    // and the caller logs this exact string.
    expect(readColorSampler(null, { x: 1, y: 1 }, 1)).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('refuses when the canvas yields no 2D context', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1)).toEqual({
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

    expect(readColorSampler(canvas, { x: 1, y: 1 }, 1)).toEqual({
      ok: false,
      reason: COLOR_SAMPLER_READBACK_UNAVAILABLE,
    });
  });

  it('reports a quiet nothing for a point outside the bitmap, distinct from a refusal', () => {
    // The two failure kinds must not collapse: `ok: false` is loud, `color: null` is Adobe's
    // crossed-out swatch where nothing is drawn and nothing is logged.
    const { canvas } = canvasOf(8, 8);

    expect(readColorSampler(canvas, { x: 99, y: 99 }, 1)).toEqual({ ok: true, color: null });
  });

  it('reports a quiet nothing for a fully transparent pixel, again distinct from a refusal', () => {
    const { canvas } = canvasOf(8, 8, [255, 255, 255, 0]);

    expect(readColorSampler(canvas, { x: 4, y: 4 }, 1)).toEqual({ ok: true, color: null });
  });

  it('names one reason string for every refusal, so a test can pin the exact value', () => {
    // One string rather than a per-cause message: the caller's log line carries the context, and a
    // second spelling of the same refusal is what makes a refusal untestable.
    expect(COLOR_SAMPLER_READBACK_UNAVAILABLE).toBe('color-sampler-readback-unavailable');
  });
});
