import { describe, expect, it } from 'vitest';
import { createMagicWandSelectionFromImageData } from '../magicWand.ts';

function createImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4] = fill[0];
    imageData.data[i * 4 + 1] = fill[1];
    imageData.data[i * 4 + 2] = fill[2];
    imageData.data[i * 4 + 3] = fill[3];
  }

  return imageData;
}

function setPixel(imageData: ImageData, x: number, y: number, color: [number, number, number, number]) {
  const index = (y * imageData.width + x) * 4;
  imageData.data[index] = color[0];
  imageData.data[index + 1] = color[1];
  imageData.data[index + 2] = color[2];
  imageData.data[index + 3] = color[3];
}

function getPointBounds(points: Array<{ x: number; y: number }>) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

describe('magic wand utilities', () => {
  it('selects a contiguous same-color region and returns its outer boundary', () => {
    const imageData = createImageData(6, 6, [0, 0, 255, 255]);
    setPixel(imageData, 2, 2, [255, 0, 0, 255]);
    setPixel(imageData, 3, 2, [255, 0, 0, 255]);
    setPixel(imageData, 2, 3, [255, 0, 0, 255]);
    setPixel(imageData, 3, 3, [255, 0, 0, 255]);

    const result = createMagicWandSelectionFromImageData(imageData, { x: 2, y: 2 }, { smoothing: 1, tolerance: 0 });

    expect(result?.selectedPixelCount).toBe(4);
    expect(result?.sampleColor).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(result?.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(getPointBounds(result!.points)).toEqual({ minX: 2, minY: 2, maxX: 4, maxY: 4 });
  });

  it('uses tolerance to include connected near-color pixels', () => {
    const imageData = createImageData(3, 1, [220, 0, 0, 255]);
    setPixel(imageData, 0, 0, [100, 100, 100, 255]);
    setPixel(imageData, 1, 0, [106, 106, 106, 255]);

    const exact = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 0 });
    const tolerant = createMagicWandSelectionFromImageData(imageData, { x: 0, y: 0 }, { tolerance: 3 });

    expect(exact?.selectedPixelCount).toBe(1);
    expect(tolerant?.selectedPixelCount).toBe(2);
  });

  it('returns null when the seed is outside the image', () => {
    const imageData = createImageData(4, 4, [0, 0, 0, 255]);

    expect(createMagicWandSelectionFromImageData(imageData, { x: -1, y: 0 })).toBeNull();
    expect(createMagicWandSelectionFromImageData(imageData, { x: 4, y: 0 })).toBeNull();
  });
});
