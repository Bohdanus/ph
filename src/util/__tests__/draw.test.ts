import { describe, expect, it, vi } from 'vitest';
import {
  pointsBoundingPos,
  pointsBoundingPosOutward,
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

  it('rounds fractional stroke bounds outward to integer raster dimensions', () => {
    const result = pointsBoundingPosOutward({
      points: [
        { x: 10.25, y: 20.75 },
        { x: 50.5, y: 40.125 },
      ],
      lineWidth: 1.5,
    });

    expect(result).toEqual({ x: 8, y: 19, width: 44, height: 23 });
  });

  it('rounds outward for every fractional drag, never inward', () => {
    for (const lineWidth of [0.5, 1, 2, 3, 3.5, 7]) {
      for (const points of [
        [
          { x: 10.4, y: 20.6 },
          { x: 50.2, y: 80.9 },
        ],
        [
          { x: -3.7, y: -1.2 },
          { x: 99.9, y: 12.05 },
        ],
        [
          { x: 0.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
      ]) {
        const bounds = pointsBoundingPosOutward({ points, lineWidth });
        const label = `lw=${lineWidth} ${points[0].x},${points[0].y} -> ${points[1].x},${points[1].y}`;

        expect(bounds.x, label).toBeLessThanOrEqual(Math.min(points[0].x, points[1].x) - lineWidth);
        expect(bounds.y, label).toBeLessThanOrEqual(Math.min(points[0].y, points[1].y) - lineWidth);
        expect(bounds.x + bounds.width, label).toBeGreaterThanOrEqual(Math.max(points[0].x, points[1].x) + lineWidth);
        expect(bounds.y + bounds.height, label).toBeGreaterThanOrEqual(Math.max(points[0].y, points[1].y) + lineWidth);
        expect(Number.isInteger(bounds.x), label).toBe(true);
        expect(Number.isInteger(bounds.y), label).toBe(true);
        expect(Number.isInteger(bounds.width), label).toBe(true);
        expect(Number.isInteger(bounds.height), label).toBe(true);
      }
    }
  });

  it('is the identity on integer geometry with an integral lineWidth', () => {
    const bounds = pointsBoundingPosOutward({
      points: [
        { x: 10, y: 20 },
        { x: 50, y: 60 },
      ],
      lineWidth: 2,
    });

    expect(bounds).toEqual({ x: 8, y: 18, width: 44, height: 44 });
  });

  it('rounds fractional bounds outward to integer raster dimensions', () => {
    // §163: pointer coordinates divided by the contain fit are fractional, and the
    // Draw tool must use its outward-rounded bounds before allocating the layer bitmap,
    // because `new OffscreenCanvas(width, height)` truncates fractional dimensions —
    // the declared box disagrees with its own raster by up to a pixel, and the composite
    // path draws back at the untruncated size with bilinear smoothing on.
    //
    // The fix mirrors shapeGeometryBounds: floor the origin, ceil the far edge.
    const result = pointsBoundingPosOutward({
      points: [
        { x: 10.25, y: 20.75 },
        { x: 50.5, y: 40.125 },
      ],
      lineWidth: 1.5,
    });

    // minX - lw = 8.75 → floor → 8; minY - lw = 19.25 → floor → 19
    // maxX + lw = 52 → ceil → 52; maxY + lw = 41.625 → ceil → 42
    // width = 52 - 8 = 44; height = 42 - 19 = 23
    expect(result).toEqual({ x: 8, y: 19, width: 44, height: 23 });
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('rounds outward on every axis for a fractional drag, never inward', () => {
    // Mirrors the shapeGeometryBounds sweep: the guarantee that matters is the direction
    // of the rounding. Inward rounding would clip a stroke the geometry genuinely covers,
    // and that only shows up on the axis whose fraction happens to round the wrong way.
    const lineWidths = [1, 2, 3, 3.5, 7, 7.5];
    const pointSets = [
      [
        { x: 0.3, y: 0.7 },
        { x: 10.4, y: 5.2 },
      ],
      [
        { x: -3.7, y: -1.2 },
        { x: 50.2, y: 80.9 },
      ],
      [
        { x: 0.5, y: 0.5 },
        { x: 99.9, y: 12.05 },
      ],
      [{ x: 12.3, y: 7.8 }],
    ];

    for (const lineWidth of lineWidths) {
      for (const points of pointSets) {
        const result = pointsBoundingPosOutward({ points, lineWidth });
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        // Outward rounding: the box must contain the padded geometry.
        expect(result.x, String(result)).toBeLessThanOrEqual(minX - lineWidth);
        expect(result.y, String(result)).toBeLessThanOrEqual(minY - lineWidth);
        expect(result.x + result.width, String(result)).toBeGreaterThanOrEqual(maxX + lineWidth);
        expect(result.y + result.height, String(result)).toBeGreaterThanOrEqual(maxY + lineWidth);
        // And every field is an integer, so the OffscreenCanvas constructor agrees.
        expect(Number.isInteger(result.x), String(result)).toBe(true);
        expect(Number.isInteger(result.y), String(result)).toBe(true);
        expect(Number.isInteger(result.width), String(result)).toBe(true);
        expect(Number.isInteger(result.height), String(result)).toBe(true);
        // A valid canvas size: ceil is identity, so the buffer is no larger than declared.
        expect(Math.ceil(result.width), String(result)).toBe(result.width);
        expect(Math.ceil(result.height), String(result)).toBe(result.height);
      }
    }
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

  it('keeps the initial tap unchanged and scales later deposits by Flow and elapsed time', () => {
    const ctx = makeMockCtx();
    const gradients: CanvasGradient[] = [];
    vi.spyOn(ctx, 'createRadialGradient').mockImplementation(() => {
      const gradient: CanvasGradient = { addColorStop: vi.fn() };
      gradients.push(gradient);
      return gradient;
    });
    const args = {
      points: [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      pointTimes: [0, 8.3],
      alpha: 0.8,
      flow: 50,
      color: '#ff0000',
      lineWidth: 10,
      toolName: 'draw' as const,
      penType: 'spray' as const,
    };

    drawSpray({ args, ctx });

    const rgb = hexToRgb('#ff0000');
    expect(gradients[0].addColorStop).toHaveBeenCalledWith(0, `rgba(${rgb}, 0.32)`);
    expect(gradients[1].addColorStop).toHaveBeenCalledWith(0, `rgba(${rgb}, 0.16)`);

    const slower = makeMockCtx();
    const slowerGradient: CanvasGradient = { addColorStop: vi.fn() };
    vi.spyOn(slower, 'createRadialGradient').mockReturnValue(slowerGradient);
    drawSpray({
      args: { ...args, flow: 25, pointTimes: [0, 16.6] },
      ctx: slower,
    });
    expect(slowerGradient.addColorStop).toHaveBeenCalledWith(0, `rgba(${rgb}, 0.1536)`);

    const tap = makeMockCtx();
    const tapGradient: CanvasGradient = { addColorStop: vi.fn() };
    vi.spyOn(tap, 'createRadialGradient').mockReturnValue(tapGradient);
    drawSpray({ args: { ...args, points: [args.points[0]], pointTimes: [0], flow: 1 }, ctx: tap });
    expect(tapGradient.addColorStop).toHaveBeenCalledWith(0, `rgba(${rgb}, 0.32)`);
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
});

describe('pointsBoundingPos edge cases', () => {
  // `getPointExtents` reads `points[0]` unconditionally, so a bounds helper handed an empty
  // sample throws before the renderer's `points.length === 0` guard can save it. The renderer
  // guards, the geometry helper does not — which is the fragility these cases pin down.

  it('propagates NaN coordinates through the box as NaN (known behaviour)', () => {
    const result = pointsBoundingPos({
      points: [
        { x: Number.NaN, y: Number.NaN },
        { x: 4, y: 4 },
      ],
    });

    expect(Number.isNaN(result.x)).toBe(true);
    expect(Number.isNaN(result.y)).toBe(true);
    expect(Number.isNaN(result.width)).toBe(true);
    expect(Number.isNaN(result.height)).toBe(true);
  });

  it('propagates +Infinity coordinates into an unbounded width (known behaviour)', () => {
    const result = pointsBoundingPos({
      points: [
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 4, y: 4 },
      ],
    });

    expect(result.width).toBe(Infinity);
    expect(result.height).toBe(6);
  });

  it.fails('does not throw on empty points and returns a zero-sized box (draw.ts:7)', () => {
    expect(() => pointsBoundingPos({ points: [] })).not.toThrow();
  });

  it.fails('clamps a non-finite lineWidth rather than letting it poison the box (draw.ts:25)', () => {
    for (const lineWidth of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = pointsBoundingPos({
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
        ],
        lineWidth,
      });

      expect(Number.isFinite(result.width), `lw=${lineWidth}`).toBe(true);
    }
  });
});

describe('pointsBoundingPosOutward edge cases', () => {
  it.fails('does not throw on empty points and returns a zero-sized box (draw.ts:37)', () => {
    expect(() => pointsBoundingPosOutward({ points: [] })).not.toThrow();
  });

  it.fails('clamps a non-finite lineWidth rather than emitting NaN or infinite raster dimensions (draw.ts:37)', () => {
    for (const lineWidth of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = pointsBoundingPosOutward({
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 4 },
        ],
        lineWidth,
      });

      expect(Number.isFinite(result.width), `lw=${lineWidth}`).toBe(true);
      expect(Number.isInteger(result.width), `lw=${lineWidth}`).toBe(true);
    }
  });

  it.fails('sanitizes non-finite coordinates instead of emitting a NaN box (draw.ts:37)', () => {
    const result = pointsBoundingPosOutward({
      points: [
        { x: Number.NaN, y: Number.NaN },
        { x: 4, y: 4 },
      ],
    });

    expect(Number.isFinite(result.width)).toBe(true);
  });
});

describe('degenerate stroke rendering', () => {
  // A click with the Draw tool is the only committed single-point gesture (pointerdown pushes
  // exactly one point, `DrawToolArea.tsx:129`), so the single-point branch of every renderer must
  // be exercised, not only the empty short-circuit.

  it('drawPen is a no-op on an empty point set', () => {
    const ctx = makeMockCtx();
    drawPen({
      args: {
        points: [],
        alpha: 1,
        color: '#000000',
        penType: 'pen',
        lineWidth: 5,
        toolName: 'draw',
      },
      ctx,
    });

    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.moveTo).not.toHaveBeenCalled();
    expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('drawSpray is a no-op on an empty point set', () => {
    const ctx = makeMockCtx();
    drawSpray({
      args: {
        points: [],
        alpha: 0.8,
        color: '#ff0000',
        penType: 'spray',
        lineWidth: 10,
        toolName: 'draw',
      },
      ctx,
    });

    expect(ctx.createRadialGradient).not.toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('bezierSmoothedLine draws one lineTo and no curve for a single point', () => {
    const ctx = makeMockCtx();
    bezierSmoothedLine(ctx, [{ x: 5, y: 10 }]);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledWith(5, 10);
    expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
  });

  it('catmullRomToBezier issues no curve for a single point', () => {
    const ctx = makeMockCtx();
    catmullRomToBezier(ctx, [{ x: 5, y: 10 }]);
    expect(ctx.bezierCurveTo).not.toHaveBeenCalled();
  });

  it('passes NaN coordinates straight through to the path command (known behaviour)', () => {
    const ctx = makeMockCtx();
    drawSmoothLine(ctx, [{ x: Number.NaN, y: Number.NaN }]);
    expect(ctx.lineTo).toHaveBeenCalledTimes(1);
    expect(ctx.lineTo).toHaveBeenCalledWith(Number.NaN, Number.NaN);
  });
});

describe('non-finite lineWidth in renderers', () => {
  it('passes a NaN lineWidth straight through to the block stamp size (known behaviour)', () => {
    const ctx = makeMockCtx();
    drawPen({
      args: {
        points: [{ x: 0, y: 0 }],
        alpha: 1,
        color: '#000000',
        penType: 'pen',
        lineWidth: Number.NaN,
        toolName: 'draw',
        blockStamp: true,
      },
      ctx,
    });

    const stampWidth = vi.mocked(ctx.fillRect).mock.calls[0][2];
    expect(Number.isNaN(stampWidth)).toBe(true);
  });

  it.fails('clamps a non-finite lineWidth for block stamps instead of stamping a NaN-sized tile (draw.ts:138)', () => {
    const ctx = makeMockCtx();
    drawPen({
      args: {
        points: [{ x: 0, y: 0 }],
        alpha: 1,
        color: '#000000',
        penType: 'pen',
        lineWidth: Number.NaN,
        toolName: 'draw',
        blockStamp: true,
      },
      ctx,
    });

    const stampWidth = vi.mocked(ctx.fillRect).mock.calls[0][2];
    expect(Number.isFinite(stampWidth)).toBe(true);
  });

  it.fails('clamps a non-finite lineWidth to a finite spray radius (draw.ts:221)', () => {
    const ctx = makeMockCtx();
    drawSpray({
      args: {
        points: [{ x: 5, y: 5 }],
        alpha: 0.8,
        color: '#ff0000',
        penType: 'spray',
        lineWidth: Number.NaN,
        toolName: 'draw',
      },
      ctx,
    });

    const radius = vi.mocked(ctx.arc).mock.calls[0][2];
    expect(Number.isFinite(radius)).toBe(true);
  });
});
