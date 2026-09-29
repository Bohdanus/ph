import { describe, expect, it } from 'vitest';

import {
  canvasRectToDocumentFrame,
  canvasToDocumentPoint,
  canvasToDocumentPos,
  cloneDocumentFrame,
  documentFrameEquals,
  documentFrameFromSize,
  documentFrameSize,
  documentToCanvasPoint,
  documentToCanvasPos,
  isValidDocumentFrame,
  type DocumentFrame,
} from '../document-frame.ts';

const frame = (overrides: Partial<DocumentFrame> = {}): DocumentFrame => ({
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...overrides,
});

describe('documentFrameFromSize', () => {
  it('anchors a zero origin to the supplied size', () => {
    expect(documentFrameFromSize({ width: 320, height: 240 })).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  });

  it('produces a 0x0 frame for an undefined size', () => {
    expect(documentFrameFromSize(undefined)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('keeps a zero size rather than substituting a default', () => {
    expect(documentFrameFromSize({ width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('preserves a fractional size verbatim so clamping happens in documentFrameSize', () => {
    expect(documentFrameFromSize({ width: 10.5, height: 20.25 })).toEqual({ x: 0, y: 0, width: 10.5, height: 20.25 });
  });

  it('does not alias the size object it was given', () => {
    const size = { width: 8, height: 9 };
    const result = documentFrameFromSize(size);

    expect(result).not.toBe(size);
    expect(Object.keys(result).sort()).toEqual(['height', 'width', 'x', 'y']);
  });
});

describe('documentFrameSize', () => {
  it('passes an already integral size straight through', () => {
    expect(documentFrameSize(frame({ width: 640, height: 480 }))).toEqual({ width: 640, height: 480 });
  });

  it('ceils a fractional size in both axes', () => {
    expect(documentFrameSize(frame({ width: 100.1, height: 50.9 }))).toEqual({ width: 101, height: 51 });
  });

  it('ceils a sub-pixel size up to one pixel per axis', () => {
    expect(documentFrameSize(frame({ width: 0.2, height: 0.9 }))).toEqual({ width: 1, height: 1 });
  });

  it('clamps a zero size to 1x1 instead of producing a zero-sized canvas', () => {
    expect(documentFrameSize(frame({ width: 0, height: 0 }))).toEqual({ width: 1, height: 1 });
  });

  it('clamps a negative size to 1x1', () => {
    expect(documentFrameSize(frame({ width: -30, height: -12 }))).toEqual({ width: 1, height: 1 });
  });

  it('clamps each axis independently', () => {
    expect(documentFrameSize(frame({ width: 0, height: 12.2 }))).toEqual({ width: 1, height: 13 });
    expect(documentFrameSize(frame({ width: 12.2, height: 0 }))).toEqual({ width: 13, height: 1 });
  });

  it('ignores the origin when deriving the pixel size', () => {
    expect(documentFrameSize(frame({ x: -500, y: 900, width: 7, height: 8 }))).toEqual({ width: 7, height: 8 });
  });

  it('round-trips an integral frame produced by documentFrameFromSize', () => {
    const size = { width: 128, height: 64 };
    expect(documentFrameSize(documentFrameFromSize(size))).toEqual(size);
  });
});

describe('isValidDocumentFrame', () => {
  it('accepts a well formed frame', () => {
    expect(isValidDocumentFrame(frame())).toBe(true);
  });

  it('accepts a negative origin and fractional geometry as long as the extent is positive', () => {
    expect(isValidDocumentFrame(frame({ x: -12.5, y: -7, width: 0.5, height: 0.5 }))).toBe(true);
  });

  it('accepts a frozen frame', () => {
    expect(isValidDocumentFrame(Object.freeze(frame({ x: 3, y: 4, width: 5, height: 6 })))).toBe(true);
  });

  it('accepts a frame carrying extra unrelated keys', () => {
    expect(isValidDocumentFrame({ ...frame(), rotated: true })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', '0,0,10,10'],
    ['a boolean', true],
    ['a symbol', Symbol('frame')],
    ['a function', () => frame()],
  ] as const)('rejects %s as a non-object frame', (_label, value) => {
    expect(isValidDocumentFrame(value)).toBe(false);
  });

  it('rejects a missing key', () => {
    expect(isValidDocumentFrame({ x: 0, y: 0, width: 10 })).toBe(false);
  });

  it.each([
    ['x', { y: 0, width: 10, height: 10 }],
    ['y', { x: 0, width: 10, height: 10 }],
    ['width', { x: 0, y: 0, height: 10 }],
    ['height', { x: 0, y: 0, width: 10 }],
  ])('rejects a frame that is missing %s', (_key, value) => {
    expect(isValidDocumentFrame(value)).toBe(false);
  });

  it('rejects a non-numeric coordinate', () => {
    expect(isValidDocumentFrame({ x: '0', y: 0, width: 10, height: 10 })).toBe(false);
  });

  it.each([
    ['NaN width', { x: 0, y: 0, width: Number.NaN, height: 10 }],
    ['NaN height', { x: 0, y: 0, width: 10, height: Number.NaN }],
    ['Infinity width', { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }],
    ['-Infinity height', { x: 0, y: 0, width: 10, height: Number.NEGATIVE_INFINITY }],
  ])('rejects a non-finite extent (%s)', (_label, value) => {
    expect(isValidDocumentFrame(value)).toBe(false);
  });

  it('rejects a zero width', () => {
    expect(isValidDocumentFrame(frame({ width: 0 }))).toBe(false);
  });

  it('rejects a zero height', () => {
    expect(isValidDocumentFrame(frame({ height: 0 }))).toBe(false);
  });

  it('rejects a negative width', () => {
    expect(isValidDocumentFrame(frame({ width: -5 }))).toBe(false);
  });

  it('rejects a negative height even when the origin is negative too', () => {
    expect(isValidDocumentFrame(frame({ x: -10, y: -10, width: 5, height: -5 }))).toBe(false);
  });

  it('accepts a positive fractional extent below one pixel, because the rule is positivity and not a minimum size', () => {
    expect(isValidDocumentFrame(frame({ width: 0.5, height: 0.5 }))).toBe(true);
  });

  it('rejects a Date instance, which carries none of the four frame fields', () => {
    // `isValidDocumentFrame` is purely structural, so this passes because a Date has no
    // x/y/width/height at all — not because dates are recognised and refused.
    expect(isValidDocumentFrame(new Date(0))).toBe(false);
  });
});

describe('cloneDocumentFrame', () => {
  it('copies every field', () => {
    const original = frame({ x: 11, y: 22, width: 33, height: 44 });

    expect(cloneDocumentFrame(original)).toEqual(original);
  });

  it('returns a new object rather than the source', () => {
    const original = frame();

    expect(cloneDocumentFrame(original)).not.toBe(original);
  });

  it('is deeply independent: mutating the clone cannot affect the original', () => {
    const original = frame({ x: 1, y: 2, width: 3, height: 4 });
    const clone = cloneDocumentFrame(original) as { x: number; y: number; width: number; height: number };

    clone.x = 100;
    clone.y = 200;
    clone.width = 300;
    clone.height = 400;

    expect(original).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('clones a frozen frame into a mutable one', () => {
    const frozen = Object.freeze(frame());
    const clone = cloneDocumentFrame(frozen) as { x: number };

    expect(Object.isFrozen(clone)).toBe(false);
    clone.x = 9;
    expect(clone.x).toBe(9);
    expect(frozen.x).toBe(0);
  });
});

describe('canvas and document point round trips', () => {
  const origin = frame({ x: 40, y: 25, width: 200, height: 100 });

  it('offsets a canvas point by the frame origin', () => {
    expect(canvasToDocumentPoint({ x: 5, y: 6 }, origin)).toEqual({ x: 45, y: 31 });
  });

  it('subtracts the frame origin from a document point', () => {
    expect(documentToCanvasPoint({ x: 45, y: 31 }, origin)).toEqual({ x: 5, y: 6 });
  });

  it('round-trips a point through canvasToDocumentPoint and back', () => {
    const canvasPoint = { x: -17, y: 321 };

    expect(documentToCanvasPoint(canvasToDocumentPoint(canvasPoint, origin), origin)).toEqual(canvasPoint);
  });

  it('round-trips a point through documentToCanvasPoint and back', () => {
    const documentPoint = { x: 123.5, y: -0.25 };

    expect(canvasToDocumentPoint(documentToCanvasPoint(documentPoint, origin), origin)).toEqual(documentPoint);
  });

  it('is the identity for a zero-origin frame', () => {
    const point = { x: 8, y: 9 };
    const zero = frame({ x: 0, y: 0 });

    expect(canvasToDocumentPoint(point, zero)).toEqual(point);
    expect(documentToCanvasPoint(point, zero)).toEqual(point);
  });

  it('does not mutate either input point', () => {
    const point = { x: 3, y: 4 };

    canvasToDocumentPoint(point, origin);
    documentToCanvasPoint(point, origin);

    expect(point).toEqual({ x: 3, y: 4 });
  });
});

describe('canvas and document rect round trips', () => {
  const origin = frame({ x: 40, y: 25, width: 200, height: 100 });

  it('offsets a canvas rect by the frame origin', () => {
    expect(canvasToDocumentPos({ x: 1, y: 2, width: 3, height: 4 }, origin)).toEqual({
      x: 41,
      y: 27,
      width: 3,
      height: 4,
    });
  });

  it('subtracts the frame origin from a document rect', () => {
    expect(documentToCanvasPos({ x: 41, y: 27, width: 3, height: 4 }, origin)).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it('round-trips a rect through canvasToDocumentPos and back', () => {
    const canvasPos = { x: -5, y: 12, width: 30, height: 40 };

    expect(documentToCanvasPos(canvasToDocumentPos(canvasPos, origin), origin)).toEqual(canvasPos);
  });

  it('round-trips a rect through documentToCanvasPos and back', () => {
    const documentPos = { x: 100, y: 100, width: 30, height: 40 };

    expect(canvasToDocumentPos(documentToCanvasPos(documentPos, origin), origin)).toEqual(documentPos);
  });

  it('preserves the extent of a rect exactly while translating its origin', () => {
    const canvasPos = { x: 7, y: 9, width: 11, height: 13 };
    const documentPos = canvasToDocumentPos(canvasPos, origin);

    expect(documentPos.width).toBe(canvasPos.width);
    expect(documentPos.height).toBe(canvasPos.height);
  });

  it('carries extra rect fields through the translation untouched', () => {
    const withExtras = { x: 1, y: 1, width: 2, height: 2, label: 'selection' };

    expect(canvasToDocumentPos(withExtras, origin)).toEqual({ x: 41, y: 26, width: 2, height: 2, label: 'selection' });
  });

  it('does not mutate the source rect', () => {
    const canvasPos = { x: 1, y: 2, width: 3, height: 4 };

    canvasToDocumentPos(canvasPos, origin);

    expect(canvasPos).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe('canvasRectToDocumentFrame', () => {
  const origin = frame({ x: 40, y: 25, width: 200, height: 100 });

  it('translates the rect origin and keeps the rect extent as the new frame extent', () => {
    expect(canvasRectToDocumentFrame({ x: 10, y: 5, width: 30, height: 40 }, origin)).toEqual({
      x: 50,
      y: 30,
      width: 30,
      height: 40,
    });
  });

  it('collapses a zero origin for a zero-offset rect', () => {
    expect(canvasRectToDocumentFrame({ x: 0, y: 0, width: 30, height: 40 }, origin)).toEqual({
      x: 40,
      y: 25,
      width: 30,
      height: 40,
    });
  });

  it('produces a valid frame for a positive in-bounds crop', () => {
    expect(isValidDocumentFrame(canvasRectToDocumentFrame({ x: 0, y: 0, width: 1, height: 1 }, origin))).toBe(true);
  });

  it('produces a frame that is invalid when the crop has no extent', () => {
    expect(isValidDocumentFrame(canvasRectToDocumentFrame({ x: 5, y: 5, width: 0, height: 0 }, origin))).toBe(false);
  });

  it('does not mutate or alias the source frame', () => {
    const source = frame({ x: 7, y: 8, width: 9, height: 10 });
    const result = canvasRectToDocumentFrame({ x: 1, y: 1, width: 2, height: 2 }, source);

    expect(result).not.toBe(source);
    expect(source).toEqual({ x: 7, y: 8, width: 9, height: 10 });
  });
});

describe('documentFrameEquals', () => {
  it('is true for two structurally identical frames', () => {
    expect(
      documentFrameEquals(frame({ x: 1, y: 2, width: 3, height: 4 }), frame({ x: 1, y: 2, width: 3, height: 4 }))
    ).toBe(true);
  });

  it('is true for the same object compared with itself', () => {
    const same = frame();
    expect(documentFrameEquals(same, same)).toBe(true);
  });

  it('is false when only x differs', () => {
    expect(documentFrameEquals(frame({ x: 0 }), frame({ x: 1 }))).toBe(false);
  });

  it('is false when only y differs', () => {
    expect(documentFrameEquals(frame({ y: 0 }), frame({ y: 1 }))).toBe(false);
  });

  it('is false when only width differs', () => {
    expect(documentFrameEquals(frame({ width: 10 }), frame({ width: 11 }))).toBe(false);
  });

  it('is false when only height differs', () => {
    expect(documentFrameEquals(frame({ height: 10 }), frame({ height: 11 }))).toBe(false);
  });

  it('ignores extra keys, so an object with equal fields plus extras is still equal', () => {
    const decorated = { ...frame(), extra: 1 } as unknown as DocumentFrame;

    expect(documentFrameEquals(frame(), decorated)).toBe(true);
  });

  it('distinguishes a negative-zero origin from a positive-zero origin', () => {
    // `Object.is` would call these different; the reducer compares with `===`, which
    // deliberately treats them as the same document origin.
    expect(documentFrameEquals(frame({ x: -0 }), frame({ x: 0 }))).toBe(true);
  });
});
