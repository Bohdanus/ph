import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur } from '../blur.ts';
import { colors } from '../colors.ts';
import { crop } from '../crop.ts';
import { draw } from '../draw.ts';
import { featherMagneticLasso } from '../featherMagneticLasso.ts';
import { levels } from '../levels.ts';
import { magicWand } from '../magicWand.ts';
import { rectangularSelection } from '../rectangularSelection.ts';
import { reposition } from '../reposition.ts';
import { selection } from '../selection.ts';
import type { FeatherMagneticLassoToolArgs } from '../featherMagneticLasso.ts';
import type { MagicWandToolArgs } from '../magicWand.ts';
import type { RectangularSelectionToolArgs } from '../rectangularSelection.ts';
import { normalizeShapeGeometry, shape, shapeGeometryBounds } from '../shape.ts';
import { defaultSettings } from '../settings.ts';
import type { ProcessorToolParams, ToolResult } from '../toolProcessors.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { Point, RectXYSorted } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & { filter: string };

/**
 * `src/test/setup.ts` installs a global `OffscreenCanvas` stub, but it hands back a
 * brand new context object on every `getContext()` call, so a processor's `ctx.filter`
 * and `ctx.drawImage` calls are unobservable. This recording subclass reuses the shared
 * fixture context and keeps one stable context per canvas.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this, ellipse: vi.fn(), filter: '' }) as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }

  transferToImageBitmap(): ImageBitmap {
    return createMockImageBitmap(this.width, this.height);
  }
}

const size = { width: 40, height: 24 };
const bitmap = createMockImageBitmap(40, 24);
const params: ProcessorToolParams = { size, bitmap };

const lastCanvas = (): RecordingOffscreenCanvas => {
  const canvas = RecordingOffscreenCanvas.instances.at(-1);
  if (!canvas) throw new Error('processor did not allocate an OffscreenCanvas');
  return canvas;
};

const rect = (x1: number, y1: number, x2: number, y2: number): RectXYSorted => ({ x1, y1, x2, y2 });

const triangle: Point[] = [
  { x: 2, y: 3 },
  { x: 12, y: 3 },
  { x: 12, y: 13 },
];

/**
 * `magicWand`, `featherMagneticLasso`, and `rectangularSelection` all declare an args
 * type but are typed as taking zero parameters, so their args have to be cast in.
 */
const acceptsArgs =
  <TArgs>(processor: () => readonly unknown[]) =>
  (args: TArgs): ToolResult =>
    (processor as unknown as (a: TArgs) => ToolResult)(args);

/** Pulls the numeric operands out of a composed CSS filter, e.g. `brightness(1.2)`. */
const parseFilter = (filter: string, names: string[]): number[] =>
  names.map((name) => {
    const match = new RegExp(`${name}\\(([^)]+)\\)`).exec(filter);
    if (!match) throw new Error(`filter "${filter}" is missing a ${name}() term`);
    return Number(match[1].replace('%', ''));
  });

