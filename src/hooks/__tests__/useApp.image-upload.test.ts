import { act, render, screen } from '@testing-library/react';
import { createElement, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import type { Layer } from '../../contexts/layer-types.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';
import type { ImageUploadResponse } from '../../contexts/file-types.ts';

const harness = vi.hoisted(() => {
  const events: string[] = [];
  const listeners = new Set<() => void>();
  const fileName = { current: '' };
  const canvasSize = { width: 640, height: 480 };
  const canvas = {
    get width() {
      return canvasSize.width;
    },
    set width(value: number) {
      canvasSize.width = value;
      events.push(`resizeCanvas:${value}x${canvasSize.height}`);
    },
    get height() {
      return canvasSize.height;
    },
    set height(value: number) {
      canvasSize.height = value;
      events.push(`resizeCanvas:${canvasSize.width}x${value}`);
    },
  };

  return {
    canvas,
    canvasSize,
    currentArgs: { current: {} as Record<string, unknown> },
    dispatch: vi.fn(),
    adoptLayerBitmaps: vi.fn(),
    events,
    fileName,
    listeners,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

const layerMocks = vi.hoisted(() => ({
  createBlankLayer: vi.fn(),
  commitDirtyTool: vi.fn(),
  createLayerFromBitmap: vi.fn(),
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: harness.canvas },
      clearPreviewLayers: vi.fn(),
      currentArgs: harness.currentArgs,
      activeSelectionId: null,
      rectOverlayRef: { current: null },
      selectionCleared: null,
      selections: [],
      toolName: 'draw',
      toolOverlayRef: { current: null },
      adoptLayerBitmaps: harness.adoptLayerBitmaps,
    },
    harness.dispatch,
  ],
}));

vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => layerMocks }));

const FileNameProbe = () => {
  const fileName = useSyncExternalStore(
    harness.subscribe,
    () => harness.fileName.current,
    () => harness.fileName.current
  );

  return createElement('div', { 'data-testid': 'document-name' }, fileName);
};

const renderFileNameProbe = () => render(createElement(FileNameProbe));

const createImage = (width: number, height: number) =>
  ({
    complete: true,
    height,
    naturalHeight: height,
    naturalWidth: width,
    src: '',
    width,
  }) as HTMLImageElement;

const createPsdDocument = (warnings: string[]): PsdDocument => {
  const layer = {
    id: 'top',
    name: 'Imported top',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 20, height: 30, close: vi.fn() } as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'normal' as const,
    order: 1,
    pos: { x: 0, y: 0, width: 20, height: 30 },
    operations: [],
  } as unknown as Layer;

  return {
    size: { width: 320, height: 180 },
    warnings,
    layers: { top: layer },
  };
};

