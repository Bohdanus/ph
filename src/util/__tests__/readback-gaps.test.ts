import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeMockCanvas } from '@/__tests__/canvas-mock.ts';
import { createEdgeMapFromCanvas } from '../magneticLasso.ts';
import { createMagicWandSelectionFromCanvas } from '../magicWand.ts';
import { QuickSelectionToolArea } from '../../components/Main/QuickSelectionToolArea.tsx';
import type { QuickSelectionToolArgs } from '../../tools/quickSelection.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const toolState = vi.hoisted((): { toolArgs: QuickSelectionToolArgs | null } => ({ toolArgs: null }));

/**
 * The store mock carries every field both the tool area and `useSelectionHistory` destructure.
 * `useSelectionHistory` is NOT mocked, so its real destructuring runs against this object and a
 * missing field would arrive as `undefined` inside a history plan rather than as a test failure
 * about the read-back.
 */
vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      containerRef: { current: document.createElement('div') },
      selections: [],
      activeSelectionId: null,
      selectionCleared: null,
      totalSize: { width: 4, height: 4 },
      documentFrame: null,
      renderSelector: {
        source: 'legacy',
        documentId: 'readback-gap-test',
        documentRevision: 0,
        branchRevision: 0,
        historyCursor: 0,
        frame: { x: 0, y: 0, width: 4, height: 4 },
      },
      history: [],
      historyIndex: 0,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

/**
 * `getToolArgs` is keyed by tool name and the key is load-bearing: a mock that ignored the name
 * would let a different tool's args mount this area, and every case below would pass for the
 * wrong reason.
 */
vi.mock('../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (toolName: string) => (toolName === 'quick-selection' ? toolState.toolArgs : null),
  }),
}));

/**
 * The first `pointerDown` claims the pointer and only that pointer's move and release are valid,
 * which is what `QuickSelectionToolArea.tsx:182-195` enforces with its own pointer-id record.
 */
vi.mock('../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: vi.fn((event: PointerEvent) => event.button === 0),
    isPointerMoveValid: vi.fn(() => true),
    isPointerUpValid: vi.fn(() => true),
    releasePointer: vi.fn(),
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
    isMouseDown: { current: false },
  }),
}));

/** A 4x4 field of one opaque colour, so a flood fill from any seed has something to match. */
function createImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const imageData = {
    colorSpace: 'srgb',
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  } as ImageData;

  for (let i = 0; i < width * height; i++) {
    imageData.data[i * 4] = fill[0];
    imageData.data[i * 4 + 1] = fill[1];
    imageData.data[i * 4 + 2] = fill[2];
    imageData.data[i * 4 + 3] = fill[3];
  }

  return imageData;
}

/**
 * What a browser throws out of `getImageData` for a canvas tainted by a cross-origin draw. The
 * name matters: the identity assertion below pins the OBJECT, so a `console.error(String(error))`
 * mutation hands the console a different value and fails.
 */
function createSecurityError(): DOMException {
  return new DOMException(
    "Failed to execute 'getImageData' on 'CanvasRenderingContext2D': The canvas has been tainted by cross-origin data.",
    'SecurityError'
  );
}

/**
 * The overlay is one shared 2D context that this area repaints on mount and on every gesture, so a
 * context short of these calls would make the repaint a `TypeError` — a failure that says nothing
 * about the read-back under test.
 */
function createOverlayContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 4, height: 4 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function renderQuickSelectionArea(): HTMLDivElement {
  const { container } = render(
    createElement(QuickSelectionToolArea, {
      className: 'test-quick-selection-area',
      overlayCtxRef: { current: createOverlayContext() },
    })
  );

  return container.firstElementChild as HTMLDivElement;
}

