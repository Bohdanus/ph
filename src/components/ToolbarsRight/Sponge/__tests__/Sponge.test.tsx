import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sponge from '../Sponge.tsx';
import type { SpongeToolArgs } from '../../../../tools/sponge.ts';
import type { Point } from '../../../../contexts/general-types.ts';
import { SPONGE_MODES, SPONGE_FLOW_MIN, SPONGE_FLOW_MAX } from '../../../../tools/sponge.ts';
import {
  BRUSH_SIZE_MIN,
  BRUSH_SIZE_MAX,
  BRUSH_HARDNESS_MIN,
  BRUSH_HARDNESS_MAX,
} from '../../../../util/brush-engine.ts';

const mockGetToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockUseStore = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: mockGetToolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: mockUseStore,
}));

const defaultSpongeArgs: SpongeToolArgs = {
  toolName: 'sponge',
  mode: 'saturate',
  flow: 50,
  vibrance: false,
  size: 50,
  hardness: 50,
  points: [] as Point[],
};

const rafCallbacks = new Map<number, FrameRequestCallback>();
let nextRafId = 0;

const flushRaf = () => {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  act(() => callbacks.forEach((callback) => callback(0)));
};

describe('Sponge toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseStore.mockReturnValue([{ toolName: 'sponge' }]);
    mockGetToolArgs.mockReturnValue(defaultSpongeArgs);
    mockSetToolArgs.mockClear();
    rafCallbacks.clear();
    nextRafId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextRafId;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders nothing when tool is not active', () => {
    mockUseStore.mockReturnValue([{ toolName: 'brush' }]);
    render(<Sponge />);
    expect(screen.queryByLabelText('Mode')).toBeNull();
    expect(screen.queryByLabelText('Flow')).toBeNull();
    expect(screen.queryByLabelText('Vibrance')).toBeNull();
    expect(screen.queryByLabelText('Size')).toBeNull();
    expect(screen.queryByLabelText('Hardness')).toBeNull();
  });

  it('renders nothing when getToolArgs returns null', () => {
    mockUseStore.mockReturnValue([{ toolName: 'sponge' }]);
    mockGetToolArgs.mockReturnValue(null);
    render(<Sponge />);
    expect(screen.queryByLabelText('Mode')).toBeNull();
  });

  describe('Mode select', () => {
    it('renders the Mode select with all SPONGE_MODES options', () => {
      render(<Sponge />);
      const select = screen.getByLabelText('Mode') as HTMLSelectElement;
      expect(select).toHaveAttribute('id', 'sponge-mode');
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(SPONGE_MODES.length);
      SPONGE_MODES.forEach((mode) => {
        expect(screen.getByRole('option', { name: mode.label })).toBeInTheDocument();
      });
    });

    it('shows current mode value', () => {
      mockGetToolArgs.mockReturnValue({ ...defaultSpongeArgs, mode: 'desaturate' });
      render(<Sponge />);
      expect(screen.getByLabelText('Mode')).toHaveValue('desaturate');
    });

    it('updates mode via setToolArgs on change', () => {
      render(<Sponge />);
      const select = screen.getByLabelText('Mode') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'desaturate' } });
      expect(mockSetToolArgs).toHaveBeenCalledWith({
        ...defaultSpongeArgs,
        mode: 'desaturate',
        toolName: 'sponge',
      });
    });

    it('ignores invalid mode values', () => {
      render(<Sponge />);
      const select = screen.getByLabelText('Mode') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'invalid' } });
      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('Flow slider', () => {
    it('renders Flow slider with correct min/max/value', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Flow') as HTMLInputElement;
      expect(slider).toHaveAttribute('id', 'sponge-flow');
      expect(slider).toHaveAttribute('type', 'range');
      expect(slider).toHaveAttribute('min', String(SPONGE_FLOW_MIN));
      expect(slider).toHaveAttribute('max', String(SPONGE_FLOW_MAX));
      expect(slider).toHaveAttribute('step', '1');
      expect(slider).toHaveValue(String(defaultSpongeArgs.flow));
    });

    it('shows rounded flow value next to slider', () => {
      render(<Sponge />);
      const flowSlider = screen.getByLabelText('Flow');
      const flowValue = flowSlider.parentElement?.querySelector('span.font-bold');
      expect(flowValue).toHaveTextContent('50%');
    });

    it('publishes flow changes via coalesced rAF', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Flow') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '60' } });
      fireEvent.change(slider, { target: { value: '75' } });
      expect(rafCallbacks.size).toBe(1);
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        ...defaultSpongeArgs,
        flow: 75,
        toolName: 'sponge',
      });
    });
  });

  describe('Vibrance checkbox', () => {
    it('renders Vibrance checkbox with current state', () => {
      render(<Sponge />);
      const checkbox = screen.getByLabelText('Vibrance') as HTMLInputElement;
      expect(checkbox).toHaveAttribute('id', 'sponge-vibrance');
      expect(checkbox).toHaveAttribute('type', 'checkbox');
      expect(checkbox).not.toBeChecked();
    });

    it('shows checked when vibrance is true', () => {
      mockGetToolArgs.mockReturnValue({ ...defaultSpongeArgs, vibrance: true });
      render(<Sponge />);
      expect(screen.getByLabelText('Vibrance')).toBeChecked();
    });

    it('updates vibrance via setToolArgs on change', () => {
      render(<Sponge />);
      const checkbox = screen.getByLabelText('Vibrance') as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(mockSetToolArgs).toHaveBeenCalledWith({
        ...defaultSpongeArgs,
        vibrance: true,
        toolName: 'sponge',
      });
    });
  });

  describe('Size slider', () => {
    it('renders Size slider with correct bounds', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Size') as HTMLInputElement;
      expect(slider).toHaveAttribute('id', 'sponge-size');
      expect(slider).toHaveAttribute('min', String(BRUSH_SIZE_MIN));
      expect(slider).toHaveAttribute('max', String(BRUSH_SIZE_MAX));
      expect(slider).toHaveAttribute('step', '1');
      expect(slider).toHaveValue(String(defaultSpongeArgs.size));
    });

    it('shows rounded size value', () => {
      render(<Sponge />);
      const sizeSlider = screen.getByLabelText('Size');
      const sizeValue = sizeSlider.parentElement?.querySelector('span.font-bold');
      expect(sizeValue).toHaveTextContent('50px');
    });

    it('publishes size changes via coalesced rAF', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Size') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '100' } });
      expect(rafCallbacks.size).toBe(1);
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        ...defaultSpongeArgs,
        size: 100,
        toolName: 'sponge',
      });
    });
  });

  describe('Hardness slider', () => {
    it('renders Hardness slider with correct bounds', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Hardness') as HTMLInputElement;
      expect(slider).toHaveAttribute('id', 'sponge-hardness');
      expect(slider).toHaveAttribute('min', String(BRUSH_HARDNESS_MIN));
      expect(slider).toHaveAttribute('max', String(BRUSH_HARDNESS_MAX));
      expect(slider).toHaveAttribute('step', '1');
      expect(slider).toHaveValue(String(defaultSpongeArgs.hardness));
    });

    it('shows rounded hardness value', () => {
      render(<Sponge />);
      const hardnessSlider = screen.getByLabelText('Hardness');
      const hardnessValue = hardnessSlider.parentElement?.querySelector('span.font-bold');
      expect(hardnessValue).toHaveTextContent('50%');
    });

    it('publishes hardness changes via coalesced rAF', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Hardness') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '75' } });
      expect(rafCallbacks.size).toBe(1);
      expect(mockSetToolArgs).not.toHaveBeenCalled();
      flushRaf();
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        ...defaultSpongeArgs,
        hardness: 75,
        toolName: 'sponge',
      });
    });
  });

  describe('Cleanup on unmount', () => {
    it('cancels pending rAF on unmount when slider was changed', () => {
      const cancelSpy = vi.spyOn(global, 'cancelAnimationFrame');
      const { unmount } = render(<Sponge />);
      // Trigger a slider change to schedule an rAF
      const slider = screen.getByLabelText('Flow') as HTMLInputElement;
      fireEvent.change(slider, { target: { value: '75' } });
      expect(rafCallbacks.size).toBe(1);
      const scheduledId = rafCallbacks.keys().next().value;
      unmount();
      expect(cancelSpy).toHaveBeenCalledExactlyOnceWith(scheduledId);
      expect(rafCallbacks.size).toBe(0);
    });

    it('does not call cancelAnimationFrame on unmount when no rAF was scheduled', () => {
      const cancelSpy = vi.spyOn(global, 'cancelAnimationFrame');
      const { unmount } = render(<Sponge />);
      unmount();
      expect(cancelSpy).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('Mode label bound via htmlFor', () => {
      render(<Sponge />);
      const select = screen.getByLabelText('Mode');
      expect(select).toHaveAttribute('id', 'sponge-mode');
    });

    it('Flow label bound via htmlFor', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Flow');
      expect(slider).toHaveAttribute('id', 'sponge-flow');
    });

    it('Vibrance label bound via htmlFor on checkbox', () => {
      render(<Sponge />);
      const checkbox = screen.getByLabelText('Vibrance');
      expect(checkbox).toHaveAttribute('id', 'sponge-vibrance');
    });

    it('Size label bound via htmlFor', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Size');
      expect(slider).toHaveAttribute('id', 'sponge-size');
    });

    it('Hardness label bound via htmlFor', () => {
      render(<Sponge />);
      const slider = screen.getByLabelText('Hardness');
      expect(slider).toHaveAttribute('id', 'sponge-hardness');
    });

    it('value readouts are outside their labels', () => {
      render(<Sponge />);
      const flowSlider = screen.getByLabelText('Flow');
      const flowValue = flowSlider.parentElement?.querySelector('span.font-bold') as HTMLElement | null;
      expect(flowSlider).not.toContainElement(flowValue);

      const sizeSlider = screen.getByLabelText('Size');
      const sizeValue = sizeSlider.parentElement?.querySelector('span.font-bold') as HTMLElement | null;
      expect(sizeSlider).not.toContainElement(sizeValue);

      const hardnessSlider = screen.getByLabelText('Hardness');
      const hardnessValue = hardnessSlider.parentElement?.querySelector('span.font-bold') as HTMLElement | null;
      expect(hardnessSlider).not.toContainElement(hardnessValue);
    });
  });
});
