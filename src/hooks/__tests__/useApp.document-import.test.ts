import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import { createMockImageBitmap } from '@/__tests__/fixtures/canvas.ts';
import { createImageLayer, createToolLayer } from '@/__tests__/fixtures/layer.ts';
import { OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';
import type { Layer } from '../../contexts/layer-types.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

/**
 * Document-import coverage for `useApp`.
 *
 * `useApp.psd.test.ts` is protected and `useApp.failure-paths.test.ts` /
 * `useApp.image-upload.test.ts` own the rejection and warning-decline paths.
 * This file covers the remaining `setImageFromUpload` document branches: an
 * already immutable raster, a non-image layer source, active-layer selection by
 * order, an empty layer record, and partially attached canvases.
 */

const harness = vi.hoisted(() => ({
  state: {
    canvasRef: { current: null as HTMLCanvasElement | null },
    toolOverlayRef: { current: null as HTMLCanvasElement | null },
    rectOverlayRef: { current: null as HTMLCanvasElement | null },
    currentArgs: { current: {} as Record<string, unknown> },
    toolName: 'reposition' as ToolName,
    activeSelectionId: null as string | null,
    selections: [],
    selectionCleared: null as { status: string; version: number } | null,
    clearPreviewLayers: vi.fn(),
  },
  dispatch: vi.fn(),
  layerMocks: {
    createBlankLayer: vi.fn(),
    createLayerFromBitmap: vi.fn(),
    commitDirtyTool: vi.fn(),
  },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [harness.state, harness.dispatch],
}));

vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => harness.layerMocks }));

function imageLayer(id: string, order: number, bitmap: ImageBitmap): Layer {
  return createImageLayer(bitmap, {
    id,
    order,
    pos: { x: 0, y: 0, width: 20, height: 30 },
    tmpCanvas: new OffscreenCanvas(20, 30),
  });
}

function toolLayer(id: string, order: number): Layer {
  return createToolLayer('draw', {
    id,
    order,
    pos: { x: 5, y: 5, width: 10, height: 10 },
  });
}

function documentOf(layers: Record<string, Layer>, warnings: string[] = []): PsdDocument {
  return { size: { width: 20, height: 30 }, warnings, layers };
}

type ReplacementPayload = {
  updates: Record<string, unknown>;
  history: { actionName: string; layerId: string; documentSource?: { layers: Record<string, Layer> } }[];
};

function replacementUpdates() {
  const call = harness.dispatch.mock.calls.find(([action]) => action.type === 'REPLACE_DOCUMENT');
  expect(call).toBeDefined();
  return (call![0] as { payload: ReplacementPayload }).payload;
}

function createCanvas(width = 640, height = 480) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

describe('useApp document import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state.canvasRef.current = createCanvas();
    harness.state.toolOverlayRef.current = createCanvas();
    harness.state.rectOverlayRef.current = createCanvas();
    harness.state.currentArgs.current = { toolName: 'leftover' };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses an already immutable raster instead of re-encoding it', async () => {
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
    const bitmap = createMockImageBitmap(20, 30);
    const layer = imageLayer('top', 1, bitmap);

    await useApp().setImageFromUpload({ fileName: 'immutable.psd', document: documentOf({ top: layer }) });

    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    const { updates } = replacementUpdates();
    const imported = (updates.layers as Record<string, Layer>).top;
    expect(imported.bitmap).toBe(bitmap);
    expect(imported.source).toEqual({ ...layer.source, bitmap });
    // The temporary scratch canvas is dropped, not carried into the document.
    expect(imported.tmpCanvas).toBeNull();
  });

  it('passes a non-image layer through untouched', async () => {
    const layer = toolLayer('tools', 2);
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');

    await useApp().setImageFromUpload({ fileName: 'tools.psd', document: documentOf({ tools: layer }) });

    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    const { updates } = replacementUpdates();
    const imported = (updates.layers as Record<string, Layer>).tools;
    expect(imported).toBe(layer);
    expect(imported.source?.kind).toBe('tool');
  });

  it('activates the highest-order layer of a mixed document', async () => {
    const background = imageLayer('background', 0, createMockImageBitmap(20, 30));
    const tools = toolLayer('tools', 3);
    const top = imageLayer('top', 7, createMockImageBitmap(20, 30));

    await useApp().setImageFromUpload({
      fileName: 'mixed.psd',
      document: documentOf({ background, tools, top }),
    });

    const { updates, history } = replacementUpdates();
    expect(updates.activeLayerId).toBe('top');
    expect(history[0].layerId).toBe('top');
    expect(history[0].actionName).toBe(OPEN_DOCUMENT_ACTION);
  });

  it('activates no layer for an empty document and still marks it as having an image', async () => {
    await useApp().setImageFromUpload({ fileName: 'empty.psd', document: documentOf({}) });

    const { updates, history } = replacementUpdates();
    expect(updates.activeLayerId).toBeNull();
    expect(updates.hasImage).toBe(true);
    expect(history[0].layerId).toBe('');
  });

  it('does not prompt when the document has no warnings', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');

    await useApp().setImageFromUpload({ fileName: 'clean.psd', document: documentOf({}) });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(harness.dispatch).toHaveBeenCalledOnce();
  });

  it('resizes only the canvases that are attached', async () => {
    harness.state.toolOverlayRef.current = null;
    harness.state.rectOverlayRef.current = null;
    const canvas = harness.state.canvasRef.current!;

    await expect(
      useApp().setImageFromUpload({ fileName: 'partial.psd', document: documentOf({}) })
    ).resolves.toBeUndefined();

    expect([canvas.width, canvas.height]).toEqual([20, 30]);
  });

  it('snapshots the baseline layers with copied positions', async () => {
    const layer = imageLayer('top', 0, createMockImageBitmap(20, 30));
    layer.pos = { x: 3, y: 4, width: 20, height: 30 };

    await useApp().setImageFromUpload({ fileName: 'baseline.psd', document: documentOf({ top: layer }) });

    const { history } = replacementUpdates();
    const baseline = history[0].documentSource!.layers;
    expect(baseline.top).not.toBe(layer);
    expect(baseline.top.pos).toEqual({ x: 3, y: 4, width: 20, height: 30 });
    expect(baseline.top.pos).not.toBe(layer.pos);
  });
});
