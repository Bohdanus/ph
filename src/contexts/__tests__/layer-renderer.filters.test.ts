import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayerSource, getLayerFilter } from '../layer-renderer.ts';
import type { Layer, LayerOperation, ToolLayerSource } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

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

    // Spelled out rather than recomputed from the builder: this is the preview half of the
    // filter contract, and the whole defect was that four copies of it could each drift.
    // saturation 50 at k=2.1 -> (exp(1.05) - exp(-2.1)) / (1 - exp(-2.1)) = 3.116876.
    expect(filter).toBe('grayscale(30%) sepia(40%) saturate(311.69%)');
  });

  it('builds a levels filter through the shared exponential mapping', () => {
    const filter = getLayerFilter([operation({ args: { toolName: 'levels', brightness: 25, contrast: 80 } })]);

    // brightness 25 at k=1.9 -> 1.714884; contrast 80 at k=2.2 -> 6.412117.
    expect(filter).toBe('brightness(171.49%) contrast(641.21%)');
  });

  it('joins several enabled operations in insertion order', () => {
    const filter = getLayerFilter([
      operation({ id: 'a', args: { toolName: 'blur', radius: 2 } }),
      operation({ id: 'b', args: { toolName: 'levels', brightness: 10, contrast: 10 } }),
    ]);

    // brightness 10 at k=1.9 -> 1.246145; contrast 10 at k=2.2 -> 1.276713.
    expect(filter).toBe('blur(2px) brightness(124.61%) contrast(127.67%)');
  });

  it('reaches the same 0% endpoints the committing processors do', () => {
    // The preview and the commit are one contract. If the preview ever emitted a
    // dark-grey floor where the processor emits black, a layer would render differently
    // from its own committed bitmap.
    expect(getLayerFilter([operation({ args: { toolName: 'color', grayscale: 0, sepia: 0, saturation: -100 } })])).toBe(
      'grayscale(0%) sepia(0%) saturate(0%)'
    );
    expect(getLayerFilter([operation({ args: { toolName: 'levels', brightness: -100, contrast: 0 } })])).toBe(
      'brightness(0%) contrast(100%)'
    );
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
