import type { Point, Pos, Size } from './general-types.ts';
import type { Layer } from './layer-types.ts';
import type { TransformToolArgs } from '../tools/transform.ts';

/**
 * Canvas-compatible affine matrix. It maps (x, y) to:
 *
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 *
 * Matrices are layer-local. Layer.pos remains the world-space rectangle of
 * the untransformed source and document-frame translation happens afterwards.
 */
export type AffineTransform = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export const IDENTITY_AFFINE_TRANSFORM: AffineTransform = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
});

export const AFFINE_DETERMINANT_EPSILON = 1e-8;
export const MAX_AFFINE_COORDINATE = 1_000_000;
export const MAX_AFFINE_PIXELS = 64 * 1024 * 1024;

function freezeTransform(transform: AffineTransform): AffineTransform {
  return Object.freeze({
    a: transform.a,
    b: transform.b,
    c: transform.c,
    d: transform.d,
    e: transform.e,
    f: transform.f,
  });
}

export function isIdentityAffineTransform(transform: AffineTransform, epsilon = 1e-10): boolean {
  return (
    Math.abs(transform.a - 1) <= epsilon &&
    Math.abs(transform.b) <= epsilon &&
    Math.abs(transform.c) <= epsilon &&
    Math.abs(transform.d - 1) <= epsilon &&
    Math.abs(transform.e) <= epsilon &&
    Math.abs(transform.f) <= epsilon
  );
}

/** Returns left * right using the canvas matrix convention above. */
export function multiplyAffineTransforms(left: AffineTransform, right: AffineTransform): AffineTransform {
  return freezeTransform({
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  });
}

/** Converts a document-space transform to the local coordinates of a layer. */
export function documentAffineToLayerLocal(transform: AffineTransform, position: Pos): AffineTransform {
  const toDocument: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: position.x, f: position.y };
  const toLayer: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: -position.x, f: -position.y };
  return multiplyAffineTransforms(toLayer, multiplyAffineTransforms(transform, toDocument));
}

export function applyAffineTransform(transform: AffineTransform, point: Point): Point {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

function rotationComponents(angleRadians: number): Readonly<{ cosine: number; sine: number }> {
  let cosine = Math.cos(angleRadians);
  let sine = Math.sin(angleRadians);
  const halfPi = Math.PI / 2;
  const quarterTurns = Math.round(angleRadians / halfPi);
  if (Number.isSafeInteger(quarterTurns) && angleRadians === quarterTurns * halfPi) {
    // Keep exact quarter-turn bounds on the pixel grid; cos(pi / 2)'s residue can add a phantom pixel.
    switch (((quarterTurns % 4) + 4) % 4) {
      case 0:
        cosine = 1;
        sine = 0;
        break;
      case 1:
        cosine = 0;
        sine = 1;
        break;
      case 2:
        cosine = -1;
        sine = 0;
        break;
      case 3:
        cosine = 0;
        sine = -1;
        break;
    }
  }
  return { cosine, sine };
}

export function rotationAffineAroundPoint(angleRadians: number, center: Point): AffineTransform {
  const { cosine, sine } = rotationComponents(angleRadians);
  return validateAffineTransform({
    a: cosine,
    b: sine,
    c: sine === 0 ? 0 : -sine,
    d: cosine,
    e: center.x - cosine * center.x + sine * center.y,
    f: center.y - sine * center.x - cosine * center.y,
  });
}

export function invertAffineTransform(transform: AffineTransform): AffineTransform | null {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= AFFINE_DETERMINANT_EPSILON) return null;

  const inverse = 1 / determinant;
  return freezeTransform({
    a: transform.d * inverse,
    b: -transform.b * inverse,
    c: -transform.c * inverse,
    d: transform.a * inverse,
    e: (transform.c * transform.f - transform.d * transform.e) * inverse,
    f: (transform.b * transform.e - transform.a * transform.f) * inverse,
  });
}

export function transformCorners(transform: AffineTransform, size: Size): Point[] {
  return [
    applyAffineTransform(transform, { x: 0, y: 0 }),
    applyAffineTransform(transform, { x: size.width, y: 0 }),
    applyAffineTransform(transform, { x: size.width, y: size.height }),
    applyAffineTransform(transform, { x: 0, y: size.height }),
  ];
}

export function getAffineBounds(transform: AffineTransform, size: Size): Pos {
  const corners = transformCorners(transform, size);
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = maxX - x;
  const height = maxY - y;

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Affine transform produced degenerate bounds');
  }
  if (Math.abs(x) > MAX_AFFINE_COORDINATE || Math.abs(y) > MAX_AFFINE_COORDINATE) {
    throw new Error('Affine transform exceeds coordinate limits');
  }
  if (width > MAX_AFFINE_COORDINATE || height > MAX_AFFINE_COORDINATE || width * height > MAX_AFFINE_PIXELS) {
    throw new Error('Affine transform exceeds raster bounds');
  }

  return { x, y, width, height };
}

export function rasterizeBounds(bounds: Pos): Size {
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_AFFINE_COORDINATE ||
    height > MAX_AFFINE_COORDINATE ||
    width * height > MAX_AFFINE_PIXELS
  ) {
    throw new Error('Raster transform exceeds supported bounds');
  }
  return { width, height };
}

export function validateAffineTransform(transform: AffineTransform, size?: Size): AffineTransform {
  const values = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
  if (!values.every(Number.isFinite) || values.some((value) => Math.abs(value) > MAX_AFFINE_COORDINATE)) {
    throw new Error('Affine transform contains invalid or extreme values');
  }

  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= AFFINE_DETERMINANT_EPSILON) {
    throw new Error('Affine transform is singular');
  }

  if (size) getAffineBounds(transform, size);
  return freezeTransform(transform);
}

