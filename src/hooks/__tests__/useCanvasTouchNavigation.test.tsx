import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  absoluteViewZoom,
  inverseViewPoint,
  minimumSliderZoomForCurrentView,
  type ViewState,
  zoomAroundViewportPoint,
} from '../../contexts/view-state.ts';
import { useCanvasTouchNavigation } from '../useCanvasTouchNavigation.ts';

const state = vi.hoisted(() => {
  const viewState: ViewState = {
    zoom: 1,
    fitScaleCompensation: 1,
    rotation: 0,
    panX: 17,
    panY: -11,
    fitToScreen: true,
  } satisfies ViewState;
  const viewStateRef = { current: { ...viewState } };
  const setViewState = vi.fn((partial: Partial<ViewState>) => {
    const changesTransform = ['panX', 'panY', 'zoom', 'rotation'].some((key) => key in partial);
    viewStateRef.current = {
      ...viewStateRef.current,
      ...partial,
      fitToScreen: partial.fitToScreen ?? (changesTransform ? false : viewStateRef.current.fitToScreen),
    };
  });
  return {
    containerRef: { current: null as HTMLDivElement | null },
    documentFrame: { x: 0, y: 0, width: 800, height: 600 },
    hasImage: true,
    devicePixelRatio: 1,
    fitScale: 0.5,
    viewStateRef,
    setViewState,
  };
});

const toolEvents = vi.hoisted(() => ({
  downs: [] as number[],
  moves: [] as number[],
  ups: [] as number[],
  cancels: [] as number[],
}));

const pointerCaptures = new Map<number, Element>();
const pointerCaptureMethodNames = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const;
const originalPointerCaptureMethods = new Map<string, PropertyDescriptor | undefined>();

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [state, vi.fn()],
}));

vi.mock('../useWorkspaceFitScale.ts', () => ({
  useWorkspaceFitScale: () => state.fitScale,
}));

vi.mock('../useDevicePixelRatio.ts', () => ({
  useDevicePixelRatio: () => state.devicePixelRatio,
}));

vi.mock('../../util/client-viewport.ts', () => ({
  readClientViewportRect: (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  },
}));

