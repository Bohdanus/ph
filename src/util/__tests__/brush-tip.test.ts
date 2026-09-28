import { describe, expect, it } from 'vitest';
import { buildTipLut } from '../brush-tip.ts';
import { DEFAULT_SPACING_PCT, dabStep, sampleTip } from '../brush-types.ts';
import type { TipParams } from '../brush-types.ts';

const radial = (t: number, hardness: number, gamma = 2, smoothstep = true): number => {
  if (hardness >= 1) return t <= 1 ? 1 : 0;
  const u = Math.max(0, Math.min(1, (1 - t) / (1 - hardness)));
  return smoothstep ? u * u * (3 - 2 * u) : Math.pow(u, gamma);
};

type Lut = ReturnType<typeof buildTipLut>;

const localOf = (lut: Lut, dx: number, dy: number) => ({
  ox: Math.round(dx * lut.cos + dy * lut.sin),
  oy: Math.round(-dx * lut.sin + dy * lut.cos),
});

const screenOf = (lut: Lut, ox: number, oy: number) => ({
  dx: ox * lut.cos - oy * lut.sin,
  dy: ox * lut.sin + oy * lut.cos,
});

const COMBOS: { label: string; params: Partial<TipParams>; hardness: number }[] = [
  { label: 'H=0.3 round', params: { size: 40, hardness: 0.3, aspect: 1, angle: 0 }, hardness: 0.3 },
  {
    label: 'H=0.7 aspect=0.4 angle=0.5',
    params: { size: 40, hardness: 0.7, aspect: 0.4, angle: 0.5 },
    hardness: 0.7,
  },
  {
    label: 'H=0.1 aspect=2.2 angle=-0.9',
    params: { size: 40, hardness: 0.1, aspect: 2.2, angle: -0.9 },
    hardness: 0.1,
  },
];

const worstError = (lut: Lut, hardness: number) => {
  let worst = 0;
  for (let dy = -25; dy <= 25; dy++) {
    for (let dx = -25; dx <= 25; dx++) {
      const { ox, oy } = localOf(lut, dx, dy);
      if (Math.abs(ox) > lut.halfX || Math.abs(oy) > lut.halfY) continue;
      const want = radial(Math.hypot(ox / lut.radiusX, oy / lut.radiusY), hardness);
      worst = Math.max(worst, Math.abs(sampleTip(lut, dx, dy) - want));
    }
  }
  return worst;
};

describe('buildTipLut', () => {
  it('tabulates the 1D profile into each axis table, exact at every index', () => {
    const lut = buildTipLut({ size: 40, hardness: 0.3, aspect: 2, angle: 0 });
    expect(lut.halfX).toBe(29);
    expect(lut.halfY).toBe(15);
    expect(lut.lutX.length).toBe(59);
    expect(lut.lutY.length).toBe(31);
    for (let i = -lut.halfX; i <= lut.halfX; i++) {
      expect(lut.lutX[i + lut.halfX]).toBeCloseTo(radial(Math.abs(i) / lut.radiusX, 0.3), 6);
    }
    for (let j = -lut.halfY; j <= lut.halfY; j++) {
      expect(lut.lutY[j + lut.halfY]).toBeCloseTo(radial(Math.abs(j) / lut.radiusY, 0.3), 6);
    }
    expect(lut.lutX[lut.halfX]).toBeCloseTo(1, 10);
    expect(lut.lutX[0]).toBeCloseTo(0, 10);
    expect(lut.lutY[0]).toBeCloseTo(0, 10);
  });

  it('shapes the cone with smoothstep by default and u^gamma for power', () => {
    const ss = buildTipLut({ size: 20, hardness: 0, falloff: 'smoothstep' });
    const p2 = buildTipLut({ size: 20, hardness: 0, falloff: 'power', powerGamma: 2 });
    const p3 = buildTipLut({ size: 20, hardness: 0, falloff: 'power', powerGamma: 3 });
    expect(ss.lutX[ss.halfX + 5]).toBeCloseTo(0.5, 6);
    expect(p2.lutX[p2.halfX + 5]).toBeCloseTo(0.25, 6);
    expect(p3.lutX[p3.halfX + 5]).toBeCloseTo(0.125, 6);
    expect(ss.lutX[ss.halfX + 5]).not.toBeCloseTo(p2.lutX[p2.halfX + 5], 3);
  });

  it('softens the cone rim as hardness rises', () => {
    const soft = buildTipLut({ size: 20, hardness: 0 });
    const mid = buildTipLut({ size: 20, hardness: 0.5 });
    const hard = buildTipLut({ size: 20, hardness: 0.9 });
    expect(soft.lutX[soft.halfX + 8]).toBeCloseTo(0.104, 6);
    expect(mid.lutX[mid.halfX + 8]).toBeCloseTo(0.352, 6);
    expect(hard.lutX[hard.halfX + 8]).toBeCloseTo(1, 6);
    expect(soft.lutX[soft.halfX + 8]).toBeLessThan(mid.lutX[mid.halfX + 8]);
    expect(mid.lutX[mid.halfX + 8]).toBeLessThan(hard.lutX[hard.halfX + 8]);
    expect(mid.lutX[mid.halfX + 8]).toBeCloseTo(radial(0.8, 0.5), 6);
  });
});

