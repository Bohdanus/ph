import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  EYEDROPPER_ALL_LAYERS_UNSUPPORTED,
  EYEDROPPER_READBACK_UNAVAILABLE,
  EyedropperToolArea,
} from '../EyedropperToolArea.tsx';
import type { EyedropperToolArgs } from '../../../tools/eyedropper.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const workspaceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): { documentFrame: { x: number; y: number; width: number; height: number } | null } => ({ documentFrame: null })
);
const toolState = vi.hoisted(
  (): { toolArgs: { sampleSize: 1 | 3 | 5; sampleAllLayers: boolean; toolName: string } } => ({
    toolArgs: { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' },
  })
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: workspaceCanvas },
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 4, height: 4 },
      color: '#000000',
      backgroundColor: '#ffffff',
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

/** A distinct colour per pixel, so an average is identifiable and a single sample is exact. */
const pixelColors: [number, number, number, number][] = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
  [0, 255, 255, 255],
  [255, 0, 255, 255],
  [10, 20, 30, 255],
  [40, 50, 60, 255],
  [70, 80, 90, 255],
  [100, 110, 120, 255],
  [130, 140, 150, 255],
  [160, 170, 180, 255],
  [190, 200, 210, 255],
  [220, 230, 240, 255],
  [1, 2, 3, 255],
  [4, 5, 6, 255],
];

const createCompositedImageData = (width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [red, green, blue, alpha] = pixelColors[y * width + x];
      const index = (y * width + x) * 4;
      data[index] = red;
      data[index + 1] = green;
      data[index + 2] = blue;
      data[index + 3] = alpha;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
};

let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

/**
 * The composited workspace pixels, with a distinct colour per pixel so a single sample is exact and
 * an average is identifiable. `getImageData` honours the requested rectangle, which is what makes
 * "the block was clamped to the canvas" observable rather than assumed.
 */
const COMPOSED = createCompositedImageData(4, 4);

const readWindow = (x: number, y: number, width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4);
  for (let row = 0; row < height; row++) {
    const source = ((y + row) * 4 + x) * 4;
    data.set(COMPOSED.data.subarray(source, source + width * 4), row * width * 4);
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
};

const renderArea = () => {
  const { container } = render(<EyedropperToolArea className="test-eyedropper-area" />);
  return container.firstElementChild as HTMLDivElement;
};

const colorActions = () =>
  (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as { type: string; payload: string })
    .filter((action) => action.type === 'SET_COLOR');

const historyActions = () =>
  (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as { type: string })
    .filter((action) => action.type !== 'SET_COLOR');

