import type { Point } from '../contexts/general-types.ts';

export const HOMOGRAPHY_RELATIVE_EPSILON = 1e-12;
export const HOMOGRAPHY_TOLERANCE = 1e-6;
export const HOMOGRAPHY_CORRESPONDENCE_COUNT = 4;

export type Homography = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
  i: number;
}>;

export type HomographyDerivatives = Readonly<{
  u: number;
  v: number;
  denominator: number;
  duDx: number;
  duDy: number;
  dvDx: number;
  dvDy: number;
}>;

export const IDENTITY_HOMOGRAPHY: Homography = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 0,
  e: 1,
  f: 0,
  g: 0,
  h: 0,
  i: 1,
});

export function homographyDeterminant(matrix: Homography): number {
  return (
    matrix.a * (matrix.e * matrix.i - matrix.f * matrix.h) -
    matrix.b * (matrix.d * matrix.i - matrix.f * matrix.g) +
    matrix.c * (matrix.d * matrix.h - matrix.e * matrix.g)
  );
}

export function homographyMagnitude(matrix: Homography): number {
  return Math.max(
    Math.abs(matrix.a),
    Math.abs(matrix.b),
    Math.abs(matrix.c),
    Math.abs(matrix.d),
    Math.abs(matrix.e),
    Math.abs(matrix.f),
    Math.abs(matrix.g),
    Math.abs(matrix.h),
    Math.abs(matrix.i)
  );
}

export function isInvertibleHomography(matrix: Homography): boolean {
  const determinant = homographyDeterminant(matrix);
  const magnitude = homographyMagnitude(matrix);
  if (!Number.isFinite(determinant) || !Number.isFinite(magnitude) || magnitude === 0) return false;
  return Math.abs(determinant) > HOMOGRAPHY_RELATIVE_EPSILON * magnitude * magnitude * magnitude;
}

export function applyHomography(matrix: Homography, point: Point): Point | null {
  const derivatives = differentiateHomography(matrix, point);
  if (!derivatives) return null;
  return { x: derivatives.u, y: derivatives.v };
}

const DENOMINATOR_EPSILON = 1e-12;

export function differentiateHomography(matrix: Homography, point: Point): HomographyDerivatives | null {
  const denominator = matrix.g * point.x + matrix.h * point.y + matrix.i;
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= DENOMINATOR_EPSILON) return null;

  const u = (matrix.a * point.x + matrix.b * point.y + matrix.c) / denominator;
  const v = (matrix.d * point.x + matrix.e * point.y + matrix.f) / denominator;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;

  const inverseDenominator = 1 / denominator;
  return {
    u,
    v,
    denominator,
    duDx: (matrix.a - u * matrix.g) * inverseDenominator,
    duDy: (matrix.b - u * matrix.h) * inverseDenominator,
    dvDx: (matrix.d - v * matrix.g) * inverseDenominator,
    dvDy: (matrix.e - v * matrix.h) * inverseDenominator,
  };
}

export function invertHomography(matrix: Homography): Homography | null {
  if (!isInvertibleHomography(matrix)) return null;
  const determinant = homographyDeterminant(matrix);

  const inverse = 1 / determinant;
  return Object.freeze({
    a: (matrix.e * matrix.i - matrix.f * matrix.h) * inverse,
    b: (matrix.c * matrix.h - matrix.b * matrix.i) * inverse,
    c: (matrix.b * matrix.f - matrix.c * matrix.e) * inverse,
    d: (matrix.f * matrix.g - matrix.d * matrix.i) * inverse,
    e: (matrix.a * matrix.i - matrix.c * matrix.g) * inverse,
    f: (matrix.c * matrix.d - matrix.a * matrix.f) * inverse,
    g: (matrix.d * matrix.h - matrix.e * matrix.g) * inverse,
    h: (matrix.b * matrix.g - matrix.a * matrix.h) * inverse,
    i: (matrix.a * matrix.e - matrix.b * matrix.d) * inverse,
  });
}

function rowMagnitude(row: readonly number[], value: number): number {
  return row.reduce((largest, entry) => Math.max(largest, Math.abs(entry)), Math.abs(value));
}

function solveLinearSystem(rows: readonly (readonly number[])[], values: readonly number[]): number[] | null {
  const size = rows.length;
  const matrix = rows.map((row, index) => {
    const magnitude = rowMagnitude(row, values[index]);
    const scale = magnitude > 0 ? magnitude : 1;
    return [...row.map((value) => value / scale), values[index] / scale];
  });

  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    const head = matrix[pivot][column];
    if (!Number.isFinite(head) || Math.abs(head) <= HOMOGRAPHY_RELATIVE_EPSILON) return null;

    const swap = matrix[column];
    matrix[column] = matrix[pivot];
    matrix[pivot] = swap;

    for (let index = column; index <= size; index++) matrix[column][index] /= head;

    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index++) matrix[row][index] -= factor * matrix[column][index];
    }
  }

  const solution = matrix.map((row) => row[size]);
  return solution.every(Number.isFinite) ? solution : null;
}

function matchesCorrespondences(matrix: Homography, source: readonly Point[], destination: readonly Point[]): boolean {
  for (let index = 0; index < source.length; index++) {
    const mapped = applyHomography(matrix, source[index]);
    const expected = destination[index];
    if (!mapped) return false;
    const scaleX = Math.max(1, Math.abs(expected.x));
    const scaleY = Math.max(1, Math.abs(expected.y));
    if (Math.abs(mapped.x - expected.x) > HOMOGRAPHY_TOLERANCE * scaleX) return false;
    if (Math.abs(mapped.y - expected.y) > HOMOGRAPHY_TOLERANCE * scaleY) return false;
  }
  return true;
}

export function solveHomography(source: readonly Point[], destination: readonly Point[]): Homography | null {
  if (source.length !== HOMOGRAPHY_CORRESPONDENCE_COUNT) return null;
  if (destination.length !== HOMOGRAPHY_CORRESPONDENCE_COUNT) return null;

  const rows: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < HOMOGRAPHY_CORRESPONDENCE_COUNT; index++) {
    const from = source[index];
    const to = destination[index];
    if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
    rows.push([from.x, from.y, 1, 0, 0, 0, -to.x * from.x, -to.x * from.y]);
    values.push(to.x);
    rows.push([0, 0, 0, from.x, from.y, 1, -to.y * from.x, -to.y * from.y]);
    values.push(to.y);
  }

  const solution = solveLinearSystem(rows, values);
  if (!solution) return null;

  const matrix: Homography = {
    a: solution[0],
    b: solution[1],
    c: solution[2],
    d: solution[3],
    e: solution[4],
    f: solution[5],
    g: solution[6],
    h: solution[7],
    i: 1,
  };
  if (!isInvertibleHomography(matrix)) return null;
  if (!matchesCorrespondences(matrix, source, destination)) return null;
  return Object.freeze(matrix);
}
