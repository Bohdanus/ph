import { describe, expect, it } from 'vitest';
import { sortRect, sortRoundRect, trimRect, trimRect2 } from '../rect.ts';
import { refitRectWidthToAspect } from '../rect-aspect.ts';
import type { RectXY, Size, RectXYSorted } from '../../contexts/general-types.ts';
import type { CropToolArgs } from '../../tools/crop.ts';

/**
 * Pure extraction of the `onRatioChange` state-transition logic from
 * `src/components/ToolbarsRight/Crop/Crop.tsx` (Crop.tsx:38-50).
 *
 * The original handler is a closure over `args` and `onChange`; every branch is
 * a function of `(args, newRatio)` alone, so the args it would publish can be
 * computed without rendering the component. Extracting it here lets the state
 * machine — snapshot on first ratio, restore on Free, preserve across drags —
 * be asserted directly rather than through a React render cycle.
 *
 * This is a test-only copy: it must stay faithful to Crop.tsx, and a comment at
 * each site notes the line it mirrors.
 */
function applyRatioChange(args: CropToolArgs, newRatio: number | null): CropToolArgs {
  // Mirrors Crop.tsx:39-41 — Free restores the pre-ratio rect (or the current one
  // if there was none) and clears the snapshot so the restore is idempotent.
  if (!newRatio) {
    return { ...args, aspectRatio: newRatio, rect: args.preRatioRect ?? args.rect, preRatioRect: null };
  }

  // Mirrors Crop.tsx:44-49 — a ratio refits the pending rect and snapshots the
  // original, but only on the FIRST choice: `preRatioRect ??` keeps the first
  // draw, so cycling through presets round-trips back to what the user actually
  // drew, not an intermediate fit.
  return {
    ...args,
    aspectRatio: newRatio,
    rect: args.rect ? { ...args.rect, ...refitRectWidthToAspect(args.rect, newRatio) } : args.rect,
    preRatioRect: args.preRatioRect ?? args.rect ?? null,
  };
}

/**
 * A rect the crop processor will hand to `trimRect`: already sorted, the shape
 * `useRect`'s `onChangeEnd` delivers after a drag releases.
 */
describe('trimRect for crop', () => {
  const imageSize: Size = { width: 800, height: 600 };

  it('returns a Pos with isTrimmed for a rect fully inside the image', () => {
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };

    const result = trimRect(rect, imageSize);

    expect(result).toEqual({ x: 100, y: 50, width: 300, height: 250, isTrimmed: false });
    // The crop processor destructures exactly these four fields.
    const { x, y, width, height } = result;
    expect({ x, y, width, height }).toEqual({ x: 100, y: 50, width: 300, height: 250 });
  });

  it('clamps every edge that crosses the image boundary', () => {
    // Width extends 100px past the right edge, height 100px past the bottom.
    const rect = { x1: 700, y1: 500, x2: 900, y2: 700 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 700,
      y: 500,
      width: 100,
      height: 100,
      isTrimmed: true,
    });
  });

  it('clamps a rect crossing the left and top edges', () => {
    const rect = { x1: -50, y1: -30, x2: 200, y2: 150 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      isTrimmed: true,
    });
  });

  it('collapses a rect fully outside the image to an empty Pos', () => {
    const rect = { x1: 900, y1: 700, x2: 1000, y2: 800 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 800,
      y: 600,
      width: 0,
      height: 0,
      isTrimmed: true,
    });
  });

  it('collapses a rect fully outside on the negative side', () => {
    const rect = { x1: -100, y1: -100, x2: -50, y2: -50 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isTrimmed: true,
    });
  });

  it('keeps the positive intersection when a rect straddles two edges', () => {
    const rect = { x1: 750, y1: 550, x2: 850, y2: 650 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 750,
      y: 550,
      width: 50,
      height: 50,
      isTrimmed: true,
    });
  });

  it('clamps a rect that exactly matches the document without marking it trimmed', () => {
    const rect = { x1: 0, y1: 0, x2: 800, y2: 600 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      isTrimmed: false,
    });
  });

  it('clamps a zero-area rect at the origin without inverting it', () => {
    const rect = { x1: 50, y1: 50, x2: 50, y2: 50 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 50,
      y: 50,
      width: 0,
      height: 0,
      isTrimmed: false,
    });
  });

  it('rounds fractional edges once and derives the extent from the rounded values', () => {
    // The crop processor feeds the result straight into drawImage, so a
    // fractional edge must produce an integer source rectangle or the canvas
    // driver will reject it.
    const rect = { x1: 100.4, y1: 50.6, x2: 400.4, y2: 300.6 };

    const result = trimRect(rect, imageSize);

    expect(result.x).toBe(100);
    expect(result.y).toBe(51);
    expect(result.width).toBe(300);
    expect(result.height).toBe(250);
    // x + width === Math.round(x2) holds by construction.
    expect(result.x + result.width).toBe(Math.round(400.4));
    expect(result.y + result.height).toBe(Math.round(300.6));
  });

  it('sorts an inverted rect before clamping, so a right-to-left drag still crops', () => {
    // useRect never publishes an inverted rect, but a direct call or a future
    // caller might: trimRect normalises first, so the result is always positive.
    const rect: RectXY = { x1: 400, y1: 300, x2: 100, y2: 50 };

    expect(trimRect(rect, imageSize)).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 250,
      isTrimmed: false,
    });
  });

  it('reports isTrimmed true exactly one pixel past any edge', () => {
    const at = (x1: number, y1: number, x2: number, y2: number): boolean =>
      trimRect({ x1, y1, x2, y2 }, imageSize).isTrimmed;

    expect(at(0, 0, 800, 600)).toBe(false);
    expect(at(0, 0, 801, 600)).toBe(true);
    expect(at(0, 0, 800, 601)).toBe(true);
    expect(at(-1, 0, 800, 600)).toBe(true);
    expect(at(0, -1, 800, 600)).toBe(true);
  });

  it('returns a zero-extent Pos for a zero-size image', () => {
    // The crop processor would create a 1x1 canvas here (OffscreenCanvas floor),
    // so trimRect must not produce a negative extent.
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };

    expect(trimRect(rect, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      isTrimmed: true,
    });
  });
});

