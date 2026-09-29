import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../../util/constants.ts';
import FreehandLasso from '../FreehandLasso.tsx';

const getToolArgsResult = vi.hoisted(() => ({
  value: { fill: false, toolName: 'freehand-lasso' } as { fill: boolean; toolName: string } | null,
}));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());

const storeState = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  selections: [] as Selection[],
  // An empty timeline at cursor -1 is what a store with nothing appended yet
  // actually looks like, and it is what puts the Clear writer on the append
  // boundary's SUCCESS branch: `history`/`historyIndex` go straight into the
  // planner's `timeline`, `validateTimeline` reports the out-of-range cursor as a
  // diagnostic instead of throwing on `undefined`, and the writer dispatches the
  // plan it made. Without them the writer's `catch` produces a byte-identical
  // dispatch with no `durableEntry`, and every pin below would pass on that
  // fallback instead. `branchRevision` is the hook's own default, included for
  // shape parity.
  history: [] as unknown[],
  historyIndex: -1,
  branchRevision: 0,
}));

const clipboardState = vi.hoisted(() => ({
  activeSelection: null as { id: string; geometry: string } | null,
  hasSelectionClipboard: false,
}));

const clipboardMocks = vi.hoisted(() => ({
  copyActiveSelection: vi.fn(),
  pasteSelectionClipboard: vi.fn(),
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, mockDispatch],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => getToolArgsResult.value,
    patchToolArgs: mockPatchToolArgs,
  }),
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: clipboardState.activeSelection,
    copyActiveSelection: clipboardMocks.copyActiveSelection,
    hasSelectionClipboard: clipboardState.hasSelectionClipboard,
    pasteSelectionClipboard: clipboardMocks.pasteSelectionClipboard,
  }),
}));

const setToolArgsResult = (fill: boolean) => {
  getToolArgsResult.value = { fill, toolName: 'freehand-lasso' };
};

const setSelectionState = (
  state: { activeSelection?: { id: string; geometry: string } | null; hasClipboard?: boolean } = {}
) => {
  clipboardState.activeSelection = state.activeSelection ?? null;
  clipboardState.hasSelectionClipboard = state.hasClipboard ?? false;
};

const LASSO_SELECTION: Selection = {
  id: 'sel-1',
  geometry: 'polygon',
  sourceTool: 'freehand-lasso',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 4, y: 8, width: 16, height: 24 },
  points: [
    { x: 4, y: 8 },
    { x: 20, y: 8 },
    { x: 20, y: 32 },
  ],
};

/**
 * Clear is no longer a raw `CLEAR_SELECTIONS` reducer action: it is a document
 * edit that appends to history, so a deselect can be undone. The store mock has
 * to carry a live selection for the writer to read — an already-empty document
 * makes Clear a deliberate no-op, which is a different test.
 *
 * The component's contract is to PLAN the append and DISPATCH the plan. Whether
 * the planned `durableEntry` is published is the STORE's decision, made in
 * `StoreContext` against a durable document this mocked store does not have, so
 * it is not asserted here. `id` is a fresh uuid per call, hence
 * `expect.any(String)`.
 *
 * The store mock carries `history`/`historyIndex` so the writer reaches the
 * SUCCESS branch of the append boundary: without them `planHistoryAppend`'s
 * `validateTimeline` evaluates `timeline.entries.some(...)` on `undefined` and
 * THROWS, the writer's `catch` converts that into a fallback dispatch that omits
 * `durableEntry` entirely, and the two dispatches are byte-identical apart from
 * that field — so this pin would keep passing on the failure path and a
 * regression that made the planner throw would leave the file green.
 */
const CLEAR_SELECTION_EDIT = expect.objectContaining({
  type: 'COMMIT_DOCUMENT_EDIT',
  payload: expect.objectContaining({
    historyItem: expect.objectContaining({
      id: expect.any(String),
      actionName: SELECTION_ACTION,
      args: expect.objectContaining({
        previousSelectionState: expect.objectContaining({
          selections: [expect.objectContaining({ id: 'sel-1' })],
          activeSelectionId: 'sel-1',
        }),
        nextSelectionState: { selections: [], activeSelectionId: null },
      }),
    }),
    updates: expect.objectContaining({ selections: [], activeSelectionId: null }),
  }),
});

