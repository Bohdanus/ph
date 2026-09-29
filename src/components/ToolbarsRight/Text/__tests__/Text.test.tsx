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
  // A real `RectXYSorted`. This used to be a `Pos` (`{x, y, width, height}`), which made
  // `rect.x1` undefined, every rect `calculateNewRect` recomputed came back all-`NaN`,
  // and `expect.any(Number)` happily matched the `NaN` — so the recompute assertions in
  // this file could not fail.
  rect: { x1: 0, y1: 0, x2: 100, y2: 50 } as { x1: number; y1: number; x2: number; y2: number } | null,
  bold: false,
  italic: false,
  fontFamily: 'Arial',
  align: 'left',
  // `defaultSettings.text` carries a colour (src/tools/settings.ts:82-94), so the fixture must too:
  // the swatch renders `toolArgs.color` directly, and a missing one leaves the input valueless.
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
    rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
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

  it('keeps Apply disabled for typed text with no rect, instead of growing one at the origin', () => {
    // This is the regression. `calculateNewRect` used to substitute
    // `{x1:0,y1:0,x2:0,y2:0}` for a null rect, so typing without a drag published a real
    // rect, `disabled={!text || !rect}` stopped being a dead half, and Apply committed a
    // `text 2` layer whose ink landed at the document origin (drawing starts at
    // `rect.x1 + TEXT_PADDING`, `text.ts:32,49`).
    resetToolArgs({ text: '', rect: null });
    const { rerender } = renderWithProvider(<Text />);

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hi' } });

    // The keystroke itself must leave the rect null — that is the whole fix, and the only
    // thing here that fails against the old substitution.
    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi', rect: null }));

    // And the button must still be disabled once those published args come back, which is
    // what the `!rect` half of the gate exists for. The mock store hands back the same
    // object until something republishes it, so the rerender is what makes this a real
    // assertion rather than one about the pre-typing state.
    const published = mockSetToolArgs.mock.lastCall?.[0] as { text: string; rect: unknown };
    resetToolArgs({ text: published.text, rect: published.rect as typeof toolArgs.rect });
    rerender(
      <KeyboardEventsProvider>
        <Text />
      </KeyboardEventsProvider>
    );

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    // Typing something to place is a canvas action, so the toolbar has to say so.
    expect(screen.getByLabelText('Text')).toHaveAttribute('placeholder', 'Drag on the canvas to place text...');
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
      // `canvasRef.current` is null here, so the width-widening branch cannot run and only
      // the height branch does: the fixture's 50px-tall box becomes tall enough for one
      // 64px/1.1 line plus padding. Pinned to real numbers because `expect.any(Number)`
      // also matches the all-`NaN` rect the old `Pos`-shaped fixture produced.
      const rect = lastToolArgs().rect as { x1: number; y1: number; x2: number; y2: number };
      expect(Object.keys(rect).sort()).toEqual(['x1', 'x2', 'y1', 'y2']);
      expect(rect).toMatchObject({ x1: 0, y1: 0, x2: 100 });
      expect(rect.y2).toBeCloseTo(64 * 1.1 + 2 * 5, 10);
    });

    it('keeps the align choice when the family changes', () => {
      resetToolArgs({ align: 'right' });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));

      expect(lastToolArgs()).toMatchObject({ align: 'right', fontFamily: 'Georgia' });
    });

    it('recomputes a non-null rect for an empty draft', () => {
      resetToolArgs({ text: '', rect: { x1: 0, y1: 0, x2: 10, y2: 10 } });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Georgia' }));

      // A non-null rect with no text is a drag made before anything was typed, and
      // `TextToolArea` hits it on every such drag. `calculateNewRect` widens the degenerate
      // box rather than collapsing it, so the overlay mask is visible pre-typing. This is a
      // different branch from the null-rect guard, which used to sit in the same place: the
      // substitution that manufactured a rect at the origin is gone, and what remains is the
      // `!text` early return, which is load-bearing for exactly this case.
      const rect = lastToolArgs().rect as { x1: number; y1: number; x2: number; y2: number };
      expect(Object.keys(rect).sort()).toEqual(['x1', 'x2', 'y1', 'y2']);
      expect(rect).toMatchObject({ x1: -1, y1: 0, x2: 11 });
      expect(rect.y2).toBeCloseTo(64 * 1.1 + 2 * 5, 10);
    });
  });

  describe('text colour', () => {
    const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

    it('renders a Color swatch bound to the tool args colour', () => {
      resetToolArgs({ color: '#3366ff' });
      renderWithProvider(<Text />);

      const swatch = screen.getByLabelText('Color') as HTMLInputElement;
      expect(swatch).toHaveAttribute('type', 'color');
      expect(swatch).toHaveValue('#3366ff');
    });

    it('publishes the chosen colour to the tool args, and only that', () => {
      renderWithProvider(<Text />);

      fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#ff8800' } });

      // The tool OWNS its colour now. The bar used to mirror the store's foreground into
      // `toolArgs.color` on every render, so a user who picked a colour here watched it change
      // under their hands the moment anything touched the foreground.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ color: '#ff8800' }));
      expect(lastToolArgs()).toMatchObject({ color: '#ff8800', text: 'Hello', fontSize: 64, lineHeight: 1.1 });
    });

    it('does not adopt the store foreground, which is not the tool colour any more', () => {
      resetStoreState({ color: '#ff0000' });
      resetToolArgs({ color: '#0000ff' });
      renderWithProvider(<Text />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Color')).toHaveValue('#0000ff');
    });

    it('keeps the tool colour across an unrelated publish', () => {
      resetStoreState({ color: '#00ff00' });
      resetToolArgs({ color: '#0000ff' });
      renderWithProvider(<Text />);

      fireEvent.change(screen.getByLabelText(/Font Size/), { target: { value: '48' } });

      expect(lastToolArgs()).toMatchObject({ color: '#0000ff', fontSize: 48 });
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
      const colorSwatch = screen.getByLabelText('Color');
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

      // The colour swatch sits where Photoshop puts it, immediately after the size group and
      // before the paragraph controls, so the tab order is the bar's own left-to-right order.
      await user.tab();
      expect(colorSwatch).toHaveFocus();

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
