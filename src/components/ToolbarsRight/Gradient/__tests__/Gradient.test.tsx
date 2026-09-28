import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Gradient from '../Gradient.tsx';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { GradientToolArgs } from '../../../../tools/gradient.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * slider thumb repaint from it; a bare spy never does. Real `useState` (rather than assigning
 * a module variable) is what makes the repaint observable here, because the repo compiles with
 * `babel-plugin-react-compiler`, which memoizes `<Gradient />` on its empty props.
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

const getType = () => screen.getByLabelText('Type') as HTMLSelectElement;
const getOpacity = () => screen.getByLabelText('Opacity') as HTMLInputElement;
const getColourA = () => screen.getByLabelText('Colour A') as HTMLInputElement;
const getColourB = () => screen.getByLabelText('Colour B') as HTMLInputElement;

/** The visible caption of the control, label text plus live readout. */
const caption = (slider: HTMLElement) => slider.parentElement?.textContent ?? '';

/** The seeded gradient defaults: linear, black to white, alpha 1, no drag yet. */
function resetToolArgs(overrides: Partial<GradientToolArgs> = {}) {
  toolState.initial = { ...structuredClone(defaultSettings.gradient), ...overrides } satisfies GradientToolArgs;
  return toolState.initial as GradientToolArgs;
}

const lastPatch = () => mockPatchToolArgs.mock.lastCall?.[1] as Record<string, unknown>;
const lastPublished = () => toolState.initial as GradientToolArgs;