const setStoreSelections = (selections: Selection[], activeSelectionId: string | null = null) => {
  storeState.selections = selections;
  storeState.activeSelectionId = activeSelectionId;
};

const getModeButton = () => screen.getByRole('button', { name: /^(Fill|Outline)$/ });
const getCopyButton = () => screen.getByRole('button', { name: 'Copy' });
const getPasteButton = () => screen.getByRole('button', { name: 'Paste' });
const getClearButton = () => screen.getByRole('button', { name: 'Clear' });

describe('FreehandLasso toolbar', () => {
  beforeEach(() => {
    setToolArgsResult(false);
    setSelectionState();
    setStoreSelections([]);
    mockPatchToolArgs.mockClear();
    mockDispatch.mockClear();
    clipboardMocks.copyActiveSelection.mockClear();
    clipboardMocks.pasteSelectionClipboard.mockClear();
  });

  it('renders nothing when the active tool args are not the freehand lasso', () => {
    getToolArgsResult.value = null;
    const { container } = render(<FreehandLasso />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows Outline as the default mode label and no active styling', () => {
    render(<FreehandLasso />);

    expect(getModeButton()).toHaveTextContent('Outline');
    expect(getModeButton().className).not.toContain('bg-blue-500');
  });

  it('shows Fill and the active styling when the tool args request fill', () => {
    setToolArgsResult(true);
    render(<FreehandLasso />);

    expect(getModeButton()).toHaveTextContent('Fill');
    expect(getModeButton().className).toContain('bg-blue-500');
  });

  it('patches only the fill flag when switching to fill', () => {
    render(<FreehandLasso />);

    fireEvent.click(getModeButton());

    expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
    expect(mockPatchToolArgs).toHaveBeenCalledWith('freehand-lasso', { fill: true });
  });

  it('patches only the fill flag when switching back to outline', () => {
    setToolArgsResult(true);
    render(<FreehandLasso />);

    fireEvent.click(getModeButton());

    expect(mockPatchToolArgs).toHaveBeenCalledWith('freehand-lasso', { fill: false });
  });

  it('disables copy and clear for a rectangle selection and enables paste only with a clipboard', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'rectangle' }, hasClipboard: true });
    render(<FreehandLasso />);

    expect(getCopyButton()).toBeDisabled();
    expect(getClearButton()).toBeDisabled();
    expect(getPasteButton()).toBeEnabled();
  });

  it('disables copy, paste, and clear when there is no active selection and no clipboard', () => {
    render(<FreehandLasso />);

    expect(getCopyButton()).toBeDisabled();
    expect(getPasteButton()).toBeDisabled();
    expect(getClearButton()).toBeDisabled();
  });

  it('enables copy and clear for a polygon selection', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' } });
    render(<FreehandLasso />);

    expect(getCopyButton()).toBeEnabled();
    expect(getClearButton()).toBeEnabled();
    expect(getPasteButton()).toBeDisabled();
  });

  it('enables copy and clear for a freehand selection', () => {
    setSelectionState({ activeSelection: { id: 'sel-2', geometry: 'freehand' } });
    render(<FreehandLasso />);

    expect(getCopyButton()).toBeEnabled();
    expect(getClearButton()).toBeEnabled();
  });

  it('copies the active polygon selection and reports success without alerting', () => {
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // `restoreMocks` is off, and the only global `afterEach` is `cleanup()` plus
    // `useRealTimers()`, so a red assertion here used to leave `window.alert` and
    // `console.error` mocked for every test after it in the file.
    try {
      const activeSelection = { id: 'sel-1', geometry: 'polygon' };
      setSelectionState({ activeSelection });
      render(<FreehandLasso />);

      fireEvent.click(getCopyButton());

      expect(clipboardMocks.copyActiveSelection).toHaveBeenCalledWith(activeSelection);
      expect(alertSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('surfaces a copy failure to the user and keeps the toolbar usable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});

    // Same reason as the test above: the restore has to run whatever the assertions do. The
    // `mockReset` is the part the two spies alone do not cover — `beforeEach` and the global
    // `clearMocks` both use `mockClear`, which clears call history but leaves the `once` queue
    // intact, so a `render` or `fireEvent` that threw before the click below would leave a
    // throwing implementation armed for the next test that copies.
    try {
      setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' } });
      clipboardMocks.copyActiveSelection.mockImplementationOnce(() => {
        throw new Error('clipboard unavailable');
      });
      render(<FreehandLasso />);

      fireEvent.click(getCopyButton());

      expect(errorSpy).toHaveBeenCalledWith('Error copying freehand lasso selection:', expect.any(Error));
      expect(alertSpy).toHaveBeenCalledWith('Failed to copy selection');
      // The transient copying state must be released even when the copy throws.
      expect(getCopyButton()).toBeEnabled();
      expect(getCopyButton()).toHaveTextContent('Copy');
    } finally {
      clipboardMocks.copyActiveSelection.mockReset();
      alertSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('pastes the selection clipboard', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' }, hasClipboard: true });
    render(<FreehandLasso />);

    fireEvent.click(getPasteButton());

    expect(clipboardMocks.pasteSelectionClipboard).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('appends a selection history entry from the clear button', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' } });
    setStoreSelections([LASSO_SELECTION], LASSO_SELECTION.id);
    render(<FreehandLasso />);

    fireEvent.click(getClearButton());

    expect(mockDispatch).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
  });

  it("dispatches the planned durable entry, not the writer's failure fallback", () => {
    // The one assertion that makes this file's silence elsewhere mean something.
    // `CLEAR_SELECTION_EDIT` above deliberately never matches `durableEntry`,
    // because whether the plan is PUBLISHED is the store's decision — but the
    // plan being DISPATCHED is the writer's, and only the success branch carries
    // one. The two dispatches are byte-identical apart from this field, so
    // without this assertion a regression that made `planHistoryAppend` throw
    // would leave every Clear pin in this file green while the durable shadow
    // silently stopped being patched.
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' } });
    setStoreSelections([LASSO_SELECTION], LASSO_SELECTION.id);
    render(<FreehandLasso />);

    fireEvent.click(getClearButton());

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          durableEntry: expect.objectContaining({
            id: expect.any(String),
            operation: expect.objectContaining({ kind: 'set-selection' }),
          }),
        }),
      })
    );
  });

  it('documents the draw interaction for the user', () => {
    render(<FreehandLasso />);

    expect(screen.getByText('Click and drag to draw • Release to finish')).toBeInTheDocument();
    expect(screen.getByText('Drag around the object; the path closes automatically.')).toBeInTheDocument();
  });
});

