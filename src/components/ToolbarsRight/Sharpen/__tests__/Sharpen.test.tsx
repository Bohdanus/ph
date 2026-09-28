import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sharpen from '../Sharpen.tsx';
import {
  SHARPEN_AMOUNT_MAX,
  SHARPEN_AMOUNT_MIN,
  SHARPEN_RADIUS_MAX,
  SHARPEN_RADIUS_MIN,
} from '../../../../tools/sharpen.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { SharpenToolArgs } from '../../../../tools/sharpen.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from, and the one
 * `setToolArgs` publishes back.
 *
 * This bar is one of the two that reads `toolArgs` directly rather than through
 * `getToolArgs`, so the repaint has to be real: a bare spy would leave the thumb and the
 * readout on the pre-drag value, and the assertion that the bar tracks its own writes would
 * be unfalsifiable. Real `useState` (rather than assigning a module variable) is what makes the
 * repaint observable, because the repo compiles with `babel-plugin-react-compiler`, which
 * memoizes `<Sharpen />` on its empty props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockPatchToolArgs = vi.hoisted(() => vi.fn());

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
      };
    },
  };
});

/** The preview writer. `tempUpdateLayer` is the only writer of `previewLayersRef`. */
vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ tempUpdateLayer: mockTempUpdateLayer }),
}));

const rafCallbacks: FrameRequestCallback[] = [];

const flushRaf = () => {
  act(() => {
    rafCallbacks.splice(0, rafCallbacks.length).forEach((callback) => callback(0));
  });
};

const getAmount = () => screen.getByRole('slider', { name: 'Amount' }) as HTMLInputElement;
const getRadius = () => screen.getByRole('slider', { name: 'Radius' }) as HTMLInputElement;

/** The readout is a SIBLING of the label here, so the caption is the field wrapper's text. */
const caption = (slider: HTMLElement) => slider.parentElement?.textContent ?? '';

/** The seeded sharpen defaults: amount 50, radius 1. */
function resetToolArgs(overrides: Partial<SharpenToolArgs> = {}) {
  toolState.initial = { ...structuredClone(defaultSettings.sharpen), ...overrides } satisfies SharpenToolArgs;
  return toolState.initial as SharpenToolArgs;
}

const lastArgs = () => mockSetToolArgs.mock.lastCall?.[0] as SharpenToolArgs;

