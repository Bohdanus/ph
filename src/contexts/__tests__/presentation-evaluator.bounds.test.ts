import { describe, expect, it, vi } from 'vitest';

import { MAX_AFFINE_COORDINATE, MAX_AFFINE_PIXELS, type AffineTransform } from '../affine-transform.ts';
import {
  getPresentationFilter,
  evaluatePresentation,
  evaluatePresentationForDraw,
  operationsRetainedAfterBake,
  processorPresentationBounds,
  retainedPresentationOperations,
  stageProcessorInput,
} from '../presentation-evaluator.ts';
import { FilterArgumentUnrenderableError } from '../../util/canvas-filter.ts';

const position = { x: 0, y: 0, width: 9000, height: 9000 };
const documentTarget = { kind: 'document' as const };
const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
const zeroMatrix: AffineTransform = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

const layer = (operations: Parameters<typeof evaluatePresentation>[0]['operations']) => ({
  position,
  sourceSize: { width: position.width, height: position.height },
  operations,
});

describe('evaluatePresentationForDraw bounds contract', () => {
  it('draws a source larger than the affine pixel cap that the validating path refuses', () => {
    const over = position.width * position.height;
    expect(over).toBeGreaterThan(MAX_AFFINE_PIXELS);
    // The cap is the answer for a caller that allocates from the extent, and it is still
    // there: nothing about the draw path may weaken it for them.
    expect(() => evaluatePresentation(layer([{ kind: 'affine-transform', transform: scale }]))).toThrow(
      /raster bounds/
    );
  });

  it('reports the true post-affine extent, not a fabricated one, for an over-cap layer', () => {
    const evaluation = evaluatePresentationForDraw(
      layer([{ kind: 'affine-transform', transform: scale }]),
      documentTarget
    );

    // 2x of a 9000x9000 source: 324 Mpx, four times the cap. The bounds are computed, not
    // copied from the source rectangle, which is what a caller reading them would expect.
    expect(evaluation.localBounds).toEqual({ x: 0, y: 0, width: 18000, height: 18000 });
    expect(evaluation.bounds).toEqual({ x: 0, y: 0, width: 18000, height: 18000 });
    expect(evaluation.localBounds.width * evaluation.localBounds.height).toBeGreaterThan(MAX_AFFINE_PIXELS);
  });

  it('bypasses the coordinate cap the same way it bypasses the area cap', () => {
    const translated: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: MAX_AFFINE_COORDINATE * 2, f: 0 };

    expect(() => evaluatePresentation(layer([{ kind: 'affine-transform', transform: translated }]))).toThrow(
      /coordinate limits/
    );
    expect(
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: translated }]), documentTarget)
        .localBounds.x
    ).toBe(MAX_AFFINE_COORDINATE * 2);
  });

  it('still refuses a degenerate extent on the draw path', () => {
    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: zeroMatrix }]), documentTarget)
    ).toThrow(/degenerate bounds/);
  });

  it('still refuses a non-finite extent on the draw path', () => {
    const nonFinite: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: Number.NaN, f: 0 };

    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: nonFinite }]), documentTarget)
    ).toThrow(/degenerate bounds/);
  });

  it('refuses a bounds draw target, because that caller sizes a surface from the answer', () => {
    expect(() =>
      evaluatePresentationForDraw(layer([{ kind: 'affine-transform', transform: scale }]), { kind: 'bounds' })
    ).toThrow(/document draw target/);
  });
});

describe('presentation filter arguments', () => {
  it('coerces a JSON-round-tripped number instead of emitting it into the CSS', () => {
    const padded = getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: { radius: '  3  ' } }]);

    expect(padded).toBe('blur(3px)');
  });

  it('refuses a filter argument that will not coerce, naming the tool and the field', () => {
    const refuse = () => getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: { radius: 'wide' } }]);

    expect(refuse).toThrow(FilterArgumentUnrenderableError);
    expect(refuse).toThrow(/non-numeric radius/);
  });

  it('refuses a non-numeric colour adjustment, which would drop the whole filter stack', () => {
    expect(() => getPresentationFilter([{ kind: 'filter', toolName: 'color', args: { sepia: 'warm' } }])).toThrow(
      /non-numeric sepia/
    );
    expect(() => getPresentationFilter([{ kind: 'filter', toolName: 'levels', args: { contrast: 'x' } }])).toThrow(
      /non-numeric contrast/
    );
  });

  it('coerces a boolean adjustment, which used to reach the CSS as `sepia(false%)`', () => {
    // saturation defaults to 0, which is `expAdjustment`'s neutral 1.0 -> 100%.
    expect(getPresentationFilter([{ kind: 'filter', toolName: 'color', args: { sepia: false } }])).toBe(
      'grayscale(0%) sepia(0%) saturate(100%)'
    );
  });
});

