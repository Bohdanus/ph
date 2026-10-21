import { act, render } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore, type StoreData, type StoreDispatch } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';

type ProbeValue = { store: StoreData; dispatch: StoreDispatch; reset: (index: number) => Promise<void> };

function createProbe(ref: { current: ProbeValue | null }) {
  function Probe() {
    const [store, dispatch] = useStore();
    const { resetHistoryTo } = useHistory();
    useLayoutEffect(() => {
      ref.current = { store, dispatch, reset: resetHistoryTo };
    });
    return null;
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
});
