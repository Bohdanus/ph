import { describe, expect, it, vi } from 'vitest';

import { MAX_AFFINE_COORDINATE, MAX_AFFINE_PIXELS, type AffineTransform } from '../affine-transform.ts';
import {
  FILTER_EXTENT_SIGMAS,
  getPresentationFilter,
  getPresentationFilterMargin,
  evaluatePresentation,
  evaluatePresentationForDraw,
  layerPresentationBounds,
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

/**
 * # The retained filter's extent
 *
 * A `ctx.filter` blur draws outside the rectangle it filters, so every extent derived from a
 * presentation has to carry that spread. Three callers size something from such an extent — the PSD
 * export's layer canvas, the transform handles' box, the processor's staging surface — and the
 * canvas the user is looking at draws the whole spread regardless, so an extent that omitted it cut
 * the halo while the document itself looked right. These pin the ONE rule those callers share, and
 * every number below is derived by hand from the fixture rather than read back out of the answer.
 */
describe('the retained filter extent', () => {
  const position = { x: 0, y: 0, width: 40, height: 20 };

  /**
   * The evaluator's own input shape: the tool name sits BESIDE the args. `layer-types.ts` puts it
   * inside them, and a fixture written in one of those two shapes silently reads as a filter with no
   * tool at all — no CSS and no spread — which is why both are named here.
   */
  const filter = (toolName: 'blur' | 'color' | 'levels', args: Record<string, unknown>) => ({
    kind: 'filter' as const,
    toolName,
    args,
  });

  /** `layer-types.ts`'s shape, enabled unless stated: what a layer record actually carries. */
  const layerFilter = (args: Record<string, unknown>, enabled = true) => ({
    id: 'op',
    kind: 'filter' as const,
    enabled,
    args,
  });

  /** A layer record with only the fields the extent reads, so no assertion travels through a default. */
  const layerWith = (
    pos: { x: number; y: number; width: number; height: number },
    operations: unknown[]
  ): Parameters<typeof layerPresentationBounds>[0] =>
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
    }) as unknown as Parameters<typeof layerPresentationBounds>[0];

  const evaluate = (operations: Parameters<typeof evaluatePresentation>[0]['operations']) =>
    evaluatePresentation({ position, sourceSize: { ...position }, operations }).bounds;

  it('grows the extent by the blur spread on every edge', () => {
    // Three sigmas of a radius-2 kernel is 6, so a 40x20 layer presents at (-6, -6, 52, 32).
    expect(FILTER_EXTENT_SIGMAS).toBe(3);
    expect(evaluate([filter('blur', { radius: 2 })])).toEqual({ x: -6, y: -6, width: 52, height: 32 });
    expect(getPresentationFilterMargin([filter('blur', { radius: 2 })])).toBe(6);
  });

  it('applies the affine before the spread, and in output pixels rather than source pixels', () => {
    // scale(2) doubles the 40x20 source to (0, 0, 80, 40) and the spread is added to THAT — six
    // pixels, not twelve, because a browser filters the drawing operation after the current
    // transform. A margin derived in source space and scaled would read (0, 0, 104, 64) here.
    expect(evaluate([{ kind: 'affine-transform', transform: scale }, filter('blur', { radius: 2 })])).toEqual({
      x: -6,
      y: -6,
      width: 92,
      height: 52,
    });
  });

  it('gives a colour or levels adjustment no margin, because neither moves a pixel', () => {
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { ...position },
      operations: [
        filter('color', { grayscale: 100, sepia: 0, saturation: 0 }),
        filter('levels', { brightness: -50, contrast: 30 }),
      ],
    });

    // The adjustments ARE applied — the string is not `none` — and the extent is still the layer's
    // own rectangle, because a pointwise filter recolours the pixels it is given and moves none.
    expect(evaluation.filter).not.toBe('none');
    expect(evaluation.bounds).toEqual(position);
    expect(getPresentationFilterMargin([filter('color', { grayscale: 100 })])).toBe(0);
  });

  it('composes chained blur support by variance rather than clipping at the widest filter', () => {
    const margin = getPresentationFilterMargin([filter('blur', { radius: 2 }), filter('blur', { radius: 3 })]);

    expect(margin).toBeCloseTo(FILTER_EXTENT_SIGMAS * Math.hypot(2, 3));
    expect(evaluate([filter('blur', { radius: 2 }), filter('blur', { radius: 3 })])).toEqual({
      x: -FILTER_EXTENT_SIGMAS * Math.hypot(2, 3),
      y: -FILTER_EXTENT_SIGMAS * Math.hypot(2, 3),
      width: 40 + FILTER_EXTENT_SIGMAS * Math.hypot(2, 3) * 2,
      height: 20 + FILTER_EXTENT_SIGMAS * Math.hypot(2, 3) * 2,
    });
  });

  it('ignores a disabled filter, which presents nothing and so occupies nothing extra', () => {
    expect(evaluate([filter('blur', { radius: 2 })])).not.toEqual(position);
    expect(layerPresentationBounds(layerWith(position, [layerFilter({ toolName: 'blur', radius: 2 }, false)]))).toEqual(
      position
    );
  });

  it('agrees with the staging surface every processor is handed and with the transform handles', () => {
    // The agreement the rule exists for. A transformed, blurred layer at (10, 5, 40, 20): the
    // matrix moves its content to (5, 3) and doubles it, and the spread is six pixels around that,
    // so the presentation occupies (9, 2, 92, 52) in document space.
    const layer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
      { id: 'op-affine', kind: 'affine-transform', enabled: true, transform: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 3 } },
      layerFilter({ toolName: 'blur', radius: 2 }),
    ]);
    const extent = { x: 9, y: 2, width: 92, height: 52 };

    expect(layerPresentationBounds(layer)).toEqual(extent);
    expect(processorPresentationBounds(layer)).toEqual(extent);
    // A stroke frame the tool areas build from that same answer — the Blur tool's stroke route
    // reads `processorPresentationBounds` as its base — must be accepted whole, or the widening
    // branch would pad a raster that already IS the requested size and move the layer's pixels.
    const staged = stageProcessorInput(layer, { width: 40, height: 20 } as ImageBitmap, extent);
    expect(staged.bounds).toEqual(extent);
    expect({
      width: (staged.bitmap as OffscreenCanvas).width,
      height: (staged.bitmap as OffscreenCanvas).height,
    }).toEqual({ width: extent.width, height: extent.height });
  });

  it('refuses an extent the spread pushed past the raster caps, which the matrix alone passed', () => {
    // 8100x8100 is 65.6 Mpx, under the 64 MiB cap the affine extent alone is checked against, and a
    // radius-20 blur adds 60 pixels per edge and takes it to 67.6 Mpx, over it.
    const source = { width: 8100, height: 8100 };
    const bounded = { position: { x: 0, y: 0, ...source }, sourceSize: source, operations: [] };

    expect(source.width * source.height).toBeLessThan(MAX_AFFINE_PIXELS);
    expect(() => evaluatePresentation(bounded)).not.toThrow();
    expect(() => evaluatePresentation({ ...bounded, operations: [filter('blur', { radius: 20 })] })).toThrow(
      /raster bounds/
    );
  });

  it('reports the unfiltered extent rather than throwing when an argument cannot coerce', () => {
    // The spread reads the same arguments the CSS is built from, so it refuses what they refuse. A
    // throw here would land in a pointer handler — every tool area reads this extent on every move
    // of every stroke, and the transform handles read it on every render — while the renderer skips
    // such a layer entirely, so `pos` is exactly what the layer presents.
    const layer = layerWith({ x: 10, y: 5, width: 40, height: 20 }, [
      layerFilter({ toolName: 'blur', radius: 'wide' }),
    ]);

    expect(layerPresentationBounds(layer)).toEqual({ x: 10, y: 5, width: 40, height: 20 });
    expect(() => evaluate([filter('blur', { radius: 'wide' })])).toThrow(FilterArgumentUnrenderableError);
  });
});
