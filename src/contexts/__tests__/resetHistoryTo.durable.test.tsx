import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as layerRenderer from '../layer-renderer.ts';
import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import { OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';

type ProbeValue = { store: StoreData; dispatch: StoreDispatch; reset: (index: number) => Promise<void> };

function createProbe(ref: { current: ProbeValue | null }, attachCanvas = false) {
  function Probe() {
    const [store, dispatch] = useStore();
    const { resetHistoryTo } = useHistory();
    useLayoutEffect(() => {
      ref.current = { store, dispatch, reset: resetHistoryTo };
    });
    return attachCanvas ? <canvas aria-label="visible workspace" ref={store.canvasRef} /> : null;
  }
  return Probe;
}

function layer(): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
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
    const unsupported: HistoryItem = {
      id: 'unsupported',
      actionName: TOOL_ACTION,
      layerId: 'layer-1',
      args: { toolName: 'pen' },
    };
    const history = [baseline, unsupported];
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
            documentFrame: { x: 0, y: 0, width: 100, height: 80 },
          },
        },
      });
    });

    await act(async () => {
      await ref.current!.reset(1);
    });

    expect(ref.current!.store.historyIndex).toBe(1);
    expect(ref.current!.store.durableStatus).toBe('partial');
    expect(ref.current!.store.durablePresentation.status).toBe('unpublished');
  });

  it('restores the real StoreProvider timeline when a durable final draw is refused', async () => {
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
    const history = [baseline, rename];
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
          historyIndex: 1,
          updates: {
            layers: { 'layer-1': { ...initialLayer, name: 'Renamed' } },
            totalSize: { width: 100, height: 80 },
            documentFrame: { x: 0, y: 0, width: 100, height: 80 },
          },
        },
      });
    });

    const before = ref.current!.store;
    expect(before.durableStatus).toBe('current');
    expect(before.historyIndex).toBe(1);
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
      const drawnLayers = drawLayers.mock.calls[0]?.[1];
      expect(drawnLayers).toHaveLength(1);
      expect(drawnLayers?.[0]).toMatchObject({ id: 'layer-1', operations: [] });
      expect(drawnLayers?.[0]).not.toHaveProperty('source');
      expect(visibleContext).toHaveBeenCalledWith('2d');

      const after = ref.current!.store;
      expect(after.history).toEqual(before.history);
      expect(after.historyIndex).toBe(before.historyIndex);
      expect(after.layers).toEqual(before.layers);
      expect(after.layers['layer-1']).toMatchObject({ name: 'Renamed' });
      expect(after.durableStatus).toBe('unavailable');
      expect(after.durableDocument).toBeNull();
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
});