describe('trimRect2 for crop', () => {
  const imageSize: Size = { width: 800, height: 600 };

  it('returns the rect unchanged when already within bounds', () => {
    const rect = { x1: 100, y1: 50, x2: 400, y2: 300 };

    expect(trimRect2(rect, imageSize)).toEqual(rect);
  });

  it('returns the rect unchanged when it exactly matches the document', () => {
    const rect = { x1: 0, y1: 0, x2: 800, y2: 600 };

    expect(trimRect2(rect, imageSize)).toEqual(rect);
  });

  it('clamps a rect that extends past all four edges to the document', () => {
    const rect = { x1: -100, y1: -100, x2: 900, y2: 700 };

    expect(trimRect2(rect, imageSize)).toEqual({ x1: 0, y1: 0, x2: 800, y2: 600 });
  });

  it('collapses a zero-area rect at the origin without inverting it', () => {
    const rect = { x1: 50, y1: 50, x2: 50, y2: 50 };

    expect(trimRect2(rect, imageSize)).toEqual({ x1: 50, y1: 50, x2: 50, y2: 50 });
  });

  it('does not round its output, keeping fractional coordinates intact', () => {
    const rect = { x1: 100.4, y1: 50.6, x2: 400.4, y2: 300.6 };

    expect(trimRect2(rect, imageSize)).toEqual(rect);
  });
});

describe('sortRect for crop', () => {
  it('turns a right-to-left drag into a positive-extent rect', () => {
    const dragged = { x1: 400, y1: 300, x2: 100, y2: 50 };

    expect(sortRect(dragged)).toEqual({ x1: 100, y1: 50, x2: 400, y2: 300 });
  });

  it('turns a bottom-to-top drag into a positive-extent rect', () => {
    const dragged = { x1: 100, y1: 300, x2: 400, y2: 50 };

    expect(sortRect(dragged)).toEqual({ x1: 100, y1: 50, x2: 400, y2: 300 });
  });

  it('leaves a zero-area click point as a zero-area rect', () => {
    const point = { x1: 200, y1: 150, x2: 200, y2: 150 };

    expect(sortRect(point)).toEqual(point);
  });
});

