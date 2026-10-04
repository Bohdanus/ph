import { vi } from 'vitest';

/**
 * A PIXEL-CAPABLE `OffscreenCanvas` for tests that have to see a colour.
 *
 * The repo's own mocks deliberately cannot help here. `src/test/setup.ts` installs a
 * globally registered context with NO `getImageData`/`putImageData`, because production code
 * branches on `typeof ctx.getImageData === 'function'` to detect a reduced environment, and
 * `src/__tests__/fixtures/canvas.ts` seeds `fillStyle: ''`. Both are right — and both are why
 * the invisible-fill and 13%-haze defects survived: a test that only asserts
 * `expect(ctx.stroke).toHaveBeenCalled()` cannot see a colour, and cannot see a tolerance that
 * admits the wrong pixels.
 *
 * This double keeps a real `Uint8ClampedArray` and implements the read/write calls a
 * pixel-reading tool actually makes, so a test can assert on numbers. `drawImage` accepts any
 * source carrying `.pixels` (see `PixelBitmap`), which is how a synthetic layer is handed to a
 * processor.
 *
 * WHAT IS REAL AND WHAT IS RECORDED. Everything a document's pixels are made of is real here:
 * `fillRect`, `clearRect`, `putImageData` at an offset, and `drawImage` under
 * `globalAlpha`/`source-over` with a full affine transform. Two things are NOT modelled, and a
 * test that compares pixels across them is comparing nothing:
 *
 * 1. `ctx.filter` is RECORDED (`filterAssignments`), never applied. jsdom has no filter
 *    pipeline, so a blurred or desaturated draw lands identical to an unfiltered one and every
 *    comparison across a filter is a tautology.
 * 2. GLYPHS AND PATHS ARE RECORDED, never rasterised. `fillText`, `stroke` and `fill` append to
 *    `recordedMarks` and change no pixel, because a real glyph rasteriser does not exist in
 *    jsdom. `measureText` returns a deterministic ESTIMATE, which is enough for a layout that
 *    only needs a number and is identical on every caller.
 *
 * An affine transform is sampled NEAREST-NEIGHBOUR. A browser resamples with filtering, so
 * this double proves that two paths agree on WHERE a transform puts a pixel, never that they
 * agree on the resampled colour across an edge. That limit is the reason a nearest-neighbour
 * double is the right one here rather than a bilinear one: a faithful resampler would make the
 * harness agree with itself about an edge neither engine produces here.
 */
export type PixelBitmap = { width: number; height: number; pixels: Uint8ClampedArray };

/** `[a, b, c, d, e, f]`, mapping USER space to DEVICE space, as `CanvasRenderingContext2D` does. */
type PixelMatrix = readonly [number, number, number, number, number, number];
/** Straight (non-premultiplied) RGBA, 0-255. */
type PixelRgba = readonly [number, number, number, number];

const IDENTITY_MATRIX: PixelMatrix = [1, 0, 0, 1, 0, 0];

const multiplyMatrices = (outer: PixelMatrix, inner: PixelMatrix): PixelMatrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];

const invertMatrix = (matrix: PixelMatrix): PixelMatrix | null => {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ];
};

const applyMatrix = (matrix: PixelMatrix, x: number, y: number) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

const clampChannel = (value: number): number => (Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : 0);
const clampUnit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const NAMED_COLORS: Readonly<Record<string, PixelRgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
};

/**
 * Reads a CSS colour as straight RGBA.
 *
 * An unparseable value becomes opaque black rather than throwing: production assigns
 * `fillStyle` from document data, and a double whose job is to observe what a draw produced
 * must not be the thing that refuses the draw. Anything that reads a colour here can see black,
 * which is a visible difference rather than a silent one.
 */
