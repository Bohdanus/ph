import { describe, expect, it, vi } from 'vitest';

import {
  MAX_AFFINE_COORDINATE,
  MAX_AFFINE_PIXELS,
  transformToolArgsToAffine,
  type AffineTransform,
} from '../affine-transform.ts';
import {
  drawEvaluatedPresentation,
  getPresentationFilter,
  evaluatePresentation,
  evaluatePresentationForDraw,
  operationsRetainedAfterBake,
  processorPresentationBounds,
  retainedPresentationOperations,
  stageProcessorInput,
} from '../presentation-evaluator.ts';
import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
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

  it.each([
    [2, 1, 1, 2],
    [1, 2, 2, 1],
    [8, 1, 1, 8],
    [1, 8, 8, 1],
  ])(
    'does not allocate a phantom edge pixel for a %sx%s Transform-tool quarter turn',
    (width, height, stagedWidth, stagedHeight) => {
      const size = { width, height };
      const transform = transformToolArgsToAffine(
        {
          toolName: 'transform',
          rotate: 90,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          trapezoid: 0,
          resizeX: 100,
          resizeY: 100,
        },
        size
      );
      if (!transform) throw new Error('Affine Transform-tool rotation must produce a matrix');
      const rasterLayer = layerWith({ x: 0, y: 0, width, height }, [affine(transform)]);
      const staged = stageProcessorInput(rasterLayer, { width, height } as ImageBitmap);

      expect(staged.bounds).toEqual({
        x: (width - height) / 2,
        y: (height - width) / 2,
        width: height,
        height: width,
      });
      expect((staged.bitmap as OffscreenCanvas).width).toBe(stagedWidth);
      expect((staged.bitmap as OffscreenCanvas).height).toBe(stagedHeight);
    }
  );

  it('still refuses to stage a surface past the affine raster caps', () => {
    // The origin helper deliberately does NOT cap, because it allocates nothing; this one does
    // allocate a surface from the extent, and the caps are what bound that allocation.
    const big = { x: 0, y: 0, width: 9000, height: 9000 };
    const rasterLayer = layerWith(big, [affine({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })]);

    expect(() => stageProcessorInput(rasterLayer, { width: big.width, height: big.height } as ImageBitmap)).toThrow(
      /raster bounds/
    );
  });
});

describe('drawEvaluatedPresentation compositing', () => {
  it('disables image smoothing before the identity-affine blit, so a fractional layer box is not bilinearly resampled', () => {
    // §163: nothing in the composite path sets imageSmoothingEnabled, so it defaults to
    // true and a drawImage at a different size bilinearly stretches every stroke. The
    // intended behaviour is a pixel-perfect blit — no smoothing.
    const ctx = makeMockCtx();
    const smoothingAtBlit: boolean[] = [];
    vi.spyOn(ctx, 'drawImage').mockImplementation(() => {
      smoothingAtBlit.push(ctx.imageSmoothingEnabled);
      return undefined as never;
    });

    const evaluation = evaluatePresentationForDraw(
      {
        position: { x: 0, y: 0, width: 40, height: 20 },
        sourceSize: { width: 40, height: 20 },
        operations: [],
        mode: 'layer-bounds',
      },
      documentTarget
    );
    const bitmap = { width: 40, height: 20 } as ImageBitmap;

    drawEvaluatedPresentation(ctx, bitmap, evaluation, documentTarget);

    expect(smoothingAtBlit).toEqual([false]);
  });

  it('disables image smoothing before the affine-transformed blit', () => {
    const ctx = makeMockCtx();
    const smoothingAtBlit: boolean[] = [];
    vi.spyOn(ctx, 'drawImage').mockImplementation(() => {
      smoothingAtBlit.push(ctx.imageSmoothingEnabled);
      return undefined as never;
    });

    const evaluation = evaluatePresentationForDraw(
      {
        position: { x: 0, y: 0, width: 40, height: 20 },
        sourceSize: { width: 40, height: 20 },
        operations: [{ kind: 'affine-transform', transform: scale }],
        mode: 'layer-bounds',
      },
      documentTarget
    );
    const bitmap = { width: 40, height: 20 } as ImageBitmap;

    drawEvaluatedPresentation(ctx, bitmap, evaluation, documentTarget);

    expect(smoothingAtBlit).toEqual([false]);
  });
});
