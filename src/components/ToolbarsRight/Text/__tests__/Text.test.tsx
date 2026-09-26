import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { KeyboardEventsProvider } from '../../../../hooks/useKeyboardEvents.tsx';
import Text from '../Text.tsx';

const storeState = vi.hoisted(() => ({
  canvasRef: { current: null },
  color: '#000000',
  currentArgs: { current: null },
  textareaRef: { current: null },
  totalSize: { width: 800, height: 600 },
}));

const toolArgs = vi.hoisted(() => ({
  toolName: 'text',
  text: 'Hello',
  fontSize: 64,
  lineHeight: 1.1,
  rect: { x: 0, y: 0, width: 100, height: 50 } as { x: number; y: number; width: number; height: number } | null,
  bold: false,
  italic: false,
  fontFamily: 'Arial',
  align: 'left',
}));

const mockCreateLayerFromTool = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromTool: mockCreateLayerFromTool,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

function resetStoreState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    canvasRef: { current: null },
    color: '#000000',
    currentArgs: { current: null },
    textareaRef: { current: null },
    totalSize: { width: 800, height: 600 },
    ...overrides,
  });
}

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'text',
    text: 'Hello',
    fontSize: 64,
    lineHeight: 1.1,
    rect: { x: 0, y: 0, width: 100, height: 50 },
    bold: false,
    italic: false,
    fontFamily: 'Arial',
    align: 'left',
    ...overrides,
  });
}

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<KeyboardEventsProvider>{ui}</KeyboardEventsProvider>);
};

describe('Text toolbar', () => {
  beforeEach(() => {
    resetStoreState();
    resetToolArgs();
    mockCreateLayerFromTool.mockClear();
    mockSetToolArgs.mockClear();
  });

  it('renders text input and controls', () => {
    renderWithProvider(<Text />);

    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Font')).toBeInTheDocument();
    expect(screen.getByLabelText(/Font Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Line Height/)).toBeInTheDocument();
    expect(screen.getByLabelText('Align')).toBeInTheDocument();
  });

  it('has Apply and Clear buttons', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('has Bold and Italic toggle buttons', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I' })).toBeInTheDocument();
  });

  it('renders null when toolArgs is not text tool', () => {
    resetToolArgs({ toolName: 'draw' });
    const { queryByLabelText } = renderWithProvider(<Text />);

    expect(queryByLabelText('Text')).not.toBeInTheDocument();
  });

  it('disables Apply and Clear when text is empty', () => {
    resetToolArgs({ text: '' });
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('disables Apply and Clear when rect is null', () => {
    resetToolArgs({ rect: null });
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('enables Apply and Clear when text and rect are present', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).not.toBeDisabled();
  });

  it('calls createLayerFromTool when Apply clicked with valid text', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockCreateLayerFromTool).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.objectContaining({ text: 'Hello' }) })
    );
  });

  it('clears text when Clear clicked', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();

      const textInput = screen.getByLabelText('Text');
      const fontSelect = screen.getByLabelText('Font');
      const fontSizeSlider = screen.getByLabelText(/Font Size/);
      const lineHeightSlider = screen.getByLabelText(/Line Height/);
      const alignSelect = screen.getByLabelText('Align');
      const boldButton = screen.getByRole('button', { name: 'B' });
      const italicButton = screen.getByRole('button', { name: 'I' });
      const applyButton = screen.getByRole('button', { name: 'Apply' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      textInput.focus();
      expect(textInput).toHaveFocus();

      userEvent.tab();
      expect(fontSelect).toHaveFocus();

      userEvent.tab();
      expect(fontSizeSlider).toHaveFocus();

      userEvent.tab();
      expect(lineHeightSlider).toHaveFocus();

      userEvent.tab();
      expect(alignSelect).toHaveFocus();

      userEvent.tab();
      expect(boldButton).toHaveFocus();

      userEvent.tab();
      expect(italicButton).toHaveFocus();

      userEvent.tab();
      expect(applyButton).toHaveFocus();

      userEvent.tab();
      expect(clearButton).toHaveFocus();

      userEvent.tab({ shift: true });
      expect(applyButton).toHaveFocus();
    });

    it('allows arrow key navigation on font size slider', () => {
      renderWithProvider(<Text />);
      const fontSizeSlider = screen.getByLabelText(/Font Size/);

      fontSizeSlider.focus();
      const initialSize = Number(fontSizeSlider.value);
      fireEvent.keyDown(fontSizeSlider, { key: 'ArrowRight' });
      expect(Number(fontSizeSlider.value)).toBeGreaterThan(initialSize);

      fireEvent.keyDown(fontSizeSlider, { key: 'ArrowLeft' });
      expect(Number(fontSizeSlider.value)).toBe(initialSize);
    });

    it('allows arrow key navigation on line height slider', () => {
      renderWithProvider(<Text />);
      const lineHeightSlider = screen.getByLabelText(/Line Height/);

      lineHeightSlider.focus();
      const initialHeight = Number(lineHeightSlider.value);
      fireEvent.keyDown(lineHeightSlider, { key: 'ArrowUp' });
      expect(Number(lineHeightSlider.value)).toBeGreaterThan(initialHeight);

      fireEvent.keyDown(lineHeightSlider, { key: 'ArrowDown' });
      expect(Number(lineHeightSlider.value)).toBe(initialHeight);
    });

    it('allows arrow key navigation on align select', () => {
      renderWithProvider(<Text />);
      const alignSelect = screen.getByLabelText('Align');

      alignSelect.focus();
      fireEvent.keyDown(alignSelect, { key: 'ArrowDown' });
      expect(alignSelect).toHaveValue('center');

      fireEvent.keyDown(alignSelect, { key: 'ArrowDown' });
      expect(alignSelect).toHaveValue('right');

      fireEvent.keyDown(alignSelect, { key: 'ArrowUp' });
      expect(alignSelect).toHaveValue('center');
    });

    it('allows enter/space to toggle bold and italic buttons', () => {
      renderWithProvider(<Text />);
      const boldButton = screen.getByRole('button', { name: 'B' });
      const italicButton = screen.getByRole('button', { name: 'I' });

      boldButton.focus();
      fireEvent.keyDown(boldButton, { key: 'Enter' });
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ bold: true }));

      italicButton.focus();
      fireEvent.keyDown(italicButton, { key: ' ' });
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ italic: true }));
    });

    it('allows enter/space to trigger apply and clear buttons', () => {
      renderWithProvider(<Text />);
      const applyButton = screen.getByRole('button', { name: 'Apply' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      applyButton.focus();
      fireEvent.keyDown(applyButton, { key: 'Enter' });
      expect(mockCreateLayerFromTool).toHaveBeenCalled();

      mockCreateLayerFromTool.mockClear();

      clearButton.focus();
      fireEvent.keyDown(clearButton, { key: ' ' });
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    });

    it('allows typing in text input', () => {
      renderWithProvider(<Text />);
      const textInput = screen.getByLabelText('Text');

      textInput.focus();
      fireEvent.change(textInput, { target: { value: 'New Text' } });
      expect(textInput).toHaveValue('New Text');
    });

    it('escape key does not close anything (no popovers)', () => {
      renderWithProvider(<Text />);
      const fontSizeSlider = screen.getByLabelText(/Font Size/);

      fontSizeSlider.focus();
      fireEvent.keyDown(fontSizeSlider, { key: 'Escape' });
      expect(fontSizeSlider).toHaveFocus();
    });
  });
});