export const parsePixelColor = (value: unknown): PixelRgba => {
  if (Array.isArray(value)) {
    const [r = 0, g = 0, b = 0, a = 255] = value as number[];
    return [clampChannel(r), clampChannel(g), clampChannel(b), Math.round(clampUnit(a / 255) * 255)];
  }
  if (typeof value !== 'string') return [0, 0, 0, 255];
  const text = value.trim().toLowerCase();
  if (text in NAMED_COLORS) return NAMED_COLORS[text];

  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    const digits = hex[1];
    const expand = (part: string) => Number.parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return [expand(digits[0]), expand(digits[1]), expand(digits[2]), digits.length === 4 ? expand(digits[3]) : 255];
    }
    if (digits.length === 6 || digits.length === 8) {
      return [
        Number.parseInt(digits.slice(0, 2), 16),
        Number.parseInt(digits.slice(2, 4), 16),
        Number.parseInt(digits.slice(4, 6), 16),
        digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) : 255,
      ];
    }
  }

  const functional = /^rgba?\(([^)]*)\)$/.exec(text);
  if (functional) {
    const parts = functional[1].split(',').map((part) => Number.parseFloat(part.trim()));
    const [r = 0, g = 0, b = 0] = parts;
    const alpha = parts.length > 3 ? (parts[3] as number) : 1;
    return [clampChannel(r), clampChannel(g), clampChannel(b), Math.round(clampUnit(alpha) * 255)];
  }
  return [0, 0, 0, 255];
};

const finiteDimension = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.ceil(parsed)) : fallback;
};

/** The buffer a drawable source carries, whatever shape it carries it in. */
type PixelSourceRaster = { pixels: Uint8ClampedArray; width: number; height: number };

/**
 * Resolves any `drawImage` source: a `PixelBitmap` carrier, a `PixelCanvas`, an
 * `HTMLCanvasElement` behind the pixel stub, or a `PixelContext`.
 *
 * A source that resolves to nothing contributes nothing, which is what a browser does with a
 * source it cannot decode. A throw here would instead make the harness the failure.
 */
const rasterOf = (source: unknown): PixelSourceRaster | null => {
  if (!source || typeof source !== 'object') return null;
  const candidate = source as {
    pixels?: unknown;
    width?: unknown;
    height?: unknown;
    getContext?: (kind: string) => { pixels?: unknown; width?: unknown; height?: unknown } | null;
  };
  if (candidate.pixels instanceof Uint8ClampedArray) {
    const width = finiteDimension(candidate.width, Math.sqrt(candidate.pixels.length / 4) || 1);
    const height = finiteDimension(candidate.height, candidate.pixels.length / 4 / width || 1);
    return { pixels: candidate.pixels, width, height };
  }
  if (typeof candidate.getContext !== 'function') return null;
  let context: { pixels?: unknown; width?: unknown; height?: unknown } | null;
  try {
    context = candidate.getContext('2d');
  } catch {
    return null;
  }
  if (!context || !(context.pixels instanceof Uint8ClampedArray)) return null;
  const width = finiteDimension(candidate.width, finiteDimension(context.width, 1));
  const height = finiteDimension(candidate.height, finiteDimension(context.height, 1));
  return { pixels: context.pixels, width, height };
};

/**
 * An `ImageBitmap`-shaped carrier that OWNS its buffer.
 *
 * `close()` zeroes the buffer rather than dropping the reference, so a bitmap used after its
 * owner released it reads as transparent instead of reading as whatever the allocator left
 * behind. `AssetRegistry.sourceType()` classifies anything with a `close` as an `image-bitmap`,
 * which is what a test that hands it a synthetic raster wants.
 */
export const ownedBitmapFrom = (imageData: ImageData): ImageBitmap => {
  const pixels = new Uint8ClampedArray(imageData.data);
  return {
    width: imageData.width,
    height: imageData.height,
    pixels,
    close: () => pixels.fill(0),
  } as unknown as ImageBitmap;
};

export class PixelContext {
  pixels: Uint8ClampedArray;
  private ownWidth: number;
  private ownHeight: number;
  private host: { width: number; height: number } | null = null;
  private matrix: PixelMatrix = IDENTITY_MATRIX;

