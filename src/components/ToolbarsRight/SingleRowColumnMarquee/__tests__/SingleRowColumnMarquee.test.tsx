import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import SingleRowColumnMarquee from '../SingleRowColumnMarquee.tsx';
import type { Selection } from '../../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../../util/constants.ts';

const dispatchMock = vi.hoisted(() => vi.fn());
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const hasSelectionClipboard = vi.hoisted(() => ({ current: true }));

const storeState = vi.hoisted(
  (): {
    toolName: 'single-row-marquee' | 'single-column-marquee';
    selections: Selection[];
    activeSelectionId: string | null;
  } => ({ toolName: 'single-row-marquee', selections: [], activeSelectionId: null })
);

/**
 * `toolName` is a GETTER, not a copied property: this bar is one component for BOTH tools and
 * tells them apart by reading the store, so a case that switches tools has to switch the value the
 * store actually returns rather than re-mock the module.
 */
vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      get toolName() {
        return storeState.toolName;
      },
      get selections() {
        return storeState.selections;
      },
      get activeSelectionId() {
        return storeState.activeSelectionId;
      },
      canvasRef: { current: document.createElement('canvas') },
      totalSize: { width: 800, height: 600 },
      // An empty timeline at cursor -1 is what a store with nothing appended yet actually looks
      // like, and it is what puts the Deselect writer on the append boundary's SUCCESS branch:
      // without `history`/`historyIndex` the planner throws, the writer's `catch` produces a
      // dispatch with no `durableEntry`, and every pin below would be passing on that fallback.
      history: [] as unknown[],
      historyIndex: -1,
      branchRevision: 0,
      selectionCleared: 0,
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

/** A committed 1-pixel row band, the selection this bar's tools actually produce. */
const BAND: Selection = {
  id: 'selection-1',
  geometry: 'rectangle',
  sourceTool: 'rectangular-selection',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 0, y: 120, width: 800, height: 1 },
  points: [
    { x: 0, y: 0 },
    { x: 800, y: 0 },
    { x: 800, y: 1 },
    { x: 0, y: 1 },
  ],
};

