import { vi } from 'vitest';

export function makeMockCtx(overrides: Partial<CanvasRenderingContext2D> = {}): CanvasRenderingContext2D {
  return {
    canvas: { width: 100, height: 100 },
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
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    ...overrides,
  } as unknown as CanvasRenderingContext2D;
}

export function makeMockCanvas(
  width = 100,
  height = 100,
  ctxOverrides: Partial<CanvasRenderingContext2D> = {}
): HTMLCanvasElement {
  const ctx = makeMockCtx(ctxOverrides);
  const canvas = {
    width,
    height,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/png;base64,'),
    toBlob: vi.fn(),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

export function makeMockOffscreenCanvas(
  width = 100,
  height = 100,
  ctxOverrides: Record<string, unknown> = {}
): OffscreenCanvas {
  const ctx = makeMockCtx(ctxOverrides) as unknown as OffscreenCanvasRenderingContext2D;
  return {
    width,
    height,
    getContext: vi.fn(() => ctx),
    convertToBlob: vi.fn(),
  } as unknown as OffscreenCanvas;
}

export function makeMockImageData(
  width = 100,
  height = 100,
  fillFn?: (index: number, x: number, y: number) => void
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fillFn) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        fillFn(index, x, y);
      }
    }
  }
  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}
