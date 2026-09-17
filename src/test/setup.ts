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

const canvasContext = {
  canvas: { width: 0, height: 0 },
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
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
};

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
  return { ...canvasContext, canvas: this } as unknown as CanvasRenderingContext2D;
});
