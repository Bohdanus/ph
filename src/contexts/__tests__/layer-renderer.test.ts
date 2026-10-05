import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayerSource, drawLayersToCanvas, layerPresentationKeepsLayerBounds } from '../layer-renderer.ts';
import type { Pos } from '../general-types.ts';
import type { Layer, LayerOperation } from '../layer-types.ts';
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
});

describe('layerPresentationKeepsLayerBounds', () => {
  const pos: Pos = { x: 40, y: 30, width: 120, height: 80 };

  function layer(operations: readonly LayerOperation[]): Layer {
    return {
      id: 'text',
      name: 'Text',
      isBedrock: false,
      bitmap: { width: 120, height: 80 } as ImageBitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos,
      operations,
    };
  }

  it('reports a retained filter as keeping the box, because ctx.filter is assigned inside the drawImage', () => {
    // Mutation killed: reading a filter as a displacement. `ctx.filter` cannot move a pixel, and a
    // blur's halo needs a wider SURFACE rather than a different position — treating that margin as
    // displacement would forbid editing exactly the blurred type layer Adobe lets you retype, which
    // is the whole reason the blanket operations guard is gone.
    expect(
      layerPresentationKeepsLayerBounds(layer([{ id: 'a', args: { toolName: 'blur', radius: 4 }, enabled: true }]))
    ).toBe(true);
  });

  it.each([
    { label: 'a translation', transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 } },
    { label: 'a scale', transform: { a: 1.5, b: 0, c: 0, d: 1.5, e: 0, f: 0 } },
    { label: 'a rotation', transform: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 } },
  ])('reports $label as leaving the box', ({ transform }) => {
    // The consumer-facing half: `textLayerEditTarget` asks this question before hydrating a
    // canvas-space editor over `pos`, and each of these three routes the draw through
    // `ctx.transform` instead of blitting into `pos` — the ink is placed by the matrix, so a caret
    // laid over `pos` would sit away from the glyphs.
    expect(
      layerPresentationKeepsLayerBounds(layer([{ id: 'a', kind: 'affine-transform', transform, enabled: true }]))
    ).toBe(false);
  });

  it('reports a filter COMBINED with a transform as leaving the box', () => {
    // The composition neither single-operation case can see: the filter contributes no matrix and
    // the translation contributes the displacement, so a predicate that short-circuited on "has a
    // filter" would answer yes here.
    expect(
      layerPresentationKeepsLayerBounds(
        layer([
          { id: 'a', args: { toolName: 'blur', radius: 4 }, enabled: true },
          { id: 'b', kind: 'affine-transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 0 }, enabled: true },
        ])
      )
    ).toBe(false);
  });

  it.each([
    { label: 'a disabled', transform: { a: 2, b: 0, c: 0, d: 2, e: 9, f: 9 }, enabled: false },
    { label: 'an identity', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, enabled: true },
  ])('reports $label transform as keeping the box', ({ transform, enabled }) => {
    // The control for the pair above: neither of these is composed into the draw at all, so neither
    // may move the box. A predicate that ignored `enabled` would refuse the first, and one that
    // treated any retained matrix as a displacement would refuse the second.
    expect(layerPresentationKeepsLayerBounds(layer([{ id: 'a', kind: 'affine-transform', transform, enabled }]))).toBe(
      true
    );
  });

  it('refuses a zero-extent box, the way the draw refuses to draw it', () => {
    // `drawLayerSource` returns false for a zero extent before it composes anything, and a re-entry
    // is reached from a pointer handler, so this has to be a refusal rather than a box to hydrate.
    expect(layerPresentationKeepsLayerBounds(layer([]), { x: 0, y: 0, width: 0, height: 80 })).toBe(false);
  });

  it('refuses a degenerate matrix without raising the evaluator\u2019s refusal', () => {
    // A singular matrix is refused where it is applied, so this is the shape a crafted document
    // carries rather than one the transform tool can write. Reading it here is a matrix comparison
    // with no bounds arithmetic in it, so nothing throws into a click handler.
    expect(
      layerPresentationKeepsLayerBounds(
        layer([{ id: 'a', kind: 'affine-transform', transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, enabled: true }])
      )
    ).toBe(false);
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
