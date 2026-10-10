import { describe, expect, it, vi } from 'vitest';

import type { AffineTransform } from '../affine-transform.ts';
import { drawLayerSource } from '../layer-renderer.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  getPresentationFilter,
  scaleTextArgs,
  scaleVectorArgs,
  type PresentationOperation,
} from '../presentation-evaluator.ts';

const position = { x: 12, y: 18, width: 40, height: 20 };
const frame = { x: 0, y: 0, width: 160, height: 120 };
const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

function runtimeOperations(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): PresentationOperation[] {
  const operations: PresentationOperation[] = [];
  if (kind === 'affine' || kind === 'affine-filter') operations.push({ kind: 'affine-transform', transform: scale });
  if (kind === 'filter' || kind === 'affine-filter') {
    operations.push({ kind: 'filter', toolName: 'blur', args: { radius: 3 } });
  }
  return operations;
}

function durableOperations(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): PresentationOperation[] {
  return runtimeOperations(kind).map((operation) => ({ ...operation }));
}

describe('presentation evaluator parity', () => {
  it.each(['none', 'affine', 'filter', 'affine-filter'] as const)(
    'returns identical layer bounds for the %s operation fixture',
    (fixture) => {
      const runtime = evaluatePresentation({
        position,
        sourceSize: { width: position.width, height: position.height },
        operations: runtimeOperations(fixture),
      });
      const durable = evaluatePresentation({
        position,
        sourceSize: { width: position.width, height: position.height },
        operations: durableOperations(fixture),
      });

      expect(durable.bounds).toEqual(runtime.bounds);
      expect(durable.localBounds).toEqual(runtime.localBounds);
      expect(durable.filter).toBe(runtime.filter);
    }
  );

  it('uses the same filter dispatch and defaults for runtime and durable operation shapes', () => {
    const runtime = [
      { kind: 'filter' as const, toolName: 'color' as const, args: { grayscale: 10, sepia: 20, saturation: 30 } },
      { kind: 'filter' as const, toolName: 'levels' as const, args: { brightness: -10, contrast: 15 } },
    ];
    const durable = runtime.map((operation) => ({ ...operation, args: { ...operation.args } }));

    expect(getPresentationFilter(runtime)).toBe(getPresentationFilter(durable));
    expect(getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: {} }])).toBe('blur(0px)');
    expect(getPresentationFilter([])).toBe('none');
  });

  it('exposes both bounds modes and agrees in the degenerate full-frame case', () => {
    const layer = evaluatePresentation({
      position: frame,
      sourceSize: { width: frame.width, height: frame.height },
      operations: [],
      mode: 'layer-bounds',
    });
    const document = evaluatePresentation({
      position: frame,
      sourceSize: { width: frame.width, height: frame.height },
      operations: [],
      frame,
      mode: 'frame-bounds',
    });

    expect(layer.bounds).toEqual(frame);
    expect(document.bounds).toEqual(frame);
  });

  it('takes the identity fast path without a transform call', () => {
    const ctx = {
      filter: 'none',
      drawImage: vi.fn(),
      translate: vi.fn(),
      transform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const bitmap = { width: position.width, height: position.height } as unknown as ImageBitmap;
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { width: position.width, height: position.height },
      operations: [],
    });

    drawEvaluatedPresentation(ctx, bitmap, evaluation, { kind: 'document', frame });

    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, position.x, position.y, position.width, position.height);
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.transform).not.toHaveBeenCalled();
  });

  it('bounds a rotated layer to the post-affine extent', () => {
    const quarterTurn: AffineTransform = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { width: position.width, height: position.height },
      operations: [{ kind: 'affine-transform', transform: quarterTurn }],
    });

    expect(evaluation.bounds.x).toBeCloseTo(position.x - position.height);
    expect(evaluation.bounds.y).toBe(position.y);
    expect(evaluation.bounds.width).toBeCloseTo(position.height);
    expect(evaluation.bounds.height).toBeCloseTo(position.width);
  });

  it('shares vector scaling and preserves an absent lineWidth key', () => {
    const args = {
      toolName: 'shape',
      start: { x: 1, y: 2 },
      end: { x: 5, y: 8 },
    };
    const scaled = scaleVectorArgs(args, { x: 0, y: 0, width: 20, height: 10 }, { x: 0, y: 0, width: 40, height: 20 });

    expect(scaled.start).toEqual({ x: 2, y: 4 });
    expect(scaled.end).toEqual({ x: 10, y: 16 });
    expect(scaled).not.toHaveProperty('lineWidth');
  });

  it('scales retained text geometry without changing text styling fields', () => {
    const args = {
      toolName: 'text' as const,
      text: 'hello',
      fontSize: 32,
      rect: { x1: 10, y1: 20, x2: 50, y2: 60 },
      align: 'left' as const,
      color: '#000000',
    };
    const scaled = scaleTextArgs(args, { x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 100 });

    expect(scaled.fontSize).toBe(64);
    expect(scaled.rect).toEqual({ x1: 20, y1: 40, x2: 100, y2: 120 });
    expect(scaled.text).toBe('hello');
    expect(scaled.align).toBe('left');
  });

  it('passes text arguments through when the source rectangle is unusable', () => {
    const args = { toolName: 'text' as const, fontSize: 32, rect: { x1: 10, y1: 20, x2: 50, y2: 60 } };
    const scaled = scaleTextArgs(args, { x: 0, y: 0, width: 0, height: 50 }, { x: 0, y: 0, width: 200, height: 100 });

    expect(scaled).toBe(args);
  });

  it('rejects a zero-size presentation before raster evaluation', () => {
    expect(() =>
      evaluatePresentation({
        position,
        sourceSize: { width: 0, height: position.height },
        operations: [],
      })
    ).toThrow(/degenerate bounds/);
  });

  it('keeps the no-bitmap guard outside the evaluator', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'layer-1',
      name: 'Layer 1',
      isBedrock: true,
      tmpCanvas: null,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as GlobalCompositeOperation,
      order: 0,
      pos: { x: 0, y: 0, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    };

    expect(drawLayerSource(ctx, layer)).toBe(false);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});