describe('Gradient toolbar', () => {
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

  it('renders exactly the controls the gradient args can hold', () => {
    render(<Gradient />);

    // `GradientToolArgs` is `{ type, from, to, colorA, colorB, alpha }`. `from`/`to` are the
    // drag rather than a preference, so they are not controls. Photoshop's Angle, Reflected,
    // Diamond, reverse/loop/dither group and per-stop opacity have no field here.
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders the seeded default on every control', () => {
    render(<Gradient />);

    // `defaultSettings.gradient` is linear, colourA black, colourB white, alpha 1.
    expect(getType()).toHaveValue('linear');
    expect(getOpacity()).toHaveValue('100');
    expect(getColourA()).toHaveValue('#000000');
    expect(getColourB()).toHaveValue('#ffffff');
    expect(caption(getOpacity())).toBe('Opacity100%');
  });

  it('exposes exactly the two gradient types the args union can hold, in DOM order', () => {
    render(<Gradient />);

    // Photoshop ships five; the args type holds two, and an option the processor cannot be
    // given is a value the bar would render and the tool would ignore.
    const options = Array.from(getType().options, (option) => [option.value, option.textContent]);

    expect(options).toEqual([
      ['linear', 'Linear'],
      ['radial', 'Radial'],
    ]);
  });

  it('exposes the whole 0-100 range on the opacity slider', () => {
    render(<Gradient />);

    expect(getOpacity()).toHaveAttribute('min', '0');
    expect(getOpacity()).toHaveAttribute('max', '100');
    expect(getOpacity()).toHaveAttribute('step', '1');
  });

  it('renders nothing while another tool is active', () => {
    resetToolArgs({ toolName: 'paint-bucket' as GradientToolArgs['toolName'] });
    const { container } = render(<Gradient />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('type select', () => {
    it('writes the selected type through patchToolArgs without a frame', () => {
      render(<Gradient />);

      fireEvent.change(getType(), { target: { value: 'radial' } });

      // A dropdown fires once per choice, so a frame of delay would make the readout lag the
      // click — which reads as broken rather than as throttling.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('gradient', { type: 'radial' });
      expect(rafCallbacks).toHaveLength(0);
      expect(getType()).toHaveValue('radial');
    });

    it('ignores a value the args type cannot hold instead of writing it through', () => {
      render(<Gradient />);

      // The bar looks the value up in `GRADIENT_TYPES` and returns early on a miss, so a
      // value the processor has no case for can never reach the args.
      fireEvent.change(getType(), { target: { value: 'angle' } });

      expect(mockPatchToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('opacity scale', () => {
    it('writes the 0-1 alpha the processor blends with rather than the 0-100 the slider shows', () => {
      render(<Gradient />);

      fireEvent.change(getOpacity(), { target: { value: '35' } });
      flushRaf();

      // The scale conversion is the thing most likely to rot silently: the slider is a
      // percentage and `alpha` is a 0-1 coverage, so 35 has to land as 0.35. `sampleStop`
      // builds an opaque colour and the composite is `blendPixel` at that alpha, so writing 35
      // would clamp to fully opaque.
      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('gradient', expect.objectContaining({ alpha: 0.35 }));
      expect(lastPatch().alpha).toBe(0.35);
      expect(getOpacity()).toHaveValue('35');
      expect(caption(getOpacity())).toBe('Opacity35%');
    });

    it('converts both slider boundaries to the ends of the 0-1 range', () => {
      render(<Gradient />);

      fireEvent.change(getOpacity(), { target: { value: '0' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(0);

      fireEvent.change(getOpacity(), { target: { value: '100' } });
      flushRaf();
      expect(lastPatch().alpha).toBe(1);
    });

    it('renders the rounded percentage of a fractional alpha', () => {
      resetToolArgs({ alpha: 0.456 });
      render(<Gradient />);

      expect(getOpacity()).toHaveValue('46');
      expect(caption(getOpacity())).toBe('Opacity46%');
    });
  });

  describe('colour stops', () => {
    it('writes each stop through patchToolArgs without a frame', () => {
      render(<Gradient />);

      fireEvent.change(getColourA(), { target: { value: '#ff0000' } });

      expect(mockPatchToolArgs).toHaveBeenCalledExactlyOnceWith('gradient', { colorA: '#ff0000' });
      expect(rafCallbacks).toHaveLength(0);
      expect(getColourA()).toHaveValue('#ff0000');

      fireEvent.change(getColourB(), { target: { value: '#0000ff' } });

      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(mockPatchToolArgs).toHaveBeenLastCalledWith('gradient', { colorB: '#0000ff' });
      expect(getColourB()).toHaveValue('#0000ff');
    });

    it('keeps the stops in the args rather than in the store, because the store has one colour', () => {
      resetToolArgs();
      render(<Gradient />);

      fireEvent.change(getColourA(), { target: { value: '#123456' } });

      // The bucket can write its fill colour through `SET_COLOR` because there is exactly one
      // colour in the store. A gradient needs a PAIR, so both stops live in the tool args and
      // are persisted by `saveLastSettings` like every other setting.
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      expect(lastPublished().colorA).toBe('#123456');
    });
  });

  describe('drag endpoints', () => {
    it('carries the last drag through every write instead of resetting it', () => {
      const from = { x: 3, y: 4 };
      const to = { x: 30, y: 40 };
      resetToolArgs({ from, to });
      render(<Gradient />);

      fireEvent.change(getOpacity(), { target: { value: '80' } });
      flushRaf();

      // `from`/`to` are the geometry of the last drag. A control here has no way to set them,
      // so losing them would silently collapse the next drag to the last one's axes.
      expect(lastPublished()).toEqual({
        toolName: 'gradient',
        type: 'linear',
        from,
        to,
        colorA: '#000000',
        colorB: '#FFFFFF',
        alpha: 0.8,
      });
    });

    it('renders the seeded zero-length drag without touching it', () => {
      render(<Gradient />);

      // A zero-length drag is the honest seed: the options bar sets the stops before the
      // first commit, and `readAxis` treats zero length as degenerate rather than dividing
      // by it.
      expect(lastPublished().from).toEqual({ x: 0, y: 0 });
      expect(lastPublished().to).toEqual({ x: 0, y: 0 });
    });
  });

  describe('throttling', () => {
    it('coalesces a burst of opacity changes into one write carrying the last value', () => {
      render(<Gradient />);

      fireEvent.change(getOpacity(), { target: { value: '10' } });
      fireEvent.change(getOpacity(), { target: { value: '20' } });
      fireEvent.change(getOpacity(), { target: { value: '30' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockPatchToolArgs).not.toHaveBeenCalled();

      flushRaf();

      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(mockPatchToolArgs.mock.lastCall?.[1]).toMatchObject({ alpha: 0.3 });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<Gradient />);

      fireEvent.change(getOpacity(), { target: { value: '5' } });
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getOpacity(), { target: { value: '6' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
      expect(lastPatch().alpha).toBe(0.06);
    });
  });

  describe('keyboard navigation', () => {
    it('gives every control a stable accessible name that does not move with the readout', () => {
      render(<Gradient />);

      for (const name of ['Type', 'Opacity', 'Colour A', 'Colour B']) {
        expect(screen.getByLabelText(name), name).toBeInTheDocument();
      }

      fireEvent.change(getOpacity(), { target: { value: '31' } });
      flushRaf();

      expect(screen.getByLabelText('Opacity')).toBeInTheDocument();
    });

    it('keeps focus on the select across arrow keys', () => {
      render(<Gradient />);

      const type = getType();
      type.focus();
      expect(type).toHaveFocus();

      fireEvent.keyDown(type, { key: 'ArrowDown' });
      fireEvent.keyDown(type, { key: 'ArrowUp' });

      expect(type).toHaveFocus();
    });

    it('keeps every control reachable in tab order', () => {
      render(<Gradient />);

      for (const get of [getType, getOpacity, getColourA, getColourB]) {
        const control = get();
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
        control.focus();
        expect(control).toHaveFocus();
      }
    });
  });
});