  /** Every string assigned to `filter`, in order. Never applied — see the module comment. */
  readonly filterAssignments: string[] = [];
  /** Every glyph and path call, in order. Never rasterised — see the module comment. */
  readonly recordedMarks: string[] = [];

  imageSmoothingEnabled = true;
  imageSmoothingQuality: ImageSmoothingQuality = 'high';

  // `erasableSyntaxOnly` forbids parameter properties, so the fields are declared and assigned
  // rather than folded into the signature — and the assignment must be in the BODY, not a field
  // initialiser. A field initialiser that reads `this.width` runs before the constructor has
  // assigned it, and `Math.ceil(undefined)` is NaN, which `Math.max(1, NaN)` turns into a NaN
  // canvas size and `new Uint8ClampedArray(NaN * NaN * 4)` into a zero-length buffer. Every
  // read-back would then return zeros and every assertion would pass against nothing.
  constructor(width: number, height: number) {
    this.ownWidth = Math.max(1, Math.ceil(width));
    this.ownHeight = Math.max(1, Math.ceil(height));
    this.pixels = new Uint8ClampedArray(this.ownWidth * this.ownHeight * 4);
  }

  /**
   * Binds the context to a host whose `width`/`height` it follows.
   *
   * A canvas resize is observable here, and observably a RESET: assigning `width` or `height`
   * empties the buffer and restores the identity transform, which is the fact
   * `layer-renderer.ts` — `restoreVisibleCanvas()` is built on. A context that ignored its
   * host would keep the old pixels and apply a transform to a surface that no longer has them.
   */
  attachHost(host: { width: number; height: number }): this {
    this.host = host;
    this.syncToHost();
    return this;
  }

  private syncToHost(): void {
    if (!this.host) return;
    const width = Math.max(1, Math.ceil(this.host.width));
    const height = Math.max(1, Math.ceil(this.host.height));
    if (width === this.ownWidth && height === this.ownHeight) return;
    this.ownWidth = width;
    this.ownHeight = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.matrix = IDENTITY_MATRIX;
  }

  get width(): number {
    this.syncToHost();
    return this.ownWidth;
  }

  get height(): number {
    this.syncToHost();
    return this.ownHeight;
  }

  // --- presentation state -----------------------------------------------------------------------------

  get globalAlpha(): number {
    return this.alphaValue;
  }

