import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HistoryTab from '../HistoryTab.tsx';
import type { HistoryItem } from '@/contexts/history-types.ts';
import { getHistoryItemTitle, selectHistoryPanelProjection } from '@/contexts/useHistory.ts';
import { durableEntryProvenance, durableEntryTitle } from '@/contexts/history-provenance.ts';
import {
  DURABLE_SCHEMA_VERSION,
  type DurableDocument,
  type DurableHistoryEntry,
  type SelectionSnapshot,
} from '@/contexts/history-model.ts';
import {
  NEW_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  SET_LAYER_OPACITY_ACTION,
  TOOL_ACTION,
  HIDE_LAYER_ACTION,
} from '@/util/constants.ts';
import { createMockHistoryItem } from '@/__tests__/fixtures/history.ts';
import { claimDocumentGesture, isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));

const mockHistory: HistoryItem[] = [
  createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } }),
  createMockHistoryItem({ id: 'hist-2', actionName: TOOL_ACTION, args: { toolName: 'brush' } }),
  createMockHistoryItem({ id: 'hist-3', actionName: HIDE_LAYER_ACTION }),
];

const mockStore = {
  history: mockHistory,
  historyIndex: 1,
  layers: {
    'layer-1': {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      isBedrock: false,
      order: 0,
      pos: { x: 0, y: 0, width: 100, height: 100 },
    },
  },
  activeLayerId: 'layer-1',
  totalSize: { width: 100, height: 100 },
  selections: [],
  activeSelectionId: null,
  branchRevision: 0,
  hasUnsavedChanges: false,
  deletedLayers: {},
  canvasRef: { current: null },
};

const { useStore } = vi.hoisted(() => ({
  useStore: vi.fn(),
}));

const { useHistory } = vi.hoisted(() => ({
  useHistory: vi.fn(),
}));

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore,
}));

vi.mock('@/contexts/useHistory.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/useHistory.ts')>();
  return {
    ...actual,
    useHistory,
  };
});

const renameTitle = getHistoryItemTitle(mockHistory[0]);
const toolTitle = getHistoryItemTitle(mockHistory[1]);
const hideTitle = getHistoryItemTitle(mockHistory[2]);

const emptySelectionSnapshot = (): SelectionSnapshot => ({ selections: [], activeSelectionId: null });

/**
 * Builds the `useHistory` return the component consumes, deriving its
 * `historyPanelProjection` through the REAL `selectHistoryPanelProjection` so the rows
 * rendered by the component come from the same projection code path the app uses. Tests
 * that assert on the rewind/toggle spies inject them; everything else gets fresh spies.
 */
function buildReturn(
  store: { history: readonly HistoryItem[]; historyIndex: number },
  spies: { resetHistoryTo?: ReturnType<typeof vi.fn>; toggleDisabled?: ReturnType<typeof vi.fn> } = {}
) {
  const historyPanelProjection = selectHistoryPanelProjection({
    history: store.history,
    historyIndex: store.historyIndex,
    documentId: 'doc-1',
    documentRevision: 0,
    branchRevision: 0,
    durableStatus: undefined,
    durableDocument: undefined,
  });
  return {
    resetHistoryTo: spies.resetHistoryTo ?? vi.fn(),
    toggleDisabled: spies.toggleDisabled ?? vi.fn(),
    historyPanelProjection,
  };
}

/** A `DurableDocument` whose entries mirror a legacy timeline 1:1. */
function buildDurableEntry(item: HistoryItem): DurableHistoryEntry {
  return {
    id: item.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: !item.disabled,
    provenance: durableEntryProvenance(item),
    operation: {
      kind: 'set-selection',
      before: emptySelectionSnapshot(),
      after: emptySelectionSnapshot(),
    },
  };
}

function buildCompleteDurableDocument(history: readonly HistoryItem[], historyIndex: number): DurableDocument {
  return {
    documentId: 'doc-1',
    documentRevision: 0,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [],
      selections: emptySelectionSnapshot(),
      activeLayerId: null,
    },
    history: history.map(buildDurableEntry),
    cursor: historyIndex,
  };
}

