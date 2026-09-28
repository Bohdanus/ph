import type { Blend, CoverageSampler, Rect, Rgb } from './brush-types.ts';
import { BLACK, clamp, normalBlend, resolveBlend } from './brush-types.ts';

export type DabOptions = {
  color?: Rgb;
  footprint?: Rect;
};

export type FlushResult = {
  data: Uint8ClampedArray;
  alpha: Float32Array;
  rect: Rect;
};

export type StrokeBuffer = {
  readonly rect: Rect;
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  dirtyRect(): Rect | null;
  stampDab(
    x: number,
    y: number,
    coverage: number | CoverageSampler,
    flow: number,
    blend?: Blend,
    options?: DabOptions
  ): void;
  flush(backdrop: Uint8ClampedArray | null, opacity: number, blend?: Blend): FlushResult | null;
  reset(): void;
};

const toUnit = (value: number): number => clamp(value, 0, 255) / 255;

export const createStrokeBuffer = (rect: Rect, color: Rgb = BLACK): StrokeBuffer => {
  const originX = Math.floor(rect.x);
  const originY = Math.floor(rect.y);
  const width = Math.max(0, Math.ceil(rect.x + rect.width) - originX);
  const height = Math.max(0, Math.ceil(rect.y + rect.height) - originY);
  const data = new Float32Array(width * height * 4);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  const stampDab = (
    x: number,
    y: number,
    coverage: number | CoverageSampler,
    flow: number,
    blend: Blend = normalBlend,
    options?: DabOptions
  ): void => {
    const f = clamp(flow, 0, 1);
    if (f <= 0 || width === 0 || height === 0) return;

    const sampler = typeof coverage === 'function' ? coverage : null;
    const uniform = sampler ? 0 : clamp(coverage as number, 0, 1);
    if (!sampler && uniform <= 0) return;

    const dab = options?.color ?? color;
    const cr = toUnit(dab.r);
    const cg = toUnit(dab.g);
    const cb = toUnit(dab.b);

    const foot = options?.footprint;
    const fx = foot ? foot.x : x;
    const fy = foot ? foot.y : y;
    const fw = foot ? Math.max(1, Math.round(foot.width)) : 1;
    const fh = foot ? Math.max(1, Math.round(foot.height)) : 1;

    const bx0 = Math.max(0, Math.round(fx) - originX);
    const by0 = Math.max(0, Math.round(fy) - originY);
    const bx1 = Math.min(width - 1, Math.round(fx) + fw - 1 - originX);
    const by1 = Math.min(height - 1, Math.round(fy) + fh - 1 - originY);
    if (bx0 > bx1 || by0 > by1) return;

    const mix = resolveBlend(blend);
    let changed = false;

    for (let py = by0; py <= by1; py++) {
      const row = py * width;
      for (let px = bx0; px <= bx1; px++) {
        const c = sampler ? clamp(sampler(originX + px - x, originY + py - y), 0, 1) : uniform;
        const as = f * c;
        if (as <= 0) continue;
        changed = true;

        const o = (row + px) * 4;
        const a = data[o + 3];
        const sR = data[o];
        const sG = data[o + 1];
        const sB = data[o + 2];

        const inv = 1 - as;
        const k = a * inv;
        const a2 = as + k;

        data[o] = (as * ((1 - a) * cr + a * mix(sR, cr)) + k * sR) / a2;
        data[o + 1] = (as * ((1 - a) * cg + a * mix(sG, cg)) + k * sG) / a2;
        data[o + 2] = (as * ((1 - a) * cb + a * mix(sB, cb)) + k * sB) / a2;
        data[o + 3] = a2;
      }
    }

    if (!changed) return;
    if (bx0 < minX) minX = bx0;
    if (by0 < minY) minY = by0;
    if (bx1 > maxX) maxX = bx1;
    if (by1 > maxY) maxY = by1;
  };

  const dirtyRect = (): Rect | null =>
    maxX < 0 ? null : { x: originX + minX, y: originY + minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  const flush = (
    backdrop: Uint8ClampedArray | null,
    opacity: number,
    blend: Blend = normalBlend
  ): FlushResult | null => {
    if (maxX < 0) return null;

    const o = clamp(opacity, 0, 1);
    const mix = resolveBlend(blend);
    const rw = maxX - minX + 1;
    const rh = maxY - minY + 1;
    const out = new Uint8ClampedArray(rw * rh * 4);
    const alpha = new Float32Array(rw * rh);

    for (let py = 0; py < rh; py++) {
      const srcRow = (minY + py) * width;
      const dstRow = py * rw;
      for (let px = 0; px < rw; px++) {
        const s = (srcRow + minX + px) * 4;
        const d = (dstRow + px) * 4;

        const as = o * data[s + 3];
        const inv = 1 - as;

        let aB = 0;
        let cb0 = 0;
        let cg0 = 0;
        let cb1 = 0;
        if (backdrop) {
          aB = backdrop[s + 3] / 255;
          cb0 = backdrop[s] / 255;
          cg0 = backdrop[s + 1] / 255;
          cb1 = backdrop[s + 2] / 255;
        }

        const rS = data[s];
        const gS = data[s + 1];
        const bS = data[s + 2];

        const cr = (1 - aB) * rS + aB * mix(cb0, rS);
        const cg = (1 - aB) * gS + aB * mix(cg0, gS);
        const cbl = (1 - aB) * bS + aB * mix(cb1, bS);

        const ao = as + aB * inv;
        alpha[dstRow + px] = ao;
        if (ao <= 0) continue;

        out[d] = ((as * cr + aB * inv * cb0) / ao) * 255;
        out[d + 1] = ((as * cg + aB * inv * cg0) / ao) * 255;
        out[d + 2] = ((as * cbl + aB * inv * cb1) / ao) * 255;
        out[d + 3] = ao * 255;
      }
    }

    return { data: out, alpha, rect: { x: originX + minX, y: originY + minY, width: rw, height: rh } };
  };

  const reset = (): void => {
    data.fill(0);
    minX = width;
    minY = height;
    maxX = -1;
    maxY = -1;
  };

  return { rect: { ...rect }, width, height, data, dirtyRect, stampDab, flush, reset };
};
