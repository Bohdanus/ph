import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import type { Selection } from '../general-types.ts';

const rectangularSelection: Selection = {
  id: 'selection-1',
  geometry: 'rectangle',
  sourceTool: 'rectangular-selection',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 10, y: 20, width: 30, height: 40 },
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 40 },
    { x: 0, y: 40 },
  ],
};

const StoreProbe = () => {
  const [{ selections, activeSelectionId, toolName }, dispatch] = useStore();

  return (
    <div>
      <div data-testid="selection-state">{`${selections.length}:${activeSelectionId ?? 'none'}`}</div>
      <div data-testid="tool-name">{toolName}</div>
      <button onClick={() => dispatch({ type: 'COMMIT_SELECTION', payload: rectangularSelection })}>Commit</button>
      <button onClick={() => dispatch({ type: 'SET_TOOL_NAME', payload: 'draw' })}>Switch tool</button>
      <button onClick={() => dispatch({ type: 'CLEAR_SELECTIONS' })}>Clear</button>
    </div>
  );
};

const HistoryProbe = () => {
  const [{ fileName, history, historyIndex, branchRevision, documentId, documentRevision }, dispatch] = useStore();

  return (
    <div>
      <div data-testid="history-state">
        {`${fileName}:${history.length}:${historyIndex}:${branchRevision}:${documentId}:${documentRevision}`}
      </div>
      <button
        onClick={() =>
          dispatch({
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: {
              updates: { fileName: 'edited.psd' },
              historyItem: { id: 'edit-1', actionName: 'rename', layerId: 'layer-1', args: { name: 'Edited' } },
            },
          })
        }
      >
        Commit edit
      </button>
      <button
        onClick={() =>
          dispatch({
            type: 'REPLACE_DOCUMENT',
            payload: {
              documentId: 'document-2',
              history: [{ id: 'baseline', actionName: 'rename', layerId: 'layer-2', args: { name: 'Base' } }],
              updates: { fileName: 'replacement.psd' },
            },
          })
        }
      >
        Replace document
      </button>
    </div>
  );
};

function renderStoreProbe() {
  render(
    <StoreProvider>
      <StoreProbe />
    </StoreProvider>
  );
}

const DurableProbe = () => {
  const [{ durableStatus, durableDiagnostics }, dispatch] = useStore();

  return (
    <div>
      <div data-testid="durable-status">{durableStatus}</div>
      <div data-testid="durable-diagnostics">{JSON.stringify(durableDiagnostics)}</div>
      <button
        onClick={() =>
          dispatch({
            type: 'COMMIT_DOCUMENT_EDIT',
            payload: {
              historyItem: { id: 'pen-edit', actionName: 'tool', layerId: 'layer-1', args: { toolName: 'pen' } },
            },
          })
        }
      >
        Commit unsupported edit
      </button>
    </div>
  );
};