describe('tool image processors', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('blur', () => {
    it('wraps the source in a size-matched canvas with a blur() filter', () => {
      const [result] = blur(params)({ radius: 5, toolName: 'blur' });

      const canvas = lastCanvas();
      expect(canvas.width).toBe(size.width);
      expect(canvas.height).toBe(size.height);
      expect(canvas.ctx.filter).toBe('blur(5px)');
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('returns exactly one canvas and never aliases the source bitmap', () => {
      const result = blur(params)({ radius: 3, toolName: 'blur' });

      expect(result).toHaveLength(1);
      expect(result[0]).not.toBe(bitmap);
    });

    it('emits blur(0px) for a zero radius, still re-rasterizing the source', () => {
      const [result] = blur(params)({ radius: 0, toolName: 'blur' });

      expect(lastCanvas().ctx.filter).toBe('blur(0px)');
      expect(result).toBeTruthy();
    });

    it('passes negative and non-finite radii straight into the CSS filter string', () => {
      // Regression pin: nothing clamps the radius, so a negative/NaN radius produces
      // `blur(-4px)` / `blur(NaNpx)`, which is invalid CSS and silently renders unblurred.
      const [negative] = blur(params)({ radius: -4, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(-4px)');
      expect(negative).toBeTruthy();

      const [notANumber] = blur(params)({ radius: Number.NaN, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(NaNpx)');
      expect(notANumber).toBeTruthy();
    });

    it('records the filter through a real writable data property, so the assertions above are not vacuous', () => {
      // A `filter` getter that always returns '' would make every `ctx.filter` assertion in
      // this file pass for the wrong reason. The value must be observable as a plain write.
      blur(params)({ radius: 3, toolName: 'blur' });
      const descriptor = Object.getOwnPropertyDescriptor(
        lastCanvas().ctx as unknown as Record<string, unknown>,
        'filter'
      );

      expect(descriptor?.get).toBeUndefined();
      expect(descriptor?.set).toBeUndefined();
      expect(descriptor).toMatchObject({ value: 'blur(3px)', writable: true });
    });

    it.fails('clamps a negative or non-finite radius into a valid CSS filter (src/tools/blur.ts:11)', () => {
      blur(params)({ radius: -4, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(0px)');

      blur(params)({ radius: Number.NaN, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(0px)');
    });
  });

  describe('colors', () => {
    it('composes grayscale, sepia, and an exponential saturation filter', () => {
      const [result] = colors(params)({ grayscale: 40, sepia: 25, saturation: 50, toolName: 'color' });

      const canvas = lastCanvas();
      const [grayscale, sepia, saturate] = parseFilter(canvas.ctx.filter as string, ['grayscale', 'sepia', 'saturate']);
      expect(grayscale).toBe(40);
      expect(sepia).toBe(25);
      expect(saturate).toBeCloseTo(Math.exp(2.1 * (50 / 100)), 10);
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(canvas.width).toBe(size.width);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('is a visual no-op at the default settings', () => {
      const [result] = colors(params)({ grayscale: 0, sepia: 0, saturation: 0, toolName: 'color' });

      expect(lastCanvas().ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(1)');
      expect(result).toBeTruthy();
    });

    it('maps saturation through the exp curve at both extremes', () => {
      const [low] = colors(params)({ grayscale: 0, sepia: 0, saturation: 100, toolName: 'color' });
      expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBeCloseTo(Math.exp(2.1), 10);
      expect(low).toBeTruthy();

      const [high] = colors(params)({ grayscale: 0, sepia: 0, saturation: 200, toolName: 'color' });
      expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBeCloseTo(Math.exp(4.2), 10);
      expect(high).toBeTruthy();
    });

    it('propagates a non-finite saturation into the filter string', () => {
      const [result] = colors(params)({ grayscale: 0, sepia: 0, saturation: Number.NaN, toolName: 'color' });

      expect(lastCanvas().ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(NaN)');
      expect(result).toBeTruthy();
    });

    it.fails('sanitizes a non-finite saturation before it reaches the CSS filter (src/tools/colors.ts:12)', () => {
      colors(params)({ grayscale: 0, sepia: 0, saturation: Number.NaN, toolName: 'color' });

      expect(lastCanvas().ctx.filter).not.toContain('NaN');
    });

    it.fails('clamps out-of-range grayscale and sepia into valid percentages (src/tools/colors.ts:12)', () => {
      colors(params)({ grayscale: -30, sepia: 400, saturation: 0, toolName: 'color' });
      const [grayscale, sepia] = parseFilter(lastCanvas().ctx.filter as string, ['grayscale', 'sepia']);

      expect(grayscale).toBeGreaterThanOrEqual(0);
      expect(sepia).toBeLessThanOrEqual(100);
    });
  });

  describe('levels', () => {
    it('composes brightness and contrast with their own exp curves', () => {
      const [result] = levels(params)({ brightness: 20, contrast: 40, toolName: 'levels' });

      const canvas = lastCanvas();
      const [brightness, contrast] = parseFilter(canvas.ctx.filter as string, ['brightness', 'contrast']);
      expect(brightness).toBeCloseTo(Math.exp(1.9 * (20 / 100)), 10);
      expect(contrast).toBeCloseTo(Math.exp(2.2 * (40 / 100)), 10);
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('is a visual no-op at the default settings', () => {
      const [result] = levels(params)({ brightness: 0, contrast: 0, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(1) contrast(1)');
      expect(result).toBeTruthy();
    });

    it('darkens for negative brightness and contrast', () => {
      const [result] = levels(params)({ brightness: -100, contrast: -100, toolName: 'levels' });

      const [brightness, contrast] = parseFilter(lastCanvas().ctx.filter as string, ['brightness', 'contrast']);
      expect(brightness).toBeCloseTo(Math.exp(-1.9), 10);
      expect(contrast).toBeCloseTo(Math.exp(-2.2), 10);
      expect(brightness).toBeLessThan(1);
      expect(contrast).toBeLessThan(1);
      expect(result).toBeTruthy();
    });

    it('passes a NaN brightness/contrast straight into the filter string (src/tools/levels.ts:12)', () => {
      // `exp1_1` has no guard, so non-finite inputs survive into the composed CSS filter.
      const [result] = levels(params)({ brightness: Number.NaN, contrast: Number.NaN, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(NaN) contrast(NaN)');
      expect(result).toBeTruthy();
    });

    it.fails(
      'sanitizes a non-finite brightness/contrast before it reaches the CSS filter (src/tools/levels.ts:12)',
      () => {
        levels(params)({ brightness: Number.NaN, contrast: Number.NaN, toolName: 'levels' });

        expect(lastCanvas().ctx.filter).not.toContain('NaN');
      }
    );
  });

  describe('crop', () => {
    it('resizes the output canvas to the trimmed rect and reports the new size', () => {
      const [canvas, pos] = crop(params)({ rect: rect(4, 6, 20, 18), toolName: 'crop' });

      expect(pos).toEqual({ width: 16, height: 12 });
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 4, 6, 16, 12, 0, 0, 16, 12);
      expect(canvas).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('clamps a rect that overflows the source bounds', () => {
      const [, pos] = crop(params)({ rect: rect(-30, -10, size.width + 25, size.height + 8), toolName: 'crop' });

      expect(pos).toEqual({ width: size.width, height: size.height });
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height, 0, 0, 40, 24);
    });

    it('normalizes an inverted rect before cropping', () => {
      const [canvas, pos] = crop(params)({ rect: rect(20, 18, 4, 6), toolName: 'crop' });

      expect(pos).toEqual({ width: 16, height: 12 });
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 4, 6, 16, 12, 0, 0, 16, 12);
      expect(canvas).toBeTruthy();
    });

    it('produces a 0x0 canvas for a zero-area rect instead of clamping to 1x1 (src/tools/crop.ts:19-20)', () => {
      // `canvas.width`/`canvas.height` are assigned *after* construction, so the
      // `Math.max(1, …)` clamp every other canvas path relies on never runs. A degenerate
      // crop therefore yields an unusable 0x0 document.
      const [canvas, pos] = crop(params)({ rect: rect(7, 7, 7, 7), toolName: 'crop' });

      expect(pos).toEqual({ width: 0, height: 0 });
      expect(lastCanvas().width).toBe(0);
      expect(lastCanvas().height).toBe(0);
      expect(canvas).toBe(lastCanvas() as unknown as OffscreenCanvas);
      expect(canvas).toBeTruthy();
    });

    it('honours a one-pixel rect, so the 1x1 minimum only breaks for a zero-area rect', () => {
      const [canvas, pos] = crop(params)({ rect: rect(4, 6, 5, 7), toolName: 'crop' });

      expect(pos).toEqual({ width: 1, height: 1 });
      expect(lastCanvas().width).toBe(1);
      expect(lastCanvas().height).toBe(1);
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 4, 6, 1, 1, 0, 0, 1, 1);
      expect(canvas).toBeTruthy();
    });

    it('documents the clamp asymmetry against a sibling processor that does clamp (src/tools/crop.ts:19-20)', () => {
      // Both processors allocate a fresh document-sized canvas; only crop's post-construction
      // width/height assignment skips the minimum-size clamp, so a degenerate crop is the
      // single path in this file that can produce a 0-pixel document.
      const [cropped] = crop(params)({ rect: rect(7, 7, 7, 7), toolName: 'crop' });
      const cropCanvas = lastCanvas();
      const [selected] = selection(params)({ points: [], mode: 'fill', toolName: 'selection' });
      const selectionCanvas = lastCanvas();

      expect(cropCanvas.width).toBe(0);
      expect(selectionCanvas.width).toBe(1);
      expect(selectionCanvas.height).toBe(1);
      expect(cropped).toBeTruthy();
      expect(selected).toBeTruthy();
    });

    it('throws a TypeError for the tool default null rect (src/tools/crop.ts:17)', () => {
      // `crop.ts:17` asserts `rect!` while `defaultSettings.crop.rect` is null
      // (`src/tools/settings.ts:51`). The type lie is the assertion; the throw itself is
      // raised by the destructure inside `trimRect` (`src/util/rect.ts:28`).
      expect(defaultSettings.crop.rect).toBeNull();
      expect(() => crop(params)({ rect: defaultSettings.crop.rect, toolName: 'crop' })).toThrow(TypeError);
      expect(() => crop(params)({ rect: null, toolName: 'crop' })).toThrow(
        /Cannot destructure property 'x1' of 'rectSorted' as it is null/
      );
    });

    it.fails('treats the default null rect as a no-op copy instead of throwing (src/tools/crop.ts:17)', () => {
      expect(() => crop(params)({ rect: null, toolName: 'crop' })).not.toThrow();
    });
  });

  describe('selection', () => {
    it('copies polygon pixels into a canvas sized to the polygon bounds', () => {
      const [result] = selection(params)({ points: triangle, mode: 'fill', toolName: 'selection' });

      const canvas = lastCanvas();
      expect(canvas.width).toBe(10);
      expect(canvas.height).toBe(10);
      expect(canvas.ctx.clip).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('does not alias the source bitmap', () => {
      const [result] = selection(params)({ points: triangle, mode: 'fill', toolName: 'selection' });

      expect(result).not.toBe(bitmap);
    });

    it('collapses to a 1x1 canvas for a degenerate polygon of fewer than three points', () => {
      const [result] = selection(params)({
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
        mode: 'fill',
        toolName: 'selection',
      });

      const canvas = lastCanvas();
      expect(canvas.width).toBe(1);
      expect(canvas.height).toBe(1);
      expect(canvas.ctx.beginPath).not.toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('collapses to a 1x1 canvas for an empty point list', () => {
      const [result] = selection(params)({ points: [], mode: 'outline', toolName: 'selection' });

      expect(lastCanvas().width).toBe(1);
      expect(lastCanvas().height).toBe(1);
      expect(result).toBeTruthy();
    });

    it('ignores the declared mode, so outline and fill produce identical output', () => {
      const [fill] = selection(params)({ points: triangle, mode: 'fill', toolName: 'selection' });
      const fillCalls = lastCanvas().ctx.drawImage.mock.calls.length;
      const [outline] = selection(params)({ points: triangle, mode: 'outline', toolName: 'selection' });

      expect(lastCanvas().ctx.drawImage.mock.calls.length).toBe(fillCalls);
      expect(lastCanvas().width).toBe(10);
      expect(outline).toBeTruthy();
      expect(fill).toBeTruthy();
    });
  });

  describe('identity selection processors', () => {
    it('magic wand returns the source bitmap by reference and allocates no canvas', () => {
      const result = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 28,
        smoothing: 1.5,
        toolName: 'magic-wand',
      });

      expect(result).toEqual([bitmap]);
      expect(result[0]).toBe(bitmap);
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('magic wand ignores tolerance and smoothing entirely', () => {
      const strict = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 0,
        smoothing: 0,
        toolName: 'magic-wand',
      });
      const loose = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 255,
        smoothing: 100,
        toolName: 'magic-wand',
      });

      expect(strict[0]).toBe(bitmap);
      expect(loose[0]).toBe(bitmap);
    });

    it('magic wand never throws on extreme or non-finite settings', () => {
      expect(() =>
        acceptsArgs<MagicWandToolArgs>(magicWand(params))({
          tolerance: Number.NaN,
          smoothing: Number.NaN,
          toolName: 'magic-wand',
        })
      ).not.toThrow();
    });

    it('feather magnetic lasso returns the source bitmap by reference', () => {
      const result = acceptsArgs<FeatherMagneticLassoToolArgs>(featherMagneticLasso(params))({
        points: triangle,
        featherRadius: 12,
        magneticWidth: 18,
        edgeContrast: 30,
        frequency: 40,
        snapStrength: 0.85,
        smoothing: 1.5,
        antiAlias: true,
        previewFeather: true,
        toolName: 'feather-magnetic-lasso',
      });

      expect(result).toEqual([bitmap]);
      expect(result[0]).toBe(bitmap);
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('feather magnetic lasso applies no feather regardless of the radius', () => {
      const noFeather = acceptsArgs<FeatherMagneticLassoToolArgs>(featherMagneticLasso(params))({
        points: triangle,
        featherRadius: 0,
        magneticWidth: 0,
        edgeContrast: 0,
        frequency: 0,
        snapStrength: 0,
        smoothing: 0,
        antiAlias: false,
        previewFeather: false,
        toolName: 'feather-magnetic-lasso',
      });

      expect(noFeather[0]).toBe(bitmap);
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('rectangular selection returns the source bitmap without applying the rect', () => {
      const result = acceptsArgs<RectangularSelectionToolArgs>(rectangularSelection(params))({
        rect: rect(4, 4, 8, 8),
        toolName: 'rectangular-selection',
      });

      expect(result).toEqual([bitmap]);
      expect(result[0]).toBe(bitmap);
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('rectangular selection ignores a degenerate null rect', () => {
      const result = acceptsArgs<RectangularSelectionToolArgs>(rectangularSelection(params))({
        rect: null,
        toolName: 'rectangular-selection',
      });

      expect(result[0]).toBe(bitmap);
    });

    it('declares zero parameters on all three identity processors despite the registry feeding them ToolArgs', () => {
      // The type lies are src/tools/magicWand.ts:11-15, src/tools/featherMagneticLasso.ts:19-23,
      // and src/tools/rectangularSelection.ts:9-13: each publishes a `ToolArgs` type but is
      // typed `() => BitmapSource[]`, so the registry has to @ts-expect-error them into place.
      expect(magicWand(params).length).toBe(0);
      expect(featherMagneticLasso(params).length).toBe(0);
      expect(rectangularSelection(params).length).toBe(0);
    });

    it.fails('derives a selection from the tolerance it is fed (src/tools/magicWand.ts:11-15)', () => {
      const strict = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 0,
        smoothing: 0,
        toolName: 'magic-wand',
      });
      const loose = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 255,
        smoothing: 100,
        toolName: 'magic-wand',
      });

      expect(strict[0]).not.toBe(loose[0]);
    });

    it.fails('applies the feather radius it is fed (src/tools/featherMagneticLasso.ts:19-23)', () => {
      const noFeather = acceptsArgs<FeatherMagneticLassoToolArgs>(featherMagneticLasso(params))({
        points: triangle,
        featherRadius: 0,
        magneticWidth: 0,
        edgeContrast: 0,
        frequency: 0,
        snapStrength: 0,
        smoothing: 0,
        antiAlias: false,
        previewFeather: false,
        toolName: 'feather-magnetic-lasso',
      });
      const feathered = acceptsArgs<FeatherMagneticLassoToolArgs>(featherMagneticLasso(params))({
        points: triangle,
        featherRadius: 12,
        magneticWidth: 18,
        edgeContrast: 30,
        frequency: 40,
        snapStrength: 0.85,
        smoothing: 1.5,
        antiAlias: true,
        previewFeather: true,
        toolName: 'feather-magnetic-lasso',
      });

      expect(noFeather[0]).not.toBe(feathered[0]);
    });

    it.fails('bounds the selection to the rect it is fed (src/tools/rectangularSelection.ts:9-13)', () => {
      const result = acceptsArgs<RectangularSelectionToolArgs>(rectangularSelection(params))({
        rect: rect(4, 4, 8, 8),
        toolName: 'rectangular-selection',
      });

      expect(result[0]).not.toBe(bitmap);
    });
  });

  describe('reposition', () => {
    it('returns the bitmap together with the requested move', () => {
      const move = { x: 12, y: -8 };

      expect(reposition(params)({ move, toolName: 'reposition' })).toEqual([bitmap, move]);
    });

    it('passes a zero move through without touching the bitmap', () => {
      const result = reposition(params)({ move: { x: 0, y: 0 }, toolName: 'reposition' });

      expect(result?.[0]).toBe(bitmap);
      expect(result?.[1]).toEqual({ x: 0, y: 0 });
    });

    it('returns undefined for a resize-only arg set, never rasterizing a stretch', () => {
      // The registry commits reposition as `geometry`, so the raster branch must stay
      // unused; the runtime value is `undefined` even though the signature promises ToolResult.
      const result = reposition(params)({ resize: { x: 1, y: 2, width: 30, height: 30 }, toolName: 'reposition' });

      expect(result).toBeUndefined();
      expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
    });

    it('returns undefined when neither move nor resize is supplied', () => {
      expect(reposition(params)({ toolName: 'reposition' })).toBeUndefined();
    });

    it('crashes a caller that destructures the raster result for a resize-only or empty arg set (src/tools/reposition.ts:12-24)', () => {
      // `ToolProcessorDefinition.imageProcessor` promises a `ToolResult`, so the cast below is
      // exactly what the registry's declared type allows; at runtime the value is `undefined`
      // and any `const [source] = result` throws.
      const resizeOnly = reposition(params)({
        resize: { x: 1, y: 2, width: 30, height: 30 },
        toolName: 'reposition',
      }) as ToolResult;
      const empty = reposition(params)({ toolName: 'reposition' }) as ToolResult;

      expect(() => {
        const [source] = resizeOnly;
        return source;
      }).toThrow(TypeError);
      expect(() => {
        const [source] = empty;
        return source;
      }).toThrow(TypeError);
    });

    it.fails('returns a ToolResult for a resize-only arg set (src/tools/reposition.ts:12-24)', () => {
      const result = reposition(params)({ resize: { x: 1, y: 2, width: 30, height: 30 }, toolName: 'reposition' });

      expect(result).toBeDefined();
    });

    it.fails('returns a ToolResult for an empty arg set (src/tools/reposition.ts:12-24)', () => {
      expect(reposition(params)({ toolName: 'reposition' })).toBeDefined();
    });
  });

  describe('draw pen types', () => {
    const stroke: Point[] = [
      { x: 2, y: 2 },
      { x: 9, y: 4 },
      { x: 6, y: 11 },
    ];

    it('uses a square cap and a dash pattern for pen-dashed', () => {
      const [result] = draw({ size })({
        ...defaultSettings.draw,
        penType: 'pen-dashed',
        lineDash: [5, 30],
        lineWidth: 4,
        points: stroke,
      });

      const canvas = lastCanvas();
      expect(canvas.ctx.lineCap).toBe('square');
      expect(canvas.ctx.setLineDash).toHaveBeenCalledWith([5, 30]);
      expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('clears the dash pattern for an undashed pen', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, lineDash: null, points: stroke });

      expect(lastCanvas().ctx.setLineDash).not.toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('passes a negative line width straight to the context', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, lineWidth: -3, points: stroke });

      expect(lastCanvas().ctx.lineWidth).toBe(-3);
      expect(result).toBeTruthy();
    });

    it('strokes a single-point pen path into a dot', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, points: [{ x: 4, y: 4 }] });

      const canvas = lastCanvas();
      expect(canvas.ctx.moveTo).toHaveBeenCalledWith(4, 4);
      expect(canvas.ctx.lineTo).toHaveBeenCalledWith(4, 4);
      expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
    });

    it('ramp-paints a spray stroke with one radial gradient per point', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, penType: 'spray', points: stroke });

      const canvas = lastCanvas();
      expect(canvas.ctx.stroke).not.toHaveBeenCalled();
      expect(canvas.ctx.createRadialGradient).toHaveBeenCalledTimes(stroke.length);
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(stroke.length);
      expect(result).toBeTruthy();
    });
  });

  describe('shape processor edges', () => {
    const geometry = { start: { x: 4, y: 4 }, end: { x: 20, y: 16 } };

    it('fills and strokes an oval when a background color is set', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'oval',
        hasFill: true,
        backgroundColor: '#00ff00',
        ...geometry,
      });

      const canvas = lastCanvas();
      expect(canvas.ctx.fillStyle).toBe('#00ff00');
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
    });

    it('never fills an oval without a background color', () => {
      const [result] = shape({ size })({ ...defaultSettings.shape, figure: 'oval', ...geometry });

      expect(lastCanvas().ctx.fill).not.toHaveBeenCalled();
      expect(lastCanvas().ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
    });

    it('suppresses the fill in path tool mode even with a background color', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'oval',
        toolMode: 'path',
        hasFill: true,
        backgroundColor: '#00ff00',
        ...geometry,
      });

      expect(lastCanvas().ctx.fill).not.toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('normalizes a legacy circle figure onto the oval renderer', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'circle',
        ...geometry,
      } as unknown as ToolArgs);

      expect(lastCanvas().ctx.ellipse).toHaveBeenCalledTimes(1);
      expect(result).toBeTruthy();
    });

    it('throws a named error when the args carry no figure', () => {
      expect(() => shape({ size })({ ...defaultSettings.draw, toolName: 'draw' } as unknown as ToolArgs)).toThrow(
        'Tool "draw" does not provide shape arguments'
      );
    });

    it('draws nothing without start and end handles', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'rectangle',
      } as unknown as ToolArgs);

      expect(lastCanvas().ctx.strokeRect).not.toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('fills a triangle when a background color is set', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'triangle',
        hasFill: true,
        backgroundColor: '#0000ff',
        ...geometry,
      });

      const canvas = lastCanvas();
      expect(canvas.ctx.closePath).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.fillStyle).toBe('#0000ff');
      expect(result).toBeTruthy();
    });

    it('fills a rounded rectangle through the curved path', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'rectangle',
        cornerRadius: 4,
        hasFill: true,
        backgroundColor: '#0000ff',
        ...geometry,
      });

      const canvas = lastCanvas();
      expect(canvas.ctx.quadraticCurveTo).toHaveBeenCalled();
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.strokeRect).not.toHaveBeenCalled();
      expect(result).toBeTruthy();
    });
  });

  describe('normalizeShapeGeometry', () => {
    const anchor = { x: 10, y: 10 };

    it('mirrors the pointer around the anchor when alt is held', () => {
      expect(normalizeShapeGeometry(anchor, { x: 20, y: 30 }, 'rectangle', { shiftKey: false, altKey: true })).toEqual({
        start: { x: 0, y: -10 },
        end: { x: 20, y: 30 },
      });
    });

    it('keeps the anchor as the start when alt is not held', () => {
      expect(normalizeShapeGeometry(anchor, { x: 20, y: 30 }, 'rectangle', { shiftKey: false, altKey: false })).toEqual(
        { start: anchor, end: { x: 20, y: 30 } }
      );
    });

    it('snaps a shift-drag to a square around the anchor', () => {
      expect(normalizeShapeGeometry(anchor, { x: 30, y: 12 }, 'rectangle', { shiftKey: true, altKey: false })).toEqual({
        start: anchor,
        end: { x: 30, y: 30 },
      });
    });

    it('falls back to a positive direction when the pointer shares the anchor axis', () => {
      // `Math.sign(0)` is 0, so the `|| 1` fallback decides the drag quadrant.
      expect(normalizeShapeGeometry(anchor, { x: 10, y: 30 }, 'rectangle', { shiftKey: true, altKey: true })).toEqual({
        start: { x: -10, y: -10 },
        end: { x: 30, y: 30 },
      });
    });

    it('never squares a line, because lines have no aspect ratio', () => {
      expect(normalizeShapeGeometry(anchor, { x: 30, y: 12 }, 'line', { shiftKey: true, altKey: false })).toEqual({
        start: anchor,
        end: { x: 30, y: 12 },
      });
    });
  });

  describe('shapeGeometryBounds', () => {
    it('pads the drag rect by half the stroke plus one antialiasing pixel', () => {
      expect(shapeGeometryBounds({ start: { x: 4, y: 6 }, end: { x: 20, y: 16 } }, 4)).toEqual({
        x: 1,
        y: 3,
        width: 22,
        height: 16,
      });
    });

    it('normalizes an inverted drag rect', () => {
      expect(shapeGeometryBounds({ start: { x: 20, y: 16 }, end: { x: 4, y: 6 } }, 4)).toEqual(
        shapeGeometryBounds({ start: { x: 4, y: 6 }, end: { x: 20, y: 16 } }, 4)
      );
    });
  });
});
