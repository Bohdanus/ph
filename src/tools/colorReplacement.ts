import { createFloodFillMask } from '../util/floodFill.ts';
import type { RgbaColor } from '../util/magicWand.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';
import type { BitmapSource, Point, Size } from '../contexts/general-types.ts';
import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * Adobe's Limits control. `contiguous` replaces the whole connected region of colour-matching
 * pixels the stroke touches; `discontinuous` replaces only what is under the brush. Photoshop
 * ships `Contiguous` selected, which is what `defaultSettings` seeds.
 *
 * This is the same pair of words `FillToolArgs.contiguous` already uses, spelled as a union
 * rather than a boolean because Photoshop renders it as a two-option popup, not a checkbox, and
 * because `false` is a poor name for "Discontinuous" at a call site.
 */
export type ColorReplacementLimits = 'contiguous' | 'discontinuous';

/**
 * Adobe's Sampling control. `all-layers` samples against the composite of every visible layer.
 *
 * Only `current-layer` is live: the tool area has the ACTIVE layer's pixels, and `commit:
 * 'raster'` writes the result back to the active layer alone, so `all-layers` would need a
 * composite read that nothing in this path performs. It is kept in the type and rendered
 * `disabled` in the options bar, which is the precedent `Eyedropper.tsx:37-43` sets for
 * `sampleAllLayers` — a Photoshop control with a real value behind it, honestly inert rather
 * than absent, so turning it on is a rendering change and not a schema change.
 */
export type ColorReplacementSampling = 'current-layer' | 'all-layers';

/**
 * Adobe's tolerance scale for this tool is 0-100 — NOT the 0-255 the bucket, the magic eraser
 * and the background eraser use (`FILL_TOLERANCE_MAX`) and NOT the wand's 0-100 measured against
 * a 4-channel distance (`src/util/magicWand.ts:58-69`). The two 0-100 scales are different
 * metrics, which is why the scale lives here and `createFloodFillMask` is handed a converted
 * value rather than this number.
 */
export const COLOR_REPLACEMENT_TOLERANCE_MAX = 100;

/** Adobe's seeded default for the Color Replacement Tool. */
export const COLOR_REPLACEMENT_TOLERANCE_DEFAULT = 30;

/** Adobe's Smoothness (`Anti-aliased` on older builds) runs 0-50, not 0-100. */
export const COLOR_REPLACEMENT_SMOOTHNESS_MAX = 50;

/** Adobe's seeded Smoothness. */
export const COLOR_REPLACEMENT_SMOOTHNESS_DEFAULT = 10;

/**
 * The widest Euclidean RGB distance two colours can have. Tolerance 100 therefore matches every
 * pixel and tolerance 0 matches only an exact one, which is the invariant the tests pin.
 */
const MAX_COLOR_DISTANCE = Math.sqrt(3 * 255 * 255);

/** Rec. 709 luminance weights, the same primaries the CSS `rgb()` the store holds already uses. */
const LUMINANCE_RED = 0.2126;
const LUMINANCE_GREEN = 0.7152;
const LUMINANCE_BLUE = 0.0722;

/**
 * The pixels a single brush stamp covers, as a soft disc. The radius is `lineWidth` in pixels, so
 * the seeded 18 is an 18px-radius brush, and the falloff starts halfway out so the core is solid
 * and only the rim is feathered — which is what makes Smoothness and the brush's own edge the
 * same kind of quantity and lets the two be multiplied.
 */
const COVERAGE_CORE_RATIO = 0.5;

/**
 * How far Smoothness reaches, in pixels, at the top of its 0-50 range. Photoshop exposes no unit
 * for it, so this is the one free constant in the tool; it is named so a test can pin the ends of
 * the scale rather than an implementation's blur radius.
 */
const SMOOTHNESS_MAX_RADIUS = 12;