// The gesture slot is module-level and outlives every mount, so a case that
// leaked a claim would refuse every later click in this file, and one failure
// would read as a failure in all of them. Cleared on the way in AND on the way
// out; the gate suite below pins that the reset actually does it.
beforeEach(() => {
  resetDocumentGestures();
});

afterEach(() => {
  resetDocumentGestures();
});

describe('HistoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([mockStore, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(mockStore));
  });

  it('renders "No history yet" when history is empty', () => {
    const store = { ...mockStore, history: [], historyIndex: -1 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
  });

  it('renders history items in reverse order (newest first)', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect([renameTitle, toolTitle, hideTitle]).toEqual([RENAME_LAYER_ACTION, 'brush', HIDE_LAYER_ACTION]);
    expect(items[0]).toHaveTextContent(hideTitle);
    expect(items[1]).toHaveTextContent(toolTitle);
    expect(items[2]).toHaveTextContent(renameTitle);
  });

  it('gives opacity changes a meaningful history title', () => {
    const item = createMockHistoryItem({
      actionName: SET_LAYER_OPACITY_ACTION,
      args: { opacity: 0.42 },
    });
    expect(getHistoryItemTitle(item)).toBe('set layer opacity');
  });

  it('highlights current history item', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveClass('bg-white');
  });

  it('shows disabled items with opacity', () => {
    const disabledHistory = [
      createMockHistoryItem({ id: 'hist-1', disabled: true }),
      createMockHistoryItem({ id: 'hist-2' }),
    ];
    const store = { ...mockStore, history: disabledHistory, historyIndex: 1 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    // items[0] = hist-2 (originalIndex 1), active -> opacity-100
    // items[1] = hist-1 (originalIndex 0), disabled -> opacity-45
    expect(items[1]).toHaveClass('opacity-45');
    expect(items[0]).not.toHaveClass('opacity-45');
  });

  it('shows inactive items with opacity-50', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    // items[0] = hist-3 (originalIndex 2), not active (2 > 1) -> opacity-50
    // items[2] = hist-1 (originalIndex 0), active (0 <= 1) -> opacity-100
    expect(items[0]).toHaveClass('opacity-50');
    expect(items[2]).toHaveClass('opacity-100');
  });

  it('calls resetHistoryTo on item click', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[0]);
    expect(resetHistoryTo).toHaveBeenCalledWith(2);
  });

  it('toggles disabled state on eye button click', () => {
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { toggleDisabled }));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeButton = items[0].querySelector('button');
    fireEvent.click(eyeButton!);
    expect(toggleDisabled).toHaveBeenCalledWith('hist-3');
  });

  it('shows eye icon open for enabled items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeIcons = items.map((item) => item.querySelector('[data-testid="eye-icon"]'));
    expect(eyeIcons[0]).toBeInTheDocument();
    expect(eyeIcons[0]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[1]).toBeInTheDocument();
    expect(eyeIcons[1]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[2]).toBeInTheDocument();
    expect(eyeIcons[2]).toHaveAttribute('data-open', 'true');
  });

  it('shows eye icon closed for disabled items', () => {
    const disabledHistory = [createMockHistoryItem({ id: 'hist-1', disabled: true })];
    const store = { ...mockStore, history: disabledHistory, historyIndex: 0 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeIcon = items[0].querySelector('[data-testid="eye-icon"]');
    expect(eyeIcon).toBeInTheDocument();
    expect(eyeIcon).toHaveAttribute('data-open', 'false');
  });

  it('stops propagation on eye button click', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeButton = items[0].querySelector('button');
    fireEvent.click(eyeButton!);
    expect(resetHistoryTo).not.toHaveBeenCalled();
  });

  it('shows current state indicator', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('👈');
  });

  it('applies correct styling classes', () => {
    render(<HistoryTab />);
    const container = screen.getByRole('list').parentElement!;
    expect(container).toHaveClass('flex');
    expect(container).toHaveClass('flex-col');
    expect(container).toHaveClass('gap-2');
    expect(container).toHaveClass('h-full');
  });

  it('applies correct list item classes for active item', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveClass('bg-white');
    expect(items[1]).toHaveClass('border-gray-200');
  });

  it('applies correct list item classes for inactive items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveClass('bg-transparent');
    expect(items[2]).toHaveClass('bg-transparent');
  });

  it('handles single history item', () => {
    const singleHistory = [createMockHistoryItem({ id: 'hist-1' })];
    const store = { ...mockStore, history: singleHistory, historyIndex: 0 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(NEW_LAYER_ACTION);
  });

  it('shows tooltip on list items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('title', 'Click to go back to this state');
  });
});

