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
    expect(findToolProcessor('eyedropper')).toBeUndefined();
    expect(Object.hasOwn(toolProcessors, 'eyedropper')).toBe(false);
  });

  it('is a member of the pixel-free set alongside the two others', () => {
    // This used to pin `toHaveLength(1)`, on the reasoning that "every other tool rasterizes, so
    // a second entry would be a claim that has to be earned". The Hand and Rotate View each
    // earned it, and for the same reason the eyedropper's own membership rests on: they move the
    // VIEW rather than the document. So the pin is replaced rather than deleted — the set's exact
    // membership is still asserted, and now a FOURTH member still cannot appear without this
    // failing.
    expect(PIXEL_FREE_TOOLS).toEqual(['eyedropper', 'hand', 'rotate-view']);
  });

  it('leaves every pixel-free member without a processor, so the set cannot gain a dead entry', () => {
    for (const toolName of PIXEL_FREE_TOOLS) {
      expect(findToolProcessor(toolName)).toBeUndefined();
      expect(Object.hasOwn(toolProcessors, toolName)).toBe(false);
    }
  });
});
