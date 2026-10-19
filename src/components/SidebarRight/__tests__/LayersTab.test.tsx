import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import type { Layer, LayerId, LayersRecord, ToolLayerSource } from '@/contexts/layer-types.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';
import { RENAME_LAYER_ACTION, SET_LAYER_OPACITY_ACTION } from '@/util/constants.ts';
import type { TextToolArgs } from '@/tools/text.ts';

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));

vi.mock('../../Icons/TrashIcon.tsx', () => ({
  TrashIcon: () => <span data-testid="trash-icon" />,
}));

vi.mock('../../Icons/DragHandleIcon.tsx', () => ({
  DragHandleIcon: ({ disabled }: { disabled?: boolean }) => (
    <span data-testid="drag-handle" data-disabled={disabled ?? false} />
  ),
}));

const mockLayers: LayersRecord = {
  'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
  'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
  'layer-3': createMockLayer({ id: 'layer-3', name: 'Top Layer', order: 2 }),
};

type StoreSnapshot = {
  layers: LayersRecord;
  activeLayerId: LayerId | null;
  documentFrame?: { x: number; y: number; width: number; height: number };
  totalSize?: { width: number; height: number };
};

/**
 * The action mocks are wired back into a real store snapshot, so a payload assertion
 * cannot pass unless the component actually reached the store through its own handler.
 */
const { useLayers, layerMocks, liveStore, subscribe, getSnapshot, noopDispatch } = vi.hoisted(() => {
  const store = {
    snapshot: { layers: {}, activeLayerId: null } as unknown as StoreSnapshot,
    listeners: new Set<() => void>(),
  };
  const mocks = {
    toggleVisibility: vi.fn(),
    removeLayer: vi.fn(),
    moveLayerAfter: vi.fn(),
    setActiveLayer: vi.fn(),
    beginTextLayerEdit: vi.fn(),
    commitDirtyTool: vi.fn(),
    updateLayer: vi.fn(),
  };
  return {
    useLayers: vi.fn(() => mocks),
    layerMocks: mocks,
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

const currentToolState = vi.hoisted(() => ({
  toolArgs: { toolName: 'move' } as {
    toolName: string;
    rect?: { x1: number; y1: number; x2: number; y2: number } | null;
    editingLayerId?: string;
  },
  setToolArgs: vi.fn(),
}));

vi.mock('@/contexts/StoreContext.tsx', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useStore: () => [useSyncExternalStore(subscribe, getSnapshot), noopDispatch],
  };
});

vi.mock('@/contexts/useLayer.ts', () => ({
  useLayers,
}));

vi.mock('@/contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => currentToolState,
}));

vi.mock('@/hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: vi.fn() }),
}));

function seed(layers: LayersRecord = mockLayers, activeLayerId: LayerId | null = 'layer-2') {
  liveStore.snapshot = {
    layers,
    activeLayerId,
    documentFrame: { x: 40, y: 20, width: 200, height: 120 },
    totalSize: { width: 200, height: 120 },
  };
}

