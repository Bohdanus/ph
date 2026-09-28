import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaintBucket from '../PaintBucket.tsx';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { PaintBucketToolArgs } from '../../../../tools/paintBucket.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * slider thumbs repaint from it; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the repo
 * compiles with `babel-plugin-react-compiler`, which memoizes `<PaintBucket />` on its empty
 * props.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());

/** The one store field this bar reads: the foreground colour the bucket fills with. */
const storeState = vi.hoisted(() => ({ color: '#000000' }));

// `useStore` is mocked directly rather than through `StoreProvider`, which is the house
// pattern for every `ToolbarsRight` suite: the provider pulls in the durable
// replay/materialization path, which does not survive jsdom.
vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, dispatchMock],
}));

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

const getTolerance = () => screen.getByRole('slider', { name: 'Tolerance' }) as HTMLInputElement;
const getOpacity = () => screen.getByRole('slider', { name: 'Opacity' }) as HTMLInputElement;
const getContiguous = () => screen.getByRole('checkbox', { name: 'Contiguous' }) as HTMLInputElement;
const getFillColour = () => screen.getByLabelText('Fill colour') as HTMLInputElement;

/** The visible caption of the control, label text plus live readout. */
const caption = (slider: HTMLElement) => slider.parentElement?.textContent ?? '';

/** The seeded bucket defaults: tolerance 32, contiguous true, alpha 1, no seed yet. */
function resetToolArgs(overrides: Partial<PaintBucketToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings['paint-bucket']),
    ...overrides,
  } satisfies PaintBucketToolArgs;
  return toolState.initial as PaintBucketToolArgs;
}

function resetState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, { color: '#000000', ...overrides });
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, unknown>;
const lastPublished = () => toolState.initial as PaintBucketToolArgs;

