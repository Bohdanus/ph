import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur } from '../blur.ts';
import { colors } from '../colors.ts';
import { crop } from '../crop.ts';
import { draw } from '../draw.ts';
import { featherMagneticLasso } from '../featherMagneticLasso.ts';
import { levels } from '../levels.ts';
import { BRIGHTNESS_SLIDER_RANGE, CONTRAST_SLIDER_RANGE } from '../functions.ts';
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

/** Pulls the numeric operands out of a composed CSS filter, e.g. `brightness(120%)`. */
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
      // The no-op filter still has to re-rasterize the source: handing the bitmap back
      // untouched would satisfy the filter assertion for the wrong reason.
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('passes negative and non-finite radii straight into the CSS filter string', () => {
      // Regression pin: nothing clamps the radius, so a negative/NaN radius produces
      // `blur(-4px)` / `blur(NaNpx)`, which is invalid CSS and silently renders unblurred.
      const [negative] = blur(params)({ radius: -4, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(-4px)');
      expect(negative).toBe(lastCanvas() as unknown as OffscreenCanvas);

      const [notANumber] = blur(params)({ radius: Number.NaN, toolName: 'blur' });
      expect(lastCanvas().ctx.filter).toBe('blur(NaNpx)');
      expect(notANumber).toBe(lastCanvas() as unknown as OffscreenCanvas);
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
      // (exp(2.1 * 0.5) - exp(-2.1)) / (1 - exp(-2.1)) = 3.116876, emitted as a percentage.
      expect(saturate).toBeCloseTo(311.69, 2);
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(canvas.width).toBe(size.width);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('is a visual no-op at the default settings', () => {
      const [result] = colors(params)({ grayscale: 0, sepia: 0, saturation: 0, toolName: 'color' });

      expect(lastCanvas().ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(100%)');
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('maps saturation through the exp curve at both extremes', () => {
      const [low] = colors(params)({ grayscale: 0, sepia: 0, saturation: 100, toolName: 'color' });
      // (exp(2.1) - exp(-2.1)) / (1 - exp(-2.1)) = 9.166170.
      expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBeCloseTo(916.62, 2);
      expect(low).toBe(lastCanvas() as unknown as OffscreenCanvas);

      const [high] = colors(params)({ grayscale: 0, sepia: 0, saturation: 200, toolName: 'color' });
      expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBeCloseTo(7585.25, 2);
      expect(high).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('desaturates: the -100 end of the Saturation slider emits saturate(0%)', () => {
      // The acceptance endpoint. `Color.tsx` ranges Saturation over -100..100 precisely so
      // this position is reachable, and `saturate(0%)` is a genuinely grey image. Before the
      // filter contract was re-anchored, `exp1_1` was >= 1 for every val >= 0, so no slider
      // position could produce less colour than the source had.
      colors(params)({ grayscale: 0, sepia: 0, saturation: -100, toolName: 'color' });

      expect(lastCanvas().ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(0%)');
      expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBe(0);
    });

    it('emits a saturate amount below 100% across the whole negative travel', () => {
      for (const saturation of [-100, -75, -50, -25, -1]) {
        colors(params)({ grayscale: 0, sepia: 0, saturation, toolName: 'color' });

        expect(parseFilter(lastCanvas().ctx.filter as string, ['saturate'])[0]).toBeLessThan(100);
      }
    });

    it('propagates a non-finite saturation into the filter string', () => {
      const [result] = colors(params)({ grayscale: 0, sepia: 0, saturation: Number.NaN, toolName: 'color' });

      expect(lastCanvas().ctx.filter).toBe('grayscale(0%) sepia(0%) saturate(NaN%)');
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
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
    it('composes brightness and contrast proportionately from their Adobe travels', () => {
      const [result] = levels(params)({ brightness: 20, contrast: 40, toolName: 'levels' });

      const canvas = lastCanvas();
      const [brightness, contrast] = parseFilter(canvas.ctx.filter as string, ['brightness', 'contrast']);
      // 1 + 20/150 = 1.13333…, emitted as a percentage.
      expect(brightness).toBeCloseTo(113.33, 2);
      // 1 + 40/100 = 1.4.
      expect(contrast).toBeCloseTo(140, 2);
      expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('is a visual no-op at the default settings', () => {
      const [result] = levels(params)({ brightness: 0, contrast: 0, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(100%) contrast(100%)');
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('darkens and flattens at the negative end of both travels without collapsing either', () => {
      const [result] = levels(params)({
        brightness: BRIGHTNESS_SLIDER_RANGE.min,
        contrast: CONTRAST_SLIDER_RANGE.min,
        toolName: 'levels',
      });

      const [brightness, contrast] = parseFilter(lastCanvas().ctx.filter as string, ['brightness', 'contrast']);
      // Brightness reaches a real black; contrast does NOT reach `0%`, which would be
      // `contrast(0%)` — every pixel the same mid-grey, an image with no information left.
      expect(brightness).toBe(0);
      expect(contrast).toBe(50);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('reaches black: the -150 end of the Brightness slider emits brightness(0%)', () => {
      // The acceptance endpoint, and it is exact rather than near. A multiply to zero drives
      // every channel to zero in any colour space and in any evaluation order, so the layer's
      // own pixels become (0,0,0) whatever the filter does with the rest of the chain.
      levels(params)({ brightness: BRIGHTNESS_SLIDER_RANGE.min, contrast: 0, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(0%) contrast(100%)');
      expect(parseFilter(lastCanvas().ctx.filter as string, ['brightness'])[0]).toBe(0);
    });

    it('emits a brightness amount below 100% and a contrast amount at or above 50% across the whole negative travel', () => {
      for (let brightness = BRIGHTNESS_SLIDER_RANGE.min; brightness < 0; brightness += 25) {
        levels(params)({ brightness, contrast: 0, toolName: 'levels' });

        expect(parseFilter(lastCanvas().ctx.filter as string, ['brightness'])[0]).toBeLessThan(100);
      }

      for (let contrast = CONTRAST_SLIDER_RANGE.min; contrast < 0; contrast += 10) {
        levels(params)({ brightness: 0, contrast, toolName: 'levels' });

        const [amount] = parseFilter(lastCanvas().ctx.filter as string, ['contrast']);
        expect(amount).toBeGreaterThan(0);
        expect(amount).toBeLessThanOrEqual(100);
      }
    });

    it('emits no negative operand anywhere on either travel, which would void the whole string', () => {
      // A browser discards an invalid `ctx.filter` assignment outright rather than applying
      // its valid part, so one negative operand would drop the OTHER term with it.
      for (const brightness of [-150, -75, 0, 75, 150]) {
        levels(params)({ brightness, contrast: -50, toolName: 'levels' });

        const [light, punch] = parseFilter(lastCanvas().ctx.filter as string, ['brightness', 'contrast']);
        expect(light).toBeGreaterThanOrEqual(0);
        expect(punch).toBeGreaterThan(0);
      }
    });

    it('passes a NaN brightness/contrast straight into the filter string (levels.ts — the levels() processor)', () => {
      // `proportionateFactor` has no guard, so non-finite inputs survive into the composed CSS
      // filter. `presentation-evaluator.ts` — `numericFilterArg()` is what refuses them on the
      // live render path; this processor has no such gate, which is what the tripwire below
      // records.
      const [result] = levels(params)({ brightness: Number.NaN, contrast: Number.NaN, toolName: 'levels' });

      expect(lastCanvas().ctx.filter).toBe('brightness(NaN%) contrast(NaN%)');
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it.fails(
      'sanitizes a non-finite brightness/contrast before it reaches the CSS filter (levels.ts — the levels() processor)',
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
      expect(canvas).toBe(lastCanvas() as unknown as OffscreenCanvas);
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
    });

    it('honours a one-pixel rect, so the 1x1 minimum only breaks for a zero-area rect', () => {
      const [canvas, pos] = crop(params)({ rect: rect(4, 6, 5, 7), toolName: 'crop' });

      expect(pos).toEqual({ width: 1, height: 1 });
      expect(lastCanvas().width).toBe(1);
      expect(lastCanvas().height).toBe(1);
      expect(lastCanvas().ctx.drawImage).toHaveBeenCalledWith(bitmap, 4, 6, 1, 1, 0, 0, 1, 1);
      expect(canvas).toBe(lastCanvas() as unknown as OffscreenCanvas);
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
      expect(cropped).toBe(cropCanvas as unknown as OffscreenCanvas);
      expect(selected).toBe(selectionCanvas as unknown as OffscreenCanvas);
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
      // A polygon that encloses nothing is a blank stand-in, not a copy of the source: nothing
      // is clipped and nothing is drawn, which a 1x1 dimension alone cannot show.
      expect(canvas.ctx.clip).not.toHaveBeenCalled();
      expect(canvas.ctx.drawImage).not.toHaveBeenCalled();
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('collapses to a 1x1 canvas for an empty point list', () => {
      const [result] = selection(params)({ points: [], mode: 'outline', toolName: 'selection' });

      expect(lastCanvas().width).toBe(1);
      expect(lastCanvas().height).toBe(1);
      expect(lastCanvas().ctx.clip).not.toHaveBeenCalled();
      expect(lastCanvas().ctx.drawImage).not.toHaveBeenCalled();
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('ignores the declared mode, so outline and fill produce identical output', () => {
      const [fill] = selection(params)({ points: triangle, mode: 'fill', toolName: 'selection' });
      const fillCalls = lastCanvas().ctx.drawImage.mock.calls.length;
      const [outline] = selection(params)({ points: triangle, mode: 'outline', toolName: 'selection' });

      expect(lastCanvas().ctx.drawImage.mock.calls.length).toBe(fillCalls);
      expect(lastCanvas().width).toBe(10);
      expect(outline).toBe(lastCanvas() as unknown as OffscreenCanvas);
      expect(fill).toBe(RecordingOffscreenCanvas.instances[0] as unknown as OffscreenCanvas);
      // The polygon is copied in bounds-relative coordinates, so the source is drawn shifted
      // by the negated origin of the polygon's own box — (2, 3) for this triangle.
      expect(RecordingOffscreenCanvas.instances[0].ctx.drawImage).toHaveBeenCalledWith(bitmap, -2, -3);
    });
  });

  describe('identity selection processors', () => {
    it('magic wand returns the source bitmap by reference and allocates no canvas', () => {
      const result = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 28,
        smoothing: 1.5,
        contiguous: true,
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
        contiguous: true,
        toolName: 'magic-wand',
      });
      const loose = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 255,
        smoothing: 100,
        contiguous: true,
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
          contiguous: true,
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
        contiguous: true,
        toolName: 'magic-wand',
      });
      const loose = acceptsArgs<MagicWandToolArgs>(magicWand(params))({
        tolerance: 255,
        smoothing: 100,
        contiguous: true,
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
      const result: unknown = reposition(params)({
        resize: { x: 1, y: 2, width: 30, height: 30 },
        toolName: 'reposition',
      });
      const [resized] = Array.isArray(result) ? (result as OffscreenCanvas[]) : [];

      // A raster branch, if one is ever written, has to honour the extent it is asked for:
      // handing back the 40x24 source would be the silent no-op this tripwire exists to catch.
      expect(Array.isArray(result)).toBe(true);
      expect(resized?.width).toBe(30);
      expect(resized?.height).toBe(30);
    });

    it.fails('returns a ToolResult for an empty arg set (src/tools/reposition.ts:12-24)', () => {
      // `defaultSettings.reposition` seeds `move: { x: 0, y: 0 }`, so the identity ToolResult the
      // move branch already produces is what an arg set carrying no move owes the registry.
      expect(reposition(params)({ toolName: 'reposition' })).toEqual([bitmap, { x: 0, y: 0 }]);
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

      // The context is shared between strokes, so the reset has to happen unconditionally.
      expect(lastCanvas().ctx.setLineDash).toHaveBeenCalledWith([]);
      // Exactly one dash write, and the stroke still happens: the reset is a replacement, not a
      // second append followed by a clear, and it is not a reason to skip the path.
      expect(lastCanvas().ctx.setLineDash).toHaveBeenCalledTimes(1);
      expect(lastCanvas().ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('ignores a dash pair a solid pen still carries and resets the pattern instead', () => {
      const [result] = draw({ size })({
        ...defaultSettings.draw,
        penType: 'pen',
        lineDash: [5, 30],
        points: stroke,
      });

      const canvas = lastCanvas();
      expect(canvas.ctx.setLineDash).not.toHaveBeenCalledWith([5, 30]);
      expect(canvas.ctx.setLineDash).toHaveBeenCalledWith([]);
      // A round cap is the solid pen's own: a pen that took the dashed branch would be square.
      expect(canvas.ctx.lineCap).toBe('round');
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('passes a negative line width straight to the context', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, lineWidth: -3, points: stroke });

      expect(lastCanvas().ctx.lineWidth).toBe(-3);
      // The sampled points still reach the path verbatim: a negative width is not a reason to
      // reorder them, drop one, or skip the stroke. (2,2) (9,4) (6,11) are the three controls.
      expect(lastCanvas().ctx.bezierCurveTo).toHaveBeenCalledWith(2, 2, 9, 4, 6, 11);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('strokes a single-point pen path into a dot', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, points: [{ x: 4, y: 4 }] });

      const canvas = lastCanvas();
      expect(canvas.ctx.moveTo).toHaveBeenCalledWith(4, 4);
      expect(canvas.ctx.lineTo).toHaveBeenCalledWith(4, 4);
      expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('ramp-paints a spray stroke with one radial gradient per point', () => {
      const [result] = draw({ size })({ ...defaultSettings.draw, penType: 'spray', points: stroke });

      const canvas = lastCanvas();
      expect(canvas.ctx.stroke).not.toHaveBeenCalled();
      expect(canvas.ctx.createRadialGradient).toHaveBeenCalledTimes(stroke.length);
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(stroke.length);
      // One dab per point, centred on the point with an inner radius of 0 and a radius of half
      // the Size slider: Size 10 is a 5px dab, not a 10px blot.
      expect(canvas.ctx.createRadialGradient).toHaveBeenCalledWith(2, 2, 0, 2, 2, 5);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
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
      // The drag bounds (4,4)-(20,16) become the ellipse: centre (12,10), radii 8 and 6, a full
      // turn from angle 0.
      expect(canvas.ctx.ellipse).toHaveBeenCalledWith(12, 10, 8, 6, 0, 0, Math.PI * 2);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
    });

    it('never fills an oval without a background color', () => {
      const [result] = shape({ size })({ ...defaultSettings.shape, figure: 'oval', ...geometry });

      expect(lastCanvas().ctx.fill).not.toHaveBeenCalled();
      expect(lastCanvas().ctx.stroke).toHaveBeenCalledTimes(1);
      // `setShapeCtx` only assigns `fillStyle` when there is a background colour, so the
      // context keeps the value it was born with: a fill here could not pick up a colour.
      expect(lastCanvas().ctx.fillStyle).toBe('');
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
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
      // A path still records its outline, so the geometry survives as a path: only the raster
      // fill is suppressed.
      expect(lastCanvas().ctx.stroke).toHaveBeenCalledTimes(1);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('normalizes a legacy circle figure onto the oval renderer', () => {
      const [result] = shape({ size })({
        ...defaultSettings.shape,
        figure: 'circle',
        ...geometry,
      } as unknown as ToolArgs);

      expect(lastCanvas().ctx.ellipse).toHaveBeenCalledTimes(1);
      // The legacy figure reaches the oval renderer with the same bounds an 'oval' would.
      expect(lastCanvas().ctx.ellipse).toHaveBeenCalledWith(12, 10, 8, 6, 0, 0, Math.PI * 2);
      expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
    });

    it('throws a named error when the args carry no figure', () => {
      expect(() => shape({ size })({ ...defaultSettings.draw, toolName: 'draw' } as unknown as ToolArgs)).toThrow(
        'Tool "draw" does not provide shape arguments'
      );
    });

    it('draws nothing without start and end handles', () => {
      // Every figure, not only the one the shape tool opens with: `drawShape` returns before it
      // reads `figure`, and each figure's branch reaches a different paint call, so a guard that
      // stopped returning early would show up on at least one of them.
      for (const figure of ['line', 'rectangle', 'oval', 'triangle'] as const) {
        const [result] = shape({ size })({ ...defaultSettings.shape, figure } as unknown as ToolArgs);
        const ctx = lastCanvas().ctx;

        expect(ctx.beginPath).not.toHaveBeenCalled();
        expect(ctx.moveTo).not.toHaveBeenCalled();
        expect(ctx.stroke).not.toHaveBeenCalled();
        expect(ctx.fill).not.toHaveBeenCalled();
        expect(ctx.strokeRect).not.toHaveBeenCalled();
        expect(result).toBe(lastCanvas() as unknown as OffscreenCanvas);
      }
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
      // A triangle inscribed in the drag bounds: the first vertex sits on top, at
      // centre (12,10) plus one radius up, so (12, 4).
      expect(canvas.ctx.moveTo).toHaveBeenCalledWith(12, 4);
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
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
      expect(canvas.ctx.quadraticCurveTo.mock.calls).toEqual([
        // Corner order and the exact control points of the 16x12 box at (4,4) with r=4:
        // top-right, bottom-right, bottom-left, top-left.
        [20, 4, 20, 8],
        [20, 16, 16, 16],
        [4, 16, 4, 12],
        [4, 4, 8, 4],
      ]);
      expect(canvas.ctx.fill).toHaveBeenCalledTimes(1);
      expect(canvas.ctx.strokeRect).not.toHaveBeenCalled();
      expect(result).toBe(canvas as unknown as OffscreenCanvas);
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

    it('snaps a shifted line to 45 degrees, keeping its length, not squaring it', () => {
      // A drag to (30, 12) from (10, 10) is 5.7 degrees, so Shift quantises the
      // direction to 0 degrees while preserving hypot(20, 2) = 20.0998. The old
      // assertion was that Shift does nothing at all for a line, which is not
      // what Photoshop's Line tool does: it constrains to 45 degree multiples.
      const geometry = normalizeShapeGeometry(anchor, { x: 30, y: 12 }, 'line', {
        shiftKey: true,
        altKey: false,
      });

      expect(geometry.start).toEqual(anchor);
      expect(geometry.end.x).toBeCloseTo(30.09975124224178, 9);
      expect(geometry.end.y).toBeCloseTo(10, 9);
      // The point of the test: the LINE is not squared, only its direction quantized.
      expect(Math.abs(geometry.end.x - geometry.start.x)).not.toBeCloseTo(
        Math.abs(geometry.end.y - geometry.start.y),
        6
      );
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