describe('sampleTip separability', () => {
  it.each(COMBOS)(
    'reproduces the brute-force radial profile exactly on the tip axes for $label',
    ({ params, hardness }) => {
      const lut = buildTipLut(params);
      for (let d = -20; d <= 20; d++) {
        for (const [ox, oy] of [
          [d, 0],
          [0, d],
        ]) {
          if (Math.abs(ox) > lut.halfX || Math.abs(oy) > lut.halfY) {
            const { dx, dy } = screenOf(lut, ox, oy);
            expect(sampleTip(lut, dx, dy)).toBe(0);
            continue;
          }
          const { dx, dy } = screenOf(lut, ox, oy);
          expect(sampleTip(lut, dx, dy)).toBeCloseTo(
            radial(Math.hypot(ox / lut.radiusX, oy / lut.radiusY), hardness),
            6
          );
        }
      }
      expect(sampleTip(lut, 0, 0)).toBe(1);
    }
  );

  it.each(COMBOS)('is bitwise LUTx[ox]*LUTr[oy] for $label', ({ params }) => {
    const lut = buildTipLut(params);
    for (let ox = -20; ox <= 20; ox++) {
      for (let oy = -20; oy <= 20; oy++) {
        if (Math.abs(ox) > lut.halfX || Math.abs(oy) > lut.halfY) continue;
        const { dx, dy } = screenOf(lut, ox, oy);
        expect(sampleTip(lut, dx, dy)).toBe(lut.lutX[ox + lut.halfX] * lut.lutY[oy + lut.halfY]);
      }
    }
  });

  it.each(COMBOS)('samples a rotated tip as the unrotated tables at the rotated offset ($label)', ({ params }) => {
    const rotated = buildTipLut(params);
    const plain = buildTipLut({ ...params, angle: 0 });
    for (let dy = -20; dy <= 20; dy++) {
      for (let dx = -20; dx <= 20; dx++) {
        const { ox, oy } = localOf(rotated, dx, dy);
        if (Math.abs(ox) > rotated.halfX || Math.abs(oy) > rotated.halfY) continue;
        expect(sampleTip(rotated, dx, dy)).toBe(sampleTip(plain, ox, oy));
      }
    }
  });

  it.each([
    { label: 'H=0.3 round', params: { size: 40, hardness: 0.3, aspect: 1, angle: 0 }, hardness: 0.3, bound: 0.27 },
    {
      label: 'H=0.7 aspect=0.4 angle=0.5',
      params: { size: 40, hardness: 0.7, aspect: 0.4, angle: 0.5 },
      hardness: 0.7,
      bound: 0.999,
    },
    {
      label: 'H=0.1 aspect=2.2 angle=-0.9',
      params: { size: 40, hardness: 0.1, aspect: 2.2, angle: -0.9 },
      hardness: 0.1,
      bound: 0.1,
    },
  ])('deviates from the radial profile off-axis by a bounded amount ($label)', ({ params, hardness, bound }) => {
    const lut = buildTipLut(params);
    const offAxis = worstError(lut, hardness);
    expect(offAxis).toBeGreaterThan(0.01);
    expect(offAxis).toBeLessThan(bound);
  });

  it('grows the off-axis deviation as the profile hardens', () => {
    const errors = [0, 0.3, 0.5, 0.7].map((hardness) =>
      worstError(buildTipLut({ size: 40, hardness, aspect: 1, angle: 0 }), hardness)
    );
    expect(errors[0]).toBeLessThan(0.07);
    expect(errors[1]).toBeLessThan(0.27);
    expect(errors[2]).toBeLessThan(0.59);
    expect(errors[3]).toBeLessThan(1);
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]).toBeGreaterThan(errors[i - 1]);
    }
  });
});

