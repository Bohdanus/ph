import { describe, expect, it } from 'vitest';
import { getCropOverlayGeometry, sampleCropGuideColor } from '../crop-overlay.ts';

describe('crop overlay SVG geometry', () => {
  it('keeps the rule-of-thirds guide at the crop-local thirds', () => {
    expect(getCropOverlayGeometry(90, 60, 'ruleOfThirds').path).toBe(
      'M 30 0 L 30 60 M 60 0 L 60 60 M 0 20 L 90 20 M 0 40 L 90 40'
    );
  });

  it('bounds custom grid density and includes every interior division', () => {
    const guide = getCropOverlayGeometry(100, 50, 'grid', 'normal', 4).path;
    expect(guide.match(/M /g)).toHaveLength(6);
    expect(guide).toContain('M 25 0 L 25 50');
    expect(guide).toContain('M 0 37.5 L 100 37.5');
  });

  it('uses a crop-centered transform for golden-spiral orientations', () => {
    const guide = getCropOverlayGeometry(100, 60, 'goldenSpiral', 5);
    expect(guide.path).toContain('A 30 30 0 1 1 50 0');
    expect(guide.transform).toBe('translate(50 30) rotate(90) scale(-1 1) translate(-50 -30)');
  });

  it('uses the crop region to choose a contrasting guide color', () => {
    const data = new Uint8ClampedArray(6 * 6 * 4);
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const index = (y * 6 + x) * 4;
        data[index] = x < 3 ? 255 : 0;
        data[index + 1] = 0;
        data[index + 2] = x < 3 ? 0 : 255;
        data[index + 3] = 255;
      }
    }
    const sample = { data, width: 6, height: 6 };

    expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 2, height: 6 }, { width: 6, height: 6 })).toBe(
      'rgba(0, 255, 255, 0.8)'
    );
    expect(sampleCropGuideColor(sample, { x: 4, y: 0, width: 2, height: 6 }, { width: 6, height: 6 })).toBe(
      'rgba(255, 255, 0, 0.8)'
    );
  });
});