  set globalAlpha(value: number) {
    this.alphaValue = clampUnit(Number(value));
  }

  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.compositeValue;
  }

  set globalCompositeOperation(value: GlobalCompositeOperation) {
    // Only `source-over` blends here. A mode this double cannot composite is recorded and
    // treated as `source-over`, so a document that asks for `multiply` still produces a
    // comparable surface instead of an exception; the harness compares placement, not blend.
    this.compositeValue = value;
  }

  get filter(): string {
    return this.filterValue;
  }

  set filter(value: string) {
    this.filterValue = typeof value === 'string' ? value : 'none';
    this.filterAssignments.push(this.filterValue);
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.fillStyleValue;
  }

  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.fillStyleValue = typeof value === 'string' ? value : '#000000';
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.strokeStyleValue;
  }

  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.strokeStyleValue = typeof value === 'string' ? value : '#000000';
  }

  strokeStyleValue = '#000000';
  private fillStyleValue = '#000000';
  private alphaValue = 1;
  private compositeValue: GlobalCompositeOperation = 'source-over';
  private filterValue = 'none';

  lineWidth = 1;
  lineCap: CanvasLineCap = 'butt';
  lineJoin: CanvasLineJoin = 'miter';
  miterLimit = 10;
  lineDashOffset = 0;
  font = '10px sans-serif';
  fontVariantCaps = 'normal';
  letterSpacing = '0px';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  direction: CanvasDirection = 'inherit';
  shadowBlur = 0;
  shadowColor = 'rgba(0, 0, 0, 0)';
  shadowOffsetX = 0;
  shadowOffsetY = 0;

  // --- transform --------------------------------------------------------------------------------------

  save(): void {
    this.stack.push({
      matrix: this.matrix,
      alpha: this.alphaValue,
      composite: this.compositeValue,
      filter: this.filterValue,
      fillStyle: this.fillStyleValue,
      strokeStyle: this.strokeStyleValue,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      miterLimit: this.miterLimit,
      lineDashOffset: this.lineDashOffset,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      direction: this.direction,
    });
  }

  restore(): void {
    const state = this.stack.pop();
    if (!state) return;
    this.matrix = state.matrix;
    this.alphaValue = state.alpha;
    this.compositeValue = state.composite;
    this.filterValue = state.filter;
    this.fillStyleValue = state.fillStyle;
    this.strokeStyleValue = state.strokeStyle;
    this.lineWidth = state.lineWidth;
    this.lineCap = state.lineCap;
    this.lineJoin = state.lineJoin;
    this.miterLimit = state.miterLimit;
    this.lineDashOffset = state.lineDashOffset;
    this.font = state.font;
    this.textAlign = state.textAlign;
    this.textBaseline = state.textBaseline;
    this.direction = state.direction;
  }

  translate(x: number, y: number): void {
    this.matrix = multiplyMatrices(this.matrix, [1, 0, 0, 1, Number(x), Number(y)]);
  }

  scale(x: number, y: number): void {
    this.matrix = multiplyMatrices(this.matrix, [Number(x), 0, 0, Number(y), 0, 0]);
  }

  rotate(angle: number): void {
    const radians = Number(angle);
    this.matrix = multiplyMatrices(this.matrix, [
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
      0,
      0,
    ]);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = multiplyMatrices(this.matrix, [Number(a), Number(b), Number(c), Number(d), Number(e), Number(f)]);
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [Number(a), Number(b), Number(c), Number(d), Number(e), Number(f)];
  }

  resetTransform(): void {
    this.matrix = IDENTITY_MATRIX;
  }

  private readonly stack: Array<{
    matrix: PixelMatrix;
    alpha: number;
    composite: GlobalCompositeOperation;
    filter: string;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    miterLimit: number;
    lineDashOffset: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    direction: CanvasDirection;
  }> = [];

  // --- pixels -----------------------------------------------------------------------------------------

  /** Source-over of one straight-RGBA source pixel onto this buffer. */
  private blendPixel(index: number, red: number, green: number, blue: number, sourceAlpha: number): void {
    if (sourceAlpha <= 0) return;
    const pixels = this.pixels;
    if (index < 0 || index + 3 >= pixels.length) return;
    const destinationAlpha = pixels[index + 3] / 255;
    const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    if (outAlpha <= 0) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = 0;
      return;
    }
    const keep = (destinationAlpha * (1 - sourceAlpha)) / outAlpha;
    const take = sourceAlpha / outAlpha;
    pixels[index] = red * take + pixels[index] * keep;
    pixels[index + 1] = green * take + pixels[index + 1] * keep;
    pixels[index + 2] = blue * take + pixels[index + 2] * keep;
    pixels[index + 3] = outAlpha * 255;
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.fillRectRaw(x, y, width, height, 0, 0, 0, 0);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.syncToHost();
    const [red, green, blue, alpha] = parsePixelColor(this.fillStyleValue);
    this.fillRectRaw(x, y, width, height, red, green, blue, (alpha / 255) * this.alphaValue);
  }

  private fillRectRaw(
    x: number,
    y: number,
    width: number,
    height: number,
    red: number,
    green: number,
    blue: number,
    alpha: number
  ): void {
    this.syncToHost();
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.ownWidth, Math.ceil(x + width));
    const bottom = Math.min(this.ownHeight, Math.ceil(y + height));
    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) {
        this.blendPixel((row * this.ownWidth + column) * 4, red, green, blue, alpha);
      }
    }
  }

  drawImage(source: unknown, ...args: number[]): void {
    this.syncToHost();
    const raster = rasterOf(source);
    if (!raster) return;

    const { sx, sy, sw, sh, dx, dy, dw, dh } = this.drawImageRect(args, raster);
    if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return;

    const inverse = invertMatrix(this.matrix);
    if (!inverse) return;

    const corners = [
      applyMatrix(this.matrix, dx, dy),
      applyMatrix(this.matrix, dx + dw, dy),
      applyMatrix(this.matrix, dx + dw, dy + dh),
      applyMatrix(this.matrix, dx, dy + dh),
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.x))));
    const maxX = Math.min(this.ownWidth, Math.ceil(Math.max(...corners.map((corner) => corner.x))));
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.y))));
    const maxY = Math.min(this.ownHeight, Math.ceil(Math.max(...corners.map((corner) => corner.y))));
    if (minX >= maxX || minY >= maxY) return;

    const alpha = this.alphaValue;
    const scaleX = sw / dw;
    const scaleY = sh / dh;
    const identity = this.matrix.every((value, index) => value === IDENTITY_MATRIX[index]);

    for (let row = minY; row < maxY; row += 1) {
      for (let column = minX; column < maxX; column += 1) {
        let u: number;
        let v: number;
        if (identity) {
          u = dx + (column + 0.5 - dx);
          v = dy + (row + 0.5 - dy);
        } else {
          const user = applyMatrix(inverse, column + 0.5, row + 0.5);
          u = user.x;
          v = user.y;
        }
        const sourceX = Math.floor(sx + (u - dx) * scaleX);
        const sourceY = Math.floor(sy + (v - dy) * scaleY);
        if (sourceX < 0 || sourceY < 0 || sourceX >= raster.width || sourceY >= raster.height) continue;
        const from = (sourceY * raster.width + sourceX) * 4;
        this.blendPixel(
          (row * this.ownWidth + column) * 4,
          raster.pixels[from],
          raster.pixels[from + 1],
          raster.pixels[from + 2],
          (raster.pixels[from + 3] / 255) * alpha
        );
      }
    }
  }

  private drawImageRect(
    args: readonly number[],
    raster: PixelSourceRaster
  ): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
    switch (args.length) {
      case 0:
        return { sx: 0, sy: 0, sw: raster.width, sh: raster.height, dx: 0, dy: 0, dw: raster.width, dh: raster.height };
      case 2:
        return {
          sx: 0,
          sy: 0,
          sw: raster.width,
          sh: raster.height,
          dx: args[0],
          dy: args[1],
          dw: raster.width,
          dh: raster.height,
        };
      case 4:
        return {
          sx: 0,
          sy: 0,
          sw: raster.width,
          sh: raster.height,
          dx: args[0],
          dy: args[1],
          dw: args[2],
          dh: args[3],
        };
      case 8:
        return {
          sx: args[0],
          sy: args[1],
          sw: args[2],
          sh: args[3],
          dx: args[4],
          dy: args[5],
          dw: args[6],
          dh: args[7],
        };
      default:
        throw new Error(`PixelContext.drawImage received ${args.length} numbers; it implements 0, 2, 4 and 8`);
    }
  }

  getImageData(x: number, y: number, width: number, height: number): ImageData {
    this.syncToHost();
    const out = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const from = ((y + row) * this.ownWidth + (x + column)) * 4;
        const to = (row * width + column) * 4;
        if (from < 0 || from + 3 >= this.pixels.length) continue;
        out[to] = this.pixels[from];
        out[to + 1] = this.pixels[from + 1];
        out[to + 2] = this.pixels[from + 2];
        out[to + 3] = this.pixels[from + 3];
      }
    }
    return { data: out, width, height, colorSpace: 'srgb' } as unknown as ImageData;
  }

  putImageData(imageData: ImageData, dx = 0, dy = 0): void {
    this.syncToHost();
    for (let row = 0; row < imageData.height; row += 1) {
      for (let column = 0; column < imageData.width; column += 1) {
        const targetX = dx + column;
        const targetY = dy + row;
        if (targetX < 0 || targetY < 0 || targetX >= this.ownWidth || targetY >= this.ownHeight) continue;
        const from = (row * imageData.width + column) * 4;
        const to = (targetY * this.ownWidth + targetX) * 4;
        this.pixels[to] = imageData.data[from];
        this.pixels[to + 1] = imageData.data[from + 1];
        this.pixels[to + 2] = imageData.data[from + 2];
        this.pixels[to + 3] = imageData.data[from + 3];
      }
    }
  }

  createImageData(width: number, height: number): ImageData {
    const safeWidth = Math.max(0, Math.ceil(width));
    const safeHeight = Math.max(0, Math.ceil(height));
    return {
      data: new Uint8ClampedArray(safeWidth * safeHeight * 4),
      width: safeWidth,
      height: safeHeight,
      colorSpace: 'srgb',
    } as unknown as ImageData;
  }

  // --- recorded, unrasterised -------------------------------------------------------------------------

  private mark(name: string): void {
    this.recordedMarks.push(name);
  }

  beginPath(): void {
    this.mark('beginPath');
  }
  closePath(): void {
    this.mark('closePath');
  }
  moveTo(): void {
    this.mark('moveTo');
  }
  lineTo(): void {
    this.mark('lineTo');
  }
  bezierCurveTo(): void {
    this.mark('bezierCurveTo');
  }
  quadraticCurveTo(): void {
    this.mark('quadraticCurveTo');
  }
  arc(): void {
    this.mark('arc');
  }
  arcTo(): void {
    this.mark('arcTo');
  }
  ellipse(): void {
    this.mark('ellipse');
  }
  rect(): void {
    this.mark('rect');
  }
  roundRect(): void {
    this.mark('roundRect');
  }
  clip(): void {
    this.mark('clip');
  }
  fill(): void {
    this.mark('fill');
  }
  stroke(): void {
    this.mark('stroke');
  }
  fillText(): void {
    this.mark('fillText');
  }
  strokeText(): void {
    this.mark('strokeText');
  }

  setLineDash(): void {
    this.mark('setLineDash');
  }

  getLineDash(): number[] {
    return [];
  }

  /**
   * A deterministic ESTIMATE, not a measurement: `parseFloat` of the px size out of `font`,
   * times the text length. A layout that needs a number gets the same number from every caller,
   * which is what keeps two paths comparable; it is not what a browser would report.
   */
  measureText(text: string): { width: number } {
    const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? '10');
    return { width: (Number.isFinite(size) ? size : 10) * String(text).length * 0.5 };
  }
}