describe('Sharpen toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    mockSetToolArgs.mockClear();
    mockTempUpdateLayer.mockClear();
    mockPatchToolArgs.mockClear();
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

  it('renders exactly the two controls the sharpen args can hold', () => {
    render(<Sharpen />);

    // `SharpenToolArgs` is `{ amount, radius }`. Photoshop's third control, Sample All
    // Layers, needs a field this args type does not have and a different commit shape, so
    // there is no checkbox here and no Apply button: the filter applies as the user drags.
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the seeded default on both controls', () => {
    render(<Sharpen />);

    expect(getAmount()).toHaveValue('50');
    expect(getRadius()).toHaveValue('1');
    expect(caption(getAmount())).toBe('Amount50%');
    expect(caption(getRadius())).toBe('Radius1px');
  });

  it('takes its bounds from the tool module rather than the Photoshop dialog defaults', () => {
    render(<Sharpen />);

    // Amount goes to 500 because `SHARPEN_AMOUNT_MAX` says so, and Radius stops at 100 rather
    // than Photoshop's 250 because a 501-wide kernel is walked over every pixel on every frame
    // of a drag. Both ceilings are the tool's own constants and the bar imports them.
    expect(getAmount()).toHaveAttribute('min', String(SHARPEN_AMOUNT_MIN));
    expect(getAmount()).toHaveAttribute('max', String(SHARPEN_AMOUNT_MAX));
    expect(getRadius()).toHaveAttribute('min', String(SHARPEN_RADIUS_MIN));
    expect(getRadius()).toHaveAttribute('max', String(SHARPEN_RADIUS_MAX));
    expect(getAmount()).toHaveAttribute('step', '1');
    expect(getRadius()).toHaveAttribute('step', '1');
  });

  describe('write path', () => {
    it('previews the layer and publishes the args in that order on the next frame', () => {
      render(<Sharpen />);

      fireEvent.change(getRadius(), { target: { value: '4' } });

      // Throttled: nothing reaches the store before the animation frame runs.
      expect(mockTempUpdateLayer).not.toHaveBeenCalled();
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      flushRaf();

      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({
        toolArgs: { amount: 50, radius: 4, toolName: 'sharpen' },
      });
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({ amount: 50, radius: 4, toolName: 'sharpen' });
      // The ORDER is load-bearing. `previewLayers` is a mutable ref rather than state, so a
      // render that observed the args before the preview landed would show the previous
      // radius's pixels under the new radius's thumb.
      expect(mockTempUpdateLayer.mock.invocationCallOrder[0]).toBeLessThan(mockSetToolArgs.mock.invocationCallOrder[0]);
    });

    it('replaces the whole args object rather than merging into the previous one', () => {
      resetToolArgs();
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '120' } });
      flushRaf();

      // `throttledOnChange` spreads `args` and overwrites one field, so a value the user never
      // moved cannot survive in the frame that flushes, and no field can be invented.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        amount: 120,
        radius: 1,
        toolName: 'sharpen',
      });
    });

    it('coalesces a burst of changes into one write carrying the last value', () => {
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '60' } });
      fireEvent.change(getAmount(), { target: { value: '70' } });
      fireEvent.change(getAmount(), { target: { value: '80' } });

      expect(rafCallbacks).toHaveLength(1);

      flushRaf();

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledWith({ amount: 80, radius: 1, toolName: 'sharpen' });
      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(1);
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '90' } });
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getAmount(), { target: { value: '91' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
      expect(lastArgs().amount).toBe(91);
    });

    it('republishes the throttled value so the thumb and the readout track the write', () => {
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '250' } });
      flushRaf();

      // The state write is the only reason the thumb follows the drag: a spy that recorded
      // the call without publishing would leave the control on the pre-drag value.
      expect(getAmount()).toHaveValue('250');
      expect(caption(getAmount())).toBe('Amount250%');
    });

    it('never routes a slider through patchToolArgs', () => {
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '70' } });
      fireEvent.change(getRadius(), { target: { value: '5' } });
      flushRaf();

      // This bar owns the whole args object because it previews and publishes the same
      // payload; a patch would leave the preview and the args able to disagree.
      expect(mockPatchToolArgs).not.toHaveBeenCalled();
    });

    it('names no layer, so the preview falls back to the active one', () => {
      render(<Sharpen />);

      fireEvent.change(getAmount(), { target: { value: '80' } });
      flushRaf();

      // `tempUpdateLayer` defaults to `activeLayerId` and returns early without one, which
      // is exactly the no-layer case; naming it here would add a non-null assertion the
      // function does not need.
      expect(mockTempUpdateLayer.mock.lastCall?.[0]).not.toHaveProperty('id');
    });
  });

  describe('clamping of a persisted args object', () => {
    const CASES: readonly [string, Partial<SharpenToolArgs>, () => HTMLInputElement, number][] = [
      ['an amount above the ceiling', { amount: 9999 }, getAmount, SHARPEN_AMOUNT_MAX],
      ['an amount below the floor', { amount: -100 }, getAmount, SHARPEN_AMOUNT_MIN],
      ['a radius above the ceiling', { radius: 400 }, getRadius, SHARPEN_RADIUS_MAX],
      ['a radius below the floor', { radius: -3 }, getRadius, SHARPEN_RADIUS_MIN],
    ];

    it.each(CASES)('renders %s at the range bound rather than the raw value', (_label, overrides, get, expected) => {
      // Settings round-trip through `localStorage` and are restored before anything clamps
      // them, so a hand-edited or legacy value CAN be out of range. A controlled range input
      // whose `value` is outside its own min/max pins the thumb to the bound while the
      // readout shows the raw number, so the bar clamps before it renders.
      resetToolArgs(overrides);
      render(<Sharpen />);

      expect(get().value, _label).toBe(String(expected));
    });

    it('falls a non-finite setting to the near end of its range', () => {
      // The fallback is `SHARPEN_*_MIN`, not the Photoshop default: 0% amount and a 0px radius
      // are both legal identities, so the bar's clamp is the same one `sharpen.ts` applies
      // before the kernel runs and the two agree about what is about to be computed. Only the
      // field that was poisoned moves — the other keeps the seeded value, which is the whole
      // point of a per-field clamp.
      const cases = [
        ['amount', { amount: Number.NaN }, Number.NaN, getAmount, getRadius, '1'],
        ['amount', { amount: Number.POSITIVE_INFINITY }, Number.POSITIVE_INFINITY, getAmount, getRadius, '1'],
        ['radius', { radius: Number.NaN }, Number.NaN, getRadius, getAmount, '50'],
        ['radius', { radius: Number.NEGATIVE_INFINITY }, Number.NEGATIVE_INFINITY, getRadius, getAmount, '50'],
      ] as const;

      for (const [field, overrides, raw, get, getOther, untouched] of cases) {
        resetToolArgs(overrides);
        const { unmount } = render(<Sharpen />);

        expect(get().value, `${field} ${String(raw)}`).toBe('0');
        expect(getOther().value, field).toBe(untouched);
        unmount();
      }
    });

    it('cannot write a value outside the tool range through either slider', () => {
      render(<Sharpen />);

      // Each event value clamps to something DIFFERENT from the seeded one: a value landing on
      // the value already in the DOM produces no change event, so a same-valued event would
      // prove nothing.
      for (const [get, value, expected] of [
        [getAmount, '999999', { amount: SHARPEN_AMOUNT_MAX }],
        [getRadius, '999999', { radius: SHARPEN_RADIUS_MAX }],
      ] as const) {
        fireEvent.change(get(), { target: { value } });
        flushRaf();

        expect(lastArgs(), value).toMatchObject(expected);
      }
    });
  });

  describe('tool identity', () => {
    it('renders the sharpen settings even when another tool is active', () => {
      // This bar reads `toolArgs` and casts, rather than going through `getToolArgs`, so it has
      // no "is this my tool" guard. It is the one options bar in the new set that behaves that
      // way, and the pin is here so the difference is recorded rather than discovered: a
      // filter bar is mounted from the options-bar row for the tool the user just picked, and
      // `ToolbarHorizontal` remounts it on `key={toolName}`.
      resetToolArgs({ toolName: 'blur' as SharpenToolArgs['toolName'] });
      const { container } = render(<Sharpen />);

      expect(container).not.toBeEmptyDOMElement();
      expect(getAmount()).toBeInTheDocument();
      expect(getRadius()).toBeInTheDocument();
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<Sharpen />);

      for (const name of ['Amount', 'Radius']) {
        expect(screen.getByRole('slider', { name }), name).toBeInTheDocument();
      }

      fireEvent.change(getAmount(), { target: { value: '51' } });
      flushRaf();

      expect(screen.getByRole('slider', { name: 'Amount' })).toBeInTheDocument();
    });

    it('keeps focus on the slider across arrow keys', () => {
      render(<Sharpen />);

      const amount = getAmount();
      amount.focus();
      expect(amount).toHaveFocus();

      fireEvent.keyDown(amount, { key: 'ArrowRight' });
      fireEvent.keyDown(amount, { key: 'ArrowLeft' });

      expect(amount).toHaveFocus();
    });

    it('keeps every control reachable in tab order', () => {
      render(<Sharpen />);

      for (const get of [getAmount, getRadius]) {
        const slider = get();
        expect(slider.tabIndex).toBeGreaterThanOrEqual(0);
        slider.focus();
        expect(slider).toHaveFocus();
      }
    });
  });
});
