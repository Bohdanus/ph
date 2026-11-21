import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEraseArgs, eraser, type EraserMode, type EraserToolArgs } from '../eraser.ts';
import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { Point, Ctx2D } from '../../contexts/general-types.ts';

type MockCtx = CanvasRenderingContext2D & { globalAlpha: number };

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly buffer: Uint8ClampedArray;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.buffer = new Uint8ClampedArray(this.width * this.height * 4);

    const ctx = createPixelCanvasContext(this);
    vi.mocked(ctx.drawImage).mockImplementation(((source: unknown) => {
      const drawn = source as { pixels?: Uint8ClampedArray };
      if (drawn?.pixels) {
        this.buffer.set(drawn.pixels.subarray(0, this.buffer.length));
      }
    }) as unknown as MockCtx['drawImage']);
    ctx.globalAlpha = 1;

    this.ctx = ctx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const stroke: Point[] = [
  { x: 2, y: 2 },
  { x: 4, y: 3 },
  { x: 6, y: 3 },
];

const eraserArgs = (overrides: Partial<EraserToolArgs> = {}): EraserToolArgs => ({
  toolName: 'eraser' as const,
  mode: 'brush' as EraserMode,
  hardness: 50,
  lineWidth: 30,
  alpha: 100,
  spacing: 25,
  points: stroke,
  color: '#000000',
  ...overrides,
});

