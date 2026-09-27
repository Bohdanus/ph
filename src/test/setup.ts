import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const testGlobal = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserver;
  Path2D?: typeof Path2D;
};

if (!testGlobal.requestAnimationFrame) {
  testGlobal.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number;
}

if (!testGlobal.cancelAnimationFrame) {
  testGlobal.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

if (!testGlobal.ResizeObserver) {
  testGlobal.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!testGlobal.Path2D) {
  testGlobal.Path2D = vi.fn().mockImplementation(function MockPath2D() {
    return {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      arcTo: vi.fn(),
      ellipse: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      addPath: vi.fn(),
    };
  }) as unknown as typeof Path2D;
}

if (!testGlobal.OffscreenCanvas) {
  testGlobal.OffscreenCanvas = class MockOffscreenCanvas {
    width = 0;
    height = 0;
    private context: OffscreenCanvasRenderingContext2D | null = null;
    constructor(width: number, height: number) {
      this.width = Math.max(1, Math.ceil(width));
      this.height = Math.max(1, Math.ceil(height));
    }
    getContext() {
      if (!this.context) {
        this.context = createMockCanvasContext(this) as unknown as OffscreenCanvasRenderingContext2D;
      }
      return this.context;
    }
    resize(width: number, height: number) {
      this.width = Math.max(1, Math.ceil(width));
      this.height = Math.max(1, Math.ceil(height));
    }
    convertToBlob() {
      return Promise.resolve(new Blob([]));
    }
    transferToImageBitmap() {
      return {
        width: this.width,
        height: this.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
  } as unknown as typeof OffscreenCanvas;
}

if (!testGlobal.createImageBitmap) {
  testGlobal.createImageBitmap = vi.fn(async (source: CanvasImageSource) => {
    if (source instanceof OffscreenCanvas) {
      return {
        width: source.width,
        height: source.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
    if (source instanceof HTMLCanvasElement) {
      return {
        width: source.width,
        height: source.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
    return {
      width: 100,
      height: 100,
      close: vi.fn(),
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

if (!testGlobal.URL.createObjectURL) {
  const originalURL = globalThis.URL;
  testGlobal.URL = Object.assign(class extends originalURL {}, {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(() => {}),
  }) as typeof URL;
}

export function createMockCanvasContext(canvas?: { width: number; height: number }): CanvasRenderingContext2D {
  return {
    canvas: canvas ?? { width: 0, height: 0 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    arcTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    arc: vi.fn(),
    ellipse: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    reset: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => [] as number[]),
    drawImage: vi.fn(),
    clip: vi.fn(),
    isPointInPath: vi.fn(() => false),
    isPointInStroke: vi.fn(() => false),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createConicGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    imageSmoothingEnabled: true,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    // A real data property, not a getter that always returns ''. A getter makes
    // `ctx.filter = 'blur(4px)'` unobservable, so every assertion about filter
    // application through this mock was asserting nothing.
    filter: '',
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Opt-in pixel-capable context.
 *
 * The globally installed context deliberately has NO `getImageData`/`putImageData`,
 * because production code guards on `typeof ctx.getImageData === 'function'` to detect
 * a reduced canvas environment. Adding read-back to the global mock would silently
 * flip every rasterization test onto the other branch. Tests that need real read-back
 * must opt in here (or use `makeMockCtx` from `@/__tests__/canvas-mock`).
 */
export function createPixelCanvasContext(canvas?: { width: number; height: number }): CanvasRenderingContext2D {
  const base = createMockCanvasContext(canvas) as unknown as Record<string, unknown>;
  return {
    ...base,
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    putImageData: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
  } as unknown as CanvasRenderingContext2D;
}

const installCanvasContextStub = () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    return createMockCanvasContext(this) as unknown as CanvasRenderingContext2D;
  });
};

installCanvasContextStub();

beforeEach(() => {
  installCanvasContextStub();
});
