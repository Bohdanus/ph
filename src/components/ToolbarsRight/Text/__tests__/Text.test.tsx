import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { KeyboardEventsProvider } from '../../../../hooks/useKeyboardEvents.tsx';
import Text from '../Text.tsx';

const storeState = vi.hoisted(() => ({
  canvasRef: { current: null },
  color: '#000000',
  currentArgs: { current: null },
  totalSize: { width: 800, height: 600 },
}));

const toolArgs = vi.hoisted(() => ({
  toolName: 'text',
  text: 'Hello',
  fontSize: 64,
  lineHeight: 1.1,
  kind: 'point' as 'point' | 'paragraph',
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
  editingLayerId: undefined as string | undefined,
}));

const mockCreateLayerFromTool = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockReplaceLayerSource = vi.hoisted(() => vi.fn());

/**
 * `hasPendingText` is the one predicate the bar and the canvas both derive edit mode from, so the
 * case that needs them to disagree overrides the PREDICATE rather than the args. `null` is "no
 * override", which is every case but that one.
 */
const pendingTextOverride = vi.hoisted(() => ({ value: null as boolean | null }));

vi.mock('../../../../util/typeGuards.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../util/typeGuards.ts')>();
  return {
    ...actual,
    hasPendingText: (args: Parameters<typeof actual.hasPendingText>[0]) =>
      pendingTextOverride.value ?? actual.hasPendingText(args),
  };
});

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromTool: mockCreateLayerFromTool,
    replaceLayerSource: mockReplaceLayerSource,
    cancelLayerPreview: mockCancelLayerPreview,
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
    kind: 'point',
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
    editingLayerId: undefined,
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

/**
 * The Size field typed the way a hand types it: select all, then one keystroke at a time.
 *
 * A single `fireEvent.change(field, {value: '129'})` hands the control a FINISHED value and cannot
 * reproduce what used to go wrong, because the damage lived BETWEEN two keystrokes — the field
 * republished the first one and repainted itself before the second landed. Each `change` below is one
 * of those keystrokes, in the order a browser dispatches them.
 */
const typeSizeDigitByDigit = (field: HTMLElement, digits: string) => {
  for (let length = 1; length <= digits.length; length += 1) {
    fireEvent.change(field, { target: { value: digits.slice(0, length) } });
  }
};

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<KeyboardEventsProvider>{ui}</KeyboardEventsProvider>);
};