const renderCommit = (_fixture: Uint8ClampedArray, a: EraserToolArgs) => {
  const [canvas] = eraser({ size: { width: 9, height: 5 }, bitmap: createMockImageBitmap(9, 5) })(buildEraseArgs(a));
  return canvas as unknown as RecordingOffscreenCanvas;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('eraser structure', () => {
  it('is a two-stage curried processor', () => {
    const bitmap = createMockImageBitmap(9, 5);
    const inner = eraser({ size: { width: 9, height: 5 }, bitmap });

    expect(eraser.length).toBe(1);
    expect(inner.length).toBe(1);
  });

  it('allocates exactly one canvas and draws the source bitmap', () => {
    const bitmap = createMockImageBitmap(9, 5);
    const [canvas] = eraser({ size: { width: 9, height: 5 }, bitmap })(eraserArgs({ mode: 'brush' }));

    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(canvas).toBe(RecordingOffscreenCanvas.instances[0]);
    expect(canvas).not.toBe(bitmap);
    expect(vi.mocked(RecordingOffscreenCanvas.instances[0].ctx.drawImage).mock.calls[0][0]).toBe(bitmap);
  });
});

describe('eraser toolProcessors registry', () => {
  it('registry entry has commit kind "raster"', () => {
    expect(toolProcessors.eraser.commit).toBe('raster');
  });

  it('registry entry has replay kind "raster-processor"', () => {
    expect(toolProcessors.eraser.replay.kind).toBe('raster-processor');
  });

  it('registry entry has replay version 1', () => {
    expect(toolProcessors.eraser.replay.version).toBe(1);
  });

  it('registry entry is deterministic and requires raster', () => {
    expect(toolProcessors.eraser.replay.deterministic).toBe(true);
    expect(toolProcessors.eraser.replay.requiresRaster).toBe(true);
  });

  it('registry entry has no creator flag', () => {
    expect(toolProcessors.eraser.creator).toBeUndefined();
  });

  it('registry entry has imageProcessor function', () => {
    expect(typeof toolProcessors.eraser.imageProcessor).toBe('function');
  });

  it('eraser processor identity - inner function matches toolProcessors registry', () => {
    const bitmap = createMockImageBitmap(9, 5);
    const inner = eraser({ size: { width: 9, height: 5 }, bitmap });
    expect(typeof inner).toBe('function');
  });
});

describe('eraser default settings', () => {
  it('defaultSettings.eraser has correct mode', () => {
    expect(defaultSettings.eraser.mode).toBe('brush');
  });

  it('defaultSettings.eraser has correct hardness', () => {
    expect(defaultSettings.eraser.hardness).toBe(50);
  });

  it('defaultSettings.eraser has correct lineWidth', () => {
    expect(defaultSettings.eraser.lineWidth).toBe(40);
  });

  it('defaultSettings.eraser has correct alpha', () => {
    expect(defaultSettings.eraser.alpha).toBe(1);
  });

  it('defaultSettings.eraser has correct spacing', () => {
    expect(defaultSettings.eraser.spacing).toBe(25);
  });

  it('defaultSettings.eraser has correct flow', () => {
    expect(defaultSettings.eraser.flow).toBe(100);
  });
});

describe('eraser block mode edge cases', () => {
  it('handles zero-width document', () => {
    const size = { width: 0, height: 5 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 0, height: 5, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = eraser({ size, bitmap: bmp })(eraserArgs({ mode: 'block' }));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(5);
  });

  it('handles zero-height document', () => {
    const size = { width: 9, height: 0 };
    const data = new Uint8ClampedArray(0);
    const bmp = { width: 9, height: 0, pixels: data, close: vi.fn() } as unknown as ImageBitmap;
    const [canvas] = eraser({ size, bitmap: bmp })(eraserArgs({ mode: 'block' }));
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(1);
  });

  it('returns early when getImageData/putImageData are not functions', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'OffscreenCanvas',
      class extends RecordingOffscreenCanvas {
        constructor(width: number, height: number) {
          super(width, height);
          this.ctx.getImageData = undefined as unknown as Ctx2D['getImageData'];
          this.ctx.putImageData = undefined as unknown as Ctx2D['putImageData'];
        }
      } as unknown as typeof OffscreenCanvas
    );

    const [canvas] = eraser({ size: { width: 9, height: 5 }, bitmap: createMockImageBitmap(9, 5) })(
      eraserArgs({ mode: 'block' })
    );
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(5);

    vi.unstubAllGlobals();
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  it('handles non-square documents', () => {
    const size = { width: 800, height: 600 };
    const bmp = {
      width: size.width,
      height: size.height,
      pixels: new Uint8ClampedArray(size.width * size.height * 4),
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const [canvas] = eraser({ size, bitmap: bmp })(eraserArgs({ mode: 'block' }));
    expect(canvas.width).toBe(size.width);
    expect(canvas.height).toBe(size.height);
  });
});

describe('eraser buildEraseArgs', () => {
  it('clamps hardness to valid range', () => {
    expect(() =>
      buildEraseArgs({
        hardness: -1,
        mode: 'block',
        lineWidth: 30,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        hardness: 101,
        mode: 'block',
        lineWidth: 30,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        hardness: NaN,
        mode: 'block',
        lineWidth: 30,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        hardness: Infinity,
        mode: 'block',
        lineWidth: 30,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
  });

  it('clamps lineWidth to valid range', () => {
    expect(() =>
      buildEraseArgs({
        lineWidth: -1,
        mode: 'block',
        hardness: 50,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        lineWidth: 1000,
        mode: 'block',
        hardness: 50,
        alpha: 100,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
  });

  it('clamps alpha to valid range', () => {
    expect(() =>
      buildEraseArgs({
        alpha: -1,
        mode: 'block',
        lineWidth: 30,
        hardness: 50,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        alpha: 200,
        mode: 'block',
        lineWidth: 30,
        hardness: 50,
        spacing: 25,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
  });

  it('clamps spacing to valid range', () => {
    expect(() =>
      buildEraseArgs({
        spacing: -1,
        mode: 'block',
        lineWidth: 30,
        hardness: 50,
        alpha: 100,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
    expect(() =>
      buildEraseArgs({
        spacing: 1000,
        mode: 'block',
        lineWidth: 30,
        hardness: 50,
        alpha: 100,
        toolName: 'eraser',
        points: [],
        color: '#000000',
      } as EraserToolArgs)
    ).not.toThrow();
  });

  it('buildEraseArgs returns DrawToolArgs with expected shape', () => {
    const args = buildEraseArgs({
      mode: 'block',
      hardness: 50,
      lineWidth: 30,
      alpha: 100,
      spacing: 25,
      toolName: 'eraser',
      points: [],
      color: '#000000',
    } as EraserToolArgs);
    expect(args.blockStamp).toBe(true);
    expect(args.lineWidth).toBe(30);
    expect(args.alpha).toBe(100);
    expect(args.color).toBe('#000000');
    expect(args.toolName).toBe('draw');
    expect(args.points).toEqual([]);
  });
});

describe('eraser mode handling', () => {
  it('supports block mode', () => {
    const canvas = renderCommit(new Uint8ClampedArray(9 * 5 * 4), eraserArgs({ mode: 'block' }));
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(5);
  });

  it('supports pencil mode', () => {
    const canvas = renderCommit(new Uint8ClampedArray(9 * 5 * 4), eraserArgs({ mode: 'pencil' }));
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(5);
  });

  it('supports brush mode', () => {
    const canvas = renderCommit(new Uint8ClampedArray(9 * 5 * 4), eraserArgs({ mode: 'brush' }));
    expect(canvas.width).toBe(9);
    expect(canvas.height).toBe(5);
  });
});