export type ColorReplacementToolArgs = {
  /** 0..1, the convention `DrawToolArgs.alpha` already uses. This is Photoshop's Opacity. */
  alpha: number;
  /** The replacement colour, the store's foreground at the moment of the drag. */
  color: string;
  /** Photoshop's Size: the replacement brush's radius in pixels. */
  lineWidth: number;
  /** 0..100. See `COLOR_REPLACEMENT_TOLERANCE_MAX`. */
  tolerance: number;
  limits: ColorReplacementLimits;
  sampling: ColorReplacementSampling;
  /** 0..50. See `COLOR_REPLACEMENT_SMOOTHNESS_MAX`. */
  smoothness: number;
  /**
   * The colour the user clicked to choose, or null when the tool is still asking for one.
   *
   * Optional-and-nullable rather than required for the same reason `draw`'s `points` is optional:
   * the settings arm in `src/util/settings.ts` persists the other controls and omits this one, so
   * a restored args object genuinely has no key here. Absent, null and "never sampled" are one
   * state to every reader of this file.
   */
  sampleColor?: RgbaColor | null;
  /** The drag, in the active layer's own coordinates. Omitted by the settings arm, like `draw`. */
  points?: Point[];

  toolName: 'color-replacement';
};

/** `hexToRgb` returns the triple as a string for `rgba(...)`; a substitution needs the numbers. */
const parseHexColor = (color: string): [number, number, number] => {
  const hex = color.replace('#', '');

  return [
    Number.parseInt(hex.substring(0, 2), 16) || 0,
    Number.parseInt(hex.substring(2, 4), 16) || 0,
    Number.parseInt(hex.substring(4, 6), 16) || 0,
  ];
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const luminance = (r: number, g: number, b: number): number =>
  LUMINANCE_RED * r + LUMINANCE_GREEN * g + LUMINANCE_BLUE * b;

/**
 * The factor that puts this tool's 0-100 Tolerance onto `createFloodFillMask`'s 0-255 argument.
 *
 * `getToleranceDistance` reads its argument as `(t / 255) * MAX_COLOR_DISTANCE`
 * (`src/util/floodFill.ts:70-74`, with `MAX_TOLERANCE = 255` at `:21`), while
 * `toleranceDistanceSquared` above reads this tool's as `(t / 100) * MAX_COLOR_DISTANCE` over an
 * identical `MAX_COLOR_DISTANCE`. Multiplying by `255 / 100` therefore makes the delegated flood
 * and the inline `matchMask` predicate above reject exactly the same pixels, which is what makes
 * Limits a choice about how far the replacement REACHES rather than about which pixels exist.
 *
 * It is a scale, not a tolerance, and it is named for what it converts. The name it replaces read
 * `..._DISCONTINUOUS_FILL_TOLERANCE` while its only call site is the Contiguous branch, one screen
 * below the Disconnected one it claimed to describe — which is the worst possible place for a
 * constant whose whole job is to stop the two branches drifting apart.
 */
export const COLOR_REPLACEMENT_TOLERANCE_TO_FILL_TOLERANCE_SCALE = 255 / COLOR_REPLACEMENT_TOLERANCE_MAX;

/** The maximum distance this tool's tolerance maps onto, squared, so no per-pixel `Math.sqrt`. */
const toleranceDistanceSquared = (tolerance: number): number => {
  const clamped = clamp(
    Number.isFinite(tolerance) ? tolerance : COLOR_REPLACEMENT_TOLERANCE_DEFAULT,
    0,
    COLOR_REPLACEMENT_TOLERANCE_MAX
  );

  return ((clamped / COLOR_REPLACEMENT_TOLERANCE_MAX) * MAX_COLOR_DISTANCE) ** 2;
};

/** Smoothness in pixels. A finite guard, because a non-numeric slider read must not reach `new Int32Array`. */
const smoothnessRadius = (smoothness: number): number => {
  const clamped = clamp(
    Number.isFinite(smoothness) ? smoothness : COLOR_REPLACEMENT_SMOOTHNESS_DEFAULT,
    0,
    COLOR_REPLACEMENT_SMOOTHNESS_MAX
  );

  return Math.round((clamped / COLOR_REPLACEMENT_SMOOTHNESS_MAX) * SMOOTHNESS_MAX_RADIUS);
};

/**
 * Substitutes the replacement colour for a pixel while keeping the PIXEL's own luminance, which is
 * the whole difference between this tool and a brush: Photoshop's Color Replacement "retains the
 * texture and shading of the image", so a lit sphere stays lit after the colour changes.
 *
 * The substitution is a single LUMINANCE OFFSET, `out = replacement + (L - L_replacement)`, and not
 * a scale. That choice is load-bearing and the obvious alternative is wrong:
 *
 * - A scale, `replacement * (L / L_replacement)`, is exact only while the result is IN GAMET. Above
 *   the boundary it overruns 255 on its peak channel, and a hue-preserving downscale then lands on
 *   the SAME colour for every brighter pixel — the region flattens into one solid, which is the
 *   failure this function exists to prevent. Restoring the lost luminance as a uniform lift toward
 *   white fixes the flattening and destroys the hue instead: pure white asked to become pure red
 *   comes back white, so the tool did nothing at all.
 * - An offset is exact in luminance whenever nothing clips, stays HUE-EXACT under clipping (one
 *   shared subtraction rather than three independent clamps), and its one imperfection — a channel
 *   that reaches 0 or 255 and stops tracking `L` — flattens only the extreme shadow and extreme
 *   highlight ends, never the mid-range shading a photo is made of. Measured over `L` = 0, 40, 100,
 *   160 and 255 against pure red, the result's luminance is monotone across the whole range; the
 *   scale-then-lift form is not.
 *
 * A black replacement falls out of the arithmetic correctly, which is why there is no special case:
 * it has no chroma, so the offset reduces to a pure luminance remap and the source's own hue, which
 * a black region has none of, is the right answer.
 */
export const replaceColorPreservingLuminance = (
  r: number,
  g: number,
  b: number,
  replacementRed: number,
  replacementGreen: number,
  replacementBlue: number
): [number, number, number] => {
  const offset = luminance(r, g, b) - luminance(replacementRed, replacementGreen, replacementBlue);

  return [
    clamp(replacementRed + offset, 0, 255),
    clamp(replacementGreen + offset, 0, 255),
    clamp(replacementBlue + offset, 0, 255),
  ];
};

/** A separable box blur over a per-pixel strength field, with the edges clamped. */
const blurStrength = (strength: Float32Array, width: number, height: number, radius: number): Float32Array => {
  if (radius <= 0) return strength;

  const horizontal = new Float32Array(strength.length);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += strength[y * width + clamp(x + offset, 0, width - 1)];
      }
      horizontal[y * width + x] = sum / window;
    }
  }

  const vertical = new Float32Array(strength.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        sum += horizontal[clamp(y + offset, 0, height - 1) * width + x];
      }
      vertical[y * width + x] = sum / window;
    }
  }

  return vertical;
};

