import { describe, expect, it, vi } from 'vitest';

import { drawLayerSource } from '../layer-renderer.ts';
import type { Layer } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

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
});