describe('StoreContext selection lifecycle', () => {
  it('clears committed selections and the active selection id only through the clear action', () => {
    renderStoreProbe();

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(screen.getByTestId('selection-state').textContent).toBe('1:selection-1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByTestId('selection-state').textContent).toBe('0:none');
  });

  it('keeps committed selections when switching tools', () => {
    renderStoreProbe();

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch tool' }));

    expect(screen.getByTestId('tool-name').textContent).toBe('draw');
    expect(screen.getByTestId('selection-state').textContent).toBe('1:selection-1');
  });
});

describe('StoreContext history lifecycle', () => {
  it('commits document changes and history in one revisioned reducer action', () => {
    render(
      <StoreProvider>
        <HistoryProbe />
      </StoreProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Commit edit' }));

    expect(screen.getByTestId('history-state').textContent).toBe('edited.psd:1:0:1:uninitialized:0');
  });

  it('replaces document identity and resets its branch revision atomically', () => {
    render(
      <StoreProvider>
        <HistoryProbe />
      </StoreProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Commit edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace document' }));

    expect(screen.getByTestId('history-state').textContent).toBe('replacement.psd:1:0:0:document-2:1');
  });
});

describe('StoreContext durable diagnostic contract', () => {
  it('exposes structured migration diagnostics instead of preformatted strings', () => {
    render(
      <StoreProvider>
        <DurableProbe />
      </StoreProvider>
    );

    expect(screen.getByTestId('durable-status').textContent).toBe('unavailable');
    expect(screen.getByTestId('durable-diagnostics').textContent).toBe('[]');

    fireEvent.click(screen.getByRole('button', { name: 'Commit unsupported edit' }));

    expect(screen.getByTestId('durable-status').textContent).toBe('unavailable');
    const diagnostics: unknown = JSON.parse(screen.getByTestId('durable-diagnostics').textContent ?? '[]');
    expect(Array.isArray(diagnostics)).toBe(true);
    expect(diagnostics).toHaveLength(1);
    // A diagnostic is a machine-readable object, never a formatted string.
    expect(typeof (diagnostics as unknown[])[0]).toBe('object');
    expect(diagnostics).toEqual([
      {
        historyId: 'pen-edit',
        actionName: 'tool',
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Layer layer-1 is unavailable',
      },
    ]);
  });

  it('no longer publishes the durable replay presentation surface through the context', () => {
    const captured: Record<string, unknown>[] = [];
    const SurfaceProbe = () => {
      const [store] = useStore();
      captured.push(store as unknown as Record<string, unknown>);
      return null;
    };

    render(
      <StoreProvider>
        <SurfaceProbe />
      </StoreProvider>
    );

    const store = captured[captured.length - 1]!;
    expect('replayCoordinator' in store).toBe(false);
    expect('presentationMaterialization' in store).toBe(false);
    expect('getReplayRevisionToken' in store).toBe(false);
    expect(Object.keys(store)).toEqual(expect.not.arrayContaining(['replayCoordinator']));
  });
});

describe('StoreContext initial state contract', () => {
  const InitialProbe = () => {
    const [store] = useStore();
    return (
      <div>
        <div data-testid="initial-file-state">{`${store.hasImage}:${store.fileName}:${store.hasUnsavedChanges}`}</div>
        <div data-testid="initial-size">{`${store.totalSize.width}x${store.totalSize.height}`}</div>
        <div data-testid="initial-frame">{`${store.documentFrame.x},${store.documentFrame.y},${store.documentFrame.width},${store.documentFrame.height}`}</div>
        <div data-testid="initial-history">
          {`${store.history.length}:${store.historyIndex}:${store.branchRevision}:${store.documentRevision}:${store.documentId}`}
        </div>
        <div data-testid="initial-durable">{`${store.durableStatus}:${store.durableDocument === null}`}</div>
        <div data-testid="initial-colors">{`${store.color}:${store.backgroundColor}`}</div>
        <div data-testid="initial-refs">
          {[
            store.canvasRef,
            store.toolOverlayRef,
            store.rectOverlayRef,
            store.containerRef,
            store.textareaRef,
            store.canvasCtxRef,
          ]
            .map((ref) => `${ref.current === null ? 'detached' : 'attached'}`)
            .join(',')}
        </div>
      </div>
    );
  };

  it('starts from an empty, uninitialized, image-free document with null DOM refs', () => {
    render(
      <StoreProvider>
        <InitialProbe />
      </StoreProvider>
    );

    expect(screen.getByTestId('initial-file-state').textContent).toBe('false::false');
    expect(screen.getByTestId('initial-size').textContent).toBe('0x0');
    expect(screen.getByTestId('initial-frame').textContent).toBe('0,0,0,0');
    expect(screen.getByTestId('initial-history').textContent).toBe('0:0:0:0:uninitialized');
    // A never-converted document must never claim a durable shadow.
    expect(screen.getByTestId('initial-durable').textContent).toBe('unavailable:true');
    expect(screen.getByTestId('initial-colors').textContent).toBe('#000000:#ffffff');
    // Every live DOM ref starts detached; production code null-checks them.
    expect(screen.getByTestId('initial-refs').textContent).toBe(
      'detached,detached,detached,detached,detached,detached'
    );
  });

  it('ships a no-op clearPreviewLayers before any preview exists', () => {
    const captured: { store: ReturnType<typeof useStore>[0] | null } = { store: null };
    const Capture = () => {
      const [store] = useStore();
      useEffect(() => {
        captured.store = store;
      }, [store]);
      return null;
    };

    render(
      <StoreProvider>
        <Capture />
      </StoreProvider>
    );

    const store = captured.store!;
    expect(store.previewLayers.current).toEqual({});
    expect(() => store.clearPreviewLayers()).not.toThrow();
    expect(store.previewLayers.current).toEqual({});
  });
});
