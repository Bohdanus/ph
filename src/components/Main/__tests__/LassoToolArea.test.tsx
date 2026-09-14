/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Point } from '../../../contexts/general-types.ts';
import { pointsBoundingPos } from '../../../util/draw.ts';
import { PolygonClickToolArea } from '../PolygonClickToolArea.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());

// Mock dependencies
vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: any) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: { current: true },
  }),
}));

vi.mock('../../../hooks/usePolylineAnts.ts', () => ({
  useMarchingPath: () => ({
    draw: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      toolOverlayRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: { toolName: 'polygonal-lasso', mode: 'outline' },
  }),
}));

describe('PolygonClickToolArea', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
  });

  it('pointsBoundingPos calculates correct bounding box', () => {
    const points: Point[] = [
      { x: 10, y: 20 },
      { x: 100, y: 150 },
      { x: 50, y: 75 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 1 });

    expect(pos.x).toBe(9); // 10 - 1
    expect(pos.y).toBe(19); // 20 - 1
    expect(pos.width).toBe(92); // 100 - 10 + 2*1
    expect(pos.height).toBe(132); // 150 - 20 + 2*1
  });

  it('pointsBoundingPos handles single point', () => {
    const points: Point[] = [{ x: 50, y: 50 }];
    const pos = pointsBoundingPos({ points, lineWidth: 2 });

    expect(pos.x).toBe(48); // 50 - 2
    expect(pos.y).toBe(48); // 50 - 2
    expect(pos.width).toBe(4); // 0 + 2*2
    expect(pos.height).toBe(4); // 0 + 2*2
  });

  it('pointsBoundingPos handles negative coordinates', () => {
    const points: Point[] = [
      { x: -100, y: -50 },
      { x: 100, y: 50 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 5 });

    expect(pos.x).toBe(-105); // -100 - 5
    expect(pos.y).toBe(-55); // -50 - 5
    expect(pos.width).toBe(210); // 200 + 2*5
    expect(pos.height).toBe(110); // 100 + 2*5
  });

  it('pointsBoundingPos handles large line widths', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];

    const pos = pointsBoundingPos({ points, lineWidth: 20 });

    expect(pos.x).toBe(-20);
    expect(pos.y).toBe(-20);
    expect(pos.width).toBe(50); // 10 + 2*20
    expect(pos.height).toBe(50); // 10 + 2*20
  });

  it('finishes a polygonal selection on double-click without adding a duplicate final point', () => {
    const mockCtx = {
      canvas: { width: 800, height: 600 },
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      setLineDash: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    const { container } = render(
      <PolygonClickToolArea overlayCtxRef={{ current: mockCtx }} className="test-lasso-area" />
    );

    const toolArea = container.firstElementChild as HTMLDivElement;

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 10 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 101, clientY: 101 });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_SELECTION',
        payload: expect.objectContaining({
          points: [
            { x: 1, y: 1 },
            { x: 91, y: 1 },
            { x: 91, y: 91 },
          ],
          pos: { x: 9, y: 9, width: 92, height: 92 },
        }),
      })
    );
  });
});
