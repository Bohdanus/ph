import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../util/constants.ts';
import SingleRowColumnMarquee from '../SingleRowColumnMarquee/SingleRowColumnMarquee.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const hasSelectionClipboard = vi.hoisted(() => ({ current: true }));

const storeState = vi.hoisted((): { toolName: string; selections: Selection[]; activeSelectionId: string | null } => ({
  toolName: 'single-row-marquee',
  selections: [],
  activeSelectionId: null,
}));

/**
 * `history`/`historyIndex` are here so Clear's writer reaches the SUCCESS branch of the
 * append boundary: with them absent, `planHistoryAppend` throws and the writer re-dispatches
 * a byte-identical fallback action minus the durable entry, which every pin below would pass
 * on while proving nothing about the planner.
 */
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      totalSize: { width: 200, height: 120 },
      get toolName() {
        return storeState.toolName;
      },
      get selections() {
        return storeState.selections;
      },
      get activeSelectionId() {
        return storeState.activeSelectionId;
      },
      history: [] as unknown[],
      historyIndex: -1,
      branchRevision: 0,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    copyActiveSelection: copyActiveSelectionMock,
    hasSelectionClipboard: hasSelectionClipboard.current,
    pasteSelectionClipboard: pasteSelectionClipboardMock,
  }),
}));

/** A committed 1-pixel row band: the shape a single row actually takes. */
const rowBand = (): Selection => ({
  id: 'band-1',
  isActive: true,
  geometry: 'rectangle',
  sourceTool: 'rectangular-selection',
  lifecycle: 'committed',
  pos: { x: 0, y: 40, width: 200, height: 1 },
  points: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 1 },
    { x: 0, y: 1 },
  ],
});

function resetStoreState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, { toolName: 'single-row-marquee', selections: [], activeSelectionId: null, ...overrides });
}

describe('SingleRowColumnMarquee toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    copyActiveSelectionMock.mockClear();
    // The real hook returns `true` on success, and the bar reads that boolean. Left at the
    // `undefined` a bare `vi.fn()` returns, a successful copy would look exactly like a
    // refused one and every click case would report a failure that never happened.
    copyActiveSelectionMock.mockReturnValue(true);
    pasteSelectionClipboardMock.mockClear();
    hasSelectionClipboard.current = true;
    resetStoreState({ activeSelectionId: 'band-1', selections: [rowBand()] });
  });

  it('says "row" under the row tool', () => {
    resetStoreState({ toolName: 'single-row-marquee' });
    render(<SingleRowColumnMarquee />);

    expect(screen.getByText(/select one row,/)).toBeInTheDocument();
    // The negative half: the bar is shared by two tools, so "column" is a word this render
    // must not contain, and finding it would mean the sentence is not tool-specific at all.
    expect(screen.queryByText(/select one column,/)).toBeNull();
  });

  it('says "column" under the column tool, and nothing else in the sentence changes', () => {
    resetStoreState({ toolName: 'single-column-marquee' });
    render(<SingleRowColumnMarquee />);

    expect(screen.getByText(/select one column,/)).toBeInTheDocument();
    expect(screen.queryByText(/select one row,/)).toBeNull();
  });

  it('disables Copy with no active selection, and enables it with one', () => {
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<SingleRowColumnMarquee />);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();

    cleanup();

    resetStoreState({ activeSelectionId: 'band-1', selections: [rowBand()] });
    render(<SingleRowColumnMarquee />);

    // The same two mounts and the same bar: the button's state tracks the selection rather
    // than the bar being permanently on or permanently off.
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('copies the committed band itself, not the document and not nothing', () => {
    render(<SingleRowColumnMarquee />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    // The bar hands the store's own committed selection to the clipboard hook rather than a
    // rebuilt one, so the argument is pinned by identity: a `pos: RectXYSorted` is not a
    // `pos`, and any re-derivation on the way to the hook would be a different object.
    expect(copyActiveSelectionMock).toHaveBeenCalledExactlyOnceWith(storeState.selections[0]);
    expect(copyActiveSelectionMock.mock.calls[0][0]).toBe(storeState.selections[0]);
  });

  it('reports a refused copy in a sentence that names the tool the user is holding', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      copyActiveSelectionMock.mockReturnValueOnce(false);
      resetStoreState({
        toolName: 'single-column-marquee',
        activeSelectionId: 'band-1',
        selections: [rowBand()],
      });
      render(<SingleRowColumnMarquee />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      // A second read of the tool name, on the failure path this time: a bar that reported
      // "single row" while the column tool was loaded would send the operator looking for
      // the wrong tool.
      expect(errorSpy).toHaveBeenCalledWith('Failed to copy single column selection');
    } finally {
      copyActiveSelectionMock.mockReset();
      errorSpy.mockRestore();
    }
  });

  it('clears the band as one undoable document edit', () => {
    render(<SingleRowColumnMarquee />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          historyItem: expect.objectContaining({ actionName: SELECTION_ACTION }),
          updates: expect.objectContaining({ selections: [], activeSelectionId: null }),
        }),
      })
    );
  });

  it('pastes the in-app copied band as a new layer', () => {
    render(<SingleRowColumnMarquee />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
  });

  it('disables Paste with an empty clipboard, and Clear with no selection', () => {
    hasSelectionClipboard.current = false;
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<SingleRowColumnMarquee />);

    expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