describe('sampleTip hardness limits', () => {
  it('is fully feathered at hardness 0 with a zero-coverage rim', () => {
    const lut = buildTipLut({ size: 20, hardness: 0 });
    expect(sampleTip(lut, 0, 0)).toBe(1);
    expect(sampleTip(lut, 5, 0)).toBeCloseTo(0.5, 6);
    expect(sampleTip(lut, 9, 0)).toBeCloseTo(0.028, 6);
    expect(sampleTip(lut, 9, 0)).toBeLessThan(0.05);
    expect(sampleTip(lut, 10, 0)).toBe(0);
    expect(sampleTip(lut, 11, 0)).toBe(0);
    expect(lut.hard).toBe(false);
  });

  it('collapses hardness 1 to a hard elliptical edge: 1 inside t<=1, 0 outside', () => {
    const lut = buildTipLut({ size: 20, hardness: 1 });
    expect(lut.hard).toBe(true);
    expect(lut.radius).toBe(10);
    expect(sampleTip(lut, 0, 0)).toBe(1);
    expect(sampleTip(lut, 10, 0)).toBe(1);
    expect(sampleTip(lut, -10, 0)).toBe(1);
    expect(sampleTip(lut, 0, -10)).toBe(1);
    expect(sampleTip(lut, 11, 0)).toBe(0);
    expect(sampleTip(lut, 10, 10)).toBe(0);
    expect(sampleTip(lut, 7, 7)).toBe(1);
    expect(sampleTip(lut, 8, 8)).toBe(0);
    expect(lut.lutX[lut.halfX + 5]).toBe(1);
    expect(lut.lutX[0]).toBe(1);
  });

  it('keeps the hardness 1 mask inside the radius and nowhere else', () => {
    const lut = buildTipLut({ size: 20, hardness: 1 });
    let opaque = 0;
    for (let y = -14; y <= 14; y++) {
      for (let x = -14; x <= 14; x++) {
        const a = sampleTip(lut, x, y);
        if (Math.hypot(x, y) / lut.radius <= 1) {
          expect(a).toBe(1);
          opaque++;
        } else {
          expect(a).toBe(0);
        }
      }
    }
    expect(opaque).toBe(317);
  });

  it('cuts the hard table at the radius, not at the padded support box', () => {
    const lut = buildTipLut({ size: 21, hardness: 1 });
    expect(lut.radius).toBe(10.5);
    expect(lut.halfX).toBe(11);
    expect(lut.lutX[lut.halfX + 10]).toBe(1);
    expect(lut.lutX[lut.halfX + 11]).toBe(0);
    expect(sampleTip(lut, 10, 0)).toBe(1);
    expect(sampleTip(lut, 11, 0)).toBe(0);
    const square = buildTipLut({ size: 21, hardness: 1, shape: 'square' });
    expect(square.lutX[square.halfX + 11]).toBe(0);
    expect(sampleTip(square, 11, 0)).toBe(0);
    expect(sampleTip(square, 10, 0)).toBe(1);
  });

  it('is not a hard edge just below hardness 1', () => {
    const lut = buildTipLut({ size: 40, hardness: 0.9 });
    expect(lut.hard).toBe(false);
    expect(sampleTip(lut, 19, 0)).toBeCloseTo(0.5, 6);
    expect(sampleTip(lut, 19, 0)).toBeLessThan(1);
  });
});

