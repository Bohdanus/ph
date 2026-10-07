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
});
