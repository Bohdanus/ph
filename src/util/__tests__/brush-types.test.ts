import { describe, expect, it } from 'vitest';

import {
  clamp,
  dabStep,
  sampleTip,
  buildBlendLut,
  isBlendLut,
  resolveBlend,
  normalBlend,
  MIN_TIP_SIZE,
  MAX_TIP_SIZE,
  MAX_TIP_RADIUS,
  MIN_TIP_ASPECT,
  MAX_TIP_ASPECT,
  DEFAULT_SPACING_PCT,
  type TipLut,
  type TipParams,
  type BlendLut,
} from '../brush-types.ts';
import { buildTipLut } from '../brush-tip.ts';

describe('clamp', () => {
  it('returns the value when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('returns lo when value is below bounds', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(-100, 0, 10)).toBe(0);
  });

  it('returns hi when value is above bounds', () => {
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(100, 0, 10)).toBe(10);
  });

  it('returns lo for NaN and negative infinity, and hi for positive infinity', () => {
    expect(clamp(NaN, 0, 10)).toBe(0);
    expect(clamp(Infinity, 0, 10)).toBe(10);
    expect(clamp(-Infinity, 0, 10)).toBe(0);
  });
});

describe('buildTipLut', () => {
  it('uses zero rotation for non-finite brush angles', () => {
    for (const angle of [NaN, Infinity, -Infinity]) {
      const lut = buildTipLut({ angle });
      expect(lut.cos).toBe(1);
      expect(lut.sin).toBe(0);
    }
  });
});

describe('dabStep', () => {
  it('calculates step as radius * spacingPct / 50', () => {
    expect(dabStep(20, DEFAULT_SPACING_PCT)).toBe(10);
    expect(dabStep(40, DEFAULT_SPACING_PCT)).toBe(20);
    expect(dabStep(10, DEFAULT_SPACING_PCT)).toBe(5);
  });

  it('never returns less than 1', () => {
    expect(dabStep(0.5, DEFAULT_SPACING_PCT)).toBe(1);
    expect(dabStep(1, DEFAULT_SPACING_PCT)).toBe(1);
    expect(dabStep(2, DEFAULT_SPACING_PCT)).toBe(1);
    expect(dabStep(3, DEFAULT_SPACING_PCT)).toBe(2);
  });

  it('clamps spacing at 100%', () => {
    expect(dabStep(20, 100)).toBe(40);
    expect(dabStep(20, 250)).toBe(40);
    expect(dabStep(20, 1e6)).toBe(40);
    expect(dabStep(20, 150)).toBe(dabStep(20, 100));
  });

  it('scales with spacing percentage', () => {
    expect(dabStep(20, 50)).toBe(20);
    expect(dabStep(20, 25)).toBe(10);
    expect(dabStep(20, 10)).toBe(4);
  });

  it('clamps non-finite radii to the supported brush range', () => {
    expect(dabStep(NaN, 25)).toBe(1);
    expect(dabStep(Infinity, 25)).toBe(dabStep(MAX_TIP_RADIUS, 25));
    expect(dabStep(-Infinity, 25)).toBe(1);
  });

  it('clamps non-finite spacing to the supported percentage range', () => {
    expect(dabStep(20, NaN)).toBe(1);
    expect(dabStep(20, Infinity)).toBe(dabStep(20, 100));
    expect(dabStep(20, -Infinity)).toBe(1);
  });
});

describe('sampleTip', () => {
  const createTestLut = (overrides: Partial<TipLut> = {}): TipLut => ({
    lutX: new Float32Array([0, 0.5, 1, 0.5, 0]),
    lutY: new Float32Array([0, 0.5, 1, 0.5, 0]),
    radius: 10,
    radiusX: 10,
    radiusY: 10,
    halfX: 2,
    halfY: 2,
    hard: false,
    square: false,
    wetEdges: 0,
    cos: 1,
    sin: 0,
    ...overrides,
  });

  it('returns 1 at centre for soft tip', () => {
    const lut = createTestLut();
    expect(sampleTip(lut, 0, 0)).toBe(1);
  });

  it('returns 0 outside the tip box', () => {
    const lut = createTestLut();
    expect(sampleTip(lut, 100, 100)).toBe(0);
    expect(sampleTip(lut, -100, -100)).toBe(0);
  });

  it('returns 0 outside support box without reading out of bounds', () => {
    const lut = createTestLut();
    expect(sampleTip(lut, 3, 0)).toBe(0);
    expect(sampleTip(lut, 0, 3)).toBe(0);
    expect(sampleTip(lut, 1e6, 0)).toBe(0);
    expect(sampleTip(lut, -1e6, -1e6)).toBe(0);
  });

  it('interpolates correctly on axes', () => {
    const lut = createTestLut();
    expect(sampleTip(lut, 1, 0)).toBe(0.5);
    expect(sampleTip(lut, -1, 0)).toBe(0.5);
    expect(sampleTip(lut, 0, 1)).toBe(0.5);
    expect(sampleTip(lut, 0, -1)).toBe(0.5);
  });

  it('applies rotation via cos/sin', () => {
    const lut = createTestLut({
      lutX: new Float32Array([0, 0.25, 0.5, 0.75, 1]),
      lutY: new Float32Array([0, 0.125, 0.25, 0.375, 0.5]),
      cos: 0,
      sin: 1,
    });
    // With 90-degree rotation, dx=1, dy=0 becomes ox=0, oy=-1
    expect(sampleTip(lut, 1, 0)).toBe(0.0625);
  });

  it('uses Chebyshev norm for square tips', () => {
    const lut = createTestLut({ square: true });
    expect(sampleTip(lut, 1, 1)).toBe(0.5);
    expect(sampleTip(lut, 1, 0)).toBe(0.5);
  });

  it('uses elliptical equation for hard tips', () => {
    const lut = createTestLut({ hard: true, radiusX: 5, radiusY: 5, halfX: 5, halfY: 5 });
    expect(sampleTip(lut, 0, 0)).toBe(1);
    expect(sampleTip(lut, 5, 0)).toBe(1);
    expect(sampleTip(lut, 6, 0)).toBe(0);
    expect(sampleTip(lut, 3, 3)).toBe(1);
    expect(sampleTip(lut, 5, 5)).toBe(0);
  });

  it('applies wet edges reweighting', () => {
    const lut = createTestLut({ wetEdges: 0.5 });
    expect(sampleTip(lut, 1, 0)).toBe(0.375);
  });

  it('leaves a=1 untouched with wet edges', () => {
    const lut = createTestLut({ wetEdges: 0.5 });
    expect(sampleTip(lut, 0, 0)).toBe(1);
  });
});