export class PixelCanvas {
  width: number;
  height: number;
  readonly ctx: PixelContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new PixelContext(width, height);
  }

  getContext() {
    return this.ctx;
  }
}

export class PixelOffscreenCanvas {
  width: number;
  height: number;
  readonly ctx: PixelContext;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = new PixelContext(this.width, this.height);
    pixelCanvases.push(this as unknown as PixelCanvas);
  }

  getContext() {
    return this.ctx;
  }

  /**
   * The `transferToImageBitmap()` carrier an `AssetRegistry` adopts.
   *
   * It is a COPY, because transfer empties the source: `asset-registry.ts` —
   * `immutableRasterCopy()` registers the transferred bitmap and the caller keeps drawing on the
   * canvas it came from.
   */
  transferToImageBitmap(): ImageBitmap {
    const pixels = new Uint8ClampedArray(this.ctx.pixels);
    const carrier = {
      width: this.width,
      height: this.height,
      pixels,
      close: () => pixels.fill(0),
    };
    return carrier as unknown as ImageBitmap;
  }
}

/** Every `PixelCanvas` constructed since the last reset, in allocation order. */
export const pixelCanvases: PixelCanvas[] = [];

/** Installs `PixelOffscreenCanvas` as the global, and clears the instance log. */
export const stubPixelOffscreenCanvas = () => {
  pixelCanvases.length = 0;
  vi.stubGlobal('OffscreenCanvas', PixelOffscreenCanvas as unknown as typeof OffscreenCanvas);
};

