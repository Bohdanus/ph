import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Smudge from '../Smudge.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../../../util/brush-engine.ts';
import { SMUDGE_STRENGTH_MAX, SMUDGE_STRENGTH_MIN } from '../../../../tools/smudge.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { SmudgeToolArgs } from '../../../../tools/smudge.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * slider thumbs repaint from it; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the repo
 * compiles with `babel-plugin-react-compiler`, which memoizes `<Smudge />` on its empty props.
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
        getToolArgs: (toolName: string) => (toolArgs?.toolName === toolName ? toolArgs : null),
        patchToolArgs: (toolName: string, patch: Record<string, unknown>) => {
          mockPatchToolArgs(toolName, patch);
          publish({ ...(toolState.initial as Record<string, unknown>), ...patch, toolName });
        },
        isToolDirty: false,
        resetToLastSavedArgs: () => {},
      };
    },
  };
});

const rafCallbacks: FrameRequestCallback[] = [];

const flushRaf = () => {
  act(() => {
    rafCallbacks.splice(0, rafCallbacks.length).forEach((callback) => callback(0));
  });
};

const getSize = () => screen.getByRole('slider', { name: 'Size' }) as HTMLInputElement;
const getHardness = () => screen.getByRole('slider', { name: 'Hardness' }) as HTMLInputElement;
const getStrength = () => screen.getByRole('slider', { name: 'Strength' }) as HTMLInputElement;

/** The visible caption of the control, label text plus live readout. */
const caption = (slider: HTMLElement) => slider.closest('label')?.textContent ?? '';

/** The seeded smudge defaults, with `points` the empty path `saveLastSettings` persists. */
function resetToolArgs(overrides: Partial<SmudgeToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings.smudge),
    ...overrides,
  } satisfies SmudgeToolArgs;
  return toolState.initial as SmudgeToolArgs;
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, number>;
const lastPublished = () => toolState.initial as SmudgeToolArgs;