function aroundCenter(linear: AffineTransform, size: Size): AffineTransform {
  const center = { x: size.width / 2, y: size.height / 2 };
  return freezeTransform({
    ...linear,
    e: center.x - linear.a * center.x - linear.c * center.y,
    f: center.y - linear.b * center.x - linear.d * center.y,
  });
}

/**
 * Converts the UI's normalized transform values into one immutable matrix.
 * The defined order is scale/mirror, then rotation, then skew. Positive
 * rotation is clockwise in the editor's y-down coordinate system. SkewX is
 * x += tan(skewX)*y and SkewY is y += tan(skewY)*x. All operations use the
 * untransformed layer center as their pivot.
 */
export function transformToolArgsToAffine(args: TransformToolArgs, size: Size): AffineTransform | null {
  const rotate = args.rotate ?? 0;
  const skewXDegrees = args.skewX ?? 0;
  const skewYDegrees = args.skewY ?? 0;
  const resizeX = args.resizeX ?? 100;
  const resizeY = args.resizeY ?? 100;
  const trapezoid = args.trapezoid ?? 0;
  const values = [rotate, skewXDegrees, skewYDegrees, resizeX, resizeY, trapezoid];
  if (!values.every((value) => Number.isFinite(value))) throw new Error('Transform values must be finite');
  if (trapezoid !== 0) {
    if (!isTrapezoidOnlyTransform(args)) {
      throw new Error('Trapezoid cannot be combined with retained affine transforms');
    }
    return null;
  }
  if (resizeX === 0 || resizeY === 0) throw new Error('Transform scale cannot be zero');

  const angle = (rotate * Math.PI) / 180;
  const skewX = Math.tan((skewXDegrees * Math.PI) / 180);
  const skewY = Math.tan((skewYDegrees * Math.PI) / 180);
  if (![angle, skewX, skewY].every(Number.isFinite)) throw new Error('Transform angles are too extreme');

  const scale: AffineTransform = {
    a: (args.mirrorH ? -1 : 1) * (resizeX / 100),
    b: 0,
    c: 0,
    d: (args.mirrorV ? -1 : 1) * (resizeY / 100),
    e: 0,
    f: 0,
  };
  const { cosine, sine } = rotationComponents(angle);
  const rotation: AffineTransform = {
    a: cosine,
    b: sine,
    c: sine === 0 ? 0 : -sine,
    d: cosine,
    e: 0,
    f: 0,
  };
  const skew: AffineTransform = { a: 1, b: skewY, c: skewX, d: 1, e: 0, f: 0 };
  const linear = multiplyAffineTransforms(skew, multiplyAffineTransforms(rotation, scale));
  return validateAffineTransform(aroundCenter(linear, size), size);
}

export function isTrapezoidOnlyTransform(args: TransformToolArgs): boolean {
  if (!Number.isFinite(args.trapezoid) || args.trapezoid === 0) return false;
  return (
    (args.rotate ?? 0) === 0 &&
    !args.mirrorH &&
    !args.mirrorV &&
    (args.skewX ?? 0) === 0 &&
    (args.skewY ?? 0) === 0 &&
    (args.resizeX ?? 100) === 100 &&
    (args.resizeY ?? 100) === 100
  );
}

export function getLayerAffineTransform(layer: Layer): AffineTransform {
  let transform = IDENTITY_AFFINE_TRANSFORM;
  for (const operation of layer.operations ?? []) {
    if (operation.kind !== 'affine-transform' || !operation.enabled) continue;
    transform = multiplyAffineTransforms(operation.transform, transform);
  }
  return transform;
}

export function getLayerPresentationCorners(layer: Layer, position: Pos = layer.pos): Point[] {
  const transform = getLayerAffineTransform(layer);
  return transformCorners(transform, { width: position.width, height: position.height }).map((point) => ({
    x: point.x + position.x,
    y: point.y + position.y,
  }));
}

export function getLayerPresentationBounds(layer: Layer, position: Pos = layer.pos): Pos {
  const transform = getLayerAffineTransform(layer);
  const bounds = getAffineBounds(transform, { width: position.width, height: position.height });
  return { x: position.x + bounds.x, y: position.y + bounds.y, width: bounds.width, height: bounds.height };
}

export function worldPointToLayerLocal(layer: Layer, point: Point): Point | null {
  const inverse = invertAffineTransform(getLayerAffineTransform(layer));
  if (!inverse) return null;
  return applyAffineTransform(inverse, { x: point.x - layer.pos.x, y: point.y - layer.pos.y });
}

export function isPointInLayer(layer: Layer, point: Point): boolean {
  const local = worldPointToLayerLocal(layer, point);
  return !!local && local.x >= 0 && local.x <= layer.pos.width && local.y >= 0 && local.y <= layer.pos.height;
}

export type RetainedTransformHistoryArgs = Readonly<{
  toolName: 'transform';
  transform: AffineTransform;
}>;

export function normalizeTransformHistoryArgs(
  args: TransformToolArgs,
  size: Size
): RetainedTransformHistoryArgs | null {
  const transform = transformToolArgsToAffine(args, size);
  return transform ? Object.freeze({ toolName: 'transform', transform }) : null;
}

export function getTransformFromHistoryArgs(args: unknown, size: Size): AffineTransform | null | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const candidate = args as Partial<RetainedTransformHistoryArgs> & Partial<TransformToolArgs>;
  if (candidate.transform) return validateAffineTransform(candidate.transform, size);
  if (candidate.toolName === 'transform') return transformToolArgsToAffine(candidate as TransformToolArgs, size);
  return undefined;
}