/** The squared distance from a pixel to one segment of the drag's polyline. */
const distanceToSegmentSquared = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return (x - ax) ** 2 + (y - ay) ** 2;

  const t = clamp(((x - ax) * dx + (y - ay) * dy) / lengthSquared, 0, 1);

  return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2;
};

/**
 * The per-pixel replacement strength the drag's geometry alone produces, before any colour test:
 * a soft disc of radius `lineWidth` swept along the polyline, unioned across the segments by
 * `Math.max` so an overlapping stamp cannot compound the way a `source-over` accumulation would.
 */
export const createStrokeCoverage = (
  width: number,
  height: number,
  points: Point[],
  lineWidth: number
): Float32Array => {
  const coverage = new Float32Array(width * height);

  const radius = Math.max(1, Math.min(Number.isFinite(lineWidth) ? lineWidth : 1, 1024));
  const core = radius * COVERAGE_CORE_RATIO;
  const coreSquared = core * core;
  const outerSquared = radius * radius;
  const falloff = radius - core;

  const stamp = (ax: number, ay: number, bx: number, by: number) => {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const distanceSquared = distanceToSegmentSquared(x + 0.5, y + 0.5, ax, ay, bx, by);
        if (distanceSquared > outerSquared) continue;

        const strength = distanceSquared <= coreSquared ? 1 : 1 - (Math.sqrt(distanceSquared) - core) / (falloff || 1);
        const index = y * width + x;
        if (strength > coverage[index]) coverage[index] = strength;
      }
    }
  };

  const [first, ...rest] = points;
  if (!first) return coverage;

  let previous = first;
  stamp(previous.x, previous.y, previous.x, previous.y);
  for (const point of rest) {
    stamp(previous.x, previous.y, point.x, point.y);
    previous = point;
  }

  return coverage;
};

export type ColorReplacementPlan = {
  /**
   * Replacement strength, 0..1, per pixel. Pixels outside the replaced region and pixels inside it
   * that the Smoothness pass feathered to nothing are both 0.
   */
  strength: Float32Array;
  /** How many pixels carry any strength at all. 0 means the drag changed nothing. */
  changedPixelCount: number;
};

