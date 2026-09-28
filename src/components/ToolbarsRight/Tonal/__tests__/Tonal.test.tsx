import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tonal from '../Tonal.tsx';
import {
  BRUSH_HARDNESS_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
} from '../../../../util/brush-engine.ts';
import { DODGE_BURN_EXPOSURE_MAX, DODGE_BURN_EXPOSURE_MIN, DODGE_BURN_RANGES } from '../../../../tools/dodgeBurn.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { DodgeBurnToolArgs, DodgeBurnToolName } from '../../../../tools/dodgeBurn.ts';

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `setToolArgs` publishes a NEW args object back into React state, so the readouts and the
 * control values repaint from it; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the repo
 * compiles with `babel-plugin-react-compiler`, which memoizes `<Tonal />` on its empty props.
 *
 * This bar reads `toolArgs` as well as `getToolArgs`, so the mock has to publish both.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockPatchToolArgs = vi.hoisted(() => vi.fn());

/**
 * The store is the authority on WHICH of the two tools is active — `getToolArgs` needs a
 * concrete name to look one up — so the store's `toolName` is what this suite drives.
 */
const storeState = vi.hoisted(() => ({ toolName: 'dodge' as string }));

// `useStore` is mocked directly rather than through `StoreProvider`, which is the house
// pattern for every `ToolbarsRight` suite: the provider pulls in the durable
// replay/materialization path, which does not survive jsdom.
vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
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

const getRange = () => screen.getByLabelText('Range') as HTMLSelectElement;
const getExposure = () => screen.getByLabelText('Exposure') as HTMLInputElement;
const getSize = () => screen.getByLabelText('Size') as HTMLInputElement;
const getHardness = () => screen.getByLabelText('Hardness') as HTMLInputElement;

/** The visible caption of the control, label text plus live readout. */
const caption = (control: HTMLElement) => control.parentElement?.textContent ?? '';

/** The seeded defaults for whichever of the two tools is active. */
function resetToolArgs(toolName: DodgeBurnToolName = 'dodge', overrides: Partial<DodgeBurnToolArgs> = {}) {
  toolState.initial = { ...structuredClone(defaultSettings[toolName]), ...overrides } satisfies DodgeBurnToolArgs;
  return toolState.initial as DodgeBurnToolArgs;
}

function resetState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, { toolName: 'dodge', ...overrides });
}

const lastArgs = () => mockSetToolArgs.mock.lastCall?.[0] as DodgeBurnToolArgs;
const lastPublished = () => toolState.initial as DodgeBurnToolArgs;

