import { describe, expect, it, vi } from 'vitest';
import {
  pointsBoundingPos,
  bezierSmoothedLine,
  drawSmoothLine,
  catmullRomToBezier,
  drawLine,
  drawPen,
  drawSpray,
} from '../draw.ts';
import { hexToRgb } from '../rect.ts';
import { makeMockCtx } from '../../__tests__/canvas-mock.ts';

describe('pointsBoundingPos', () => {
  it('computes bounds with default lineWidth of 1', () => {
    const result = pointsBoundingPos({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: -3, y: 8 },
      ],
    });
    expect(result).toEqual({ x: -4, y: -1, width: 15, height: 10 });
  });

  it('respects a custom lineWidth', () => {
    const result = pointsBoundingPos({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      lineWidth: 3,
    });
    expect(result).toEqual({ x: -3, y: -3, width: 16, height: 16 });
  });

  // The degenerate input, and the only reachable one: a click with the Draw tool pushes exactly
  // one point on pointerdown (`DrawToolArea.tsx:129`) and bounds that array on release
  // (`:133`-`:134`), so `pos` is the whole layer crop of a single-point gesture. The extent is
  // therefore `0 + 2 * lineWidth` on both axes — the stroke's own diameter, and nothing else.
  //
  // Broken by: a guard that treats one point as "no extent" and returns a zero-sized box, which
  // is the shape such a guard is usually written in. The layer would commit with
  // `width: 0, height: 0` and the click-dot would be invisible, while every other case in this
  // describe stays green — the two above pass three and two points, and
  // `DrawToolArea.test.tsx`'s `createLayerFromTool` assertions use strokes of 3 and 2 points.
  it('pads a single point by the stroke diameter rather than reporting no extent', () => {
    const result = pointsBoundingPos({ points: [{ x: 50, y: 50 }], lineWidth: 2 });
    expect(result).toEqual({ x: 48, y: 48, width: 4, height: 4 });
  });

  /**
   * `lineWidth: 0` is not hypothetical: `src/util/selection.ts` calls this with exactly
   * that, because a selection outline needs the points' own extent with no stroke padding.
   *
   * Every other case here uses a positive width, where `x = minX - lineWidth` and
   * `width = maxX - minX + 2 * lineWidth` are both shifted. At 0 the two formulas must
   * collapse to the bare extent, and a rewrite that special-cased 0 by widening to the 1px
   * default would return a box a pixel larger on each side for every lasso.
   */
  it('collapses to the bare extent for a zero lineWidth, which a selection outline passes', () => {
    const points = [
      { x: 4, y: 6 },
      { x: 20, y: 30 },
    ];

    expect(pointsBoundingPos({ points, lineWidth: 0 })).toEqual({ x: 4, y: 6, width: 16, height: 24 });
    // And it is the same box the padded form collapses to, not a different one.
    const padded = pointsBoundingPos({ points, lineWidth: 1 });
    expect(padded.width - 2).toBe(pointsBoundingPos({ points, lineWidth: 0 }).width);
  });

  it('gives a single point a box of exactly two line widths', () => {
    // The loop never runs, so min and max are the same point and the extent is pure padding.
    // A click is a real gesture for both the pen and the block stamp, and the DEFAULT width is
    // the one a caller that omits `lineWidth` gets — which is a different number from the
    // explicit width the case above pins.
    expect(pointsBoundingPos({ points: [{ x: 7, y: 9 }] })).toEqual({ x: 6, y: 8, width: 2, height: 2 });
    expect(pointsBoundingPos({ points: [{ x: 7, y: 9 }], lineWidth: 10 })).toEqual({
      x: -3,
      y: -1,
      width: 20,
      height: 20,
    });
  });

  it('tracks both extrema for an unsorted path, rather than reading the endpoints', () => {
    // It scans for minima and maxima independently, so an unsorted input cannot produce a
    // negative extent — this pins that both min AND max are tracked, which a rewrite to
    // `points[last] - points[0]` would satisfy for a monotonic path and fail here.
    const zigzag = [
      { x: 50, y: 0 },
      { x: 0, y: 80 },
      { x: 50, y: 40 },
    ];

    expect(pointsBoundingPos({ points: zigzag, lineWidth: 0 })).toEqual({ x: 0, y: 0, width: 50, height: 80 });
  });
});

