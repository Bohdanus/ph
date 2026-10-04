import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { FILL_TOOL_NO_LAYER_PIXELS, FILL_TOOL_READBACK_UNAVAILABLE, FillToolArea } from '../FillToolArea.tsx';
import { findToolProcessor } from '../../../tools/toolProcessors.ts';
import type { FillToolArgs } from '../../../tools/fill.ts';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import type { BitmapSource } from '../../../contexts/general-types.ts';

const storeState = vi.hoisted(
  (): {
    color: string;
    documentFrame: { x: number; y: number; width: number; height: number } | null;
    layers: LayersRecord;
    activeLayerId: string | null;
  } => ({ color: '#ff0000', documentFrame: null, layers: {}, activeLayerId: null })
);
const toolState = vi.hoisted((): { toolArgs: Record<string, unknown> } => ({ toolArgs: {} }));

/** The `updateLayerByTool` calls the area made, each with the canvas the real processor returned. */
const committed = vi.hoisted((): Array<{ toolArgs: Record<string, unknown>; canvas: BitmapSource | null }> => []);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 6, height: 6 },
      get layers() {
        return storeState.layers;
      },
      get color() {
        return storeState.color;
      },
      get activeLayerId() {
        return storeState.activeLayerId;
      },
      get documentFrame() {
        return storeState.documentFrame;
      },
    },
    vi.fn(),
  ],
}));

/**
 * `updateLayerByTool` runs the REAL registered processor rather than recording the call and
 * returning. That is what lets the Opacity assertions below be about pixels: a test that only
 * checked "alpha reached the args" would pass even if the tool painted all-or-nothing.
 */
vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    updateLayerByTool: ({ toolArgs }: { toolArgs: Record<string, unknown> }) => {
      const layer = storeState.layers[storeState.activeLayerId ?? ''];
      const processor = findToolProcessor(toolArgs.toolName as never);
      if (!processor || !layer?.bitmap) return;
      const [canvas] = processor.imageProcessor({ bitmap: layer.bitmap, size: layer.pos })(toolArgs as never);
      committed.push({ toolArgs, canvas });
    },
    createLayerFromTool: vi.fn(),
  }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

type Raster = { width: number; height: number; data: Uint8ClampedArray };

let rasters = new WeakMap<object, Raster>();
let layerPixels: Uint8ClampedArray;
let getContextSpy: ReturnType<typeof vi.spyOn> | null = null;

const makePixelContext = (raster: Raster) =>
  ({
    canvas: raster,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '',
    // Every scratch canvas on this path is seeded from the layer's pixels, which is what
    // `drawImage(params.bitmap, 0, 0, w, h)` means for a real bitmap source.
    drawImage: vi.fn(() => {
      raster.data.set(layerPixels.subarray(0, raster.data.length));
    }),
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: raster.data.slice(0, Math.max(0, width) * Math.max(0, height) * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    putImageData: vi.fn((imageData: ImageData) => {
      raster.data.set(imageData.data.subarray(0, raster.data.length));
    }),
  }) as unknown as CanvasRenderingContext2D;

/**
 * Opt-in pixel read-back, exactly as `src/test/setup.ts:182-209` documents it: the globally
 * installed context deliberately has no `getImageData`, so a test that needs pixels installs them.
 */
const installPixelCanvases = () => {
  getContextSpy = vi.spyOn(OffscreenCanvas.prototype, 'getContext').mockImplementation(function (
    this: OffscreenCanvas
  ) {
    let raster = rasters.get(this);
    if (!raster) {
      raster = {
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(Math.max(0, this.width) * Math.max(0, this.height) * 4),
      };
      rasters.set(this, raster);
    }
    return makePixelContext(raster) as unknown as OffscreenCanvasRenderingContext2D;
  });
};

const solidPixels = (size: number, rgba: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index++) {
    data[index * 4] = rgba[0];
    data[index * 4 + 1] = rgba[1];
    data[index * 4 + 2] = rgba[2];
    data[index * 4 + 3] = rgba[3];
  }
  return data;
};

