import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { transform, type TransformToolArgs } from '../transform.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';

const { resampleRowByRow } = vi.hoisted(() => ({ resampleRowByRow: vi.fn() }));

vi.mock('../../util/homography-resample.ts', () => ({
  MAX_HOMOGRAPHY_SUBSAMPLES: 4,
  resampleThroughHomographyRowByRow: resampleRowByRow,
}));

type MockContext = {
  setTransform: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
};

type MockCanvas = { width: number; height: number; contexts: MockContext[]; getContext: () => MockContext };

function createMockContext(): MockContext {
  return {
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    putImageData: vi.fn(),
  };
}

class MockOffscreenCanvas implements MockCanvas {
  width: number;
  height: number;
  contexts: MockContext[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
  }

  getContext() {
    const context = createMockContext();
    this.contexts.push(context);
    return context;
  }
}

const baseArgs: TransformToolArgs = {
  rotate: 0,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 100,
  resizeY: 100,
  toolName: 'transform',
};

function makeParams(size: { width: number; height: number }): ProcessorToolParams {
  return { bitmap: { width: size.width, height: size.height }, size } as ProcessorToolParams;
}

beforeEach(() => {
  resampleRowByRow.mockClear();
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transform raster ceilings', () => {
  it('accepts a 24 megapixel trapezoid, matching the affine raster ceiling', () => {
    const size = { width: 6000, height: 4000 };

    const [canvas] = transform(makeParams(size))({ ...baseArgs, trapezoid: 25 });

    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
    expect(resampleRowByRow).toHaveBeenCalledTimes(1);
    const [source, , width, height] = resampleRowByRow.mock.calls[0] as [ImageData, unknown, number, number];
    expect(width).toBe(size.width);
    expect(height).toBe(size.height);
    expect(source.width).toBe(size.width);
    expect(source.height).toBe(size.height);
    expect(source.data.length).toBe(size.width * size.height * 4);
  });

  it.each([
    { width: 6000, height: 4000 },
    { width: 6928, height: 3464 },
    { width: 8000, height: 6000 },
  ])('warps a $width x $height layer at both slider limits', (size) => {
    for (const trapezoid of [-85, 85]) {
      expect(() => transform(makeParams(size))({ ...baseArgs, trapezoid })).not.toThrow();
    }
    expect(resampleRowByRow).toHaveBeenCalledTimes(2);
  });

  it('accepts a 24 megapixel affine transform at the same ceiling', () => {
    const size = { width: 6000, height: 4000 };

    const [canvas] = transform(makeParams(size))({ ...baseArgs, rotate: 30 });

    expect(canvas.width).toBeGreaterThan(size.width);
    expect(canvas.height).toBeGreaterThan(size.height);
  });

  it('still rejects a raster beyond the shared ceiling on both paths', () => {
    const size = { width: 9000, height: 9000 };

    expect(() => transform(makeParams(size))({ ...baseArgs, resizeX: 200, resizeY: 200 })).toThrow(/exceeds .*bounds/);
    expect(() => transform(makeParams(size))({ ...baseArgs, trapezoid: 25 })).toThrow(/exceeds .*bounds/);
    expect(resampleRowByRow).not.toHaveBeenCalled();
  });
});
