import { describe, expect, it } from 'vitest';
import {
  MM_PER_INCH,
  PRESETS,
  computePixelsFromPreset,
  inchesToPx,
  mmToInches,
  mmToPx,
  type ImagePreset,
} from '../imagePresets.ts';

const preset = (id: keyof typeof PRESETS): ImagePreset => ({ id, ...PRESETS[id] });

describe('PRESETS', () => {
  it('gives every preset a non-empty label and a known unit', () => {
    for (const [id, value] of Object.entries(PRESETS)) {
      expect(value.label.length, id).toBeGreaterThan(0);
      expect(['mm', 'in', 'px'], id).toContain(value.unit);
    }
  });

  it('pairs a unit with the matching dimension fields', () => {
    for (const [id, value] of Object.entries(PRESETS)) {
      if (value.unit === 'mm') {
        expect(
          [value.widthMm, value.heightMm].every((n) => typeof n === 'number'),
          id
        ).toBe(true);
        expect(value.widthIn, id).toBeUndefined();
      }
      if (value.unit === 'in') {
        expect(
          [value.widthIn, value.heightIn].every((n) => typeof n === 'number'),
          id
        ).toBe(true);
        expect(value.widthMm, id).toBeUndefined();
      }
    }
  });

  it('declares positive widths and heights for every sized preset', () => {
    for (const [id, value] of Object.entries(PRESETS)) {
      const width = value.widthMm ?? value.widthIn;
      const height = value.heightMm ?? value.heightIn;
      if (width === undefined || height === undefined) continue;
      expect(width, id).toBeGreaterThan(0);
      expect(height, id).toBeGreaterThan(0);
    }
  });

  it('uses portrait proportions for the A-series and letter/legal presets', () => {
    expect(PRESETS.a4.heightMm! / PRESETS.a4.widthMm!).toBeCloseTo(297 / 210, 2);
    expect(PRESETS.a3.heightMm! / PRESETS.a3.widthMm!).toBeCloseTo(420 / 297, 2);
    expect(PRESETS.a5.heightMm! / PRESETS.a5.widthMm!).toBeCloseTo(210 / 148, 2);
    expect(PRESETS['us-letter'].heightIn! / PRESETS['us-letter'].widthIn!).toBeCloseTo(11 / 8.5, 2);
    expect(PRESETS['us-legal'].heightIn! / PRESETS['us-legal'].widthIn!).toBeCloseTo(14 / 8.5, 2);
  });
});

describe('mmToInches', () => {
  it('converts millimetres to inches using the exact mm-per-inch constant', () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(mmToInches(25.4)).toBe(1);
    expect(mmToInches(0)).toBe(0);
    expect(mmToInches(210)).toBeCloseTo(8.2677, 4);
  });

  it('keeps the sign of negative input instead of clamping it', () => {
    expect(mmToInches(-25.4)).toBe(-1);
  });
});

describe('inchesToPx', () => {
  it('rounds to the nearest whole pixel', () => {
    expect(inchesToPx(8.5, 72)).toBe(612);
    expect(inchesToPx(2, 300)).toBe(600);
    expect(inchesToPx(1, 100)).toBe(100);
  });

  it('rounds halves up and handles sub-pixel sizes', () => {
    expect(inchesToPx(0.005, 100)).toBe(1);
    expect(inchesToPx(0.004, 100)).toBe(0);
  });

  it('collapses to zero for a zero dpi', () => {
    expect(inchesToPx(10, 0)).toBe(0);
  });
});

describe('mmToPx', () => {
  it('agrees with converting to inches first', () => {
    expect(mmToPx(25.4, 300)).toBe(300);
    expect(mmToPx(25.4, 72)).toBe(72);
    expect(mmToPx(50.8, 300)).toBe(600);
  });

  it('rounds like the inch-based conversion it delegates to', () => {
    expect(mmToPx(210, 300)).toBe(2480);
    expect(mmToPx(297, 300)).toBe(3508);
    expect(mmToPx(0, 300)).toBe(0);
  });
});

describe('computePixelsFromPreset', () => {
  it('converts a metric preset at 300 dpi', () => {
    expect(computePixelsFromPreset(preset('a4'), 300)).toEqual({ width: 2480, height: 3508 });
    expect(computePixelsFromPreset(preset('a3'), 300)).toEqual({ width: 3508, height: 4961 });
  });

  it('converts a metric preset at 72 dpi', () => {
    expect(computePixelsFromPreset(preset('a4'), 72)).toEqual({ width: 595, height: 842 });
  });

  it('converts an imperial preset directly from inches', () => {
    expect(computePixelsFromPreset(preset('us-letter'), 72)).toEqual({ width: 612, height: 792 });
    expect(computePixelsFromPreset(preset('us-legal'), 300)).toEqual({ width: 2550, height: 4200 });
    expect(computePixelsFromPreset(preset('photo-4x6'), 96)).toEqual({ width: 384, height: 576 });
  });

  it('returns a zero size for a preset without any physical dimensions', () => {
    expect(computePixelsFromPreset(preset('custom'), 300)).toEqual({ width: 0, height: 0 });
  });

  it('ignores a partially specified preset instead of guessing the missing side', () => {
    expect(computePixelsFromPreset({ id: 'half', label: 'Half', unit: 'mm', widthMm: 100 }, 300)).toEqual({
      width: 0,
      height: 0,
    });
    expect(computePixelsFromPreset({ id: 'half-in', label: 'Half', unit: 'in', heightIn: 4 }, 300)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('treats zero dimensions as absent because the check is truthiness-based', () => {
    expect(computePixelsFromPreset({ id: 'zero', label: 'Zero', unit: 'mm', widthMm: 0, heightMm: 10 }, 300)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('prefers mm over inches when a preset carries both', () => {
    const both: ImagePreset = {
      id: 'both',
      label: 'Both',
      unit: 'mm',
      widthMm: 25.4,
      heightMm: 50.8,
      widthIn: 1,
      heightIn: 2,
    };
    expect(computePixelsFromPreset(both, 300)).toEqual({ width: 300, height: 600 });
  });

  it('scales linearly with dpi for the same preset', () => {
    const a4 = preset('a4');
    const at72 = computePixelsFromPreset(a4, 72);
    const at144 = computePixelsFromPreset(a4, 144);
    expect(at144.width).toBeGreaterThanOrEqual(at72.width * 2 - 1);
    expect(at144.width).toBeLessThanOrEqual(at72.width * 2 + 1);
  });
});