describe('FreehandLasso Mode toggle accessibility', () => {
  beforeEach(() => {
    setToolArgsResult(false);
    mockPatchToolArgs.mockClear();
    setSelectionState();
    setStoreSelections([]);
  });

  it('signals the Mode toggle only by swapping the label text and the CSS class (FreehandLasso.tsx:47-59)', () => {
    render(<FreehandLasso />);

    const button = getModeButton();
    expect(button).toHaveTextContent('Outline');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button).not.toHaveAttribute('role', 'switch');
    expect(button.className).not.toContain('bg-blue-500');
  });

  it('keeps aria-pressed absent in the fill state too (FreehandLasso.tsx:47-59)', () => {
    setToolArgsResult(true);
    render(<FreehandLasso />);

    const button = getModeButton();
    expect(button).toHaveTextContent('Fill');
    expect(button.className).toContain('bg-blue-500');
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it.fails('reports the Mode toggle through aria-pressed (FreehandLasso.tsx:47-59)', () => {
    render(<FreehandLasso />);

    expect(getModeButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it.fails('labels the Mode group for assistive technology (FreehandLasso.tsx:46)', () => {
    render(<FreehandLasso />);

    expect(screen.getByRole('group', { name: /mode/i })).toBeInTheDocument();
  });
});