/**
 * Everything the commit needs, computed from the source pixels and the args alone, so the tool
 * area can ask "would this change anything?" before it writes a `TOOL_ACTION` and the processor
 * can refuse the same question without a second opinion.
 *
 * Returns null — not an all-zero plan — when the gesture is not a replacement at all: no sample
 * yet, or no point under the brush. `ColorReplacementToolArea` turns that into no history entry
 * whatsoever, which is the rule `FillToolArea` already follows for a flood fill that matched
 * nothing.
 */
export const createColorReplacementPlan = (
  imageData: ImageData,
  args: ColorReplacementToolArgs
): ColorReplacementPlan | null => {
  const { data, width, height } = imageData;
  if (width <= 0 || height <= 0) return null;

  const sampleColor = args.sampleColor;
  const points = args.points ?? [];
  if (!sampleColor || points.length === 0) return null;

  const contiguous = args.limits !== 'discontinuous';
  const coverage = createStrokeCoverage(width, height, points, args.lineWidth);

  // The colour predicate, shared by both Limits modes. RGB only, and a squared distance: a pixel
  // identical in r, g and b is inside the region whatever its alpha, exactly as
  // `createFloodFillMask` decides, and a multi-megapixel stroke pays no `Math.sqrt`.
  const distanceSquared = toleranceDistanceSquared(args.tolerance);
  const matchMask = new Uint8Array(width * height);
  const seedIndexes: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const dataIndex = index * 4;
      const dr = data[dataIndex] - sampleColor.r;
      const dg = data[dataIndex + 1] - sampleColor.g;
      const db = data[dataIndex + 2] - sampleColor.b;

      if (dr * dr + dg * dg + db * db > distanceSquared) continue;

      matchMask[index] = 1;
      // A seed is a matching pixel the brush actually reached. Contiguous floods OUT from these,
      // which is what makes a one-pixel drag recolour a whole garment.
      if (coverage[index] > 0) seedIndexes.push(index);
    }
  }

  if (seedIndexes.length === 0) return null;

  const strength = new Float32Array(width * height);
  /**
   * Which pixels are ELIGIBLE to be substituted at all: a colour match, and for Discontinuous also
   * under the brush. The Smoothness pass blurs a whole field, so without this gate it would carry
   * the substitution out past the region's edge and tint pixels of a colour the user never asked to
   * replace — a 10-pixel Match would bleed onto the 12th. The gate is what makes Smoothness a
   * feather of the edge the user can see rather than an expansion of the region.
   */
  const eligible = new Uint8Array(width * height);

  if (!contiguous) {
    // Discontinuous: exactly the matching pixels under the brush, at the brush's own falloff.
    for (const index of seedIndexes) {
      strength[index] = coverage[index];
      eligible[index] = 1;
    }
  } else {
    // Contiguous: the union of every connected matching region the stroke touches. The flood is
    // the tested one, `createFloodFillMask`, handed the same 0-255 tolerance that yields the
    // `matchMask` above — and it is called per distinct region the stroke reaches, because it
    // takes a single seed, so a drag across one flat area costs one call rather than one per pixel.
    let regionCount = 0;

    for (const seedIndex of seedIndexes) {
      if (eligible[seedIndex]) continue;

      const x = seedIndex % width;
      const y = Math.floor(seedIndex / width);
      const region = createFloodFillMask(
        imageData,
        { x, y },
        {
          tolerance: args.tolerance * COLOR_REPLACEMENT_TOLERANCE_TO_FILL_TOLERANCE_SCALE,
          contiguous: true,
        }
      );
      if (!region) continue;

      regionCount += 1;
      for (let index = 0; index < eligible.length; index++) {
        if (region.mask[index]) {
          eligible[index] = 1;
          strength[index] = 1;
        }
      }
    }

    if (regionCount === 0) return null;
  }

  // Smoothness over whatever each mode produced, so it feathers the edge the user can actually
  // see: the brush's rim under Discontinuous, the region's boundary under Contiguous.
  const blurred = blurStrength(strength, width, height, smoothnessRadius(args.smoothness));

  let changedPixelCount = 0;
  for (let index = 0; index < blurred.length; index++) {
    // `Math.min` is what stops a sum of overlapping ones exceeding 1 at a seam.
    blurred[index] = eligible[index] ? Math.min(1, blurred[index]) : 0;
    if (blurred[index] > 0) changedPixelCount += 1;
  }

  if (changedPixelCount === 0) return null;

  return { strength: blurred, changedPixelCount };
};