/**
 * Deselect is no longer a raw `CLEAR_SELECTIONS` reducer action: it is a document edit that appends
 * to history, so a deselect can be undone. The contract is one `COMMIT_DOCUMENT_EDIT` carrying
 * both the history item and the resulting selection state.
 *
 * `durableEntry` is deliberately not part of the pin: the store publishes the planned entry only
 * when its durable document still describes the timeline the plan was made against, and the
 * boundary's failure fallback omits it entirely — both are correct, so the pin asserts the
 * contract the two paths share. `id` is a fresh uuid per call.
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

describe('SingleRowColumnMarquee toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    copyActiveSelectionMock.mockClear();
    // The real hook returns `true` on success, and this bar READS that boolean. Left at the
    // `undefined` a bare `vi.fn()` returns, a click here would look exactly like a refused copy.
    copyActiveSelectionMock.mockReturnValue(true);
    pasteSelectionClipboardMock.mockClear();
    hasSelectionClipboard.current = true;
    storeState.toolName = 'single-row-marquee';
    storeState.selections = [{ ...BAND }];
    storeState.activeSelectionId = 'selection-1';
  });

  describe('the control set Adobe scopes to other tools', () => {
    it('carries no Style, no Width/Height and no Anti-alias, because Adobe names the other two tools', () => {
      // Adobe scopes Style, Fixed Ratio and Fixed Size to the Rectangular and Elliptical
      // Marquees BY NAME, and Anti-alias to the Elliptical Marquee. So a slider here would have no
      // spec behind it, and the bar is exactly three buttons and a sentence.
      const { container } = render(<SingleRowColumnMarquee />);

      expect(container.querySelectorAll('button')).toHaveLength(3);
      expect(container.querySelectorAll('input')).toHaveLength(0);
      expect(container.querySelectorAll('select')).toHaveLength(0);
      expect(screen.queryByLabelText(/Style/i)).toBeNull();
      expect(screen.queryByLabelText(/Width/i)).toBeNull();
      expect(screen.queryByLabelText(/Height/i)).toBeNull();
      expect(screen.queryByLabelText(/Anti-alias/i)).toBeNull();
      expect(screen.queryByLabelText(/Feather/i)).toBeNull();
    });

    it('carries no New / Add / Subtract / Intersect, because no selection tool in this app has them', () => {
      render(<SingleRowColumnMarquee />);

      // The selection combination modes are absent for EVERY selection tool here, so shipping
      // them for the two newest ones and not for the other five would be a worse inconsistency
      // than the one that exists.
      expect(screen.queryByRole('button', { name: /New/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Add/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Subtract/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Intersect/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Select and Mask/i })).toBeNull();
    });

    it('tells the two tools apart by the one word they differ in', () => {
      const { container, rerender } = render(<SingleRowColumnMarquee />);

      // The sentence names all three things the gesture does, because the third is the one a
      // user cannot discover: a band is a ONE-PIXEL hit target, so clicking the row already on the
      // canvas MOVES it rather than selecting a new one. A bar that said only "click or drag to
      // select" would misdescribe that — the click the user most expects to place a band is the
      // one that relocates the existing one.
      expect(container.textContent).toContain('Click to select one row');
      expect(container.textContent).toContain('drag to aim it');
      expect(container.textContent).toContain('click the row you already made to move it');

      // Same component, same three buttons — the noun is the whole difference, which is what
      // makes one shared bar a shared control set rather than a merge of two different ones.
      storeState.toolName = 'single-column-marquee';
      rerender(<SingleRowColumnMarquee />);

      expect(container.textContent).toContain('Click to select one column');
      expect(container.textContent).toContain('click the column you already made to move it');
      expect(container.querySelectorAll('button')).toHaveLength(3);
    });
  });

  describe('Copy', () => {
    it('copies the active committed rectangle selection from store state', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // `restoreMocks` is off, so the restore has to run whatever the assertions do or
      // `console.error` stays mocked for every later test in the file.
      try {
        render(<SingleRowColumnMarquee />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(copyActiveSelectionMock).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'selection-1', geometry: 'rectangle' })
          );
        });
        // A copy that succeeded reports nothing, so a bar that logged on the happy path would be
        // indistinguishable from one that only learned to log at all.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('reports a refused copy as "single row" under the row tool', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // A REFUSAL, not a throw: `copySelection` returns `false` when there is no snapshot to take
        // and never reaches a `catch`, so the only way out of the silent path is this bar reading
        // the boolean itself.
        copyActiveSelectionMock.mockReturnValue(false);
        render(<SingleRowColumnMarquee />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(errorSpy).toHaveBeenCalledWith('Failed to copy single row selection');
        });
        // The refusal still reached the clipboard hook; only the outcome went unreported.
        expect(copyActiveSelectionMock).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'selection-1', geometry: 'rectangle' })
        );
      } finally {
        copyActiveSelectionMock.mockReturnValue(true);
        errorSpy.mockRestore();
      }
    });

    it('reports a refused copy as "single column" under the column tool', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // The noun is interpolated, so one shared component produces two distinguishable messages —
        // which is what makes the failure identifiable at all now that both tools share a bar.
        storeState.toolName = 'single-column-marquee';
        copyActiveSelectionMock.mockReturnValue(false);
        render(<SingleRowColumnMarquee />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(errorSpy).toHaveBeenCalledWith('Failed to copy single column selection');
        });
      } finally {
        copyActiveSelectionMock.mockReturnValue(true);
        errorSpy.mockRestore();
      }
    });

    it('is disabled with nothing selected, and calls nothing when clicked anyway', () => {
      storeState.selections = [];
      storeState.activeSelectionId = null;
      render(<SingleRowColumnMarquee />);

      const copy = screen.getByRole('button', { name: 'Copy' });
      expect(copy).toBeDisabled();

      fireEvent.click(copy);
      expect(copyActiveSelectionMock).not.toHaveBeenCalled();
    });

    it('is disabled when the active selection is not a rectangle', () => {
      // `getActiveRectangularSelection` returns null for any non-rectangle geometry, so a lasso
      // selection cannot be copied from this bar.
      storeState.selections = [
        {
          ...BAND,
          id: 'polygon-1',
          geometry: 'polygon',
          sourceTool: 'polygonal-lasso',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ];
      storeState.activeSelectionId = 'polygon-1';
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    });

    it('copies a COLUMN band exactly as it copies a row band, because a band is a rectangle', () => {
      // The committed selection is `geometry: 'rectangle'` for both tools, so the rectangular
      // lookup is the honest one here and not a stand-in — a single column IS a rectangle, one
      // document pixel wide and as tall as the document.
      storeState.toolName = 'single-column-marquee';
      storeState.selections = [
        {
          ...BAND,
          pos: { x: 400, y: 0, width: 1, height: 600 },
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 600 },
            { x: 0, y: 600 },
          ],
        },
      ];
      render(<SingleRowColumnMarquee />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      expect(copyActiveSelectionMock).toHaveBeenCalledWith(
        expect.objectContaining({ pos: { x: 400, y: 0, width: 1, height: 600 } })
      );
    });

    it('falls back to the flagged selection when the active id is null', () => {
      storeState.activeSelectionId = null;
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    });

    it('ignores an active id that no longer resolves', () => {
      storeState.activeSelectionId = 'deleted';
      storeState.selections = [];
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();
    });
  });

  describe('Paste', () => {
    it('pastes the in-app copied selection when the clipboard has data', () => {
      render(<SingleRowColumnMarquee />);

      fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
    });

    it('is disabled when the clipboard is empty', () => {
      hasSelectionClipboard.current = false;
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
    });

    it('is enabled again once the clipboard has data, with nothing selected at all', () => {
      // Paste is gated on the CLIPBOARD and not on the selection: a copied line can be pasted as
      // a new layer after the selection it came from has been cleared, which is the whole reason
      // the two buttons have different gates.
      storeState.selections = [];
      storeState.activeSelectionId = null;
      hasSelectionClipboard.current = true;
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Paste' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
    });
  });

  describe('Deselect', () => {
    it('clears committed selections as one undoable document edit', () => {
      render(<SingleRowColumnMarquee />);

      fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));

      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
    });

    it('is disabled with nothing selected', () => {
      storeState.selections = [];
      storeState.activeSelectionId = null;
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();
    });

    it('treats a zero-area rectangle as clearable, because the gate is the rect object not its area', () => {
      // The gate is `!!activeRectangleRect`, so a degenerate rectangle is still a selection worth
      // clearing. `createCommittedRectangleSelection` can never produce one for these tools — a
      // band is always one pixel thick — but a rectangle from the Rectangular Marquee can share
      // this store, and the bar is shared with nothing about the area.
      storeState.selections = [{ ...BAND, pos: { x: 5, y: 5, width: 0, height: 0 } }];
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Deselect' })).toBeEnabled();
    });

    it('clears the same way for the column tool, because Deselect is not per-tool', () => {
      storeState.toolName = 'single-column-marquee';
      render(<SingleRowColumnMarquee />);

      fireEvent.click(screen.getByRole('button', { name: 'Deselect' }));

      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
    });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all three buttons and back out', async () => {
      const user = userEvent.setup();
      render(<SingleRowColumnMarquee />);

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

    it('allows enter/space to trigger copy, paste and clear', async () => {
      const user = userEvent.setup();
      render(<SingleRowColumnMarquee />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Deselect' });

      copyButton.focus();
      await user.keyboard('{Enter}');

      pasteButton.focus();
      await user.keyboard(' ');

      clearButton.focus();
      await user.keyboard('{Enter}');

      expect(copyActiveSelectionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'selection-1' }));
      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<SingleRowColumnMarquee />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });

      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: 'Escape' });

      expect(copyButton).toHaveFocus();
    });

    it('skips every disabled button in the tab order', async () => {
      hasSelectionClipboard.current = false;
      storeState.selections = [];
      storeState.activeSelectionId = null;
      const user = userEvent.setup();
      render(<SingleRowColumnMarquee />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();

      // Nothing focusable at all: the bar is a sentence and three dead buttons.
      await user.tab();
      expect(document.activeElement).toBe(document.body);
    });
  });

  describe('rendering shape', () => {
    it('mounts for the column tool with no store selection at all, rather than rendering nothing', () => {
      // One bar for two tools, and the tool name never gates the render — a gate would make the
      // bar blank for one of the two tools it exists to serve.
      storeState.toolName = 'single-column-marquee';
      storeState.selections = [];
      storeState.activeSelectionId = null;
      const { container } = render(<SingleRowColumnMarquee />);

      expect(container).not.toBeEmptyDOMElement();
      expect(container.textContent).toContain('one column');
      cleanup();
    });
  });
});