describe('bezierSmoothedLine', () => {
  it('draws bezier curves using every consecutive triple of points', () => {
    const ctx = makeMockCtx();
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
      { x: 40, y: 40 },
    ];
    bezierSmoothedLine(ctx, points);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.bezierCurveTo).toHaveBeenNthCalledWith(1, 0, 0, 10, 10, 20, 20);
    expect(ctx.bezierCurveTo).toHaveBeenNthCalledWith(2, 20, 20, 30, 30, 40, 40);
  });

  it('falls back to lineTo for trailing points that do not form a triple', () => {
    const ctx = makeMockCtx();
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    bezierSmoothedLine(ctx, points);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(ctx.bezierCurveTo).toHaveBeenCalledWith(0, 0, 10, 10, 20, 20);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledWith(30, 30);
  });

  it('draws a single bezier for 3 points', () => {
    const ctx = makeMockCtx();
    bezierSmoothedLine(ctx, [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(ctx.bezierCurveTo).toHaveBeenCalledWith(1, 2, 3, 4, 5, 6);
  });
});

describe('drawSmoothLine', () => {
  it('does nothing for an empty array', () => {
    const ctx = makeMockCtx();
    drawSmoothLine(ctx, []);
    expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
    expect(ctx.lineTo).not.toHaveBeenCalled();
  });

  it('draws a single lineTo for one point', () => {
    const ctx = makeMockCtx();
    drawSmoothLine(ctx, [{ x: 5, y: 10 }]);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledWith(5, 10);
  });

  it('draws quadratic curves between midpoints for multiple points', () => {
    const ctx = makeMockCtx();
    drawSmoothLine(ctx, [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.quadraticCurveTo).toHaveBeenNthCalledWith(1, 0, 0, 5, 5);
    expect(ctx.quadraticCurveTo).toHaveBeenNthCalledWith(2, 10, 10, 15, 5);
  });
});

describe('catmullRomToBezier', () => {
  it('draws bezier curves for each consecutive pair', () => {
    const ctx = makeMockCtx();
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];
    catmullRomToBezier(ctx, pts, 0.5);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(2);
  });

  it('clamps endpoints using duplicate points', () => {
    const ctx = makeMockCtx();
    catmullRomToBezier(
      ctx,
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      1
    );
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(1);
  });
});

describe('drawPen', () => {
  it('begins a path, moves to the first point, smooths the rest, then strokes', () => {
    const ctx = makeMockCtx();
    const args = {
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      alpha: 1,
      color: '#000000',
      penType: 'pen' as const,
      lineWidth: 5,
      toolName: 'draw' as const,
    };
    drawPen({ args, ctx });
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(1, 1);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });
});

describe('drawSpray', () => {
  it('stamps a cored radial-gradient dab at every point, sized as a radius off the Size slider', () => {
    const ctx = makeMockCtx();
    const gradient = { addColorStop: vi.fn() };
    vi.spyOn(ctx, 'createRadialGradient').mockReturnValue(gradient);
    const args = {
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 15 },
      ],
      alpha: 0.8,
      color: '#ff0000',
      lineWidth: 10,
      toolName: 'draw' as const,
      penType: 'spray' as const,
    };
    drawSpray({ args, ctx });
    const rgb = hexToRgb('#ff0000');
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(2);

    // 0.4 of the Opacity, not a quarter of it: a quarter peaked at 0.2, which measured
    // rgb(223,223,223) for a single tap on white and read as haze rather than paint.
    expect(gradient.addColorStop).toHaveBeenCalledWith(0, `rgba(${rgb}, 0.32)`);
    // The peak is HELD over the inner quarter and only then falls to nothing, so a dab has
    // a body and a rim. The pre-fix two-stop ramp spent the whole dab as falloff, which is a
    // blur, and repeated passes accumulated haze instead of building a stroke.
    expect(gradient.addColorStop).toHaveBeenCalledWith(0.25, `rgba(${rgb}, 0.32)`);
    expect(gradient.addColorStop).toHaveBeenCalledWith(1, `rgba(${rgb}, 0)`);
    // 0.8 * 0.4 rounds to 0.32; the unrounded product is 0.32000000000000006 and the colour
    // string is compared literally, so the rounding is load-bearing rather than cosmetic.
    expect(gradient.addColorStop).not.toHaveBeenCalledWith(0, `rgba(${rgb}, 0.32000000000000006)`);

    // HALF the lineWidth, because Size is a diameter on every other pen. The pre-fix radius
    // was the whole `lineWidth`, so a 200px blot was painted at Size 100 and overflowed the
    // padding `pointsBoundingPos` reserves for the layer crop.
    expect(ctx.createRadialGradient).toHaveBeenCalledWith(5, 5, 0, 5, 5, 5);
    // The dab is a filled circle, not a path: the radius is the same 5 the gradient was
    // built with, so a mismatch between the two would stamp paint the gradient never covers.
    expect(ctx.arc).toHaveBeenCalledWith(5, 5, 5, 0, Math.PI * 2);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });
});