describe('Tonal toolbar', () => {
  beforeEach(() => {
    resetState();
    resetToolArgs('dodge');
    mockSetToolArgs.mockClear();
    mockPatchToolArgs.mockClear();
    rafCallbacks.length = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    resetState();
    resetToolArgs('dodge');
    rafCallbacks.length = 0;
    vi.unstubAllGlobals();
  });

  it.each(['dodge', 'burn'] as const)('renders the same four controls for the %s tool', (toolName) => {
    resetState({ toolName });
    resetToolArgs(toolName);
    render(<Tonal />);

    // ONE component serves both tools because Photoshop's two bars are the same four controls
    // under two names, and the only difference between the args is the `toolName` the writes
    // carry. Rendering the same control set for both is what makes a change to the set unable
    // to land on one tool and miss the other.
    expect(screen.getAllByRole('slider')).toHaveLength(3);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each(['dodge', 'burn'] as const)('renders the seeded default of the %s tool on every control', (toolName) => {
    resetState({ toolName });
    resetToolArgs(toolName);
    render(<Tonal />);

    // Both defaults are exposure 50, midtones, size 40, hardness 100 — the pair differs only
    // in `toolName`, which is the point of sharing the bar.
    expect(getRange()).toHaveValue('midtones');
    expect(getExposure()).toHaveValue('50');
    expect(getSize()).toHaveValue('40');
    expect(getHardness()).toHaveValue('100');
    expect(caption(getExposure())).toBe('Exposure50%');
    expect(caption(getSize())).toBe('Size40px');
    expect(caption(getHardness())).toBe('Hardness100%');
  });

  it.each(['dodge', 'burn'] as const)('gives every control of the %s bar the name it has in both', (toolName) => {
    resetState({ toolName });
    resetToolArgs(toolName);
    render(<Tonal />);

    // The readout sits OUTSIDE the label, so the accessible name is the static word rather
    // than "Size 40px" — which would change on every drag and break a locator written
    // against the control.
    for (const name of ['Range', 'Exposure', 'Size', 'Hardness']) {
      expect(screen.getByLabelText(name), name).toBeInTheDocument();
    }
  });

  it('exposes the tonal bands the processor can isolate, in DOM order', () => {
    render(<Tonal />);

    // A dodge or burn stroke only touches pixels inside the selected band, which is what
    // makes the same tool usable on a face without blowing out the specular highlights.
    const options = Array.from(getRange().options, (option) => [option.value, option.textContent]);

    expect(options).toEqual(DODGE_BURN_RANGES.map((entry) => [entry.value, entry.label]));
    expect(options.map(([value]) => value)).toEqual(['shadows', 'midtones', 'highlights']);
  });

  it('takes the exposure bounds from the tool module and the tip bounds from the brush engine', () => {
    render(<Tonal />);

    expect(getExposure()).toHaveAttribute('min', String(DODGE_BURN_EXPOSURE_MIN));
    expect(getExposure()).toHaveAttribute('max', String(DODGE_BURN_EXPOSURE_MAX));
    expect(getExposure()).toHaveAttribute('step', '1');
    for (const [slider, min, max] of [
      [getSize(), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX],
      [getHardness(), BRUSH_HARDNESS_MIN, BRUSH_HARDNESS_MAX],
    ] as const) {
      expect(slider, `${min}-${max}`).toHaveAttribute('min', String(min));
      expect(slider, `${min}-${max}`).toHaveAttribute('max', String(max));
      expect(slider, `${min}-${max}`).toHaveAttribute('step', '1');
    }
  });

  it('renders nothing for a tool that is neither dodge nor burn', () => {
    resetState({ toolName: 'eraser' });
    resetToolArgs('dodge');
    const { container } = render(<Tonal />);

    // `isDodgeBurnToolName` is the gate, and `getToolArgs` returns `null` for anything that
    // is not dodge or burn — the same "render nothing when the tool is not this one" contract
    // `Paint.tsx` has.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the store says dodge but the args belong to another tool', () => {
    // The two sources can disagree for one render: the store's `toolName` is the authority on
    // which tool is active, and the args lookup is what returns `null` when they do.
    resetState({ toolName: 'dodge' });
    resetToolArgs('burn');
    const { container } = render(<Tonal />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('which tool the bar is bound to', () => {
    it('names the dodge controls from the store tool name', () => {
      resetState({ toolName: 'dodge' });
      resetToolArgs('dodge');
      render(<Tonal />);

      // `Tonal.tsx:126-181` builds every `id`/`htmlFor` from the active tool, so a test that
      // located a control by label would find a detached name if the bar rendered the burn ids
      // while dodge was active.
      expect(document.getElementById('dodge-range')).not.toBeNull();
      expect(document.getElementById('burn-range')).toBeNull();
    });

    it('names the burn controls from the store tool name', () => {
      resetState({ toolName: 'burn' });
      resetToolArgs('burn');
      render(<Tonal />);

      expect(document.getElementById('burn-range')).not.toBeNull();
      expect(document.getElementById('dodge-range')).toBeNull();
    });

    it('renders the args of the active tool rather than the other one', () => {
      resetState({ toolName: 'burn' });
      resetToolArgs('burn', { exposure: 12, range: 'shadows' });
      render(<Tonal />);

      expect(getExposure()).toHaveValue('12');
      expect(getRange()).toHaveValue('shadows');
      expect(caption(getExposure())).toBe('Exposure12%');
    });
  });

  describe('write path', () => {
    it('keeps the active tool name on every slider write', () => {
      render(<Tonal />);

      fireEvent.change(getExposure(), { target: { value: '70' } });
      flushRaf();

      // `publishSlider` carries `{ ...args }`, so the tool name comes from the args it was
      // handed. A write that dropped it would leave the store's current args describing a tool
      // that is not the one on screen.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'dodge',
        exposure: 70,
        range: 'midtones',
        size: 40,
        hardness: 100,
        points: [],
      });
    });

    it('keeps the burn tool name on a burn write', () => {
      resetState({ toolName: 'burn' });
      resetToolArgs('burn');
      render(<Tonal />);

      fireEvent.change(getSize(), { target: { value: '70' } });
      flushRaf();

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ toolName: 'burn', size: 70 }));
    });

    it('replaces the whole args object rather than merging into the previous one', () => {
      resetToolArgs('dodge');
      render(<Tonal />);

      fireEvent.change(getSize(), { target: { value: '70' } });
      flushRaf();

      // The pending payload is replaced wholesale, so a value the user never moved cannot
      // survive in the frame that flushes.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'dodge',
        exposure: 50,
        range: 'midtones',
        size: 70,
        hardness: 100,
        points: [],
      });
    });

    it('coalesces a burst of changes into one write carrying the last value', () => {
      render(<Tonal />);

      fireEvent.change(getExposure(), { target: { value: '10' } });
      fireEvent.change(getExposure(), { target: { value: '20' } });
      fireEvent.change(getExposure(), { target: { value: '30' } });

      expect(rafCallbacks).toHaveLength(1);
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      flushRaf();

      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs.mock.lastCall?.[0]).toMatchObject({ exposure: 30 });
    });

    it('schedules a fresh frame after the previous one has flushed', () => {
      render(<Tonal />);

      fireEvent.change(getExposure(), { target: { value: '9' } });
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

      fireEvent.change(getExposure(), { target: { value: '10' } });
      expect(rafCallbacks).toHaveLength(1);
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
      expect(lastArgs().exposure).toBe(10);
    });

    it('leaves the other fields untouched when one control moves', () => {
      resetToolArgs('dodge');
      render(<Tonal />);

      fireEvent.change(getHardness(), { target: { value: '30' } });
      flushRaf();

      expect(lastPublished()).toEqual({
        toolName: 'dodge',
        exposure: 50,
        range: 'midtones',
        size: 40,
        hardness: 30,
        points: [],
      });
    });
  });

  describe('range select', () => {
    it('writes the chosen band through setToolArgs immediately, not on a frame', () => {
      render(<Tonal />);

      fireEvent.change(getRange(), { target: { value: 'highlights' } });

      // The dropdown is NOT routed through the frame: it fires once per choice rather than
      // once per frame, and a dropdown whose readout lags a frame reads as broken.
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ range: 'highlights', toolName: 'dodge' })
      );
      expect(rafCallbacks).toHaveLength(0);
      expect(getRange()).toHaveValue('highlights');
    });

    it('keeps the burn tool name on a burn range write, which is the one path through `patch`', () => {
      // The sliders go through `publishSlider`, which spreads the args and so carries the tool
      // name for free. The Range dropdown is the ONLY caller of `patch`, and `patch` is where
      // the name is re-stamped — so the burn case has to be pinned on the dropdown
      // specifically. Verified by forcing `patch` to hard-code `dodge`: without this row every
      // test in the file still passed.
      resetState({ toolName: 'burn' });
      resetToolArgs('burn');
      render(<Tonal />);

      fireEvent.change(getRange(), { target: { value: 'shadows' } });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ range: 'shadows', toolName: 'burn' })
      );
    });

    it('keeps the dodge tool name on a dodge range write', () => {
      render(<Tonal />);

      fireEvent.change(getRange(), { target: { value: 'shadows' } });

      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ range: 'shadows', toolName: 'dodge' })
      );
    });

    it('ignores a band the processor has no case for', () => {
      render(<Tonal />);

      // `isTonalRange` is the guard, so a value outside the union cannot reach the args where
      // `TONAL_SPLIT` would be used to index a band the tool does not have.
      fireEvent.change(getRange(), { target: { value: 'everything' } });

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('stroke passthrough', () => {
    it('carries the empty path through a write instead of inventing one', () => {
      resetToolArgs('dodge');
      render(<Tonal />);

      fireEvent.change(getExposure(), { target: { value: '80' } });
      flushRaf();

      // The bar has no control for the stroke, and the args type requires the field, so the
      // seeded `points: []` has to survive every write it makes.
      expect(lastPublished().points).toEqual([]);
    });
  });

  describe('keyboard navigation', () => {
    it('keeps focus on the control across arrow keys', () => {
      render(<Tonal />);

      const range = getRange();
      range.focus();
      expect(range).toHaveFocus();

      fireEvent.keyDown(range, { key: 'ArrowDown' });
      fireEvent.keyDown(range, { key: 'ArrowUp' });

      expect(range).toHaveFocus();
    });

    it('keeps every control reachable in tab order', () => {
      render(<Tonal />);

      for (const get of [getRange, getExposure, getSize, getHardness]) {
        const control = get();
        expect(control.tabIndex).toBeGreaterThanOrEqual(0);
        control.focus();
        expect(control).toHaveFocus();
      }
    });

    it('does not close anything on escape, because the bar has no popovers', () => {
      render(<Tonal />);

      const range = getRange();
      range.focus();
      fireEvent.keyDown(range, { key: 'Escape' });

      expect(range).toHaveFocus();
      expect(range).toBeInTheDocument();
    });
  });
});
