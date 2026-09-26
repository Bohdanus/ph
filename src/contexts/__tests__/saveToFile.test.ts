import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { saveImageToDisk } = vi.hoisted(() => ({
  saveImageToDisk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../image-load-save-utils.ts', () => ({
  saveImageToDisk,
}));

import { saveImage } from '../saveToFile.ts';

describe('saveToFile', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    mockCanvas = {
      getContext: vi.fn(() => mockCtx),
      toDataURL: vi.fn(() => 'data:image/png;base64,test'),
      width: 100,
      height: 100,
    } as unknown as HTMLCanvasElement;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns early if canvas is null', async () => {
    const result = await saveImage(null, 'test.png');
    expect(result).toBeUndefined();
    expect(saveImageToDisk).not.toHaveBeenCalled();
  });

  it('returns early if canvas context is null', async () => {
    const canvasWithoutCtx = {
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const result = await saveImage(canvasWithoutCtx, 'test.png');
    expect(result).toBeUndefined();
    expect(saveImageToDisk).not.toHaveBeenCalled();
  });

  it('calls saveImageToDisk with correct parameters', async () => {
    const result = await saveImage(mockCanvas, 'test.png', 'image/png', 0.9);
    expect(result).toBe(true);
    expect(saveImageToDisk).toHaveBeenCalledWith(mockCanvas, 'test.png', 'image/png', 0.9);
  });

  it('uses default format when not specified', async () => {
    await saveImage(mockCanvas, 'test.png');
    expect(saveImageToDisk).toHaveBeenCalledWith(mockCanvas, 'test.png', 'image/png', undefined);
  });

  it('uses default quality when not specified', async () => {
    await saveImage(mockCanvas, 'test.png', 'image/jpeg');
    expect(saveImageToDisk).toHaveBeenCalledWith(mockCanvas, 'test.png', 'image/jpeg', undefined);
  });

  it('passes quality parameter correctly', async () => {
    await saveImage(mockCanvas, 'test.jpg', 'image/jpeg', 0.5);
    expect(saveImageToDisk).toHaveBeenCalledWith(mockCanvas, 'test.jpg', 'image/jpeg', 0.5);
  });
});
