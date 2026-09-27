import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Reposition from '../Reposition.tsx';

const storeState = vi.hoisted(() => ({
  layers: {} as Record<string, { name: string }>,
  activeLayerId: null as string | null,
}));

const mockMergeAllLayers = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    mergeAllLayers: mockMergeAllLayers,
  }),
}));

describe('Reposition toolbar', () => {
  beforeEach(() => {
    storeState.layers = {
      'layer-1': { name: 'Background' },
      'layer-2': { name: 'Subject' },
    };
    storeState.activeLayerId = 'layer-2';
    mockMergeAllLayers.mockClear();
  });

  it('shows the name of the active layer', () => {
    render(<Reposition />);

    expect(screen.getByText('Active layer')).toBeInTheDocument();
    expect(screen.getByText('Subject')).toBeInTheDocument();
    expect(screen.queryByText('Background')).not.toBeInTheDocument();
  });

  it('re-renders the active layer name when the selection changes', () => {
    const { rerender } = render(<Reposition />);
    expect(screen.getByText('Subject')).toBeInTheDocument();

    storeState.activeLayerId = 'layer-1';
    rerender(<Reposition />);

    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.queryByText('Subject')).not.toBeInTheDocument();
  });

  it('falls back to None when no layer is active', () => {
    storeState.activeLayerId = null;
    render(<Reposition />);

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('falls back to None when the active layer id no longer resolves', () => {
    storeState.activeLayerId = 'deleted-layer';
    render(<Reposition />);

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('falls back to None when the layer record is empty', () => {
    storeState.layers = {};
    storeState.activeLayerId = 'layer-1';
    render(<Reposition />);

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders a layer name that is an empty string without crashing', () => {
    storeState.layers = { 'layer-1': { name: '' } };
    storeState.activeLayerId = 'layer-1';
    render(<Reposition />);

    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });

  it('merges every layer from the merge button', () => {
    render(<Reposition />);

    fireEvent.click(screen.getByRole('button', { name: 'Merge all' }));

    expect(mockMergeAllLayers).toHaveBeenCalledTimes(1);
  });

  it('activates merge with the keyboard', async () => {
    render(<Reposition />);
    const user = userEvent.setup();

    const mergeButton = screen.getByRole('button', { name: 'Merge all' });
    mergeButton.focus();
    expect(mergeButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(mockMergeAllLayers).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(mockMergeAllLayers).toHaveBeenCalledTimes(2);
  });

  it('tells the user that moving happens on the canvas', () => {
    render(<Reposition />);

    expect(screen.getByText('Drag or resize on canvas')).toBeInTheDocument();
  });

  it('publishes the hint test id the e2e spec resolves by', () => {
    render(<Reposition />);

    expect(screen.getByTestId('reposition-hint-text')).toHaveTextContent('Drag or resize on canvas');
  });
});
