import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryControls from '../HistoryControls.tsx';

const history = vi.hoisted(() => ({
  canUndo: vi.fn(() => false),
  undo: vi.fn(),
  canRedo: vi.fn(() => false),
  redo: vi.fn(),
}));

const currentTool = vi.hoisted(() => ({
  isToolDirty: false,
  resetToLastSavedArgs: vi.fn(),
}));

vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({ useCurrentTool: () => currentTool }));

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
  currentTool.isToolDirty = false;
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
  it.each([
    { canUndo: false, canRedo: false, isToolDirty: false, undoDisabled: true, redoDisabled: true },
    { canUndo: true, canRedo: false, isToolDirty: false, undoDisabled: false, redoDisabled: true },
    { canUndo: false, canRedo: true, isToolDirty: false, undoDisabled: true, redoDisabled: false },
    { canUndo: true, canRedo: true, isToolDirty: false, undoDisabled: false, redoDisabled: false },
    { canUndo: false, canRedo: false, isToolDirty: true, undoDisabled: false, redoDisabled: true },
    { canUndo: true, canRedo: true, isToolDirty: true, undoDisabled: false, redoDisabled: false },
  ])(
    'canUndo=$canUndo canRedo=$canRedo isToolDirty=$isToolDirty -> undo disabled=$undoDisabled redo disabled=$redoDisabled',
    ({ canUndo, canRedo, isToolDirty, undoDisabled, redoDisabled }) => {
      history.canUndo.mockReturnValue(canUndo);
      history.canRedo.mockReturnValue(canRedo);
      currentTool.isToolDirty = isToolDirty;
      render(<HistoryControls />);

      expect(undoButton().disabled).toBe(undoDisabled);
      expect(redoButton().disabled).toBe(redoDisabled);
    }
  );

  it('never enables redo from a dirty tool alone', () => {
    history.canRedo.mockReturnValue(false);
    currentTool.isToolDirty = true;
    render(<HistoryControls />);

    expect(redoButton().disabled).toBe(true);
  });
});

describe('HistoryControls undo dispatch', () => {
  it('resets the dirty tool instead of undoing history', () => {
    currentTool.isToolDirty = true;
    history.canUndo.mockReturnValue(false);
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(currentTool.resetToLastSavedArgs).toHaveBeenCalledExactlyOnceWith();
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('prefers the dirty-tool reset even when history could undo', () => {
    currentTool.isToolDirty = true;
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(currentTool.resetToLastSavedArgs).toHaveBeenCalledTimes(1);
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('undoes history when the tool is clean and history allows it', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
    expect(currentTool.resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('does not undo while the button is disabled, because the disabled attribute is the only guard', () => {
    render(<HistoryControls />);

    fireEvent.click(undoButton());

    expect(undoButton().disabled).toBe(true);
    expect(history.undo).not.toHaveBeenCalled();
    expect(currentTool.resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('switches to the history undo once the tool becomes clean', () => {
    currentTool.isToolDirty = true;
    history.canUndo.mockReturnValue(true);
    const { rerender } = render(<HistoryControls />);

    fireEvent.click(undoButton());
    expect(currentTool.resetToLastSavedArgs).toHaveBeenCalledTimes(1);

    currentTool.isToolDirty = false;
    rerender(<HistoryControls />);
    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(1);
    expect(currentTool.resetToLastSavedArgs).toHaveBeenCalledTimes(1);
  });

  it('undoes on repeated clicks', () => {
    history.canUndo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(undoButton());
    fireEvent.click(undoButton());

    expect(history.undo).toHaveBeenCalledTimes(2);
  });
});

describe('HistoryControls redo dispatch', () => {
  it('redoes through the history context when redo is available', () => {
    history.canRedo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(redoButton());

    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(history.undo).not.toHaveBeenCalled();
    expect(currentTool.resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('never resets the dirty tool from the redo button', () => {
    currentTool.isToolDirty = true;
    history.canRedo.mockReturnValue(true);
    render(<HistoryControls />);

    fireEvent.click(redoButton());

    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(currentTool.resetToLastSavedArgs).not.toHaveBeenCalled();
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