/**
 * `mockHistory` is rendered newest-first, so the visible title doubles as a stable handle
 * for asserting which store index a row maps to.
 */
function getItemByTitle(title: string): HTMLElement {
  const item = screen.getByText(title).closest('li');
  if (!item) throw new Error(`no history item titled ${title}`);
  return item;
}

describe('HistoryTab row behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([mockStore, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(mockStore));
  });

  it.each([
    [hideTitle, 2],
    [toolTitle, 1],
    [renameTitle, 0],
  ])('resets history to the original store index behind %s', (title, expectedIndex) => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);

    fireEvent.click(getItemByTitle(title));

    expect(resetHistoryTo).toHaveBeenCalledTimes(1);
    expect(resetHistoryTo).toHaveBeenCalledWith(expectedIndex);
  });

  it('still resets history when the clicked item is disabled', () => {
    const resetHistoryTo = vi.fn();
    const history = [createMockHistoryItem({ id: 'hist-1', disabled: true })];
    const store = { ...mockStore, history, historyIndex: 0 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store, { resetHistoryTo }));
    render(<HistoryTab />);

    fireEvent.click(screen.getByRole('listitem'));

    expect(resetHistoryTo).toHaveBeenCalledWith(0);
  });

  it.each([
    ['an enabled item', false, 'Disable history item'],
    ['a disabled item', true, 'Enable history item'],
  ])('titles the eye control of %s', (_label, disabled, expectedTitle) => {
    const history = [createMockHistoryItem({ id: 'hist-1', disabled })];
    const store = { ...mockStore, history, historyIndex: 0 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);

    const eyeButton = within(screen.getByRole('listitem')).getByRole('button');
    expect(eyeButton).toHaveAttribute('title', expectedTitle);
  });

  it('marks only the item at historyIndex as the current state', () => {
    render(<HistoryTab />);

    const currentMarkers = screen.getAllByTitle('Current state');
    expect(currentMarkers).toHaveLength(1);
    expect(getItemByTitle(toolTitle)).toContainElement(currentMarkers[0]);
    expect(getItemByTitle(hideTitle)).not.toContainElement(currentMarkers[0]);
  });

  it('marks no item as current when historyIndex points past the end of the list', () => {
    const store = { ...mockStore, historyIndex: 99 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);

    expect(screen.queryByTitle('Current state')).toBeNull();
    for (const item of screen.getAllByRole('listitem')) {
      // every stored index is still `<= historyIndex`, so all of them count as reachable
      expect(item).toHaveClass('opacity-100');
    }
  });

  it('keeps a redoable future item inert-looking while older items stay active', () => {
    const store = { ...mockStore, historyIndex: 0 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);

    expect(getItemByTitle(renameTitle)).toHaveClass('opacity-100');
    expect(getItemByTitle(toolTitle)).toHaveClass('opacity-50');
    expect(getItemByTitle(hideTitle)).toHaveClass('opacity-50');
  });

  it('renders no list at all when history is empty', () => {
    const store = { ...mockStore, history: [], historyIndex: -1 };
    useStore.mockReturnValue([store, vi.fn()]);
    useHistory.mockReturnValue(buildReturn(store));
    render(<HistoryTab />);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  // Accessibility gap — src/components/SidebarRight/HistoryTab.tsx:72-74.
  // The history row is the only way to travel back in time, but it is a bare `<li>`
  // with an `onClick`: it has no `tabIndex`, no `role` and no key handler, so the list is
  // completely unreachable with the keyboard. The eye control inside it is focusable, but
  // focusing it does not make the row activatable.
  it.fails('lets a keyboard user travel to a history row and activate it with Enter', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);

    const row = getItemByTitle(toolTitle);
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('role', 'button');

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(resetHistoryTo).toHaveBeenCalledWith(1);
  });
});

