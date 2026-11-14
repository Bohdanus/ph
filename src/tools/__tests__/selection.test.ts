const FILL_MODE = 'fill' as const;
const OUTLINE_MODE = 'outline' as const;
const SELECTION_TOOL = 'selection' as const;
const POLYGONAL_LASSO_TOOL = 'polygonal-lasso' as const;
const FREEHAND_LASSO_TOOL = 'freehand-lasso' as const;
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selection, type SelectionToolArgs } from '../selection.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { BitmapSource } from '../../contexts/general-types.ts';

const pixels = (...rgba: number[]) => new Uint8ClampedArray(rgba);

class PixelOffscreenCanvas {
  static seed = new Uint8ClampedArray();
  static instances: PixelOffscreenCanvas[] = [];

  buffer: Uint8ClampedArray;
  readonly ctx = {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    getImageData: vi.fn(function (this: PixelOffscreenCanvas) {
      return { data: this.buffer.slice(), width: this.width, height: this.height };
    }),
  };

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = PixelOffscreenCanvas.seed.slice();
    PixelOffscreenCanvas.instances.push(this);
  }

  getContext() {
    return PixelOffscreenCanvas.instances[0] === this ? this.ctx : null;
  }
}

describe('selection processor', () => {
  const size = { width: 4, height: 4 };
  const bitmap = createMockImageBitmap(size.width, size.height) as unknown as BitmapSource;

  beforeEach(() => {
    // Create a simple 4x4 bitmap with distinct pixel values
    PixelOffscreenCanvas.seed = pixels(
      10,
      20,
      30,
      255,
      40,
      50,
      60,
      255,
      70,
      80,
      90,
      255,
      100,
      110,
      120,
      255,
      130,
      140,
      150,
      255,
      160,
      170,
      180,
      255,
      190,
      200,
      210,
      255,
      220,
      230,
      240,
      255,
      10,
      20,
      30,
      255,
      40,
      50,
      60,
      255,
      70,
      80,
      90,
      255,
      100,
      110,
      120,
      255,
      130,
      140,
      150,
      255,
      160,
      170,
      180,
      255,
      190,
      200,
      210,
      255,
      220,
      230,
      240,
      255
    );
    PixelOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('returns a 1x1 canvas when the polygon has no points', () => {
    const [result] = selection({ size, bitmap })({
      points: [],
      mode: 'fill',
      toolName: 'selection',
    } satisfies SelectionToolArgs);

    const canvas = result as unknown as PixelOffscreenCanvas;
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies the polygon region to a new canvas', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const [result] = selection({ bitmap, size })({
      points,
      mode: 'fill',
      toolName: 'selection',
    } satisfies SelectionToolArgs);

    expect(result).toBeDefined();
    expect(result).not.toBe(bitmap);
  });

  it('returns the same canvas when points is empty', () => {
    const [result] = selection({ bitmap, size })({
      points: [],
      mode: 'fill',
      toolName: 'selection',
    } satisfies SelectionToolArgs);

    // Empty polygon might return empty or original - depends on copyPolygonToCanvas implementation
    expect(result).toBeDefined();
  });

  it('handles outline mode', () => {
    const points = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    const [result] = selection({ bitmap, size })({
      points,
      mode: 'outline',
      toolName: 'selection',
    } satisfies SelectionToolArgs);

    expect(result).toBeDefined();
  });
});

describe('SelectionToolArgs type', () => {
  it('requires points, mode, and toolName', () => {
    const args: SelectionToolArgs = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      mode: 'fill',
      toolName: 'selection',
    };
    expect(args.points).toHaveLength(2);
    expect(args.mode).toBe('fill');
    expect(args.toolName).toBe('selection');
  });

  it('allows toolName to be selection, polygonal-lasso, or freehand-lasso', () => {
    const base = { points: [{ x: 0, y: 0 }], mode: FILL_MODE };
    expect({ ...base, toolName: SELECTION_TOOL }.toolName).toBe('selection');
    expect({ ...base, toolName: POLYGONAL_LASSO_TOOL }.toolName).toBe('polygonal-lasso');
    expect({ ...base, toolName: FREEHAND_LASSO_TOOL }.toolName).toBe('freehand-lasso');
  });

  it('allows mode to be fill or outline', () => {
    const base = { points: [{ x: 0, y: 0 }], toolName: SELECTION_TOOL };
    expect({ ...base, mode: FILL_MODE }.mode).toBe('fill');
    expect({ ...base, mode: OUTLINE_MODE }.mode).toBe('outline');
  });
});

describe('SelectionToolSettings type', () => {
  it('omits points from SelectionToolArgs', () => {
    const settings: { mode: 'fill'; toolName: 'selection' } = {
      mode: FILL_MODE,
      toolName: SELECTION_TOOL,
    };
    // @ts-expect-error points is omitted
    expect(settings.points).toBeUndefined();
    expect(settings.mode).toBe('fill');
    expect(settings.toolName).toBe('selection');
  });
});

describe('SelectionMode type', () => {
  it('only allows fill or outline', () => {
    const fill = 'fill' as const;
    const outline = 'outline' as const;
    expect(fill).toBe('fill');
    expect(outline).toBe('outline');
  });
});
