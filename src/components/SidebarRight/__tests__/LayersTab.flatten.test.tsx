import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import type { Layer, LayerId, LayersRecord } from '@/contexts/layer-types.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));

vi.mock('../../Icons/TrashIcon.tsx', () => ({
  TrashIcon: () => <span data-testid="trash-icon" />,
}));

vi.mock('../../Icons/DragHandleIcon.tsx', () => ({
  DragHandleIcon: () => <span data-testid="drag-handle" draggable="true" />,
}));

type StoreSnapshot = { layers: LayersRecord; activeLayerId: LayerId | null };

/**
 * The panel's `Flatten Image` control, on its own.
 *
 * The route out of the backing image is the whole of the reachability fix, and it has two halves
 * that are easy to get wrong independently. The ENABLE PREDICATE has to admit a document that is
 * one `isBedrock` layer — a count-only rule disables the button on exactly the document a user
 * opens, which is the state the control exists to leave. The HANDLER has to survive a rejection
 * and a double click, because `mergeAllLayers` commits the dirty tool and dispatches its own
 * `COMMIT_DOCUMENT_EDIT` per call; the same guard is already load-bearing in
 * `ToolbarsRight/Colors/Color.tsx` and `ToolbarsRight/Move/Reposition.tsx`.
 */
const { useLayers, mergeAllLayers, liveStore, subscribe, getSnapshot, noopDispatch } = vi.hoisted(() => {
  const store = {
    snapshot: { layers: {}, activeLayerId: null } as unknown as StoreSnapshot,
    listeners: new Set<() => void>(),
  };
  const merge = vi.fn();
  return {
    useLayers: vi.fn(() => ({
      toggleVisibility: vi.fn(),
      removeLayer: vi.fn(),
      moveLayerAfter: vi.fn(),
      setActiveLayer: vi.fn(),
      updateLayer: vi.fn(),
      mergeAllLayers: merge,
    })),
    mergeAllLayers: merge,
    liveStore: store,
    subscribe: (listener: () => void) => {
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    getSnapshot: () => store.snapshot,
    noopDispatch: vi.fn(),
  };
});

vi.mock('@/contexts/StoreContext.tsx', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useStore: () => [useSyncExternalStore(subscribe, getSnapshot), noopDispatch],
  };
});

vi.mock('@/contexts/useLayer.ts', () => ({
  useLayers,
}));

function seed(layers: LayersRecord, activeLayerId: LayerId | null = null) {
  liveStore.snapshot = { layers, activeLayerId };
}

function flattenButton(): HTMLButtonElement {
  return screen.getByTestId('layers-flatten-button') as HTMLButtonElement;
}

/** A document as a user opens it: one backing image and nothing else. */
function backingImageOnly(): LayersRecord {
  return {
    bedrock: createMockLayer({ id: 'bedrock', name: 'Background', isBedrock: true, order: 0 }),
  } as LayersRecord;
}

describe('LayersTab Flatten Image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mergeAllLayers.mockResolvedValue(null);
  });

  it('is enabled on a document that is only its backing image, with that layer active', () => {
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);
    expect(flattenButton()).toBeEnabled();
  });

  it('is enabled on a single backing image that is NOT the active layer', () => {
    // `canFlatten` reads the layer COUNT and the ACTIVE layer's flag. A document whose active
    // layer is something else still needs the route, so the active-layer half must not narrow it.
    const layers = {
      bedrock: createMockLayer({ id: 'bedrock', name: 'Background', isBedrock: true, order: 0 }),
      other: createMockLayer({ id: 'other', name: 'Layer 2', order: 1 }),
    } as LayersRecord;
    seed(layers, 'other');
    render(<LayersTab />);
    expect(flattenButton()).toBeEnabled();
  });

  it('is enabled on two ordinary layers, which is the destructiveness this control has', () => {
    seed({
      a: createMockLayer({ id: 'a', name: 'Layer 1', order: 0 }),
      b: createMockLayer({ id: 'b', name: 'Layer 2', order: 1 }),
    });
    render(<LayersTab />);
    expect(flattenButton()).toBeEnabled();
  });

  it('is disabled on a single NON-bedrock layer', () => {
    // The one state where flattening has nothing to merge and nothing to unlock. A count-only
    // rule would leave this enabled; the predicate admits it only via the bedrock half.
    seed({ only: createMockLayer({ id: 'only', name: 'Layer 1', isBedrock: false, order: 0 }) }, 'only');
    render(<LayersTab />);
    expect(flattenButton()).toBeDisabled();
  });

  it('is rendered only when the document has layers', () => {
    seed({});
    render(<LayersTab />);
    expect(screen.queryByTestId('layers-flatten-button')).not.toBeInTheDocument();
  });

  it('calls mergeAllLayers once per press', async () => {
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);
    fireEvent.click(flattenButton());
    await waitFor(() => expect(mergeAllLayers).toHaveBeenCalledTimes(1));
  });

  it('does not run a second merge while the first is in flight', async () => {
    let release: (() => void) | undefined;
    mergeAllLayers.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        })
    );
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);

    fireEvent.click(flattenButton());
    fireEvent.click(flattenButton());
    expect(mergeAllLayers).toHaveBeenCalledTimes(1);

    release?.();
    await waitFor(() => expect(flattenButton()).toBeEnabled());
    fireEvent.click(flattenButton());
    await waitFor(() => expect(mergeAllLayers).toHaveBeenCalledTimes(2));
  });

  it('logs a rejected merge instead of leaving the rejection unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mergeAllLayers.mockRejectedValue(new Error('no canvas'));
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);

    fireEvent.click(flattenButton());
    await waitFor(() => expect(error).toHaveBeenCalledWith('Failed to flatten the image', expect.any(Error)));
    error.mockRestore();
  });

  it('carries the accessible name the operation is known by', () => {
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);
    // `mergeAllLayers` composites the canvas while the renderer skips every invisible layer, so
    // it replaces the stack rather than merging it: Adobe's Flatten Image, not Merge Visible.
    // The durable operation is still named `merge-document`; the control is not.
    expect(screen.getByRole('button', { name: 'Flatten Image' })).toBe(flattenButton());
  });

  it('renders no <li> of its own, so the panel and the History panel stay one list each', () => {
    seed(backingImageOnly(), 'bedrock');
    render(<LayersTab />);
    const control = flattenButton();
    expect(control.closest('li')).toBeNull();
    expect(control.closest('ul')).toBeNull();
  });

  it('leaves the layer rows untouched', () => {
    const layers = backingImageOnly();
    seed(layers);
    render(<LayersTab />);
    // The control is additive: no row gains or loses a control of its own.
    expect(screen.getAllByTestId('layer-row')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove layer' })).toBeInTheDocument();
  });

  it('re-reads the active layer, so a flatten of a non-bedrock single layer disables it', () => {
    const layer: Layer = createMockLayer({ id: 'only', name: 'Layer 1', isBedrock: false, order: 0 });
    seed({ only: layer }, 'only');
    const { rerender } = render(<LayersTab />);
    expect(flattenButton()).toBeDisabled();

    liveStore.snapshot = { layers: { only: { ...layer, isBedrock: true } }, activeLayerId: 'only' };
    for (const listener of liveStore.listeners) listener();
    rerender(<LayersTab />);
    expect(flattenButton()).toBeEnabled();
  });
});
