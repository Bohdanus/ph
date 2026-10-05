import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Selection } from '../../../../contexts/general-types.ts';
import { SELECTION_ACTION } from '../../../../util/constants.ts';
import FeatherMagneticLasso, { INFO_TOOLTIP_CLOSE_DELAY_MS } from '../FeatherMagneticLasso.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());
/** `getToolArgs` returns `null` when the tool is not the active one (FeatherMagneticLasso.tsx:66,125). */
const toolArgsAvailable = vi.hoisted(() => ({ current: true }));
const clipboardMock = vi.hoisted(() => ({
  activeSelection: null as { id: string; geometry: string } | null,
  hasSelectionClipboard: false,
  copyActiveSelection: vi.fn(),
  layerViaCopy: vi.fn(),
  pasteSelectionClipboard: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  canvasRef: { current: document.createElement('canvas') },
  selections: [] as Selection[],
  totalSize: { width: 800, height: 600 },
  // An empty timeline at cursor -1 is what a store with nothing appended yet
  // actually looks like, and it is what puts the Deselect writer on the append
  // boundary's SUCCESS branch: `history`/`historyIndex` go straight into the
  // planner's `timeline`, `validateTimeline` reports the out-of-range cursor as a
  // diagnostic instead of throwing on `undefined`, and the writer dispatches the
  // plan it made. Without them the writer's `catch` produces a byte-identical
  // dispatch with no `durableEntry`, and every pin below would pass on that
  // fallback instead. `branchRevision` is the hook's own default, included for
  // shape parity.
  history: [] as unknown[],
  historyIndex: -1,
  branchRevision: 0,
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, dispatchMock],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () =>
      toolArgsAvailable.current
        ? {
            antiAlias: true,
            edgeContrast: 30,
            featherRadius: 12,
            frequency: 40,
            magneticWidth: 18,
            previewFeather: true,
            smoothing: 1.5,
            snapStrength: 0.85,
            toolName: 'feather-magnetic-lasso',
          }
        : null,
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: clipboardMock.activeSelection,
    copyActiveSelection: clipboardMock.copyActiveSelection,
    hasActiveSelection: clipboardMock.activeSelection !== null,
    hasSelectionClipboard: clipboardMock.hasSelectionClipboard,
    layerViaCopy: clipboardMock.layerViaCopy,
    pasteSelectionClipboard: clipboardMock.pasteSelectionClipboard,
    selectionClipboard: clipboardMock.hasSelectionClipboard ? { id: 'clipboard-1' } : null,
  }),
}));

const INFO_BUTTON_NAME = 'Feather Magnetic Lasso settings information';
const SETTING_LABELS = ['Feather', 'Width', 'Contrast', 'Frequency', 'Snap', 'Smooth', 'Anti-alias', 'Preview feather'];
// The real delay, imported rather than retyped. This file used to hold its own copy,
// and the two disagreed: production closed the tooltip after 120ms and the comment above
// this constant said 120 while the constant said 200. Nothing tied either number to
// production, so a change to the delay in `hideInfoTooltipSoon` was invisible here —
// and a `grep` could not tell which of the two was the real one.
//
// `TOOLTIP_CLOSE_DELAY_MS` is still larger than the production delay, and deliberately:
// `waitOutTooltipCloseDelay` waits in REAL wall-clock time, so an assertion that has to
// land exactly when the timer fires would sit on the boundary and fail on a machine
// where it has not quite. That makes it an UPPER BOUND and nothing more — it pins "the
// tooltip is gone by twice the grace period" and cannot notice a delay that shrank or
// disappeared. What pins the delay itself is the fake-timer transition test below, which
// asserts the value as a literal and then the transition around it; this helper is for
// the tests that only care about the settled state.
const TOOLTIP_CLOSE_DELAY_MS = INFO_TOOLTIP_CLOSE_DELAY_MS * 2;

