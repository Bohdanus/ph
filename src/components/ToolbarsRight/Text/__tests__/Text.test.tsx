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
  // The five optional character attributes, present at their defaults so a toggle test can start
  // from a known-off state. `dropOptionalStyleFields()` below removes them for the test that
  // needs them genuinely absent, which is a different document (see its comment).
  allCaps: false,
  smallCaps: false,
  underline: false,
  strikethrough: false,
  tracking: 0,
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
    allCaps: false,
    smallCaps: false,
    underline: false,
    strikethrough: false,
    tracking: 0,
    ...overrides,
  });
}

/**
 * Removes the five optional character attributes outright rather than setting them to `undefined`.
 *
 * `saveLastSettings` persists the record verbatim, so a settings object written before a field
 * existed has NO key for it — not `false`, not `0`, not `undefined`. Those three are different
 * documents and only the missing key is the one an older build leaves on disk, so this is the
 * only honest way to render the persisted-settings-precedes-the-field case.
 */
function dropOptionalStyleFields() {
  for (const field of ['allCaps', 'smallCaps', 'underline', 'strikethrough', 'tracking'] as const) {
    delete (toolArgs as Record<string, unknown>)[field];
  }
}

/**
 * The args the toolbar last published. Every assertion about a change reads the publish rather
 * than the DOM: the mocked store hands back the same object until something republishes it, so a
 * test that re-read `toolArgs` would be reading back its own fixture.
 */
const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

/**
 * A range input does not move under an arrow key in jsdom, so the value is stepped by hand and
 * an `input` event is dispatched to stand in for the keystroke. React's value tracker is what
 * turns that into a `change`, which is why the event type has to match the control: `input` for
 * the two sliders, and a real `change` for the number field and the colour swatch.
 */