describe('useApp setImageFromUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.events.length = 0;
    harness.listeners.clear();
    harness.canvasSize.width = 640;
    harness.canvasSize.height = 480;
    harness.currentArgs.current = {};
    harness.fileName.current = 'untitled.png';
    harness.dispatch.mockImplementation((action: { type: string; payload?: unknown }) => {
      harness.events.push(action.type);
      if (action.type === 'SET_FILE_NAME' && typeof action.payload === 'string') {
        harness.fileName.current = action.payload;
        for (const listener of [...harness.listeners]) listener();
      }
    });
    harness.adoptLayerBitmaps.mockImplementation(() => {
      harness.events.push('ADOPT_LAYER_BITMAPS');
    });
    layerMocks.createLayerFromBitmap.mockImplementation(async () => {
      harness.events.push('createLayerFromBitmap');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates the bedrock layer, then gives the canvas the image size, then renames the document', async () => {
    const image = createImage(80, 40);

    await useApp().setImageFromUpload({ fileName: 'photo.png', image });

    expect(harness.events).toEqual([
      'createLayerFromBitmap',
      'resizeCanvas:80x480',
      'resizeCanvas:80x40',
      'SET_FILE_NAME',
    ]);
    expect(layerMocks.createLayerFromBitmap).toHaveBeenCalledExactlyOnceWith(
      {
        bitmap: image,
        name: 'photo.png',
        size: { width: 80, height: 40 },
        isBedrock: true,
      },
      true
    );
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_FILE_NAME', payload: 'photo.png' });
    expect(harness.canvasSize).toEqual({ width: 80, height: 40 });
  });

  it('still holds the previous canvas size while the layer creation is in flight', async () => {
    // Parked INSIDE the awaited layer creation, not merely pending: a mock that resolved at once
    // could not tell a resize that happens before the replacement is published from one that
    // happens after, because both would have run by the time the call returns.
    let release: () => void = () => {};
    const parked = new Promise<void>((resolve) => {
      release = resolve;
    });
    layerMocks.createLayerFromBitmap.mockImplementation(async () => {
      harness.events.push('createLayerFromBitmap');
      await parked;
    });

    const upload = useApp().setImageFromUpload({ fileName: 'sized.png', image: createImage(120, 90) });
    await act(async () => {
      await Promise.resolve();
    });

    // The layer creation has started and has not resolved, so this IS the in-flight canvas.
    // It must not have taken the image's geometry: `createLayerFromBitmap` can reject, and a
    // canvas resized before the replacement is published is sized for a document that was never
    // adopted. Reading the geometry is what separates a resize placed before the await from one
    // placed after it — the final event-order assertion below cannot, because both record the
    // same sequence.
    expect(harness.events).toEqual(['createLayerFromBitmap']);
    expect(harness.canvasSize).toEqual({ width: 640, height: 480 });

    release();
    await act(async () => {
      await upload;
    });

    expect(harness.events).toEqual([
      'createLayerFromBitmap',
      'resizeCanvas:120x480',
      'resizeCanvas:120x90',
      'SET_FILE_NAME',
    ]);
    expect(harness.canvasSize).toEqual({ width: 120, height: 90 });
  });

  it('renames the rendered document once the image layer exists', async () => {
    renderFileNameProbe();
    expect(screen.getByTestId('document-name')).toHaveTextContent('untitled.png');

    await act(async () => {
      await useApp().setImageFromUpload({ fileName: 'renamed.png', image: createImage(64, 32) });
    });

    expect(screen.getByTestId('document-name')).toHaveTextContent('renamed.png');
  });

  it('propagates a layer creation failure to the caller without renaming the document', async () => {
    const failure = new Error('bitmap upload failed');
    layerMocks.createLayerFromBitmap.mockImplementation(async () => {
      harness.events.push('createLayerFromBitmap');
      throw failure;
    });
    renderFileNameProbe();

    const upload = useApp().setImageFromUpload({ fileName: 'broken.png', image: createImage(80, 40) });
    await act(async () => {
      await expect(upload).rejects.toBe(failure);
    });

    expect(harness.events).toEqual(['createLayerFromBitmap']);
    expect(layerMocks.createLayerFromBitmap).toHaveBeenCalledOnce();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('document-name')).toHaveTextContent('untitled.png');
    // The canvas keeps the OUTGOING document's geometry. A decode failure replaces nothing, and a
    // canvas already resized to the incoming file's extent is sized for a document that was never
    // adopted — the retained document then renders through a canvas of the wrong size until
    // something redraws it, while the tool overlays keep the geometry they had.
    expect(harness.canvasSize).toEqual({ width: 640, height: 480 });
  });

  it('returns before resizing, creating a layer, or renaming when PSD warnings are declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await useApp().setImageFromUpload({
      fileName: 'design.psd',
      document: createPsdDocument(['Masks are unsupported']),
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Masks are unsupported'));
    expect(harness.events).toEqual([]);
    expect(layerMocks.createLayerFromBitmap).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.canvasSize).toEqual({ width: 640, height: 480 });
  });

  it('carries an accepted PSD file name in the replacement payload instead of a separate rename', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await useApp().setImageFromUpload({
      fileName: 'design.psd',
      document: createPsdDocument(['Text is rasterized']),
    });

    // The adoption lands after the replacement: the presentation scope is keyed by the owning
    // document, so a registration published first would be filed under the outgoing one.
    expect(harness.events).toEqual([
      'resizeCanvas:320x480',
      'resizeCanvas:320x180',
      'REPLACE_DOCUMENT',
      'ADOPT_LAYER_BITMAPS',
    ]);
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REPLACE_DOCUMENT',
        payload: expect.objectContaining({
          updates: expect.objectContaining({ fileName: 'design.psd' }),
        }),
      })
    );
    expect(layerMocks.createLayerFromBitmap).not.toHaveBeenCalled();
  });

  it('never renames the document or creates a layer for a payload without an image or a document', async () => {
    const upload = useApp().setImageFromUpload({ fileName: 'empty.png' } as unknown as ImageUploadResponse);

    await expect(upload).rejects.toThrow(TypeError);

    expect(harness.events).toEqual([]);
    expect(layerMocks.createLayerFromBitmap).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.canvasSize).toEqual({ width: 640, height: 480 });
  });
});
