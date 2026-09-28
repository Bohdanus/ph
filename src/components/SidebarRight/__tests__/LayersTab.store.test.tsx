import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import type { Layer, LayerId, LayersRecord } from '@/contexts/layer-types.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';
import { RENAME_LAYER_ACTION } from '@/util/constants.ts';

/**
 * These tests drive LayersTab against a real store subscription instead of a static
 * snapshot, so every assertion is about the layer state that ends up rendered, not
 * about which handler a mock happened to record.
 */
const { liveStore, subscribe, getSnapshot, noopDispatch } = vi.hoisted(() => {
  type Snapshot = { layers: Record<string, unknown>; activeLayerId: string | null };
  const store = { snapshot: { layers: {}, activeLayerId: null } as Snapshot, listeners: new Set<() => void>() };
  return {
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

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));
vi.mock('../../Icons/TrashIcon.tsx', () => ({ TrashIcon: () => <span data-testid="trash-icon" /> }));
vi.mock('../../Icons/DragHandleIcon.tsx', () => ({ DragHandleIcon: () => <span data-testid="drag-handle" /> }));

vi.mock('@/contexts/StoreContext.tsx', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useStore: () => [useSyncExternalStore(subscribe, getSnapshot), noopDispatch],
  };
});

const layerActions = {
  toggleVisibility: vi.fn(),
  removeLayer: vi.fn(),
  moveLayerAfter: vi.fn(),
  setActiveLayer: vi.fn(),
  updateLayer: vi.fn(),
};

vi.mock('@/contexts/useLayer.ts', () => ({ useLayers: () => layerActions }));

function updateStore(mutate: (snapshot: typeof liveStore.snapshot) => typeof liveStore.snapshot) {
  liveStore.snapshot = mutate(liveStore.snapshot);
  for (const listener of liveStore.listeners) listener();
}

function reorderRecord(layers: LayersRecord, layerToMoveId: LayerId, afterWhichLayerId?: LayerId): LayersRecord {
  const next: LayersRecord = { ...layers, [layerToMoveId]: { ...layers[layerToMoveId] } };
  if (!afterWhichLayerId) {
    const minOrder = Math.min(...Object.values(next).map((layer) => layer.order));
    next[layerToMoveId].order = minOrder - 1;
    return next;
  }
  const targetOrder = next[afterWhichLayerId].order;
  for (const id of Object.keys(next)) {
    if (id !== layerToMoveId && next[id].order > targetOrder) {
      next[id] = { ...next[id], order: next[id].order + 2 };
    }
  }
  next[layerToMoveId] = { ...next[layerToMoveId], order: targetOrder + 1 };
  return next;
}

