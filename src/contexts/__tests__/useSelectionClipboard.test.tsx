import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCanvas, createMockImageBitmap } from '@/__tests__/fixtures/canvas.ts';
import type { Selection, SelectionClipboard } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { useSelectionClipboard } from '../useSelectionClipboard.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const createLayerFromBitmapMock = vi.hoisted(() => vi.fn());
const readImageFromClipboardMock = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(
  (): {
    activeSelectionId: string | null;
    documentFrame: DocumentFrame | undefined;
    layers: Record<string, { name: string }> | undefined;
    selectionClipboard: SelectionClipboard | null;
    selections: Selection[];
    totalSize: { width: number; height: number };
  } => ({
    activeSelectionId: null,
    documentFrame: undefined,
    layers: undefined,
    selectionClipboard: null,
    selections: [],
    totalSize: { width: 100, height: 100 },
  })
);

const sourceCanvas = createMockCanvas({ width: 100, height: 100 });

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: storeState.activeSelectionId,
      canvasRef: { current: sourceCanvas },
      documentFrame: storeState.documentFrame,
      layers: storeState.layers,
      selectionClipboard: storeState.selectionClipboard,
      selections: storeState.selections,
      totalSize: storeState.totalSize,
    },
    dispatchMock,
  ],
}));

vi.mock('../useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromBitmap: createLayerFromBitmapMock,
  }),
}));

vi.mock('../../util/clipboard.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../util/clipboard.ts')>()),
  readImageFromClipboard: readImageFromClipboardMock,
}));

let lastPaste: Promise<boolean> | null = null;

const ClipboardProbe = () => {
  const { copyActiveSelection, pasteSelectionClipboard, pasteSystemClipboardImage } = useSelectionClipboard();

  return (
    <div>
      <button onClick={() => copyActiveSelection()}>Copy</button>
      <button
        onClick={() => {
          lastPaste = pasteSelectionClipboard();
        }}
      >
        Paste
      </button>
      <button
        onClick={() => {
          lastPaste = pasteSystemClipboardImage();
        }}
      >
        Paste System Image
      </button>
    </div>
  );
};

function createLassoSelection(): Selection {
  return {
    geometry: 'polygon',
    id: 'selection-1',
    isActive: true,
    lifecycle: 'committed',
    points: [
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
      ],
    ],
    pos: { x: 10, y: 20, width: 30, height: 40 },
    sourceTool: 'freehand-lasso',
  };
}

function createClipboard(overrides: Partial<SelectionClipboard> = {}): SelectionClipboard {
  return {
    bitmap: createMockImageBitmap(30, 40),
    copiedAt: 123,
    name: 'Selection copy',
    pos: { x: 10, y: 20, width: 30, height: 40 },
    sourceSelectionId: 'selection-1',
    sourceTool: 'freehand-lasso',
    ...overrides,
  };
}

function createOversizedBmpBlob(): Blob {
  const bytes = new Uint8Array(54);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 10_001, true);
  view.setInt32(22, 10_000, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  return new Blob([bytes], { type: 'image/bmp' });
}

function createPhotoshopSignatureBlob(): Blob {
  return new Blob([new Uint8Array([0x38, 0x42, 0x50, 0x53])], { type: 'image/png' });
}

function createRle8BmpBlob(): Blob {
  const pixelOffset = 14 + 40 + 256 * 4;
  const bytes = new Uint8Array(pixelOffset + 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 2, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 8, true);
  view.setUint32(30, 1, true);
  view.setUint32(34, 2, true);
  view.setUint32(46, 256, true);
  bytes.set([0, 1], pixelOffset);
  return new Blob([bytes], { type: 'image/bmp' });
}

function createBmpWithOversizedEmbeddedPng(): Blob {
  const pixelOffset = 14 + 40;
  const bytes = new Uint8Array(pixelOffset + 33);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4d42, true);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 2, true);
  view.setInt32(22, 2, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 0, true);
  view.setUint32(30, 5, true);
  view.setUint32(34, 33, true);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pixelOffset);
  view.setUint32(pixelOffset + 16, 100_000, false);
  view.setUint32(pixelOffset + 20, 100_000, false);
  return new Blob([bytes], { type: 'image/bmp' });
}

const paste = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Paste' }));
  return lastPaste;
};

const resetStoreState = () => {
  dispatchMock.mockClear();
  createLayerFromBitmapMock.mockReset();
  createLayerFromBitmapMock.mockResolvedValue(true);
  readImageFromClipboardMock.mockReset();
  readImageFromClipboardMock.mockResolvedValue(null);
  lastPaste = null;
  storeState.activeSelectionId = 'selection-1';
  storeState.documentFrame = undefined;
  storeState.layers = undefined;
  storeState.selectionClipboard = null;
  storeState.selections = [createLassoSelection()];
  storeState.totalSize = { width: 100, height: 100 };
};

