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
    const pressArrowOnRange = (range: HTMLInputElement, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
      if (key === 'ArrowUp' || key === 'ArrowRight') {
        range.stepUp();
      } else {
        range.stepDown();
      }
      fireEvent.input(range);
    };

    const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

    it('allows tab navigation through all focusable elements', async () => {
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

      await user.tab();
      expect(fontSelect).toHaveFocus();

      await user.tab();
      expect(fontSizeSlider).toHaveFocus();

      await user.tab();
      expect(lineHeightSlider).toHaveFocus();

      await user.tab();
      expect(alignSelect).toHaveFocus();

      await user.tab();
      expect(boldButton).toHaveFocus();

      await user.tab();
      expect(italicButton).toHaveFocus();

      await user.tab();
      expect(applyButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(applyButton).toHaveFocus();
    });

    it('allows arrow key navigation on font size slider', () => {
      renderWithProvider(<Text />);
      const fontSizeSlider = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fontSizeSlider.focus();
      expect(fontSizeSlider).toHaveFocus();
      expect(fontSizeSlider.type).toBe('range');
      expect(fontSizeSlider.min).toBe('8');
      expect(fontSizeSlider.max).toBe('500');

      const initialSize = Number(fontSizeSlider.value);
      expect(initialSize).toBe(64);

      pressArrowOnRange(fontSizeSlider, 'ArrowRight');
      expect(lastToolArgs().fontSize).toBe(initialSize + 1);

      pressArrowOnRange(fontSizeSlider, 'ArrowLeft');
      expect(lastToolArgs().fontSize).toBe(initialSize - 1);
    });

    it('allows arrow key navigation on line height slider', () => {
      renderWithProvider(<Text />);
      const lineHeightSlider = screen.getByLabelText(/Line Height/) as HTMLInputElement;

      lineHeightSlider.focus();
      expect(lineHeightSlider).toHaveFocus();
      expect(lineHeightSlider.type).toBe('range');
      expect(lineHeightSlider.step).toBe('0.05');

      const initialHeight = Number(lineHeightSlider.value);
      expect(initialHeight).toBe(1.1);

      pressArrowOnRange(lineHeightSlider, 'ArrowUp');
      expect(lastToolArgs().lineHeight).toBeCloseTo(initialHeight + 0.05, 10);

      pressArrowOnRange(lineHeightSlider, 'ArrowDown');
      expect(lastToolArgs().lineHeight).toBeCloseTo(initialHeight - 0.05, 10);
    });

    it('changes alignment through the native select and reports it to the store', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const alignSelect = screen.getByLabelText('Align') as HTMLSelectElement;

      expect(Array.from(alignSelect.options, (option) => option.value)).toEqual(['left', 'center', 'right']);
      expect(alignSelect).toHaveValue('left');

      alignSelect.focus();
      expect(alignSelect).toHaveFocus();

      await user.selectOptions(alignSelect, 'center');
      expect(lastToolArgs().align).toBe('center');
      expect(alignSelect).toHaveValue('left');

      await user.selectOptions(alignSelect, 'right');
      expect(lastToolArgs().align).toBe('right');
      expect(alignSelect).toHaveValue('left');
    });

    it('allows enter/space to toggle bold and italic buttons', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const boldButton = screen.getByRole('button', { name: 'B' });
      const italicButton = screen.getByRole('button', { name: 'I' });

      boldButton.focus();
      await user.keyboard('{Enter}');
      expect(lastToolArgs().bold).toBe(true);

      italicButton.focus();
      expect(italicButton).toHaveFocus();
      await user.keyboard(' ');
      expect(lastToolArgs().italic).toBe(true);
    });

    it('allows enter/space to trigger apply and clear buttons', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const applyButton = screen.getByRole('button', { name: 'Apply' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      applyButton.focus();
      expect(applyButton).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(mockCreateLayerFromTool).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.objectContaining({ text: 'Hello' }) })
      );

      mockCreateLayerFromTool.mockClear();

      clearButton.focus();
      expect(clearButton).toHaveFocus();
      await user.keyboard(' ');
      expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
      expect(lastToolArgs().text).toBe('');
      expect(lastToolArgs().rect).toBeNull();
    });

    it('reports typed text to the store while the textarea stays controlled by toolArgs.text', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const textInput = screen.getByLabelText('Text') as HTMLTextAreaElement;

      expect(textInput).toHaveValue('Hello');

      textInput.focus();
      await user.type(textInput, '!');

      expect(lastToolArgs().text).toBe('Hello!');
      expect(textInput).toHaveValue('Hello');
    });

    it('escape key does not close anything (no popovers)', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const fontSizeSlider = screen.getByLabelText(/Font Size/);

      fontSizeSlider.focus();
      await user.keyboard('{Escape}');
      expect(fontSizeSlider).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Georgia' })).not.toBeInTheDocument();
    });
  });
});
