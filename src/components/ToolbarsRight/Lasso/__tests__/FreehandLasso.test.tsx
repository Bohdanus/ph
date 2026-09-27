import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FreehandLasso from '../FreehandLasso.tsx';

const getToolArgsResult = vi.hoisted(() => ({
  value: { fill: false, toolName: 'freehand-lasso' } as { fill: boolean; toolName: string } | null,
}));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());

const clipboardState = vi.hoisted(() => ({
  activeSelection: null as { id: string; geometry: string } | null,
  hasSelectionClipboard: false,
}));

const clipboardMocks = vi.hoisted(() => ({
  copyActiveSelection: vi.fn(),
  pasteSelectionClipboard: vi.fn(),
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{}, mockDispatch],
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

const getModeButton = () => screen.getByRole('button', { name: /^(Fill|Outline)$/ });
const getCopyButton = () => screen.getByRole('button', { name: 'Copy' });
const getPasteButton = () => screen.getByRole('button', { name: 'Paste' });
const getClearButton = () => screen.getByRole('button', { name: 'Clear' });

describe('FreehandLasso toolbar', () => {
  beforeEach(() => {
    setToolArgsResult(false);
    setSelectionState();
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
    const activeSelection = { id: 'sel-1', geometry: 'polygon' };
    setSelectionState({ activeSelection });
    render(<FreehandLasso />);

    fireEvent.click(getCopyButton());

    expect(clipboardMocks.copyActiveSelection).toHaveBeenCalledWith(activeSelection);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('surfaces a copy failure to the user and keeps the toolbar usable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
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

    alertSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('pastes the selection clipboard', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' }, hasClipboard: true });
    render(<FreehandLasso />);

    fireEvent.click(getPasteButton());

    expect(clipboardMocks.pasteSelectionClipboard).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches CLEAR_SELECTIONS from the clear button', () => {
    setSelectionState({ activeSelection: { id: 'sel-1', geometry: 'polygon' } });
    render(<FreehandLasso />);

    fireEvent.click(getClearButton());

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
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
