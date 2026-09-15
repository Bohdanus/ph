import { describe, expect, it } from 'vitest';
import {
  createEdgeMapFromImageData,
  createMagneticSegment,
  findStrongestGradientPoint,
  simplifyPath,
} from '../magneticLasso.ts';

function createVerticalEdgeImageData(width: number, height: number, edgeX: number): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = x < edgeX ? 0 : 255;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }

  return imageData;
}

describe('magnetic lasso utilities', () => {
  it('builds a gradient map from merged canvas pixels and snaps near the strongest edge', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 16, 10));
    const snap = findStrongestGradientPoint(edgeMap, { x: 12, y: 8 }, 5, 10, 1);

    expect(edgeMap.maxGradient).toBeGreaterThan(0);
    expect(snap.usedMagnetic).toBe(true);
    expect(Math.abs(snap.point.x - 9)).toBeLessThanOrEqual(1);
  });

  it('creates a magnetic segment that follows high-gradient pixels when possible', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 24, 10));
    const segment = createMagneticSegment({
      cursor: { x: 12, y: 20 },
      edgeMap,
      from: { x: 10, y: 3 },
      options: {
        edgeContrast: 5,
        searchRadius: 5,
        snapStrength: 1,
      },
    });

    expect(segment.snap.usedMagnetic).toBe(true);
    expect(segment.path.length).toBeGreaterThan(2);
    expect(segment.path.some((point) => Math.abs(point.x - 9) <= 1)).toBe(true);
  });

  it('falls back to a sampled straight line when magnetic snapping is disabled', () => {
    const edgeMap = createEdgeMapFromImageData(createVerticalEdgeImageData(24, 24, 10));
    const segment = createMagneticSegment({
      cursor: { x: 16, y: 3 },
      edgeMap,
      from: { x: 2, y: 3 },
      magneticEnabled: false,
      options: {
        edgeContrast: 5,
        searchRadius: 5,
        snapStrength: 1,
      },
    });

    expect(segment.snap.usedMagnetic).toBe(false);
    expect(segment.path[0]).toEqual({ x: 2, y: 3 });
    expect(segment.path[segment.path.length - 1]).toEqual({ x: 16, y: 3 });
  });

  it('simplifies dense paths while preserving endpoints', () => {
    const simplified = simplifyPath(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0.1 },
        { x: 2, y: -0.1 },
        { x: 3, y: 0 },
      ],
      0.5
    );

    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
  });
});
