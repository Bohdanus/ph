import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryControls from '../../HistoryControls/HistoryControls.tsx';
import UndoButton from '../UndoButton.tsx';
import { AppKeyboardShortcuts } from '../AppKeyboardShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';

const state = vi.hoisted(() => ({ isToolDirty: false, hasImage: true }));
const history = vi.hoisted(() => ({
  canUndo: vi.fn(),
  undo: vi.fn(),
  canRedo: vi.fn(),
  redo: vi.fn(),
}));
const resetToLastSavedArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ isToolDirty: state.isToolDirty, resetToLastSavedArgs }),
}));
vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [state] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => ({ goToTool: vi.fn() }) }));
vi.mock('../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({ copyActiveSelection: vi.fn(), pasteSelectionClipboard: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.isToolDirty = false;
  state.hasImage = true;
  history.canUndo.mockReturnValue(false);
  history.canRedo.mockReturnValue(false);
});

describe.each(['header', 'tool', 'keyboard'] as const)('%s undo', (entryPoint) => {
  function controls() {
    if (entryPoint === 'header') return <HistoryControls />;
    if (entryPoint === 'tool') return <UndoButton />;
    return (
      <KeyboardEventsProvider>
        <AppKeyboardShortcuts />
      </KeyboardEventsProvider>
    );
  }

  function triggerUndo() {
    if (entryPoint === 'keyboard') {
      fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    } else {
      fireEvent.click(screen.getByRole('button', { name: entryPoint === 'header' ? 'Undo' : 'Reset' }));
    }
  }

  it.each([false, true])('resets a dirty tool without undoing history (canUndo=%s)', (canUndo) => {
    state.isToolDirty = true;
    history.canUndo.mockReturnValue(canUndo);
    render(controls());

    triggerUndo();

    expect(resetToLastSavedArgs).toHaveBeenCalledExactlyOnceWith();
    expect(history.undo).not.toHaveBeenCalled();
  });

  it('undoes history when the tool is clean', () => {
    history.canUndo.mockReturnValue(true);
    render(controls());

    triggerUndo();

    expect(history.undo).toHaveBeenCalledTimes(1);
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('does nothing when the tool is clean and history cannot undo', () => {
    render(controls());

    if (entryPoint !== 'keyboard') {
      expect(
        (screen.getByRole('button', { name: entryPoint === 'header' ? 'Undo' : 'Reset' }) as HTMLButtonElement).disabled
      ).toBe(true);
    }
    triggerUndo();

    expect(history.undo).not.toHaveBeenCalled();
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });

  it('undoes history on the next invocation after the tool becomes clean', () => {
    state.isToolDirty = true;
    history.canUndo.mockReturnValue(true);
    const { rerender } = render(controls());
    triggerUndo();

    state.isToolDirty = false;
    rerender(controls());
    triggerUndo();

    expect(resetToLastSavedArgs).toHaveBeenCalledTimes(1);
    expect(history.undo).toHaveBeenCalledTimes(1);
  });
});

describe('header redo', () => {
  it('keeps redo availability independent of dirty tool state', () => {
    state.isToolDirty = true;
    const { rerender } = render(<HistoryControls />);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);

    history.canRedo.mockReturnValue(true);
    rerender(<HistoryControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(history.redo).toHaveBeenCalledTimes(1);
    expect(resetToLastSavedArgs).not.toHaveBeenCalled();
  });
});
