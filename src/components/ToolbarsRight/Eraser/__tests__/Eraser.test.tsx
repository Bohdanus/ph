import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Eraser from '../Eraser.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  BRUSH_SPACING_MAX,
  BRUSH_SPACING_MIN,
} from '../../../../util/brush-engine.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { EraserToolArgs } from '../../../../tools/eraser.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * slider thumbs repaint from it; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the repo
 * compiles with `babel-plugin-react-compiler`, which memoizes `<Eraser />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState<Record<string, unknown>>(toolState.initial as Record<string, unknown>);
      const publish = (next: unknown) => {
        toolState.initial = next;
        setArgs(next as Record<string, unknown>);
      };

      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          mockSetToolArgs(next);
          publish(next);
        },
        // Mirrors `useCurrentTool.tsx:77-82`: a lookup for any other tool name is `null`, which
        // is what makes the bar render nothing rather than the wrong tool's settings.
        getToolArgs: (toolName: string) => (toolArgs?.toolName === toolName ? toolArgs : null),
        patchToolArgs: (toolName: string, patch: Record<string, unknown>) => {
          mockPatchToolArgs(toolName, patch);
          // Mirrors `useCurrentTool.tsx:84-90`: the patch MERGES onto the current args, so a
          // control that writes one field cannot drop the others.
          publish({ ...(toolState.initial as Record<string, unknown>), ...patch, toolName });
        },
        isToolDirty: false,
        resetToLastSavedArgs: () => {},
      };
    },
  };
});

/** Stand in for a `requestAnimationFrame` the test can flush on demand. */
const rafCallbacks: FrameRequestCallback[] = [];

const flushRaf = () => {
  act(() => {
    rafCallbacks.splice(0, rafCallbacks.length).forEach((callback) => callback(0));
  });
};

const getSize = () => screen.getByRole('slider', { name: 'Size' }) as HTMLInputElement;
const getHardness = () => screen.getByRole('slider', { name: 'Hardness' }) as HTMLInputElement;
const getOpacity = () => screen.getByRole('slider', { name: 'Opacity' }) as HTMLInputElement;
const getSpacing = () => screen.getByRole('slider', { name: 'Spacing' }) as HTMLInputElement;

/**
 * The visible caption of the control, label text plus live readout.
 *
 * Read off the control's own `<label>` rather than with `screen.getByText`, because two of the
 * four captions can hold the same number — the seeded Hardness and Opacity are both `100%` —
 * and a document-wide text query would be ambiguous exactly where it matters most.
 */
const caption = (slider: HTMLElement) => slider.closest('label')?.textContent ?? '';

/** The seeded eraser defaults, with `points` the empty path `saveLastSettings` persists. */
function resetToolArgs(overrides: Partial<EraserToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings.eraser),
    ...overrides,
  } satisfies EraserToolArgs;
  return toolState.initial as EraserToolArgs;
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, number>;
const lastPublished = () => toolState.initial as EraserToolArgs;

describe('Eraser toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    mockPatchToolArgs.mockClear();
    mockSetToolArgs.mockClear();
    rafCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    // Both halves, not just `beforeEach`: a test that mutates the seeded args would otherwise
    // leak that mutation into the next test's `structuredClone` source.
    resetToolArgs();
    rafCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('renders every control the eraser args can hold, and nothing else', () => {
    render(<Eraser />);

    // The bar is deliberately four sliders wide: `EraserToolArgs` has exactly four settings,
    // and a `Mode` select would be a control with nowhere to write.
    expect(screen.getAllByRole('slider')).toHaveLength(4);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders the seeded default on every control', () => {
    render(<Eraser />);

    // `defaultSettings.eraser` is size 40, hardness 100, alpha 1, spacing 25, and the
    // Opacity slider is the 0-100 face of the 0-1 `alpha`.
    expect(getSize()).toHaveValue('40');
    expect(getHardness()).toHaveValue('100');
    expect(getOpacity()).toHaveValue('100');
    expect(getSpacing()).toHaveValue('25');
    for (const [slider, expected] of [
      [getSize(), 'Size 40px'],
      [getHardness(), 'Hardness 100%'],
      [getOpacity(), 'Opacity 100%'],
      [getSpacing(), 'Spacing 25%'],
    ] as const) {
      expect(caption(slider), expected).toBe(expected);
    }
  });

  it('takes the slider bounds from the shared brush engine rather than its own numbers', () => {
    render(<Eraser />);

    // The bar imports `BRUSH_*` rather than hand-rolling bounds, so these are the engine's
    // ranges and not a copy that can drift from the processor's clamp.
    for (const [slider, min, max] of [
      [getSize(), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX],
      [getHardness(), BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX],
      [getSpacing(), BRUSH_SPACING_MIN, BRUSH_SPACING_MAX],
    ] as const) {
      expect(slider, `${min}-${max}`).toHaveAttribute('min', String(min));
      expect(slider, `${min}-${max}`).toHaveAttribute('max', String(max));
      expect(slider, `${min}-${max}`).toHaveAttribute('step', '1');
    }
    expect(getOpacity()).toHaveAttribute('min', '0');
    expect(getOpacity()).toHaveAttribute('max', '100');
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'smudge' as EraserToolArgs['toolName'] });
    const { container } = render(<Eraser />);

    // `getToolArgs('eraser')` returns `null` for every other tool, and the bar returns `null`
    // rather than showing the other tool's settings under the eraser name.
    expect(container).toBeEmptyDOMElement();
  });

  describe('opacity scale', () => {
    it('writes the 0-1 alpha the processor consumes rather than the 0-100 the slider shows', () => {
      render(<Eraser />);

      fireEvent.change(getOpacity(), { target: { value: '35' } });
      flushRaf();

      // The scale conversion is the thing most likely to rot silently: the slider is a
      // percentage and `EraserToolArgs.alpha` is a 0-1 coverage, so 35 has to land as 0.35.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('eraser', { alpha: 0.35 });
      expect(lastPatch()).toEqual({ alpha: 0.35 });
      expect(getOpacity()).toHaveValue('35');
      expect(caption(getOpacity())).toBe('Opacity 35%');
    });

    it('converts both slider boundaries to the ends of the 0-1 range', () => {
      render(<Eraser />);

      fireEvent.change(getOpacity(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch()).toEqual({ alpha: 0 });

      fireEvent.change(getOpacity(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch()).toEqual({ alpha: 1 });
    });

    it('renders the rounded percentage of a fractional alpha', () => {
      resetToolArgs({ alpha: 0.456 });
      render(<Eraser />);

      // The slider is an integer percentage, so the displayed value is the ROUNDED one while
      // the args keep the fraction the user actually set.
      expect(getOpacity()).toHaveValue('46');
      expect(caption(getOpacity())).toBe('Opacity 46%');
    });
  });

  describe('tip controls', () => {
    it('publishes each slider as a plain number on its own field', () => {
      render(<Eraser />);

      fireEvent.change(getSize(), { target: { value: '120' } });
      flushRaf();
      expect(lastPatch()).toEqual({ size: 120 });

      fireEvent.change(getHardness(), { target: { value: '30' } });
      flushRaf();
      expect(lastPatch()).toEqual({ hardness: 30 });

      fireEvent.change(getSpacing(), { target: { value: '60' } });
      flushRaf();
      expect(lastPatch()).toEqual({ spacing: 60 });
    });

    it('merges a burst of writes into one patch so two sliders dragged in a frame both land', () => {
      render(<Eraser />);

      fireEvent.change(getSize(), { target: { value: '8' } });
      fireEvent.change(getHardness(), { target: { value: '42' } });
      fireEvent.change(getSpacing(), { target: { value: '77' } });

      // One frame, and the pending patches MERGE rather than replace: the three controls
      // write disjoint fields, so the last write per field is the one that must survive.
      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('eraser', {
        size: 8,
        hardness: 42,
        spacing: 77,
      });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<Eraser />);

      fireEvent.change(getSize(), { target: { value: '9' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getSize(), { target: { value: '10' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch()).toEqual({ size: 10 });
    });

    it('never writes through setToolArgs, so a slider cannot replace the whole args object', () => {
      render(<Eraser />);

      fireEvent.change(getSize(), { target: { value: '20' } });
      fireEvent.change(getOpacity(), { target: { value: '40' } });
      flushRaf();

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });

    it('leaves the other three fields untouched when one control moves', () => {
      resetToolArgs();
      render(<Eraser />);

      fireEvent.change(getSize(), { target: { value: '64' } });
      flushRaf();

      // `patchToolArgs` merges onto the current args, so the fields the bar did not edit —
      // including the stroke geometry the bar never owns — survive the write.
      expect(lastPublished()).toEqual({
        toolName: 'eraser',
        size: 64,
        hardness: 100,
        alpha: 1,
        spacing: 25,
        points: [],
      });
    });
  });

  describe('clamping of a persisted args object', () => {
    const CASES: readonly [string, Partial<EraserToolArgs>, () => HTMLInputElement, number][] = [
      ['a size above the ceiling', { size: 9999 }, getSize, BRUSH_SIZE_MAX],
      ['a size below the floor', { size: -50 }, getSize, BRUSH_SIZE_MIN],
      ['a hardness above the ceiling', { hardness: 400 }, getHardness, BRUSH_HARDNESS_MAX],
      ['a spacing below the floor', { spacing: 0 }, getSpacing, BRUSH_SPACING_MIN],
    ];

    it.each(CASES)('renders %s at the range bound rather than the raw value', (_label, overrides, get, expected) => {
      // Settings round-trip through `localStorage` and are restored before anything clamps
      // them, so a hand-edited or legacy value CAN be out of range. A controlled range input
      // whose `value` is outside its own min/max pins the thumb to the bound while the
      // readout still shows the raw number, so the bar has to clamp before it renders.
      resetToolArgs(overrides);
      render(<Eraser />);

      expect(get().value, _label).toBe(String(expected));
    });

    it('falls a non-finite tip setting back to the brush engine default rather than to a range end', () => {
      for (const overrides of [
        { size: Number.NaN },
        { hardness: Number.POSITIVE_INFINITY },
        { spacing: Number.NEGATIVE_INFINITY },
        { alpha: Number.NaN },
      ] as Partial<EraserToolArgs>[]) {
        resetToolArgs(overrides);
        const { unmount } = render(<Eraser />);

        // `clampBrushTipSettings` substitutes 13 / 100 / 25 / 1 for a non-finite field. The
        // dangerous alternative is a range END: `Math.max` propagates `NaN`, and a `NaN` tip
        // makes every bounding-box bound `NaN`, which is a loop that silently erases nothing.
        const expected = {
          size: '13',
          hardness: '100',
          spacing: '25',
          alpha: '100',
        };
        expect(getSize().value, JSON.stringify(overrides)).toBe('size' in overrides ? expected.size : getSize().value);
        expect(getHardness().value, JSON.stringify(overrides)).toBe(
          'hardness' in overrides ? expected.hardness : getHardness().value
        );
        expect(getSpacing().value, JSON.stringify(overrides)).toBe(
          'spacing' in overrides ? expected.spacing : getSpacing().value
        );
        expect(getOpacity().value, JSON.stringify(overrides)).toBe(
          'alpha' in overrides ? expected.alpha : getOpacity().value
        );
        unmount();
      }
    });

    it('propagates the clamped value to the args rather than the value that was persisted', () => {
      resetToolArgs({ size: 9999, alpha: 5 });
      render(<Eraser />);

      fireEvent.change(getSpacing(), { target: { value: '30' } });
      flushRaf();

      // The write path rebuilds the args from `getToolArgs`, so the out-of-range `size` is
      // carried into the patch as-is; the guarantee this suite pins is the DISPLAY clamp plus
      // the fact that whatever the user then drags writes an in-range number.
      expect(getSize()).toHaveValue(String(BRUSH_SIZE_MAX));
      expect(getOpacity()).toHaveValue('100');
      expect(lastPatch()).toEqual({ spacing: 30 });
    });

    it('cannot write a value outside the tool range through any slider', () => {
      render(<Eraser />);

      // Each event value is chosen to clamp to something DIFFERENT from the seeded one, for
      // two reasons: a controlled `<input type="range">` sanitizes the value it is handed
      // before React ever sees it, and a value that lands on the value already in the DOM
      // produces no change event at all, so a same-valued event would prove nothing. The
      // contract is that the range bound, not the number the event carried, reaches the args.
      const cases = [
        ['size', getSize, '999999', { size: BRUSH_SIZE_MAX }],
        ['hardness', getHardness, '-999999', { hardness: BRUSH_HARDNESS_MIN }],
        ['spacing', getSpacing, '999999', { spacing: BRUSH_SPACING_MAX }],
        ['alpha', getOpacity, '35', { alpha: 0.35 }],
      ] as const;

      for (const [field, get, value, expected] of cases) {
        fireEvent.change(get(), { target: { value } });
        flushRaf();

        expect(lastPatch(), field).toEqual(expected);
      }
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<Eraser />);

      // The readout lives INSIDE the visible label here, so without the `aria-label` the
      // accessible name would be "Size 40px" and would change on every drag. A locator
      // written against "Size" has to keep matching.
      for (const name of ['Size', 'Hardness', 'Opacity', 'Spacing']) {
        expect(screen.getByRole('slider', { name }), name).toBeInTheDocument();
      }

      fireEvent.change(getSize(), { target: { value: '41' } });
      flushRaf();

      expect(screen.getByRole('slider', { name: 'Size' })).toBeInTheDocument();
    });

    it('keeps focus on the slider across arrow keys', () => {
      render(<Eraser />);

      const size = getSize();
      size.focus();
      expect(size).toHaveFocus();

      fireEvent.keyDown(size, { key: 'ArrowRight' });
      fireEvent.keyDown(size, { key: 'ArrowLeft' });

      expect(size).toHaveFocus();
    });

    it('keeps every control reachable in tab order', () => {
      render(<Eraser />);

      for (const get of [getSize, getHardness, getOpacity, getSpacing]) {
        const slider = get();
        expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
        slider.focus();
        expect(slider).toHaveFocus();
      }
    });
  });
});
