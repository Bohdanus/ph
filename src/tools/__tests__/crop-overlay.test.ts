import { describe, expect, it } from 'vitest';
import { getCropOverlayGeometry, sampleCropGuideColor } from '../crop-overlay.ts';

describe('crop overlay SVG geometry', () => {
  describe('ruleOfThirds', () => {
    it('keeps the rule-of-thirds guide at the crop-local thirds', () => {
      expect(getCropOverlayGeometry(90, 60, 'ruleOfThirds').path).toBe(
        'M 30 0 L 30 60 M 60 0 L 60 60 M 0 20 L 90 20 M 0 40 L 90 40'
      );
    });
  });

  describe('grid', () => {
    it('bounds custom grid density and includes every interior division', () => {
      const guide = getCropOverlayGeometry(100, 50, 'grid', 'normal', 4).path;
      expect(guide.match(/M /g)).toHaveLength(6);
      expect(guide).toContain('M 25 0 L 25 50');
      expect(guide).toContain('M 0 37.5 L 100 37.5');
    });

    it('uses default divisions (10) when not specified', () => {
      const guide = getCropOverlayGeometry(100, 100, 'grid').path;
      // 9 vertical + 9 horizontal = 18 lines
      expect(guide.match(/M /g)).toHaveLength(18);
      expect(guide).toContain('M 10 0 L 10 100');
      expect(guide).toContain('M 0 10 L 100 10');
    });

    it('clamps grid divisions to minimum (2)', () => {
      const guide = getCropOverlayGeometry(100, 100, 'grid', 'normal', 1).path;
      // Only 1 vertical + 1 horizontal = 2 lines at 50%
      expect(guide.match(/M /g)).toHaveLength(2);
      expect(guide).toContain('M 50 0 L 50 100');
      expect(guide).toContain('M 0 50 L 100 50');
    });

    it('clamps grid divisions to maximum (100)', () => {
      const guide = getCropOverlayGeometry(100, 100, 'grid', 'normal', 200).path;
      // 99 vertical + 99 horizontal = 198 lines
      expect(guide.match(/M /g)).toHaveLength(198);
      expect(guide).toContain('M 1 0 L 1 100');
      expect(guide).toContain('M 0 1 L 100 1');
    });

    it('clamps negative grid divisions to minimum (2)', () => {
      const guide = getCropOverlayGeometry(100, 100, 'grid', 'normal', -5).path;
      expect(guide.match(/M /g)).toHaveLength(2);
      expect(guide).toContain('M 50 0 L 50 100');
    });
  });

  describe('diagonal', () => {
    it('draws both diagonals from corner to corner', () => {
      const guide = getCropOverlayGeometry(100, 80, 'diagonal');
      expect(guide.path).toBe('M 0 0 L 100 80 M 100 0 L 0 80');
      expect(guide.transform).toBeUndefined();
    });

    it('handles non-square dimensions correctly', () => {
      const guide = getCropOverlayGeometry(200, 100, 'diagonal');
      expect(guide.path).toBe('M 0 0 L 200 100 M 200 0 L 0 100');
    });

    it('handles very small dimensions', () => {
      const guide = getCropOverlayGeometry(2, 2, 'diagonal');
      expect(guide.path).toBe('M 0 0 L 2 2 M 2 0 L 0 2');
    });
  });

  describe('triangle', () => {
    it('normal orientation (0) draws diagonal from top-left to bottom-right with anchor at 0.618/0.618', () => {
      const guide = getCropOverlayGeometry(100, 100, 'triangle', 'normal');
      // Diagonal: M 0 0 L 100 100
      // Line from top-right to anchor: M 100 0 L 61.8 61.8
      // Line from bottom-left to anchor: M 0 100 L 61.8 61.8
      expect(guide.path).toContain('M 0 0 L 100 100');
      expect(guide.path).toContain('M 100 0 L 61.8 61.8');
      expect(guide.path).toContain('M 0 100 L 61.8 61.8');
      expect(guide.transform).toBeUndefined();
    });

    it('flipped orientation (string) draws diagonal from top-right to bottom-left with anchor at 0.382/0.618', () => {
      const guide = getCropOverlayGeometry(100, 100, 'triangle', 'flipped');
      // Diagonal: M 100 0 L 0 100
      // Line from top-left to anchor: M 0 0 L 38.2 61.8
      // Line from bottom-right to anchor: M 100 100 L 38.2 61.8
      expect(guide.path).toContain('M 100 0 L 0 100');
      expect(guide.path).toContain('M 0 0 L 38.2 61.8');
      expect(guide.path).toContain('M 100 100 L 38.2 61.8');
    });

    it('numeric orientation 1 equals flipped', () => {
      const guideNormal = getCropOverlayGeometry(100, 100, 'triangle', 1);
      const guideFlipped = getCropOverlayGeometry(100, 100, 'triangle', 'flipped');
      expect(guideNormal.path).toBe(guideFlipped.path);
    });

    it('orientation 2 rotates 180° (anchor mirrored both axes)', () => {
      const guide = getCropOverlayGeometry(100, 100, 'triangle', 2);
      // Anchor should be at (100-61.8, 100-61.8) = (38.2, 38.2) for normal base
      // Diagonal still top-left to bottom-right
      expect(guide.path).toContain('M 0 0 L 100 100');
      expect(guide.path).toContain('M 100 0 L 38.2 38.2');
      expect(guide.path).toContain('M 0 100 L 38.2 38.2');
    });

    it('orientation 3 is flipped + rotated 180°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'triangle', 3);
      // Anchor should be at (100-38.2, 100-61.8) = (61.8, 38.2)
      // Diagonal top-right to bottom-left
      expect(guide.path).toContain('M 100 0 L 0 100');
      expect(guide.path).toContain('M 0 0 L 61.8 38.2');
      expect(guide.path).toContain('M 100 100 L 61.8 38.2');
    });

    it('wraps orientation 4 back to 0', () => {
      const guide0 = getCropOverlayGeometry(100, 100, 'triangle', 0);
      const guide4 = getCropOverlayGeometry(100, 100, 'triangle', 4);
      expect(guide4.path).toBe(guide0.path);
    });

    it('wraps orientation 5 back to 1 (flipped)', () => {
      const guide1 = getCropOverlayGeometry(100, 100, 'triangle', 1);
      const guide5 = getCropOverlayGeometry(100, 100, 'triangle', 5);
      expect(guide5.path).toBe(guide1.path);
    });

    it('handles non-square dimensions', () => {
      const guide = getCropOverlayGeometry(200, 100, 'triangle', 'normal');
      // Anchor: x = 200 * 0.618 = 123.6, y = 100 * 0.618 = 61.8
      expect(guide.path).toContain('M 0 0 L 200 100');
      expect(guide.path).toContain('M 200 0 L 123.6 61.8');
      expect(guide.path).toContain('M 0 100 L 123.6 61.8');
    });
  });

  describe('goldenRatio', () => {
    it('draws four lines at golden ratio positions (0.382 and 0.618)', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenRatio');
      expect(guide.path).toContain('M 38.2 0 L 38.2 100');
      expect(guide.path).toContain('M 61.8 0 L 61.8 100');
      expect(guide.path).toContain('M 0 38.2 L 100 38.2');
      expect(guide.path).toContain('M 0 61.8 L 100 61.8');
      expect(guide.transform).toBeUndefined();
    });

    it('handles non-square dimensions', () => {
      const guide = getCropOverlayGeometry(200, 100, 'goldenRatio');
      expect(guide.path).toContain('M 76.4 0 L 76.4 100'); // 200 * 0.382
      expect(guide.path).toContain('M 123.6 0 L 123.6 100'); // 200 * 0.618
      expect(guide.path).toContain('M 0 38.2 L 200 38.2'); // 100 * 0.382
      expect(guide.path).toContain('M 0 61.8 L 200 61.8'); // 100 * 0.618
    });
  });

  describe('goldenSpiral', () => {
    it('normal orientation (0) draws spiral at center with no rotation or flip', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 'normal');
      const radius = 50;
      const small = radius * 0.618; // 30.9
      const smallest = radius * 0.382; // 19.1
      const center = 50;
      expect(guide.path).toContain(`M ${center + radius} ${center}`); // M 100 50
      expect(guide.path).toContain(`A ${radius} ${radius} 0 1 1 ${center} ${center - radius}`); // A 50 50 0 1 1 50 0
      expect(guide.path).toContain(`L ${center} ${center - small}`); // L 50 19.1
      expect(guide.path).toContain(`A ${small} ${small} 0 0 1 ${center + small} ${center}`); // A 30.9 30.9 0 0 1 80.9 50
      expect(guide.path).toContain(`L ${center + smallest} ${center}`); // L 69.1 50
      expect(guide.path).toContain(`A ${smallest} ${smallest} 0 0 1 ${center} ${center + smallest}`); // A 19.1 19.1 0 0 1 50 69.1
      expect(guide.transform).toBe('translate(50 50) rotate(0) translate(-50 -50)');
    });

    it('flipped orientation (string) adds horizontal flip', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 'flipped');
      expect(guide.transform).toBe('translate(50 50) rotate(0) scale(-1 1) translate(-50 -50)');
    });

    it('orientation 1 rotates 90°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 1);
      expect(guide.transform).toBe('translate(50 50) rotate(90) translate(-50 -50)');
    });

    it('orientation 2 rotates 180°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 2);
      expect(guide.transform).toBe('translate(50 50) rotate(180) translate(-50 -50)');
    });

    it('orientation 3 rotates 270°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 3);
      expect(guide.transform).toBe('translate(50 50) rotate(270) translate(-50 -50)');
    });

    it('orientation 4 flips (same as flipped string)', () => {
      const guide4 = getCropOverlayGeometry(100, 100, 'goldenSpiral', 4);
      const guideFlipped = getCropOverlayGeometry(100, 100, 'goldenSpiral', 'flipped');
      expect(guide4.transform).toBe(guideFlipped.transform);
    });

    it('orientation 5 flips + rotates 90°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 5);
      expect(guide.transform).toBe('translate(50 50) rotate(90) scale(-1 1) translate(-50 -50)');
    });

    it('orientation 6 flips + rotates 180°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 6);
      expect(guide.transform).toBe('translate(50 50) rotate(180) scale(-1 1) translate(-50 -50)');
    });

    it('orientation 7 flips + rotates 270°', () => {
      const guide = getCropOverlayGeometry(100, 100, 'goldenSpiral', 7);
      expect(guide.transform).toBe('translate(50 50) rotate(270) scale(-1 1) translate(-50 -50)');
    });

    it('wraps orientation 8 back to 0', () => {
      const guide0 = getCropOverlayGeometry(100, 100, 'goldenSpiral', 0);
      const guide8 = getCropOverlayGeometry(100, 100, 'goldenSpiral', 8);
      expect(guide8.transform).toBe(guide0.transform);
      expect(guide8.path).toBe(guide0.path);
    });

    it('uses radius = min(width, height) / 2 for non-square dimensions', () => {
      // Width > Height: radius = height/2 = 30
      const guideWide = getCropOverlayGeometry(200, 60, 'goldenSpiral', 'normal');
      expect(guideWide.transform).toBe('translate(100 30) rotate(0) translate(-100 -30)');
      // Path should use radius 30
      expect(guideWide.path).toContain('A 30 30 0 1 1 100 0');
      expect(guideWide.path).toContain('M 130 30'); // centerX + radius = 100 + 30

      // Height > Width: radius = width/2 = 30
      const guideTall = getCropOverlayGeometry(60, 200, 'goldenSpiral', 'normal');
      expect(guideTall.transform).toBe('translate(30 100) rotate(0) translate(-30 -100)');
      expect(guideTall.path).toContain('A 30 30 0 1 1 30 70');
      expect(guideTall.path).toContain('M 60 100'); // centerX + radius = 30 + 30
    });

    it('handles very small dimensions (1x1)', () => {
      const guide = getCropOverlayGeometry(1, 1, 'goldenSpiral', 'normal');
      // radius = 0.5, center = 0.5
      expect(guide.transform).toBe('translate(0.5 0.5) rotate(0) translate(-0.5 -0.5)');
      expect(guide.path).toContain('M 1 0.5');
    });

    it('handles very small dimensions (2x2)', () => {
      const guide = getCropOverlayGeometry(2, 2, 'goldenSpiral', 'normal');
      // radius = 1, center = 1
      expect(guide.transform).toBe('translate(1 1) rotate(0) translate(-1 -1)');
      expect(guide.path).toContain('M 2 1');
      expect(guide.path).toContain('A 1 1 0 1 1 1 0');
    });
  });

  describe('sampleCropGuideColor', () => {
    const makeSample = (width: number, height: number, fillFn: (x: number, y: number) => number[]) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const [r, g, b, a = 255] = fillFn(x, y);
          data[index] = r;
          data[index + 1] = g;
          data[index + 2] = b;
          data[index + 3] = a;
        }
      }
      return { data, width, height };
    };

    it('uses the crop region to choose a contrasting guide color', () => {
      const sample = makeSample(6, 6, (x) => (x < 3 ? [255, 0, 0] : [0, 0, 255]));

      expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 2, height: 6 }, { width: 6, height: 6 })).toBe(
        'rgba(0, 255, 255, 0.8)'
      );
      expect(sampleCropGuideColor(sample, { x: 4, y: 0, width: 2, height: 6 }, { width: 6, height: 6 })).toBe(
        'rgba(255, 255, 0, 0.8)'
      );
    });

    it('returns default white when sample is null', () => {
      expect(sampleCropGuideColor(null, { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 })).toBe(
        'rgba(255, 255, 255, 0.8)'
      );
    });

    it('returns default white when sample width is zero', () => {
      const sample = { data: new Uint8ClampedArray(0), width: 0, height: 10 };
      expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 })).toBe(
        'rgba(255, 255, 255, 0.8)'
      );
    });

    it('returns default white when sample height is zero', () => {
      const sample = { data: new Uint8ClampedArray(0), width: 10, height: 0 };
      expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 })).toBe(
        'rgba(255, 255, 255, 0.8)'
      );
    });

    it('returns default white when imageSize width is zero', () => {
      const sample = makeSample(10, 10, () => [100, 100, 100]);
      expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 10 })).toBe(
        'rgba(255, 255, 255, 0.8)'
      );
    });

    it('returns default white when imageSize height is zero', () => {
      const sample = makeSample(10, 10, () => [100, 100, 100]);
      expect(sampleCropGuideColor(sample, { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 0 })).toBe(
        'rgba(255, 255, 255, 0.8)'
      );
    });

    it('skips sample points outside bounds (continue branch)', () => {
      // Sample is 4x4, but rect maps to points outside sample bounds
      const sample = makeSample(4, 4, () => [0, 0, 0]); // Black sample
      // Rect at (100, 100) with size 10x10, imageSize 10x10
      // Sample points will be at x=100+3.33, etc. scaled by 4/10 = 0.4
      // x = 103.33 * 0.4 = 41.33 -> rounds to 41, which is >= sample.width (4)
      const result = sampleCropGuideColor(sample, { x: 100, y: 100, width: 10, height: 10 }, { width: 10, height: 10 });
      // All points out of bounds -> count === 0 -> fallback to white
      expect(result).toBe('rgba(255, 255, 255, 0.8)');
    });

    it('returns default white when all sample points are out of bounds (count === 0 fallback)', () => {
      // Tiny 1x1 sample, large rect far away
      const sample = makeSample(1, 1, () => [128, 128, 128]);
      const result = sampleCropGuideColor(
        sample,
        { x: 1000, y: 1000, width: 10, height: 10 },
        { width: 10, height: 10 }
      );
      expect(result).toBe('rgba(255, 255, 255, 0.8)');
    });

    it('averages valid sample points when some are in bounds and some out', () => {
      // 10x10 sample, left half red (255,0,0), right half blue (0,0,255)
      const sample = makeSample(10, 10, (x) => (x < 5 ? [255, 0, 0] : [0, 0, 255]));
      // Rect covers left portion only, so all 5 sample points land in red area
      // rect x=0, width=5 -> sample points at x=1.67, 3.33, 2.5, 1.67, 3.33 (scaled by 10/10=1)
      // All round to x=2, 3, 2, 2, 3 -> all in left half (red)
      const result = sampleCropGuideColor(sample, { x: 0, y: 0, width: 5, height: 10 }, { width: 10, height: 10 });
      // Average red = 255, green = 0, blue = 0 -> inverted = (0, 255, 255)
      expect(result).toBe('rgba(0, 255, 255, 0.8)');
    });

    it('handles rect with zero width/height gracefully', () => {
      const sample = makeSample(10, 10, () => [100, 100, 100]);
      const result = sampleCropGuideColor(sample, { x: 5, y: 5, width: 0, height: 0 }, { width: 10, height: 10 });
      // All 5 sample points at (5,5) -> scaled to (5,5) -> valid, gray -> inverted = (155, 155, 155)
      expect(result).toBe('rgba(155, 155, 155, 0.8)');
    });

    it('handles non-square image and sample dimensions', () => {
      // Sample 20x10, image 100x50
      const sample = makeSample(20, 10, () => [50, 100, 150]);
      // Rect at center of image
      const result = sampleCropGuideColor(sample, { x: 40, y: 15, width: 20, height: 20 }, { width: 100, height: 50 });
      // scaleX = 20/100 = 0.2, scaleY = 10/50 = 0.2
      // Sample points: (40+6.67, 15+6.67), (40+13.33, 15+6.67), (40+10, 15+10), (40+6.67, 15+13.33), (40+13.33, 15+13.33)
      // Scaled: (9.33, 4.33)->(9,4), (10.67, 4.33)->(11,4), (10, 5), (9.33, 5.67)->(9,6), (10.67, 5.67)->(11,6)
      // All within 20x10 bounds, all same color -> average = (50, 100, 150) -> inverted = (205, 155, 105)
      expect(result).toBe('rgba(205, 155, 105, 0.8)');
    });
  });
});