describe('sortRoundRect for crop', () => {
  it('sorts an inverted drag and rounds each edge once', () => {
    const dragged = { x1: 400.4, y1: 300.6, x2: 100.4, y2: 50.6 };

    expect(sortRoundRect(dragged)).toEqual({ x: 100, y: 51, width: 300, height: 250 });
  });

  it('allows the result to extend past the image, because crop grows the canvas', () => {
    // `sortRoundRect` is what `applyDocumentCrop` uses (useLayer.ts:1110): it
    // does NOT clamp, so a rect dragged past the edge grows the document frame.
    const rect = { x1: -100, y1: -50, x2: 900, y2: 700 };

    expect(sortRoundRect(rect)).toEqual({ x: -100, y: -50, width: 1000, height: 750 });
  });

  it('derives width and height from the rounded edges, not the unrounded span', () => {
    const rect = { x1: 100.4, y1: 50.6, x2: 400.4, y2: 300.6 };
    const result = sortRoundRect(rect);

    expect(result.x).toBe(100);
    expect(result.y).toBe(51);
    expect(result.width).toBe(300);
    expect(result.height).toBe(250);
    expect(result.x + result.width).toBe(Math.round(400.4));
    expect(result.y + result.height).toBe(Math.round(300.6));
  });

  it('returns a zero-extent Pos for a zero-area drag', () => {
    const rect = { x1: 200.4, y1: 150.6, x2: 200.4, y2: 150.6 };

    expect(sortRoundRect(rect)).toEqual({ x: 200, y: 151, width: 0, height: 0 });
  });

  it('does not mutate its argument', () => {
    const rect: RectXY = { x1: 400.4, y1: 300.6, x2: 100.4, y2: 50.6 };
    const frozen = Object.freeze({ ...rect });

    sortRoundRect(frozen);

    expect(frozen).toEqual(rect);
  });

  it('returns integer coordinates for every field, even when the input is fractional', () => {
    const rect: RectXY = { x1: -10.6, y1: 0.4, x2: 100.6, y2: 50.6 };

    const result = sortRoundRect(rect);

    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('rounds each edge exactly once, so x + width equals the rounded far edge', () => {
    // The far edges are .5/.6 — Math.round(0.6) = 1 and Math.round(50.6) = 51.
    const rect: RectXY = { x1: 0.4, y1: 0.4, x2: 100.6, y2: 50.6 };

    const result = sortRoundRect(rect);

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(101);
    expect(result.height).toBe(51);
    expect(result.x + result.width).toBe(Math.round(100.6));
    expect(result.y + result.height).toBe(Math.round(50.6));
  });

  it('rounds negative fractional edges toward positive infinity', () => {
    // Math.round(-10.6) = -11 and Math.round(-0.4) = 0, so the extent is 11, not 10.
    const rect: RectXY = { x1: -10.6, y1: -5.6, x2: -0.4, y2: -0.4 };

    const result = sortRoundRect(rect);

    expect(result.x).toBe(-11);
    expect(result.y).toBe(-6);
    expect(result.width).toBe(11);
    expect(result.height).toBe(6);
  });
});

/**
 * The aspect-ratio presets declared in Crop.tsx:8-14, duplicated here so the
 * suite is self-contained and does not depend on the component rendering.
 */
const PRESETS: ReadonlyArray<{ label: string; value: number | null }> = [
  { label: 'Free', value: null },
  { label: 'Square (1:1)', value: 1 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

describe('refitRectWidthToAspect', () => {
  const WIDE = { x1: 0, y1: 40, x2: 300, y2: 240 };
  const TALL = { x1: 100, y1: 50, x2: 200, y2: 450 };

  it.each(PRESETS.filter((p) => p.value !== null))(
    'derives width = height * ratio and centres on the horizontal midpoint for $label',
    ({ value: rawRatio }) => {
      const ratio = rawRatio as number;
      const result = refitRectWidthToAspect(WIDE, ratio);
      const height = WIDE.y2 - WIDE.y1;
      const expectedWidth = height * ratio;
      const centre = (WIDE.x1 + WIDE.x2) / 2;

      expect(result.x1).toBeCloseTo(centre - expectedWidth / 2, 10);
      expect(result.x2).toBeCloseTo(centre + expectedWidth / 2, 10);
      // y-edges are untouched.
      expect(result).not.toHaveProperty('y1');
      expect(result).not.toHaveProperty('y2');
    }
  );

  it('returns the edges untouched for a null (Free) ratio', () => {
    const result = refitRectWidthToAspect(WIDE, null);

    expect(result).toEqual({ x1: WIDE.x1, x2: WIDE.x2 });
  });

  it('narrowing the width for a 1:1 square on a wide rect', () => {
    // height 200 at ratio 1 => width 200, centred on x=150.
    const result = refitRectWidthToAspect(WIDE, 1);

    expect(result).toEqual({ x1: 50, x2: 250 });
  });

  it('widening the width for a 16:9 rect', () => {
    // height 200 at ratio 16/9 => width ~355.56, centred on x=150.
    const result = refitRectWidthToAspect(WIDE, 16 / 9);

    expect(result.x1).toBeCloseTo(-27.78, 2);
    expect(result.x2).toBeCloseTo(327.78, 2);
  });

  it('narrowing the width for a 9:16 rect', () => {
    // height 200 at ratio 9/16 => width 112.5, centred on x=150.
    const result = refitRectWidthToAspect(WIDE, 9 / 16);

    expect(result.x1).toBeCloseTo(93.75, 10);
    expect(result.x2).toBeCloseTo(206.25, 10);

    const width = result.x2 - result.x1;
    expect(width).toBeCloseTo(112.5, 10);
  });

  it('handles a tall rect by narrowing the width for 1:1', () => {
    // height 400 at ratio 1 => width 400, centred on x=150.
    const result = refitRectWidthToAspect(TALL, 1);

    expect(result).toEqual({ x1: -50, x2: 350 });
  });

  it('handles a custom ratio (e.g. 2:1)', () => {
    // height 200 at ratio 2 => width 400, centred on x=150.
    const result = refitRectWidthToAspect(WIDE, 2);

    expect(result.x1).toBeCloseTo(-50, 10);
    expect(result.x2).toBeCloseTo(350, 10);
  });

  it('narrows an inverted rect symmetrically, preserving its direction', () => {
    // x1=300 > x2=0, so the else branch runs: x1 += diff, x2 -= diff.
    // height 200, wanted width 200, current width 300, diff = -50.
    // x1 = 300 + (-50) = 250, x2 = 0 - (-50) = 50. Still inverted (x1 > x2).
    const inverted = { x1: 300, y1: 40, x2: 0, y2: 240 };

    const result = refitRectWidthToAspect(inverted, 1);

    expect(result.x1).toBe(250);
    expect(result.x2).toBe(50);
    // The direction is preserved: x1 is still the larger edge.
    expect(result.x1).toBeGreaterThan(result.x2);
  });

  it('is a no-op when the rect already satisfies the ratio', () => {
    // 200x200 at ratio 1 => wanted width 200, diff 0.
    const square = { x1: 100, y1: 50, x2: 300, y2: 250 };

    expect(refitRectWidthToAspect(square, 1)).toEqual({ x1: 100, x2: 300 });
  });

  it('collapses a zero-WIDTH rect into an inverted pair, because x1 < x2 is false', () => {
    // A vertical drag has x1 === x2, so the else branch runs: x1 += diff, x2 -= diff.
    // height 200 at ratio 1 => wanted width 200, current width 0, diff = 100.
    // x1 = 100 + 100 = 200, x2 = 100 - 100 = 0. The pair is inverted (x1 > x2).
    const zeroWidth = { x1: 100, y1: 100, x2: 100, y2: 300 };

    const result = refitRectWidthToAspect(zeroWidth, 1);

    expect(result.x1).toBe(200);
    expect(result.x2).toBe(0);
    expect(result.x1).toBeGreaterThan(result.x2);
  });

  it('collapses a zero-HEIGHT rect to a zero-width pair centred on the midpoint', () => {
    // A horizontal drag has y1 === y2, so height is 0 and wanted width is 0.
    // current width 300, diff = -150. x1 -= diff => 150, x2 += diff => 150.
    const zeroHeight = { x1: 0, y1: 100, x2: 300, y2: 100 };

    const result = refitRectWidthToAspect(zeroHeight, 1);

    expect(result.x1).toBe(150);
    expect(result.x2).toBe(150);
  });

  it('expands a rect to an extreme WIDE ratio, centred on the original midpoint', () => {
    // height 200 at ratio 1000 => wanted width 200000, diff = 99850, and the edges move
    // symmetrically about their original positions (0 and 300), not about the midpoint.
    const result = refitRectWidthToAspect(WIDE, 1000);

    expect(result.x1).toBeCloseTo(0 - 99850, 10);
    expect(result.x2).toBeCloseTo(300 + 99850, 10);
  });

  it('shrinks a rect to an extreme NARROW ratio, centred on the original midpoint', () => {
    // height 200 at ratio 0.001 => wanted width 0.2, diff = -149.9.
    const result = refitRectWidthToAspect(WIDE, 0.001);

    expect(result.x1).toBeCloseTo(149.9, 10);
    expect(result.x2).toBeCloseTo(150.1, 10);
  });

  it('returns only x1 and x2, so the caller spreads it over the existing rect', () => {
    // Crop.tsx spreads the result over the rect, so extra keys would clobber y.
    const result = refitRectWidthToAspect(WIDE, 1);

    expect(Object.keys(result).sort()).toEqual(['x1', 'x2']);
  });
});

/**
 * The `preRatioRect` state machine: a pure function extracted from Crop.tsx
 * so the four transitions — snapshot on ratio, restore on Free, preserve the
 * first snapshot, clear on commit/clear — can be pinned without a React render.
 */
describe('preRatioRect state logic', () => {
  function baseRect(): RectXYSorted {
    return { x1: 10, y1: 20, x2: 110, y2: 220 };
  }

  function baseArgs(overrides: Partial<CropToolArgs> = {}): CropToolArgs {
    return {
      toolName: 'crop',
      rect: baseRect(),
      preRatioRect: null,
      aspectRatio: null,
      ...overrides,
    };
  }

  it('stores preRatioRect when a ratio is first chosen', () => {
    const args = baseArgs();
    const original = { ...args.rect! };

    const after = applyRatioChange(args, 1);

    expect(after.preRatioRect).toEqual(original);
    expect(after.aspectRatio).toBe(1);
  });

  it('restores the original rect and nulls preRatioRect when switching back to Free', () => {
    const square = applyRatioChange(baseArgs(), 1);
    const original = baseRect();

    const freed = applyRatioChange(square, null);

    expect(freed.rect).toEqual(original);
    expect(freed.preRatioRect).toBeNull();
    expect(freed.aspectRatio).toBeNull();
  });

  it('preserves the FIRST preRatioRect across multiple ratio changes, not the last intermediate', () => {
    // Cycling 1 -> 16:9 -> Free should restore the original draw, not the
    // intermediate 1:1 fit. The `??` in the snapshot means "keep the first".
    const first = applyRatioChange(baseArgs(), 1);

    const second = applyRatioChange(first, 16 / 9);
    expect(second.preRatioRect).toEqual(baseRect());

    const freed = applyRatioChange(second, null);
    expect(freed.rect).toEqual(baseRect());
  });

  it('keeps preRatioRect across a drag that replaces rect, so Free restores the original framing', () => {
    // A new drag publishes a new rect with the ratio still set; preRatioRect
    // must survive so Free can undo the ratio rather than the drag.
    const withRatio = applyRatioChange(baseArgs(), 1);
    const draggedRect = { x1: 200, y1: 100, x2: 500, y2: 400 };

    const afterDrag = applyRatioChange({ ...withRatio, rect: draggedRect }, withRatio.aspectRatio!);

    // preRatioRect is the ORIGINAL draw, not the dragged one.
    expect(afterDrag.preRatioRect).toEqual(baseRect());
    expect(afterDrag.preRatioRect).not.toEqual(draggedRect);
  });

  it('snapshots preRatioRect as null when no rect exists and a ratio is chosen', () => {
    const args = baseArgs({ rect: null, preRatioRect: null });

    const after = applyRatioChange(args, 1);

    expect(after.preRatioRect).toBeNull();
    expect(after.rect).toBeNull();
  });

  it('does not create a preRatioRect snapshot for Free when one was never taken', () => {
    const args = baseArgs({ preRatioRect: null });

    const freed = applyRatioChange(args, null);

    // No snapshot existed, so Free hands the current rect back untouched.
    expect(freed.rect).toEqual(args.rect);
    expect(freed.preRatioRect).toBeNull();
  });

  it('drops preRatioRect on a commit (Apply)', () => {
    // `Apply` in Crop.tsx calls `onChange({ ...args, rect: null, preRatioRect: null })`.
    const withRatio = applyRatioChange(baseArgs(), 1);

    const committed = { ...withRatio, rect: null, preRatioRect: null };

    expect(committed.rect).toBeNull();
    expect(committed.preRatioRect).toBeNull();
  });

  it('drops preRatioRect on a Clear, so the framing cannot be resurrected', () => {
    const withRatio = applyRatioChange(baseArgs(), 1);

    const cleared = { ...withRatio, rect: null, preRatioRect: null };

    expect(cleared.rect).toBeNull();
    expect(cleared.preRatioRect).toBeNull();
  });

  it('refits the rect to the new ratio while snapshotting the original', () => {
    const args = baseArgs();
    const original = { ...args.rect! };

    const after = applyRatioChange(args, 4 / 3);

    // The snapshot is the original.
    expect(after.preRatioRect).toEqual(original);
    // The published rect is the refit, which holds the height and adjusts the width.
    const { x1, x2 } = refitRectWidthToAspect(original, 4 / 3);
    expect(after.rect).toEqual({ ...original, x1, x2 });
  });

  it('is idempotent across multiple Free selections after a ratio', () => {
    const afterRatio = applyRatioChange(baseArgs(), 1);
    const freed = applyRatioChange(afterRatio, null);
    const freedAgain = applyRatioChange(freed, null);

    // The second Free finds preRatioRect null and returns the current rect.
    expect(freedAgain.rect).toEqual(freed.rect);
    expect(freedAgain.preRatioRect).toBeNull();
  });
});
