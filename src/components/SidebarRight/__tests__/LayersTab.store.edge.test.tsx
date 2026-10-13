import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import type { LayerId, LayersRecord } from '@/contexts/layer-types.ts';
import { createMockLayer, createBedrockLayer, createToolLayer } from '@/__tests__/fixtures/layer.ts';

/**
 * Edge-case tests for LayersTab against a live layer store: ordering under
 * arbitrary `order` values, equal-order collisions, the bedrock glyph, and
 * removal across mixed layer kinds.
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

const currentToolState = vi.hoisted(() => ({ toolArgs: { toolName: 'move' }, setToolArgs: vi.fn() }));

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));
vi.mock('../../Icons/TrashIcon.tsx', () => ({ TrashIcon: () => <span data-testid="trash-icon" /> }));
vi.mock('../../Icons/DragHandleIcon.tsx', () => ({ DragHandleIcon: () => <span data-testid="drag-handle" /> }));
vi.mock('../../Icons/BedrockIcon.tsx', () => ({ BedrockIcon: () => <span data-testid="bedrock-icon" /> }));

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

vi.mock('@/contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => currentToolState,
}));

function updateStore(mutate: (snapshot: typeof liveStore.snapshot) => typeof liveStore.snapshot) {
  liveStore.snapshot = mutate(liveStore.snapshot);
  for (const listener of liveStore.listeners) listener();
}

function getRowByName(name: string) {
  const item = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no row for ${name}`);
  return item;
}

function seed(layers: LayersRecord, activeLayerId: LayerId | null = null) {
  liveStore.snapshot = { layers, activeLayerId };
}

describe('LayersTab store edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layerActions.removeLayer.mockImplementation((id: LayerId) =>
      updateStore((prev) => {
        const layers = { ...(prev.layers as LayersRecord) };
        delete layers[id];
        return { ...prev, layers };
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders layers in descending `order` sequence', () => {
    seed({
      'layer-a': createMockLayer({ id: 'layer-a', name: 'A', order: 5 }),
      'layer-b': createMockLayer({ id: 'layer-b', name: 'B', order: 1 }),
      'layer-c': createMockLayer({ id: 'layer-c', name: 'C', order: 3 }),
    });
    const { container } = render(<LayersTab />);
    expect(Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent)).toEqual([
      'A',
      'C',
      'B',
    ]);
  });

  it('renders layers that share the same `order` value', () => {
    seed({
      'layer-a': createMockLayer({ id: 'layer-a', name: 'A', order: 2 }),
      'layer-b': createMockLayer({ id: 'layer-b', name: 'B', order: 2 }),
    });
    const { container } = render(<LayersTab />);
    expect(container.querySelectorAll('span.truncate')).toHaveLength(2);
    expect(getRowByName('A')).toBeInTheDocument();
    expect(getRowByName('B')).toBeInTheDocument();
  });

  it('renders the bedrock background icon for a bedrock layer', () => {
    seed({
      'layer-1': createBedrockLayer({ id: 'layer-1', name: 'Background', order: 0 }),
      'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
    });
    render(<LayersTab />);
    expect(getRowByName('Background').querySelector('[data-testid="bedrock-icon"]')).toBeInTheDocument();
    expect(getRowByName('Layer 2').querySelector('[data-testid="bedrock-icon"]')).toBeNull();
  });

  it('removes the correct layer when the stack holds mixed layer kinds', () => {
    seed({
      'layer-bedrock': createBedrockLayer({ id: 'layer-bedrock', name: 'Background', order: 0 }),
      'layer-tool': createToolLayer('draw', { id: 'layer-tool', name: 'Draw', order: 1 }),
      'layer-blank': createMockLayer({ id: 'layer-blank', name: 'Blank', order: 2 }),
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRowByName('Draw').querySelector('button[aria-label="Remove layer"]')!);
    });

    expect(layerActions.removeLayer).toHaveBeenCalledWith('layer-tool');
    expect(screen.queryByText('Draw')).toBeNull();
    expect(getRowByName('Background')).toBeInTheDocument();
    expect(getRowByName('Blank')).toBeInTheDocument();
  });
});