const pressArrowOnRange = (range: HTMLInputElement, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
  if (key === 'ArrowUp' || key === 'ArrowRight') {
    range.stepUp();
  } else {
    range.stepDown();
  }
  fireEvent.input(range);
};

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

    // Every labelled control the bar is supposed to carry, by its visible name. A control that
    // loses its `htmlFor` silently stops appearing here, which is the only place that catches it.
    expect(screen.getByLabelText('Text')).toBeInTheDocument();
    expect(screen.getByLabelText('Font')).toBeInTheDocument();
    expect(screen.getByLabelText(/Font Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Line Height/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tracking/)).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
    expect(screen.getByLabelText('Align')).toBeInTheDocument();
  });

  it('has Apply and Clear buttons', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('names the style toggles for assistive technology, not by their glyph', () => {
    renderWithProvider(<Text />);

    // The accessible name used to be the glyph — "B", "I" — which tells a screen-reader user
    // nothing about a control whose entire function is to say whether the text is bold. These six
    // are the six names Adobe uses for the same six attributes.
    for (const name of ['Bold', 'Italic', 'All Caps', 'Small Caps', 'Underline', 'Strikethrough']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('starts from the bold and italic state carried by the tool args', () => {
    resetToolArgs({ bold: true, italic: true });
    renderWithProvider(<Text />);

    const boldButton = screen.getByRole('button', { name: 'Bold' });
    const italicButton = screen.getByRole('button', { name: 'Italic' });

    expect(boldButton.className).toContain('bg-blue-600');
    expect(italicButton.className).toContain('bg-blue-600');

    // Toggling back publishes the inverse of the state the toolbar actually rendered.
    fireEvent.click(boldButton);
    expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ bold: false, italic: true }));
  });

  it('exposes the bold and italic toggle state through aria-pressed', () => {
    // This was `it.fails` while the bar had no `aria-pressed` at all: a tripwire declaring that a
    // stateful toggle announced itself as a plain button. The affordance exists now, so the
    // tripwire had to become a real assertion in the same change that added the attribute.
    const { unmount } = renderWithProvider(<Text />);

    const boldButton = screen.getByRole('button', { name: 'Bold' });
    const italicButton = screen.getByRole('button', { name: 'Italic' });

    // `false`, not a missing attribute: absent and `"false"` are different states to assistive
    // technology, and React drops the attribute entirely for `undefined`.
    expect(boldButton).toHaveAttribute('aria-pressed', 'false');
    expect(italicButton).toHaveAttribute('aria-pressed', 'false');

    // And the attribute tracks the args rather than being decoration: a second render handed
    // `bold: true` announces exactly one button as pressed. A constant `aria-pressed` passes the
    // half of this test above and fails here.
    unmount();
    resetToolArgs({ bold: true });
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'false');
  });

  describe('the four style toggles', () => {
    // Each toggle below asserts the same three things, because each of the three is a way a
    // toggle can be broken without any of the others noticing:
    //   1. it starts from the state the tool args carry, not from a hardcoded default;
    //   2. clicking publishes the INVERSE — a toggle that published a constant would leave the
    //      second click doing nothing, and only the second click can tell the two apart;
    //   3. it exposes that state twice, `aria-pressed` for assistive technology and the blue fill
    //      for the eye. Asserting one of the two proves nothing about the other.
    it('All Caps starts off from the args, publishes true, and reads back on from a seeded arg', () => {
      const { unmount } = renderWithProvider(<Text />);

      const toggle = screen.getByRole('button', { name: 'All Caps' });
      expect(toggle).toHaveAttribute('id', 'text-all-caps');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle.className).not.toContain('bg-blue-600');

      fireEvent.click(toggle);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ allCaps: true }));

      unmount();
      mockSetToolArgs.mockClear();
      resetToolArgs({ allCaps: true });
      renderWithProvider(<Text />);

      const on = screen.getByRole('button', { name: 'All Caps' });
      expect(on).toHaveAttribute('aria-pressed', 'true');
      expect(on.className).toContain('bg-blue-600');

      fireEvent.click(on);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ allCaps: false }));
    });

    it('Small Caps starts off from the args, publishes true, and reads back on from a seeded arg', () => {
      // Small Caps is a SEPARATE boolean from All Caps, not a mode of it: Adobe's rule is that
      // small caps "generates faux small caps" for the lowercase only, leaving characters typed
      // as capitals at full size. A control that derived one from the other would break that, and
      // a render that mixed the two keys up would pass every other test in this file.
      const { unmount } = renderWithProvider(<Text />);

      const toggle = screen.getByRole('button', { name: 'Small Caps' });
      expect(toggle).toHaveAttribute('id', 'text-small-caps');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle.className).not.toContain('bg-blue-600');

      fireEvent.click(toggle);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ smallCaps: true }));

      unmount();
      mockSetToolArgs.mockClear();
      resetToolArgs({ smallCaps: true });
      renderWithProvider(<Text />);

      const on = screen.getByRole('button', { name: 'Small Caps' });
      expect(on).toHaveAttribute('aria-pressed', 'true');
      expect(on.className).toContain('bg-blue-600');

      fireEvent.click(on);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ smallCaps: false }));
    });

    it('Underline starts off from the args, publishes true, and reads back on from a seeded arg', () => {
      const { unmount } = renderWithProvider(<Text />);

      const toggle = screen.getByRole('button', { name: 'Underline' });
      expect(toggle).toHaveAttribute('id', 'text-underline');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle.className).not.toContain('bg-blue-600');
      // The glyph carries the decoration, so the control still reads as underlined with the
      // screen-reader name and the attribute swapped in.
      expect(toggle.querySelector('.underline')).not.toBeNull();

      fireEvent.click(toggle);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ underline: true }));

      unmount();
      mockSetToolArgs.mockClear();
      resetToolArgs({ underline: true });
      renderWithProvider(<Text />);

      const on = screen.getByRole('button', { name: 'Underline' });
      expect(on).toHaveAttribute('aria-pressed', 'true');
      expect(on.className).toContain('bg-blue-600');

      fireEvent.click(on);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ underline: false }));
    });

    it('Strikethrough starts off from the args, publishes true, and reads back on from a seeded arg', () => {
      const { unmount } = renderWithProvider(<Text />);

      const toggle = screen.getByRole('button', { name: 'Strikethrough' });
      expect(toggle).toHaveAttribute('id', 'text-strikethrough');
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(toggle.className).not.toContain('bg-blue-600');
      expect(toggle.querySelector('.line-through')).not.toBeNull();

      fireEvent.click(toggle);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ strikethrough: true }));

      unmount();
      mockSetToolArgs.mockClear();
      resetToolArgs({ strikethrough: true });
      renderWithProvider(<Text />);

      const on = screen.getByRole('button', { name: 'Strikethrough' });
      expect(on).toHaveAttribute('aria-pressed', 'true');
      expect(on.className).toContain('bg-blue-600');

      fireEvent.click(on);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ strikethrough: false }));
    });
  });

  it('recomputes the rect for a change of metrics and leaves it alone for a change of decoration', () => {
    // This is the whole of `publishStyle`'s split (`Text.tsx` — `publishStyle`). Bold changes the advance width
    // of every glyph, and a box measured against the previous weight is a box one metric out of
    // date. Underline and strikethrough draw in the type colour inside the box the glyphs already
    // occupy, so recomputing them would move a rectangle that was already right.
    //
    // The box here is deliberately TALLER than one 64px/1.1 line needs, so a recompute produces
    // the same four numbers and cannot be caught by value. Only identity catches it:
    // `calculateNewRect` ends in `trimRect2`, which always allocates, so a published `rect` that
    // is the very object the fixture holds is proof that nothing measured.
    resetToolArgs({ rect: { x1: 0, y1: 0, x2: 100, y2: 200 } });
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bold: true }));
    expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    expect(lastToolArgs().rect).toEqual({ x1: 0, y1: 0, x2: 100, y2: 200 });

    mockSetToolArgs.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));

    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ underline: true }));
    expect(lastToolArgs().rect).toBe(toolArgs.rect);
  });

  it('renders every optional style field as its default when the persisted record predates it', () => {
    // `resolveTextStyle` exists so that "what happens when a settings object predates a field" is
    // answered in exactly one place. Without it the bar reads `toolArgs` directly, and two of the
    // five fail silently rather than loudly: React drops `aria-pressed` for `undefined`, and the
    // Tracking range goes uncontrolled on its first render with no `value` at all. Nothing here
    // throws until someone loads a settings object saved by an older build.
    dropOptionalStyleFields();
    renderWithProvider(<Text />);

    const tracking = screen.getByLabelText(/Tracking/) as HTMLInputElement;
    expect(tracking.value).toBe('0');
    // The readout follows the field rather than going blank with it.
    expect(screen.getByText('Tracking')).toHaveTextContent(/^Tracking0$/);

    for (const name of ['All Caps', 'Small Caps', 'Underline', 'Strikethrough']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }

    // And the toggle still publishes the inverse of what it RENDERED rather than the inverse of
    // a key that was not there — `!undefined` and `!false` agree today, but only one of them is
    // reading through the resolver.
    fireEvent.click(screen.getByRole('button', { name: 'All Caps' }));
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ allCaps: true }));
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

  // THE ORDER, asserted as the CALL ORDER rather than as two independent facts, because the order is
  // the defect: `onChange` writes the args both imperatively and into React state, so clearing
  // before the create destroys the draft before the layer is even attempted.
  //
  // `createLayerFromTool` CAN throw — `layer-utils` refuses a zero extent, and the tool area is
  // `absolute inset-0` over the whole centred container, so a click in the letterbox margin reached
  // it — and a throw from a React event handler goes to `window.onerror` rather than to an error
  // boundary, since `ToolbarHorizontal` sits outside every boundary in the tree. The old order
  // therefore lost the user's typed text with no layer, no message and Apply disabled: the empty
  // textarea was the only evidence anything had happened. Inverting these two lines fails this test.
  it('creates the layer BEFORE clearing the draft', () => {
    const order: string[] = [];
    mockCreateLayerFromTool.mockImplementation(() => void order.push('create'));
    mockSetToolArgs.mockImplementation(() => void order.push('clear'));
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(order).toEqual(['create', 'clear']);
    // Both still happen: this is a reordering, not a removal.
    expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
  });

  // The re-entrancy guard, and the order it is armed in. Armed BEFORE the create it poisoned itself:
  // a throw from `createLayerFromTool` left it set against a `toolArgs` identity nothing had changed,
  // so every later Apply returned immediately and the user's next try did nothing at all. The draft
  // survived — which was the point of the reorder — but the control did not, and nothing tested it.
  it('can Apply again after a create that threw', () => {
    // A throw out of a React event handler reaches `window.onerror`, and an uncaught exception there
    // is reported as an unhandled error by the runner — which fails the run without failing a test.
    // This test needs the throw for its whole point, so the error is CAUGHT here and on no other:
    // `preventDefault` is what marks it handled, and the listener is removed the moment the test ends.
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', swallow);
    try {
      mockCreateLayerFromTool.mockImplementationOnce(() => {
        throw new Error('Layer width and height must be greater than 0');
      });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      // Nothing was cleared, and — this is the assertion — the failed attempt did NOT consume the guard.
      expect(mockSetToolArgs).not.toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));

      // The second click, with a create that works this time.
      mockCreateLayerFromTool.mockImplementation(() => undefined);
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(2);
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    } finally {
      window.removeEventListener('error', swallow);
    }
  });

  it('clears text when Clear clicked', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
  });

  describe('font family', () => {
    it('opens the font list from the toolbar trigger', () => {
      renderWithProvider(<Text />);

      expect(screen.queryByRole('button', { name: 'Impact' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Font'));

      expect(screen.getByRole('button', { name: 'Impact' })).toBeInTheDocument();
    });

    it('publishes the chosen family and recomputes the text rect (publishStyle)', () => {
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByLabelText('Font'));
      fireEvent.click(screen.getByRole('button', { name: 'Impact' }));

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(lastToolArgs()).toMatchObject({ fontFamily: 'Impact', text: 'Hello', fontSize: 64, lineHeight: 1.1 });
      // A family change goes through `publishStyle`, which recomputes the rect instead of
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
      // `x1` is 0 and not -1. The one-pixel widening is what makes a zero-area press visible
      // pre-typing, and it used to be returned UNCLAMPED — so a drag starting at the document's left
      // edge published a box that began a pixel outside the document, while `useRect`'s `drawMask`
      // painted it clamped to `[0, 1]`. The frame the user was looking at and the box the first
      // keystroke grew from were therefore different boxes, and the frame jumped on that keystroke.
      expect(rect).toMatchObject({ x1: 0, y1: 0, x2: 11 });
      expect(rect.y2).toBeCloseTo(64 * 1.1 + 2 * 5, 10);
    });
  });

  describe('text colour', () => {
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
    it('commits the same tool args only once, however often Apply is activated (applyText)', () => {
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

  describe('tracking', () => {
    it('shows the seeded value in the field and in the readout, in 1/1000 em', () => {
      resetToolArgs({ tracking: 250 });
      renderWithProvider(<Text />);

      const tracking = screen.getByLabelText(/Tracking/) as HTMLInputElement;
      expect(tracking.type).toBe('range');
      // Adobe's field is -1000..1000 (https://helpx.adobe.com/photoshop/using/line-character-spacing.html),
      // and the unit is the field's own: 250 at a 64px size is 16 CSS px, which `trackingPx` is
      // the one place allowed to compute. A readout in pixels would be a number the user cannot
      // type back into the field.
      expect(tracking.min).toBe('-1000');
      expect(tracking.max).toBe('1000');
      expect(tracking.step).toBe('1');
      expect(tracking.value).toBe('250');
      expect(screen.getByText('Tracking')).toHaveTextContent(/^Tracking250$/);
    });

    it('steps the field by one unit per arrow key', () => {
      renderWithProvider(<Text />);
      const tracking = screen.getByLabelText(/Tracking/) as HTMLInputElement;

      tracking.focus();
      expect(tracking).toHaveFocus();
      expect(tracking.value).toBe('0');

      pressArrowOnRange(tracking, 'ArrowUp');
      expect(lastToolArgs().tracking).toBe(1);

      pressArrowOnRange(tracking, 'ArrowDown');
      expect(lastToolArgs().tracking).toBe(-1);
    });

    it('publishes tracking and the rect it implies in ONE setToolArgs call', () => {
      renderWithProvider(<Text />);
      const tracking = screen.getByLabelText(/Tracking/) as HTMLInputElement;

      fireEvent.change(tracking, { target: { value: '-400' } });

      // One call, not two. Tracking is 1/1000 em added to every character, so it moves the text's
      // advance width; a change published without its rect would commit a box measured against
      // the previous tracking, and a two-call implementation would also leave one frame and one
      // history entry where the bar shows a tracking the document does not have.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tracking: -400 }));
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
      // `canvasRef.current` is null, so only the height branch of `calculateNewRect` can run:
      // the fixture's 50px-tall box grows to one 64px/1.1 line plus 5px padding either side.
      expect(lastToolArgs().rect).toEqual({ x1: 0, y1: 0, x2: 100, y2: expect.closeTo(64 * 1.1 + 2 * 5, 10) });
    });
  });

  describe('keyboard navigation', () => {
    it('walks the bar left to right, with the style toggles between Italic and Apply', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();

      // Every stop is resolved BEFORE the first Tab. Reading the DOM from inside the loop would
      // make this an assertion about whatever happened to be focused, which is the whole thing
      // under test.
      const stops = [
        screen.getByLabelText('Text'),
        screen.getByLabelText('Font'),
        screen.getByRole('spinbutton', { name: /Font Size/ }),
        screen.getByLabelText(/Line Height/),
        screen.getByRole('slider', { name: /Tracking/ }),
        screen.getByLabelText('Color'),
        screen.getByLabelText('Align'),
        screen.getByRole('button', { name: 'Bold' }),
        screen.getByRole('button', { name: 'Italic' }),
        screen.getByRole('button', { name: 'All Caps' }),
        screen.getByRole('button', { name: 'Small Caps' }),
        screen.getByRole('button', { name: 'Underline' }),
        screen.getByRole('button', { name: 'Strikethrough' }),
        screen.getByRole('button', { name: 'Apply' }),
        screen.getByRole('button', { name: 'Clear' }),
      ];

      stops[0].focus();
      expect(stops[0]).toHaveFocus();

      // The bar's own left-to-right order is the tab order: no positive `tabIndex` anywhere, so
      // the sequence is the DOM sequence, and the tab stops a sighted user sees with the focus
      // ring are the ones a keyboard user walks. It used to skip the four toggles that Adobe
      // puts in the middle of this bar, and a control that exists but cannot be reached is not
      // reachable.
      for (const stop of stops.slice(1)) {
        await user.tab();
        expect(stop).toHaveFocus();
      }

      // One stop past the end, and back again from the other side, so a control inserted at
      // either end of the bar cannot slip through this test.
      await user.tab();
      expect(document.body).toHaveFocus();

      await user.tab({ shift: true });
      expect(stops[stops.length - 1]).toHaveFocus();
    });

    it('exposes font size as a number field over the whole 0.01..1296 range', () => {
      renderWithProvider(<Text />);
      const fontSizeField = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      // Adobe's Character-panel Size field is a number field with a 1296-wide span. As a range
      // input, one point occupied about a hundredth of a pixel of track, so the top of the range
      // was unreachable in practice; the number field is the control that can actually be typed
      // to. Pinned by `type` because the whole affordance depends on it.
      fontSizeField.focus();
      expect(fontSizeField).toHaveFocus();
      expect(fontSizeField.type).toBe('number');
      expect(fontSizeField.min).toBe('0.01');
      expect(fontSizeField.max).toBe('1296');
      // `any`, and the value it replaced was `1`. Per the HTML step algorithm the base is `min`, so
      // `step={1}` over `min={0.01}` produced the grid 0.01, 1.01, 2.01 … which contradicted the
      // point of this very test: the seeded 64 sat OFF-grid on first paint, so the spinner needed two
      // presses to reach 65, and the last landable value below the maximum was 1295.01, so Adobe's
      // own 1296 could not be reached by the spinner or an arrow key at all. The range is now typed
      // rather than stepped, which is what a number field for a continuous quantity should be.
      expect(fontSizeField.step).toBe('any');
      expect(fontSizeField.value).toBe('64');

      fireEvent.change(fontSizeField, { target: { value: '48' } });
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 48 }));

      // The property `step={1}` actually broke, stated as a behaviour rather than as a modulo:
      // a size between two integers has to be publishable at all. Under `step={1}` the browser
      // reported this value as `:invalid` and the spinner could not land on it.
      fireEvent.change(fontSizeField, { target: { value: '48.5' } });
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 48.5 }));

      // And Adobe's own maximum is a legal value, which the old grid stopped one step short of.
      fireEvent.change(fontSizeField, { target: { value: fontSizeField.max } });
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 1296 }));

      // An emptied field publishes NOTHING, which is the other half: `Number('')` is `0`, not
      // `NaN`, so the old finiteness guard let it through and the clamp turned a retyped size into
      // `FONT_SIZE_MIN` before a second digit could be entered.
      mockSetToolArgs.mockClear();
      fireEvent.change(fontSizeField, { target: { value: '' } });
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      // The label is still `Font Size` and it is still a real `<label for>`, so clicking the
      // label focuses the field. Its readout is the FIELD's range, not the current size: with a
      // 1296-wide span, a per-value readout beside the label is the one number that says nothing
      // about what the control accepts.
      const fontSizeLabel = screen.getByText('Font Size');
      expect(fontSizeLabel.tagName).toBe('LABEL');
      expect(fontSizeLabel).toHaveAttribute('for', 'font-size-input');
      expect(fontSizeLabel).toHaveTextContent('0.01–1296');
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
      const boldButton = screen.getByRole('button', { name: 'Bold' });
      const italicButton = screen.getByRole('button', { name: 'Italic' });

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
      const fontSizeField = screen.getByLabelText(/Font Size/);

      fontSizeField.focus();
      await user.keyboard('{Escape}');
      expect(fontSizeField).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Georgia' })).not.toBeInTheDocument();
    });
  });
});