describe('drawLine', () => {
  it('dispatches to drawPen for pen type', () => {
    const ctx = makeMockCtx();
    const args = {
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      alpha: 1,
      color: '#000000',
      penType: 'pen' as const,
      lineWidth: 5,
      toolName: 'draw' as const,
    };
    const beginPathSpy = vi.spyOn(ctx, 'beginPath');
    drawLine({ args, ctx });
    expect(beginPathSpy).toHaveBeenCalled();
  });

  it('dispatches to drawSpray for spray type', () => {
    const ctx = makeMockCtx();
    const args = {
      points: [{ x: 5, y: 5 }],
      toolName: 'draw' as const,
      penType: 'spray' as const,
      alpha: 0.8,
      color: '#00ff00',
      lineWidth: 10,
    };
    vi.spyOn(ctx, 'createRadialGradient').mockReturnValue({ addColorStop: vi.fn() });
    const arcSpy = vi.spyOn(ctx, 'arc');
    drawLine({ args, ctx });
    expect(arcSpy).toHaveBeenCalled();
  });

  it('does nothing for pen-dashed by delegating to drawPen', () => {
    const ctx = makeMockCtx();
    const args = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      alpha: 1,
      color: '#000000',
      penType: 'pen-dashed' as const,
      lineWidth: 5,
      lineDash: [5, 5],
      toolName: 'draw' as const,
    };
    const strokeSpy = vi.spyOn(ctx, 'stroke');
    drawLine({ args, ctx });
    expect(strokeSpy).toHaveBeenCalled();
  });

  /**
   * The two arms the dispatch above cannot reach, because every existing case supplies both a
   * known `penType` and a non-empty `points`.
   *
   * An unrecognised pen type must paint NOTHING — a `switch` with a fallthrough to `drawPen`,
   * or a `?? 'pen'` default, would draw a stroke for a mode the tool does not have. And
   * `args.points ?? []` is the guard that makes a released gesture with no samples a no-op
   * rather than a `points[0]` crash, so both are asserted on the CALL COUNTS rather than on
   * `not.toThrow()`, which a silently-wrong path would also satisfy.
   */
  it('paints nothing for an unrecognised pen type', () => {
    const ctx = makeMockCtx();
    const args = {
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      alpha: 1,
      color: '#000000',
      penType: 'eraser' as unknown as 'pen',
      lineWidth: 5,
      toolName: 'draw' as const,
    };

    drawLine({ args, ctx });

    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('paints nothing when the args carry no points at all', () => {
    const ctx = makeMockCtx();
    const args = {
      alpha: 1,
      color: '#000000',
      penType: 'pen' as const,
      lineWidth: 5,
      toolName: 'draw' as const,
    } as unknown as Parameters<typeof drawLine>[0]['args'];

    drawLine({ args, ctx });

    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  /**
   * `smoothing` is applied by `drawLine` BEFORE the renderer choice, and no other case in this
   * file sets it. At 0 the input array is returned by identity, so the stroke is byte-for-byte
   * the unsmoothed one; at 50 the interior samples are pulled half of the way to the midpoint of
   * their neighbours while both endpoints stay put.
   *
   * The call COUNT is unchanged either way, which is the property the overlay depends on: a
   * smoothing filter that added or removed a sample would change how many beziers a live
   * stroke issues and leave the committed layer with a different number of segments than the
   * preview showed.
   */
  it('applies smoothing to the sampled path and leaves the endpoint count alone', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 100 },
      { x: 20, y: 0 },
    ];
    const build = (smoothing: number) => {
      const ctx = makeMockCtx();
      drawLine({
        args: {
          points,
          smoothing,
          alpha: 1,
          color: '#000000',
          penType: 'pen',
          lineWidth: 5,
          toolName: 'draw',
        } as unknown as Parameters<typeof drawLine>[0]['args'],
        ctx,
      });
      return ctx;
    };

    const unsmoothed = build(0);
    const smoothed = build(50);

    // moveTo the first sample, then one bezier per consecutive triple: 2 points are free.
    expect(unsmoothed.moveTo).toHaveBeenCalledWith(0, 0);
    expect(unsmoothed.bezierCurveTo).toHaveBeenCalledTimes(1);
    expect(smoothed.moveTo).toHaveBeenCalledWith(0, 0);
    expect(smoothed.bezierCurveTo).toHaveBeenCalledTimes(1);

    // 50% pull: the interior sample at (10, 100) moves halfway to the midpoint of (0,0) and
    // (20, 0), which is (10, 0), so it becomes (10, 50) — the spike is halved, not removed.
    expect(unsmoothed.bezierCurveTo).toHaveBeenCalledWith(0, 0, 10, 100, 20, 0);
    expect(smoothed.bezierCurveTo).toHaveBeenCalledWith(0, 0, 10, 50, 20, 0);
  });
});

