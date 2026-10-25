import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  EYEDROPPER_ALL_LAYERS_UNSUPPORTED,
  EYEDROPPER_READBACK_UNAVAILABLE,
  EyedropperToolArea,
} from '../EyedropperToolArea.tsx';
import type { EyedropperToolArgs } from '../../../tools/eyedropper.ts';
import { EYEDROPPER_SAMPLE_SIZE_OPTIONS } from '../../../tools/eyedropper.ts';
import { resetColorSamplersForTest, useColorSamplers } from '../../../tools/color-sampler-store.ts';
import type { ColorSampler } from '../../../tools/colorSampler.ts';

/** The published sampler list, read over a real subscription rather than off the module. */
let renders: (readonly ColorSampler[])[] = [];

const SamplerProbe = () => {
  renders.push(useColorSamplers());
  return null;
};

const dispatchMock = vi.hoisted(() => vi.fn());
const workspaceCanvas = vi.hoisted(() => document.createElement('canvas'));
const storeState = vi.hoisted(
  (): {
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    renderSelector: { source: 'legacy' | 'pending' | 'durable' };
  } => ({
    documentFrame: { x: 0, y: 0, width: 4, height: 4 },
    renderSelector: { source: 'legacy' },
  })
);
const toolState = vi.hoisted(
  (): { toolArgs: { sampleSize: 1 | 3 | 5 | 11 | 31 | 51 | 101; sampleAllLayers: boolean; toolName: string } } => ({
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
      get renderSelector() {
        return storeState.renderSelector;
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

const createScaledCompositedImageData = (frameWidth: number, frameHeight: number, scale: number): ImageData => {
  const width = Math.round(frameWidth * scale);
  const height = Math.round(frameHeight * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const documentX = Math.min(frameWidth - 1, Math.floor((x + 0.5) / scale));
      const documentY = Math.min(frameHeight - 1, Math.floor((y + 0.5) / scale));
      data.set(pixelColors[documentY * frameWidth + documentX], (y * width + x) * 4);
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
};

/**
 * A 128px square split down the middle — black left of 64, white from 64 — so the mean of a block
 * centred on the split is a hand-computable grey. A 101 sample needs 101 pixels of room, which a
 * 4px fixture cannot give, and the seven squares have to land on seven DIFFERENT answers or the
 * test would only be proving that one large block reads.
 */
const createSplitField = (width: number): ImageData => {
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const value = x < width / 2 ? 0 : 255;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { data, width, height: width, colorSpace: 'srgb' } as ImageData;
};

let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

/**
 * The composited workspace pixels, with a distinct colour per pixel so a single sample is exact and
 * an average is identifiable. `getImageData` honours the requested rectangle, which is what makes
 * "the block was clamped to the canvas" observable rather than assumed.
 */
let composited: ImageData = createCompositedImageData(4, 4);

const readWindow = (x: number, y: number, width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4);
  for (let row = 0; row < height; row++) {
    const source = ((y + row) * composited.width + x) * 4;
    data.set(composited.data.subarray(source, source + width * 4), row * width * 4);
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
    .filter((action) => action.type === 'SET_COLOR' || action.type === 'SET_BACKGROUND_COLOR');

const historyActions = () =>
  (dispatchMock.mock.calls as unknown[][])
    .map(([action]) => action as { type: string })
    .filter((action) => action.type !== 'SET_COLOR' && action.type !== 'SET_BACKGROUND_COLOR');

describe('EyedropperToolArea', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchMock.mockClear();
    storeState.documentFrame = { x: 0, y: 0, width: 4, height: 4 };
    storeState.renderSelector.source = 'legacy';
    toolState.toolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' };
    composited = createCompositedImageData(4, 4);
    workspaceCanvas.width = 4;
    workspaceCanvas.height = 4;
    workspaceCanvas.removeAttribute('data-hidpi-ratio');
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

  it.each([2, 1.25, 1.5])('maps the clicked document pixel to its representative DPR-%s texel', (dpr) => {
    workspaceCanvas.width = Math.round(4 * dpr);
    workspaceCanvas.height = Math.round(4 * dpr);
    workspaceCanvas.setAttribute('data-hidpi-ratio', String(dpr));
    composited = createScaledCompositedImageData(4, 4, dpr);
    const context = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };
    context.getImageData.mockClear();
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#ff00ff' }]);
    const center = Math.floor(1.5 * dpr);
    expect(context.getImageData).toHaveBeenCalledWith(center, center, 1, 1);
  });

  it.each([2, 1.25, 1.5])('averages the same nine document pixels at DPR %s', (dpr) => {
    workspaceCanvas.width = Math.round(4 * dpr);
    workspaceCanvas.height = Math.round(4 * dpr);
    workspaceCanvas.setAttribute('data-hidpi-ratio', String(dpr));
    composited = createScaledCompositedImageData(4, 4, dpr);
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 3 };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

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

  it('reads the canvas pixel that was clicked, with a cropped frame already applied', () => {
    storeState.documentFrame = { x: 2, y: 0, width: 4, height: 4 };
    const toolArea = renderArea();

    // The composited canvas is drawn in FRAME space — sized by `documentFrameSize`, with each
    // layer stamped at `position.x - documentFrame.x` (`src/contexts/layer-renderer.ts:78-79,119`)
    // — so its pixel (0,0) IS canvas pixel (0,0), which is red. The frame origin is not added a
    // second time: that shipped as a real defect, where a crop trimming 100px off the left made a
    // click read 100px to the right, and a click past 600px read outside the bitmap and silently
    // did nothing at all. This assertion used to expect the blue at (2,0), which is the bug.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#ff0000' }]);
  });

  it('samples the clicked pixel under a large frame offset rather than running off the canvas', () => {
    // The failure mode this pins is silent: with the offset applied twice, a click near the right
    // edge produced a window entirely past `canvas.width`, and the tool dispatched nothing.
    storeState.documentFrame = { x: 0, y: 0, width: 4, height: 4 };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 3, clientY: 0 });

    // Pixel (3,0) is yellow.
    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#ffff00' }]);
  });

  it('leaves the foreground alone when the sampled pixel is fully transparent', () => {
    // The foreground is a CSS colour on an `<input type="color">`, which cannot express
    // transparency, so averaging a transparent pixel in silently set the foreground to black.
    // Photoshop shows a crossed-out swatch and changes nothing.
    const data = composited.data;
    data[3] = 0; // pixel (0,0) alpha
    try {
      const toolArea = renderArea();
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0 });
      expect(colorActions()).toEqual([]);
    } finally {
      data[3] = 255;
    }
  });

  it('ignores clicks outside the composited canvas', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: -1, clientY: 0 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 4, clientY: 0 });

    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not read the previous canvas during pending replay (Shift=%s)', (shiftKey) => {
    storeState.renderSelector.source = 'pending';
    const context = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };
    context.getImageData.mockClear();
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1, shiftKey });

    expect(context.getImageData).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  /**
   * REGRESSION CHECK for a bounds error in the Sample Size > 1 path.
   *
   * With `sampleSize === 1` the `right <= left` / `bottom <= top` guard catches every
   * out-of-bounds centre pixel. But with a larger sample size the CLIPPED block can be
   * non-empty while the centre pixel is still outside the canvas — e.g. `centerX = -1`,
   * `sampleSize = 3`, `half = 1`: `left = 0`, `right = 2`, so the block has two pixels,
   * but `centerX - left = -1` indexes the wrong byte in the pixel array and the average
   * silently includes padding. This test pins the early return that guards the array index.
   */
  it('ignores out-of-bounds clicks with a Sample Size larger than 1', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 3 };
    const toolArea = renderArea();

    // centerX = -1: the block clips to [0, 2) but the centre is outside.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: -1, clientY: 0 });

    // centerX = 4 (== canvas.width): the block clips to [3, 4) but the centre is outside.
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

  it('refuses loudly instead of silently ignoring a Sample All Layers value', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleAllLayers: true };
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });

    // There is no control on the bar for this any more — it was a permanently `disabled` box — but
    // `settings.ts` still seeds the field, so a `true` can still arrive. It must not sample the
    // composite and present it as the whole document's colour, and it must not quietly do nothing.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      EYEDROPPER_ALL_LAYERS_UNSUPPORTED,
      'the eyedropper samples the composited canvas only'
    );
  });

  it('sets the BACKGROUND colour on an Alt/Option click, and the foreground otherwise', () => {
    // Adobe: "Alt-click (Windows) / Command-Option-click (Mac) to sample to the background color"
    // (https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html). The modifier
    // is `altKey` on both platforms, so there is no platform branch to take.
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0 });
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, altKey: true });

    expect(dispatchMock.mock.calls.map(([action]) => action)).toEqual([
      { type: 'SET_COLOR', payload: '#00ff00' },
      { type: 'SET_BACKGROUND_COLOR', payload: '#00ff00' },
    ]);
  });

  it('records no history for an Alt-click either', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, altKey: true });

    expect(historyActions()).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the foreground alone when an Alt-click lands on a transparent pixel', () => {
    composited.data[3] = 0;

    const toolArea = renderArea();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 0, clientY: 0, altKey: true });

    expect(dispatchMock).not.toHaveBeenCalled();
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
    const sizes: Array<EyedropperToolArgs['sampleSize']> = [1, 3, 5, 11, 31, 51, 101];

    for (const sampleSize of sizes) {
      toolState.toolArgs = { ...toolState.toolArgs, sampleSize };
      fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1 });
    }

    expect(colorActions()).toHaveLength(sizes.length);
    for (const action of colorActions()) {
      expect(action.payload).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('averages the square each of the seven Sample Sizes names, not a fixed one', () => {
    // The readback is generic over the size, so widening the union is only real if a 101 really
    // reads 101 pixels. A 128px split field gives each square its own answer: the block is
    // centred on the black/white seam at (64,64) and takes `size` columns of it, so the mean is
    // `whiteColumns * 255 / size`.
    expect(EYEDROPPER_SAMPLE_SIZE_OPTIONS.map(({ value }) => value)).toEqual([1, 3, 5, 11, 31, 51, 101]);

    const EXPECTED: { sampleSize: EyedropperToolArgs['sampleSize']; left: number; sampled: string }[] = [
      { sampleSize: 1, left: 64, sampled: '#ffffff' },
      { sampleSize: 3, left: 63, sampled: '#aaaaaa' },
      { sampleSize: 5, left: 62, sampled: '#999999' },
      { sampleSize: 11, left: 59, sampled: '#8b8b8b' },
      { sampleSize: 31, left: 49, sampled: '#848484' },
      { sampleSize: 51, left: 39, sampled: '#828282' },
      { sampleSize: 101, left: 14, sampled: '#818181' },
    ];

    storeState.documentFrame = { x: 0, y: 0, width: 128, height: 128 };
    composited = createSplitField(128);
    workspaceCanvas.width = 128;
    workspaceCanvas.height = 128;
    const { container, rerender } = render(<EyedropperToolArea className="test-eyedropper-area" />);
    const ctx = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };

    for (const { sampleSize, left, sampled } of EXPECTED) {
      toolState.toolArgs = { ...toolState.toolArgs, sampleSize };
      // The tool area reads `sampleSize` off the args the last render gave it, and the mock
      // hands back the same object until something republishes it, so each size needs its render.
      rerender(<EyedropperToolArea className="test-eyedropper-area" />);
      fireEvent.pointerDown(container.firstElementChild as HTMLDivElement, { button: 0, clientX: 64, clientY: 64 });

      expect(ctx.getImageData).toHaveBeenLastCalledWith(left, left, sampleSize, sampleSize);
      expect(colorActions().at(-1)).toEqual({ type: 'SET_COLOR', payload: sampled });
    }
  });

  it('renders a div carrying the supplied className and the crosshair cursor', () => {
    const { container } = render(<EyedropperToolArea className="test-eyedropper-area" />);

    expect(container.firstElementChild).toHaveClass('test-eyedropper-area', 'cursor-crosshair');
  });
});

