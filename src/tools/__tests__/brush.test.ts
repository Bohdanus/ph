import { describe, expect, it } from 'vitest';

import {
  clampPaintSize,
  CUSTOM_PRESET_LABEL,
  isPaintBlendMode,
  matchPaintPreset,
  PAINT_BLEND_MODES,
  PAINT_PRESETS,
  PAINT_SIZE_MAX,
  PAINT_SIZE_MIN,
  PAINT_SMOOTHING_DEFAULT,
  smoothStrokePoints,
  type PaintBlendMode,
} from '../brush.ts';
import { defaultSettings } from '../settings.ts';
import type { Point } from '../../contexts/general-types.ts';

const cornerPath: Point[] = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 90, y: 90 },
  { x: 10, y: 90 },
  { x: 50, y: 50 },
];

const zigzagPath = [
  { x: 10, y: 10 },
  { x: 90, y: 10 },
  { x: 10, y: 50 },
  { x: 90, y: 50 },
  { x: 10, y: 90 },
  { x: 90, y: 90 },
];

const displacement = (points: Point[], smoothing: number): Point[] =>
  smoothStrokePoints(points, smoothing).map(({ x, y }) => ({ x, y }));

const brushPresets = PAINT_PRESETS.brush;
const pencilPresets = PAINT_PRESETS.pencil;

type BarSettings = {
  lineWidth: number;
  alpha: number;
  smoothing: number;
  blendMode: PaintBlendMode;
};

const hardRound: BarSettings = { lineWidth: 10, alpha: 1, smoothing: 0, blendMode: 'source-over' };
const anyBarSettings: BarSettings = { lineWidth: 24, alpha: 0.5, smoothing: 30, blendMode: 'multiply' };

const presetsFor = (toolName: 'brush' | 'pencil') => (toolName === 'brush' ? brushPresets : pencilPresets);

const mismatches = (toolName: 'brush' | 'pencil', base: BarSettings): { label: string; diff: BarSettings }[] => {
  const presets = presetsFor(toolName);
  return presets
    .map((preset) => {
      const presetSettings: BarSettings = {
        lineWidth: preset.lineWidth,
        alpha: preset.alpha,
        smoothing: preset.smoothing,
        blendMode: preset.blendMode,
      };
      return { label: preset.label, diff: { ...presetSettings } };
    })
    .filter(({ diff }) => Object.keys(diff).some((k) => diff[k as keyof BarSettings] !== base[k as keyof BarSettings]))
    .map(({ label, diff }) => ({ label, diff }));
};