describe('buildBlendLut', () => {
  it('creates a LUT of the specified size', () => {
    const lut = buildBlendLut(normalBlend, 16);
    expect(lut.size).toBe(16);
    expect(lut.data.length).toBe(16 * 16);
  });

  it('clamps size to [2, 1024]', () => {
    const small = buildBlendLut(normalBlend, 1);
    expect(small.size).toBe(2);

    const large = buildBlendLut(normalBlend, 2000);
    expect(large.size).toBe(1024);
  });

  it('populates with blend function results', () => {
    const lut = buildBlendLut(normalBlend, 4);
    // normalBlend returns source
    expect(lut.data[0 * 4 + 0]).toBe(0);
    expect(lut.data[0 * 4 + 3]).toBe(1);
    expect(lut.data[3 * 4 + 0]).toBe(0);
    expect(lut.data[3 * 4 + 3]).toBe(1);
  });

  it('clamps blend output to [0, 1]', () => {
    const badBlend = () => 1.5;
    const lut = buildBlendLut(badBlend, 4);
    expect(lut.data[0]).toBe(1);
  });
});

describe('resolveBlend', () => {
  it('returns the function directly for BlendFn', () => {
    const fn = resolveBlend(normalBlend);
    expect(fn(0.5, 0.5)).toBe(0.5);
  });

  it('returns a sampling function for BlendLut', () => {
    const lut: BlendLut = {
      size: 4,
      data: new Float32Array([0, 0.5, 0.5, 1, 0, 0.5, 0.5, 1, 0, 0.5, 0.5, 1, 0, 0.5, 0.5, 1]),
    };
    const fn = resolveBlend(lut);
    expect(fn(0, 0)).toBe(0);
    expect(fn(1, 1)).toBe(1);
    expect(fn(0.5, 0.5)).toBeCloseTo(0.5, 1);
  });

  it('clamps indices to valid range', () => {
    const lut: BlendLut = { size: 2, data: new Float32Array([0, 0.25, 0.75, 1]) };
    const fn = resolveBlend(lut);
    expect(fn(-1, -1)).toBe(0);
    expect(fn(2, 2)).toBe(1);
  });

  it('defaults to normalBlend', () => {
    const fn = resolveBlend();
    expect(fn(0.3, 0.7)).toBe(0.7);
  });
});

describe('isBlendLut', () => {
  it('returns false for a function', () => {
    expect(isBlendLut(normalBlend)).toBe(false);
  });

  it('returns true for a BlendLut object', () => {
    const lut: BlendLut = { size: 256, data: new Float32Array(256 * 256) };
    expect(isBlendLut(lut)).toBe(true);
  });
});

describe('constants', () => {
  it('exports expected constant values', () => {
    expect(MIN_TIP_SIZE).toBe(1);
    expect(MAX_TIP_SIZE).toBe(4096);
    expect(MIN_TIP_ASPECT).toBe(0.05);
    expect(MAX_TIP_ASPECT).toBe(20);
    expect(DEFAULT_SPACING_PCT).toBe(25);
  });
});

describe('tipParams structure', () => {
  it('has the expected shape', () => {
    const params: TipParams = {
      size: 20,
      hardness: 0.5,
      aspect: 1,
      angle: 0,
      wetEdges: 0,
      shape: 'round',
      falloff: 'smoothstep',
      powerGamma: 2,
    };
    expect(params.size).toBe(20);
    expect(params.hardness).toBe(0.5);
    expect(params.aspect).toBe(1);
    expect(params.angle).toBe(0);
    expect(params.wetEdges).toBe(0);
    expect(params.shape).toBe('round');
    expect(params.falloff).toBe('smoothstep');
    expect(params.powerGamma).toBe(2);
  });
});

import { BLACK } from '../brush-types.ts';

describe('RGB and Rect types', () => {
  it('BLACK constant is correct', () => {
    expect(BLACK).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('regression coverage for non-finite brush inputs', () => {
  it('clamps a non-finite radius to the supported brush range in dabStep', () => {
    expect(dabStep(NaN, 25)).toBe(1);
    expect(dabStep(Infinity, 25)).toBe(dabStep(MAX_TIP_RADIUS, 25));
    expect(dabStep(-Infinity, 25)).toBe(1);
  });

  it('treats positive infinite spacing as 100% and negative infinity as 0%', () => {
    expect(dabStep(20, Infinity)).toBe(dabStep(20, 100));
    expect(dabStep(20, -Infinity)).toBe(dabStep(20, 0));
  });
});
