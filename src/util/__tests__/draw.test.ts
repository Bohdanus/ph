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

function makeMockCtx() {
  return {
    canvas: { width: 100, height: 100 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as CanvasRenderingContext2D;
}

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
  it('draws a radial gradient circle at every point', () => {
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
    expect(ctx.createRadialGradient).toHaveBeenCalledTimes(2);
    expect(gradient.addColorStop).toHaveBeenCalledWith(0, `rgba(${hexToRgb('#ff0000')}, ${0.8 / 4})`);
    expect(gradient.addColorStop).toHaveBeenCalledWith(1, `rgba(${hexToRgb('#ff0000')}, 0)`);
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
