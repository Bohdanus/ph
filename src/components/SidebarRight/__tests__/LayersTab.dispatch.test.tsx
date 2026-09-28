import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import {
  HIDE_LAYER_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SHOW_LAYER_ACTION,
} from '@/util/constants.ts';
import { createMockStoreState, type MockStoreState } from '@/__tests__/fixtures/store.ts';
import { createMockLayer, createMockLayers } from '@/__tests__/fixtures/layer.ts';
import { createMockCanvas } from '@/__tests__/fixtures/canvas.ts';
import { DURABLE_SCHEMA_VERSION } from '@/contexts/history-model.ts';

/**
 * `LayersTab` owns no dispatch of its own: every mutation it performs is delegated to
 * `useLayers()`. These tests therefore keep the **real** `useLayer` hook and replace only
 * the store boundary, so each assertion names the exact action object that reaches the
 * reducer — action type, `updates` patch, the appended history entry, and the durable
 * entry `useLayer.updateLayer` plans alongside it for every layer-property action.
 *
 * The durable entry is the canonical `set-layer-properties` operation derived from the
 * action name, not the raw `Partial<Layer>` patch, so it is asserted in full here: an
 * inexact matcher would let a drifting `layerId`, `enabled` flag, or schema version pass.
 *
 * `createHistoryItem` mints a random uuid, so `uuid` is stubbed to keep the history
 * entries byte-for-byte comparable.
 */
type DispatchRecord = { type: string; payload: Record<string, unknown> };
type StoreWithDispatch = MockStoreState & { dispatch: ReturnType<typeof vi.fn> };

const { storeRef, uuidMock } = vi.hoisted(() => ({
  storeRef: { current: null as unknown },
  uuidMock: vi.fn((): string => 'history-id'),
}));

vi.mock('uuid', () => ({ v4: uuidMock }));

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore: () => [storeRef.current as StoreWithDispatch, (storeRef.current as StoreWithDispatch).dispatch],
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
      // `removeLayer` clears the tool overlay, so a real (mocked) context is required.
      toolOverlayRef: { current: createMockCanvas() as unknown as HTMLCanvasElement },
      ...overrides,
    }),
    // the real store holds a ref here, not a plain record
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

function onlyDispatched(): DispatchRecord {
  const actions = dispatched();
  expect(actions).toHaveLength(1);
  return actions[0];
}

