import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Selection } from '../../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../../util/constants.ts';
import RectangularSelection from '../RectangularSelection.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const hasSelectionClipboard = vi.hoisted(() => ({ current: true }));

const storeState = vi.hoisted((): { selections: Selection[]; activeSelectionId: string | null } => ({
  selections: [],
  activeSelectionId: null,
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      totalSize: { width: 800, height: 600 },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
      // An empty timeline at cursor -1 is what a store with nothing appended yet
      // actually looks like, and it is what puts the Deselect writer on the append
      // boundary's SUCCESS branch: `history`/`historyIndex` go straight into the
      // planner's `timeline`, `validateTimeline` reports the out-of-range cursor
      // as a diagnostic instead of throwing on `undefined`, and the writer
      // dispatches the plan it made. Without them the writer's `catch` produces a
      // byte-identical dispatch with no `durableEntry`, and every pin below would
      // pass on that fallback instead. `branchRevision` is the hook's own default,
      // included for shape parity.
      history: [] as unknown[],
      historyIndex: -1,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    copyActiveSelection: copyActiveSelectionMock,
    hasSelectionClipboard: hasSelectionClipboard.current,
    pasteSelectionClipboard: pasteSelectionClipboardMock,
  }),
}));

function resetStoreState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    selections: [],
    activeSelectionId: null,
    ...overrides,
  });
}

