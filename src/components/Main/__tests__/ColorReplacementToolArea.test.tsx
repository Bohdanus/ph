import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import {
  COLOR_REPLACEMENT_NO_LAYER_PIXELS,
  COLOR_REPLACEMENT_PRESENTATION_UNAVAILABLE,
  COLOR_REPLACEMENT_READBACK_UNAVAILABLE,
  ColorReplacementToolArea,
} from '../ColorReplacementToolArea.tsx';
import { findToolProcessor } from '../../../tools/toolProcessors.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import type { ColorReplacementToolArgs } from '../../../tools/colorReplacement.ts';
import { COLOR_REPLACEMENT_TOLERANCE_MAX } from '../../../tools/colorReplacement.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import {
  fieldOf,
  luminanceOf,
  pixelAt,
  stubPixelOffscreenCanvas,
  type PixelCanvas,
} from '../../../__tests__/fixtures/pixelCanvas.ts';

const SIZE = 8;

const storeState = vi.hoisted(
  (): {
    color: string;
    layers: LayersRecord;
    activeLayerId: string | null;
  } => ({ color: '#ff0000', layers: {}, activeLayerId: null })
);

const toolState = vi.hoisted((): { toolArgs: Record<string, unknown>; patches: unknown[] } => ({
  toolArgs: {},
  patches: [],
}));

/** The `updateLayerByTool` calls the area made, each with the canvas the real processor returned. */
const committed = vi.hoisted((): Array<{ toolArgs: Record<string, unknown>; canvas: PixelCanvas | null }> => []);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: SIZE, height: SIZE },
      get layers() {
        return storeState.layers;
      },
      get color() {
        return storeState.color;
      },
      get activeLayerId() {
        return storeState.activeLayerId;
      },
      documentFrame: null,
    },
    vi.fn(),
  ],
}));

/**
 * `updateLayerByTool` runs the REAL registered processor rather than recording the call alone.
 * That is what lets the pixel assertions below be about pixels: a test that only checked
 * "the sample reached the args" would pass on a tool that substituted nothing at all.
 */
vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    updateLayerByTool: ({ toolArgs }: { toolArgs: Record<string, unknown> }) => {
      const layer = storeState.layers[storeState.activeLayerId ?? ''];
      const processor = findToolProcessor(toolArgs.toolName as never);
      if (!processor || !layer?.bitmap) return;
      const [canvas] = processor.imageProcessor({ bitmap: layer.bitmap, size: layer.pos })(toolArgs as never);
      committed.push({ toolArgs, canvas: canvas as unknown as PixelCanvas });
    },
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolState.toolArgs,
    patchToolArgs: (toolName: string, patch: unknown) => {
      toolState.patches.push({ toolName, patch });
      if (toolName === 'color-replacement' && patch && typeof patch === 'object') {
        toolState.toolArgs = { ...toolState.toolArgs, ...(patch as Record<string, unknown>) };
      }
    },
  }),
}));

/**
 * A faithful stand-in for the real hook, which SETS `isMouseDown` in `isPointerDownValid` and
 * CLEARS it in `isPointerUpValid` (`src/hooks/usePointerPosition.ts:128,154`). A mock that left it
 * `false` forever would make every move a no-op and every "no history written" assertion here pass
 * for the wrong reason.
 */
const mouseDown = { current: false };

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: () => {
      mouseDown.current = true;
      return true;
    },
    isPointerMoveValid: () => true,
    isPointerUpValid: () => {
      mouseDown.current = false;
      return true;
    },
    isMouseDown: mouseDown,
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

/** A layer whose pixels are a real `Uint8ClampedArray`, carried on a `.pixels` bitmap. */
const layerWith = (colour: readonly [number, number, number], over: Parameters<typeof fieldOf>[2] = []) => {
  const imageData = fieldOf(SIZE, colour, over);

  return {
    id: 'layer-1',
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: SIZE, height: SIZE, pixels: imageData.data },
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: SIZE, height: SIZE },
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 0, y: 0, width: SIZE, height: SIZE },
    },
    operations: [],
  } as unknown as Layer;
};

const setLayer = (layer: Layer | null) => {
  storeState.layers = layer ? { [layer.id]: layer } : {};
  storeState.activeLayerId = layer?.id ?? null;
};

const argsWith = (overrides: Partial<ColorReplacementToolArgs> = {}) => {
  toolState.toolArgs = { ...defaultSettings['color-replacement'], ...overrides } as unknown as Record<string, unknown>;
};