describe('useSelectionClipboard', () => {
  beforeEach(() => {
    resetStoreState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('copies the active lasso selection from the merged visible canvas into the in-app clipboard', () => {
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'SET_SELECTION_CLIPBOARD',
      payload: expect.objectContaining({
        name: 'Selection copy',
        pos: { x: 10, y: 20, width: 30, height: 40 },
        sourceSelectionId: 'selection-1',
        sourceTool: 'freehand-lasso',
      }),
    });
    expect(dispatchMock).toHaveBeenCalledWith({ type: 'MARK_SELECTION_COPIED', payload: { id: 'selection-1' } });
  });

  it('rejects an oversized clipboard image before cloning or creating a layer', async () => {
    const OriginalOffscreenCanvas = globalThis.OffscreenCanvas;
    const allocations = vi.fn();
    class RecordingOffscreenCanvas extends OriginalOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations(width, height);
        super(width, height);
      }
    }
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
    storeState.selectionClipboard = createClipboard({
      bitmap: createMockImageBitmap(10_001, 10_000),
      pos: { x: 0, y: 0, width: 10_001, height: 10_000 },
    });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);
    expect(allocations).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('pastes the in-app clipboard bitmap as an independent new layer at the copied selection position', () => {
    const clipboardBitmap = createMockImageBitmap(30, 40);
    storeState.selectionClipboard = {
      bitmap: clipboardBitmap,
      copiedAt: 123,
      name: 'Selection copy',
      pos: { x: 10, y: 20, width: 30, height: 40 },
      sourceSelectionId: 'selection-1',
      sourceTool: 'freehand-lasso',
    };

    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(createLayerFromBitmapMock).toHaveBeenCalledWith({
      bitmap: expect.any(OffscreenCanvas),
      name: 'Layer 1',
      pos: { x: 35, y: 30, width: 30, height: 40 },
    });
    expect(createLayerFromBitmapMock.mock.calls[0][0].bitmap).not.toBe(clipboardBitmap);
  });

  it('pastes a system clipboard image as a centered new layer', async () => {
    const bitmap = createMockImageBitmap(20, 10);
    readImageFromClipboardMock.mockResolvedValue({ bitmap, mimeType: 'image/png' });
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(true);
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith({
      bitmap,
      name: 'Layer 1',
      pos: { x: 40, y: 45, width: 20, height: 10 },
    });
    expect(bitmap.close).not.toHaveBeenCalled();
  });

  it('keeps native BMP compression support after bounded clipboard preflight', async () => {
    const source = createRle8BmpBlob();
    const bitmap = createMockImageBitmap(2, 2);
    const createBitmap = vi.fn<(source: Blob | ImageBitmapSource) => Promise<ImageBitmap>>().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', createBitmap);
    readImageFromClipboardMock.mockImplementationOnce(
      async (options: { decodeImage: (blob: Blob, mimeType: string) => Promise<ImageBitmap> }) => ({
        bitmap: await options.decodeImage(source, 'image/bmp'),
        mimeType: 'image/bmp',
      })
    );
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(true);

    expect(createBitmap).toHaveBeenCalledTimes(1);
    expect(createBitmap.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(createBitmap.mock.calls[0][0]).toHaveProperty('size', source.size);
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ bitmap, pos: { x: 49, y: 49, width: 2, height: 2 } })
    );
  });

  it('rejects BMPs with embedded images before native decoding', async () => {
    const source = createBmpWithOversizedEmbeddedPng();
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    readImageFromClipboardMock.mockImplementationOnce(
      async (options: { decodeImage: (blob: Blob, mimeType: string) => Promise<ImageBitmap> }) => {
        try {
          const bitmap = await options.decodeImage(source, 'image/bmp');
          return { bitmap, mimeType: 'image/bmp' };
        } catch {
          return null;
        }
      }
    );
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createBitmap).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('closes a system clipboard bitmap when layer creation rejects', async () => {
    const bitmap = createMockImageBitmap(20, 10);
    const failure = new Error('layer creation failed');
    readImageFromClipboardMock.mockResolvedValue({ bitmap, mimeType: 'image/png' });
    createLayerFromBitmapMock.mockRejectedValueOnce(failure);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(bitmap.close).toHaveBeenCalledExactlyOnceWith();
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Unable to paste system clipboard image', failure);
    consoleErrorSpy.mockRestore();
  });

  it('closes and reports failure when layer creation is refused', async () => {
    const bitmap = createMockImageBitmap(20, 10);
    readImageFromClipboardMock.mockResolvedValue({ bitmap, mimeType: 'image/png' });
    createLayerFromBitmapMock.mockResolvedValueOnce(false);
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createLayerFromBitmapMock).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledExactlyOnceWith();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('closes an oversized system clipboard bitmap before creating a layer', async () => {
    const bitmap = createMockImageBitmap(10_001, 10_000);
    readImageFromClipboardMock.mockResolvedValue({ bitmap, mimeType: 'image/png' });
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(bitmap.close).toHaveBeenCalledExactlyOnceWith();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('preflights an oversized system clipboard image before browser bitmap decoding', async () => {
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
    readImageFromClipboardMock.mockImplementation(async ({ decodeImage }) => {
      expect(decodeImage).toBeTypeOf('function');
      try {
        const bitmap = await decodeImage(createOversizedBmpBlob(), 'image/bmp');
        return { bitmap, mimeType: 'image/bmp' };
      } catch {
        return null;
      }
    });
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('rejects a Photoshop document disguised as a clipboard raster before browser decoding', async () => {
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
    readImageFromClipboardMock.mockImplementation(async ({ decodeImage }) => {
      expect(decodeImage).toBeTypeOf('function');
      try {
        const bitmap = await decodeImage(createPhotoshopSignatureBlob(), 'image/png');
        return { bitmap, mimeType: 'image/png' };
      } catch {
        return null;
      }
    });
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('rejects clipboard image types without a bounded preflight path', async () => {
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
    readImageFromClipboardMock.mockImplementation(async ({ decodeImage }) => {
      expect(decodeImage).toBeTypeOf('function');
      try {
        const bitmap = await decodeImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/avif' }), 'image/avif');
        return { bitmap, mimeType: 'image/avif' };
      } catch {
        return null;
      }
    });
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });

  it('refuses a system clipboard image when no image item is available', async () => {
    render(<ClipboardProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste System Image' }));
    await expect(lastPaste).resolves.toBe(false);
    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
  });
});

describe('pasteSelectionClipboard', () => {
  const clonedCanvases: RecordingOffscreenCanvas[] = [];

  class RecordingOffscreenCanvas {
    width = 0;
    height = 0;
    drawImage = vi.fn();

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      clonedCanvases.push(this);
    }

    getContext() {
      return { drawImage: this.drawImage };
    }
  }

  beforeEach(() => {
    resetStoreState();
    clonedCanvases.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports failure and creates no layer when the clipboard is empty', async () => {
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);

    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('reports failure when layer creation refuses a selection clipboard paste', async () => {
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
    storeState.selectionClipboard = createClipboard();
    createLayerFromBitmapMock.mockResolvedValueOnce(false);
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);
    expect(createLayerFromBitmapMock).toHaveBeenCalledOnce();
  });

  it('clones the clipboard bitmap and centers the new layer in document space', async () => {
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas);
    storeState.documentFrame = { x: 12, y: 7, width: 100, height: 100 };
    const clipboardBitmap = createMockImageBitmap(30, 40);
    storeState.selectionClipboard = createClipboard({ bitmap: clipboardBitmap });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(clonedCanvases).toHaveLength(1);
    expect(clonedCanvases[0].drawImage).toHaveBeenCalledExactlyOnceWith(clipboardBitmap, 0, 0);
    expect(clonedCanvases[0].width).toBe(30);
    expect(clonedCanvases[0].height).toBe(40);
    // The frame origin must not enter the centre: `createLayerFromBitmap` hands this `pos`
    // to `createLayerSource`, whose non-bedrock arm copies it onto the layer verbatim.
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith({
      bitmap: clonedCanvases[0],
      name: 'Layer 1',
      pos: { x: 35, y: 30, width: 30, height: 40 },
    });
  });

  it('clamps a clipboard larger than the document to the document origin', async () => {
    storeState.documentFrame = { x: 12, y: 7, width: 100, height: 100 };
    storeState.selectionClipboard = createClipboard({
      bitmap: createMockImageBitmap(300, 400),
      pos: { x: 0, y: 0, width: 300, height: 400 },
    });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    // The floor is DOCUMENT (0, 0), not the frame origin.
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pos: { x: 0, y: 0, width: 300, height: 400 },
      })
    );
  });

  it('prefers the clipboard position size over the bitmap size', async () => {
    storeState.documentFrame = { x: 40, y: 25, width: 100, height: 100 };
    storeState.selectionClipboard = createClipboard({
      bitmap: createMockImageBitmap(99, 99),
      pos: { x: 10, y: 20, width: 30, height: 40 },
    });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    // A non-zero frame origin, so the size preference is asserted in document space rather
    // than passing by accident: the 99x99 bitmap would centre at {1, 1} with itself.
    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pos: { x: 35, y: 30, width: 30, height: 40 },
      })
    );
  });

  it('does not shift the pasted layer by a non-zero document frame origin', async () => {
    storeState.documentFrame = { x: 12, y: 7, width: 100, height: 100 };
    storeState.selectionClipboard = createClipboard();
    const { rerender } = render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);
    const withFrameOrigin = createLayerFromBitmapMock.mock.calls[0][0].pos;

    createLayerFromBitmapMock.mockReset();
    createLayerFromBitmapMock.mockResolvedValue(true);
    storeState.documentFrame = undefined;
    rerender(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);
    const withoutFrameOrigin = createLayerFromBitmapMock.mock.calls[0][0].pos;

    expect(withFrameOrigin).toEqual({ x: 35, y: 30, width: 30, height: 40 });
    expect(withFrameOrigin).toEqual(withoutFrameOrigin);
  });

  it('falls back to the bitmap size when the clipboard position size is zero on both axes', async () => {
    storeState.selectionClipboard = createClipboard({
      bitmap: createMockImageBitmap(30, 40),
      pos: { x: 10, y: 20, width: 0, height: 0 },
    });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pos: { x: 35, y: 30, width: 30, height: 40 },
      })
    );
  });

  it('falls back per axis so a zero width is taken from the bitmap', async () => {
    storeState.selectionClipboard = createClipboard({
      bitmap: createMockImageBitmap(60, 40),
      pos: { x: 10, y: 20, width: 0, height: 40 },
    });
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pos: { x: 20, y: 30, width: 60, height: 40 },
      })
    );
  });

  it('reports failure without creating a layer when the clipboard position cannot be read', async () => {
    const failure = new Error('clipboard pos is unreadable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeState.selectionClipboard = {
      bitmap: createMockImageBitmap(30, 40),
      copiedAt: 123,
      name: 'Selection copy',
      sourceSelectionId: 'selection-1',
      sourceTool: 'freehand-lasso',
      get pos(): Selection['pos'] {
        throw failure;
      },
    } as unknown as SelectionClipboard;
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);

    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Unable to paste selection clipboard', failure);
  });

  it('reports failure without creating a layer when the bitmap size fallback cannot be read', async () => {
    const failure = new Error('clipboard bitmap is unreadable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeState.selectionClipboard = {
      copiedAt: 123,
      name: 'Selection copy',
      pos: { x: 10, y: 20, width: 0, height: 0 },
      sourceSelectionId: 'selection-1',
      sourceTool: 'freehand-lasso',
      get bitmap(): ImageBitmap {
        throw failure;
      },
    } as unknown as SelectionClipboard;
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);

    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Unable to paste selection clipboard', failure);
  });

  it('reports failure without creating a layer when cloning the clipboard bitmap throws', async () => {
    const failure = new Error('clipboard bitmap is unreadable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeState.selectionClipboard = {
      copiedAt: 123,
      name: 'Selection copy',
      pos: { x: 10, y: 20, width: 30, height: 40 },
      sourceSelectionId: 'selection-1',
      sourceTool: 'freehand-lasso',
      get bitmap(): ImageBitmap {
        throw failure;
      },
    } as unknown as SelectionClipboard;
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);

    expect(createLayerFromBitmapMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Unable to paste selection clipboard', failure);
  });

  it('reports failure and creates no layer when the layer creation rejects', async () => {
    const failure = new Error('layer creation failed');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storeState.selectionClipboard = createClipboard();
    createLayerFromBitmapMock.mockRejectedValueOnce(failure);
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(false);

    expect(createLayerFromBitmapMock).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledExactlyOnceWith('Unable to paste selection clipboard', failure);
  });

  it('pastes into an empty layer record when the store has no layers yet', async () => {
    storeState.layers = undefined;
    storeState.selectionClipboard = createClipboard();
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Layer 1' }));
  });

  it('numbers the pasted layer from the layer names, not the layer record keys', async () => {
    storeState.layers = {
      'Layer 1': { name: 'Background' },
      'Layer 9': { name: 'Layer 4' },
    };
    storeState.selectionClipboard = createClipboard();
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Layer 5' }));
  });

  it('starts the pasted layer numbering after the highest existing layer number', async () => {
    storeState.layers = {
      background: { name: 'Background' },
      first: { name: 'Layer 7' },
      second: { name: 'Layer 2' },
    };
    storeState.selectionClipboard = createClipboard();
    render(<ClipboardProbe />);

    await expect(paste()).resolves.toBe(true);

    expect(createLayerFromBitmapMock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Layer 8' }));
  });
});
