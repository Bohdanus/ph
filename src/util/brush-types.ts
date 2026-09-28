export type TipShape = 'round' | 'square';

export type TipFalloff = 'power' | 'smoothstep';

export type TipParams = {
  size: number;
  hardness: number;
  aspect: number;
  angle: number;
  wetEdges: number;
  shape: TipShape;
  falloff: TipFalloff;
  powerGamma: number;
};

export const DEFAULT_TIP_PARAMS: TipParams = {
  size: 20,
  hardness: 0.5,
  aspect: 1,
  angle: 0,
  wetEdges: 0,
  shape: 'round',
  falloff: 'smoothstep',
  powerGamma: 2,
};

export const DEFAULT_SPACING_PCT = 25;

export const MIN_TIP_SIZE = 1;
export const MAX_TIP_SIZE = 4096;
export const MIN_TIP_ASPECT = 0.05;
export const MAX_TIP_ASPECT = 20;

export type TipLut = {
  lutX: Float32Array;
  lutY: Float32Array;
  radius: number;
  radiusX: number;
  radiusY: number;
  halfX: number;
  halfY: number;
  hard: boolean;
  square: boolean;
  wetEdges: number;
  cos: number;
  sin: number;
};

export const clamp = (value: number, lo: number, hi: number): number => {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
};

export const sampleTip = (lut: TipLut, dx: number, dy: number): number => {
  const ox = Math.round(dx * lut.cos + dy * lut.sin);
  const oy = Math.round(-dx * lut.sin + dy * lut.cos);
  if (ox < -lut.halfX || ox > lut.halfX || oy < -lut.halfY || oy > lut.halfY) return 0;

  const px = lut.lutX[ox + lut.halfX];
  const py = lut.lutY[oy + lut.halfY];

  let a: number;
  if (lut.square) {
    a = px < py ? px : py;
  } else if (lut.hard) {
    const ex = ox / lut.radiusX;
    const ey = oy / lut.radiusY;
    a = ex * ex + ey * ey <= 1 ? 1 : 0;
  } else {
    a = px * py;
  }

  const k = lut.wetEdges;
  if (k <= 0) return a;
  // unverified: Adobe publishes no Wet Edges formula; this reweighting is a reconstruction of the documented description.
  return a * (1 - k + k * a);
};

export const dabStep = (radius: number, spacingPct: number): number => {
  const pct = clamp(spacingPct, 0, 100);
  return Math.max(1, Math.round((2 * radius * pct) / 100));
};

export type BlendFn = (backdrop: number, source: number) => number;

export type BlendLut = {
  size: number;
  data: Float32Array;
};

export type Blend = BlendFn | BlendLut;

export const normalBlend: BlendFn = (_backdrop, source) => source;

export const isBlendLut = (blend: Blend): blend is BlendLut => typeof blend !== 'function';

export const buildBlendLut = (blend: BlendFn, size = 256): BlendLut => {
  const n = Math.max(2, Math.min(1024, Math.round(size)));
  const data = new Float32Array(n * n);
  const scale = n - 1;
  for (let b = 0; b < n; b++) {
    const backdrop = b / scale;
    for (let s = 0; s < n; s++) {
      data[b * n + s] = clamp(blend(backdrop, s / scale), 0, 1);
    }
  }
  return { size: n, data };
};

export const resolveBlend = (blend: Blend = normalBlend): BlendFn => {
  if (!isBlendLut(blend)) return blend;
  const { size, data } = blend;
  const scale = size - 1;
  return (backdrop, source) => {
    const b = Math.round(clamp(backdrop, 0, 1) * scale);
    const s = Math.round(clamp(source, 0, 1) * scale);
    return data[b * size + s];
  };
};

export type Rgb = { r: number; g: number; b: number };

export type Rect = { x: number; y: number; width: number; height: number };

export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

export type CoverageSampler = (dx: number, dy: number) => number;
