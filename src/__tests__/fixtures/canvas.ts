import { vi } from 'vitest';

export const createMockCanvasContext = (overrides: Record<string, unknown> = {}) => ({
  canvas: { width: 128, height: 64 },
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
  ...overrides,
});

export const createMockCanvas = (overrides: Record<string, unknown> = {}) => {
  const context = createMockCanvasContext();
  return {
    getContext: vi.fn(() => context),
    width: 128,
    height: 64,
    ...overrides,
  } as unknown as HTMLCanvasElement;
};

export const createMockOffscreenCanvas = (width: number = 128, height: number = 64) => {
  const context = createMockCanvasContext({ canvas: { width, height } });
  return {
    width,
    height,
    getContext: vi.fn(() => context),
    transferToImageBitmap: vi.fn(() => ({
      width,
      height,
      close: vi.fn(),
    })),
  } as unknown as OffscreenCanvas;
};

export const mockCanvasGlobals = () => {
  const mockContext = createMockCanvasContext();
  const mockCanvas = createMockCanvas();
  const mockOffscreenCanvas = createMockOffscreenCanvas();

  vi.stubGlobal(
    'OffscreenCanvas',
    vi.fn().mockImplementation((w: number, h: number) => createMockOffscreenCanvas(w, h))
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: { width: number; height: number }) => ({
      width: source.width,
      height: source.height,
      close: vi.fn(),
    }))
  );

  return { mockContext, mockCanvas, mockOffscreenCanvas };
};