const setClipboardState = (
  state: { activeSelection?: { id: string; geometry: string } | null; hasClipboard?: boolean } = {}
) => {
  clipboardMock.activeSelection = state.activeSelection ?? null;
  clipboardMock.hasSelectionClipboard = state.hasClipboard ?? false;
};

const LASSO_SELECTION: Selection = {
  id: 'sel-1',
  geometry: 'polygon',
  sourceTool: 'feather-magnetic-lasso',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 4, y: 8, width: 16, height: 24 },
  points: [
    { x: 4, y: 8 },
    { x: 20, y: 8 },
    { x: 20, y: 32 },
  ],
};

/**
 * Deselect is no longer a raw `CLEAR_SELECTIONS` reducer action: it is a document
 * edit that appends to history, so a deselect can be undone. The store mock has
 * to carry a live selection for the writer to read — an already-empty document
 * makes Deselect a deliberate no-op, which is a different test.
 *
 * The component's contract is to PLAN the append and DISPATCH the plan. Whether
 * the planned `durableEntry` is published is the STORE's decision, made in
 * `StoreContext` against a durable document this mocked store does not have, so
 * it is not asserted here. `id` is a fresh uuid per call, hence
 * `expect.any(String)`.
 *
 * The store mock carries `history`/`historyIndex` so the writer reaches the
 * SUCCESS branch of the append boundary: without them `planHistoryAppend`'s
 * `validateTimeline` evaluates `timeline.entries.some(...)` on `undefined` and
 * THROWS, the writer's `catch` converts that into a fallback dispatch that omits
 * `durableEntry` entirely, and the two dispatches are byte-identical apart from
 * that field — so this pin would keep passing on the failure path and a
 * regression that made the planner throw would leave the file green.
 */
const CLEAR_SELECTION_EDIT = expect.objectContaining({
  type: 'COMMIT_DOCUMENT_EDIT',
  payload: expect.objectContaining({
    historyItem: expect.objectContaining({
      id: expect.any(String),
      actionName: SELECTION_ACTION,
      args: expect.objectContaining({
        previousSelectionState: expect.objectContaining({
          selections: [expect.objectContaining({ id: 'sel-1' })],
          activeSelectionId: 'sel-1',
        }),
        nextSelectionState: { selections: [], activeSelectionId: null },
      }),
    }),
    updates: expect.objectContaining({ selections: [], activeSelectionId: null }),
  }),
});

const setStoreSelections = (selections: Selection[], activeSelectionId: string | null = null) => {
  storeState.selections = selections;
  storeState.activeSelectionId = activeSelectionId;
};

const getInfoButton = () => screen.getByRole('button', { name: INFO_BUTTON_NAME });
const getSlider = (name: RegExp) => screen.getByRole('slider', { name }) as HTMLInputElement;
const getCheckbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

const focusElement = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
};

const waitOutTooltipCloseDelay = async () => {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, TOOLTIP_CLOSE_DELAY_MS);
    });
  });
};