describe('sampleTip centre and monotonicity', () => {
  it('is 1 at the centre and non-increasing along every ray, zero outside the tip box', () => {
    const lut = buildTipLut({ size: 40, hardness: 0.5 });
    expect(lut.halfX).toBe(20);
    expect(lut.halfY).toBe(20);
    expect(sampleTip(lut, 0, 0)).toBe(1);
    for (let k = 0; k < 360; k++) {
      const theta = (k / 360) * Math.PI * 2;
      let previous = Infinity;
      for (let d = 0; d <= 30; d++) {
        const a = sampleTip(lut, Math.cos(theta) * d, Math.sin(theta) * d);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(a).toBeLessThanOrEqual(previous + 1e-7);
        previous = a;
      }
      expect(previous).toBe(0);
    }
  });
});

describe('sampleTip wet edges', () => {
  it('reweights by a*((1-k)+k*a), leaves a=1 untouched and attenuates a<1', () => {
    const k = 0.6;
    const dry = buildTipLut({ size: 20, hardness: 0.3, wetEdges: 0 });
    const wet = buildTipLut({ size: 20, hardness: 0.3, wetEdges: k });
    let sawFull = false;
    let sawPartial = false;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const a = sampleTip(dry, dx, dy);
        const w = sampleTip(wet, dx, dy);
        expect(w).toBeCloseTo(a * (1 - k + k * a), 7);
        if (a === 1) {
          expect(w).toBe(1);
          sawFull = true;
        } else if (a > 0) {
          expect(w).toBeLessThan(a);
          expect(w).toBeGreaterThan(0);
          sawPartial = true;
        }
      }
    }
    expect(sawFull).toBe(true);
    expect(sawPartial).toBe(true);
    expect(sampleTip(dry, 4, 0)).toBeCloseTo(0.944606, 5);
    expect(sampleTip(wet, 4, 0)).toBeCloseTo(0.913211, 5);
  });

  it('is the identity at wetEdges 0', () => {
    const zero = buildTipLut({ size: 20, hardness: 0.4, wetEdges: 0 });
    const unset = buildTipLut({ size: 20, hardness: 0.4 });
    for (let d = -10; d <= 10; d++) {
      expect(sampleTip(zero, d, d)).toBe(sampleTip(unset, d, d));
    }
  });
});

describe('sampleTip shape', () => {
  it('separates square and round tips: the square takes the Chebyshev norm', () => {
    const round = buildTipLut({ size: 20, hardness: 0, shape: 'round' });
    const square = buildTipLut({ size: 20, hardness: 0, shape: 'square' });
    expect(sampleTip(round, 3, 3)).toBeCloseTo(0.614656, 5);
    expect(sampleTip(square, 3, 3)).toBeCloseTo(0.784, 6);
    expect(sampleTip(square, 3, 3)).toBeCloseTo(radial(0.3, 0), 6);
    expect(sampleTip(square, 3, 3)).toBeGreaterThan(sampleTip(round, 3, 3));
    expect(sampleTip(square, 9, 9)).toBeCloseTo(0.028, 6);
    expect(sampleTip(square, 9, 9)).toBeGreaterThan(sampleTip(round, 9, 9));
    expect(sampleTip(round, 3, 0)).toBe(sampleTip(square, 3, 0));
    expect(sampleTip(round, 0, 3)).toBe(sampleTip(square, 0, 3));
    expect(sampleTip(square, 10, 10)).toBe(0);
    expect(sampleTip(round, 10, 10)).toBe(0);
  });

  it('gives the hard square tip 441 opaque pixels against 317 for the hard round', () => {
    const count = (lut: Lut) => {
      let n = 0;
      for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) if (sampleTip(lut, x, y) === 1) n++;
      return n;
    };
    expect(count(buildTipLut({ size: 20, hardness: 1, shape: 'square' }))).toBe(441);
    expect(count(buildTipLut({ size: 20, hardness: 1, shape: 'round' }))).toBe(317);
  });
});

