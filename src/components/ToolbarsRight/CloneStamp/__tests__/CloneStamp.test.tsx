import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CloneStamp from '../CloneStamp.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../../../util/brush-engine.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { CloneStampToolArgs } from '../../../../tools/cloneStamp.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * control values repaint from it; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the repo
 * compiles with `babel-plugin-react-compiler`, which memoizes `<CloneStamp />` on its empty
 * props.
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

const getSize = () => screen.getByLabelText('Size') as HTMLInputElement;
const getHardness = () => screen.getByLabelText('Hardness') as HTMLInputElement;
const getOpacity = () => screen.getByLabelText('Opacity') as HTMLInputElement;
const getAligned = () => screen.getByLabelText('Aligned') as HTMLInputElement;

/** The visible caption of the control, label text plus live readout. */
const caption = (control: HTMLElement) => control.parentElement?.textContent ?? '';

/** The seeded clone-stamp defaults: size 40, hardness 100, alpha 1, aligned, no source yet. */
function resetToolArgs(overrides: Partial<CloneStampToolArgs> = {}) {
  toolState.initial = {
    ...structuredClone(defaultSettings['clone-stamp']),
    ...overrides,
  } satisfies CloneStampToolArgs;
  return toolState.initial as CloneStampToolArgs;
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, unknown>;
const lastPublished = () => toolState.initial as CloneStampToolArgs;

describe('CloneStamp toolbar', () => {
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

  it('renders exactly the four controls the clone-stamp args can hold', () => {
    render(<CloneStamp />);

    // `CloneStampToolArgs` is `{ size, hardness, alpha, source, aligned, points }`. The source
    // is an alt-clicked point, not a preference. Photoshop's Mode, Flow, Sample and Brush
    // Preset Picker have no field here, so no select and no second checkbox.
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders the seeded default on every control', () => {
    render(<CloneStamp />);

    // `defaultSettings['clone-stamp']` is size 40, hardness 100, alpha 1, aligned true.
    expect(getSize()).toHaveValue('40');
    expect(getHardness()).toHaveValue('100');
    expect(getOpacity()).toHaveValue('100');
    expect(getAligned()).toBeChecked();
    expect(caption(getSize())).toBe('Size40px');
    expect(caption(getHardness())).toBe('Hardness100%');
    expect(caption(getOpacity())).toBe('Opacity100%');
  });

  it('takes the tip bounds from the shared brush engine and the opacity bounds from the bar', () => {
    render(<CloneStamp />);

    for (const [slider, min, max] of [
      [getSize(), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX],
      [getHardness(), BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX],
    ] as const) {
      expect(slider, `${min}-${max}`).toHaveAttribute('min', String(min));
      expect(slider, `${min}-${max}`).toHaveAttribute('max', String(max));
      expect(slider, `${min}-${max}`).toHaveAttribute('step', '1');
    }
    expect(getOpacity()).toHaveAttribute('min', '0');
    expect(getOpacity()).toHaveAttribute('max', '100');
    expect(getOpacity()).toHaveAttribute('step', '1');
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'eraser' as CloneStampToolArgs['toolName'] });
    const { container } = render(<CloneStamp />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('opacity scale', () => {
    it('writes the 0-1 alpha the processor blends with rather than the 0-100 the slider shows', () => {
      render(<CloneStamp />);

      fireEvent.change(getOpacity(), { target: { value: '35' } });
      flushRaf();

      // The scale conversion is the thing most likely to rot silently: the slider is a
      // percentage and `alpha` is a 0-1 coverage, so 35 has to land as 0.35. `blendPixel` is
      // the composite and it reads that alpha directly.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith(
        'clone-stamp',
        expect.objectContaining({ alpha: 0.35 })
      );
      expect(lastPatch().alpha).toBe(0.35);
      expect(getOpacity()).toHaveValue('35');
      expect(caption(getOpacity())).toBe('Opacity35%');
    });

    it('converts both slider boundaries to the ends of the 0-1 range', () => {
      render(<CloneStamp />);

      fireEvent.change(getOpacity(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(0);

      fireEvent.change(getOpacity(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(1);
    });

    it('renders the rounded percentage of a fractional alpha', () => {
      resetToolArgs({ alpha: 0.456 });
      render(<CloneStamp />);

      expect(getOpacity()).toHaveValue('46');
      expect(caption(getOpacity())).toBe('Opacity46%');
    });
  });

  describe('tip controls', () => {
    it('publishes size and hardness as plain numbers on their own fields', () => {
      render(<CloneStamp />);

      fireEvent.change(getSize(), { target: { value: '120' } });
      flushRaf();
      expect(lastPatch()).toEqual({ size: 120 });

      fireEvent.change(getHardness(), { target: { value: '30' } });
      flushRaf();
      expect(lastPatch()).toEqual({ hardness: 30 });
    });

    it('coalesces a burst of changes on one slider into one write carrying the last value', () => {
      render(<CloneStamp />);

      fireEvent.change(getSize(), { target: { value: '10' } });
      fireEvent.change(getSize(), { target: { value: '20' } });
      fireEvent.change(getSize(), { target: { value: '30' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      // The pending PATCH is replaced wholesale rather than merged, so a value the user never
      // moved cannot survive in the frame that flushes.
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(mockPatchToolArgs.mock.lastCall?.[1]).toEqual({ size: 30 });
    });

    it('keeps only the last field when two different sliders move inside one frame', () => {
      // PIN, not endorsement, and unlike the bucket's this one is a deliberate choice: the
      // pending patch is REPLACED rather than merged (`CloneStamp.tsx:90`), so the flushed
      // write carries the newest field and the earlier one is not in it. The patch path
      // merges onto the args inside `patchToolArgs`, so the two sliders' values are not lost
      // from the document — only one of them is part of the single write this frame makes.
      render(<CloneStamp />);

      fireEvent.change(getSize(), { target: { value: '20' } });
      fireEvent.change(getOpacity(), { target: { value: '60' } });
      flushRaf();

      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(mockPatchToolArgs.mock.lastCall?.[1]).toEqual({ alpha: 0.6 });
      expect(lastPublished().size).toBe(40);
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<CloneStamp />);

      fireEvent.change(getSize(), { target: { value: '9' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getSize(), { target: { value: '10' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch()).toEqual({ size: 10 });
    });
  });

  describe('aligned checkbox', () => {
    it('writes the checked state through patchToolArgs without a frame', () => {
      render(<CloneStamp />);

      fireEvent.click(getAligned());

      // The checkbox deliberately does NOT go through the frame: it fires once per click, and
      // a checkbox whose tick lags a paint reads as broken.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('clone-stamp', { aligned: false });
      expect(rafCallbacks).toHaveLength(0);
      expect(getAligned()).not.toBeChecked();
    });

    it('clears aligned again on a second click', () => {
      resetToolArgs({ aligned: false });
      render(<CloneStamp />);

      expect(getAligned()).not.toBeChecked();

      fireEvent.click(getAligned());

      expect(lastPatch()).toEqual({ aligned: true });
      expect(getAligned()).toBeChecked();
    });
  });

  describe('source passthrough', () => {
    it('carries the alt-clicked source through a slider write instead of dropping it', () => {
      const source = { x: 64, y: 48 };
      resetToolArgs({ source });
      render(<CloneStamp />);

      fireEvent.change(getSize(), { target: { value: '50' } });
      flushRaf();

      // There is no source readout and no "clear source" button: the source is a document
      // point in the args, and a control that writes nowhere is worse than a missing one. So
      // the write path has to leave it exactly where it was.
      expect(lastPublished()).toEqual({
        toolName: 'clone-stamp',
        size: 50,
        hardness: 100,
        alpha: 1,
        source,
        aligned: true,
        points: [],
      });
    });

    it('carries a null source through unchanged while none has been picked', () => {
      resetToolArgs({ source: null });
      render(<CloneStamp />);

      fireEvent.change(getHardness(), { target: { value: '50' } });
      flushRaf();

      expect(lastPublished().source).toBeNull();
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<CloneStamp />);

      for (const name of ['Size', 'Hardness', 'Opacity', 'Aligned']) {
        expect(screen.getByLabelText(name), name).toBeInTheDocument();
      }

      fireEvent.change(getSize(), { target: { value: '41' } });
      flushRaf();

      expect(screen.getByLabelText('Size')).toBeInTheDocument();
    });

    it('toggles aligned from the keyboard', () => {
      render(<CloneStamp />);

      const aligned = getAligned();
      aligned.focus();
      expect(aligned).toHaveFocus();

      fireEvent.click(aligned);

      expect(lastPatch()).toEqual({ aligned: false });
    });

    it('keeps every control reachable in tab order', () => {
      render(<CloneStamp />);

      for (const get of [getSize, getHardness, getOpacity, getAligned]) {
        const control = get();
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
        control.focus();
        expect(control).toHaveFocus();
      }
    });
  });
});
