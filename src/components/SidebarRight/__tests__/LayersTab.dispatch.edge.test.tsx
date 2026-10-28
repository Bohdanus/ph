import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import { HIDE_LAYER_ACTION, REMOVE_ACTION } from '@/util/constants.ts';
import { createMockStoreState, type MockStoreState } from '@/__tests__/fixtures/store.ts';
import { createMockLayer, createMockLayers } from '@/__tests__/fixtures/layer.ts';
import { createMockCanvas } from '@/__tests__/fixtures/canvas.ts';
import { createMockHistory } from '@/__tests__/fixtures/history.ts';

/**
 * Edge cases that the happy-path dispatch suite does not cover: gestures that the
 * component must tolerate without dispatching, and mutations that bypass the guards
 * a caller might assume are in place. `LayersTab` still owns no dispatch of its own —
 * every mutation reaches the store through `useLayers()` — so each assertion either
 * names the action that arrives or proves none arrives at all.
 */
type DispatchRecord = { type: string; payload: Record<string, unknown> };
type StoreWithDispatch = MockStoreState & { dispatch: ReturnType<typeof vi.fn> };

const { storeRef } = vi.hoisted(() => ({
  storeRef: { current: null as unknown },
}));

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore: () => [storeRef.current as StoreWithDispatch, (storeRef.current as StoreWithDispatch).dispatch],
}));

vi.mock('@/contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: { toolName: 'move' }, setToolArgs: vi.fn() }),
}));

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));
vi.mock('../../Icons/TrashIcon.tsx', () => ({ TrashIcon: () => <span data-testid="trash-icon" /> }));
vi.mock('../../Icons/DragHandleIcon.tsx', () => ({ DragHandleIcon: () => <span data-testid="drag-handle" /> }));

const PREVIEW_LAYERS_REF = { current: {} as Record<string, unknown> };

function seedStore(overrides: Partial<MockStoreState> = {}) {
  const state = {
    ...createMockStoreState({
      layers: createMockLayers(3),
      activeLayerId: 'layer-2',
      totalSize: { width: 200, height: 120 },
      history: createMockHistory(1),
      historyIndex: 0,
      toolOverlayRef: { current: createMockCanvas() as unknown as HTMLCanvasElement },
      ...overrides,
    }),
    previewLayers: PREVIEW_LAYERS_REF as unknown as MockStoreState['previewLayers'],
    dispatch: vi.fn(),
  } as unknown as StoreWithDispatch;
  storeRef.current = state;
  return state;
}

function dispatched(): DispatchRecord[] {
  return (storeRef.current as StoreWithDispatch).dispatch.mock.calls.map(
    ([action]) => action as unknown as DispatchRecord
  );
}

function getRow(name: string): HTMLElement {
  const item = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no row for ${name}`);
  return item.querySelector('div[title="Drag to reorder"]') as HTMLElement;
}

function getNameSpan(row: HTMLElement): HTMLElement {
  return row.querySelector('span.truncate') as HTMLElement;
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

describe('LayersTab dispatch edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PREVIEW_LAYERS_REF.current = {};
    seedStore();
  });

  it('toggles visibility on a locked layer (no lock guard on the toggle)', () => {
    seedStore({
      layers: {
        'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
        'layer-2': createMockLayer({ id: 'layer-2', name: 'Locked', order: 1, locked: true, visible: true }),
      },
      activeLayerId: 'layer-2',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Locked').querySelector('button[aria-label="Hide layer"]')!);
    });

    expect(dispatched()).toHaveLength(1);
    const action = dispatched()[0];
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload.historyItem).toEqual({
      id: expect.any(String),
      layerId: 'layer-2',
      actionName: HIDE_LAYER_ACTION,
      args: { visible: false },
    });
  });

  it('cancels a rename with Escape and dispatches nothing', () => {
    render(<LayersTab />);
    const span = getNameSpan(getRow('Top Layer'));

    act(() => {
      fireEvent.mouseDown(span);
    });
    expect(span).toHaveAttribute('contenteditable', 'true');

    act(() => {
      span.textContent = 'Renamed';
      fireEvent.keyDown(span, { key: 'Escape' });
    });

    expect(span).toHaveAttribute('contenteditable', 'false');
    expect(span.textContent).toBe('Top Layer');
    expect(dispatched()).toEqual([]);
  });

  it('removes the active layer and falls back to the next layer', () => {
    seedStore({
      layers: {
        'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
        'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
        'layer-3': createMockLayer({ id: 'layer-3', name: 'Top Layer', order: 2 }),
      },
      activeLayerId: 'layer-3',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Top Layer').querySelector('button[aria-label="Remove layer"]')!);
    });

    const action = dispatched()[0];
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    const historyItem = action.payload.historyItem as { actionName: string };
    expect(historyItem.actionName).toBe(REMOVE_ACTION);
    const updates = action.payload.updates as {
      layers: Record<string, unknown>;
      activeLayerId: string | null;
    };
    expect(Object.keys(updates.layers)).toEqual(['layer-1', 'layer-2']);
    expect(updates.activeLayerId).toBe('layer-2');
  });

  it('dispatches nothing when a layer is dropped onto itself', () => {
    vi.useFakeTimers();
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getRow('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getRow('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getRow('Top Layer'), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(dispatched()).toEqual([]);
  });

  it('opens the name for editing on a non-text layer without dispatching a text edit', () => {
    render(<LayersTab />);
    const span = getNameSpan(getRow('Top Layer'));

    act(() => {
      fireEvent.mouseDown(span);
    });

    expect(span).toHaveAttribute('contenteditable', 'true');
    // Editing is local component state; a non-text layer has no text-edit target, so
    // nothing reaches the store until the rename is committed.
    expect(dispatched()).toEqual([]);
  });
});
