import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryControls from '../HistoryControls.tsx';
import { claimDocumentGesture, isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

const history = vi.hoisted(() => ({
  canUndo: vi.fn(() => false),
  undo: vi.fn(),
  canRedo: vi.fn(() => false),
  redo: vi.fn(),
}));

vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));

function undoButton() {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
}

function redoButton() {
  return screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  history.canUndo.mockReturnValue(false);
  history.canRedo.mockReturnValue(false);
  // The gesture slot is module-level and outlives every mount, so a case that
  // leaked a claim would refuse every later click in this file and a failure in
  // one case would read as a failure in all of them. Cleared on the way in AND
  // on the way out; a case below pins that the reset actually does it.
  resetDocumentGestures();
});

afterEach(() => {
  resetDocumentGestures();
});

describe('HistoryControls rendering', () => {
  it('renders undo and redo buttons with accessible names', () => {
    render(<HistoryControls />);

    expect(undoButton()).toBeInTheDocument();
    expect(redoButton()).toBeInTheDocument();
    expect(screen.getByTestId('history-controls')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('exposes the same names through the title attributes', () => {
    render(<HistoryControls />);

    expect(screen.getByTitle('Undo')).toBe(undoButton());
    expect(screen.getByTitle('Redo')).toBe(redoButton());
  });

  it('renders the undo and redo glyphs', () => {
    render(<HistoryControls />);

    expect(undoButton()).toHaveTextContent('↩️');
    expect(redoButton()).toHaveTextContent('↪️');
  });
});

describe('HistoryControls disabled truth table', () => {
  // Every combination of the two availability flags, so the buttons cannot be wired to one flag
  // where they mean the other. The second row is the regression this table exists for: a redo
  // button that enables itself from `canUndo` would pass every other row.
  it.each([
    { canUndo: false, canRedo: false, undoDisabled: true, redoDisabled: true },
    { canUndo: true, canRedo: false, undoDisabled: false, redoDisabled: true },
    { canUndo: false, canRedo: true, undoDisabled: true, redoDisabled: false },
    { canUndo: true, canRedo: true, undoDisabled: false, redoDisabled: false },
  ])(
    'canUndo=$canUndo canRedo=$canRedo -> undo disabled=$undoDisabled redo disabled=$redoDisabled',
    ({ canUndo, canRedo, undoDisabled, redoDisabled }) => {
      history.canUndo.mockReturnValue(canUndo);
      history.canRedo.mockReturnValue(canRedo);
      render(<HistoryControls />);

      expect(undoButton().disabled).toBe(undoDisabled);
      expect(redoButton().disabled).toBe(redoDisabled);
    }
  );
});

describe('HistoryControls undo dispatch', () => {
  it('undoes history when the history allows it', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it('does not undo while the button is disabled, because the disabled attribute is the only guard', () => {
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(undoButton().disabled).toBe(true);
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('undoes on repeated clicks', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(undoButton());
    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(2);
  });

  it('follows the history availability across a re-render', () => {
    history.canUndo.mockReturnValue(false);
    const { rerender } = render(<HistoryControls />);
    fireEvent.click(undoButton());
    expect(history.undo).not.toHaveBeenCalled();

    history.canUndo.mockReturnValue(true);
    rerender(<HistoryControls />);
    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
  });
});

describe('HistoryControls redo dispatch', () => {
  it('redoes through the history context when redo is available', () => {
    history.canRedo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(redoButton());

    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('does nothing while redo is unavailable', () => {
    history.canRedo.mockReturnValue(false);
    render(<HistoryControls />);

    fireEvent.click(redoButton());

    expect(history.redo).not.toHaveBeenCalled();
  });

  // No test here makes `redo` throw. React 19 catches a throwing discrete event handler and
  // re-reports it on `window.onerror` instead of propagating it out of `fireEvent.click`, so
  // the only way to observe it is a global `error` listener — and `event.preventDefault()`
  // does not stop Vitest from recording it as an unhandled error ("This might cause false
  // positive tests"). Whether the throw reaches `window` is React/jsdom behaviour, not a
  // `HistoryControls` invariant: the component wires `onClick={redo}` with no error handling
  // of its own, so there is nothing here to pin.
});

/**
 * The keyboard gate (`useKeyboardEvents.tsx:134`) refused document-mutating
 * shortcuts while a pointer gesture owned the document, and the buttons were
 * never covered. They dispatch the same replay, and inside that window the
 * replay is destructive: `undo`/`redo` replays `selections` from the SAME
 * `history` array, so `history.length` never moves and the pending commit's
 * `entries.slice(0, cursor + 1)` truncates the redo tail with no other symptom.
 * A single pointer cannot hit it — the pointer is captured by the tool area — so
 * the window is reachable only by a second pointer, which is why this is a
 * coverage gap rather than an easy hit.
 *
 * The refusal belongs in these handlers, at the input layer: no dispatch, so
 * nothing appends, so nothing truncates. It deliberately does NOT come from the
 * `disabled` attribute either way — every case below claims the gesture AFTER
 * render, and `disabled` is read at render time, so a render-time read could not
 * see the claim at all.
 */
describe('HistoryControls document gesture gate', () => {
  it('refuses undo while a document gesture is open, because the release-time commit would truncate the redo tail', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);
    claimDocumentGesture('layer-transform', 1);

    fireEvent.click(undoButton());

    // The button is enabled, so this is the handler refusing and not the
    // attribute: a disabled button would make the assertion below vacuous.
    expect(undoButton().disabled).toBe(false);
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('refuses redo while a document gesture is open, for the same reason', () => {
    history.canRedo.mockReturnValue(true);
    render(<HistoryControls />);
    claimDocumentGesture('rectangular-selection', 2);

    fireEvent.click(redoButton());

    expect(redoButton().disabled).toBe(false);
    expect(history.redo).not.toHaveBeenCalled();
  });

  it('undoes with no gesture open, so the gate refuses only while a gesture owns the document', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it('redoes with no gesture open, so the gate refuses only while a gesture owns the document', () => {
    history.canRedo.mockReturnValue(true);
    render(<HistoryControls />);
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(redoButton());

    expect(history.redo).toHaveBeenCalledTimes(1);
  });

  it('undoes again once resetDocumentGestures drops the claim, so the gate is a window and not a latch', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    claimDocumentGesture('brush-stroke', 3);
    fireEvent.click(undoButton());
    expect(history.undo).not.toHaveBeenCalled();

    resetDocumentGestures();
    expect(isDocumentGestureOpen()).toBe(false);
    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
  });
});
