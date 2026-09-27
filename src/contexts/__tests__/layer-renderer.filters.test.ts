import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayerSource, getLayerFilter } from '../layer-renderer.ts';
import type { Layer, LayerOperation, ToolLayerSource } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { exp1_1 } from '../../tools/functions.ts';

function createRecordingContext() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    drawImage: vi.fn(),
    filter: 'none',
  } as unknown as CanvasRenderingContext2D;
}

function operation(overrides: Partial<LayerOperation> & { args: Record<string, unknown> }): LayerOperation {
  return { id: 'op-1', enabled: true, ...overrides } as LayerOperation;
}

describe('getLayerFilter', () => {
  it('returns none for a layer with no operations', () => {
    expect(getLayerFilter([])).toBe('none');
  });

  it('builds a blur filter from the radius', () => {
    expect(getLayerFilter([operation({ args: { toolName: 'blur', radius: 7 } })])).toBe('blur(7px)');
  });

  it('builds a colour filter through the shared exponential mapping', () => {
    const filter = getLayerFilter([
      operation({ args: { toolName: 'color', grayscale: 30, sepia: 40, saturation: 50 } }),
    ]);

    expect(filter).toBe(`grayscale(30%) sepia(40%) saturate(${exp1_1(50, 2.1)})`);
  });

  it('builds a levels filter through the shared exponential mapping', () => {
    const filter = getLayerFilter([operation({ args: { toolName: 'levels', brightness: 25, contrast: 80 } })]);

    expect(filter).toBe(`brightness(${exp1_1(25, 1.9)}) contrast(${exp1_1(80, 2.2)})`);
  });

  it('joins several enabled operations in insertion order', () => {
    const filter = getLayerFilter([
      operation({ id: 'a', args: { toolName: 'blur', radius: 2 } }),
      operation({ id: 'b', args: { toolName: 'levels', brightness: 10, contrast: 10 } }),
    ]);

    expect(filter).toBe(`blur(2px) brightness(${exp1_1(10, 1.9)}) contrast(${exp1_1(10, 2.2)})`);
  });

  it('drops disabled operations', () => {
    expect(getLayerFilter([operation({ enabled: false, args: { toolName: 'blur', radius: 9 } })])).toBe('none');
  });

  it('drops affine-transform operations, which have no canvas filter equivalent', () => {
    const affine = Object.freeze({
      id: 'affine-1',
      kind: 'affine-transform' as const,
      transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 }),
      enabled: true,
    });

    expect(getLayerFilter([affine as unknown as LayerOperation])).toBe('none');
    expect(
      getLayerFilter([affine as unknown as LayerOperation, operation({ args: { toolName: 'blur', radius: 1 } })])
    ).toBe('blur(1px)');
  });

  it('produces an empty filter string for an operation with no matching filter case', () => {
    // The switch is exhaustive for the registered filter tools, so an operation
    // from a tool that has no canvas filter equivalent maps to `undefined`, and
    // `Array#join` renders that as an empty string. Per the CSS filter spec an
    // empty `ctx.filter` is invalid and therefore ignored, so no filter is
    // applied — pin the real value rather than the `none` it looks like it
    // should be.
    const filter = getLayerFilter([operation({ args: { toolName: 'unknown-tool' } })]);

    expect(filter).toBe('');
    expect(filter).not.toBe('none');
  });
});