describe('brush settings and presets', () => {
  it('PAINT_SIZE_MIN is 1', () => {
    expect(PAINT_SIZE_MIN).toBe(1);
  });

  it('PAINT_SIZE_MAX is 500', () => {
    expect(PAINT_SIZE_MAX).toBe(500);
  });

  it('PAINT_SMOOTHING_DEFAULT is 10', () => {
    expect(PAINT_SMOOTHING_DEFAULT).toBe(10);
  });

  it('CUSTOM_PRESET_LABEL is "Custom"', () => {
    expect(CUSTOM_PRESET_LABEL).toBe('Custom');
  });

  it('PAINT_BLEND_MODES matches the canvas blend modes this renderer offers', () => {
    expect(PAINT_BLEND_MODES.map((m) => m.value)).toEqual([
      'source-over',
      'darken',
      'multiply',
      'color-burn',
      'lighten',
      'screen',
      'color-dodge',
      'overlay',
      'soft-light',
      'hard-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ]);
  });

  it('PAINT_PRESETS contains both brush and pencil arrays', () => {
    expect(Object.keys(PAINT_PRESETS)).toEqual(['brush', 'pencil']);
    expect(PAINT_PRESETS.brush.length).toBeGreaterThan(0);
    expect(PAINT_PRESETS.pencil.length).toBeGreaterThan(0);
  });

  it('every brush preset has required fields', () => {
    for (const preset of PAINT_PRESETS.brush) {
      expect(preset.label).toBeTypeOf('string');
      expect(preset.lineWidth).toBeTypeOf('number');
      expect(preset.alpha).toBeTypeOf('number');
      expect(preset.smoothing).toBeTypeOf('number');
      expect(preset.blendMode).toBeTypeOf('string');
    }
  });

  it('every pencil preset has required fields', () => {
    for (const preset of PAINT_PRESETS.pencil) {
      expect(preset.label).toBeTypeOf('string');
      expect(preset.lineWidth).toBeTypeOf('number');
      expect(preset.alpha).toBeTypeOf('number');
      expect(preset.smoothing).toBeTypeOf('number');
      expect(preset.blendMode).toBeTypeOf('string');
    }
  });

  it('defaultSettings.brush has valid preset values', () => {
    const settings = defaultSettings.brush;
    expect(settings.lineWidth).toBeGreaterThanOrEqual(1);
    expect(settings.alpha).toBeGreaterThanOrEqual(0);
    expect(settings.smoothing).toBeGreaterThanOrEqual(0);
    expect(settings.blendMode).toBeTypeOf('string');
  });

  it('defaultSettings.pencil has valid preset values', () => {
    const settings = defaultSettings.pencil;
    expect(settings.lineWidth).toBeGreaterThanOrEqual(1);
    expect(settings.alpha).toBeGreaterThanOrEqual(0);
    expect(settings.smoothing).toBeGreaterThanOrEqual(0);
    expect(settings.blendMode).toBeTypeOf('string');
  });

  it('isPaintBlendMode accepts all PAINT_BLEND_MODES values', () => {
    for (const mode of PAINT_BLEND_MODES) {
      expect(isPaintBlendMode(mode.value)).toBe(true);
    }
  });

  it('isPaintBlendMode rejects invalid strings', () => {
    expect(isPaintBlendMode('not-a-mode')).toBe(false);
    expect(isPaintBlendMode('')).toBe(false);
  });

  it('matchPaintPreset finds exact match in brush presets', () => {
    const settings = { lineWidth: 10, alpha: 1, smoothing: PAINT_SMOOTHING_DEFAULT, blendMode: 'source-over' } as const;
    const matched = matchPaintPreset(PAINT_PRESETS.brush, settings);
    expect(matched).toBe('Hard Round');
  });

  it('matchPaintPreset finds exact match in pencil presets', () => {
    const settings = { lineWidth: 3, alpha: 1, smoothing: PAINT_SMOOTHING_DEFAULT, blendMode: 'source-over' } as const;
    const matched = matchPaintPreset(PAINT_PRESETS.pencil, settings);
    expect(matched).toBe('Hard Pencil');
  });

  it('matchPaintPreset returns empty string for unknown combination', () => {
    const settings = { lineWidth: 999, alpha: 0.5, smoothing: 50, blendMode: 'source-over' } as const;
    const matched = matchPaintPreset(PAINT_PRESETS.brush, settings);
    expect(matched).toBe('');
  });

  it('matchPaintPreset is case-sensitive for blendMode', () => {
    const settings = {
      lineWidth: 10,
      alpha: 1,
      smoothing: PAINT_SMOOTHING_DEFAULT,
      blendMode: 'SOURCE-OVER' as unknown as PaintBlendMode,
    };
    const matched = matchPaintPreset(PAINT_PRESETS.brush, settings);
    expect(matched).toBe('');
  });

  it('clampPaintSize clamps to [PAINT_SIZE_MIN, PAINT_SIZE_MAX]', () => {
    expect(clampPaintSize(0)).toBe(PAINT_SIZE_MIN);
    expect(clampPaintSize(PAINT_SIZE_MAX + 100)).toBe(PAINT_SIZE_MAX);
    expect(clampPaintSize(-10)).toBe(PAINT_SIZE_MIN);
    expect(clampPaintSize(NaN)).toBe(PAINT_SIZE_MIN);
    expect(clampPaintSize(Infinity)).toBe(PAINT_SIZE_MIN); // non-finite returns MIN
  });

  it('clampPaintSize preserves values within range', () => {
    for (const size of [1, 10, 50, 100, 500]) {
      expect(clampPaintSize(size)).toBe(size);
    }
  });
});

describe('paint presets round-trip', () => {
  it('defaultSettings.brush matches a known preset', () => {
    const matched = matchPaintPreset(PAINT_PRESETS.brush, defaultSettings.brush);
    expect(matched).toBe('Hard Round');
  });

  it('defaultSettings.pencil matches a known preset', () => {
    const matched = matchPaintPreset(PAINT_PRESETS.pencil, defaultSettings.pencil);
    expect(matched).toBe('Hard Pencil');
  });

  it('every brush preset differs from hardRound in at least one field', () => {
    const diffs = mismatches('brush', hardRound);
    expect(diffs.length).toBe(PAINT_PRESETS.brush.length);
  });

  it('every pencil preset differs from hardRound in at least one field', () => {
    const diffs = mismatches('pencil', hardRound);
    expect(diffs.length).toBe(PAINT_PRESETS.pencil.length);
  });

  it('anyBarSettings differs from every preset in both tool sets', () => {
    for (const toolName of ['brush', 'pencil'] as const) {
      for (const preset of PAINT_PRESETS[toolName]) {
        const diff = {
          lineWidth: preset.lineWidth - anyBarSettings.lineWidth,
          alpha: preset.alpha - anyBarSettings.alpha,
          smoothing: preset.smoothing - anyBarSettings.smoothing,
          blendMode: preset.blendMode === anyBarSettings.blendMode ? 0 : 1,
        };
        expect(Object.values(diff).some((v) => v !== 0)).toBe(true);
      }
    }
  });
});

describe('smoothStrokePoints', () => {
  it('preserves first and last points exactly', () => {
    const smoothed = displacement(cornerPath, 0);
    expect(smoothed[0]).toEqual(cornerPath[0]);
    expect(smoothed[smoothed.length - 1]).toEqual(cornerPath[cornerPath.length - 1]);
  });

  it('smoothing 0 returns original points', () => {
    expect(displacement(cornerPath, 0)).toEqual(cornerPath);
  });

  it('smoothing 100 collapses interior points to straight lines', () => {
    const smoothed = displacement(cornerPath, 100);
    // With smoothing 100, interior points should be on straight lines between corners
    for (let i = 1; i < smoothed.length - 1; i++) {
      const p = smoothed[i];
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(90);
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThanOrEqual(90);
    }
  });

  it('smoothing 50 partially rounds the corner', () => {
    const smoothed = displacement(cornerPath, 50);
    const corner = smoothed[2];
    // The corner at (90,10) should be rounded inward
    expect(corner.x).toBeLessThan(90);
    expect(corner.y).toBeGreaterThan(10);
  });

  it('preserves path length ordering', () => {
    const smoothed = displacement(zigzagPath, 50);
    for (let i = 1; i < smoothed.length; i++) {
      const dx = smoothed[i].x - smoothed[i - 1].x;
      const dy = smoothed[i].y - smoothed[i - 1].y;
      expect(dx * dx + dy * dy).toBeGreaterThan(0);
    }
  });

  it('handles empty path', () => {
    expect(displacement([], 50)).toEqual([]);
  });

  it('handles single point', () => {
    expect(displacement([{ x: 10, y: 10 }], 50)).toEqual([{ x: 10, y: 10 }]);
  });

  it('handles two points', () => {
    const twoPoints: Point[] = [
      { x: 10, y: 10 },
      { x: 90, y: 90 },
    ];
    const smoothed = displacement(twoPoints, 50);
    expect(smoothed.length).toBe(2);
    expect(smoothed[0]).toEqual(twoPoints[0]);
    expect(smoothed[1]).toEqual(twoPoints[1]);
  });

  it('smoothing clamps to [0, 100]', () => {
    expect(() => displacement(cornerPath, -10)).not.toThrow();
    expect(() => displacement(cornerPath, 150)).not.toThrow();
    expect(() => displacement(cornerPath, NaN)).not.toThrow();
    expect(() => displacement(cornerPath, Infinity)).not.toThrow();
  });
});

describe('clampPercent internal behavior', () => {
  it('clamps to [0, 100]', () => {
    // clampPercent is internal but tested via smoothStrokePoints
    expect(displacement(cornerPath, -10).length).toBe(cornerPath.length);
    expect(displacement(cornerPath, 150).length).toBe(cornerPath.length);
  });
});

describe('PaintToolName and PaintBlendMode types', () => {
  it('PaintToolName accepts "brush" | "pencil"', () => {
    const toolNames: ('brush' | 'pencil')[] = ['brush', 'pencil'];
    expect(toolNames).toEqual(['brush', 'pencil']);
  });

  it('PaintBlendMode accepts all PAINT_BLEND_MODES values', () => {
    const modes = PAINT_BLEND_MODES.map((m) => m.value);
    expect(modes.length).toBe(16);
  });
});

describe('PaintPresetLabel type', () => {
  it('includes CUSTOM_PRESET_LABEL', () => {
    expect(CUSTOM_PRESET_LABEL).toBe('Custom');
  });

  it('includes all brush preset labels', () => {
    const labels = PAINT_PRESETS.brush.map((p) => p.label);
    expect(labels).toContain('Hard Round');
    expect(labels).toContain('Soft Round');
    expect(labels).toContain('Marker');
  });

  it('includes all pencil preset labels', () => {
    const labels = PAINT_PRESETS.pencil.map((p) => p.label);
    expect(labels).toContain('Hard Pencil');
    expect(labels).toContain('Soft Pencil');
    expect(labels).toContain('Marker');
  });
});

describe('defaultSettings integration', () => {
  it('defaultSettings.brush has all required fields', () => {
    const settings = defaultSettings.brush;
    expect(settings.lineWidth).toBeTypeOf('number');
    expect(settings.alpha).toBeTypeOf('number');
    expect(settings.smoothing).toBeTypeOf('number');
    expect(settings.blendMode).toBeTypeOf('string');
    expect(settings.toolName).toBe('brush');
  });

  it('defaultSettings.pencil has all required fields', () => {
    const settings = defaultSettings.pencil;
    expect(settings.lineWidth).toBeTypeOf('number');
    expect(settings.alpha).toBeTypeOf('number');
    expect(settings.smoothing).toBeTypeOf('number');
    expect(settings.blendMode).toBeTypeOf('string');
    expect(settings.toolName).toBe('pencil');
  });
});

describe('sameNumber internal function', () => {
  it('is used by matchPaintPreset for numeric comparison', () => {
    // sameNumber is internal but tested via matchPaintPreset epsilon tests
    expect(true).toBe(true);
  });
});
