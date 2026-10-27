import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Layer, LayersRecord } from '../../../contexts/layer-types.ts';
import { RED_EYE_READBACK_UNAVAILABLE, RedEyeToolArea } from '../RedEyeToolArea.tsx';

const storeState = vi.hoisted((): { layers: LayersRecord; activeLayerId: string | null } => ({
  layers: {},
  activeLayerId: null,
}));
const toolState = vi.hoisted((): { toolArgs: Record<string, unknown> } => ({ toolArgs: {} }));
const updates = vi.hoisted((): unknown[] => []);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: document.createElement('div') },
      totalSize: { width: 5000, height: 4000 },
      documentFrame: null,
      get layers() {
        return storeState.layers;
      },
      get activeLayerId() {
        return storeState.activeLayerId;
      },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ updateLayerByTool: (update: unknown) => updates.push(update) }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolState.toolArgs }),
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => ({
    isPointerDownValid: () => true,
    getLocalCoords: (event: PointerEvent) => ({ x: event.clientX, y: event.clientY }),
  }),
}));

const makeLargeLayer = (): Layer => ({
  id: 'large',
  name: 'Large',
  isBedrock: false,
  tmpCanvas: null,
  bitmap: { width: 5000, height: 4000 } as ImageBitmap,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos: { x: 0, y: 0, width: 5000, height: 4000 },
  presentationBounds: null,
  operations: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storeState.layers = {};
  storeState.activeLayerId = null;
  toolState.toolArgs = {};
  updates.length = 0;
});

describe('RedEyeToolArea', () => {
  it('refuses an over-budget presentation before staging or reading the raster', () => {
    const allocations: Array<{ width: number; height: number }> = [];
    class AllocationCountingCanvas {
      constructor(width: number, height: number) {
        allocations.push({ width, height });
      }

      getContext() {
        return null;
      }
    }
    vi.stubGlobal('OffscreenCanvas', AllocationCountingCanvas);
    storeState.layers = { large: makeLargeLayer() };
    storeState.activeLayerId = 'large';
    toolState.toolArgs = { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50 };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RedEyeToolArea className="area" />);

    fireEvent.pointerDown(container.firstElementChild as HTMLElement, {
      button: 0,
      clientX: 1,
      clientY: 1,
    });

    expect(allocations).toEqual([]);
    expect(updates).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      RED_EYE_READBACK_UNAVAILABLE,
      expect.any(String),
      expect.objectContaining({ message: expect.stringMatching(/pixel staging budget/) })
    );
  });

  it('turns a thrown pixel readback into a loud no-correction refusal', () => {
    class ThrowingReadbackCanvas {
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
    const largeLayer = makeLargeLayer();
    const smallLayer = {
      ...largeLayer,
      bitmap: { width: 8, height: 8 } as ImageBitmap,
      pos: { x: 0, y: 0, width: 8, height: 8 },
    };
    storeState.layers = { large: smallLayer };
    storeState.activeLayerId = 'large';
    toolState.toolArgs = { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50 };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RedEyeToolArea className="area" />);

    fireEvent.pointerDown(container.firstElementChild as HTMLElement, {
      button: 0,
      clientX: 1,
      clientY: 1,
    });

    expect(updates).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      RED_EYE_READBACK_UNAVAILABLE,
      expect.stringContaining('cannot be read')
    );
  });

  it('corrects a clicked red region on the cached transformed presentation in local coordinates', () => {
    const pixels = new Uint8ClampedArray(9 * 8 * 4);
    pixels.set([240, 24, 18, 255], (4 * 9 + 4) * 4);
    const readbacks: Uint8ClampedArray[] = [];
    const drawImage = vi.fn();
    class PixelReadbackCanvas {
      readonly width: number;
      readonly height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          drawImage,
          getImageData: vi.fn(() => {
            const data = new Uint8ClampedArray(pixels);
            readbacks.push(data);
            return { width: this.width, height: this.height, data } as ImageData;
          }),
        };
      }
    }
    vi.stubGlobal('OffscreenCanvas', PixelReadbackCanvas as unknown as typeof OffscreenCanvas);
    const cachedRaster = { width: 9, height: 8, pixels: new Uint8ClampedArray(pixels) } as unknown as OffscreenCanvas;
    const layer: Layer = {
      ...makeLargeLayer(),
      bitmap: { width: 4.25, height: 4 } as ImageBitmap,
      tmpCanvas: cachedRaster,
      pos: { x: 10, y: 20, width: 4.25, height: 4 },
      presentationBounds: { x: 10, y: 20, width: 8.5, height: 8 },
      operations: [
        {
          id: 'scale',
          kind: 'affine-transform',
          transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
          enabled: true,
        },
      ],
    };
    storeState.layers = { large: layer };
    storeState.activeLayerId = 'large';
    toolState.toolArgs = { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50, point: null };
    const { container } = render(<RedEyeToolArea className="area" />);

    fireEvent.pointerDown(container.firstElementChild as HTMLElement, {
      button: 0,
      clientX: 14,
      clientY: 24,
    });

    expect(drawImage).toHaveBeenCalledWith(cachedRaster, 0, 0, 9, 8);
    expect(readbacks).toHaveLength(1);
    expect([...readbacks[0]!.slice((4 * 9 + 4) * 4, (4 * 9 + 4) * 4 + 4)]).toEqual([24, 12, 9, 255]);
    expect(updates).toEqual([
      { toolArgs: { toolName: 'red-eye', pupilSize: 50, darkenAmount: 50, point: { x: 4, y: 4 } } },
    ]);
  });
});
