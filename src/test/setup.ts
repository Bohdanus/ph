import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
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
    };
  }) as unknown as typeof Path2D;
}

if (!testGlobal.OffscreenCanvas) {
  testGlobal.OffscreenCanvas = class MockOffscreenCanvas {
    width = 0;
    height = 0;
    constructor(width: number, height: number) {
      this.width = Math.max(1, Math.ceil(width));
      this.height = Math.max(1, Math.ceil(height));
    }
    getContext() {
      return createMockCanvasContext(this) as unknown as OffscreenCanvasRenderingContext2D;
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
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    translate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    get filter() {
      return '';
    },
    set filter(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
}

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
  return createMockCanvasContext(this) as unknown as CanvasRenderingContext2D;
});