describe('PaintBucket toolbar', () => {
  beforeEach(() => {
    resetState();
    resetToolArgs();
    mockPatchToolArgs.mockClear();
    mockSetToolArgs.mockClear();
    dispatchMock.mockClear();
    rafCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    resetState();
    resetToolArgs();
    rafCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it('renders exactly the controls the bucket args can hold', () => {
    render(<PaintBucket />);

    // `PaintBucketToolArgs` is `{ color, tolerance, contiguous, alpha, seed }`. The seed is a
    // click, not a preference. Photoshop's All Layers and Blend Mode have no field here, so
    // there is no select and no second colour control.
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders the seeded default on every control', () => {
    render(<PaintBucket />);

    // `defaultSettings['paint-bucket']` is tolerance 32, contiguous true, alpha 1, and the
    // Opacity slider is the 0-100 face of the 0-1 `alpha`.
    expect(getTolerance()).toHaveValue('32');
    expect(getOpacity()).toHaveValue('100');
    expect(getContiguous()).toBeChecked();
    expect(getFillColour()).toHaveValue('#000000');
    expect(caption(getTolerance())).toBe('Tolerance32%');
    expect(caption(getOpacity())).toBe('Opacity100%');
  });

  it('exposes the whole 0-100 range on both sliders', () => {
    render(<PaintBucket />);

    // The bucket's tolerance is a bare percentage here, with no tool-module constant to
    // import: the flood fill reads it directly, and the slider is its own 0-100 face.
    for (const slider of [getTolerance(), getOpacity()]) {
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '100');
      expect(slider).toHaveAttribute('step', '1');
    }
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'gradient' as PaintBucketToolArgs['toolName'] });
    const { container } = render(<PaintBucket />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('opacity scale', () => {
    it('writes the 0-1 alpha the processor blends with rather than the 0-100 the slider shows', () => {
      render(<PaintBucket />);

      fireEvent.change(getOpacity(), { target: { value: '35' } });
      flushRaf();

      // The scale conversion is the thing most likely to rot silently: the slider is a
      // percentage and `alpha` is a 0-1 source-over coverage, so 35 has to land as 0.35.
      // `blendPixel` composites the fill at that alpha, so 35 written as 35 would paint
      // nothing at all.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith(
        'paint-bucket',
        expect.objectContaining({ alpha: 0.35 })
      );
      expect(lastPatch().alpha).toBe(0.35);
      expect(getOpacity()).toHaveValue('35');
      expect(caption(getOpacity())).toBe('Opacity35%');
    });

    it('converts both slider boundaries to the ends of the 0-1 range', () => {
      render(<PaintBucket />);

      fireEvent.change(getOpacity(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(0);

      fireEvent.change(getOpacity(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(1);
    });

    it('renders the rounded percentage of a fractional alpha', () => {
      resetToolArgs({ alpha: 0.456 });
      render(<PaintBucket />);

      expect(getOpacity()).toHaveValue('46');
      expect(caption(getOpacity())).toBe('Opacity46%');
    });
  });

  describe('tolerance', () => {
    it('writes the percentage the flood fill reads, with no scale conversion', () => {
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '44' } });
      flushRaf();

      // Tolerance is a percentage on both sides: `floodFill` takes `{ tolerance }` and
      // compares it against a per-channel distance, so there is nothing to divide here.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith(
        'paint-bucket',
        expect.objectContaining({ tolerance: 44 })
      );
      expect(lastPatch().tolerance).toBe(44);
      expect(caption(getTolerance())).toBe('Tolerance44%');
    });

    it('accepts both range boundaries', () => {
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch().tolerance).toBe(0);

      fireEvent.change(getTolerance(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch().tolerance).toBe(100);
    });
  });

  describe('contiguous checkbox', () => {
    it('writes the checked state through patchToolArgs without a frame', () => {
      render(<PaintBucket />);

      fireEvent.click(getContiguous());

      // A checkbox fires once per click, so routing it through the frame would make the tick
      // lag by one paint — which reads as broken. It is also the only control here that is
      // not a slider, and it is the only one that bypasses `throttledPatch`.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith(
        'paint-bucket',
        expect.objectContaining({
          contiguous: false,
        })
      );
      expect(rafCallbacks).toHaveLength(0);
    });

    it('clears contiguous again on a second click', () => {
      resetToolArgs({ contiguous: false });
      render(<PaintBucket />);

      expect(getContiguous()).not.toBeChecked();

      fireEvent.click(getContiguous());

      expect(lastPatch().contiguous).toBe(true);
      expect(getContiguous()).toBeChecked();
    });
  });

  describe('fill colour', () => {
    it('dispatches SET_COLOR rather than writing a colour field of its own', () => {
      render(<PaintBucket />);

      fireEvent.change(getFillColour(), { target: { value: '#ff0000' } });

      // The store already has ONE foreground colour, written by the SidebarLeft swatch that
      // `e2e/helpers/color-helpers.ts` drives. A second colour source in this bar would mean
      // the swatch the e2e helpers set and the colour the bucket fills with could disagree.
      expect(dispatchMock).toHaveBeenCalledExactlyOnceWith({ type: 'SET_COLOR', payload: '#ff0000' });
      expect(mockPatchToolArgs).not.toHaveBeenCalled();
    });

    it('binds the input to the store colour rather than to the args colour', () => {
      // The args still hold the seeded black here, so a bar that read `args.color` would show
      // black while the store says red.
      resetState({ color: '#00ff00' });
      render(<PaintBucket />);

      expect(getFillColour()).toHaveValue('#00ff00');
    });

    it('carries the store colour into the args on mount, and only when they differ', () => {
      resetState({ color: '#ff0000' });
      render(<PaintBucket />);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'paint-bucket',
        color: '#ff0000',
        tolerance: 32,
        contiguous: true,
        alpha: 1,
        seed: null,
      });
      expect(lastPublished().color).toBe('#ff0000');
    });

    it('does not republish the args when the tool args already match the store colour', () => {
      resetToolArgs({ color: '#000000' });
      render(<PaintBucket />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });

    it('adopts a later store change so the swatch and the fill colour cannot drift apart', () => {
      const { rerender } = render(<PaintBucket />);
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      resetState({ color: '#0000ff' });
      rerender(<PaintBucket />);

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ color: '#0000ff', toolName: 'paint-bucket' })
      );
      expect(getFillColour()).toHaveValue('#0000ff');
    });
  });

  describe('throttling', () => {
    it('coalesces a burst of changes on ONE slider into a single write carrying the last value', () => {
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '10' } });
      fireEvent.change(getTolerance(), { target: { value: '20' } });
      fireEvent.change(getTolerance(), { target: { value: '30' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      // The pending value is kept in a ref precisely so the frame that lands carries the
      // newest one rather than the value the drag started on.
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(mockPatchToolArgs.mock.lastCall?.[1]).toMatchObject({ tolerance: 30 });
    });

    it('drops the earlier field when two different sliders move inside one frame', () => {
      // PIN, not endorsement. `throttledPatch` builds its pending payload as
      // `{ ...args, ...patch }` off the `args` CAPTURED WHEN THE FRAME WAS SCHEDULED, and
      // replaces the ref wholesale rather than merging. So the second slider's event
      // rebuilds the payload from the pre-frame args and the first slider's value is gone.
      // `Eraser.tsx:77` and `Smudge.tsx:79` merge their pending patches instead, and
      // `QuickSelection.tsx:60` does too — this bar is the one that does not.
      //
      // It is not cosmetic: `tolerance` is the flood fill's only similarity threshold, so a
      // user who drags Tolerance and then nudges Opacity before the next frame commits a
      // fill at the OLD tolerance and sees the fill they were trying to tune come back
      // different. The fix is in `PaintBucket.tsx` — merge into `pendingRef.current` the way
      // the other three bars do — and this assertion fails the moment it lands.
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '10' } });
      fireEvent.change(getTolerance(), { target: { value: '20' } });
      fireEvent.change(getOpacity(), { target: { value: '60' } });
      flushRaf();

      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(mockPatchToolArgs.mock.lastCall?.[1]).toMatchObject({
        // The seeded tolerance, not the 20 the drag stopped on.
        tolerance: 32,
        alpha: 0.6,
      });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '5' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getTolerance(), { target: { value: '6' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch().tolerance).toBe(6);
    });
  });

  describe('seed passthrough', () => {
    it('carries the last click seed through a slider write instead of dropping it', () => {
      const seed = { x: 12, y: 7 };
      resetToolArgs({ seed });
      render(<PaintBucket />);

      fireEvent.change(getTolerance(), { target: { value: '50' } });
      flushRaf();

      // The bar has no seed control and must not clear one: the seed is what a replayed
      // `TOOL_ACTION` re-runs the processor with, so losing it here would make the next click
      // the only thing that could produce a fill.
      expect(lastPublished()).toEqual({
        toolName: 'paint-bucket',
        color: '#000000',
        tolerance: 50,
        contiguous: true,
        alpha: 1,
        seed,
      });
    });

    it('carries a null seed through unchanged while no click has happened', () => {
      resetToolArgs({ seed: null });
      render(<PaintBucket />);

      fireEvent.change(getOpacity(), { target: { value: '80' } });
      flushRaf();

      expect(lastPublished().seed).toBeNull();
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<PaintBucket />);

      for (const name of ['Tolerance', 'Opacity', 'Contiguous', 'Fill colour']) {
        expect(screen.getByLabelText(name), name).toBeInTheDocument();
      }

      fireEvent.change(getTolerance(), { target: { value: '33' } });
      flushRaf();

      expect(screen.getByLabelText('Tolerance')).toBeInTheDocument();
    });

    it('keeps focus on the control across arrow keys', () => {
      render(<PaintBucket />);

      const tolerance = getTolerance();
      tolerance.focus();
      expect(tolerance).toHaveFocus();

      fireEvent.keyDown(tolerance, { key: 'ArrowRight' });
      fireEvent.keyDown(tolerance, { key: 'ArrowLeft' });

      expect(tolerance).toHaveFocus();
    });

    it('toggles contiguous from the keyboard', () => {
      render(<PaintBucket />);

      const contiguous = getContiguous();
      contiguous.focus();
      expect(contiguous).toHaveFocus();

      fireEvent.click(contiguous);

      expect(lastPatch().contiguous).toBe(false);
    });
  });
});
