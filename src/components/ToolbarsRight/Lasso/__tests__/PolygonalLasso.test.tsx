import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import PolygonalLasso from '../PolygonalLasso.tsx';

const getToolArgsResult = vi.hoisted(() => ({
  value: { fill: false, toolName: 'polygonal-lasso' } as { fill: boolean; toolName: string } | null,
}));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => getToolArgsResult.value,
    patchToolArgs: mockPatchToolArgs,
  }),
}));

const setToolArgsResult = (fill: boolean) => {
  getToolArgsResult.value = { fill, toolName: 'polygonal-lasso' };
};

const getModeButton = () => screen.getByRole('button', { name: /^(Fill|Outline)$/ });

describe('PolygonalLasso toolbar', () => {
  beforeEach(() => {
    setToolArgsResult(false);
    mockPatchToolArgs.mockClear();
  });

  it('renders nothing when the active tool args are not the polygonal lasso', () => {
    getToolArgsResult.value = null;
    const { container } = render(<PolygonalLasso />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows Outline as the default mode label and no active styling', () => {
    render(<PolygonalLasso />);

    expect(getModeButton()).toHaveTextContent('Outline');
    expect(getModeButton().className).not.toContain('bg-blue-500');
  });

  it('shows Fill and the active styling when the tool args request fill', () => {
    setToolArgsResult(true);
    render(<PolygonalLasso />);

    expect(getModeButton()).toHaveTextContent('Fill');
    expect(getModeButton().className).toContain('bg-blue-500');
  });

  it('patches only the fill flag when switching to fill', () => {
    render(<PolygonalLasso />);

    fireEvent.click(getModeButton());

    expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
    expect(mockPatchToolArgs).toHaveBeenCalledWith('polygonal-lasso', { fill: true });
  });

  it('patches only the fill flag when switching back to outline', () => {
    setToolArgsResult(true);
    render(<PolygonalLasso />);

    fireEvent.click(getModeButton());

    expect(mockPatchToolArgs).toHaveBeenCalledWith('polygonal-lasso', { fill: false });
  });

  it('reflects the mode change after the tool args round-trip through the store', () => {
    const { rerender } = render(<PolygonalLasso />);
    expect(getModeButton()).toHaveTextContent('Outline');

    fireEvent.click(getModeButton());
    setToolArgsResult(true);
    rerender(<PolygonalLasso />);

    expect(getModeButton()).toHaveTextContent('Fill');

    fireEvent.click(getModeButton());
    setToolArgsResult(false);
    rerender(<PolygonalLasso />);

    expect(getModeButton()).toHaveTextContent('Outline');
  });

  it('toggles the mode on Enter and Space, inverting the current fill each time', async () => {
    const { rerender } = render(<PolygonalLasso />);
    const user = userEvent.setup();

    const modeButton = getModeButton();
    modeButton.focus();
    expect(modeButton).toHaveFocus();

    // The store starts at fill: false, so the first activation must publish the inverse.
    await user.keyboard('{Enter}');
    expect(mockPatchToolArgs).toHaveBeenLastCalledWith('polygonal-lasso', { fill: true });

    // Round-trip the published value back through the store. Without it `args.fill` is still
    // false on the second activation, so both assertions would read `{ fill: true }` and the
    // `!isFill` inversion the component exists to perform could be hardcoded away unnoticed.
    setToolArgsResult(true);
    rerender(<PolygonalLasso />);
    expect(getModeButton()).toHaveTextContent('Fill');

    await user.keyboard(' ');
    expect(mockPatchToolArgs).toHaveBeenLastCalledWith('polygonal-lasso', { fill: false });
    expect(mockPatchToolArgs).toHaveBeenCalledTimes(2);
  });

  it('documents the corner-click interaction for the user', () => {
    render(<PolygonalLasso />);

    expect(screen.getByText('Click to add corners • Double-click to close')).toBeInTheDocument();
    expect(screen.getByText('Right-click also finishes the selection')).toBeInTheDocument();
  });
});

describe('PolygonalLasso Mode toggle accessibility', () => {
  beforeEach(() => {
    setToolArgsResult(false);
    mockPatchToolArgs.mockClear();
  });

  it('signals the Mode toggle only by swapping the label text and the CSS class (PolygonalLasso.tsx:19-29)', () => {
    render(<PolygonalLasso />);

    const button = getModeButton();
    expect(button).toHaveTextContent('Outline');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(button.className).not.toContain('bg-blue-500');
  });

  it('keeps aria-pressed absent in the fill state too (PolygonalLasso.tsx:19-29)', () => {
    setToolArgsResult(true);
    render(<PolygonalLasso />);

    const button = getModeButton();
    expect(button).toHaveTextContent('Fill');
    expect(button.className).toContain('bg-blue-500');
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  it.fails('reports the Mode toggle through aria-pressed (PolygonalLasso.tsx:19-29)', () => {
    render(<PolygonalLasso />);

    expect(getModeButton()).toHaveAttribute('aria-pressed', 'false');
  });
});