/**
 * Read `bitmap` back at `size`. The same read `src/tools/fill.ts:59-66` performs, and null when the
 * environment cannot supply pixels — which is the read-back refusal, not an error: a tool that
 * cannot read its own destination must change nothing rather than blank what it cannot see.
 */
export const readLayerImageData = (bitmap: BitmapSource, size: Size): ImageData | null => {
  if (size.width <= 0 || size.height <= 0) return null;

  const sourceCanvas = new OffscreenCanvas(size.width, size.height);
  const context = sourceCanvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!context || typeof context.getImageData !== 'function') return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  return context.getImageData(0, 0, size.width, size.height);
};

/**
 * The pixel at `point`, or null outside the image. The click half of the interaction: the user
 * chooses the colour to replace, and this is where it is read.
 */
export const samplePixelAt = (imageData: ImageData, point: Point): RgbaColor | null => {
  const { data, width, height } = imageData;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return null;

  const dataIndex = (y * width + x) * 4;

  return { r: data[dataIndex], g: data[dataIndex + 1], b: data[dataIndex + 2], a: data[dataIndex + 3] };
};

/**
 * Writes the plan into a copy of the layer's pixels.
 *
 * `Opacity` is the strength of the substitution, not a canvas `globalAlpha`: a partially replaced
 * pixel keeps part of its ORIGINAL colour, and because the substitution preserves luminance, a
 * 50% replacement is a half-tint of the same shading rather than a half-transparent wash of a
 * solid. Exported so a test can assert the arithmetic on real `ImageData` without a canvas.
 */
export const applyColorReplacementPlan = (
  imageData: ImageData,
  plan: ColorReplacementPlan,
  args: ColorReplacementToolArgs
): ImageData => {
  const { data } = imageData;
  const [replacementRed, replacementGreen, replacementBlue] = parseHexColor(args.color);
  const alpha = clamp(Number.isFinite(args.alpha) ? args.alpha : 1, 0, 1);

  for (let index = 0; index < plan.strength.length; index++) {
    const strength = plan.strength[index];
    if (strength <= 0) continue;

    const dataIndex = index * 4;
    const red = data[dataIndex];
    const green = data[dataIndex + 1];
    const blue = data[dataIndex + 2];

    const [replacedRed, replacedGreen, replacedBlue] = replaceColorPreservingLuminance(
      red,
      green,
      blue,
      replacementRed,
      replacementGreen,
      replacementBlue
    );
    const blend = strength * alpha;

    data[dataIndex] = Math.round(replacedRed * blend + red * (1 - blend));
    data[dataIndex + 1] = Math.round(replacedGreen * blend + green * (1 - blend));
    data[dataIndex + 2] = Math.round(replacedBlue * blend + blue * (1 - blend));
    // The pixel is a substitution, not an erasure: its own alpha is the source's alpha, and a
    // partially transparent layer stays partially transparent.
  }

  return imageData;
};

/**
 * The processor. `commit: 'raster'` REPLACES the active layer's pixels with the canvas returned
 * here, so the whole layer is drawn back and only the replaced region differs.
 *
 * The same shape as `src/tools/fill.ts`'s `fillLayer`, and for the same reason: a fill that
 * matched nothing is a no-op on the layer rather than a blanking of it. `changedPixelCount` is the
 * check — a plan of null is not enough on its own, because Smoothness can reduce a real plan to
 * nothing.
 */
export const colorReplacement =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult => {
    const { size } = params;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    // No source bitmap means the `createLayerFromTool` path: a brand-new layer with nothing to
    // replace, so the answer is an empty canvas of the right size.
    if (!('bitmap' in params) || !params.bitmap) return [canvas];

    const replacementArgs = args as unknown as ColorReplacementToolArgs;
    const imageData = readLayerImageData(params.bitmap, size);

    if (!imageData) {
      ctx.drawImage(params.bitmap, 0, 0, size.width, size.height);
      return [canvas];
    }

    const plan = createColorReplacementPlan(imageData, replacementArgs);

    if (plan) applyColorReplacementPlan(imageData, plan, replacementArgs);

    ctx.putImageData(imageData, 0, 0);

    return [canvas];
  };