describe('Smudge toolbar', () => {
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
    resetToolArgs();
    rafCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('renders exactly the three controls the smudge args can hold', () => {
    render(<Smudge />);

    // `SmudgeToolArgs` has `size`, `hardness`, `strength` and the stroke. The stroke is
    // geometry the tool area owns, and the four Photoshop controls this bar omits (Mode,
    // Finger Painting, Flow, Brush Preset Picker) have no field to write, so three sliders is
    // the whole contract.
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders the seeded default on every control', () => {
    render(<Smudge />);

    // `defaultSettings.smudge` is size 40, hardness 100, strength 50.
    for (const [slider, value, text] of [
      [getSize(), '40', 'Size 40px'],
      [getHardness(), '100', 'Hardness 100%'],
      [getStrength(), '50', 'Strength 50%'],
    ] as const) {
      expect(slider, text).toHaveValue(value);
      expect(caption(slider), text).toBe(text);
    }
  });

  it('takes the tip bounds from the shared brush engine and the strength bounds from the tool module', () => {
    render(<Smudge />);

    for (const [slider, min, max] of [
      [getSize(), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX],
      [getHardness(), BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX],
      [getStrength(), SMUDGE_STRENGTH_MIN, SMUDGE_STRENGTH_MAX],
    ] as const) {
      expect(slider, `${min}-${max}`).toHaveAttribute('min', String(min));
      expect(slider, `${min}-${max}`).toHaveAttribute('max', String(max));
      expect(slider, `${min}-${max}`).toHaveAttribute('step', '1');
    }
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'eraser' as SmudgeToolArgs['toolName'] });
    const { container } = render(<Smudge />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('strength scale', () => {
    it('writes the percentage the args already store rather than dividing it again', () => {
      render(<Smudge />);

      fireEvent.change(getStrength(), { target: { value: '35' } });
      flushRaf();

      // `SmudgeToolArgs.strength` IS Photoshop's percentage. The brush engine wants the same
      // quantity as a 0-1 `opacity`, and `SMUDGE_STRENGTH_SCALE` is the divisor the PROCESSOR
      // uses for that mapping — the bar keeps the percentage so the number on screen is the
      // number the user picked, and writing 0.35 here would erase the scale entirely.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('smudge', { strength: 35 });
      expect(lastPatch()).toEqual({ strength: 35 });
      expect(getStrength()).toHaveValue('35');
      expect(caption(getStrength())).toBe('Strength 35%');
    });

    it('accepts both range boundaries, and 0 is a real identity strength rather than a floor', () => {
      render(<Smudge />);

      fireEvent.change(getStrength(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch()).toEqual({ strength: 0 });

      fireEvent.change(getStrength(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch()).toEqual({ strength: 100 });
    });

    it('rounds a fractional strength for display and keeps the slider on the integer', () => {
      resetToolArgs({ strength: 33.7 });
      render(<Smudge />);

      expect(getStrength()).toHaveValue('34');
      expect(caption(getStrength())).toBe('Strength 34%');
    });
  });

  describe('tip controls', () => {
    it('publishes size and hardness as plain numbers on their own fields', () => {
      render(<Smudge />);

      fireEvent.change(getSize(), { target: { value: '120' } });
      flushRaf();
      expect(lastPatch()).toEqual({ size: 120 });

      fireEvent.change(getHardness(), { target: { value: '30' } });
      flushRaf();
      expect(lastPatch()).toEqual({ hardness: 30 });
    });

    it('merges a burst of writes into one patch so two sliders dragged in a frame both land', () => {
      render(<Smudge />);

      fireEvent.change(getSize(), { target: { value: '8' } });
      fireEvent.change(getHardness(), { target: { value: '42' } });
      fireEvent.change(getStrength(), { target: { value: '77' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('smudge', {
        size: 8,
        hardness: 42,
        strength: 77,
      });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<Smudge />);

      fireEvent.change(getSize(), { target: { value: '9' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getSize(), { target: { value: '10' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch()).toEqual({ size: 10 });
    });

    it('leaves the other fields untouched when one control moves', () => {
      resetToolArgs();
      render(<Smudge />);

      fireEvent.change(getSize(), { target: { value: '64' } });
      flushRaf();

      expect(lastPublished()).toEqual({
        toolName: 'smudge',
        size: 64,
        hardness: 100,
        strength: 50,
        points: [],
      });
    });
  });

  describe('clamping of a persisted args object', () => {
    const CASES: readonly [string, Partial<SmudgeToolArgs>, () => HTMLElement, number][] = [
      ['a size above the ceiling', { size: 9999 }, getSize, BRUSH_SIZE_MAX],
      ['a size below the floor', { size: -50 }, getSize, BRUSH_SIZE_MIN],
      ['a hardness above the ceiling', { hardness: 400 }, getHardness, BRUSH_HARDNESS_MAX],
      ['a strength above the ceiling', { strength: 900 }, getStrength, SMUDGE_STRENGTH_MAX],
      ['a strength below the floor', { strength: -20 }, getStrength, SMUDGE_STRENGTH_MIN],
    ];

    it.each(CASES)('renders %s at the range bound rather than the raw value', (_label, overrides, get, expected) => {
      // A persisted value outside Photoshop's range would pin the thumb to the bound while
      // the readout still showed the raw number, so the bar clamps before it renders.
      resetToolArgs(overrides);
      render(<Smudge />);

      expect(caption(get()), _label).toContain(String(expected));
    });

    it('falls a non-finite tip setting back to the brush engine default', () => {
      resetToolArgs({ size: Number.NaN, hardness: Number.NEGATIVE_INFINITY });
      render(<Smudge />);

      // 13 and 100 are `BRUSH_SIZE_DEFAULT` and `BRUSH_HARDNESS_DEFAULT`; a range END would
      // be the dangerous alternative, because a `NaN` tip makes every bounding-box bound
      // `NaN`, which is a loop that silently smudges nothing.
      expect(getSize()).toHaveValue('13');
      expect(getHardness()).toHaveValue('100');
    });

    it('falls a non-finite strength to the near end rather than to the default', () => {
      // The tip goes through `clampBrushTipSettings`, which substitutes a Photoshop default;
      // the strength goes through the bar's own `toPercent`, whose non-finite arm is 0. The
      // asymmetry is deliberate and is what the two arms are for, so both are pinned.
      for (const strength of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        resetToolArgs({ strength });
        const { unmount } = render(<Smudge />);

        expect(getStrength().value, String(strength)).toBe('0');
        expect(caption(getStrength()), String(strength)).toBe('Strength 0%');
        unmount();
      }
    });

    it('cannot write a value outside the tool range through any slider', () => {
      render(<Smudge />);

      // Each event value is chosen to clamp to something DIFFERENT from the seeded one, for
      // two reasons: a controlled `<input type="range">` sanitizes the value it is handed
      // before React ever sees it, and a value that lands on the one already in the DOM
      // produces no change event at all, so a same-valued event would prove nothing.
      const cases = [
        ['size', getSize, '999999', { size: BRUSH_SIZE_MAX }],
        ['hardness', getHardness, '-999999', { hardness: BRUSH_HARDNESS_MIN }],
        ['strength', getStrength, '999999', { strength: SMUDGE_STRENGTH_MAX }],
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
      render(<Smudge />);

      for (const name of ['Size', 'Hardness', 'Strength']) {
        expect(screen.getByRole('slider', { name }), name).toBeInTheDocument();
      }

      fireEvent.change(getSize(), { target: { value: '41' } });
      flushRaf();

      expect(screen.getByRole('slider', { name: 'Size' })).toBeInTheDocument();
    });

    it('keeps focus on the slider across arrow keys', () => {
      render(<Smudge />);

      const strength = getStrength();
      strength.focus();
      expect(strength).toHaveFocus();

      fireEvent.keyDown(strength, { key: 'ArrowRight' });
      fireEvent.keyDown(strength, { key: 'ArrowLeft' });

      expect(strength).toHaveFocus();
    });

    it('keeps every control reachable in tab order', () => {
      render(<Smudge />);

      for (const get of [getSize, getHardness, getStrength]) {
        const slider = get();
        expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
        slider.focus();
        expect(slider).toHaveFocus();
      }
    });
  });
});