const setPixel = (
  data: Uint8ClampedArray,
  size: number,
  x: number,
  y: number,
  rgba: [number, number, number, number]
) => {
  const index = (y * size + x) * 4;
  data[index] = rgba[0];
  data[index + 1] = rgba[1];
  data[index + 2] = rgba[2];
  data[index + 3] = rgba[3];
};

const makeLayer = (id: string, pos: Layer['pos'], hasBitmap = true): Layer => ({
  id,
  name: id,
  isBedrock: false,
  tmpCanvas: null,
  bitmap: hasBitmap ? ({ id: `${id}-bitmap` } as unknown as BitmapSource) : null,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos,
  operations: [],
});

const renderArea = () => {
  const { container } = render(<FillToolArea className="test-fill-area" />);
  return container.firstElementChild as HTMLDivElement;
};

const click = (toolArea: HTMLDivElement, x: number, y: number, button = 0) => {
  fireEvent.pointerDown(toolArea, { button, clientX: x, clientY: y });
};

const committedPixels = () => {
  expect(committed).toHaveLength(1);
  const raster = rasters.get(committed[0].canvas as object);
  expect(raster).toBeDefined();
  return raster as Raster;
};

const pixelAt = (raster: Raster, size: number, x: number, y: number) => {
  const index = (y * size + x) * 4;
  return [raster.data[index], raster.data[index + 1], raster.data[index + 2], raster.data[index + 3]];
};

