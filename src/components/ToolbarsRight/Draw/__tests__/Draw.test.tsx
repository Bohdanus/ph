import { useEffect, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Draw from '../Draw.tsx';
import { savedDrawPerPen } from '../../../../tools/settings.ts';
import type { DrawToolArgs, PenType } from '../../../../tools/draw.ts';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const storeState = vi.hoisted(() => ({
  color: '#000000',
  containerRef: { current: null as HTMLDivElement | null },
  totalSize: { width: 800, height: 600 },
}));

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real `setToolArgs`
 * publishes a new args object back into React state, so the readouts and the preview repaint;
 * a bare spy never does. Real `useState` (rather than assigning a module variable) is what makes
 * the repaint observable here, because the repo compiles with `babel-plugin-react-compiler`,
 * which memoizes `<Draw />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const drawSizeMock = vi.hoisted(() => vi.fn());
const drawCreatorMock = vi.hoisted(() => vi.fn());
const pointerScale = vi.hoisted(() => ({ value: 1 }));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState(toolState.initial);
      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          mockSetToolArgs(next);
          toolState.initial = next;
          setArgs(next);
        },
      };
    },
  };
});

vi.mock('../../../../hooks/usePointerPosition.ts', () => ({
  // `onResize` is invoked once per scale so `brushScale` is non-zero and the preview effect
  // actually runs; changing `pointerScale.value` and forcing a re-render notifies the component
  // about the new zoom level.
  usePointerPosition: ({ onResize }: { onResize?: (arg: { scale: number }) => void }) => {
    const notifiedScale = useRef<number | null>(null);
    useEffect(() => {
      if (notifiedScale.current === pointerScale.value) return;
      notifiedScale.current = pointerScale.value;
      onResize?.({ scale: pointerScale.value });
    });
    return {
      isPointerDownValid: vi.fn(() => false),
      isPointerMoveValid: vi.fn(() => false),
      isPointerUpValid: vi.fn(() => false),
      getLocalCoords: vi.fn(() => ({ x: 0, y: 0 })),
      isMouseDown: { current: false },
    };
  },
}));

vi.mock('../../../../tools/draw.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../../tools/draw.ts')>('../../../../tools/draw.ts');
  return {
    ...actual,
    draw: (...args: Parameters<typeof actual.draw>) => {
      drawSizeMock(args[0]);
      const creator = actual.draw(...args);
      return (previewArgs: Parameters<typeof creator>[0]) => {
        drawCreatorMock(previewArgs);
        return creator(previewArgs);
      };
    },
  };
});

const PRISTINE_SAVED_DRAW_PER_PEN = structuredClone(savedDrawPerPen);

function resetState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    color: '#000000',
    containerRef: { current: null },
    totalSize: { width: 800, height: 600 },
    ...overrides,
  });
}

function resetToolArgs(overrides: Partial<DrawToolArgs> = {}) {
  toolState.initial = {
    toolName: 'draw',
    penType: 'pen' as PenType,
    lineWidth: 5,
    alpha: 1,
    color: '#000000',
    lineDash: null,
    ...overrides,
  };
  return toolState.initial as DrawToolArgs;
}

const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as DrawToolArgs;

const getPenTypeSelect = () => screen.getByLabelText('Pen Type') as HTMLSelectElement;
const getSizeSlider = () => screen.getByLabelText(/Size/) as HTMLInputElement;
const getAlphaSlider = () => screen.getByLabelText(/Opacity/) as HTMLInputElement;
const getDashSlider = () => screen.getByLabelText(/Dash/) as HTMLInputElement;
const getGapSlider = () => screen.getByLabelText(/Gap/) as HTMLInputElement;
const previewCanvas = () => document.querySelector('canvas') as HTMLCanvasElement;

function changeSize(value: string) {
  fireEvent.change(getSizeSlider(), { target: { value } });
}

function changeAlpha(value: string) {
  fireEvent.change(getAlphaSlider(), { target: { value } });
}

function changeDash(value: string) {
  fireEvent.change(getDashSlider(), { target: { value } });
}

function changeGap(value: string) {
  fireEvent.change(getGapSlider(), { target: { value } });
}

function selectPenType(value: PenType) {
  fireEvent.change(getPenTypeSelect(), { target: { value } });
}

/** The angles the preview arc is sampled at (Draw.tsx:91-95). */
const PREVIEW_ARC_ANGLES = [-1 / 2, -1 / 2 + Math.PI / 2, -1 / 2 + Math.PI];

const expectedPreviewPoints = (scale: number) => {
  const radius = PREVIEW_HEIGHT / 2.2 / scale;
  const centerX = PREVIEW_WIDTH / 2.1 / scale;
  const centerY = PREVIEW_HEIGHT / 2.4 / scale;
  return PREVIEW_ARC_ANGLES.map((angle) => ({
    x: centerX + 2 * Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  }));
};

const lastPreviewArgs = () =>
  drawCreatorMock.mock.lastCall?.[0] as DrawToolArgs & { points?: { x: number; y: number }[] };
const lastPreviewSize = () => drawSizeMock.mock.lastCall?.[0] as { size: { width: number; height: number } };

/**
 * Captures the 2d context handed to the preview canvas so the rasterisation calls
 * (`clearRect`, `drawImage`) can be asserted on. The global setup installs a fresh mock
 * context per `getContext` call, so the spy has to delegate to it and keep the result.
 */
function capturePreviewContext() {
  const installed = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation();
  if (!installed) throw new Error('the global canvas context stub from src/test/setup.ts is missing');
  const contexts: CanvasRenderingContext2D[] = [];
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement
  ) {
    const ctx = installed.call(this, '2d') as CanvasRenderingContext2D;
    contexts.push(ctx);
    return ctx;
  });
  return { spy, contexts, last: () => contexts[contexts.length - 1] };
}

describe('Draw toolbar', () => {
  beforeEach(() => {
    Object.assign(savedDrawPerPen, structuredClone(PRISTINE_SAVED_DRAW_PER_PEN));
    resetState();
    resetToolArgs();
    mockSetToolArgs.mockClear();
    drawSizeMock.mockClear();
    drawCreatorMock.mockClear();
    pointerScale.value = 1;
  });

  afterEach(() => {
    Object.assign(savedDrawPerPen, structuredClone(PRISTINE_SAVED_DRAW_PER_PEN));
    pointerScale.value = 1;
  });

  it('renders pen type selector and size slider', () => {
    render(<Draw />);

    expect(screen.getByLabelText('Pen Type')).toBeInTheDocument();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Opacity/)).toBeInTheDocument();
  });

  it('renders dash/gap controls when pen-dashed is selected', () => {
    resetToolArgs({ penType: 'pen-dashed', lineDash: [10, 5] });
    render(<Draw />);

    expect(screen.getByLabelText(/Dash/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gap/)).toBeInTheDocument();
  });

  it('does not render dash/gap controls when pen is selected', () => {
    resetToolArgs({ penType: 'pen' });
    render(<Draw />);

    expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Gap/)).not.toBeInTheDocument();
  });

  it('does not render dash/gap controls when spray is selected', () => {
    resetToolArgs({ penType: 'spray' });
    render(<Draw />);

    expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Gap/)).not.toBeInTheDocument();
  });

  it('dispatches pen type changes to setToolArgs', () => {
    render(<Draw />);

    fireEvent.change(screen.getByLabelText('Pen Type'), { target: { value: 'pen-dashed' } });

    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ penType: 'pen-dashed' }));
  });

  describe('pen type select', () => {
    it('exposes exactly the three supported pen types in DOM order', () => {
      render(<Draw />);

      const options = Array.from(getPenTypeSelect().options, (option) => option.value);
      expect(options).toEqual(['pen', 'pen-dashed', 'spray']);
      expect(getPenTypeSelect()).toHaveValue('pen');
    });

    it('publishes the saved pen-dashed settings together with the new pen type', () => {
      resetToolArgs({ lineWidth: 5, alpha: 1, lineDash: null });
      render(<Draw />);

      selectPenType('pen-dashed');

      // `handlePenTypeChange` (Draw.tsx:66-80) keys the dash off the pen type and falls back to
      // the preset for `pen-dashed`, so the dashed pen still restores its own stored pattern.
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'pen-dashed',
        // savedDrawPerPen['pen-dashed'] wins over the current args.
        lineWidth: 10,
        alpha: 0.9,
        lineDash: [5, 30],
        // The colour is not part of the per-pen settings, so the current one survives.
        color: '#000000',
      });
      expect(getPenTypeSelect()).toHaveValue('pen-dashed');
      expect(getDashSlider()).toHaveValue('5');
      expect(getGapSlider()).toHaveValue('30');
    });

    it('publishes the saved spray settings and drops the dashed pen dash for the spray branch', () => {
      resetToolArgs({ penType: 'pen-dashed', lineWidth: 10, alpha: 0.9, lineDash: [5, 30] });
      render(<Draw />);

      expect(getDashSlider()).toBeInTheDocument();

      selectPenType('spray');

      // `handlePenTypeChange` (Draw.tsx:66-80) keys the dash off the pen type rather than
      // letting the leading `...args` spread carry it, so a `pen` or `spray` record can never
      // inherit a dash. `setupDrawCtx` early-returns for spray anyway (draw.ts:29).
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'spray',
        lineWidth: 100,
        alpha: 0.5,
        lineDash: null,
        color: '#000000',
      });
      expect(getPenTypeSelect()).toHaveValue('spray');
      expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Gap/)).not.toBeInTheDocument();
    });

    it('drops the dashed pen dash when switching back to the solid pen', () => {
      render(<Draw />);

      selectPenType('pen-dashed');
      expect(lastToolArgs()).toMatchObject({ penType: 'pen-dashed', lineDash: [5, 30] });

      selectPenType('pen');

      expect(lastToolArgs()).toMatchObject({ penType: 'pen', lineDash: null });
      // `handleChange` re-derives the record from the published args, so the poisoned entry
      // is repaired on the same switch rather than on some later one.
      expect(savedDrawPerPen.pen).toEqual({ alpha: 0.9, lineWidth: 10, lineDash: null });
      // The Dash/Gap sliders are hidden for a solid pen, so a surviving dash could not be cleared.
      expect(screen.queryByLabelText(/Dash/)).not.toBeInTheDocument();
    });

    it('repairs a pen record a dashed session already poisoned with the dash', () => {
      savedDrawPerPen.pen = { alpha: 0.9, lineWidth: 10, lineDash: [5, 30] };
      resetToolArgs({ penType: 'pen-dashed', lineWidth: 10, alpha: 0.9, lineDash: [5, 30] });
      render(<Draw />);

      selectPenType('pen');

      expect(lastToolArgs()).toMatchObject({ penType: 'pen', lineDash: null });
      expect(savedDrawPerPen.pen).toEqual({ alpha: 0.9, lineWidth: 10, lineDash: null });
    });

    it('remembers the per-pen size, alpha and dash and restores them on the way back', () => {
      render(<Draw />);

      changeSize('42');
      changeAlpha('0.25');
      expect(savedDrawPerPen.pen).toEqual({ alpha: 0.25, lineWidth: 42, lineDash: null });

      selectPenType('pen-dashed');
      changeDash('7');
      changeGap('3');
      expect(savedDrawPerPen['pen-dashed']).toEqual({ alpha: 0.9, lineWidth: 10, lineDash: [7, 3] });

      selectPenType('spray');
      expect(getSizeSlider()).toHaveValue('100');
      expect(getAlphaSlider()).toHaveValue('0.5');

      selectPenType('pen');
      expect(getSizeSlider()).toHaveValue('42');
      expect(getAlphaSlider()).toHaveValue('0.25');

      selectPenType('pen-dashed');
      expect(getDashSlider()).toHaveValue('7');
      expect(getGapSlider()).toHaveValue('3');
    });

    it('drops the active points while switching pens so no stale stroke is previewed', () => {
      render(<Draw />);

      selectPenType('spray');

      // The toolbar never publishes `points`; only the canvas tool does.
      expect(lastToolArgs()).not.toHaveProperty('points');
    });
  });

  describe('size slider', () => {
    it('publishes the exact line width and repaints the readout', () => {
      render(<Draw />);

      expect(getSizeSlider()).toHaveAttribute('min', '0.5');
      expect(getSizeSlider()).toHaveAttribute('max', '500');
      expect(getSizeSlider()).toHaveAttribute('step', '0.5');
      expect(getSizeSlider()).toHaveValue('5');
      expect(screen.getByText('5px')).toBeInTheDocument();

      changeSize('120.5');

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'pen',
        lineWidth: 120.5,
        alpha: 1,
        lineDash: null,
        color: '#000000',
      });
      expect(getSizeSlider()).toHaveValue('120.5');
      expect(screen.getByText('120.5px')).toBeInTheDocument();
    });

    it('accepts both range boundaries as numbers', () => {
      render(<Draw />);

      changeSize('0.5');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineWidth: 0.5 }));

      changeSize('500');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineWidth: 500 }));
    });
  });

  describe('opacity slider', () => {
    it('publishes the exact alpha and repaints the rounded percentage readout', () => {
      render(<Draw />);

      expect(getAlphaSlider()).toHaveAttribute('min', '0');
      expect(getAlphaSlider()).toHaveAttribute('max', '1');
      expect(getAlphaSlider()).toHaveAttribute('step', '0.01');
      expect(screen.getByText('100%')).toBeInTheDocument();

      changeAlpha('0.42');

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'pen',
        lineWidth: 5,
        alpha: 0.42,
        lineDash: null,
        color: '#000000',
      });
      expect(getAlphaSlider()).toHaveValue('0.42');
      expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('accepts both range boundaries and rounds the readout instead of showing the raw fraction', () => {
      render(<Draw />);

      changeAlpha('0');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ alpha: 0 }));
      expect(getAlphaSlider()).toHaveValue('0');
      expect(screen.getByText('0%')).toBeInTheDocument();

      changeAlpha('0.456');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ alpha: 0.456 }));
      expect(screen.getByText('46%')).toBeInTheDocument();

      changeAlpha('1');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ alpha: 1 }));
    });

    it('leaves the line width untouched when only the opacity changes', () => {
      render(<Draw />);

      changeSize('80');
      changeAlpha('0.5');

      expect(lastToolArgs()).toMatchObject({ lineWidth: 80, alpha: 0.5 });
      expect(savedDrawPerPen.pen).toEqual({ alpha: 0.5, lineWidth: 80, lineDash: null });
    });
  });

  describe('dash and gap sliders', () => {
    beforeEach(() => {
      resetToolArgs({ penType: 'pen-dashed', lineWidth: 10, alpha: 0.9, lineDash: [5, 30] });
    });

    it('renders both sliders with the stored dash pair and the documented bounds', () => {
      render(<Draw />);

      expect(getDashSlider()).toHaveAttribute('min', '1');
      expect(getDashSlider()).toHaveAttribute('max', '100');
      expect(getDashSlider()).toHaveValue('5');
      expect(screen.getByText('5px')).toBeInTheDocument();
      expect(getGapSlider()).toHaveValue('30');
      expect(screen.getByText('30px')).toBeInTheDocument();
    });

    it('replaces the dash component and keeps the gap', () => {
      render(<Draw />);

      changeDash('12');

      // `handleDashChange` keeps `args.lineDash?.[1]` as the gap (Draw.tsx:54-58).
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'pen-dashed',
        lineWidth: 10,
        alpha: 0.9,
        lineDash: [12, 30],
        color: '#000000',
      });
      expect(getDashSlider()).toHaveValue('12');
      expect(getGapSlider()).toHaveValue('30');
      expect(screen.getByText('12px')).toBeInTheDocument();
    });

    it('replaces the gap component and keeps the dash', () => {
      render(<Draw />);

      changeGap('4');

      // `handleGapChange` keeps `args.lineDash?.[0]` as the dash (Draw.tsx:60-64).
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toMatchObject({ lineDash: [5, 4] });
      expect(getDashSlider()).toHaveValue('5');
      expect(getGapSlider()).toHaveValue('4');
    });

    it('accepts both range boundaries on both sliders', () => {
      render(<Draw />);

      changeDash('1');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineDash: [1, 30] }));

      changeDash('100');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineDash: [100, 30] }));

      changeGap('1');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineDash: [100, 1] }));

      changeGap('100');
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ lineDash: [100, 100] }));
    });

    it('persists the edited dash pair into the per-pen settings', () => {
      render(<Draw />);

      changeDash('8');
      expect(savedDrawPerPen['pen-dashed']).toEqual({ alpha: 0.9, lineWidth: 10, lineDash: [8, 30] });

      changeGap('2');
      expect(savedDrawPerPen['pen-dashed']).toEqual({ alpha: 0.9, lineWidth: 10, lineDash: [8, 2] });
    });
  });

  describe('colour synchronisation', () => {
    it('adopts the store colour when it diverges from the tool args colour', () => {
      resetState({ color: '#ff0000' });
      render(<Draw />);

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toEqual({
        toolName: 'draw',
        penType: 'pen',
        lineWidth: 5,
        alpha: 1,
        lineDash: null,
        color: '#ff0000',
      });
    });

    it('does not publish anything when the tool args already match the store colour', () => {
      render(<Draw />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('preview canvas', () => {
    it('renders a 96x48 preview surface with no accessible role', () => {
      const { spy } = capturePreviewContext();
      try {
        render(<Draw />);

        const canvas = previewCanvas();
        expect(canvas).not.toBeNull();
        expect(canvas.width).toBe(PREVIEW_WIDTH);
        expect(canvas.height).toBe(PREVIEW_HEIGHT);
        expect(canvas).not.toHaveAttribute('aria-label');
        expect(canvas).not.toHaveAttribute('title');
      } finally {
        spy.mockRestore();
      }
    });

    it('scales the preview drawing surface by the pointer zoom level', () => {
      render(<Draw />);

      expect(lastPreviewSize()).toEqual({ size: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT } });

      pointerScale.value = 2;
      changeSize('6');

      expect(lastPreviewSize()).toEqual({ size: { width: PREVIEW_WIDTH / 2, height: PREVIEW_HEIGHT / 2 } });
    });

    it('feeds the draw processor the store colour and a three point arc scaled by the zoom', () => {
      pointerScale.value = 2;
      render(<Draw />);

      const previewArgs = lastPreviewArgs();
      expect(previewArgs.color).toBe('#000000');
      expect(previewArgs.points).toHaveLength(3);
      expect(previewArgs.points).toEqual(expectedPreviewPoints(2).map((point) => ({ ...point })));

      const expected = expectedPreviewPoints(2);
      for (let i = 0; i < expected.length; i += 1) {
        expect(previewArgs.points![i].x).toBeCloseTo(expected[i].x, 10);
        expect(previewArgs.points![i].y).toBeCloseTo(expected[i].y, 10);
      }
      // The whole arc must fit inside the scaled box, otherwise the preview clips the stroke.
      expect(previewArgs.points![0].x).toBeLessThanOrEqual(PREVIEW_WIDTH / 2);
      expect(previewArgs.points![2].x).toBeLessThan(PREVIEW_WIDTH / 2);
    });

    it('passes the live tool settings to the processor so the preview tracks every edit', () => {
      render(<Draw />);

      changeSize('30');
      expect(lastPreviewArgs()).toMatchObject({ lineWidth: 30, penType: 'pen', alpha: 1 });

      changeAlpha('0.2');
      expect(lastPreviewArgs()).toMatchObject({ lineWidth: 30, alpha: 0.2 });
    });

    it('clears the surface and blits the tool canvas at the fixed preview size', () => {
      const { spy, last } = capturePreviewContext();
      try {
        render(<Draw />);

        const ctx = last();
        expect(ctx.imageSmoothingEnabled).toBe(true);
        expect(ctx.imageSmoothingQuality).toBe('low');
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        expect(ctx.drawImage).toHaveBeenCalledWith(
          expect.objectContaining({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }),
          0,
          0,
          PREVIEW_WIDTH,
          PREVIEW_HEIGHT
        );
      } finally {
        spy.mockRestore();
      }
    });

    it('redraws the preview after every published change', () => {
      render(<Draw />);
      const afterMount = drawCreatorMock.mock.calls.length;
      expect(afterMount).toBeGreaterThan(0);

      changeSize('31');
      expect(drawCreatorMock.mock.calls.length).toBeGreaterThan(afterMount);
    });

    it('swaps the checkerboard backdrop so the stroke stays visible on either colour', () => {
      const { spy } = capturePreviewContext();
      try {
        resetState({ color: '#000000' });
        const dark = render(<Draw />);
        // `isLightColor('#000000')` is false, so the light backdrop is used.
        expect(previewCanvas().parentElement).toHaveClass('chessboard-light');
        dark.unmount();

        resetState({ color: '#ffffff' });
        render(<Draw />);
        // A near-white colour would be invisible on the light backdrop.
        expect(previewCanvas().parentElement).toHaveClass('chessboard-dark');
      } finally {
        spy.mockRestore();
      }
    });

    it('does not draw anything while the pointer scale is still unknown', () => {
      pointerScale.value = 0;
      render(<Draw />);

      // `if (!previewRef.current || !brushScale) return;` (Draw.tsx:74) is a scale guard,
      // not a canvas guard: the canvas is mounted but nothing is rasterised yet.
      expect(previewCanvas()).not.toBeNull();
      expect(drawCreatorMock).not.toHaveBeenCalled();
      expect(drawSizeMock).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    it('all focusable elements are reachable and in correct tab order', () => {
      render(<Draw />);

      const penTypeSelect = screen.getByLabelText('Pen Type');
      const sizeSlider = screen.getByLabelText(/Size/);
      const alphaSlider = screen.getByLabelText(/Opacity/);

      expect(penTypeSelect).toBeInTheDocument();
      expect(sizeSlider).toBeInTheDocument();
      expect(alphaSlider).toBeInTheDocument();

      expect(penTypeSelect.tabIndex).toBeGreaterThanOrEqual(0);
      expect(sizeSlider.tabIndex).toBeGreaterThanOrEqual(0);
      expect(alphaSlider.tabIndex).toBeGreaterThanOrEqual(0);
    });

    it('allows arrow key navigation on pen type select', () => {
      render(<Draw />);
      const penTypeSelect = screen.getByLabelText('Pen Type');

      penTypeSelect.focus();
      expect(penTypeSelect).toHaveFocus();

      fireEvent.keyDown(penTypeSelect, { key: 'ArrowDown' });
      fireEvent.keyDown(penTypeSelect, { key: 'ArrowUp' });
      expect(penTypeSelect).toHaveFocus();
    });

    it('allows arrow key navigation on sliders', () => {
      render(<Draw />);
      const sizeSlider = screen.getByLabelText(/Size/);
      const alphaSlider = screen.getByLabelText(/Opacity/);

      sizeSlider.focus();
      expect(sizeSlider).toHaveFocus();
      fireEvent.keyDown(sizeSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(sizeSlider, { key: 'ArrowLeft' });
      expect(sizeSlider).toHaveFocus();

      alphaSlider.focus();
      expect(alphaSlider).toHaveFocus();
      fireEvent.keyDown(alphaSlider, { key: 'ArrowUp' });
      fireEvent.keyDown(alphaSlider, { key: 'ArrowDown' });
      expect(alphaSlider).toHaveFocus();
    });

    it('opens dash/gap controls when pen-dashed is selected via keyboard', () => {
      resetToolArgs({ penType: 'pen-dashed', lineDash: [10, 5] });
      render(<Draw />);

      expect(screen.getByLabelText(/Dash/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Gap/)).toBeInTheDocument();

      const dashSlider = screen.getByLabelText(/Dash/);
      const gapSlider = screen.getByLabelText(/Gap/);

      dashSlider.focus();
      expect(dashSlider).toHaveFocus();
      fireEvent.keyDown(dashSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(dashSlider, { key: 'ArrowLeft' });
      expect(dashSlider).toHaveFocus();

      gapSlider.focus();
      expect(gapSlider).toHaveFocus();
      fireEvent.keyDown(gapSlider, { key: 'ArrowRight' });
      fireEvent.keyDown(gapSlider, { key: 'ArrowLeft' });
      expect(gapSlider).toHaveFocus();
    });

    it('enter and space on select opens options', () => {
      render(<Draw />);
      const penTypeSelect = screen.getByLabelText('Pen Type');

      penTypeSelect.focus();
      fireEvent.keyDown(penTypeSelect, { key: 'Enter' });
      expect(penTypeSelect).toBeInTheDocument();

      fireEvent.keyDown(penTypeSelect, { key: ' ' });
      expect(penTypeSelect).toBeInTheDocument();
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<Draw />);
      const sizeSlider = screen.getByLabelText(/Size/);

      sizeSlider.focus();
      fireEvent.keyDown(sizeSlider, { key: 'Escape' });
      expect(sizeSlider).toHaveFocus();
    });
  });
});
