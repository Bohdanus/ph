import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const size = { width: 400, height: 300 };
const frame = { x: 0, y: 0, width: 400, height: 300 };

function blankLayer(): Layer {
  const pos = { x: 20, y: 30, width: 120, height: 80 };
  const source: Extract<LayerSource, { kind: 'blank' }> = {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    isBedrock: false,
    pos,
  };
  return {
    id: layerId,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    source,
    operations: [],
  };
}

function baseline(): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers: { [layerId]: blankLayer() }, size, frame },
  };
}

function rename(id: string, name: string): HistoryItem {
  return { id, actionName: RENAME_LAYER_ACTION, layerId, args: { name } };
}

function createProbe() {
  type ProbeState = {
    store: StoreData;
    dispatch: StoreDispatch;
    history: ReturnType<typeof useHistory>;
  };
  const ref: { current: ProbeState | null } = { current: null };

  function Probe() {
    const [store, dispatch] = useStore();
    const history = useHistory();
    useEffect(() => {
      ref.current = { store, dispatch, history };
    }, [dispatch, history, store]);
    return null;
  }

  return {
    Probe,
    get: () => {
      if (!ref.current) throw new Error('Store probe has not rendered');
      return ref.current;
    },
  };
}

function renderProbe() {
  const probe = createProbe();
  const rendered = render(
    <StoreProvider>
      <probe.Probe />
    </StoreProvider>
  );
  return { ...probe, ...rendered };
}

describe('StoreContext cursor identity after navigation', () => {
  it('rebuilds durable cursor identity after rewind and a fresh commit', async () => {
    const probe = renderProbe();
    const timeline = [baseline(), rename('rename-a', 'A'), rename('rename-b', 'B')];
    const initialLayer = blankLayer();

    act(() => {
      probe.get().dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: 'cursor-document',
          history: timeline,
          historyIndex: 2,
          updates: {
            layers: { [layerId]: initialLayer },
            activeLayerId: layerId,
            totalSize: size,
            documentFrame: frame,
          },
        },
      });
    });

    await act(async () => {
      await probe.get().history.undo();
    });
    expect(probe.get().store.historyIndex).toBe(1);

    const currentLayer = probe.get().store.layers[layerId];
    expect(currentLayer).toBeDefined();
    act(() => {
      probe.get().dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {
            layers: { ...probe.get().store.layers, [layerId]: { ...currentLayer!, name: 'Fresh' } },
            activeLayerId: layerId,
          },
          historyItem: rename('fresh', 'Fresh'),
        },
      });
    });

    const after = probe.get().store;
    expect(after.history.map((entry) => entry.id)).toEqual(['baseline', 'rename-a', 'fresh']);
    expect(after.history[after.historyIndex]?.id).toBe('fresh');
    expect(after.durableDocument?.history[after.durableDocument.cursor]?.id).toBe('fresh');
    expect(after.durableDocument?.cursor).toBe(1);
  });

  it('maps a skipped legacy entry to the previous durable cursor by identity', () => {
    const noOpTool: HistoryItem = {
      id: 'no-op',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'reposition' },
    };
    const history = [baseline(), rename('rename-a', 'A'), noOpTool, rename('rename-b', 'B')];
    const converted = legacyHistoryToDurable(history, { documentId: 'cursor-map' });

    expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0, 0, 1]);
    const durableIds = converted.document.history.map((entry) => entry.id);
    expect(converted.legacyCursorToDurableCursor.map((cursor) => (cursor < 0 ? null : durableIds[cursor]))).toEqual([
      null,
      'rename-a',
      'rename-a',
      'rename-b',
    ]);
  });
});