describe('Text toolbar', () => {
  beforeEach(() => {
    resetStoreState();
    resetToolArgs();
    // `mockReset`, not `mockClear`: the ordering cases below install an implementation that pushes
    // onto a closure array, and `mockClear` keeps implementations, so without the reset every later
    // case in the file would be asserting against a mock left pointing at a dead array.
    mockCreateLayerFromTool.mockReset();
    mockSetToolArgs.mockReset();
    mockCancelLayerPreview.mockReset();
    mockReplaceLayerSource.mockReset();
    pendingTextOverride.value = null;
  });

  it('renders every labelled style control', () => {
    renderWithProvider(<Text />);

    // Every labelled control the bar is supposed to carry, by its visible name. A control that
    // loses its `htmlFor` silently stops appearing here, which is the only place that catches it.
    // The `Text` entry this used to open with was the toolbar's own text field, which no longer
    // exists — the draft is typed into `TextEditOverlay` on the canvas, not here.
    expect(screen.getByLabelText('Font')).toBeInTheDocument();
    expect(screen.getByLabelText(/Font Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Line Height/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tracking/)).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
    expect(screen.getByLabelText('Align')).toBeInTheDocument();
  });

  it('carries no text field at all, because the draft is typed on the canvas', () => {
    renderWithProvider(<Text />);

    // The textarea this replaces was the app's answer to having no edit mode — "type into a field
    // on the right, press Apply, get a raster layer" — and it was the largest fidelity gap in the
    // tool: no caret, no placeholder, a second place to look for the text. It is gone rather than
    // hidden, so this asserts the ABSENCE of the element and not the absence of a visible one: a
    // hidden field that still held the draft would be a second source of truth, and two inputs
    // bound to one string fight over the focus. `queryByLabelText('Text')` alone would pass
    // against a textarea whose `htmlFor` had been dropped.
    expect(screen.queryByLabelText('Text')).not.toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
    // `input[type="text"]` too: an untyped `<input>` defaults to `type="text"`, and FontSelect's
    // trigger is a `<button>`, so the bar has no other text-entry control to confuse this with.
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.querySelector('input:not([type])')).toBeNull();
  });

  it('has Commit and Cancel buttons, named exactly', () => {
    renderWithProvider(<Text />);

    // A string `name` is a whole-string, case-sensitive comparison in this query, so these are
    // exact already; `toHaveAccessibleName` states the same claim through a different route, which
    // is what keeps a rename from surviving on a future query that loosens `name` to a substring.
    expect(screen.getByRole('button', { name: 'Commit' })).toHaveAccessibleName('Commit');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAccessibleName('Cancel');
    // And from the other side: the old pair is gone, not merely outranked.
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
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
    // The box here is deliberately TALLER than one 64px/1.1 line needs (64 * 1.1 + 2 * 5 = 80.4px),
    // so centering it on the click produces a DIFFERENT y1/y2 from the planted rect. A recompute
    // must reproduce those centered numbers exactly, which this assertion catches. The identity
    // check above catches the `undefined` decoration case separately: `calculateNewRect` ends in
    // `trimRect2`, which always allocates, so a published `rect` that is the very object the fixture
    // holds is proof that nothing measured.
    resetToolArgs({ rect: { x1: 0, y1: 0, x2: 100, y2: 200 } });
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bold: true }));
    expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    expect(lastToolArgs().rect).toEqual({ x1: 0, y1: 59.8, x2: 100, y2: 140.2 });

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
    const { container, queryByLabelText } = renderWithProvider(<Text />);

    // The whole bar, not one control: `isTextToolArgs` short-circuits before any of them render.
    expect(container).toBeEmptyDOMElement();
    expect(queryByLabelText('Font')).not.toBeInTheDocument();
  });

  it('shows the Editing type layer label only while a draft is open', () => {
    // Adobe's one visible tell for edit mode: "if you see the Commit button and the Cancel button,
    // the type tool is in edit mode". The label is the bar's half of that same predicate, and it
    // is derived from `hasPendingText` — the predicate `TextEditOverlay` derives edit mode from —
    // so the bar and the canvas cannot disagree about whether the tool is editing.
    resetToolArgs({ text: '', rect: null });
    const { unmount } = renderWithProvider(<Text />);

    expect(screen.queryByText('Editing type layer')).not.toBeInTheDocument();

    unmount();

    // The draft is what decides it, not the mount: the fixture every other case here renders
    // already carries one, and that is the editing state.
    resetToolArgs({ text: 'Hello', rect: { x1: 0, y1: 0, x2: 100, y2: 50 } });
    renderWithProvider(<Text />);

    expect(screen.getByText('Editing type layer')).toBeInTheDocument();
  });

  it('renders every style control with no draft open: only the pair and the label are gated', () => {
    resetToolArgs({ text: '', rect: null });
    renderWithProvider(<Text />);

    // The pair is Adobe's edit-mode tell and it is gated on `hasPendingText`, but the type
    // settings are not a property of the draft — Photoshop's options bar carries them with no
    // type layer on the canvas, and a bar that emptied itself on every tool switch would take the
    // font, the size and the colour with it.
    expect(screen.getByLabelText('Font')).toBeInTheDocument();
    expect(screen.getByLabelText(/Font Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Line Height/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tracking/)).toBeInTheDocument();
    expect(screen.getByLabelText('Color')).toBeInTheDocument();
    expect(screen.getByLabelText('Align')).toBeInTheDocument();
    for (const name of ['Bold', 'Italic', 'All Caps', 'Small Caps', 'Underline', 'Strikethrough']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }

    // And they still publish, so "rendered" is not a decorative claim.
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ bold: true }));
  });

  it('keeps the edit controls mounted for an empty draft box', () => {
    resetToolArgs({ text: '', rect: { x1: 0, y1: 0, x2: 100, y2: 50 } });
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('does not show Commit and Cancel when the draft has no rect', () => {
    resetToolArgs({ text: 'Hello', rect: null });
    renderWithProvider(<Text />);

    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('keeps the pair absent for a draft with text but no rect', () => {
    // `calculateNewRect` used to substitute `{x1:0,y1:0,x2:0,y2:0}` for a null rect, so a text
    // with no box became a commit whose ink landed at the document origin (drawing starts at
    // `rect.x1 + TEXT_PADDING`). The substitution itself is pinned where it lives, in
    // `rect.test.ts` — `it('returns null when there is no rect, instead of growing one at the
    // document origin')` — so what remains here is the toolbar's half: with no rect there is no
    // draft to commit. This case used to reach that state by typing into the bar's textarea, which
    // the toolbar no longer has; a canvas click is what produces it now, and that arrives as the
    // args themselves.
    resetToolArgs({ text: 'Hi', rect: null });
    renderWithProvider(<Text />);

    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    // The label is on the same predicate, so a half-open draft is not edit mode on the canvas
    // either and the bar must not claim it is.
    expect(screen.queryByText('Editing type layer')).not.toBeInTheDocument();
  });

  it('enables Commit and Cancel when the draft has both a text and a rect', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Commit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('refuses to commit a draft that carries no rect, even when the bar is told a draft is open', () => {
    // `applyText` guards on `editing` AND on `rect`, and the `rect` half is the one a disagreement
    // needs: with `hasPendingText` honest, `editing` true already implies a rect, so the pair is
    // already disabled and the guard is unreachable through the button — defence in depth, which
    // is only pinned if something can reach it. The predicate is overridden to report a draft the
    // args do not actually carry, which is precisely the state the guard exists for.
    pendingTextOverride.value = true;
    resetToolArgs({ text: 'Hi', rect: null });
    renderWithProvider(<Text />);

    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();

    expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
    expect(mockSetToolArgs).not.toHaveBeenCalled();
  });

  it('calls createLayerFromTool with the draft args when Commit is clicked', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

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
  // therefore lost the user's typed text with no layer, no message and the commit disabled. Inverting
  // these two lines fails this test; the case below states the same guarantee as its consequence.
  it('creates the layer BEFORE clearing the draft', () => {
    const order: string[] = [];
    mockCreateLayerFromTool.mockImplementation(() => void order.push('create'));
    mockSetToolArgs.mockImplementation(() => void order.push('clear'));
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

    expect(order).toEqual(['create', 'clear']);
    // Both still happen: this is a reordering, not a removal.
    expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(1);
    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
  });

  // The re-entrancy guard, and the order it is armed in. Armed BEFORE the create it poisoned itself:
  // a throw from `createLayerFromTool` left it set against a `toolArgs` identity nothing had changed,
  // so every later Apply returned immediately and the user's next try did nothing at all. The draft
  // survived — which was the point of the reorder — but the control did not, and nothing tested it.
  it('can Commit again after a create that threw', () => {
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

      fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

      // Nothing was cleared, and — this is the assertion — the failed attempt did NOT consume the guard.
      expect(mockSetToolArgs).not.toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));

      // The second click, with a create that works this time.
      mockCreateLayerFromTool.mockImplementation(() => undefined);
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

      expect(mockCreateLayerFromTool).toHaveBeenCalledTimes(2);
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    } finally {
      window.removeEventListener('error', swallow);
    }
  });

  it('clears text when Cancel clicked', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
  });

  it('Cancel discards the draft without creating a layer', () => {
    renderWithProvider(<Text />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // A discard, which is what Adobe's is: "To cancel the changes, click the Cancel button in the
    // options bar". The absence of the create is the half that matters — a Cancel that committed
    // would be a Commit under a different name, and the two buttons sit next to each other.
    expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
    expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    // And nothing about the style travels with the discard, so the tool keeps its last settings.
    expect(lastToolArgs()).toMatchObject({ fontFamily: 'Arial', fontSize: 64, color: '#000000' });
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
      resetToolArgs({ kind: 'paragraph', align: 'right' });
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
      const size = screen.getByLabelText(/Font Size/);

      fireEvent.change(size, { target: { value: '48' } });
      // The Size field commits rather than streams (`font size retyping` below), so the keystroke
      // above is a draft and this blur is what publishes it. Every assertion below is unchanged.
      fireEvent.blur(size);

      expect(lastToolArgs()).toMatchObject({ color: '#0000ff', fontSize: 48 });
    });
  });

  describe('commit idempotency', () => {
    it('commits the same tool args only once, however often Commit is activated', () => {
      renderWithProvider(<Text />);

      const commitButton = screen.getByRole('button', { name: 'Commit' });
      fireEvent.click(commitButton);
      fireEvent.click(commitButton);
      fireEvent.click(commitButton);

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

      const commitButton = screen.getByRole('button', { name: 'Commit' });
      fireEvent.click(commitButton);
      resetToolArgs({ text: 'Second' });
      fireEvent.click(commitButton);

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

  /**
   * The Size field takes the number it exists to accept.
   *
   * A keystroke is not an edit. The field published from `onChange`, and every published value came
   * straight back through the controlled `value={style.fontSize}`, so the control repainted itself
   * between two keystrokes: typing `129` over the seeded `64` published `1`, then `12`, then `129`,
   * and typing `08` published `FONT_SIZE_MIN` on the leading zero, leaving the `8` to land after a
   * `0.01` the field had already rewritten itself to.
   *
   * Every test below is written to FAIL against that, not merely to describe the fix: the keystrokes
   * arrive one at a time, and the publication that matters is the last one.
   */
  describe('font size retyping', () => {
    it('takes a size typed digit by digit and publishes nothing until it is committed', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;
      expect(size.value).toBe('64');

      // `1`, then `12`, then `129`. `1` and `12` are both IN range, so the old handler published
      // them and let the field repaint to each one before the next keystroke — the corruption had
      // nothing to do with the clamp, and a test that only typed an out-of-range value would miss it.
      typeSizeDigitByDigit(size, '129');
      // The field shows what the user has typed, all three keystrokes in.
      expect(size.value).toBe('129');
      // And a draft is not a tool argument: nothing was published while it was being typed.
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.blur(size);

      // EXACTLY one publish, carrying the finished size. A last-call read would pass straight
      // through three publishes of three intermediates, which is the defect itself.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 129 }));
      // It went out through `publishStyle`, so the rect the new metrics imply went with it — a size
      // that changed the measure and kept the box would lay the layer out against stale metrics.
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    });

    it('takes a leading zero without publishing FONT_SIZE_MIN over it', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      // `0` is the one intermediate the old handler could not survive: `Math.max(FONT_SIZE_MIN, 0)` is
      // `FONT_SIZE_MIN`, so the field became `0.01` mid-word and the `8` landed after it.
      typeSizeDigitByDigit(size, '08');
      // The user's own string, not the clamped one. `toBe('08')` rather than a number, because a
      // clamp applied to the draft is a mutation this assertion is here to kill.
      expect(size.value).toBe('08');
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.blur(size);

      // The size the user typed, not the `0.01` the old field published on the first keystroke — and
      // not `0.018`, which is what its own `0.01` repaint turned the trailing digit into.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 8 }));
    });

    it('shows the committed size in the field once the draft is dropped', () => {
      const { rerender } = renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      typeSizeDigitByDigit(size, '129');
      fireEvent.blur(size);
      // Immediately after the commit the field is back to whatever the store holds, and this file's
      // mock hands the same args object back on every call — so it reads the seeded `64` here.
      expect(size.value).toBe('64');

      // Feeding the store what the toolbar published is what a real store does, and it is the only
      // way to see the committed value land in the field at all. A field that kept its draft after
      // the commit, or dropped it without publishing, fails the line below.
      resetToolArgs({ fontSize: lastToolArgs().fontSize as number });
      rerender(
        <KeyboardEventsProvider>
          <Text />
        </KeyboardEventsProvider>
      );

      expect(size.value).toBe('129');
    });

    it('commits on Enter, because blur alone is not reachable by keyboard alone', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fireEvent.change(size, { target: { value: '96' } });
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.keyDown(size, { key: 'Enter' });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 96 }));
    });

    it('abandons the draft on Escape, leaving the published size untouched', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      typeSizeDigitByDigit(size, '500');
      expect(size.value).toBe('500');
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.keyDown(size, { key: 'Escape' });

      // No publish, and the field is back to the published `64` rather than the abandoned draft —
      // which is only possible because nothing was published while it was being typed. A field that
      // committed on every keystroke has already published `5`, and this fails.
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(size.value).toBe('64');
    });

    it('clamps at the commit, at both ends, and not while the value is being typed', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      // `min`/`max` cannot be what does this: they are constraint-validation metadata, so the
      // browser marks the field `:invalid` and dispatches the change anyway. The field holds what
      // the user typed until they commit, which is a different assertion from the one the clamp is.
      fireEvent.change(size, { target: { value: '5000' } });
      expect(size.value).toBe('5000');
      fireEvent.blur(size);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 1296 }));

      mockSetToolArgs.mockClear();
      fireEvent.change(size, { target: { value: '0' } });
      expect(size.value).toBe('0');
      fireEvent.blur(size);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 0.01 }));

      mockSetToolArgs.mockClear();
      fireEvent.change(size, { target: { value: '-40' } });
      fireEvent.blur(size);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 0.01 }));
    });

    it('publishes nothing for an emptied field, and restores the last good size on the way out', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      // The empty draft is the user's own text while they are in the field — resolving it here is
      // what used to publish `FONT_SIZE_MIN` the instant a size was selected for retyping.
      fireEvent.change(size, { target: { value: '' } });
      expect(size.value).toBe('');
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.blur(size);

      // Nothing, on the way out either, and the controlled restore puts the published size back.
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(size.value).toBe('64');
    });

    it('follows an external size change, and yields to a live draft until it is committed', () => {
      const { rerender } = renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;
      expect(size.value).toBe('64');

      const republish = (fontSize: number) => {
        resetToolArgs({ fontSize });
        rerender(
          <KeyboardEventsProvider>
            <Text />
          </KeyboardEventsProvider>
        );
      };

      // With no draft in progress the field IS the published size, so an external publish — a tool
      // switch, a settings reload, another control — still repaints it. The draft is `null` here,
      // which is what keeps that true.
      republish(200);
      expect(size.value).toBe('200');

      // A draft outranks it: the keystrokes in front of the user are what they are looking at, and a
      // publish landing mid-edit must not replace the value they are typing towards under the cursor.
      typeSizeDigitByDigit(size, '7');
      republish(300);
      expect(size.value).toBe('7');

      // And the commit publishes the DRAFT rather than the size the store happened to hold.
      fireEvent.blur(size);
      expect(lastToolArgs()).toMatchObject({ fontSize: 7 });
    });
  });

  describe('keyboard navigation', () => {
    it('walks the bar left to right, with the style toggles between Italic and Commit', async () => {
      // The pair is Adobe's edit-mode tell, so it is on the tab path only while a draft is open —
      // and the fixture this renders already carries one, which is why Commit and Cancel are stops
      // here at all. A `disabled` control is not focusable, so presenting no draft would drop both
      // ends of the walk rather than reorder it.
      resetToolArgs({ kind: 'paragraph' });
      renderWithProvider(<Text />);
      const user = userEvent.setup();

      // Every stop is resolved BEFORE the first Tab. Reading the DOM from inside the loop would
      // make this an assertion about whatever happened to be focused, which is the whole thing
      // under test.
      const stops = [
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
        screen.getByRole('button', { name: 'Commit' }),
        screen.getByRole('button', { name: 'Cancel' }),
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

      // Each value below is a keystroke or a paste, not an edit on its own: the field COMMITS rather
      // than streams (`font size retyping`), so the blur is part of reaching the published value
      // rather than a gesture the assertions above needed. Every assertion is the one that was here
      // before — including `toHaveBeenCalledExactlyOnceWith`, which is what says one `change` plus one
      // commit is ONE publish rather than two.
      fireEvent.change(fontSizeField, { target: { value: '48' } });
      fireEvent.blur(fontSizeField);
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 48 }));

      // The property `step={1}` actually broke, stated as a behaviour rather than as a modulo:
      // a size between two integers has to be publishable at all. Under `step={1}` the browser
      // reported this value as `:invalid` and the spinner could not land on it.
      fireEvent.change(fontSizeField, { target: { value: '48.5' } });
      fireEvent.blur(fontSizeField);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 48.5 }));

      // And Adobe's own maximum is a legal value, which the old grid stopped one step short of.
      fireEvent.change(fontSizeField, { target: { value: fontSizeField.max } });
      fireEvent.blur(fontSizeField);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 1296 }));

      // An emptied field publishes NOTHING, which is the other half: `Number('')` is `0`, not
      // `NaN`, so the old finiteness guard let it through and the clamp turned a retyped size into
      // `FONT_SIZE_MIN` before a second digit could be entered.
      mockSetToolArgs.mockClear();
      fireEvent.change(fontSizeField, { target: { value: '' } });
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      // And leaving the edit restores what was published, rather than the field being left blank or
      // the empty value being committed — which is the whole of why `Number('')` is not enough to
      // look at. The mock store hands back the same args, so the published size is the seeded 64.
      fireEvent.blur(fontSizeField);
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(fontSizeField.value).toBe('64');

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
      resetToolArgs({ kind: 'paragraph' });
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

    it('disables alignment for point type and explains why', () => {
      renderWithProvider(<Text />);

      const alignSelect = screen.getByLabelText('Align');
      expect(alignSelect).toBeDisabled();
      expect(alignSelect).toHaveAccessibleDescription('Alignment is available for paragraph text only');
      expect(mockSetToolArgs).not.toHaveBeenCalled();
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

    it('allows enter/space to trigger Commit and Cancel', async () => {
      renderWithProvider(<Text />);
      const user = userEvent.setup();
      const commitButton = screen.getByRole('button', { name: 'Commit' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      commitButton.focus();
      expect(commitButton).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(mockCreateLayerFromTool).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.objectContaining({ text: 'Hello' }) })
      );

      mockCreateLayerFromTool.mockClear();

      cancelButton.focus();
      expect(cancelButton).toHaveFocus();
      await user.keyboard(' ');
      expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
      expect(lastToolArgs().text).toBe('');
      expect(lastToolArgs().rect).toBeNull();
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

  describe('edge-case coverage', () => {
    it('calls createLayerFromTool when editingLayerId is absent, not replaceLayerSource', () => {
      renderWithProvider(<Text />);
      expect(toolArgs.editingLayerId).toBeUndefined();

      fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

      expect(mockCreateLayerFromTool).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.objectContaining({ text: 'Hello' }) })
      );
      expect(mockReplaceLayerSource).not.toHaveBeenCalled();
    });

    it('calls cancelLayerPreview for the editing layer when Cancel is clicked', () => {
      resetToolArgs({ editingLayerId: 'text-layer-1' });
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockCancelLayerPreview).toHaveBeenCalledWith('text-layer-1');
      expect(mockCreateLayerFromTool).not.toHaveBeenCalled();
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    });

    it('does not call cancelLayerPreview when Cancel is clicked without an editing layer', () => {
      expect(toolArgs.editingLayerId).toBeUndefined();
      renderWithProvider(<Text />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockCancelLayerPreview).not.toHaveBeenCalled();
      expect(mockSetToolArgs).toHaveBeenCalledWith(expect.objectContaining({ text: '', rect: null }));
    });

    it('commits a font size typed at exactly FONT_SIZE_MIN (0.01)', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fireEvent.change(size, { target: { value: '0.01' } });
      expect(size.value).toBe('0.01');
      fireEvent.blur(size);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 0.01 }));
    });

    it('commits a font size typed at exactly FONT_SIZE_MAX (1296)', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fireEvent.change(size, { target: { value: '1296' } });
      fireEvent.blur(size);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 1296 }));
    });

    it('clamps a negative font size to FONT_SIZE_MIN at commit', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fireEvent.change(size, { target: { value: '-40' } });
      fireEvent.blur(size);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fontSize: 0.01 }));
    });

    it('restores the published font size when Escape abandons an out-of-range draft', () => {
      renderWithProvider(<Text />);
      const size = screen.getByLabelText(/Font Size/) as HTMLInputElement;

      fireEvent.change(size, { target: { value: '5000' } });
      expect(size.value).toBe('5000');
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      fireEvent.keyDown(size, { key: 'Escape' });

      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(size.value).toBe('64');
    });

    it('publishes the line height slider value and recomputes the rect', () => {
      renderWithProvider(<Text />);
      const lineHeightSlider = screen.getByLabelText(/Line Height/) as HTMLInputElement;

      fireEvent.change(lineHeightSlider, { target: { value: '1.5' } });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lineHeight: 1.5 }));
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    });

    it('enables Align for paragraph kind and disables it for point kind', () => {
      resetToolArgs({ kind: 'paragraph' });
      const { unmount } = renderWithProvider(<Text />);
      expect(screen.getByLabelText('Align')).toBeEnabled();

      unmount();
      resetToolArgs({ kind: 'point' });
      renderWithProvider(<Text />);
      expect(screen.getByLabelText('Align')).toBeDisabled();
    });

    it('routes an alignment change through publishStyle for point type', () => {
      renderWithProvider(<Text />);
      const alignSelect = screen.getByLabelText('Align');
      expect(alignSelect).toBeDisabled();

      fireEvent.change(alignSelect, { target: { value: 'center' } });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ align: 'center' }));
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    });

    it('publishes colour swatch changes into the tool args', () => {
      renderWithProvider(<Text />);
      const swatch = screen.getByLabelText('Color') as HTMLInputElement;

      fireEvent.change(swatch, { target: { value: '#123456' } });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ color: '#123456' }));
      expect(lastToolArgs()).toMatchObject({ color: '#123456', text: 'Hello', fontSize: 64 });
    });

    it('toggles Bold from true to false and recomputes the rect', () => {
      resetToolArgs({ bold: true });
      renderWithProvider(<Text />);

      const boldButton = screen.getByRole('button', { name: 'Bold' });
      expect(boldButton).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(boldButton);

      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ bold: false }));
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    });

    it('toggles Italic from true to false and recomputes the rect like Bold', () => {
      resetToolArgs({ italic: true });
      renderWithProvider(<Text />);

      const italicButton = screen.getByRole('button', { name: 'Italic' });
      expect(italicButton).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(italicButton);

      expect(mockSetToolArgs).toHaveBeenLastCalledWith(expect.objectContaining({ italic: false }));
      expect(lastToolArgs().rect).not.toBe(toolArgs.rect);
    });
  });
});