/**
 * Block mode's stamping loop, whose arithmetic is exact and whose only other coverage is the
 * dispatch flag in `draw.destination-out.test.ts`.
 */
describe('drawPen with blockStamp', () => {
  const blockArgs = (lineWidth: number, points: { x: number; y: number }[]) =>
    ({
      points,
      blockStamp: true,
      alpha: 1,
      color: '#ff0000',
      penType: 'pen',
      lineWidth,
      toolName: 'draw',
    }) as unknown as Parameters<typeof drawPen>[0]['args'];

  it('stamps one square per `lineWidth` of travel, centred on each stamp', () => {
    const ctx = makeMockCtx();

    // 25px of travel at lineWidth 5 is exactly 5 steps, plus the first point: 6 stamps. The
    // step count divides evenly so every expected coordinate is exact rather than a float
    // expression of the code's own.
    drawPen({
      args: blockArgs(5, [
        { x: 0, y: 0 },
        { x: 25, y: 0 },
      ]),
      ctx,
    });

    expect(ctx.fillRect).toHaveBeenCalledTimes(6);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, -2.5, -2.5, 5, 5);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 2.5, -2.5, 5, 5);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(3, 7.5, -2.5, 5, 5);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(4, 12.5, -2.5, 5, 5);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(5, 17.5, -2.5, 5, 5);
    // The last stamp is the lifted point itself, so a stroke always ends where the pointer did.
    expect(ctx.fillRect).toHaveBeenNthCalledWith(6, 22.5, -2.5, 5, 5);
  });

  it('takes exactly one step for travel no greater than the stamp size', () => {
    const ctx = makeMockCtx();

    drawPen({
      args: blockArgs(10, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ]),
      ctx,
    });

    // ceil(0.4) clamps to 1: the endpoint is still stamped, and the two squares are adjacent.
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 4 - 5, -5, 10, 10);
  });

  it('stamps the endpoint of a duplicate pair once, so a held pointer adds nothing', () => {
    const ctx = makeMockCtx();

    // hypot is 0, and 0 / size is 0, so `Math.max(1, ...)` supplies the single step and the
    // stamp lands on top of the first one. The mutant is dropping the max, which would make
    // the step count 0 and silently drop the tail of the stroke.
    drawPen({
      args: blockArgs(10, [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
      ctx,
    });

    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, -5, -5, 10, 10);
  });

  it('clamps a zero or negative lineWidth to a 1px stamp instead of a negative one', () => {
    for (const lineWidth of [0, -4]) {
      const ctx = makeMockCtx();

      drawPen({ args: blockArgs(lineWidth, [{ x: 3, y: 4 }]), ctx });

      // A single point issues exactly one stamp. A negative width would be an invalid
      // fillRect, which a real canvas accepts and paints nothing for.
      expect(ctx.fillRect, String(lineWidth)).toHaveBeenCalledTimes(1);
      expect(ctx.fillRect, String(lineWidth)).toHaveBeenCalledWith(2.5, 3.5, 1, 1);
    }
  });

  it('issues no path at all, and paints fully opaque in the tool colour', () => {
    const ctx = makeMockCtx();

    drawPen({
      args: blockArgs(10, [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ]),
      ctx,
    });

    // The block is drawn as fillRect rather than as a stroked path, so `beginPath`/`stroke`
    // must not appear: a stroke would add a line cap the mode does not have.
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.globalAlpha).toBe(1);
  });

  it('stamps nothing at all for an empty point list, and does not touch the context', () => {
    const ctx = makeMockCtx();

    drawPen({ args: blockArgs(10, []), ctx });

    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });
});
