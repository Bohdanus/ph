import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayerSource, drawLayersToCanvas } from '../layer-renderer.ts';
import type { Pos } from '../general-types.ts';
import type { Layer } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { createMockCanvas } from '../../__tests__/fixtures/canvas.ts';

describe('drawLayerSource', () => {
  it('rematerializes vector shape sources at the current logical bounds', () => {
    const sourceCanvas = { width: 200, height: 100 } as OffscreenCanvas;
    const apply = vi.fn((): [OffscreenCanvas] => [sourceCanvas]);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(apply);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const layer: Layer = {
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
      pos: { x: 4, y: 6, width: 100, height: 50 },
      operations: [],
      source: {
        kind: 'tool',
        pos: { x: 4, y: 6, width: 100, height: 50 },
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 10, y: 15 },
          end: { x: 80, y: 40 },
        },
      },
    };
    const resizedPosition = { x: 4, y: 6, width: 200, height: 100 };

    expect(drawLayerSource(ctx, layer, resizedPosition)).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: resizedPosition });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        start: { x: 20, y: 30 },
        end: { x: 160, y: 80 },
        lineWidth: 4,
      })
    );
    expect(ctx.drawImage).toHaveBeenCalledWith(sourceCanvas, 4, 6, 200, 100);
  });

  it('maps world layer positions into a non-zero document frame', () => {
    const bitmap = { width: 20, height: 10 } as ImageBitmap;
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'image',
      name: 'Image',
      isBedrock: false,
      bitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as const,
      order: 0,
      pos: { x: 45, y: 38, width: 20, height: 10 },
      operations: [],
      source: { kind: 'image' as const, bitmap, name: 'Image', pos: { x: 45, y: 38, width: 20, height: 10 } },
    } satisfies Layer;

    expect(drawLayerSource(ctx, layer, layer.pos, { x: 40, y: 30, width: 80, height: 60 })).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 5, 8, 20, 10);
  });

  it('uses a durable baked presentation without rematerializing or reapplying operations', () => {
    const bitmap = { width: 30, height: 40 } as ImageBitmap;
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'baked',
      name: 'Baked',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      durablePresentation: { bitmap, bounds: { x: 10, y: 20, width: 30, height: 40 } },
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as const,
      order: 0,
      pos: { x: 0, y: 0, width: 10, height: 10 },
      operations: [{ id: 'filter', args: { toolName: 'blur', radius: 2 }, enabled: true }],
    } satisfies Layer;

    expect(drawLayerSource(ctx, layer)).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 10, 20, 30, 40);
  });
});

describe('drawLayersToCanvas vector staging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createShapeLayer(pos: Pos): Layer {
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
      source: {
        kind: 'tool',
        pos: { ...pos },
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: pos.width, y: pos.height },
        },
      },
    };
  }

  it('rematerializes a vector layer at the layer logical bounds while staging', () => {
    const sourceCanvas = { width: 100, height: 50 } as OffscreenCanvas;
    const apply = vi.fn((): [OffscreenCanvas] => [sourceCanvas]);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(apply);
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const layer = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });

    expect(drawLayersToCanvas(target, [layer], { x: 0, y: 0, width: 300, height: 150 })).toBe(true);

    expect(processor).toHaveBeenCalledWith({ size: layer.pos });
    const stagingContext = staging.getContext('2d')!;
    expect(stagingContext.drawImage).toHaveBeenCalledWith(sourceCanvas, 4, 6, 100, 50);
    expect(stagingContext.drawImage).not.toHaveBeenCalledWith(sourceCanvas, 0, 0, 300, 150);
    const targetContext = target.getContext('2d')!;
    expect(targetContext.clearRect).toHaveBeenCalledWith(0, 0, 300, 150);
    expect(targetContext.drawImage).toHaveBeenCalledWith(staging, 0, 0);
  });

  it('skips a vector layer whose rematerialized canvas has no pixels and still publishes', () => {
    const emptyCanvas = { width: 0, height: 0 } as OffscreenCanvas;
    const apply = vi.fn((): [OffscreenCanvas] => [emptyCanvas]);
    vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(apply);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const bitmap = { width: 20, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const image: Layer = {
      id: 'image',
      name: 'Image',
      isBedrock: false,
      bitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 1,
      pos: { x: 8, y: 10, width: 20, height: 10 },
      operations: [],
    };

    expect(
      drawLayersToCanvas(target, [createShapeLayer({ x: 4, y: 6, width: 100, height: 50 }), image], {
        x: 0,
        y: 0,
        width: 300,
        height: 150,
      })
    ).toBe(true);

    expect(consoleError).toHaveBeenCalledWith('skipped layer without bitmap', 'shape');
    const stagingContext = staging.getContext('2d')!;
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(1);
    expect(stagingContext.drawImage).toHaveBeenCalledWith(bitmap, 8, 10, 20, 10);
    expect(target.getContext('2d')!.drawImage).toHaveBeenCalledWith(staging, 0, 0);
  });
});