/**
 * Deselect is no longer a raw `CLEAR_SELECTIONS` reducer action: it is a document
 * edit that appends to history, so a deselect can be undone. The contract is one
 * `COMMIT_DOCUMENT_EDIT` carrying both the history item and the resulting
 * selection state.
 *
 * The component's contract is to PLAN the append and DISPATCH the plan. Whether
 * the planned `durableEntry` is published is the STORE's decision, made in
 * `StoreContext` against a durable document this mocked store does not have, so
 * it is not asserted here. `id` is a fresh uuid per call, hence
 * `expect.any(String)`.
 *
 * The store mock below carries `history`/`historyIndex` so the writer reaches the
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
          selections: [expect.objectContaining({ id: 'selection-1' })],
          activeSelectionId: 'selection-1',
        }),
        nextSelectionState: { selections: [], activeSelectionId: null },
      }),
    }),
    updates: expect.objectContaining({ selections: [], activeSelectionId: null }),
  }),
});

describe('RectangularSelection toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    copyActiveSelectionMock.mockClear();
    // The real hook returns `true` on success (`useSelectionClipboard.ts:61`), and the component
    // now READS that boolean. Left at the `undefined` a bare `vi.fn()` returns, a click here
    // would look exactly like a refused copy, so the default has to be the success value —
    // otherwise every test that copies without asking for a return value reports a failure
    // that never happened.
    copyActiveSelectionMock.mockReturnValue(true);
    pasteSelectionClipboardMock.mockClear();
    hasSelectionClipboard.current = true;
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
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
      },
    ];
  });

  it('copies the active committed rectangular selection from store state', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // `restoreMocks` is off, and the only global `afterEach` is `cleanup()` plus
    // `useRealTimers()`, so a red assertion here would leave `console.error` mocked for every test
    // after it in the file.
    try {
      render(<RectangularSelection />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await waitFor(() => {
        expect(copyActiveSelectionMock).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'selection-1',
            geometry: 'rectangle',
          })
        );
      });
      // A copy that succeeded reports nothing, so a bar that logged on the happy path would be
      // indistinguishable from one that only learned to log at all.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('reports a copy that returns false, which is not the throwing path', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Same reason as the test above: the restore has to run whatever the assertions do.
    try {
      // A REFUSAL, not a throw: `copySelection` returns `false` when there is no snapshot to take
      // (`useSelectionClipboard.ts:46`) and never reaches a `catch`, so the only way out of the
      // silent path is the component reading the boolean itself. The
      // `if (!activeRectangleSelection || !activeRectangleRect)` guard above it is why this case —
      // and only this case — is reportable from here: nothing selected is not a copy failure, and
      // the button is disabled for it anyway.
      copyActiveSelectionMock.mockReturnValueOnce(false);
      render(<RectangularSelection />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      expect(errorSpy).toHaveBeenCalledWith('Failed to copy rectangular selection');
      // The refusal still reached the clipboard hook; only the outcome went unreported.
      expect(copyActiveSelectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'selection-1', geometry: 'rectangle' })
      );
    } finally {
      copyActiveSelectionMock.mockReset();
      errorSpy.mockRestore();
    }
  });

  it('pastes the in-app copied selection as a new layer', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
  });

  it('clears committed selections as one undoable document edit', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));

    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
  });

  it('disables Copy when no active selection', () => {
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('disables Paste when clipboard is empty', () => {
    hasSelectionClipboard.current = false;
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
  });

  it('enables Paste when clipboard has data', () => {
    hasSelectionClipboard.current = true;
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Paste' })).not.toBeDisabled();
  });

  it('does not call copyActiveSelection when no active selection', () => {
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copyActiveSelectionMock).not.toHaveBeenCalled();
  });

  it('appends a selection history entry when Deselect clicked', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));

    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
  });

  describe('active selection resolution', () => {
    const POLYGON_SELECTION: Selection = {
      id: 'selection-polygon-1',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
      lifecycle: 'committed',
      isActive: true,
      pos: { x: 0, y: 0, width: 10, height: 10 },
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };

    it('disables Copy and Deselect when the active selection is not a rectangle', () => {
      resetStoreState({ activeSelectionId: POLYGON_SELECTION.id, selections: [POLYGON_SELECTION] });
      render(<RectangularSelection />);

      // `getActiveRectangularSelection` (src/util/selection.ts:111-118) returns null for any
      // non-rectangle geometry, so a lasso selection cannot be copied from this toolbar.
      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();
    });

    it('falls back to the flagged selection when the active id is null', () => {
      resetStoreState({ activeSelectionId: null, selections: storeState.selections });
      render(<RectangularSelection />);

      // `getActiveSelection` falls back to the first `isActive` selection.
      expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    });

    it('ignores an active id that no longer resolves', () => {
      resetStoreState({ activeSelectionId: 'deleted', selections: [] });
      render(<RectangularSelection />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();
    });

    it('treats a rectangle without a lifecycle flag as copyable (RectangularSelection.tsx:11-13)', () => {
      // `Selection.lifecycle` is optional and only ever set to `'committed'`
      // (src/contexts/general-types.ts:66), and `getActiveRectangularSelection` filters on
      // geometry alone, so a selection that has not been committed yet still enables Copy.
      // Documented rather than fixed: the toolbar has no lifecycle input of its own.
      const uncommitted = { ...(storeState.selections[0] as Selection) } as Selection;
      delete uncommitted.lifecycle;
      resetStoreState({ activeSelectionId: uncommitted.id, selections: [uncommitted] });
      render(<RectangularSelection />);

      expect(uncommitted.lifecycle).toBeUndefined();
      expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    });

    it('treats a zero-area rectangle as copyable (RectangularSelection.tsx:12-13)', () => {
      const degenerate: Selection = {
        ...(storeState.selections[0] as Selection),
        pos: { x: 5, y: 5, width: 0, height: 0 },
      };
      resetStoreState({ activeSelectionId: degenerate.id, selections: [degenerate] });
      render(<RectangularSelection />);

      // `hasRect` is a truthiness check on the rect object, not on its area.
      expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeEnabled();
    });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', async () => {
      const user = userEvent.setup();
      render(<RectangularSelection />);

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Deselect' });

      copyButton.focus();
      expect(copyButton).toHaveFocus();

      await user.tab();
      expect(pasteButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);

      await user.tab({ shift: true });
      expect(clearButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(pasteButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(copyButton).toHaveFocus();
    });

    it('allows enter/space to trigger copy, paste, and clear buttons', async () => {
      const user = userEvent.setup();
      render(<RectangularSelection />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Deselect' });

      copyButton.focus();
      expect(copyButton).toHaveFocus();
      await user.keyboard('{Enter}');

      pasteButton.focus();
      expect(pasteButton).toHaveFocus();
      await user.keyboard(' ');

      clearButton.focus();
      expect(clearButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(copyActiveSelectionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'selection-1' }));
      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<RectangularSelection />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });

      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: 'Escape' });
      expect(copyButton).toHaveFocus();
    });

    it('disabled buttons are not focusable via tab when disabled', async () => {
      hasSelectionClipboard.current = false;
      const user = userEvent.setup();
      render(<RectangularSelection />);

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Deselect' });

      expect(copyButton).not.toBeDisabled();
      expect(clearButton).not.toBeDisabled();
      expect(pasteButton).toBeDisabled();

      pasteButton.focus();
      expect(pasteButton).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);

      copyButton.focus();
      expect(copyButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);

      await user.tab({ shift: true });
      expect(clearButton).toHaveFocus();

      cleanup();
      hasSelectionClipboard.current = false;
      resetStoreState({ activeSelectionId: null, selections: [] });
      render(<RectangularSelection />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();

      await user.tab();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