function ToolSurface() {
  return (
    <div
      data-testid="tool-surface"
      onPointerCancel={(event) => {
        toolEvents.cancels.push(event.pointerId);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerDown={(event) => {
        toolEvents.downs.push(event.pointerId);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => toolEvents.moves.push(event.pointerId)}
      onPointerUp={(event) => {
        toolEvents.ups.push(event.pointerId);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}

function Harness({ withEditableTarget = false }: { withEditableTarget?: boolean }) {
  const handlers = useCanvasTouchNavigation();
  return (
    <div
      {...handlers}
      ref={(element) => {
        state.containerRef.current = element;
      }}
      className="zoom-container"
      data-testid="touch-surface"
      style={{ touchAction: 'none' }}
    >
      <ToolSurface />
      {withEditableTarget && <div contentEditable="true" data-testid="text-editor" />}
    </div>
  );
}

function renderHarness(options?: { withEditableTarget?: boolean }) {
  const result = render(<Harness {...options} />);
  const surface = screen.getByTestId('touch-surface') as HTMLDivElement;
  surface.getBoundingClientRect = () =>
    ({ x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600 }) as DOMRect;
  return { ...result, surface, tool: screen.getByTestId('tool-surface') };
}

function touchDown(target: Element, pointerId: number, clientX: number, clientY: number) {
  fireEvent.pointerDown(target, { button: 0, pointerId, pointerType: 'touch', clientX, clientY });
}

function touchMove(target: Element, pointerId: number, clientX: number, clientY: number) {
  fireEvent.pointerMove(target, { pointerId, pointerType: 'touch', clientX, clientY });
}

function touchUp(target: Element, pointerId: number, clientX: number, clientY: number) {
  fireEvent.pointerUp(target, { button: 0, pointerId, pointerType: 'touch', clientX, clientY });
}

beforeEach(() => {
  for (const name of pointerCaptureMethodNames) {
    if (!originalPointerCaptureMethods.has(name)) {
      originalPointerCaptureMethods.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    }
  }
  pointerCaptures.clear();
  toolEvents.downs = [];
  toolEvents.moves = [];
  toolEvents.ups = [];
  toolEvents.cancels = [];
  state.hasImage = true;
  state.devicePixelRatio = 1;
  state.fitScale = 0.5;
  state.viewStateRef.current = {
    zoom: 1,
    fitScaleCompensation: 1,
    rotation: 0,
    panX: 17,
    panY: -11,
    fitToScreen: true,
  };
  state.setViewState.mockClear();

  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        pointerCaptures.set(pointerId, this);
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        if (pointerCaptures.get(pointerId) === this) pointerCaptures.delete(pointerId);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        return pointerCaptures.get(pointerId) === this;
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of pointerCaptureMethodNames) {
    const descriptor = originalPointerCaptureMethods.get(name);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe('useCanvasTouchNavigation', () => {
  it('leaves a single touch with the selected tool through pointerup', () => {
    const { tool } = renderHarness();

    touchDown(tool, 4, 100, 100);
    touchMove(tool, 4, 120, 130);
    touchUp(tool, 4, 120, 130);

    expect(toolEvents.downs).toEqual([4]);
    expect(toolEvents.moves).toEqual([4]);
    expect(toolEvents.ups).toEqual([4]);
    expect(toolEvents.cancels).toEqual([]);
    expect(state.setViewState).not.toHaveBeenCalled();
  });

  it.each([1, 3])('cancels the tool gesture once and anchors pinch zoom at the moving centroid at DPR %s', (dpr) => {
    state.devicePixelRatio = dpr;
    const { tool, surface } = renderHarness();
    const startView = { ...state.viewStateRef.current };
    const startDocumentPoint = inverseViewPoint({ x: 140, y: 80 }, startView, { x: 400, y: 300 });

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);

    expect(toolEvents.downs).toEqual([4]);
    expect(toolEvents.cancels).toEqual([4]);
    expect(toolEvents.ups).toEqual([]);
    expect(pointerCaptures.get(4)).toBe(surface);
    expect(pointerCaptures.get(9)).toBe(surface);

    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);

    expect(toolEvents.moves).toEqual([]);
    const nextView = state.viewStateRef.current;
    const documentPointAtMovedCentroid = inverseViewPoint({ x: 140, y: 100 }, nextView, { x: 400, y: 300 });
    expect(documentPointAtMovedCentroid.x).toBeCloseTo(startDocumentPoint.x, 8);
    expect(documentPointAtMovedCentroid.y).toBeCloseTo(startDocumentPoint.y, 8);
    expect(nextView.zoom).toBeCloseTo(1.4, 8);
    const anchored = zoomAroundViewportPoint(startView, nextView.zoom, { x: 140, y: 80 }, { x: 400, y: 300 });
    expect(nextView.panX).toBeCloseTo(anchored.panX, 8);
    expect(nextView.panY).toBeCloseTo(anchored.panY + 20, 8);
    expect(nextView.rotation).toBe(startView.rotation);
  });

  it('uses the current fit compensation when the workspace resizes during a pinch', () => {
    const { rerender, tool } = renderHarness();

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);

    state.fitScale = 0.25;
    state.viewStateRef.current = {
      ...state.viewStateRef.current,
      zoom: 1,
      fitScaleCompensation: 2,
    };
    rerender(<Harness />);

    touchMove(tool, 4, 50, 100);
    touchMove(tool, 9, 350, 100);

    expect(state.viewStateRef.current.zoom).toBeCloseTo(2, 8);
  });

  it('continues a pinch as one-finger pan and freezes when a third touch arrives', () => {
    const { tool, surface } = renderHarness();
    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);

    touchUp(surface, 4, 80, 120);
    const afterPinch = { ...state.viewStateRef.current };
    touchMove(tool, 9, 240, 130);
    expect(state.viewStateRef.current.panX).toBeCloseTo(afterPinch.panX + 20, 8);
    expect(state.viewStateRef.current.panY).toBeCloseTo(afterPinch.panY + 10, 8);

    touchDown(tool, 12, 300, 130);
    const beforeBlockedMoves = state.setViewState.mock.calls.length;
    touchMove(tool, 9, 260, 160);
    touchMove(tool, 12, 320, 150);
    expect(state.setViewState).toHaveBeenCalledTimes(beforeBlockedMoves);
    expect(toolEvents.moves).toEqual([]);

    touchUp(surface, 12, 320, 150);
    touchUp(surface, 9, 260, 160);
    touchDown(tool, 14, 100, 100);
    touchUp(tool, 14, 100, 100);
    expect(toolEvents.downs).toEqual([4, 14]);
    expect(toolEvents.ups).toEqual([14]);
  });

  it('does not take over text editing and stops an interrupted pinch after pointer cancellation', () => {
    const { tool, surface } = renderHarness({ withEditableTarget: true });
    const textEditor = screen.getByTestId('text-editor');

    touchDown(textEditor, 4, 100, 100);
    touchDown(textEditor, 9, 200, 100);
    expect(toolEvents.cancels).toEqual([]);
    expect(state.setViewState).not.toHaveBeenCalled();

    touchDown(tool, 12, 100, 100);
    touchDown(tool, 14, 200, 100);
    touchMove(tool, 14, 220, 120);
    fireEvent.pointerCancel(surface, { pointerId: 14, pointerType: 'touch' });
    const afterCancel = { ...state.viewStateRef.current };
    touchMove(tool, 12, 80, 120);
    expect(state.viewStateRef.current).toEqual(afterCancel);
    touchUp(surface, 12, 80, 120);

    touchDown(tool, 16, 100, 100);
    touchUp(tool, 16, 100, 100);
    expect(toolEvents.downs).toContain(16);
    expect(toolEvents.ups).toContain(16);
  });

  it('clears a gesture after root capture is lost, even when later releases land outside the canvas', () => {
    const { tool, surface } = renderHarness();
    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    pointerCaptures.delete(4);
    fireEvent.lostPointerCapture(surface, { pointerId: 4, pointerType: 'touch' });

    const afterLoss = { ...state.viewStateRef.current };
    touchMove(tool, 9, 240, 120);
    touchUp(document.body, 4, 100, 100);
    touchUp(document.body, 9, 240, 120);
    expect(state.viewStateRef.current).toEqual(afterLoss);

    touchDown(tool, 12, 100, 100);
    touchUp(tool, 12, 100, 100);
    expect(toolEvents.downs).toEqual([4, 12]);
    expect(toolEvents.ups).toEqual([12]);
  });

  it('clamps pinch zoom to the minimum zoom floor and does not go below it', () => {
    const { tool } = renderHarness();
    state.fitScale = 0.5;
    state.devicePixelRatio = 1;
    state.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
    const initialView = { ...state.viewStateRef.current };
    const minimumMagnification = minimumSliderZoomForCurrentView(
      state.documentFrame,
      absoluteViewZoom(initialView, state.fitScale, state.devicePixelRatio),
      initialView.minimumZoomOverride
    );

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);

    touchMove(tool, 4, 110, 100);
    touchMove(tool, 9, 190, 100);

    const zoomAfterFirstMove = state.viewStateRef.current.zoom;
    expect(zoomAfterFirstMove).toBeGreaterThan(0);

    touchMove(tool, 4, 120, 100);
    touchMove(tool, 9, 180, 100);

    const zoomAfterSecondMove = state.viewStateRef.current.zoom;
    expect(zoomAfterSecondMove).toBeLessThan(zoomAfterFirstMove);

    touchMove(tool, 4, 150, 100);
    touchMove(tool, 9, 150, 100);

    const finalMagnification = absoluteViewZoom(state.viewStateRef.current, state.fitScale, state.devicePixelRatio);
    expect(finalMagnification).toBeGreaterThanOrEqual(minimumMagnification);
  });

  it('does not start navigation when hasImage is false but still allows tool events through', () => {
    state.hasImage = false;
    const { tool } = renderHarness();

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);
    touchUp(tool, 4, 80, 120);
    touchUp(tool, 9, 220, 120);

    expect(state.setViewState).not.toHaveBeenCalled();
    expect(toolEvents.downs).toEqual([4, 9]);
    expect(toolEvents.ups).toEqual([4, 9]);
  });

  it('clears the gesture on window blur during an active pinch', () => {
    const { tool, surface } = renderHarness();
    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);

    expect(state.setViewState).toHaveBeenCalled();

    fireEvent(window, new Event('blur'));

    const afterBlur = { ...state.viewStateRef.current };
    touchMove(tool, 4, 60, 140);
    touchMove(tool, 9, 240, 140);
    touchUp(surface, 4, 60, 140);
    touchUp(surface, 9, 240, 140);

    expect(state.viewStateRef.current).toEqual(afterBlur);

    touchDown(tool, 12, 100, 100);
    touchUp(tool, 12, 100, 100);
    expect(toolEvents.downs).toContain(12);
  });

  it('continues the one-finger pan without jumping when the workspace resizes after pinch', () => {
    const { tool, surface, rerender } = renderHarness();
    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);
    touchUp(surface, 4, 80, 120);

    touchMove(tool, 9, 240, 130);
    const panAfterMove = state.viewStateRef.current.panX;

    state.fitScale = 0.25;
    surface.getBoundingClientRect = () =>
      ({ x: 30, y: 40, left: 30, top: 40, right: 1030, bottom: 740, width: 1000, height: 700 }) as DOMRect;
    state.viewStateRef.current = {
      ...state.viewStateRef.current,
      zoom: 1,
      fitScaleCompensation: 2,
    };
    rerender(<Harness />);

    touchMove(tool, 9, 260, 140);
    expect(state.viewStateRef.current.panX).toBeCloseTo(panAfterMove + 20, 8);
  });

  it('handles rotation in view state during pinch by anchoring to the rotating document point', () => {
    const { tool } = renderHarness();
    state.viewStateRef.current = {
      ...state.viewStateRef.current,
      rotation: 45,
    };

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);

    expect(state.viewStateRef.current.rotation).toBe(45);
    expect(state.viewStateRef.current.zoom).toBeCloseTo(1.4, 1);
  });

  it('resumes navigation after a third touch blocks, once all touches are lifted', () => {
    const { tool, surface } = renderHarness();
    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);
    touchMove(tool, 4, 80, 120);
    touchMove(tool, 9, 220, 120);
    touchUp(surface, 4, 80, 120);

    const afterPinch = { ...state.viewStateRef.current };
    touchMove(tool, 9, 240, 130);
    expect(state.viewStateRef.current.panX).toBeCloseTo(afterPinch.panX + 20, 8);

    touchDown(tool, 12, 300, 130);
    const beforeBlockedMoves = state.setViewState.mock.calls.length;
    touchMove(tool, 9, 260, 160);
    touchMove(tool, 12, 320, 150);
    expect(state.setViewState).toHaveBeenCalledTimes(beforeBlockedMoves);

    touchUp(surface, 12, 320, 150);
    touchUp(surface, 9, 260, 160);

    touchDown(tool, 14, 100, 100);
    touchDown(tool, 15, 200, 100);
    touchMove(tool, 14, 80, 120);
    touchMove(tool, 15, 220, 120);

    expect(state.viewStateRef.current.zoom).toBeCloseTo(afterPinch.zoom * 1.4, 1);
    expect(toolEvents.downs).toEqual([4, 14]);
    expect(toolEvents.ups).toEqual([]);
  });

  it('does not call setViewState when pointer capture fails during the capture phase', () => {
    const { tool } = renderHarness();

    const originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    let captureCallCount = 0;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value(this: HTMLElement, pointerId: number) {
        captureCallCount++;
        if (captureCallCount >= 2) {
          throw new Error('Capture failed');
        }
        return originalSetPointerCapture.call(this, pointerId);
      },
    });

    touchDown(tool, 4, 100, 100);
    touchDown(tool, 9, 200, 100);

    expect(state.setViewState).not.toHaveBeenCalled();

    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: originalSetPointerCapture,
    });
  });
});
