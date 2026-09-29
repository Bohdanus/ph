import type { TipLut, TipParams } from './brush-types.ts';
import {
  DEFAULT_TIP_PARAMS,
  MAX_TIP_ASPECT,
  MAX_TIP_SIZE,
  MIN_TIP_ASPECT,
  MIN_TIP_SIZE,
  clamp,
} from './brush-types.ts';

// unverified: no canonical brush-hardness falloff curve exists; the linear-cone-plus-shaping-curve form is standard practice, not spec.
const coneFalloff = (t: number, hardness: number, powerGamma: number, smoothstep: boolean): number => {
  const u = clamp((1 - t) / (1 - hardness), 0, 1);
  if (smoothstep) return u * u * (3 - 2 * u);
  return Math.pow(u, powerGamma);
};

export const buildTipLut = (overrides?: Partial<TipParams>): TipLut => {
  const params: TipParams = { ...DEFAULT_TIP_PARAMS, ...overrides };

  const size = clamp(params.size, MIN_TIP_SIZE, MAX_TIP_SIZE);
  const radius = size / 2;

  const aspect = clamp(params.aspect, MIN_TIP_ASPECT, MAX_TIP_ASPECT);
  const sqrtAspect = Math.sqrt(aspect);
  const radiusX = radius * sqrtAspect;
  const radiusY = radius / sqrtAspect;

  const halfX = Math.ceil(radiusX);
  const halfY = Math.ceil(radiusY);

  const hardness = clamp(params.hardness, 0, 1);
  const hard = hardness >= 1;
  const powerGamma = clamp(params.powerGamma, 0.01, 64);
  const smoothstep = params.falloff === 'smoothstep';

  const profile = (t: number): number => {
    if (hard) return t <= 1 ? 1 : 0;
    return coneFalloff(t, hardness, powerGamma, smoothstep);
  };

  const lutX = new Float32Array(halfX * 2 + 1);
  const lutY = new Float32Array(halfY * 2 + 1);

  for (let i = -halfX; i <= halfX; i++) {
    lutX[i + halfX] = profile(Math.abs(i) / radiusX);
  }
  for (let j = -halfY; j <= halfY; j++) {
    lutY[j + halfY] = profile(Math.abs(j) / radiusY);
  }

  return {
    lutX,
    lutY,
    radius,
    radiusX,
    radiusY,
    halfX,
    halfY,
    hard,
    square: params.shape === 'square',
    wetEdges: clamp(params.wetEdges, 0, 1),
    cos: Math.cos(params.angle),
    sin: Math.sin(params.angle),
  };
};