/**
 * The keyboard gate (`useKeyboardEvents.tsx:134`) refuses document-mutating
 * shortcuts while a pointer gesture owns the document, and the Undo/Redo buttons
 * were closed off in the same change class afterwards (`HistoryControls.tsx`,
 * `MobileHeader.tsx`). The history tab is the third way into the same
 * `APPLY_HISTORY_REPLAY`, and BOTH of its controls reached it ungated.
 *
 * Inside a gesture's window the replay is destructive. `resetHistoryTo` replays
 * `selections` from the SAME `history` array, so `history.length` never moves and
 * the pending commit's `entries.slice(0, cursor + 1)` truncates the redo tail
 * with no other symptom; `toggleDisabled` loses the same tail and takes a
 * visibility flag with it. A single pointer cannot reach it — the pointer is
 * captured by the tool area — so the window is reachable only by a second pointer.
 *
 * The refusal belongs in these handlers, at the input layer: no dispatch, so
 * nothing appends, so nothing truncates. It deliberately does NOT come from a
 * `disabled` attribute either way — every case below claims the gesture AFTER
 * render, and `disabled` is read at render time, so a render-time read could not
 * see the claim at all, and a control disabled by a mid-gesture render would stay
 * disabled after the release. The "is still enabled" assertions are there so a
 * `disabled` solution cannot pass these cases.
 */
describe('HistoryTab document gesture gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([mockStore, vi.fn()]);
  });

  /** The row's own enable/disable control, which is a real `<button>`. */
  const eyeControl = (row: HTMLElement) => within(row).getByRole('button');

  it('refuses to rewind to a history entry while a document gesture is open, because the release-time commit would truncate the redo tail', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);

    // Claimed after render, which is the whole point: the slot raises no re-render,
    // so a `disabled` expression would not have seen this.
    claimDocumentGesture('rectangular-selection', 1);
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.click(getItemByTitle(hideTitle));

    expect(resetHistoryTo).not.toHaveBeenCalled();
  });

  it('refuses to toggle a history entry enabled state while a document gesture is open, for the same reason', () => {
    const resetHistoryTo = vi.fn();
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo, toggleDisabled }));
    render(<HistoryTab />);

    claimDocumentGesture('layer-transform', 2);
    fireEvent.click(eyeControl(getItemByTitle(hideTitle)));

    expect(toggleDisabled).not.toHaveBeenCalled();
    // `stopPropagation` runs before the gate, so a refused eye click still does not
    // travel to the row and rewind behind it.
    expect(resetHistoryTo).not.toHaveBeenCalled();
  });

  it('leaves the row and its enable control enabled while a gesture is open, so the refusal is the handler and not an attribute', () => {
    useHistory.mockReturnValue(buildReturn(mockStore));
    render(<HistoryTab />);

    const row = getItemByTitle(hideTitle);
    claimDocumentGesture('brush-stroke', 3);

    expect(eyeControl(row)).toBeEnabled();
    expect(row).not.toHaveAttribute('disabled');
    expect(row).not.toHaveAttribute('aria-disabled');
  });

  it('rewinds with no gesture open, so the gate refuses only while a gesture owns the document', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(getItemByTitle(toolTitle));

    expect(resetHistoryTo).toHaveBeenCalledTimes(1);
    expect(resetHistoryTo).toHaveBeenCalledWith(1);
  });

  it('toggles with no gesture open, so the gate refuses only while a gesture owns the document', () => {
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { toggleDisabled }));
    render(<HistoryTab />);
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(eyeControl(getItemByTitle(hideTitle)));

    expect(toggleDisabled).toHaveBeenCalledTimes(1);
    expect(toggleDisabled).toHaveBeenCalledWith('hist-3');
  });

  it('rewinds again once resetDocumentGestures drops the claim, so the gate is a window and not a latch', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue(buildReturn(mockStore, { resetHistoryTo }));
    render(<HistoryTab />);

    claimDocumentGesture('polygon-selection', 4);
    fireEvent.click(getItemByTitle(toolTitle));
    expect(resetHistoryTo).not.toHaveBeenCalled();

    resetDocumentGestures();
    expect(isDocumentGestureOpen()).toBe(false);
    fireEvent.click(getItemByTitle(toolTitle));

    expect(resetHistoryTo).toHaveBeenCalledTimes(1);
    expect(resetHistoryTo).toHaveBeenCalledWith(1);
  });
});