/** The `PixelContext` behind each element the pixel stub has handed out, for a test to read back. */
export const pixelHtmlCanvasContexts = new WeakMap<HTMLCanvasElement, PixelContext>();

/**
 * A snapshot of whatever pixels a drawable source carries, or `null` when it carries none.
 *
 * A test that compares a durable composition against a legacy render is holding two values
 * neither of which is an `ImageData`: one is a registry-owned carrier, the other an element's
 * context. This is the one place that resolves either, so a comparator reads bytes instead of
 * reaching into three shapes itself.
 */
export const readPixelSource = (source: unknown): { data: Uint8ClampedArray; width: number; height: number } | null => {
  const raster = rasterOf(source);
  if (!raster) return null;
  return {
    data: new Uint8ClampedArray(raster.pixels),
    width: raster.width,
    height: raster.height,
  };
};

/**
 * Makes `document.createElement('canvas')` produce a PIXEL surface.
 *
 * `renderExportCanvas()` and `drawLayersToCanvas()` both build their surfaces through
 * `document.createElement`, and `src/test/setup.ts` installs a globally registered context with
 * no `getImageData` — correct for the tests that assert calls, fatal for one that has to read a
 * colour. A `WeakMap` rather than a fresh context per call because a canvas returns the SAME
 * context every time, and `drawLayersToCanvas()` relies on that: it draws into a context it
 * fetched BEFORE the resize it then performs.
 *
 * Returns the installed spy so a caller can restore it. Call it after `src/test/setup.ts`'s own
 * `beforeEach`, which re-installs its stub on every test.
 */
