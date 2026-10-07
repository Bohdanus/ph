import { describe, expect, it } from 'vitest';

import { EYEDROPPER_SAMPLE_SIZE_OPTIONS, type EyedropperSampleSize } from '../eyedropper.ts';
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

    // Point Sample plus the 3, 5, 11, 31, 51 and 101 averages
    // (https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html). Three of the
    // seven were here; the union carried no value for the other four, so the bar could not offer a
    // setting the args type could not hold.
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
});

describe('eyedropper registry absence', () => {
  it('has no processor, because it rasterizes nothing and records no history', () => {
    expect(PIXEL_FREE_TOOLS).toContain('eyedropper');
    expect(findToolProcessor('eyedropper')).toBeUndefined();
    expect(Object.hasOwn(toolProcessors, 'eyedropper')).toBe(false);
  });

  it('shares the pixel-free set only with tools that earn it, so the set cannot grow unnoticed', () => {
    // Every other tool rasterizes. The set's other members are the Ruler, which measures a
    // nonprinting line and commits no pixels either, and the Color Sampler, which "displays color
    // values for up to four areas" and therefore edits nothing — so this pins the whole set rather
    // than the eyedropper's place in it, and a fourth entry has to be earned the same way.
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