const drag = (container: HTMLElement, from: Point2, to: Point2 = from) => {
  const area = container.firstElementChild as HTMLElement;
  fireEvent.pointerDown(area, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(area, { clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(area, { clientX: to.x, clientY: to.y });
};

type Point2 = { x: number; y: number };

beforeEach(() => {
  stubPixelOffscreenCanvas();
  committed.length = 0;
  toolState.patches.length = 0;
  toolState.toolArgs = {};
  storeState.color = '#ff0000';
  mouseDown.current = false;
  setLayer(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ColorReplacementToolArea', () => {
  it('a sample gesture stays an eyedropper when patching the sample rerenders the area', () => {
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: null });
    const { container, rerender } = render(<ColorReplacementToolArea className="area" />);
    const area = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(area, { button: 0, clientX: 4, clientY: 4 });
    rerender(<ColorReplacementToolArea className="area" />);
    fireEvent.pointerMove(area, { clientX: 6, clientY: 4 });
    fireEvent.pointerUp(area, { clientX: 6, clientY: 4 });

    // The eyedropper step, and nothing else: the click is not also the first point of a drag, or
    // the tool would replace with whatever colour it sampled and then immediately over it.
    expect(toolState.patches).toEqual([
      { toolName: 'color-replacement', patch: { sampleColor: { r: 200, g: 200, b: 10, a: 255 } } },
    ]);
    expect(committed).toHaveLength(0);
  });

  it('refuses an over-budget raster before Color Replacement stages or reads it', () => {
    const allocations: Array<{ width: number; height: number }> = [];
    class AllocationCountingCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
      }

      getContext() {
        return {
          drawImage: vi.fn(),
          getImageData: vi.fn(() => null),
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
    const layer = layerWith([200, 200, 10]);
    layer.pos = { x: 0, y: 0, width: 3000, height: 3000 };
    if (!layer.bitmap) throw new Error('Expected a test bitmap');
    Object.assign(layer.bitmap, { width: 3000, height: 3000 });
    setLayer(layer);
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 } });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(allocations).toEqual([]);
    expect(committed).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      COLOR_REPLACEMENT_PRESENTATION_UNAVAILABLE,
      expect.any(String),
      expect.objectContaining({ message: expect.stringMatching(/pixel staging budget/) })
    );
  });

  it('turns a thrown pixel readback into a loud no-sample refusal', () => {
    class ThrowingReadbackCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          drawImage: () => {
            throw new DOMException('Pixel access was denied', 'SecurityError');
          },
          getImageData: vi.fn(),
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', ThrowingReadbackCanvas);
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: null });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(toolState.patches).toEqual([]);
    expect(committed).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      COLOR_REPLACEMENT_READBACK_UNAVAILABLE,
      expect.stringContaining('cannot read')
    );
  });

  it('refuses to sample a fully transparent pixel, leaving the tool still asking', () => {
    const layer = layerWith([200, 200, 10]);
    (layer.bitmap as unknown as { pixels: Uint8ClampedArray }).pixels.fill(0);
    setLayer(layer);
    argsWith({ sampleColor: null });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(toolState.patches).toEqual([]);
    expect(committed).toHaveLength(0);
  });

  it('a drag after the sample REPLACES THE PIXELS, with the foreground colour', () => {
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 4, smoothness: 0, limits: 'discontinuous' });
    storeState.color = '#ff0000';
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(1);
    const [r, , b] = pixelAt(committed[0].canvas!.ctx.getImageData(0, 0, SIZE, SIZE), 4, 4);
    expect(r).toBeGreaterThan(b + 30);
  });

  it('reads the foreground AT THE GESTURE, not the colour the args happened to carry', () => {
    setLayer(layerWith([200, 200, 10]));
    // The args carry a STALE blue, the store says red. The commit must use the store's red: this
    // is the `FillToolArea.tsx:132-148` precedent, and the reason the settings arm must never let
    // a colour context write decide the replacement.
    argsWith({
      sampleColor: { r: 200, g: 200, b: 10, a: 255 },
      color: '#0000ff',
      lineWidth: 4,
      smoothness: 0,
      limits: 'discontinuous',
    });
    storeState.color = '#ff0000';
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed[0].toolArgs.color).toBe('#ff0000');
    const [r, , b] = pixelAt(committed[0].canvas!.ctx.getImageData(0, 0, SIZE, SIZE), 4, 4);
    expect(r).toBeGreaterThan(b + 30);
  });

  it('commits the points in the ACTIVE LAYER’s own coordinates', () => {
    const layer = layerWith([200, 200, 10]);
    layer.pos = { x: 2, y: 3, width: SIZE, height: SIZE };
    setLayer(layer);
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 2, smoothness: 0 });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    // Document point (4,4) minus the layer's own (2,3) origin. `commit: 'raster'` replaces the
    // layer's pixels, so the path has to arrive in the layer's frame or it lands 2px right and 3px
    // down of where the user dragged. Two identical entries because the synthetic drag fires a
    // move at the same point as the press, and the area appends moves without de-duplicating —
    // `DrawToolArea` and `EraserToolArea` do the same.
    expect(committed[0].toolArgs.points).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('writes NO history entry for a drag that matched nothing at all', () => {
    // The sample is blue; the layer is magenta everywhere, so nothing is within tolerance. The
    // gesture must end with no `TOOL_ACTION`, because a history row that changed nothing is a
    // tool that looks alive and is not (`FillToolArea.tsx:63-69`).
    setLayer(layerWith([255, 0, 255]));
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 4, tolerance: 1, smoothness: 0 });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(0);
  });

  it('writes no history entry when Opacity makes the replacement a no-op', () => {
    const allocations: Array<{ width: number; height: number }> = [];
    class AllocationCountingCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
      }
    }
    vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, alpha: 0 });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(allocations).toEqual([]);
    expect(committed).toHaveLength(0);
  });

  it('leaves a colour outside the tolerance untouched, so the tolerance is a real gate', () => {
    setLayer(layerWith([200, 200, 10], [[6, 4, 0, 255, 0]]));
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 6, tolerance: 5, smoothness: 0 });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(1);
    const result = committed[0].canvas!.ctx.getImageData(0, 0, SIZE, SIZE);
    expect(pixelAt(result, 6, 4)).toEqual([0, 255, 0]);
    const [r, , b] = pixelAt(result, 4, 4);
    expect(r).toBeGreaterThan(b + 30);
  });

  it('preserves the source LUMINANCE, so a lit region is not flattened into one solid', () => {
    // A dark left half at 60 and a bright right half at 220, both within tolerance of the sample.
    // After replacement the two halves must still differ by about what they differed by before,
    // which is the property a paint-over cannot have: it returns the foreground's own value
    // everywhere and the shading is gone.
    const bright = fieldOf(SIZE, [220, 220, 220]);
    const layer = layerWith([60, 60, 60]);
    const pixels = (layer.bitmap as unknown as { pixels: Uint8ClampedArray }).pixels;
    // The right half, row by row: pixel index `y * SIZE + x` for x in [SIZE/2, SIZE).
    for (let y = 0; y < SIZE; y++) {
      for (let x = SIZE / 2; x < SIZE; x++) {
        const index = y * SIZE + x;
        pixels.set(bright.data.subarray(index * 4, index * 4 + 4), index * 4);
      }
    }
    setLayer(layer);
    argsWith({
      sampleColor: { r: 60, g: 60, b: 60, a: 255 },
      lineWidth: SIZE,
      tolerance: COLOR_REPLACEMENT_TOLERANCE_MAX,
      smoothness: 0,
      limits: 'discontinuous',
    });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(1);
    const result = committed[0].canvas!.ctx.getImageData(0, 0, SIZE, SIZE);
    const dark = pixelAt(result, 2, 4);
    const light = pixelAt(result, 6, 4);
    expect(luminanceOf(...light)).toBeGreaterThan(luminanceOf(...dark) + 50);
    // Both are the replacement's hue, not the source's grey.
    expect(dark[0]).toBeGreaterThan(dark[1]);
    expect(light[0]).toBeGreaterThan(light[1]);
  });

  it('fails loudly and writes no history when the layer has no pixels to read', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = layerWith([200, 200, 10]);
    layer.bitmap = null;
    setLayer(layer);
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 4 });
    const { container } = render(<ColorReplacementToolArea className="area" />);

    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(0);
    expect(error.mock.calls.flat().join(' ')).toContain(COLOR_REPLACEMENT_NO_LAYER_PIXELS);
  });

  it('fails loudly and writes no history when the environment cannot read pixels back', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 }, lineWidth: 4 });

    class BlindCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return { drawImage: vi.fn(), imageSmoothingEnabled: true, imageSmoothingQuality: 'high' };
      }
    }
    vi.stubGlobal('OffscreenCanvas', BlindCanvas as unknown as typeof OffscreenCanvas);

    const { container } = render(<ColorReplacementToolArea className="area" />);
    drag(container, { x: 4, y: 4 });

    expect(committed).toHaveLength(0);
    expect(error.mock.calls.flat().join(' ')).toContain(COLOR_REPLACEMENT_READBACK_UNAVAILABLE);
  });

  it('does nothing at all while no sample has been taken and no drag is in progress', () => {
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: null });
    const { container } = render(<ColorReplacementToolArea className="area" />);
    const area = container.firstElementChild as HTMLElement;

    fireEvent.pointerMove(area, { clientX: 4, clientY: 4 });
    fireEvent.pointerUp(area, { clientX: 4, clientY: 4 });

    expect(committed).toHaveLength(0);
    expect(toolState.patches).toEqual([]);
  });

  it('uses a crosshair only once a sample exists, so the cursor tells the user which step it is on', () => {
    setLayer(layerWith([200, 200, 10]));
    argsWith({ sampleColor: null });
    const asking = render(<ColorReplacementToolArea className="area" />);
    const askingClass = (asking.container.firstElementChild as HTMLElement).className;
    asking.unmount();

    argsWith({ sampleColor: { r: 200, g: 200, b: 10, a: 255 } });
    const armed = render(<ColorReplacementToolArea className="area" />);
    const armedClass = (armed.container.firstElementChild as HTMLElement).className;

    expect(askingClass).not.toContain('cursor-crosshair');
    expect(armedClass).toContain('cursor-crosshair');
  });
});
