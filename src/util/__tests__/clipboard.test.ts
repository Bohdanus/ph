import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyRectToClipboard } from '../clipboard.ts';

function makeSourceCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeBlob() {
  return new Blob(['data'], { type: 'image/png' });
}

const mockContext = {
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

describe('copyRectToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { ...mockContext, canvas: this } as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when sourceCanvas is null', async () => {
    const clipboard = { write: vi.fn() };
    const ClipboardItemCtor = vi.fn();
    const result = await copyRectToClipboard({
      sourceCanvas: null,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard,
      ClipboardItemCtor,
    });
    expect(result).toBe(false);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('returns false when rect is null', async () => {
    const canvas = makeSourceCanvas(10, 10);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: null,
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn(),
    });
    expect(result).toBe(false);
  });

  it('returns false when clipboard write is unavailable', async () => {
    const canvas = makeSourceCanvas(10, 10);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard: null,
      ClipboardItemCtor: vi.fn(),
    });
    expect(result).toBe(false);
  });

  it('returns false when the trimmed rect has zero area', async () => {
    const canvas = makeSourceCanvas(100, 100);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 50, y1: 50, x2: 50, y2: 50 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn(),
    });
    expect(result).toBe(false);
  });

  it('returns false when toBlob produces no blob', async () => {
    const canvas = makeSourceCanvas(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(null);
    });
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 50, y2: 50 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn(),
    });
    expect(result).toBe(false);
  });

  it('writes the blob to the clipboard and returns true on success', async () => {
    const canvas = makeSourceCanvas(100, 100);
    const blob = makeBlob();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(blob);
    });

    const writeMock = vi.fn().mockResolvedValue(undefined);
    const ClipboardItemCtor = vi.fn().mockImplementation(function () {
      return {};
    });

    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 5, y1: 5, x2: 15, y2: 15 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: writeMock },
      ClipboardItemCtor,
    });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('returns false when clipboard.write throws', async () => {
    const canvas = makeSourceCanvas(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(makeBlob());
    });

    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')) },
      ClipboardItemCtor: vi.fn().mockImplementation(function () {
        return {};
      }),
    });

    expect(result).toBe(false);
  });
});
