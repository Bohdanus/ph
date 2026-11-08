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

  it('draws both diagonals for the diagonal guide', () => {
    expect(getCropOverlayGeometry(100, 60, 'diagonal').path).toBe('M 0 0 L 100 60 M 100 0 L 0 60');
  });

  it('builds the triangle guide in the normal orientation', () => {
    expect(getCropOverlayGeometry(100, 60, 'triangle', 'normal').path).toBe(
      'M 0 0 L 100 60 M 100 0 L 61.8 37.08 M 0 60 L 61.8 37.08'
    );
  });

  it('builds the triangle guide in the flipped orientation', () => {
    expect(getCropOverlayGeometry(100, 60, 'triangle', 'flipped').path).toBe(
      'M 100 0 L 0 60 M 0 0 L 38.2 37.08 M 100 60 L 38.2 37.08'
    );
  });

  it('rotates the triangle anchor through numeric orientations', () => {
    expect(getCropOverlayGeometry(100, 60, 'triangle', 2).path).toBe(
      'M 0 0 L 100 60 M 100 0 L 38.2 22.92 M 0 60 L 38.2 22.92'
    );
    expect(getCropOverlayGeometry(100, 60, 'triangle', 3).path).toBe(
      'M 100 0 L 0 60 M 0 0 L 61.8 22.92 M 100 60 L 61.8 22.92'
    );
  });

  it('places golden-ratio guides at 0.382 and 0.618 of each axis', () => {
    expect(getCropOverlayGeometry(100, 60, 'goldenRatio').path).toBe(
      'M 38.2 0 L 38.2 60 M 61.8 0 L 61.8 60 M 0 22.92 L 100 22.92 M 0 37.08 L 100 37.08'
    );
  });

  describe('grid division clamping', () => {
    it('clamps divisions below 2 to 2', () => {
      const guide = getCropOverlayGeometry(100, 50, 'grid', 'normal', 1).path;
      expect(guide.match(/M /g)).toHaveLength(2);
      expect(guide).toBe('M 50 0 L 50 50 M 0 25 L 100 25');
    });

    it('clamps divisions of 0 and negatives to 2', () => {
      expect(getCropOverlayGeometry(100, 50, 'grid', 'normal', 0).path).toBe('M 50 0 L 50 50 M 0 25 L 100 25');
      expect(getCropOverlayGeometry(100, 50, 'grid', 'normal', -5).path).toBe('M 50 0 L 50 50 M 0 25 L 100 25');
    });

    it('clamps divisions above 100 to 100', () => {
      const guide = getCropOverlayGeometry(100, 50, 'grid', 'normal', 200).path;
      expect(guide.match(/M /g)).toHaveLength(198);
    });

    it('keeps the default 10 divisions', () => {
      const guide = getCropOverlayGeometry(100, 50, 'grid').path;
      expect(guide.match(/M /g)).toHaveLength(18);
    });
  });

  describe('golden spiral orientations', () => {
    it('uses a centered, non-flipped transform for orientation 0', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 0).transform).toBe(
        'translate(50 30) rotate(0) translate(-50 -30)'
      );
    });

    it('rotates 90 degrees without flipping for orientation 1', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 1).transform).toBe(
        'translate(50 30) rotate(90) translate(-50 -30)'
      );
    });

    it('rotates 180 degrees without flipping for orientation 2', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 2).transform).toBe(
        'translate(50 30) rotate(180) translate(-50 -30)'
      );
    });

    it('rotates 270 degrees without flipping for orientation 3', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 3).transform).toBe(
        'translate(50 30) rotate(270) translate(-50 -30)'
      );
    });

    it('flips without rotating for the flipped alias', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 'flipped').transform).toBe(
        'translate(50 30) rotate(0) scale(-1 1) translate(-50 -30)'
      );
    });

    it('flips and rotates 90 degrees for orientation 5', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 5).transform).toBe(
        'translate(50 30) rotate(90) scale(-1 1) translate(-50 -30)'
      );
    });

    it('flips and rotates 180 degrees for orientation 6', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 6).transform).toBe(
        'translate(50 30) rotate(180) scale(-1 1) translate(-50 -30)'
      );
    });

    it('flips and rotates 270 degrees for orientation 7', () => {
      expect(getCropOverlayGeometry(100, 60, 'goldenSpiral', 7).transform).toBe(
        'translate(50 30) rotate(270) scale(-1 1) translate(-50 -30)'
      );
    });
  });
});

describe('sampleCropGuideColor', () => {
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

  it('returns the white fallback for a null sample', () => {
    expect(sampleCropGuideColor(null, { x: 0, y: 0, width: 2, height: 2 }, { width: 6, height: 6 })).toBe(
      'rgba(255, 255, 255, 0.8)'
    );
  });

  it('returns the white fallback for an empty sample', () => {
    expect(
      sampleCropGuideColor(
        { data: new Uint8ClampedArray(0), width: 0, height: 0 },
        { x: 0, y: 0, width: 2, height: 2 },
        { width: 6, height: 6 }
      )
    ).toBe('rgba(255, 255, 255, 0.8)');
  });

  it('returns the white fallback when the image size is empty', () => {
    const data = new Uint8ClampedArray(6 * 6 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    expect(
      sampleCropGuideColor({ data, width: 6, height: 6 }, { x: 0, y: 0, width: 2, height: 2 }, { width: 0, height: 6 })
    ).toBe('rgba(255, 255, 255, 0.8)');
  });

  it('skips sample points outside the cached bitmap', () => {
    const data = new Uint8ClampedArray(6 * 6 * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    // The image is 3x3 while the sample is 6x6, so scale is 2 and only the first sample
    // point lands inside the cached bitmap; the rest are out of bounds and skipped.
    expect(
      sampleCropGuideColor({ data, width: 6, height: 6 }, { x: 0, y: 0, width: 6, height: 6 }, { width: 3, height: 3 })
    ).toBe('rgba(0, 0, 0, 0.8)');
  });
});