function getRow(name: string): HTMLElement {
  const item = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no row for ${name}`);
  return item.querySelector('div[title="Drag to reorder"]') as HTMLElement;
}

function getNameSpan(row: HTMLElement): HTMLElement {
  return row.querySelector('span.truncate') as HTMLElement;
}

function getBottomDropZone(): HTMLElement {
  return document.querySelector('[class~="min-h-[20px]"]') as HTMLElement;
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

function commitRename(name: string, nextName: string) {
  const span = getNameSpan(getRow(name));
  act(() => {
    fireEvent.mouseDown(span);
  });
  act(() => {
    span.textContent = nextName;
    fireEvent.blur(span);
  });
}

describe('LayersTab actions reaching the store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    PREVIEW_LAYERS_REF.current = {};
    uuidMock.mockReturnValue('history-id');
    seedStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches COMMIT_DOCUMENT_EDIT with HIDE_LAYER_ACTION when hiding a visible layer', () => {
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Top Layer').querySelector('button[aria-label="Hide layer"]')!);
    });

    expect(onlyDispatched()).toEqual({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: expect.objectContaining({
            'layer-3': expect.objectContaining({ id: 'layer-3', visible: false }),
          }),
        },
        historyItem: {
          id: 'history-id',
          layerId: 'layer-3',
          actionName: HIDE_LAYER_ACTION,
          args: { visible: false },
        },
        durableEntry: {
          id: 'history-id',
          schemaVersion: DURABLE_SCHEMA_VERSION,
          enabled: true,
          operation: {
            kind: 'set-layer-properties',
            layerId: 'layer-3',
            patch: { visible: false },
          },
        },
      },
    });
  });

  it('dispatches COMMIT_DOCUMENT_EDIT with SHOW_LAYER_ACTION when revealing a hidden layer', () => {
    seedStore({
      layers: {
        'only-layer': createMockLayer({ id: 'only-layer', name: 'Only Layer', order: 0, visible: false }),
      },
      activeLayerId: 'only-layer',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Only Layer').querySelector('button[aria-label="Show layer"]')!);
    });

    expect(onlyDispatched()).toEqual({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: expect.objectContaining({
            'only-layer': expect.objectContaining({ id: 'only-layer', visible: true }),
          }),
        },
        historyItem: {
          id: 'history-id',
          layerId: 'only-layer',
          actionName: SHOW_LAYER_ACTION,
          args: { visible: true },
        },
        durableEntry: {
          id: 'history-id',
          schemaVersion: DURABLE_SCHEMA_VERSION,
          enabled: true,
          operation: {
            kind: 'set-layer-properties',
            layerId: 'only-layer',
            patch: { visible: true },
          },
        },
      },
    });
  });

  it('dispatches a plain SET_ACTIVE_LAYER action when a row is selected', () => {
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Top Layer'));
    });

    expect(onlyDispatched()).toEqual({ type: 'SET_ACTIVE_LAYER', payload: 'layer-3' });
  });

  it('dispatches RENAME_LAYER_ACTION with the trimmed name when a rename is committed', () => {
    render(<LayersTab />);

    commitRename('Top Layer', '  Sky  ');

    expect(onlyDispatched()).toEqual({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: expect.objectContaining({
            'layer-3': expect.objectContaining({ name: 'Sky' }),
          }),
        },
        historyItem: {
          id: 'history-id',
          layerId: 'layer-3',
          actionName: RENAME_LAYER_ACTION,
          args: { name: 'Sky' },
        },
        durableEntry: {
          id: 'history-id',
          schemaVersion: DURABLE_SCHEMA_VERSION,
          enabled: true,
          operation: {
            kind: 'set-layer-properties',
            layerId: 'layer-3',
            patch: { name: 'Sky' },
          },
        },
      },
    });
  });

  it.each([
    ['an all-whitespace name', '   '],
    ['an empty name', ''],
    ['the name the layer already has', 'Top Layer'],
  ])('dispatches nothing for %s', (_label, nextName) => {
    render(<LayersTab />);

    commitRename('Top Layer', nextName);

    expect(dispatched()).toEqual([]);
  });

  it('dispatches REMOVE_ACTION when the trash control is activated', () => {
    seedStore({
      layers: {
        'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
        'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
      },
      activeLayerId: 'layer-2',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Layer 2').querySelector('button[aria-label="Remove layer"]')!);
    });

    const action = onlyDispatched();
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload.historyItem).toEqual({
      id: 'history-id',
      layerId: 'layer-2',
      actionName: REMOVE_ACTION,
      args: {},
    });
    const updates = action.payload.updates as {
      layers: Record<string, unknown>;
      deletedLayers: Record<string, { bitmap: null; tmpCanvas: null }>;
      activeLayerId: string | null;
    };
    expect(Object.keys(updates.layers)).toEqual(['layer-1']);
    expect(updates.deletedLayers['layer-2']).toEqual(expect.objectContaining({ bitmap: null, tmpCanvas: null }));
    // removing the active layer falls back to the new topmost layer
    expect(updates.activeLayerId).toBe('layer-1');
  });

  it('keeps the active layer selected when a different layer is removed', () => {
    seedStore({
      layers: {
        'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
        'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
      },
      activeLayerId: 'layer-2',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Background').querySelector('button[aria-label="Remove layer"]')!);
    });

    const updates = onlyDispatched().payload.updates as { activeLayerId: string | null };
    expect(updates.activeLayerId).toBe('layer-2');
  });

  it('dispatches a null active layer when the last remaining layer is removed', () => {
    seedStore({
      layers: { 'only-layer': createMockLayer({ id: 'only-layer', name: 'Only Layer', order: 0 }) },
      activeLayerId: 'only-layer',
    });
    render(<LayersTab />);

    act(() => {
      fireEvent.click(getRow('Only Layer').querySelector('button[aria-label="Remove layer"]')!);
    });

    const updates = onlyDispatched().payload.updates as { layers: Record<string, unknown>; activeLayerId: unknown };
    expect(updates.layers).toEqual({});
    expect(updates.activeLayerId).toBeNull();
  });

  it('dispatches REORDER_ACTION naming both layer ids when a row is dropped on another row', () => {
    vi.useFakeTimers();
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getRow('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.dragOver(getRow('Background'), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getRow('Background'), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const action = onlyDispatched();
    expect(action.type).toBe('COMMIT_DOCUMENT_EDIT');
    expect(action.payload.historyItem).toEqual({
      id: 'history-id',
      layerId: 'layer-3',
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'layer-3', afterWhichLayerId: 'layer-1' },
    });
  });

  it('dispatches REORDER_ACTION without a placement id for a drop on the bottom zone', () => {
    vi.useFakeTimers();
    render(<LayersTab />);
    const dataTransfer = createDataTransfer();

    act(() => {
      fireEvent.dragStart(getRow('Top Layer'), { dataTransfer });
    });
    act(() => {
      fireEvent.drop(getBottomDropZone(), { dataTransfer });
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });

    const action = onlyDispatched();
    expect(action.payload.historyItem).toEqual({
      id: 'history-id',
      layerId: 'layer-3',
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'layer-3', afterWhichLayerId: undefined },
    });
  });
});
