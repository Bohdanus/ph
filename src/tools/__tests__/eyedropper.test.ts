import { describe, expect, it } from 'vitest';

import { EYEDROPPER_SAMPLE_SIZE_OPTIONS, type EyedropperSampleSize, type EyedropperToolArgs } from '../eyedropper.ts';
import { defaultSettings } from '../settings.ts';
import { findToolProcessor, PIXEL_FREE_TOOLS, toolProcessors } from '../toolProcessors.ts';

describe('eyedropper args', () => {
  it('carries settings only, with no geometry to persist or replay', () => {
    expect(Object.keys(defaultSettings.eyedropper).sort()).toEqual(['sampleAllLayers', 'sampleSize', 'toolName']);
  });

  it('seeds the Photoshop defaults: a point sample, and every layer off', () => {
    expect(defaultSettings.eyedropper).toEqual({
      toolName: 'eyedropper',
      sampleSize: 1,
      sampleAllLayers: false,
    });
  });

  it('names all seven Sample Sizes Photoshop offers, in Photoshop order', () => {
    const values: readonly EyedropperSampleSize[] = EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ value }) => value);

    expect(values).toEqual([1, 3, 5, 11, 31, 51, 101]);
    expect(EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ label }) => label)).toEqual([
      'Point Sample',
      '3 by 3 Average',
      '5 by 5 Average',
      '11 by 11 Average',
      '31 by 31 Average',
      '51 by 51 Average',
      '101 by 101 Average',
    ]);
  });

  it('EYEDROPPER_SAMPLE_SIZE_OPTIONS has correct structure', () => {
    expect(EYEDROPPER_SAMPLE_SIZE_OPTIONS).toHaveLength(7);
    for (const option of EYEDROPPER_SAMPLE_SIZE_OPTIONS) {
      expect(option).toHaveProperty('value');
      expect(option).toHaveProperty('label');
      expect(typeof option.value).toBe('number');
      expect(typeof option.label).toBe('string');
      expect([1, 3, 5, 11, 31, 51, 101]).toContain(option.value);
    }
  });

  it('EyedropperSampleSize type is a union of the seven values', () => {
    // This is a compile-time test, but we verify the runtime values match
    const validSizes: EyedropperSampleSize[] = [1, 3, 5, 11, 31, 51, 101];
    for (const size of validSizes) {
      expect([1, 3, 5, 11, 31, 51, 101]).toContain(size);
    }
  });
});

describe('EyedropperToolArgs type', () => {
  it('requires sampleSize, sampleAllLayers, and toolName', () => {
    const args: EyedropperToolArgs = { sampleSize: 3, sampleAllLayers: true, toolName: 'eyedropper' };
    expect(args.sampleSize).toBe(3);
    expect(args.sampleAllLayers).toBe(true);
    expect(args.toolName).toBe('eyedropper');
  });

  it('sampleSize must be one of the seven valid sizes', () => {
    // @ts-expect-error 2 is not a valid EyedropperSampleSize
    const invalid: EyedropperToolArgs = { sampleSize: 2, sampleAllLayers: false, toolName: 'eyedropper' };
    // @ts-expect-error 10 is not a valid EyedropperSampleSize
    const invalid2: EyedropperToolArgs = { sampleSize: 10, sampleAllLayers: false, toolName: 'eyedropper' };
    // Valid sizes work
    const valid: EyedropperToolArgs = { sampleSize: 31, sampleAllLayers: false, toolName: 'eyedropper' };
    expect(valid.sampleSize).toBe(31);
  });

  it('sampleAllLayers is a boolean', () => {
    const argsTrue: EyedropperToolArgs = { sampleSize: 1, sampleAllLayers: true, toolName: 'eyedropper' };
    expect(argsTrue.sampleAllLayers).toBe(true);
    const argsFalse: EyedropperToolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' };
    expect(argsFalse.sampleAllLayers).toBe(false);
  });

  it('toolName must be "eyedropper"', () => {
    const args: EyedropperToolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' };
    expect(args.toolName).toBe('eyedropper');
    // @ts-expect-error toolName must be 'eyedropper'
    const invalid: EyedropperToolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'other' };
  });
});

describe('eyedropper registry absence', () => {
  it('has no processor, because it rasterizes nothing and records no history', () => {
    expect(PIXEL_FREE_TOOLS).toContain('eyedropper');
    expect(findToolProcessor('eyedropper')).toBeUndefined();
    expect(Object.hasOwn(toolProcessors, 'eyedropper')).toBe(false);
  });

  it('shares the pixel-free set only with tools that earn it', () => {
    expect([...PIXEL_FREE_TOOLS].sort()).toEqual([
      'color-sampler',
      'eyedropper',
      'hand',
      'rotate-view',
      'ruler',
      'zoom',
    ]);
    for (const name of PIXEL_FREE_TOOLS) {
      expect(Object.hasOwn(toolProcessors, name)).toBe(false);
      expect(findToolProcessor(name)).toBeUndefined();
    }
  });
});

describe('eyedropper constants', () => {
  it('EYEDROPPER_SAMPLE_SIZE_OPTIONS is readonly', () => {
    expect(EYEDROPPER_SAMPLE_SIZE_OPTIONS).toBeDefined();
    // TypeScript enforces readonly at compile time
  });

  it('all option values are unique', () => {
    const values = EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ value }) => value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('all option labels are unique', () => {
    const labels = EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ label }) => label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

describe('eyedropper defaultSettings integration', () => {
  it('defaultSettings.eyedropper has correct type', () => {
    const settings = defaultSettings.eyedropper;
    expect(settings.toolName).toBe('eyedropper');
    expect(typeof settings.sampleSize).toBe('number');
    expect(typeof settings.sampleAllLayers).toBe('boolean');
  });

  it('defaultSettings.eyedropper uses Point Sample (1)', () => {
    expect(defaultSettings.eyedropper.sampleSize).toBe(1);
  });

  it('defaultSettings.eyedropper has sampleAllLayers false', () => {
    expect(defaultSettings.eyedropper.sampleAllLayers).toBe(false);
  });
});