describe('drawLayerSource vector argument scaling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function vectorLayer(source: ToolLayerSource, pos: { x: number; y: number; width: number; height: number }): Layer {
    return {
      id: 'shape',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos,
      operations: [],
      source,
    } as Layer;
  }

  it('passes the args through unscaled when the source has no recorded position', () => {
    const raster = { width: 10, height: 5 } as OffscreenCanvas;
    // Recording what the processor received is the assertion: the point of these
    // cases is whether the geometry was scaled or passed through untouched.
    const seen: ToolArgs[] = [];
    const apply = vi.fn((args: ToolArgs): [OffscreenCanvas] => {
      seen.push(args);
      return [raster];
    });
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(apply);
    const ctx = createRecordingContext();
    const args = { toolName: 'shape', start: { x: 1, y: 2 }, end: { x: 3, y: 4 }, lineWidth: 5 } as unknown as ToolArgs;
    const layer = vectorLayer({ kind: 'tool', args } as unknown as ToolLayerSource, {
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });

    expect(drawLayerSource(ctx, layer, { x: 0, y: 0, width: 40, height: 20 })).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: { x: 0, y: 0, width: 40, height: 20 } });
    // Without a source position there is nothing to scale against, so the args
    // reach the processor exactly as recorded.
    expect(seen[0]).toBe(args);
    expect(ctx.drawImage).toHaveBeenCalledWith(raster, 0, 0, 40, 20);
  });

  it('passes the args through unscaled when the args carry no start point', () => {
    const raster = { width: 10, height: 5 } as OffscreenCanvas;
    // Recording what the processor received is the assertion: the point of these
    // cases is whether the geometry was scaled or passed through untouched.
    const seen: ToolArgs[] = [];
    const apply = vi.fn((args: ToolArgs): [OffscreenCanvas] => {
      seen.push(args);
      return [raster];
    });
    const processor = vi.spyOn(toolProcessors.polygon, 'imageProcessor').mockReturnValue(apply);
    const ctx = createRecordingContext();
    const args = { toolName: 'polygon', points: [{ x: 1, y: 1 }] } as unknown as ToolArgs;
    const layer = vectorLayer(
      { kind: 'tool', args, pos: { x: 0, y: 0, width: 10, height: 5 } } as unknown as ToolLayerSource,
      { x: 0, y: 0, width: 20, height: 10 }
    );

    expect(drawLayerSource(ctx, layer, { x: 0, y: 0, width: 20, height: 10 })).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: { x: 0, y: 0, width: 20, height: 10 } });
    expect(seen[0]).toBe(args);
  });

  it('scales the geometry but adds no lineWidth when the args carry none', () => {
    const raster = { width: 20, height: 10 } as OffscreenCanvas;
    // Recording what the processor received is the assertion: the point of these
    // cases is whether the geometry was scaled or passed through untouched.
    const seen: ToolArgs[] = [];
    const apply = vi.fn((args: ToolArgs): [OffscreenCanvas] => {
      seen.push(args);
      return [raster];
    });
    const processor = vi.spyOn(toolProcessors.line, 'imageProcessor').mockReturnValue(apply);
    const ctx = createRecordingContext();
    const layer = vectorLayer(
      {
        kind: 'tool',
        args: { toolName: 'line', start: { x: 0, y: 0 }, end: { x: 10, height: 5, y: 5 } } as unknown as ToolArgs,
        pos: { x: 0, y: 0, width: 10, height: 5 },
      } as unknown as ToolLayerSource,
      { x: 0, y: 0, width: 20, height: 10 }
    );

    expect(drawLayerSource(ctx, layer, { x: 0, y: 0, width: 20, height: 10 })).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: { x: 0, y: 0, width: 20, height: 10 } });
    const scaled = apply.mock.calls[0]![0] as unknown as { start: unknown; end: unknown; lineWidth?: number };
    expect(scaled.start).toEqual({ x: 0, y: 0 });
    expect(scaled.end).toEqual({ x: 20, y: 10 });
    expect('lineWidth' in scaled).toBe(false);
  });

  it('scales the stroke width by the geometric mean of the axis scales', () => {
    const raster = { width: 20, height: 10 } as OffscreenCanvas;
    // Recording what the processor received is the assertion: the point of these
    // cases is whether the geometry was scaled or passed through untouched.
    const seen: ToolArgs[] = [];
    const apply = vi.fn((args: ToolArgs): [OffscreenCanvas] => {
      seen.push(args);
      return [raster];
    });
    const processor = vi.spyOn(toolProcessors.line, 'imageProcessor').mockReturnValue(apply);
    const ctx = createRecordingContext();
    const layer = vectorLayer(
      {
        kind: 'tool',
        args: { toolName: 'line', lineWidth: 4, start: { x: 0, y: 0 }, end: { x: 10, y: 5 } } as unknown as ToolArgs,
        pos: { x: 0, y: 0, width: 10, height: 5 },
      } as unknown as ToolLayerSource,
      { x: 0, y: 0, width: 20, height: 20 }
    );

    expect(drawLayerSource(ctx, layer, { x: 0, y: 0, width: 20, height: 20 })).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: { x: 0, y: 0, width: 20, height: 20 } });
    // scaleX = 2, scaleY = 4, so the stroke scales by sqrt(8).
    expect(seen[0]).toMatchObject({ lineWidth: 4 * Math.sqrt(8) });
  });
});
