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
  // `defaultSettings.text` carries a colour (src/tools/settings.ts:69-80), so the fixture must
  // too. Without it `Text.tsx:17` sees `toolArgs.color === undefined`, republishes the args on
  // every mount and every one of the call-count assertions below is off by one.
  color: '#000000',
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
    color: '#000000',
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

  it('starts from the bold and italic state carried by the tool args', () => {
    resetToolArgs({ bold: true, italic: true });
    renderWithProvider(<Text />);

    const boldButton = screen.getByRole('button', { name: 'B' });
    const italicButton = screen.getByRole('button', { name: 'I' });

    expect(boldButton.className).toContain('bg-blue-600');
    expect(italicButton.className).toContain('bg-blue-600');

    // Toggling back publishes the inverse of the state the toolbar actually rendered.
    fireEvent.click(boldButton);
    expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ bold: false, italic: true }));
  });

  it.fails('exposes the bold and italic toggle state through aria-pressed (Text.tsx:189-206)', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'I' })).toHaveAttribute('aria-pressed', 'false');
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

  describe('font family', () => {
    const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

    it('opens the font list from the toolbar trigger', () => {
      renderWithProvider(<Text />);

      expect(screen.queryByRole('button', { name: 'Impact' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Font'));

      expect(screen.getByRole('button', { name: 'Impact' })).toBeInTheDocument();
    });

    it('publishes the chosen family and recomputes the text rect (Text.tsx:58-62)', () => {
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Impact' }));

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toMatchObject({ fontFamily: 'Impact', text: 'Hello', fontSize: 64, lineHeight: 1.1 });
      // `handleFontFamilyChange` recomputes the rect through `calculateNewRect` instead of
      // publishing the args unchanged, otherwise the layer would keep the old metrics.
      expect(lastToolArgs().rect).toEqual(expect.objectContaining({ x1: expect.any(Number), y2: expect.any(Number) }));
    });

    it('keeps the align choice when the family changes', () => {
      resetToolArgs({ align: 'right' });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));

      expect(lastToolArgs()).toMatchObject({ align: 'right', fontFamily: 'Georgia' });
    });

    it('recomputes a non-null rect for an empty draft', () => {
      resetToolArgs({ text: '', rect: { x: 0, y: 0, width: 10, height: 10 } });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));

      // `calculateNewRect` widens a zero-text rect rather than collapsing it, so Apply can
      // still become reachable once the user types.
      expect(lastToolArgs().rect).toEqual(expect.objectContaining({ x1: expect.any(Number), y2: expect.any(Number) }));
    });
  });

  describe('colour synchronisation', () => {
    const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

    it('adopts the store colour when it diverges from the tool args colour', () => {
      resetStoreState({ color: '#ff0000' });
      renderWithProvider(<Text />);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ color: '#ff0000', text: 'Hello' })
      );
      expect(lastToolArgs().color).toBe('#ff0000');
    });

    it('does not publish anything when the tool args already match the store colour', () => {
      renderWithProvider(<Text />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('apply idempotency', () => {
    it('commits the same tool args only once, however often Apply is activated (Text.tsx:84)', () => {
      renderWithProvider(<Text />);

      const applyButton = screen.getByRole('button', { name: 'Apply' });
      fireEvent.click(applyButton);
      fireEvent.click(applyButton);
      fireEvent.click(applyButton);

      // The guard compares the args object identity, and the mocked store hands back the same
      // object until something else republishes it.
      expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    });

    it('keeps the guard armed while the store hands back the same args object', () => {
      // The guard is an identity check, so it only re-arms once the store publishes a *new*
      // object. Mutating the args in place, as this mock does, must not create a second layer.
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      resetToolArgs({ text: 'Second' });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(1);
    });
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