/**
 * The processor input boundary: what a pixel processor is handed, where that raster sits, and
 * what the layer keeps once the operations it was built from have been baked into it.
 */
describe('the processor input boundary', () => {
  const affine = (transform: AffineTransform, enabled = true) => ({
    id: 'op',
    kind: 'affine-transform' as const,
    enabled,
    transform,
  });

  const layerWith = (
    pos: { x: number; y: number; width: number; height: number },
    operations: Parameters<typeof processorPresentationBounds>[0]['operations']
  ) =>
    ({
      id: 'l',
      name: 'l',
      isBedrock: false,
      tmpCanvas: null,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos,
      operations,
    }) as unknown as Parameters<typeof processorPresentationBounds>[0];

  it('reports the rasterLayer origin unchanged for a rasterLayer that presents nothing', () => {
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, []);

    const bounds = processorPresentationBounds(rasterLayer);

    expect(bounds).toEqual({ x: 10, y: 5, width: 40, height: 20 });
    // A copy, not the rasterLayer's own object: this answer becomes a published `pos`.
    expect(bounds).not.toBe(rasterLayer.pos);
  });

  it('reports the evaluated extent a transformed rasterLayer is drawn at', () => {
    // Twice the extent, offset by the matrix's own (5, 3), on a rasterLayer at (10, 5): the raster the
    // processor receives starts at (15, 8), not (10, 5). Subtracting `pos` instead addressed the
    // buffer five pixels left and three above where the rasterLayer is drawn.
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
      affine({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 }),
    ]);

    expect(processorPresentationBounds(rasterLayer)).toEqual({ x: 15, y: 8, width: 80, height: 40 });
  });

  it('ignores a disabled operation, which contributes to no presentation', () => {
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
      affine({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 }, false),
    ]);

    expect(processorPresentationBounds(rasterLayer)).toEqual({ x: 10, y: 5, width: 40, height: 20 });
  });

  it('falls back to the rasterLayer origin for a degenerate matrix rather than throwing at a pointer move', () => {
    // The staging path refuses this same extent, so no processor runs and no coordinate computed
    // against this answer is ever used — but this answer is read on every move of every stroke,
    // where a throw would escape into a React event handler.
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [affine(zeroMatrix)]);

    expect(processorPresentationBounds(rasterLayer)).toEqual({ x: 10, y: 5, width: 40, height: 20 });
  });

  it('keeps exactly the entries that were never baked', () => {
    const baked = affine({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    const disabled = affine({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, false);
    const rasterLayer = layerWith({ x: 0, y: 0, width: 40, height: 20 }, [baked, disabled]);

    // The baked one is gone, because keeping it is what made a raster tool evaluate a transform
    // the raster already carried. The disabled one survives, because dropping it would take the
    // user's disabled adjustment out of `toggleDisabled()`'s reach entirely.
    expect(operationsRetainedAfterBake(rasterLayer)).toEqual([disabled]);
    expect(retainedPresentationOperations(rasterLayer).map((operation) => operation.kind)).toEqual([
      'affine-transform',
    ]);
  });

  it('hands the rasterLayer its own raster untouched when it presents nothing', () => {
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, []);
    const bitmap = { width: 40, height: 20 } as ImageBitmap;

    const staged = stageProcessorInput(rasterLayer, bitmap);

    expect(staged.bitmap).toBe(bitmap);
    expect(staged.bounds).toEqual({ x: 10, y: 5, width: 40, height: 20 });
    expect(staged.operations).toEqual([]);
  });

  it('stages a private surface at the evaluated bounds for a transformed rasterLayer', () => {
    const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
      affine({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 }),
    ]);
    const bitmap = { width: 40, height: 20 } as ImageBitmap;

    const staged = stageProcessorInput(rasterLayer, bitmap);

    expect(staged.bounds).toEqual({ x: 15, y: 8, width: 80, height: 40 });
    expect((staged.bitmap as OffscreenCanvas).width).toBe(80);
    expect((staged.bitmap as OffscreenCanvas).height).toBe(40);
    expect(staged.bitmap).not.toBe(bitmap);
    expect(staged.operations).toHaveLength(1);
  });

  it('still refuses to stage a surface past the affine raster caps', () => {
    // The origin helper deliberately does NOT cap, because it allocates nothing; this one does
    // allocate a surface from the extent, and the caps are what bound that allocation.
    const big = { x: 0, y: 0, width: 9000, height: 9000 };
    const rasterLayer = layerWith(big, [affine({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })]);

    expect(() => stageProcessorInput(rasterLayer, { width: big.width, height: big.height } as ImageBitmap)).toThrow(
      /raster bounds/
    );
  });

  describe('a requested stroke frame', () => {
    it('pads a tight layer into a wider frame with transparent pixels, offset so the old pixels keep their place', () => {
      const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, []);
      const bitmap = { width: 40, height: 20 } as ImageBitmap;

      const staged = stageProcessorInput(rasterLayer, bitmap, { x: -10, y: -5, width: 80, height: 60 });

      expect(staged.bounds).toEqual({ x: -10, y: -5, width: 80, height: 60 });
      expect((staged.bitmap as OffscreenCanvas).width).toBe(80);
      expect((staged.bitmap as OffscreenCanvas).height).toBe(60);
      expect(staged.bitmap).not.toBe(bitmap);
      // The blit offset is the whole difference between a PADDED frame and a SHIFTED one: the
      // layer's own pixels must land 20 right and 10 down from the new origin, or every stroke
      // would be applied to the wrong pixels.
      expect(vi.mocked((staged.bitmap as OffscreenCanvas).getContext('2d')!.drawImage)).toHaveBeenCalledWith(
        bitmap,
        20,
        10
      );
    });

    it('hands back the layer raster untouched when the requested frame already is it', () => {
      const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, []);
      const bitmap = { width: 40, height: 20 } as ImageBitmap;

      const staged = stageProcessorInput(rasterLayer, bitmap, { x: 10, y: 5, width: 40, height: 20 });

      // No surface is allocated at all for the common in-layer case, which is what keeps an
      // ordinary stroke from paying for a copy on every pointer move.
      expect(staged.bitmap).toBe(bitmap);
    });

    it('pads the PRESENTED bounds of a transformed layer, so the frame is right after a retained affine', () => {
      const rasterLayer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
        affine({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 }),
      ]);
      const bitmap = { width: 40, height: 20 } as ImageBitmap;

      const staged = stageProcessorInput(rasterLayer, bitmap, { x: 0, y: 0, width: 120, height: 80 });

      // Presented extent is (15, 8, 80, 40); the padding is applied to THAT, not to `pos`.
      expect(staged.bounds).toEqual({ x: 0, y: 0, width: 120, height: 80 });
      expect((staged.bitmap as OffscreenCanvas).width).toBe(120);
    });

    it('declines an oversized frame instead of allocating one, because a stroke frame is sized by the stroke', () => {
      // The defect: this branch never calls `evaluatePresentation`, so it inherited none of the
      // caps, and a drag from one corner of a large document to the opposite named a frame far
      // larger than the layer — allocated, and blitted, once per pointer move.
      const over = Math.floor(Math.sqrt(MAX_AFFINE_PIXELS)) + 1;
      const rasterLayer = layerWith({ x: 0, y: 0, width: 40, height: 20 }, []);
      const bitmap = { width: 40, height: 20 } as ImageBitmap;

      const staged = stageProcessorInput(rasterLayer, bitmap, { x: 0, y: 0, width: over, height: over });

      // It REFUSES rather than throwing, because both callers already treat a staging failure as
      // "this tool did nothing here"; declining is the answer a cap produces anywhere else.
      expect(staged.bitmap).toBe(bitmap);
      expect(staged.bounds).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    });

    it('declines a frame whose origin is beyond the coordinate cap', () => {
      const rasterLayer = layerWith({ x: 0, y: 0, width: 40, height: 20 }, []);
      const bitmap = { width: 40, height: 20 } as ImageBitmap;

      const staged = stageProcessorInput(rasterLayer, bitmap, {
        x: MAX_AFFINE_COORDINATE * 2,
        y: 0,
        width: 40,
        height: 20,
      });

      expect(staged.bitmap).toBe(bitmap);
    });
  });
});