describe('read-back failures are reported, not swallowed', () => {
  let errorSpy: Mock<(...args: unknown[]) => void> | null = null;

  beforeEach(() => {
    dispatchMock.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sourceCanvas.width = 4;
    sourceCanvas.height = 4;
    toolState.toolArgs = { size: 20, tolerance: 0, mode: 'add', alpha: 1, toolName: 'quick-selection' };
  });

  afterEach(() => {
    errorSpy?.mockRestore();
    errorSpy = null;
  });

  // `createMagicWandSelectionFromCanvas`, `createEdgeMapFromCanvas` and `readDocumentImageData` all
  // wrap one `ctx.getImageData` in a try/catch whose recovery is `return null`. HANDOFF.md §98
  // makes the console the app's only error channel, and a bare `null` reads to every caller as
  // "nothing matched" — a click that selects nothing and says nothing. Each case below pins the
  // two halves together: the recovery is unchanged, and the failure is reported with the raw error
  // object exactly once.

  describe('createMagicWandSelectionFromCanvas', () => {
    const throwingCanvas = (thrown: unknown) =>
      makeMockCanvas(4, 4, {
        getImageData: () => {
          throw thrown;
        },
      });

    it('returns null and reports the raw error object exactly once', () => {
      const thrown = createSecurityError();

      const result = createMagicWandSelectionFromCanvas(
        throwingCanvas(thrown),
        { x: 1, y: 1 },
        { width: 4, height: 4 }
      );

      // The recovery, unchanged: a click that cannot read the canvas selects nothing rather than
      // throwing mid-gesture.
      expect(result).toBeNull();
      // One line per click, and a click is one user intent.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      // Identity, not equality: `console.error(String(error))` and a template literal both hand the
      // console a string, and a stack trace the console can expand is the whole point.
      expect(errorSpy!.mock.calls[0][0]).toBe(thrown);
    });

    it('reports nothing when the read-back succeeds', () => {
      const canvas = makeMockCanvas(4, 4, {
        createImageData: vi.fn((width: number, height: number) =>
          createImageData(width, height, [5, 6, 7, 255])
        ) as unknown as CanvasRenderingContext2D['createImageData'],
        getImageData: vi.fn(() => createImageData(4, 4, [5, 6, 7, 255])),
      });

      const result = createMagicWandSelectionFromCanvas(canvas, { x: 1, y: 1 }, { width: 4, height: 4 });

      // A solid field selects every pixel, which is what makes this a control rather than another
      // null: the read succeeded, the click selected something, and the console stayed quiet.
      expect(result).not.toBeNull();
      expect(result?.selectedPixelCount).toBe(16);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('createEdgeMapFromCanvas', () => {
    const throwingCanvas = (thrown: unknown) =>
      makeMockCanvas(4, 4, {
        getImageData: () => {
          throw thrown;
        },
      });

    it('returns null and reports the raw error object exactly once', () => {
      const thrown = createSecurityError();

      const result = createEdgeMapFromCanvas(throwingCanvas(thrown), { width: 4, height: 4 });

      // The recovery, unchanged: an empty edge map rather than a throw mid-gesture.
      expect(result).toBeNull();
      // One line per gesture.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy!.mock.calls[0][0]).toBe(thrown);
    });

    it('reports nothing when the read-back succeeds', () => {
      const imageData = createImageData(4, 4, [0, 0, 0, 255]);
      // A vertical edge down the middle, so the map has a non-zero maximum and the success path
      // produced a real edge map rather than a degenerate all-zero one.
      for (let y = 0; y < 4; y++) imageData.data[(y * 4 + 2) * 4] = 255;
      const canvas = makeMockCanvas(4, 4, {
        createImageData: vi.fn((width: number, height: number) =>
          createImageData(width, height, [0, 0, 0, 255])
        ) as unknown as CanvasRenderingContext2D['createImageData'],
        getImageData: vi.fn(() => imageData),
      });

      const result = createEdgeMapFromCanvas(canvas, { width: 4, height: 4 });

      expect(result).not.toBeNull();
      expect(result!.maxGradient).toBeGreaterThan(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('QuickSelectionToolArea document read-back', () => {
    let getContextSpy: Mock | null = null;

    beforeEach(() => {
      sourceCanvas.width = 4;
      sourceCanvas.height = 4;
    });

    afterEach(() => {
      getContextSpy?.mockRestore();
      getContextSpy = null;
    });

    it('starts no selection draft and reports the raw error object exactly once', () => {
      const thrown = createSecurityError();
      getContextSpy = vi.spyOn(sourceCanvas, 'getContext').mockReturnValue({
        getImageData: () => {
          throw thrown;
        },
      } as unknown as CanvasRenderingContext2D);

      const toolArea = renderQuickSelectionArea();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 2, clientY: 2 });

      // Observe the null readback through the pointer-down contract: a failed read starts no
      // selection draft and leaves the pointer id unclaimed.
      expect(dispatchMock).not.toHaveBeenCalled();
      // One line per press, and a press is one user intent.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy!.mock.calls[0][0]).toBe(thrown);
    });

    it('reports nothing when the read-back succeeds', () => {
      getContextSpy = vi.spyOn(sourceCanvas, 'getContext').mockReturnValue({
        getImageData: vi.fn(() => createImageData(4, 4, [9, 9, 9, 255])),
      } as unknown as CanvasRenderingContext2D);

      const toolArea = renderQuickSelectionArea();
      fireEvent.pointerDown(toolArea, { button: 0, pointerId: 1, clientX: 2, clientY: 2 });

      // The control has to prove the read SUCCEEDED, or it would pass for the same reason the
      // failure case passes. The draft dispatch is downstream of a truthy `imageData`.
      expect(dispatchMock).toHaveBeenCalledWith({
        type: 'START_SELECTION_DRAFT',
        payload: { sourceTool: 'quick-selection' },
      });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
