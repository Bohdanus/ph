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
  getImageData: vi.fn((_sx: number, _sy: number, _sw: number, _sh: number) => ({
    data: new Uint8ClampedArray([255, 255, 255, 255]),
    width: 1,
    height: 1,
    colorSpace: 'srgb' as const,
  })),
  putImageData: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createConicGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
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
  ...overrides,
});

export const createMockCanvas = (overrides: Record<string, unknown> = {}) => {
  const canvas = {
    getContext: vi.fn(),
    width: 128,
    height: 64,
    ...overrides,
  } as unknown as HTMLCanvasElement;
  const context = createMockCanvasContext({ canvas });
  vi.mocked(canvas.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return canvas;
};

export const createMockImageBitmap = (width: number = 128, height: number = 64) =>
  ({
    width,
    height,
    close: vi.fn(),
  }) as unknown as ImageBitmap;

export const createMockOffscreenCanvas = (width: number = 128, height: number = 64) =>
  new MockOffscreenCanvas(width, height) as unknown as OffscreenCanvas;

/**
 * `OffscreenCanvas` is called with `new` in production, so the global stub has to
 * be a real class: a `vi.fn()` implementation is not constructible.
 */
class MockOffscreenCanvas {
  width: number;
  height: number;
  private readonly context: ReturnType<typeof createMockCanvasContext>;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.context = createMockCanvasContext({ canvas: this });
  }

  getContext() {
    return this.context;
  }

  transferToImageBitmap() {
    return createMockImageBitmap(this.width, this.height);
  }
}

export const mockCanvasGlobals = () => {
  const mockContext = createMockCanvasContext();
  const mockCanvas = createMockCanvas();
  const mockOffscreenCanvas = createMockOffscreenCanvas();

  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas as unknown as typeof OffscreenCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: { width?: number; height?: number }) =>
      createMockImageBitmap(source.width ?? 128, source.height ?? 64)
    )
  );

  return { mockContext, mockCanvas, mockOffscreenCanvas };
};