function updateStore(mutate: (snapshot: StoreSnapshot) => StoreSnapshot) {
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

function wireActionsToStore() {
  layerMocks.toggleVisibility.mockImplementation((id: LayerId) =>
    updateStore((prev) => ({
      ...prev,
      layers: { ...prev.layers, [id]: { ...prev.layers[id], visible: !prev.layers[id].visible } },
    }))
  );
  layerMocks.removeLayer.mockImplementation((id: LayerId) =>
    updateStore((prev) => {
      const layers = { ...prev.layers };
      delete layers[id];
      return { ...prev, layers };
    })
  );
  layerMocks.moveLayerAfter.mockImplementation((id: LayerId, after?: LayerId) =>
    updateStore((prev) => ({ ...prev, layers: reorderRecord(prev.layers, id, after) }))
  );
  layerMocks.setActiveLayer.mockImplementation((id: LayerId) =>
    updateStore((prev) => ({ ...prev, activeLayerId: id }))
  );
  layerMocks.updateLayer.mockImplementation((id: LayerId, patch: Partial<Layer>) =>
    updateStore((prev) => ({ ...prev, layers: { ...prev.layers, [id]: { ...prev.layers[id], ...patch } } }))
  );
}

function getLayerDivs(): HTMLElement[] {
  const items = screen.getAllByRole('listitem');
  return items.map((item) => item.querySelector<HTMLElement>('div[title="Drag to reorder"]')!);
}

function getListItemFor(name: string): HTMLElement {
  const item = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no list item for ${name}`);
  return item;
}

function getNameSpan(name: string): HTMLElement {
  return getLayerDivs()
    .find((div) => div.textContent?.includes(name))!
    .querySelector<HTMLElement>('span.truncate')!;
}

function getBottomDropZone(container: HTMLElement) {
  return container.querySelector('[class~="min-h-[20px]"]') as HTMLElement;
}

function getRenderedNames(container: HTMLElement) {
  return Array.from(container.querySelectorAll('span.truncate')).map((span) => span.textContent);
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

describe('LayersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    currentToolState.toolArgs = { toolName: 'move' };
    wireActionsToStore();
    seed();
  });

  afterEach(() => {
    document.body.classList.remove('cursor-grabbing');
    vi.useRealTimers();
  });

  it('renders "No layers yet" when layers is empty', () => {
    seed({}, null);
    render(<LayersTab />);
    expect(screen.getByText('No layers yet.')).toBeInTheDocument();
  });

  it('renders all layers in reverse order (top first)', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    expect(layerDivs).toHaveLength(3);
    expect(layerDivs[0]).toHaveTextContent('Top Layer');
    expect(layerDivs[1]).toHaveTextContent('Layer 2');
    expect(layerDivs[2]).toHaveTextContent('Background');
  });

  it('renders one preview thumbnail for every layer row', () => {
    render(<LayersTab />);

    expect(screen.getAllByTestId('layer-thumbnail')).toHaveLength(3);
    expect(screen.getByTestId('layers-list')).toContainElement(screen.getAllByTestId('layer-thumbnail')[0]);
  });

  it('highlights active layer', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    expect(layerDivs[1]).toHaveClass('bg-white');
  });

  it('shows eye icon open for visible layers', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeIcons = layerDivs.map((div) => div.querySelector('[data-testid="eye-icon"]'));
    expect(eyeIcons[0]).toBeInTheDocument();
    expect(eyeIcons[0]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[1]).toBeInTheDocument();
    expect(eyeIcons[1]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[2]).toBeInTheDocument();
    expect(eyeIcons[2]).toHaveAttribute('data-open', 'true');
  });

  it('shows eye icon closed for hidden layers', () => {
    const hiddenLayers = {
      ...mockLayers,
      'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', visible: false }),
    };
    seed(hiddenLayers);
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeIcon = layerDivs[1].querySelector('[data-testid="eye-icon"]');
    expect(eyeIcon).toBeInTheDocument();
    expect(eyeIcon).toHaveAttribute('data-open', 'false');
  });

  it('commits one opacity history entry when a slider gesture ends', () => {
    render(<LayersTab />);
    fireEvent.click(screen.getByText('100%', { selector: 'summary' }));
    const slider = screen.getByRole('slider', { name: 'Layer opacity' });

    fireEvent.change(slider, { target: { value: '50' } });
    fireEvent.change(slider, { target: { value: '42' } });
    expect(layerMocks.updateLayer).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);

    expect(layerMocks.updateLayer).toHaveBeenCalledTimes(1);
    expect(layerMocks.updateLayer).toHaveBeenCalledWith('layer-2', { opacity: 0.42 }, SET_LAYER_OPACITY_ACTION);
    expect(liveStore.snapshot.layers['layer-2'].opacity).toBe(0.42);
    expect(screen.getByText('42%', { selector: 'summary' })).toBeInTheDocument();
  });

  it('disables opacity changes for a locked layer', () => {
    seed({ ...mockLayers, 'layer-2': { ...mockLayers['layer-2'], locked: true } });
    render(<LayersTab />);
    fireEvent.click(screen.getByText('100%', { selector: 'summary' }));

    expect(screen.getByRole('slider', { name: 'Layer opacity' })).toBeDisabled();
    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
  });

  it('disables Lock All while a text edit is active', () => {
    currentToolState.toolArgs = {
      toolName: 'text',
      rect: { x1: 10, y1: 10, x2: 80, y2: 40 },
    };
    render(<LayersTab />);

    const lockButton = screen.getByRole('button', { name: 'Lock Layer 2' });
    expect(lockButton).toBeDisabled();
    expect(lockButton).toHaveAttribute('title', 'Finish text editing before locking layers');
    fireEvent.click(lockButton);

    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
  });

  it('disables removal of the text layer while that layer is being edited', () => {
    currentToolState.toolArgs = {
      toolName: 'text',
      rect: { x1: 10, y1: 10, x2: 80, y2: 40 },
      editingLayerId: 'layer-2',
    };
    render(<LayersTab />);

    const removeButton = getListItemFor('Layer 2').querySelector<HTMLButtonElement>(
      'button[aria-label="Remove layer"]'
    );
    if (!removeButton) throw new Error('no remove button for Layer 2');
    expect(removeButton).toBeDisabled();
    expect(removeButton).toHaveAttribute('title', 'Finish text editing before removing this layer');
    fireEvent.click(removeButton);

    expect(layerMocks.removeLayer).not.toHaveBeenCalled();
  });

  it('keeps layer selection when the active text edit cannot be committed', () => {
    currentToolState.toolArgs = {
      toolName: 'text',
      rect: { x1: 10, y1: 10, x2: 80, y2: 40 },
    };
    layerMocks.commitDirtyTool.mockReturnValueOnce(null);
    render(<LayersTab />);

    const row = getListItemFor('Top Layer').querySelector<HTMLElement>('div[title="Drag to reorder"]');
    if (!row) throw new Error('no row for Top Layer');
    fireEvent.click(row);

    expect(layerMocks.commitDirtyTool).toHaveBeenCalledOnce();
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();
  });

  it('toggles visibility on eye button click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeButton = layerDivs[0].querySelector('button');
    act(() => {
      fireEvent.click(eyeButton!);
    });
    expect(layerMocks.toggleVisibility).toHaveBeenCalledTimes(1);
    expect(layerMocks.toggleVisibility).toHaveBeenCalledWith('layer-3');

    const toggled = getLayerDivs()[0];
    expect(toggled.querySelector('[data-testid="eye-icon"]')).toHaveAttribute('data-open', 'false');
    expect(toggled.querySelector('button')).toHaveAttribute('aria-label', 'Show layer');
    expect(liveStore.snapshot.layers['layer-3'].visible).toBe(false);
  });

  it('calls setActiveLayer on layer click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    act(() => {
      fireEvent.click(layerDivs[0]);
    });
    expect(layerMocks.setActiveLayer).toHaveBeenCalledTimes(1);
    expect(layerMocks.setActiveLayer).toHaveBeenCalledWith('layer-3');

    const reordered = getLayerDivs();
    expect(reordered[0]).toHaveTextContent('Top Layer');
    expect(reordered[0]).toHaveClass('bg-white');
    expect(reordered[1]).toHaveTextContent('Layer 2');
    expect(reordered[1]).toHaveClass('bg-transparent');
  });

  it('hydrates a selected text layer into canvas space for re-entry', () => {
    currentToolState.toolArgs = { toolName: 'text' };
    const args: TextToolArgs = {
      toolName: 'text',
      align: 'left',
      bold: false,
      color: '#000000',
      fontFamily: 'Arial',
      fontSize: 16,
      italic: false,
      lineHeight: 1.2,
      text: 'hello',
      rect: { x1: 0, y1: 0, x2: 100, y2: 60 },
    };
    seed(
      {
        text: createMockLayer({
          id: 'text',
          name: 'Text layer',
          pos: { x: 120, y: 80, width: 100, height: 60 },
          source: { kind: 'tool', args } as ToolLayerSource,
        }),
      },
      null
    );
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getLayerDivs()[0]);
    });

    expect(currentToolState.setToolArgs).toHaveBeenCalledWith({
      ...args,
      editingLayerId: 'text',
      rect: { x1: 80, y1: 60, x2: 180, y2: 120 },
    });
  });

  it('removes layer on trash click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButton = layerDivs[0].querySelector('button[aria-label="Remove layer"]');
    act(() => {
      fireEvent.click(trashButton!);
    });
    expect(layerMocks.removeLayer).toHaveBeenCalledTimes(1);
    expect(layerMocks.removeLayer).toHaveBeenCalledWith('layer-3');

    expect(screen.queryByText('Top Layer')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect('layer-3' in liveStore.snapshot.layers).toBe(false);
  });

  it('stops propagation on trash click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButton = layerDivs[0].querySelector('button[aria-label="Remove layer"]');
    act(() => {
      fireEvent.click(trashButton!);
    });
    expect(layerMocks.removeLayer).toHaveBeenCalledWith('layer-3');
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();

    expect(screen.queryByText('Top Layer')).toBeNull();
    expect(getLayerDivs()[0]).toHaveTextContent('Layer 2');
    expect(getLayerDivs()[0]).toHaveClass('bg-white');
  });

  it('stops propagation on eye button click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeButton = layerDivs[0].querySelector('button');
    act(() => {
      fireEvent.click(eyeButton!);
    });
    expect(layerMocks.toggleVisibility).toHaveBeenCalledWith('layer-3');
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();

    expect(getLayerDivs()[0]).toHaveTextContent('Top Layer');
    expect(getLayerDivs()[0]).toHaveClass('bg-transparent');
    expect(getLayerDivs()[1]).toHaveTextContent('Layer 2');
    expect(getLayerDivs()[1]).toHaveClass('bg-white');
  });

  it('shows layer name in span', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const nameSpan = layerDivs[0].querySelector('span.truncate');
    expect(nameSpan).toBeInTheDocument();
    expect(nameSpan).toHaveTextContent('Top Layer');
  });

  it('applies correct container classes', () => {
    render(<LayersTab />);
    const list = screen.getByRole('list');
    const container = list.parentElement!;
    expect(container.classList.contains('flex')).toBe(true);
    expect(container.classList.contains('flex-col')).toBe(true);
    expect(container.classList.contains('gap-2')).toBe(true);
    expect(container.classList.contains('h-full')).toBe(true);
  });

  it('keeps remove control available for a bedrock layer', () => {
    seed({ bedrock: createMockLayer({ id: 'bedrock', name: 'Background', isBedrock: true }) }, null);
    render(<LayersTab />);
    const [bedrockRow] = getLayerDivs();
    expect(bedrockRow).toHaveTextContent('Background');
    expect(bedrockRow.querySelector('button[aria-label="Remove layer"]')).toBeInTheDocument();
  });

  it('shows drag handle icon', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const dragHandles = layerDivs.map((div) => div.querySelector('[data-testid="drag-handle"]'));
    expect(dragHandles[0]).toBeInTheDocument();
    expect(dragHandles[1]).toBeInTheDocument();
    expect(dragHandles[2]).toBeInTheDocument();
  });

  it('shows trash icon for each layer', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButtons = layerDivs.map((div) => div.querySelector('button[aria-label="Remove layer"]'));
    expect(trashButtons[0]).toBeInTheDocument();
    expect(trashButtons[1]).toBeInTheDocument();
    expect(trashButtons[2]).toBeInTheDocument();
  });
});

describe('LayersTab inline rename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wireActionsToStore();
    seed();
  });

  afterEach(() => {
    document.body.classList.remove('cursor-grabbing');
    vi.useRealTimers();
  });

  it('starts out with the name span read-only and the row draggable', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');

    expect(span).toHaveAttribute('contenteditable', 'false');
    expect(getLayerDivs()[0]).toHaveAttribute('draggable', 'true');
  });

  it('turns the name span into an editable region on mouse down', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');

    act(() => {
      fireEvent.mouseDown(span);
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(span).toHaveStyle({ background: '#fff' });
  });

  it('turns the name span into an editable region on a touch press', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');

    act(() => {
      fireEvent.pointerDown(span, { pointerId: 9, pointerType: 'touch' });
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
  });

  it('suspends dragging for the layer that is being renamed', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');

    act(() => {
      fireEvent.mouseDown(span);
    });

    expect(getLayerDivs()[0]).toHaveAttribute('draggable', 'false');
  });

  it('cancels a drag gesture started on the layer that is being renamed', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });

    const row = getLayerDivs()[0];
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(row, event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.body).not.toHaveClass('cursor-grabbing');
  });

  it('stays in rename mode when the name is pressed again', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');

    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      fireEvent.mouseDown(span);
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
  });

  it('does not select the row or commit the edit when the name area is clicked while editing', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = '  Sky  ';
    });

    // the wrapper stops the click so an in-progress rename is not committed by accident
    const wrapper = span.parentElement!;
    act(() => {
      fireEvent.click(wrapper);
    });

    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();
    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Top Layer');
    expect(liveStore.snapshot.activeLayerId).toBe('layer-2');
  });

  it('keeps the rename edit open when the span itself is clicked', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });

    act(() => {
      fireEvent.click(span);
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Top Layer');
    expect(liveStore.snapshot.activeLayerId).toBe('layer-2');
  });

  it('leaves rename mode and commits the typed name when Enter is pressed', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = 'Sky';
    });
    act(() => {
      span.focus();
    });
    expect(span).toHaveFocus();

    const blurSpy = vi.spyOn(span, 'blur');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      fireEvent(span, event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(blurSpy).toHaveBeenCalled();
    expect(layerMocks.updateLayer).toHaveBeenCalledWith('layer-3', { name: 'Sky' }, RENAME_LAYER_ACTION);
    expect(screen.queryByText('Top Layer')).toBeNull();
    expect(screen.getByText('Sky')).toBeInTheDocument();
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Sky');
    blurSpy.mockRestore();
  });

  it('restores the original name and dispatches nothing when Escape is pressed', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = 'Discarded';
    });

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      fireEvent(span, event);
    });

    expect(span.textContent).toBe('Top Layer');
    expect(span).toHaveAttribute('contenteditable', 'false');
    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Top Layer');
  });

  it('ignores unrelated keys while renaming', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = 'Sky';
    });

    act(() => {
      fireEvent.keyDown(span, { key: 'a' });
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Top Layer');
  });

  it.each([
    ['a whitespace-only name', '   '],
    ['an empty name', ''],
  ])('rejects %s and leaves the layer name untouched', (_label, nextName) => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = nextName;
      fireEvent.blur(span);
    });

    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(span).toHaveAttribute('contenteditable', 'false');
    expect(liveStore.snapshot.layers['layer-3'].name).toBe('Top Layer');
  });

  // Regression — src/components/SidebarRight/LayersTab.tsx:90-104.
  // `handleNameChange` refuses to commit a blank name, and because the span is no longer
  // editable the DOM text is no longer owned by React, so the refused path has to write the
  // stored name back itself — exactly as the Escape branch at LayersTab.tsx:231 does. Without
  // that write React re-renders with the same text child, changes nothing, and the row keeps
  // showing the blank label: a nameless layer that still exists.
  it('restores the previous label in the row when a blank rename is rejected', () => {
    render(<LayersTab />);
    const span = getNameSpan('Top Layer');
    act(() => {
      fireEvent.mouseDown(span);
    });
    act(() => {
      span.textContent = '   ';
      fireEvent.blur(span);
    });

    expect(layerMocks.updateLayer).not.toHaveBeenCalled();
    expect(span).toHaveTextContent('Top Layer');
  });
});

describe('LayersTab drag and drop guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    wireActionsToStore();
    seed();
  });

  afterEach(() => {
    document.body.classList.remove('cursor-grabbing');
    vi.useRealTimers();
  });

  it('marks the document as grabbing while a layer drag is in flight', () => {
    render(<LayersTab />);

    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer: createDataTransfer() });
    });

    expect(document.body).toHaveClass('cursor-grabbing');
  });

  it('reorders a movable layer from a touch pointer gesture', () => {
    render(<LayersTab />);
    const source = getLayerDivs()[0]!;
    const target = screen.getAllByRole('listitem')[2]!;
    Object.defineProperty(source, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(source, 'releasePointerCapture', { value: vi.fn() });
    const elementFromPoint = vi.fn(() => target);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });

    try {
      act(() => {
        fireEvent.pointerDown(source, { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 });
        fireEvent.pointerMove(source, { pointerId: 7, pointerType: 'touch', clientX: 20, clientY: 20 });
        fireEvent.pointerUp(source, { pointerId: 7, pointerType: 'touch', clientX: 20, clientY: 20 });
        vi.advanceTimersByTime(200);
      });

      expect(elementFromPoint).toHaveBeenCalledWith(20, 20);
      expect(layerMocks.moveLayerAfter).toHaveBeenCalledWith('layer-3', 'layer-1');
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    }
  });

  it('supports dropping a touch drag after the last layer', () => {
    render(<LayersTab />);
    const source = getLayerDivs()[0]!;
    const target = screen.getByTestId('layers-bottom-drop-target');
    Object.defineProperty(source, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(source, 'releasePointerCapture', { value: vi.fn() });
    const elementFromPoint = vi.fn(() => target);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });

    try {
      act(() => {
        fireEvent.pointerDown(source, { pointerId: 8, pointerType: 'touch', clientX: 10, clientY: 10 });
        fireEvent.pointerMove(source, { pointerId: 8, pointerType: 'touch', clientX: 20, clientY: 20 });
        fireEvent.pointerUp(source, { pointerId: 8, pointerType: 'touch', clientX: 20, clientY: 20 });
        vi.advanceTimersByTime(200);
      });

      expect(layerMocks.moveLayerAfter).toHaveBeenCalledWith('layer-3', undefined);
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    }
  });

  it('releases a touch drag when the window loses focus', () => {
    render(<LayersTab />);
    const source = getLayerDivs()[0]!;
    const target = screen.getAllByRole('listitem')[2]!;
    Object.defineProperty(source, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(source, 'releasePointerCapture', { value: vi.fn() });
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });

    try {
      act(() => {
        fireEvent.pointerDown(source, { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10 });
        fireEvent.pointerMove(source, { pointerId: 9, pointerType: 'touch', clientX: 20, clientY: 20 });
      });
      expect(document.body).toHaveClass('cursor-grabbing');

      act(() => {
        fireEvent.blur(window);
        fireEvent.pointerUp(source, { pointerId: 9, pointerType: 'touch', clientX: 20, clientY: 20 });
      });

      expect(document.body).not.toHaveClass('cursor-grabbing');
      expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    }
  });

  it('publishes the dragged layer id and drag image through the data transfer', () => {
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });

    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-layer-id', 'layer-3');
    expect(dataTransfer.setDragImage).toHaveBeenCalled();
  });

  it('prevents the backing layer from being dragged or reordered', () => {
    render(<LayersTab />);
    const backingRow = getListItemFor('Background').querySelector<HTMLElement>('[data-testid="layer-row-content"]')!;
    const dataTransfer = createDataTransfer();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });

    expect(backingRow).toHaveAttribute('draggable', 'false');
    expect(backingRow.querySelector('[data-testid="drag-handle"]')).toHaveAttribute('data-disabled', 'true');

    act(() => {
      fireEvent(backingRow, event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
    expect(document.body).not.toHaveClass('cursor-grabbing');
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
  });

  it('prevents a locked layer from being dragged or reordered', () => {
    seed({
      ...mockLayers,
      'layer-3': { ...mockLayers['layer-3'], locked: true },
    });
    render(<LayersTab />);

    const lockedRow = getListItemFor('Top Layer').querySelector<HTMLElement>('[data-testid="layer-row-content"]')!;
    const dataTransfer = createDataTransfer();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });

    expect(lockedRow).toHaveAttribute('draggable', 'false');
    expect(lockedRow.querySelector('[data-testid="drag-handle"]')).toHaveAttribute('data-disabled', 'true');

    act(() => {
      fireEvent(lockedRow, event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
  });

  it('resets the drag state and the grabbing cursor on drag end', () => {
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getLayerDivs()[2], { dataTransfer });
    });
    expect(getListItemFor('Background').querySelector('div.bg-blue-500')).toBeInTheDocument();

    act(() => {
      fireEvent.dragEnd(getLayerDivs()[0], { dataTransfer });
    });

    expect(document.body).not.toHaveClass('cursor-grabbing');
    expect(getListItemFor('Background').querySelector('div.bg-blue-500')).toBeNull();
    expect(getBottomDropZone(container).previousSibling).not.toHaveClass('bg-blue-500');
  });

  it('arms a row as a drop target and cancels the dragover default from the next hover on', () => {
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });

    // the target is armed by the state update, so the hover that arms it is not cancelled yet
    const armingEvent = new Event('dragover', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(getLayerDivs()[2], armingEvent);
    });
    expect(armingEvent.defaultPrevented).toBe(false);
    expect(getListItemFor('Background').querySelector('div.bg-blue-500')).toBeInTheDocument();

    const armedEvent = new Event('dragover', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(getLayerDivs()[2], armedEvent);
    });
    expect(armedEvent.defaultPrevented).toBe(true);
  });

  it('shows the insertion indicator on a valid row hover and clears it again', () => {
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getLayerDivs()[2], { dataTransfer });
    });
    expect(getListItemFor('Background').querySelector('div.bg-blue-500')).toBeInTheDocument();

    act(() => {
      fireEvent.dragOver(getLayerDivs()[0], { dataTransfer });
    });
    expect(getListItemFor('Top Layer').querySelector('div.bg-blue-500')).toBeNull();
  });

  it('refuses a drop on the row directly above the dragged layer', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getLayerDivs()[1], { dataTransfer });
    });

    const event = new Event('drop', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(getLayerDivs()[1], event);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
    expect(getRenderedNames(container)).toEqual(['Top Layer', 'Layer 2', 'Background']);
  });

  it('refuses a drop on a row when no drag is in flight', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);

    const event = new Event('drop', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(getLayerDivs()[2], event);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
    expect(getRenderedNames(container)).toEqual(['Top Layer', 'Layer 2', 'Background']);
  });

  it('ignores bottom-zone hover and drop when no drag is in flight', () => {
    vi.useFakeTimers();
    const { container } = render(<LayersTab />);
    const bottomZone = getBottomDropZone(container);

    const overEvent = new Event('dragover', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(bottomZone, overEvent);
    });
    expect(overEvent.defaultPrevented).toBe(false);
    expect(getBottomDropZone(container).previousSibling).not.toHaveClass('bg-blue-500');

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    act(() => {
      fireEvent(bottomZone, dropEvent);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(dropEvent.defaultPrevented).toBe(false);
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
    expect(getRenderedNames(container)).toEqual(['Top Layer', 'Layer 2', 'Background']);
  });

  it('shows the trailing insertion marker while hovering the bottom zone', () => {
    const { container } = render(<LayersTab />);
    const bottomZone = getBottomDropZone(container);

    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer: createDataTransfer() });
    });
    act(() => {
      fireEvent.dragOver(bottomZone, { dataTransfer: createDataTransfer() });
    });

    const marker = container.querySelector('div.bg-blue-500.h-2');
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveClass('-top-1');

    act(() => {
      fireEvent.dragEnd(getLayerDivs()[0], { dataTransfer: createDataTransfer() });
    });
    expect(container.querySelector('div.bg-blue-500.h-2')).toBeNull();
  });

  it('animates the moved row through its shrink phase before the reorder lands', () => {
    const { container } = render(<LayersTab />);
    const dataTransfer = createDataTransfer();
    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getLayerDivs()[2], { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getLayerDivs()[2], { dataTransfer });
    });

    // shrink phase: the row collapses before `moveLayerAfter` is invoked
    expect(getListItemFor('Top Layer')).toHaveClass('h-0', 'opacity-0');
    expect(layerMocks.moveLayerAfter).not.toHaveBeenCalled();
    expect(getRenderedNames(container)).toEqual(['Top Layer', 'Layer 2', 'Background']);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(layerMocks.moveLayerAfter).toHaveBeenCalledWith('layer-3', 'layer-1');
    expect(getListItemFor('Top Layer')).toHaveClass('h-10', 'opacity-100', 'animate-height-increase');
    expect(getRenderedNames(container)).toEqual(['Layer 2', 'Top Layer', 'Background']);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(getListItemFor('Top Layer')).toHaveClass('h-10', 'opacity-100');
    expect(getListItemFor('Top Layer')).not.toHaveClass('animate-height-increase');
  });

  it('clears the grabbing cursor when the panel unmounts mid-drag', () => {
    const { unmount } = render(<LayersTab />);
    act(() => {
      fireEvent.dragStart(getLayerDivs()[0], { dataTransfer: createDataTransfer() });
    });
    expect(document.body).toHaveClass('cursor-grabbing');

    unmount();

    expect(document.body).not.toHaveClass('cursor-grabbing');
  });
});
