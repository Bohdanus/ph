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
 * Clear is no longer a raw `CLEAR_SELECTIONS` reducer action: it is a document
 * edit that appends to history, so a deselect can be undone. The contract is one
 * `COMMIT_DOCUMENT_EDIT` carrying both the history item and the resulting
 * selection state.
 *
 * `durableEntry` is deliberately not matched. The store publishes the planned
 * entry only when its durable document still describes the timeline the plan was
 * made against, and the boundary's failure fallback omits it entirely; both are
 * correct, so the pin asserts the contract the two paths share. `id` is a fresh
 * uuid per call, hence `expect.any(String)`.
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
  });

  it('pastes the in-app copied selection as a new layer', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
  });

  it('clears committed selections as one undoable document edit', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

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

  it('appends a selection history entry when Clear clicked', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

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

    it('disables Copy and Clear when the active selection is not a rectangle', () => {
      resetStoreState({ activeSelectionId: POLYGON_SELECTION.id, selections: [POLYGON_SELECTION] });
      render(<RectangularSelection />);

      // `getActiveRectangularSelection` (src/util/selection.ts:111-118) returns null for any
      // non-rectangle geometry, so a lasso selection cannot be copied from this toolbar.
      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
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
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
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
      expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', async () => {
      const user = userEvent.setup();
      render(<RectangularSelection />);

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

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
      const clearButton = screen.getByRole('button', { name: 'Clear' });

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
      const clearButton = screen.getByRole('button', { name: 'Clear' });

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
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

      await user.tab();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