describe('sampleTip rotation and aspect', () => {
  it('preserves area: Rx*Ry === R^2', () => {
    for (const aspect of [0.25, 0.5, 1, 2, 4, 7.5]) {
      const lut = buildTipLut({ size: 20, aspect });
      expect(lut.radiusX * lut.radiusY).toBeCloseTo(lut.radius * lut.radius, 9);
      expect(lut.radiusX).toBeCloseTo(lut.radius * Math.sqrt(aspect), 10);
      expect(lut.radiusY).toBeCloseTo(lut.radius / Math.sqrt(aspect), 10);
    }
    const lut = buildTipLut({ size: 20, aspect: 4 });
    expect(lut.radiusX * lut.radiusY).toBe(100);
    expect(lut.halfX).toBe(20);
    expect(lut.halfY).toBe(5);
  });

  it('rotates the sampled profile', () => {
    const plain = buildTipLut({ size: 20, hardness: 0.5, angle: 0 });
    const rotated = buildTipLut({ size: 20, hardness: 0.5, angle: Math.PI / 4 });
    expect(sampleTip(plain, 8, 0)).toBeCloseTo(0.352, 6);
    expect(sampleTip(rotated, 8, 0)).toBeCloseTo(0.802816, 5);
    expect(sampleTip(rotated, 8, 0)).not.toBeCloseTo(sampleTip(plain, 8, 0), 3);
    expect(sampleTip(rotated, 0, 8)).toBe(sampleTip(rotated, 8, 0));
    expect(sampleTip(plain, 0, 8)).toBe(sampleTip(plain, 8, 0));
    expect(sampleTip(rotated, 0, 8)).not.toBeCloseTo(sampleTip(plain, 0, 8), 3);
  });

  it('stretches the tip along the long axis for aspect != 1', () => {
    const lut = buildTipLut({ size: 20, hardness: 0, aspect: 4 });
    expect(sampleTip(lut, 20, 0)).toBe(0);
    expect(sampleTip(lut, 19, 0)).toBeCloseTo(0.00725, 5);
    expect(sampleTip(lut, 10, 0)).toBeCloseTo(0.5, 6);
    expect(sampleTip(lut, 4, 0)).toBeCloseTo(0.896, 6);
    expect(sampleTip(lut, 0, 4)).toBeCloseTo(0.104, 6);
    expect(sampleTip(lut, 0, 5)).toBe(0);
    expect(sampleTip(lut, 0, 20)).toBe(0);
  });

  it('returns 0 outside the support box without reading out of bounds', () => {
    const lut = buildTipLut({ size: 20, hardness: 0.5 });
    expect(lut.halfX).toBe(10);
    expect(lut.halfY).toBe(10);
    expect(sampleTip(lut, 11, 0)).toBe(0);
    expect(sampleTip(lut, 0, 11)).toBe(0);
    expect(sampleTip(lut, 10, 10)).toBe(0);
    expect(sampleTip(lut, 1e6, 0)).toBe(0);
    expect(sampleTip(lut, -1e6, -1e6)).toBe(0);
    const square = buildTipLut({ size: 20, hardness: 1, shape: 'square' });
    expect(sampleTip(square, 1e6, 0)).toBe(0);
  });
});

describe('dabStep', () => {
  it('defaults to half the radius of arc length', () => {
    expect(DEFAULT_SPACING_PCT).toBe(25);
    expect(dabStep(20, DEFAULT_SPACING_PCT)).toBe(10);
    expect(dabStep(40, DEFAULT_SPACING_PCT)).toBe(20);
    expect(dabStep(20, DEFAULT_SPACING_PCT)).toBe(0.5 * 20);
  });

  it('never returns less than one pixel', () => {
    for (const r of [0.5, 1, 1.5, 2, 2.4, 3, 20, 200]) {
      expect(dabStep(r, DEFAULT_SPACING_PCT)).toBeGreaterThanOrEqual(1);
    }
    expect(dabStep(0.5, 25)).toBe(1);
    expect(dabStep(1, 25)).toBe(1);
    expect(dabStep(2, 25)).toBe(1);
    expect(dabStep(3, 25)).toBe(2);
    expect(dabStep(20, 0)).toBe(1);
  });

  it('clamps spacing at 100% so the stroke stays continuous', () => {
    expect(dabStep(20, 100)).toBe(40);
    expect(dabStep(20, 250)).toBe(40);
    expect(dabStep(20, 1e6)).toBe(40);
    expect(dabStep(20, 250)).toBe(dabStep(20, 100));
    expect(dabStep(20, 250)).toBe(2 * 20);
    expect(dabStep(20, 50)).toBe(20);
  });
});