function getRowByName(name: string) {
  const item = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no row for ${name}`);
  return item.querySelector('div[title="Drag to reorder"]') as HTMLElement;
}

function getNameSpan(row: HTMLElement) {
  return row.querySelector('span.truncate') as HTMLElement;
}

function getBottomDropZone(container: HTMLElement) {
  return container.querySelector('[class~="min-h-[20px]"]') as HTMLElement;
}

function createDataTransfer() {
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [] as string[],
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

const initialLayers: LayersRecord = {
  'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
  'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
  'layer-3': createMockLayer({ id: 'layer-3', name: 'Top Layer', order: 2 }),
};

function seed(layers: LayersRecord = initialLayers, activeLayerId: LayerId | null = 'layer-2') {
  liveStore.snapshot = { layers, activeLayerId };
}

describe('LayersTab against a live layer store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
    layerActions.toggleVisibility.mockImplementation((id: LayerId) =>
      updateStore((prev) => ({
        ...prev,
        layers: {
          ...(prev.layers as LayersRecord),
          [id]: { ...(prev.layers as LayersRecord)[id], visible: !(prev.layers as LayersRecord)[id].visible },
        },
      }))
    );
    layerActions.removeLayer.mockImplementation((id: LayerId) =>
      updateStore((prev) => {
        const layers = { ...(prev.layers as LayersRecord) };
        delete layers[id];
        return { ...prev, layers };
      })
    );
    layerActions.moveLayerAfter.mockImplementation((id: LayerId, after?: LayerId) =>
      updateStore((prev) => ({ ...prev, layers: reorderRecord(prev.layers as LayersRecord, id, after) }))
    );
    layerActions.setActiveLayer.mockImplementation((id: LayerId) =>
      updateStore((prev) => ({ ...prev, activeLayerId: id }))
    );
    layerActions.updateLayer.mockImplementation((id: LayerId, patch: Partial<Layer>) =>
      updateStore((prev) => ({
        ...prev,
        layers: { ...(prev.layers as LayersRecord), [id]: { ...(prev.layers as LayersRecord)[id], ...patch } },
      }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the renamed layer name from the store after a commit', () => {
    render(<LayersTab />);
    const span = getNameSpan(getRowByName('Top Layer'));

    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = 'Sky';
      fireEvent.blur(span);
    });

    expect(layerActions.updateLayer).toHaveBeenCalledWith('layer-3', { name: 'Sky' }, RENAME_LAYER_ACTION);
    expect(screen.queryByText('Top Layer')).toBeNull();
    expect(screen.getByText('Sky')).toBeInTheDocument();
  });

  it('removes the row and shows the empty state once every layer is deleted', () => {
    render(<LayersTab />);

    for (const name of ['Top Layer', 'Layer 2', 'Background']) {
      const row = getRowByName(name);
      act(() => {
        fireEvent.click(row.querySelector('button[aria-label="Remove layer"]')!);
      });
      expect(screen.queryByText(name)).toBeNull();
    }

    expect(screen.getByText('No layers yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('flips the visibility control to the hidden state after the store updates', () => {
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRowByName('Top Layer').querySelector('button[aria-label="Hide layer"]')!);
    });

    expect(layerActions.toggleVisibility).toHaveBeenCalledWith('layer-3');
    const updated = getRowByName('Top Layer');
    expect(updated.querySelector('button[aria-label="Show layer"]')).toBeInTheDocument();
    expect(updated.querySelector('[data-testid="eye-icon"]')).toHaveAttribute('data-open', 'false');
  });

  it('moves the active highlight to the clicked layer', () => {
    render(<LayersTab />);
    expect(getRowByName('Layer 2')).toHaveClass('bg-white');

    act(() => {
      fireEvent.click(getRowByName('Top Layer'));
    });

    expect(layerActions.setActiveLayer).toHaveBeenCalledWith('layer-3');
    expect(getRowByName('Top Layer')).toHaveClass('bg-white');
    expect(getRowByName('Layer 2')).toHaveClass('bg-transparent');
  });

  it('persists the new stacking order in the store and in the DOM', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getRowByName('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getRowByName('Background'), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getRowByName('Background'), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(layerActions.moveLayerAfter).toHaveBeenCalledWith('layer-3', 'layer-1');
    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual([
      'Layer 2',
      'Top Layer',
      'Background',
    ]);
  });

  it('sends a layer dropped on the bottom zone to the last row of the panel', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    const bottomZone = getBottomDropZone(container);

    act(() => {
      fireEvent.dragStart(getRowByName('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(bottomZone, { dataTransfer });
    });
    act(() => {
      fireEvent.drop(bottomZone, { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(layerActions.moveLayerAfter).toHaveBeenCalledWith('layer-3', undefined);
    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual([
      'Layer 2',
      'Background',
      'Top Layer',
    ]);
  });

  it('renders the single-layer state and reorders it without disturbing the list', () => {
    vi.useFakeTimers();
    seed({ 'layer-1': createMockLayer({ id: 'layer-1', name: 'Only Layer', order: 0 }) }, 'layer-1');
    const { container } = render(<LayersTab />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(getRowByName('Only Layer')).toHaveClass('bg-white');

    const dataTransfer = createDataTransfer();
    act(() => {
      fireEvent.dragStart(getRowByName('Only Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getBottomDropZone(container), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getBottomDropZone(container), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(layerActions.moveLayerAfter).toHaveBeenCalledWith('layer-1', undefined);
    expect(container.querySelectorAll('span.truncate')).toHaveLength(1);
    // the name also appears in the offscreen drag ghost, so scope the assertion to the list
    expect(within(screen.getByRole('list')).getByText('Only Layer')).toBeInTheDocument();
  });

  it('reacts to an externally driven visibility change', () => {
    render(<LayersTab />);
    expect(getRowByName('Background').querySelector('button[aria-label="Hide layer"]')).toBeInTheDocument();

    act(() => {
      updateStore((prev) => ({
        ...prev,
        layers: {
          ...(prev.layers as LayersRecord),
          'layer-1': { ...(prev.layers as LayersRecord)['layer-1'], visible: false },
        },
      }));
    });

    expect(getRowByName('Background').querySelector('button[aria-label="Show layer"]')).toBeInTheDocument();
    expect(layerActions.toggleVisibility).not.toHaveBeenCalled();
  });

  it('renders a layer that the store adds after the first render', () => {
    const { container } = render(<LayersTab />);
    expect(container.querySelectorAll('span.truncate')).toHaveLength(3);

    act(() => {
      updateStore((prev) => ({
        ...prev,
        layers: {
          ...(prev.layers as LayersRecord),
          'layer-4': createMockLayer({ id: 'layer-4', name: 'Newest', order: 3 }),
        },
      }));
    });

    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual([
      'Newest',
      'Top Layer',
      'Layer 2',
      'Background',
    ]);
    expect(getRowByName('Newest')).toHaveClass('bg-transparent');
  });

  it('keeps the store untouched when a rename is reverted with Escape', () => {
    render(<LayersTab />);
    const span = getNameSpan(getRowByName('Top Layer'));

    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = 'Discarded';
    });
    act(() => {
      fireEvent.keyDown(span, { key: 'Escape' });
    });

    expect(layerActions.updateLayer).not.toHaveBeenCalled();
    expect(screen.getByText('Top Layer')).toBeInTheDocument();
    expect(screen.queryByText('Discarded')).toBeNull();
  });

  it.each([
    ['a whitespace-only name', '   '],
    ['an empty name', ''],
  ])('keeps the stored name for %s', (_label, nextName) => {
    const { container } = render(<LayersTab />);
    const row = getRowByName('Top Layer');
    const span = getNameSpan(row);

    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = nextName;
      fireEvent.blur(span);
    });

    expect(layerActions.updateLayer).not.toHaveBeenCalled();
    // the store still holds the old name, so a later store-driven render restores it
    // (the blank label surviving until then is documented in LayersTab.test.tsx)
    expect(row).toBeInTheDocument();
    expect(container.querySelectorAll('span.truncate')).toHaveLength(3);
  });

  it('leaves the stacking order untouched when a drop is refused', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    const orderBefore = Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent);

    // 'Layer 2' sits directly below the dragged 'Top Layer', which the component refuses as a target
    act(() => {
      fireEvent.dragStart(getRowByName('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getRowByName('Layer 2'), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getRowByName('Layer 2'), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(layerActions.moveLayerAfter).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual(
      orderBefore
    );
  });

  it('leaves the stacking order untouched when the drag is abandoned', () => {
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    const orderBefore = Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent);

    act(() => {
      fireEvent.dragStart(getRowByName('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragEnd(getRowByName('Top Layer'), { dataTransfer });
    });

    expect(layerActions.moveLayerAfter).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual(
      orderBefore
    );
  });
});
