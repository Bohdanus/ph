import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as layerRenderer from '../layer-renderer.ts';
import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import {
  OPEN_DOCUMENT_ACTION,
  RENAME_LAYER_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';

type ProbeValue = {
  store: StoreData;
  dispatch: StoreDispatch;
  reset: (index: number) => Promise<void>;
  toggleDisabled: (id: string) => Promise<void>;
};

function createProbe(ref: { current: ProbeValue | null }, attachCanvas = false) {
  function Probe() {
    const [store, dispatch] = useStore();
    const { resetHistoryTo, toggleDisabled } = useHistory();
    useLayoutEffect(() => {
      ref.current = { store, dispatch, reset: resetHistoryTo, toggleDisabled };
    });
    return attachCanvas ? <canvas aria-label="visible workspace" ref={store.canvasRef} /> : null;
  }
  return Probe;
}

function layer(name = 'Layer 1'): Layer {
  return {
    id: 'layer-1',
    name,
    isBedrock: true,
    bitmap: null,
    tmpCanvas: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    pos: { x: 0, y: 0, width: 100, height: 80 },
    presentationBounds: null,
    operations: [],
    source: { kind: 'blank', color: '#ffffff', opacity: 1, size: { width: 100, height: 80 }, isBedrock: true },
  };
}

describe('resetHistoryTo durable authority', () => {
  it('uses complete legacy fallback through a real StoreProvider when the durable sidecar is unavailable', async () => {
    const ref = { current: null as ProbeValue | null };
    const initialLayer = layer();
    const initialFrame = { x: 0, y: 0, width: 100, height: 80 };
    const currentFrame = { x: 10, y: 15, width: 90, height: 70 };
    const baseline: HistoryItem = {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': initialLayer },
        size: { width: initialFrame.width, height: initialFrame.height },
        frame: initialFrame,
      },
    } as HistoryItem;
    const frameChange: HistoryItem = {
      id: 'frame',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'layer-1',
      args: { previousFrame: initialFrame, nextFrame: currentFrame },
    };
    const rename: HistoryItem = {
      id: 'rename',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'layer-1',
      args: { name: 'Renamed' },
    };
    const unsupported: HistoryItem = {
      id: 'unsupported',
      actionName: TOOL_ACTION,
      layerId: 'layer-1',
      args: { toolName: 'pen' },
    };
    const history = [baseline, frameChange, rename, unsupported];
    const Probe = createProbe(ref);

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>
    );
    expect(ref.current).not.toBeNull();

    act(() => {
      ref.current!.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'reset-test',
          history,
          historyIndex: 0,
          updates: {
            layers: { 'layer-1': initialLayer },
            totalSize: { width: 100, height: 80 },
            documentFrame: initialFrame,
          },
        },
      });
    });

    await act(async () => {
      await ref.current!.reset(3);
    });

    const after = ref.current!.store;
    expect(after.historyIndex).toBe(3);
    expect(after.layers['layer-1']).toMatchObject({ name: 'Renamed' });
    expect(after.documentFrame).toEqual(currentFrame);
    expect(after.renderSelector.source).toBe('legacy');
    expect(after.durableStatus).toBe('partial');
    expect(after.durableDocument).toBeNull();
    expect(after.durableDiagnostics).toContainEqual(
      expect.objectContaining({ historyId: 'unsupported', code: 'unsupported-history-feature' })
    );
    expect(after.durablePresentation.status).toBe('unpublished');
  });

  it('restores prior replay state when the final replay draw is refused', async () => {
    const ref = { current: null as ProbeValue | null };
    const initialLayer = layer();
    const renamedLayer = layer('Renamed');
    const initialFrame = { x: 0, y: 0, width: 100, height: 80 };
    const currentFrame = { x: 10, y: 15, width: 90, height: 70 };
    const deletedLayer = { ...layer('Deleted'), id: 'deleted-layer' };
    const deletedLayers = { 'deleted-layer': deletedLayer };
    const selection: Selection = {
      id: 'selection-1',
      points: [
        [
          { x: 2, y: 3 },
          { x: 10, y: 3 },
          { x: 10, y: 10 },
        ],
      ],
      isActive: true,
      pos: { x: 2, y: 3, width: 8, height: 7 },
    };
    const baseline: HistoryItem = {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': initialLayer },
        size: { width: initialFrame.width, height: initialFrame.height },
        frame: initialFrame,
      },
    } as HistoryItem;
    const frameChange: HistoryItem = {
      id: 'frame',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'layer-1',
      args: { previousFrame: initialFrame, nextFrame: currentFrame },
    };
    const rename: HistoryItem = {
      id: 'rename',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'layer-1',
      args: { name: 'Renamed' },
    };
    const history = [baseline, frameChange, rename];
    const Probe = createProbe(ref, true);

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>
    );
    expect(ref.current).not.toBeNull();

    act(() => {
      ref.current!.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'durable-draw-rollback',
          history,
          historyIndex: 2,
          updates: {
            layers: { 'layer-1': renamedLayer },
            deletedLayers,
            activeLayerId: null,
            totalSize: { width: currentFrame.width, height: currentFrame.height },
            documentFrame: currentFrame,
            selections: [selection],
            activeSelectionId: selection.id,
            hasUnsavedChanges: true,
          },
        },
      });
    });

    const before = ref.current!.store;
    expect(before.durableStatus).toBe('current');
    expect(before.durableDocument).not.toBeNull();
    expect(before.historyIndex).toBe(2);
    expect(before.activeLayerId).toBeNull();
    expect(before.deletedLayers).toEqual(deletedLayers);
    expect(before.totalSize).toEqual({ width: currentFrame.width, height: currentFrame.height });
    expect(before.documentFrame).toEqual(currentFrame);
    expect(before.selections).toEqual([selection]);
    expect(before.activeSelectionId).toBe(selection.id);
    expect(before.hasUnsavedChanges).toBe(true);
    const visibleCanvas = before.canvasRef.current;
    expect(visibleCanvas).not.toBeNull();

    const visibleContext = vi.spyOn(visibleCanvas!, 'getContext').mockReturnValue(null);
    const drawLayers = vi.spyOn(layerRenderer, 'drawLayersToCanvas');
    drawLayers.mockClear();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await act(async () => {
        await ref.current!.reset(0);
      });

      expect(drawLayers).toHaveBeenCalledTimes(1);
      expect(drawLayers.mock.results[0]?.value).toBe(false);
      const drawnLayers = drawLayers.mock.calls[0]?.[1];
      expect(drawnLayers).toHaveLength(1);
      expect(drawnLayers?.[0]).toMatchObject({ id: 'layer-1', operations: [] });
      expect(drawnLayers?.[0]).not.toHaveProperty('source');
      expect(visibleContext).toHaveBeenCalledWith('2d');

      const after = ref.current!.store;
      expect(after.history).toEqual(before.history);
      expect(after.historyIndex).toBe(before.historyIndex);
      expect(after.branchRevision).toBe(before.branchRevision);
      expect(after.layers).toEqual(before.layers);
      expect(after.layers['layer-1']).toMatchObject({ name: 'Renamed' });
      expect(after.deletedLayers).toEqual(before.deletedLayers);
      expect(after.activeLayerId).toBe(before.activeLayerId);
      expect(after.totalSize).toEqual(before.totalSize);
      expect(after.documentFrame).toEqual(before.documentFrame);
      expect(after.selections).toEqual(before.selections);
      expect(after.activeSelectionId).toBe(before.activeSelectionId);
      expect(after.hasUnsavedChanges).toBe(true);
      expect(after.durableStatus).toBe('unavailable');
      expect(after.durableDocument).toBeNull();
      expect(after.durablePresentation).toEqual({ status: 'unpublished', cursor: null, reason: null });
      expect(after.durableRenderProjection).toBeNull();
      expect(after.renderSelector).toMatchObject({ source: 'legacy', historyCursor: before.historyIndex });
      expect(after.durableDiagnostics).toEqual([
        expect.objectContaining({
          historyId: 'baseline',
          code: 'conversion-failed',
          message: 'Unable to publish replayed history presentation',
        }),
      ]);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('History replay is unavailable', expect.any(Error));
    } finally {
      visibleContext.mockRestore();
      drawLayers.mockRestore();
      consoleError.mockRestore();
    }
  });

  it('rebuilds durable replay after disabling an earlier history action', async () => {
    const ref = { current: null as ProbeValue | null };
    const initialLayer = layer();
    const baseline: HistoryItem = {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': initialLayer },
        size: { width: 100, height: 80 },
        frame: { x: 0, y: 0, width: 100, height: 80 },
      },
    } as HistoryItem;
    const rename: HistoryItem = {
      id: 'rename',
      actionName: RENAME_LAYER_ACTION,
      layerId: 'layer-1',
      args: { name: 'Renamed' },
    };
    const opacity: HistoryItem = {
      id: 'opacity',
      actionName: SET_LAYER_OPACITY_ACTION,
      layerId: 'layer-1',
      args: { opacity: 0.5 },
    };
    const history = [baseline, rename, opacity];
    const Probe = createProbe(ref, true);

    render(
      <StoreProvider>
        <Probe />
      </StoreProvider>
    );
    expect(ref.current).not.toBeNull();

    act(() => {
      ref.current!.dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'toggle-disabled-durable',
          history,
          historyIndex: 2,
          updates: {
            layers: { 'layer-1': { ...layer('Renamed'), opacity: 0.5 } },
            totalSize: { width: 100, height: 80 },
            documentFrame: { x: 0, y: 0, width: 100, height: 80 },
          },
        },
      });
    });

    const beforeToggle = ref.current!.store;
    expect(beforeToggle.durableStatus).toBe('current');
    expect(beforeToggle.historyIndex).toBe(2);
    expect(beforeToggle.branchRevision).toBe(0);
    expect(beforeToggle.layers['layer-1']).toMatchObject({ name: 'Renamed', opacity: 0.5 });
    expect(beforeToggle.durableDocument?.cursor).toBe(1);
    expect(beforeToggle.durableDocument?.history.map((entry) => entry.id)).toEqual(['rename', 'opacity']);
    expect(beforeToggle.durableDocument?.history[0]?.enabled).toBe(true);

    await act(async () => {
      await ref.current!.toggleDisabled('rename');
    });

    const afterToggle = ref.current!.store;
    expect(afterToggle.historyIndex).toBe(2);
    expect(afterToggle.history[1]).toMatchObject({ id: 'rename', disabled: true });
    expect(afterToggle.branchRevision).toBe(1);
    expect(afterToggle.durableStatus).toBe('current');
    expect(afterToggle.durableDocument).not.toBeNull();
    expect(afterToggle.durableDocument?.cursor).toBe(1);
    expect(afterToggle.durableDocument?.branchRevision).toBe(afterToggle.branchRevision);
    expect(afterToggle.durableDocument?.history.map((entry) => entry.id)).toEqual(['rename', 'opacity']);
    expect(afterToggle.durableDocument?.history[0]?.enabled).toBe(false);
    expect(afterToggle.durableDocument?.history[1]?.enabled).toBe(true);
    expect(afterToggle.durableDocument?.history[afterToggle.durableDocument.cursor]?.id).toBe('opacity');
    expect(afterToggle.durablePresentation).toMatchObject({ status: 'durable', cursor: 1 });
    expect(afterToggle.durableRenderProjection?.historyCursor).toBe(1);
    expect(afterToggle.renderSelector).toMatchObject({ source: 'durable', historyCursor: 2 });
    expect(afterToggle.layers['layer-1']).toMatchObject({ name: 'Layer 1', opacity: 0.5 });
  });
});