/**
 * Adobe's Shift-click, which belongs to the EYEDROPPER: "To add new color samplers, select the Color
 * Sampler tool and click in the image, or select the Eyedropper tool and Shift-click in the image."
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
 *
 * A separate `describe` because it is a different claim from everything above: those tests are about
 * what this area writes to the foreground swatch, and these are about what it writes to the Color
 * Sampler's store — including that it writes NOTHING to the swatch, which is the half a regression
 * would most plausibly lose.
 */
describe('EyedropperToolArea Shift-click, which places a color sampler', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dispatchMock.mockClear();
    resetColorSamplersForTest();
    storeState.documentFrame = { x: 0, y: 0, width: 4, height: 4 };
    storeState.renderSelector.source = 'legacy';
    toolState.toolArgs = { sampleSize: 1, sampleAllLayers: false, toolName: 'eyedropper' };
    composited = createCompositedImageData(4, 4);
    workspaceCanvas.width = 4;
    workspaceCanvas.height = 4;
    getContextSpy = vi.spyOn(workspaceCanvas, 'getContext').mockReturnValue({
      getImageData: vi.fn((x: number, y: number, width: number, height: number) => readWindow(x, y, width, height)),
    } as unknown as CanvasRenderingContext2D);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
    consoleErrorSpy.mockRestore();
    resetColorSamplersForTest();
  });

  /** The samplers the store holds, read back over a real subscription. */
  const storedSamplers = (): readonly { id: number; point: { x: number; y: number }; color: string }[] => {
    renders = [];
    const view = render(<SamplerProbe />);
    view.unmount();
    return renders[renders.length - 1];
  };

  it('places a sampler on Shift-click instead of setting the foreground', () => {
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true });

    expect(storedSamplers()).toEqual([{ id: 1, point: { x: 1, y: 0 }, color: '#00ff00' }]);
    // The load-bearing half: Shift must REPLACE the swatch write, not add to it. A path that placed
    // a sampler and then fell through would leave the foreground changed, which is not Adobe's
    // behaviour — the two gestures are alternatives, not a sequence.
    expect(colorActions()).toEqual([]);
    expect(historyActions()).toEqual([]);
  });

  it('still sets the foreground on a click with no modifier, so Alt keeps meaning background', () => {
    // Adobe's two gestures are on adjacent modifiers, and the check is on `shiftKey` alone. If this
    // press were captured by the sampler branch, Alt-click-to-background would be dead.
    const toolArea = renderArea();

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0 });

    expect(colorActions()).toEqual([{ type: 'SET_COLOR', payload: '#00ff00' }]);
    expect(storedSamplers()).toEqual([]);
  });

  it('honours the Sample Size the bar shares, so a wide footprint averages for the sampler too', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleSize: 3 };
    const toolArea = renderArea();

    // A 3x3 block centred on the green pixel at (1,0) clips to rows 0..1 and columns 0..2, so it
    // averages six pixels: red, green, blue on the top row and cyan, magenta, [10,20,30] beneath.
    // That is 520/530/795 over six, which rounds to 87, 88 and 133.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true });

    expect(storedSamplers()[0].color).toBe('#575885');
  });

  it("deletes a sampler on Shift-Alt-click, which is Adobe's third gesture", () => {
    // "Option + Shift (Mac) | Alt + Shift (Win) -click on the Color Sampler to delete a Color Sampler
    // (With the Eyedropper tool selected)." It has to be a DELETE and not a second placement on the
    // same pixel, and the delete is checked before the placement for that reason.
    const toolArea = renderArea();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true });
    expect(storedSamplers()).toHaveLength(1);

    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true, altKey: true });

    expect(storedSamplers()).toEqual([]);
    expect(colorActions()).toEqual([]);
  });

  it('uses the same floating-point hit radius as the Color Sampler tool', () => {
    composited = createSplitField(16);
    storeState.documentFrame = { x: 0, y: 0, width: 16, height: 16 };
    workspaceCanvas.width = 16;
    workspaceCanvas.height = 16;
    const toolArea = renderArea();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1, shiftKey: true });
    expect(storedSamplers()).toHaveLength(1);

    // The pointer is 8.5 document pixels from the marker, outside the eight-pixel hit radius.
    // Flooring it to x=9 first would turn that into a distance of 8 and delete the wrong marker.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 9.5, clientY: 1, shiftKey: true, altKey: true });

    expect(storedSamplers().map(({ id }) => id)).toEqual([1, 2]);
    expect(colorActions()).toEqual([]);
  });

  it('deletes an existing sampler during pending replay without reading the previous canvas', () => {
    const toolArea = renderArea();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true });
    expect(storedSamplers()).toHaveLength(1);

    storeState.renderSelector.source = 'pending';
    const context = workspaceCanvas.getContext('2d') as unknown as { getImageData: ReturnType<typeof vi.fn> };
    context.getImageData.mockClear();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true, altKey: true });

    expect(storedSamplers()).toEqual([]);
    expect(context.getImageData).not.toHaveBeenCalled();
    expect(colorActions()).toEqual([]);
  });

  it('places a sampler rather than deleting one when Shift-Alt-click misses every marker', () => {
    // A 16px field, because the whole point is to click FURTHER than the eight-pixel hit radius and
    // a 4px fixture has a diameter of 4.24 — every point in it is inside the radius of every other,
    // so the "misses every marker" premise could not be set up at that size.
    composited = createSplitField(16);
    storeState.documentFrame = { x: 0, y: 0, width: 16, height: 16 };
    workspaceCanvas.width = 16;
    workspaceCanvas.height = 16;
    const toolArea = renderArea();
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 1, shiftKey: true });

    // Twelve pixels away, so well outside the radius: the modifier is about the marker, not about
    // the click, so this is an ordinary placement.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 13, clientY: 1, shiftKey: true, altKey: true });

    expect(storedSamplers().map(({ id }) => id)).toEqual([1, 2]);
  });

  it('places nothing and logs nothing on a transparent pixel, the quiet-nothing case', () => {
    toolState.toolArgs = { ...toolState.toolArgs, sampleAllLayers: true };
    const toolArea = renderArea();

    // `sampleAllLayers` still refuses loudly FIRST, which is the Eyedropper's own rule and is checked
    // before the Shift path: the refusal is about the tool's layer source, not about the gesture.
    fireEvent.pointerDown(toolArea, { button: 0, clientX: 1, clientY: 0, shiftKey: true });

    expect(storedSamplers()).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(EYEDROPPER_ALL_LAYERS_UNSUPPORTED, expect.any(String));
  });
});