describe('HistoryTab durable historyPanelProjection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([mockStore, vi.fn()]);
  });

  it('supplies the durable title/row state from a complete durable projection', () => {
    const durableDocument = buildCompleteDurableDocument(mockHistory, mockStore.historyIndex);
    const projection = selectHistoryPanelProjection({
      history: mockHistory,
      historyIndex: mockStore.historyIndex,
      documentId: durableDocument.documentId,
      documentRevision: durableDocument.documentRevision,
      branchRevision: durableDocument.branchRevision,
      durableStatus: 'current',
      durableDocument,
    });
    // A complete, consistent durable document is admitted.
    expect(projection.source).toBe('durable');

    const resetHistoryTo = vi.fn();
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue({ resetHistoryTo, toggleDisabled, historyPanelProjection: projection });
    render(<HistoryTab />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Rows carry the durable-derived titles (admission requires them to equal the legacy title).
    expect(items[0]).toHaveTextContent(durableEntryTitle(durableEntryProvenance(mockHistory[2])) ?? '');
    expect(items[1]).toHaveTextContent(durableEntryTitle(durableEntryProvenance(mockHistory[1])) ?? '');
    expect(items[2]).toHaveTextContent(durableEntryTitle(durableEntryProvenance(mockHistory[0])) ?? '');

    // historyIndex === 1 marks the middle entry as the current state.
    expect(items[1]).toHaveClass('bg-white');
    expect(screen.getByTitle('Current state')).toHaveTextContent('👈');

    // Dispatch still flows through the row's own originalIndex and item id.
    fireEvent.click(items[0]);
    expect(resetHistoryTo).toHaveBeenCalledWith(2);

    fireEvent.click(within(items[0]).getByRole('button'));
    expect(toggleDisabled).toHaveBeenCalledWith('hist-3');
  });

  it('renders the complete legacy fallback when the durable document is incomplete and still dispatches legacy indices/IDs', () => {
    // Present and "current", but incomplete: two entries against three legacy items,
    // so the length-mismatch guard rejects admission and the panel falls back.
    const incompleteDurable = {
      ...buildCompleteDurableDocument(mockHistory, mockStore.historyIndex),
      history: mockHistory.slice(0, 2).map(buildDurableEntry),
    };
    const projection = selectHistoryPanelProjection({
      history: mockHistory,
      historyIndex: mockStore.historyIndex,
      documentId: incompleteDurable.documentId,
      documentRevision: incompleteDurable.documentRevision,
      branchRevision: incompleteDurable.branchRevision,
      durableStatus: 'current',
      durableDocument: incompleteDurable,
    });
    expect(projection.source).toBe('legacy');

    const resetHistoryTo = vi.fn();
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue({ resetHistoryTo, toggleDisabled, historyPanelProjection: projection });
    render(<HistoryTab />);

    // The complete legacy set renders (three rows), not the partial two-entry durable slice.
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(hideTitle);
    expect(items[2]).toHaveTextContent(renameTitle);

    // Rewind/toggle target the legacy originalIndex and the legacy item id.
    fireEvent.click(items[0]);
    expect(resetHistoryTo).toHaveBeenCalledWith(2);

    fireEvent.click(within(items[0]).getByRole('button'));
    expect(toggleDisabled).toHaveBeenCalledWith('hist-3');
  });
});