describe('FeatherMagneticLasso toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
    toolArgsAvailable.current = true;
    clipboardMock.copyActiveSelection.mockClear();
    // The real hook returns `true` on success (`useSelectionClipboard.ts:61`) and the component
    // READS it, so a bare `vi.fn()`'s `undefined` would be indistinguishable from a refused copy
    // in every test that copies without choosing a return value for itself.
    clipboardMock.copyActiveSelection.mockReturnValue(true);
    clipboardMock.layerViaCopy.mockClear();
    clipboardMock.pasteSelectionClipboard.mockClear();
    setClipboardState();
    setStoreSelections([]);
  });

  it('shows settings information in a portal tooltip when the info button is hovered', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    const tooltip = await screen.findByRole('tooltip');

    expect(tooltip.textContent).toContain('Feather Magnetic Lasso settings');
    expect(tooltip.textContent).toContain('Feather');
    expect(tooltip.textContent).toContain('Width');
    expect(tooltip.textContent).toContain('Preview feather');
    expect(document.body.contains(tooltip)).toBe(true);
  });

  it('pins settings information when the info button is clicked', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.click(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toContain('copy output uses a feathered alpha mask');
    });
  });

  /**
   * Adobe: "the rate at which the lasso sets fastening points … between 0 and 100. A higher
   * value anchors the selection border in place more quickly."
   *
   * The control was a maximum path LENGTH in pixels, so a lower value added more anchors —
   * the opposite of the documented sense — and the `px` suffix said so on screen. The sense
   * itself is pinned at the call site in `FeatherMagneticLassoToolArea.test.tsx`.
   */
  describe('frequency', () => {
    it('is the 0-100 control Adobe documents, not a path length in pixels', () => {
      render(<FeatherMagneticLasso />);

      const frequency = getSlider(/^Frequency/);
      expect(frequency).toHaveAttribute('min', '0');
      expect(frequency).toHaveAttribute('max', '100');
      expect(frequency).toHaveAttribute('step', '1');
      // The readout is the setting itself, so it carries no unit the setting does not have.
      expect(frequency.closest('label')?.textContent).toBe('Frequency 40');
    });

    it('explains the direction the control actually moves in', async () => {
      render(<FeatherMagneticLasso />);

      fireEvent.click(getInfoButton());

      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip.textContent).toContain('Higher values anchor the selection border in place more quickly');
    });
  });

  /**
   * The five sliders `Frequency` above did not cover. Each of these bounds is a hardcoded literal
   * in `FeatherMagneticLasso.tsx` (`:275-277`, `:288-290`, `:301-303`, `:328-330`, `:341-343`)
   * rather than a shared constant, so they are the cheapest thing in this file to edit by accident
   * and — before this table — the only ones nothing would have reported.
   *
   * `Snap` is the one whose payload and readout disagree: the range is `0..1` and the tool arg is
   * the raw fraction, while the label prints `Math.round(snapStrength * 100)%` (`Shape`-style
   * scaling, `:325`). A test that asserted the percentage would pass against a handler that wrote
   * the percent into `snapStrength`, so the exact emitted fraction is what is pinned here.
   */
  describe.each([
    ['Feather', /^Feather/, '0', '100', '1'],
    ['Width', /^Width/, '1', '64', '1'],
    ['Contrast', /^Contrast/, '0', '100', '1'],
    ['Snap', /^Snap/, '0', '1', '0.01'],
    ['Smooth', /^Smooth/, '0', '10', '0.5'],
  ])('%s', (_label, name, min, max, step) => {
    it(`spans ${min}..${max} in steps of ${step}`, () => {
      render(<FeatherMagneticLasso />);

      const slider = getSlider(name);
      expect(slider).toHaveAttribute('min', min);
      expect(slider).toHaveAttribute('max', max);
      expect(slider).toHaveAttribute('step', step);
    });
  });

  it('emits the Snap slider as the raw 0..1 fraction, not the percentage its label prints', () => {
    render(<FeatherMagneticLasso />);

    const snap = getSlider(/^Snap/);
    fireEvent.change(snap, { target: { value: '0.42' } });

    // The label reads `Math.round(snapStrength * 100)%`, so a seeded `0.85` is `85` on screen and a
    // raw `0.42` into the handler is `0.42` in the args. Writing `42` instead would satisfy a
    // percentage-based oracle and weaken the snap by two orders of magnitude; `patchNumber` sends
    // the value through untouched.
    expect(patchToolArgsMock).toHaveBeenCalledExactlyOnceWith('feather-magnetic-lasso', { snapStrength: 0.42 });
    // The ×100 and the rounding, pinned from the seeded value. The mocked store republishes no
    // args, so the label cannot be re-read after the change — which is exactly why the payload
    // above is the load-bearing half.
    expect(snap.closest('label')?.textContent).toBe('Snap 85%');
  });

  describe('keyboard navigation', () => {
    it('moves focus through every enabled control in visual order', async () => {
      setClipboardState({ activeSelection: { id: 'sel-1', geometry: 'lasso' }, hasClipboard: true });
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const expectedStops = [
        getInfoButton(),
        getSlider(/^Feather/),
        getSlider(/^Width/),
        getSlider(/^Contrast/),
        getSlider(/^Frequency/),
        getSlider(/^Snap/),
        getSlider(/^Smooth/),
        getCheckbox(/Anti-alias/),
        getCheckbox(/Preview feather/),
        screen.getByRole('button', { name: 'Copy' }),
        screen.getByRole('button', { name: 'Paste' }),
        screen.getByRole('button', { name: 'Deselect' }),
      ];

      expect(document.body).toHaveFocus();

      for (const stop of expectedStops) {
        await user.tab();
        expect(stop).toHaveFocus();
      }

      await user.tab();
      expect(document.body).toHaveFocus();

      await user.tab({ shift: true });
      expect(expectedStops[expectedStops.length - 1]).toHaveFocus();
    });

    it('skips the disabled copy, paste, and Deselect buttons while tabbing', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Deselect' })).toBeDisabled();

      const expectedStops = [
        getInfoButton(),
        getSlider(/^Feather/),
        getSlider(/^Width/),
        getSlider(/^Contrast/),
        getSlider(/^Frequency/),
        getSlider(/^Snap/),
        getSlider(/^Smooth/),
        getCheckbox(/Anti-alias/),
        getCheckbox(/Preview feather/),
      ];

      for (const stop of expectedStops) {
        await user.tab();
        expect(stop).toHaveFocus();
      }

      // The last remaining stop is the Preview feather checkbox: the three disabled buttons
      // are skipped, so focus leaves the toolbar entirely.
      await user.tab();
      expect(document.body).toHaveFocus();
    });

    it('holds the info tooltip open for exactly the production grace period after hover leaves', async () => {
      // THE ONLY TEST THAT PINS THE DELAY. Every other test here settles the tooltip
      // through `waitOutTooltipCloseDelay`, which waits LONGER than production and can
      // therefore only observe an upper bound: with the delay removed it still passed,
      // because the tooltip was already gone. This one asserts the transition — still
      // open one millisecond before the timer fires, gone on the millisecond it does —
      // and it does that on fake timers, so there is no wall-clock boundary to sit on
      // and no flake available in principle.
      //
      // `hover leaves` rather than focus leaving, because focus leaving while the info
      // button is PINNED keeps the tooltip mounted indefinitely by a different rule
      // (`isInfoOpen = isInfoHovered || isInfoPinned`), which is the behaviour the
      // pin-survival test above covers.
      //
      // The clock is faked AFTER the tooltip is open, not before. An async query like
      // `findByRole` under fake timers waits for something that will not happen until
      // time is advanced, and deadlocks into a 5s timeout that looks like a slow
      // machine. Opening on the real clock and faking only the close keeps every wait
      // here synchronous.
      render(<FeatherMagneticLasso />);
      const infoButton = getInfoButton();
      fireEvent.mouseEnter(infoButton);
      expect(await screen.findByRole('tooltip')).toBeInTheDocument();

      // The value the design calls for, asserted as a LITERAL even though the constant
      // is imported — deliberately, and the reason is the trap this test was nearly
      // built into. Everything below advances by the imported constant so that there is
      // no boundary to sit on. If the EXPECTATION also used the constant, the test
      // would advance by whatever it was given and would pass against any delay at all:
      // injected as 400ms it stayed green, because 400-1ms still found the tooltip open
      // and 400ms still found it gone. The test would have been asserting that a grace
      // period exists and not what it is. Changing the grace period is a design change,
      // and it should have to touch this line to land.
      expect(INFO_TOOLTIP_CLOSE_DELAY_MS).toBe(120);

      vi.useFakeTimers();
      try {
        fireEvent.mouseLeave(infoButton);

        // One short of the grace period: still mounted. If the delay were longer than
        // the production value, this is where it shows.
        await act(async () => {
          vi.advanceTimersByTime(INFO_TOOLTIP_CLOSE_DELAY_MS - 1);
        });
        expect(screen.getByRole('tooltip')).toBeInTheDocument();

        // And on the grace period itself: gone. If the delay were shorter — or removed
        // outright — this is where it shows.
        await act(async () => {
          vi.advanceTimersByTime(1);
        });
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      } finally {
        // The restore belongs to `src/test/setup.ts:8`; doing it here as well would be
        // belt-and-braces, but this test is the only one in the file that installs fake
        // timers, so it is also the only one that could be blamed for the next test's
        // clock. Cheap to be explicit about.
        vi.useRealTimers();
      }
    });

    it('keeps focus on each slider and patches the matching setting for arrow key changes', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const sliderCases = [
        { name: /^Feather/, field: 'featherRadius', nextValue: '13', expected: 13 },
        { name: /^Width/, field: 'magneticWidth', nextValue: '19', expected: 19 },
        { name: /^Contrast/, field: 'edgeContrast', nextValue: '31', expected: 31 },
        { name: /^Frequency/, field: 'frequency', nextValue: '41', expected: 41 },
        { name: /^Snap/, field: 'snapStrength', nextValue: '0.86', expected: 0.86 },
        { name: /^Smooth/, field: 'smoothing', nextValue: '2', expected: 2 },
      ];

      for (const { name, field, nextValue, expected } of sliderCases) {
        const slider = getSlider(name);

        focusElement(slider);
        expect(slider).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        // Neither jsdom nor user-event implements the browser default action for arrow keys on
        // <input type="range">, so emit the change event the browser would raise afterwards.
        fireEvent.change(slider, { target: { value: nextValue } });

        expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { [field]: expected });
        expect(slider).toHaveFocus();
      }
    });

    it('toggles the checkbox settings with the space key and not with enter', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const antiAliasCheckbox = getCheckbox(/Anti-alias/);
      const previewFeatherCheckbox = getCheckbox(/Preview feather/);
      expect(antiAliasCheckbox).toBeChecked();
      expect(previewFeatherCheckbox).toBeChecked();

      focusElement(antiAliasCheckbox);
      expect(antiAliasCheckbox).toHaveFocus();
      await user.keyboard(' ');

      expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { antiAlias: false });
      // The checkbox is controlled by the tool args, so it stays checked until the store updates.
      expect(antiAliasCheckbox).toBeChecked();

      await user.keyboard('{Enter}');
      expect(patchToolArgsMock).toHaveBeenCalledTimes(1);

      focusElement(previewFeatherCheckbox);
      expect(previewFeatherCheckbox).toHaveFocus();
      await user.keyboard(' ');

      expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { previewFeather: false });
    });

    it('activates copy, paste, and Deselect with enter and space', async () => {
      const activeSelection = { id: 'sel-1', geometry: 'lasso' };
      setClipboardState({ activeSelection, hasClipboard: true });
      setStoreSelections([LASSO_SELECTION], LASSO_SELECTION.id);
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Deselect' });
      expect(copyButton).toBeEnabled();
      expect(pasteButton).toBeEnabled();
      expect(clearButton).toBeEnabled();

      focusElement(copyButton);
      expect(copyButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(clipboardMock.copyActiveSelection).toHaveBeenCalledWith(activeSelection);

      focusElement(pasteButton);
      expect(pasteButton).toHaveFocus();
      await user.keyboard(' ');

      expect(clipboardMock.pasteSelectionClipboard).toHaveBeenCalledTimes(1);

      focusElement(clearButton);
      expect(clearButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith(CLEAR_SELECTION_EDIT);
    });

    it('opens info tooltip on info button focus', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();

      const infoButton = getInfoButton();
      expect(infoButton).toHaveFocus();

      const tooltip = await screen.findByRole('tooltip');
      expect(infoButton).toHaveAttribute('aria-expanded', 'true');
      expect(infoButton).toHaveAttribute('aria-describedby', tooltip.id);
      expect(within(tooltip).getByText('Feather Magnetic Lasso settings')).toBeInTheDocument();
    });

    it('keeps the info tooltip pinned when the info button is activated with the space key', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      expect(getInfoButton()).toHaveFocus();

      await user.keyboard(' ');

      await user.tab();
      expect(getSlider(/^Feather/)).toHaveFocus();
      await waitOutTooltipCloseDelay();

      // Pinning keeps the tooltip mounted after focus leaves, unlike a focus/hover-only tooltip.
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('lists every setting in the tooltip without pulling focus off the info button', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      const tooltip = await screen.findByRole('tooltip');

      await user.keyboard('{ArrowDown}');

      expect(getInfoButton()).toHaveFocus();
      expect(Array.from(tooltip.querySelectorAll('dt'), (term) => term.textContent)).toEqual(SETTING_LABELS);
      expect(tooltip.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')).toHaveLength(0);
    });

    it('ignores the escape key and closes the unpinned tooltip only after focus leaves the button', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      expect(getInfoButton()).toHaveFocus();
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      // The toolbar registers no escape handler, so the tooltip stays open while the button keeps focus.
      expect(getInfoButton()).toHaveFocus();
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      await user.tab();
      expect(getSlider(/^Feather/)).toHaveFocus();
      await waitOutTooltipCloseDelay();

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('tab key moves focus past the open tooltip', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(getInfoButton()).toHaveFocus();

      await user.tab();

      expect(getSlider(/^Feather/)).toHaveFocus();
      expect(tooltip.contains(document.activeElement)).toBe(false);
      await waitOutTooltipCloseDelay();

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('tool args availability', () => {
    it('renders nothing when the feather magnetic lasso is not the active tool', () => {
      toolArgsAvailable.current = false;
      const { container } = render(<FeatherMagneticLasso />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: INFO_BUTTON_NAME })).toBeNull();
      expect(screen.queryByRole('slider', { name: /^Feather/ })).toBeNull();
    });

    it('renders the toolbar again as soon as the tool args come back', () => {
      toolArgsAvailable.current = false;
      const { container, rerender } = render(<FeatherMagneticLasso />);
      expect(container).toBeEmptyDOMElement();

      toolArgsAvailable.current = true;
      rerender(<FeatherMagneticLasso />);

      expect(getSlider(/^Feather/)).toBeInTheDocument();
    });
  });

  describe('copy failure', () => {
    it('reports a copy that returns false, which is not the throwing path', async () => {
      clipboardMock.copyActiveSelection.mockReturnValueOnce(false);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setClipboardState({ activeSelection: { id: 'sel-1', geometry: 'lasso' }, hasClipboard: true });

      try {
        render(<FeatherMagneticLasso />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        // A refusal reaches no `catch`: `copySelection` returns `false` rather than throwing, so
        // the click above produced no output at all before the component read the boolean.
        await waitFor(() => {
          expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to copy feathered magnetic selection');
        });
        // The throwing path prefixes the error it caught, so the two diagnostics stay separate.
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          'Error copying feathered magnetic selection:',
          expect.anything()
        );
        // `finally` releases the transient state on a refusal exactly as it does on a throw.
        const copyButton = screen.getByRole('button', { name: 'Copy' });
        expect(copyButton).toHaveTextContent('Copy');
        expect(copyButton).toBeEnabled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('logs nothing when the copy succeeds', async () => {
      // The other half of the contract, and the one an unconditional `console.error` would
      // pass while breaking every copy: a successful copy is not a failure.
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setClipboardState({ activeSelection: { id: 'sel-1', geometry: 'lasso' }, hasClipboard: true });

      try {
        render(<FeatherMagneticLasso />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(clipboardMock.copyActiveSelection).toHaveBeenCalledTimes(1);
        });
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('logs when the copy throws, then restores the button', async () => {
      const failure = new Error('clipboard exploded');
      // `mockImplementationOnce` so the throwing behaviour cannot leak: the shared `beforeEach`
      // only calls `mockClear()`, which does not reset implementations.
      clipboardMock.copyActiveSelection.mockImplementationOnce(() => {
        throw failure;
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setClipboardState({ activeSelection: { id: 'sel-1', geometry: 'lasso' }, hasClipboard: true });

      try {
        render(<FeatherMagneticLasso />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

        await waitFor(() => {
          expect(consoleErrorSpy).toHaveBeenCalledWith('Error copying feathered magnetic selection:', failure);
        });

        // `finally { setIsCopying(false) }` (FeatherMagneticLasso.tsx:191-193) is the only thing
        // keeping the label from being stranded on 'Copying...'.
        const copyButton = screen.getByRole('button', { name: 'Copy' });
        expect(copyButton).toHaveTextContent('Copy');
        expect(copyButton).toBeEnabled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('tooltip placement', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const stubButtonRect = (rect: Partial<DOMRect>) => {
      const spy = vi.spyOn(getInfoButton(), 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect,
      } as DOMRect);
      return () => spy.mockRestore();
    };

    it('clamps the tooltip to the left padding when the button sits at the viewport origin', async () => {
      render(<FeatherMagneticLasso />);
      const restore = stubButtonRect({});

      try {
        fireEvent.mouseEnter(getInfoButton());

        const tooltip = await screen.findByRole('tooltip');
        // preferredLeft is -192 and preferredTop is 8, both inside a 1024x768 viewport.
        expect(tooltip.style.left).toBe('8px');
        expect(tooltip.style.top).toBe('8px');
      } finally {
        restore();
      }
    });

    it('keeps the tooltip inside the right edge for a button near the far right', async () => {
      render(<FeatherMagneticLasso />);
      const restore = stubButtonRect({ left: 900, right: 920, width: 20, top: 100, bottom: 120 });

      try {
        fireEvent.mouseEnter(getInfoButton());

        const tooltip = await screen.findByRole('tooltip');
        // preferredLeft would be 718, past innerWidth (1024) - tooltip width (384) - padding.
        expect(tooltip.style.left).toBe('632px');
        expect(tooltip.style.top).toBe('128px');
      } finally {
        restore();
      }
    });

    it('flips the tooltip above the button when it would not fit below it', async () => {
      vi.stubGlobal('innerHeight', 200);
      render(<FeatherMagneticLasso />);
      const restore = stubButtonRect({ left: 400, right: 420, width: 20, top: 150, bottom: 170, height: 20 });

      try {
        fireEvent.mouseEnter(getInfoButton());

        const tooltip = await screen.findByRole('tooltip');
        // 170 + 8 + 330 > 200, so the tooltip is placed above the button and clamped to the
        // top padding because 150 - 330 - 8 is off screen.
        expect(tooltip.style.top).toBe('8px');
      } finally {
        restore();
      }
    });

    it('re-positions the pinned tooltip when the window is resized', async () => {
      render(<FeatherMagneticLasso />);
      const restore = stubButtonRect({ left: 900, right: 920, width: 20, top: 100, bottom: 120 });

      try {
        fireEvent.click(getInfoButton());
        const tooltip = await screen.findByRole('tooltip');
        expect(tooltip.style.left).toBe('632px');

        vi.stubGlobal('innerWidth', 1400);
        act(() => {
          window.dispatchEvent(new Event('resize'));
        });

        expect(tooltip.style.left).toBe('718px');
      } finally {
        restore();
      }
    });

    it('stops re-positioning once the tooltip closes', async () => {
      render(<FeatherMagneticLasso />);
      const restore = stubButtonRect({ left: 900, right: 920, width: 20, top: 100, bottom: 120 });

      try {
        fireEvent.click(getInfoButton());
        await screen.findByRole('tooltip');

        // Unpin, then let the hover state drain so both halves of `isInfoOpen` go false.
        fireEvent.mouseLeave(getInfoButton());
        await waitOutTooltipCloseDelay();
        fireEvent.click(getInfoButton());
        fireEvent.mouseLeave(getInfoButton());
        await waitOutTooltipCloseDelay();

        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        act(() => {
          window.dispatchEvent(new Event('resize'));
        });

        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      } finally {
        restore();
      }
    });
  });
});