describe('FillToolArea', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    committed.length = 0;
    rasters = new WeakMap();
    // The store's foreground and the bucket's seeded `color` are deliberately the SAME value here,
    // so the pixel assertions below stay readable. That makes the two indistinguishable by
    // default, which is exactly why the foreground tests give the store a colour of its own.
    storeState.color = '#ff0000';
    storeState.documentFrame = null;
    storeState.activeLayerId = 'base';
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 4, height: 4 }) };
    toolState.toolArgs = {
      toolName: 'paint-bucket',
      tolerance: 0,
      contiguous: true,
      alpha: 1,
      color: '#ff0000',
    };
    layerPixels = solidPixels(4, [255, 255, 255, 255]);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    getContextSpy?.mockRestore();
    getContextSpy = null;
    consoleErrorSpy.mockRestore();
  });

  it('commits one fill on a single click and never on a drag', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    click(toolArea, 1, 1);
    fireEvent.pointerMove(toolArea, { button: 0, clientX: 3, clientY: 3 });
    fireEvent.pointerUp(toolArea, { button: 0, clientX: 3, clientY: 3 });

    // One gesture, one history state. A drag must not turn one click into several commits.
    expect(committed).toHaveLength(1);
    expect(committed[0].toolArgs).toMatchObject({
      toolName: 'paint-bucket',
      tolerance: 0,
      contiguous: true,
      alpha: 1,
      color: '#ff0000',
      pos: { x: 1, y: 1 },
    });
  });

  it('commits the store foreground colour, not the tool args own seeded default', () => {
    installPixelCanvases();
    // The bucket's args still carry the `#ff0000` `src/tools/settings.ts:162` seeds, and nothing
    // syncs them to the store: that gap is the whole defect.
    storeState.color = '#00aa00';
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    expect(committed[0].toolArgs.color).toBe('#00aa00');
    // And it reached the pixels, not just the args: a test that only read the args would pass on a
    // processor that ignored the colour entirely.
    expect(pixelAt(committedPixels(), 4, 1, 1)).toEqual([0, 170, 0, 255]);
  });

  it('fills with the foreground colour current at the click, not the one from when it mounted', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    // The user picks the bucket, then changes the foreground. A read at mount — the options bar's
    // stale-copy pattern — would still commit the first colour.
    storeState.color = '#0000ff';

    click(toolArea, 1, 1);

    expect(committed[0].toolArgs.color).toBe('#0000ff');
    expect(pixelAt(committedPixels(), 4, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it('seeds the fill in the active layer frame and not the document frame', () => {
    installPixelCanvases();
    storeState.documentFrame = { x: 2, y: 3, width: 6, height: 6 };
    storeState.layers = { base: makeLayer('base', { x: 4, y: 5, width: 4, height: 4 }) };
    // A lone black pixel at the layer's (1,1), so the filled pixel identifies the seed exactly.
    setPixel(layerPixels, 4, 1, 1, [0, 0, 0, 255]);
    const toolArea = renderArea();

    click(toolArea, 3, 3);

    // (3,3) canvas -> (5,6) document -> (1,1) in the layer's own frame. Seeding with the raw
    // canvas point would land on the layer's (3,3) instead, one diagonal step away.
    expect(committed[0].toolArgs.pos).toEqual({ x: 1, y: 1 });
    expect(pixelAt(committedPixels(), 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(committedPixels(), 4, 3, 3)).toEqual([255, 255, 255, 255]);
  });

  it('writes no history entry at all when the flood fill matches nothing', () => {
    installPixelCanvases();
    // A 2x2 layer inside a 6x6 document: the click is inside the image, and the seed is outside
    // the layer, so `createFloodFillMask` returns null.
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 2, height: 2 }) };
    const toolArea = renderArea();

    click(toolArea, 4, 4);

    // Not "an entry that changed nothing": no commit at all. `updateLayerByTool` is the only path
    // from here to a `TOOL_ACTION`, so the absence of the call is the absence of the history state.
    expect(committed).toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('refuses to commit and writes no history entry when pixels cannot be read back', () => {
    // No `installPixelCanvases()`: the global context has no `getImageData`, which is the reduced
    // canvas environment production code guards on.
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    expect(committed).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      FILL_TOOL_READBACK_UNAVAILABLE,
      "paint-bucket cannot read the active layer's pixels"
    );
  });

  it('refuses loudly when the active layer has no bitmap', () => {
    installPixelCanvases();
    storeState.layers = { base: makeLayer('base', { x: 0, y: 0, width: 4, height: 4 }, false) };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    expect(committed).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(FILL_TOOL_NO_LAYER_PIXELS, expect.stringContaining('base'));
  });

  it('ignores clicks outside the document', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    click(toolArea, -1, 2);
    click(toolArea, 2, 6);

    expect(committed).toEqual([]);
  });

  it('ignores non-primary mouse buttons', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    click(toolArea, 1, 1, 2);

    expect(committed).toEqual([]);
  });

  it('ignores the click when the current tool is not a fill tool', () => {
    installPixelCanvases();
    toolState.toolArgs = { ...toolState.toolArgs, toolName: 'eraser' };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    expect(committed).toEqual([]);
  });

  it('fills only the connected region when Contiguous is on', () => {
    installPixelCanvases();
    // Black columns at x=1 and x=2 split the white layer into a left and a right region.
    for (let y = 0; y < 4; y++) {
      setPixel(layerPixels, 4, 1, y, [0, 0, 0, 255]);
      setPixel(layerPixels, 4, 2, y, [0, 0, 0, 255]);
    }
    const toolArea = renderArea();

    click(toolArea, 0, 0);

    const raster = committedPixels();
    expect(pixelAt(raster, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    // Untouched across the barrier.
    expect(pixelAt(raster, 4, 3, 0)).toEqual([255, 255, 255, 255]);
  });

  it('fills every matching pixel when Contiguous is off', () => {
    installPixelCanvases();
    for (let y = 0; y < 4; y++) {
      setPixel(layerPixels, 4, 1, y, [0, 0, 0, 255]);
      setPixel(layerPixels, 4, 2, y, [0, 0, 0, 255]);
    }
    toolState.toolArgs = { ...toolState.toolArgs, contiguous: false };
    const toolArea = renderArea();

    click(toolArea, 0, 0);

    const raster = committedPixels();
    expect(pixelAt(raster, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    // Reached without a connected path, which is the only way `contiguous` is observable here.
    expect(pixelAt(raster, 4, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it('partially fills at Opacity 0.5 rather than painting all or nothing', () => {
    installPixelCanvases();
    toolState.toolArgs = { ...toolState.toolArgs, alpha: 0.5 };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    // A 50/50 blend of pure red over white: strictly between the opaque fill (255,0,0) and the
    // untouched pixel (255,255,255), so Opacity below 1 is a partial result, not a no-op or a full
    // commit.
    expect(pixelAt(committedPixels(), 4, 1, 1)).toEqual([255, 128, 128, 255]);
  });

  it('partially erases at Opacity 0.5 with the magic eraser', () => {
    installPixelCanvases();
    toolState.toolArgs = { ...toolState.toolArgs, toolName: 'magic-eraser', alpha: 0.5 };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    // Alpha 255 -> 128, and the RGB is left alone: erasing to transparent discards alpha, not
    // colour.
    const [red, green, blue, alpha] = pixelAt(committedPixels(), 4, 1, 1);
    expect([red, green, blue, alpha]).toEqual([255, 255, 255, 128]);
  });

  it('fully erases the region at the seeded Opacity of 1', () => {
    installPixelCanvases();
    toolState.toolArgs = { ...toolState.toolArgs, toolName: 'magic-eraser', alpha: 1 };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    expect(pixelAt(committedPixels(), 4, 1, 1)).toEqual([255, 255, 255, 0]);
  });

  it('writes no fill colour for the magic eraser, whose pixels never read one', () => {
    installPixelCanvases();
    // Foreground and seeded args colour deliberately DIFFER here, so the assertion below can tell
    // "carried the store's colour" from "left the args alone".
    storeState.color = '#00aa00';
    toolState.toolArgs = { ...toolState.toolArgs, toolName: 'magic-eraser', color: '#ff0000' };
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    // `magicEraser` subtracts alpha and ignores `color` entirely, so the store's foreground must
    // not reach its committed args: a history entry claiming a fill would describe an erase.
    expect(committed[0].toolArgs.color).toBe('#ff0000');
    expect(committed[0].toolArgs.color).not.toBe(storeState.color);
    // And nothing of either colour reached the pixels.
    const [red, green, blue] = pixelAt(committedPixels(), 4, 1, 1);
    expect([red, green, blue]).toEqual([255, 255, 255]);
  });

  it('honours Tolerance by growing the filled region', () => {
    installPixelCanvases();
    setPixel(layerPixels, 4, 0, 0, [200, 200, 200, 255]);
    toolState.toolArgs = { ...toolState.toolArgs, tolerance: 0 };
    const narrowArea = renderArea();

    click(narrowArea, 1, 1);

    // At tolerance 0 the near-grey neighbour is outside the region.
    expect(pixelAt(committedPixels(), 4, 0, 0)).toEqual([200, 200, 200, 255]);

    committed.length = 0;
    rasters = new WeakMap();
    toolState.toolArgs = { ...toolState.toolArgs, tolerance: 255 };
    const wideArea = renderArea();

    click(wideArea, 1, 1);

    expect(pixelAt(committedPixels(), 4, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it('builds args the durable replay contract can rebuild from alone', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    click(toolArea, 2, 3);

    // `commit: 'raster'` replays from the stored args alone, so the click has to travel in the
    // args. The geometry does NOT: both fill processors read `size` from the curried
    // `ProcessorToolParams`, so an args-level `size` was a second, unread source of it.
    const args = committed[0].toolArgs as unknown as FillToolArgs;
    expect(args.pos).toEqual({ x: 2, y: 3 });
    expect(args).not.toHaveProperty('size');
    const keys = Object.keys(args).sort();
    expect(keys).toEqual(['alpha', 'color', 'contiguous', 'pos', 'tolerance', 'toolName']);
  });

  it('edits the active layer rather than creating one', () => {
    installPixelCanvases();
    const toolArea = renderArea();

    click(toolArea, 1, 1);

    // The layer count is the observable form of "no new layer": `createLayerFromTool` is present
    // in the mock, so a call would be recorded rather than throwing.
    expect(Object.keys(storeState.layers)).toEqual(['base']);
  });

  it('renders a div carrying the supplied className and the crosshair cursor', () => {
    const { container } = render(<FillToolArea className="test-fill-area" />);

    expect(container.firstElementChild).toHaveClass('test-fill-area', 'cursor-crosshair');
  });
});