describe('EyedropperToolArea', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchMock.mockClear();
    storeState.documentFrame = null;
    toolState.toolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' };
    workspaceCanvas.width = 4;
    workspaceCanvas.height = 4;
    // Opt-in pixel read-back: the globally installed context has no `getImageData` by design
    // (`src/test/setup.ts:182-190`).
    getContextSpy = vi.spyOn(workspaceCanvas, 'getContext').mockReturnValue({
      getImageData: vi.fn((x: number, y: number, width: number, height: number) => readWindow(x, y, width, height)),
    } as unknown as CanvasRenderingContext2D);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
    consoleErrorSpy.mockRestore();
  });

  it('writes the sampled colour to the store foreground and records NO history', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#00ff00' }]);
    // The load-bearing assertion of the whole tool. A history state comes from a change to pixels;
    // sampling changes only the application foreground colour, so it is not an undoable edit. The
    // absence is asserted, not merely the absence of `updateLayerByTool`.
    expect(historyActions()).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('creates no layer, no durable operation and no tool action of any kind', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0 });

    const types = (dispatchMock.mock.calls as unknown[][]).map(([action]) => (action as { type: string }).type);
    expect(types).not.toContain('COMMIT_DOCUMENT_EDIT');
    expect(types).not.toContain('ADD_LAYER');
    expect(types).not.toContain('BATCH_UPDATES');
    expect(types).toEqual(['SET_COLOR']);
  });

  it('samples the composited workspace canvas, not the active layer', () => {
    // `drawLayersToCanvas` composites every visible layer into this element, so it is the only
    // read that answers "the pixel the user clicked". The store mock has no `layers` at all: if
    // the tool reached for the active layer instead, this would not run.
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 2, clientY: 1 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#0a141e' }]);
  });

  it('averages a 3 by 3 block around the click', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 3 };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    // The 3x3 block centred on (1,1) covers the pixels at (0..2, 0..2). Their red components
    // sum to 820, green to 860 and blue to 1155, so the mean is 91 (0x5b), 96 (0x60), 128 (0x80).
    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#5b6080' }]);
  });

  it('clamps the sample block at the canvas edge instead of reading out of bounds', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 5 };
    const toolArea = renderArea();
    const ctx = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };

    // A 5x5 block centred on (0,0) clips to the 3x3 block at the top-left corner, so the average
    // covers only pixels that exist. Sliding the block inward instead would sample a different
    // 5x5 and quietly report a colour the user never pointed at.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0 });

    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 3, 3);
    // The same corner window, so the same mean: only 9 of the 25 requested pixels existed.
    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#5b6080' }]);
  });

  it('never requests a rectangle that leaves the composited canvas', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 5 };
    const toolArea = renderArea();
    const ctx = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };

    for (const [clientX, clientY] of [
      [0, 0],
      [3, 3],
      [0, 3],
      [3, 0],
    ]) {
      fireEvent.pointerDown(toolArea, { button: 0, clientX, clientY });
    }

    for (const [x, y, width, height] of ctx.getImageData.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + (width as number)).toBeLessThanOrEqual(4);
      expect(y + (height as number)).toBeLessThanOrEqual(4);
    }
  });

  it('offsets the sample by the document frame', () => {
    storeState.documentFrame = { x: 2, y: 0, width: 4, height: 4 };
    const toolArea = renderArea();

    // Canvas point (0,0) is document point (2,0), which is canvas pixel (2,0).
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#0000ff' }]);
  });

  it('ignores clicks outside the composited canvas', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: -1, clientY: 0 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 4, clientY: 0 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ignores non-primary mouse buttons', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 2, clientX: 1, clientY: 1 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('ignores the click when the current tool is not the eyedropper', () => {
    toolState.toolArgs = { ...toolState.toolArgs, toolName: 'magic-wand' } as typeof toolState.toolArgs;
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('refuses loudly instead of silently ignoring Sample All Layers', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleAllLayers: true };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    // A `true` here must not sample the composite and present it as the whole document's colour,
    // and it must not quietly do nothing either: the options bar renders the control `disabled`
    // precisely because this is unimplementable here.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      EYEDROPPER_ALL_LAYERS_UNSUPPORTED,
      'the eyedropper samples the composited canvas only'
    );
  });

  it('refuses to sample and writes no history when pixels cannot be read back', () => {
    getContextSpy?.mockReturnValue({} as CanvasRenderingContext2D);
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      EYEDROPPER_READBACK_UNAVAILABLE,
      'the eyedropper cannot read the composited canvas'
    );
  });

  it('drops the alpha channel, which a colour input cannot represent', () => {
    const toolArea = renderArea();
    const ctx = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };
    vi.mocked(ctx.getImageData).mockReturnValue({
      data: new Uint8ClampedArray([12, 34, 56, 7]),
      width: 1,
      height: 1,
      colorSpace: 'srgb',
    } as ImageData);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#0c2238' }]);
  });

  it('accepts every Sample Size the options bar offers', () => {
    const toolArea = renderArea();
    const sizes: Array<EyedropperToolArgs['sampleSize']> = [1, 3, 5];

    for (const sampleSize of sizes) {
      toolState.toolArgs = { ...toolState.toolArgs, sampleSize };
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });
    }

    expect(colorActions()).toHaveLength(sizes.length);
    for (const action of colorActions()) {
      expect(action.payload).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('renders a div carrying the supplied className and the crosshair cursor', () => {
    const { container } = render(<EyedropperToolArea className="test-eyedropper-area" />);

    expect(container.firstElementChild).toHaveClass('test-eyedropper-area', 'cursor-crosshair');
  });
});
