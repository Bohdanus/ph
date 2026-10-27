import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../../contexts/general-types.ts';
import FreehandLasso from '../FreehandLasso.tsx';

/**
 * §110's defect was that the only UI for the two persisted lasso settings lived in a
 * component the app could not reach, and that component hardcoded `toolName:
 * 'polygonal-lasso'` into every `setToolArgs`. This file is the negative-image proof that
 * the live panel is not that component: every control here writes through
 * `patchToolArgs` under the freehand-lasso key, reads its own persisted values back off
 * the args object, and never touches the polygonal-lasso key.
 */

const getToolArgsResult = vi.hoisted(() => ({
  value: {
    lineWidth: 3,
    alpha: 1,
    featherRadius: 0,
    antiAlias: true,
    fill: false,
    color: '#FF0000',
    points: [],
    toolName: 'freehand-lasso',
  } as {
    lineWidth: number;
    alpha: number;
    featherRadius: number;
    antiAlias: boolean;
    fill: boolean;
    color: string;
    points: unknown[];
    toolName: 'freehand-lasso';
  } | null,
}));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockDispatch = vi.hoisted(() => vi.fn());

const storeState = vi.hoisted(() => ({
  activeSelectionId: null as string | null,
  selections: [] as Selection[],
  history: [{ id: 'prior-edit', layerId: 'layer-1', actionName: 'new layer', args: {} }] as unknown[],
  historyIndex: 0,
  branchRevision: 0,
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, mockDispatch],
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: null,
    copyActiveSelection: vi.fn(() => true),
    hasSelectionClipboard: false,
    pasteSelectionClipboard: vi.fn(),
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (name: string) => (name === 'freehand-lasso' ? getToolArgsResult.value : null),
    patchToolArgs: mockPatchToolArgs,
  }),
}));

const setSize = (lineWidth: number) => {
  getToolArgsResult.value = { ...getToolArgsResult.value!, lineWidth };
};

const setAlpha = (alpha: number) => {
  getToolArgsResult.value = { ...getToolArgsResult.value!, alpha };
};

const getSizeSlider = () => screen.getByRole('slider', { name: /^Size/ }) as HTMLInputElement;
const getOpacitySlider = () => screen.getByRole('slider', { name: /^Opacity/ }) as HTMLInputElement;
const getFeatherSlider = () => screen.getByRole('slider', { name: /^Feather/ }) as HTMLInputElement;
const getAntiAliasCheckbox = () => screen.getByRole('checkbox', { name: /Anti-alias/ }) as HTMLInputElement;

const FREEHAND_KEY = 'freehand-lasso';

describe('FreehandLasso writes its own tool args (§110)', () => {
  beforeEach(() => {
    mockPatchToolArgs.mockClear();
  });

  it('reads the persisted lineWidth off the args instead of hardcoding a default', () => {
    setSize(22);
    render(<FreehandLasso />);

    expect(getSizeSlider()).toHaveValue('22');
    expect(getSizeSlider().closest('label')?.textContent).toContain('22px');
  });

  it('reads the persisted alpha off the args instead of hardcoding 100%', () => {
    setAlpha(0.33);
    render(<FreehandLasso />);

    expect(getOpacitySlider()).toHaveValue('0.33');
    expect(getOpacitySlider().closest('label')?.textContent).toContain('33%');
  });

  it('patches lineWidth under the freehand-lasso key, not the polygonal-lasso key', () => {
    render(<FreehandLasso />);
    const slider = getSizeSlider();

    fireEvent.change(slider, { target: { value: '9' } });

    expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
    expect(mockPatchToolArgs).toHaveBeenCalledWith(FREEHAND_KEY, { lineWidth: 9 });
    expect(mockPatchToolArgs).not.toHaveBeenCalledWith('polygonal-lasso', expect.anything());
  });

  it('patches alpha under the freehand-lasso key, not the polygonal-lasso key', () => {
    render(<FreehandLasso />);
    const slider = getOpacitySlider();

    fireEvent.change(slider, { target: { value: '0.5' } });

    expect(mockPatchToolArgs).toHaveBeenCalledWith(FREEHAND_KEY, { alpha: 0.5 });
    expect(mockPatchToolArgs).not.toHaveBeenCalledWith('polygonal-lasso', expect.anything());
  });

  it('patches featherRadius under the freehand-lasso key, not the polygonal-lasso key', () => {
    render(<FreehandLasso />);
    const slider = getFeatherSlider();

    fireEvent.change(slider, { target: { value: '24' } });

    expect(mockPatchToolArgs).toHaveBeenCalledWith(FREEHAND_KEY, { featherRadius: 24 });
    expect(mockPatchToolArgs).not.toHaveBeenCalledWith('polygonal-lasso', expect.anything());
  });

  it('patches antiAlias under the freehand-lasso key, not the polygonal-lasso key', () => {
    render(<FreehandLasso />);
    const checkbox = getAntiAliasCheckbox();

    fireEvent.click(checkbox);

    expect(mockPatchToolArgs).toHaveBeenCalledWith(FREEHAND_KEY, { antiAlias: false });
    expect(mockPatchToolArgs).not.toHaveBeenCalledWith('polygonal-lasso', expect.anything());
  });

  it('never writes to any key but freehand-lasso across every control', () => {
    render(<FreehandLasso />);
    const slider = getSizeSlider();

    fireEvent.change(slider, { target: { value: '9' } });
    fireEvent.change(getOpacitySlider(), { target: { value: '0.5' } });
    fireEvent.change(getFeatherSlider(), { target: { value: '24' } });
    fireEvent.click(getAntiAliasCheckbox());

    const keys = mockPatchToolArgs.mock.calls.map(([key]) => key);
    expect(keys.every((key) => key === FREEHAND_KEY)).toBe(true);
    expect(new Set(keys).size).toBe(1);
  });

  it('carries the behaviour hints the old Lasso.tsx panel used to render', () => {
    render(<FreehandLasso />);

    expect(screen.getByText('Backspace removes anchor • Enter finishes • Esc cancels')).toBeInTheDocument();
  });
});
