import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryControls from '../HistoryControls.tsx';

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