export const installPixelCanvasElement = () =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement,
    contextId: string
  ) {
    if (contextId !== '2d') return null;
    const existing = pixelHtmlCanvasContexts.get(this);
    if (existing) return existing as unknown as CanvasRenderingContext2D;
    const context = new PixelContext(this.width, this.height).attachHost(this);
    pixelHtmlCanvasContexts.set(this, context);
    return context as unknown as CanvasRenderingContext2D;
  });

/** An opaque `ImageData` from `[x, y, r, g, b]` rows; unlisted pixels are opaque magenta. */
export const imageDataFrom = (
  width: number,
  height: number,
  rows: readonly (readonly [number, number, number, number, number])[]
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 0;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  for (const [x, y, r, g, b] of rows) {
    const index = (y * width + x) * 4;
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as unknown as ImageData;
};

/**
 * A solid field of one colour, `size`×`size`, with `over` painted LAST so a caller can carve
 * differently-coloured pixels out of it. The order matters: an `over` row written first is
 * overwritten by the field, and every assertion about an untouched pixel then passes against a
 * colour that was never there.
 */
export const fieldOf = (
  size: number,
  colour: readonly [number, number, number],
  over: readonly (readonly [number, number, number, number, number])[] = []
) => {
  const rows: (readonly [number, number, number, number, number])[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) rows.push([x, y, colour[0], colour[1], colour[2]]);
  }
  rows.push(...over);
  return imageDataFrom(size, size, rows);
};

export const pixelAt = (imageData: ImageData, x: number, y: number) => {
  const index = (y * imageData.width + x) * 4;

  return [imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]] as const;
};

export const luminanceOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** A `BitmapSource`-shaped carrier for a synthetic layer, for `drawImage` to copy. */
export const bitmapFrom = (imageData: ImageData) =>
  ({
    width: imageData.width,
    height: imageData.height,
    pixels: imageData.data,
  }) as unknown as ImageBitmap;
