import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Patch from '../Patch.tsx';

const mockGetToolArgs = vi.hoisted(() => vi.fn());
const mockPatchToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: mockGetToolArgs,
    patchToolArgs: mockPatchToolArgs,
  }),
}));

describe('Patch toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetToolArgs.mockReturnValue({ toolName: 'patch', diffusion: 4 });
    mockPatchToolArgs.mockClear();
  });

  it('renders nothing when tool is not active (getToolArgs returns null)', () => {
    mockGetToolArgs.mockReturnValue(null);
    render(<Patch />);
    expect(screen.queryByLabelText('Patch')).toBeNull();
    expect(screen.queryByLabelText('Diffusion')).toBeNull();
  });

  it('renders the Patch mode select (disabled, only Source option)', () => {
    render(<Patch />);
    const select = screen.getByLabelText('Patch') as HTMLSelectElement;
    expect(select).toHaveValue('source');
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('id', 'patch-mode');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Source');
  });

  it('renders the Diffusion slider with current value', () => {
    render(<Patch />);
    const slider = screen.getByLabelText('Diffusion') as HTMLInputElement;
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '7');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider).toHaveValue('4');
  });

  it('shows the diffusion value next to the slider', () => {
    render(<Patch />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('updates diffusion via patchToolArgs on slider change', () => {
    render(<Patch />);
    const slider = screen.getByLabelText('Diffusion') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '7' } });
    expect(mockPatchToolArgs).toHaveBeenCalledWith('patch', { diffusion: 7 });
  });

  it('does not call patchToolArgs when getToolArgs returns null', () => {
    mockGetToolArgs.mockReturnValue(null);
    render(<Patch />);
    const slider = screen.queryByLabelText('Diffusion');
    expect(slider).toBeNull();
    expect(mockPatchToolArgs).not.toHaveBeenCalled();
  });

  it('accessibility: Patch label bound via htmlFor', () => {
    render(<Patch />);
    const select = screen.getByLabelText('Patch');
    expect(select).toHaveAttribute('id', 'patch-mode');
  });

  it('accessibility: Diffusion label bound via htmlFor', () => {
    render(<Patch />);
    const slider = screen.getByLabelText('Diffusion');
    expect(slider).toHaveAttribute('id', 'patch-diffusion');
  });

  it('accessibility: value readout is outside the label', () => {
    render(<Patch />);
    const slider = screen.getByLabelText('Diffusion');
    const valueSpan = screen.getByText('4');
    expect(slider).not.toContainElement(valueSpan);
  });
});
