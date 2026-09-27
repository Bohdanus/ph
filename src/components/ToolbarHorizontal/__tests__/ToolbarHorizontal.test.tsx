import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ToolbarHorizontal from '../ToolbarHorizontal.tsx';

const storeState = vi.hoisted(() => ({ hasImage: true, toolName: 'draw' as string }));
const dispatch = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, dispatch],
}));

vi.mock('../../../tools/toolsMap.ts', () => {
  const Toolbox = () => <div data-testid="toolbox">toolbar</div>;
  return {
    toolsMap: {
      draw: {
        toolboxComponent: Toolbox,
      },
    },
  };
});

beforeEach(() => {
  storeState.hasImage = true;
  storeState.toolName = 'draw';
});

describe('ToolbarHorizontal', () => {
  it('renders the tool toolbox component when image is loaded', () => {
    storeState.hasImage = true;
    storeState.toolName = 'draw';
    render(<ToolbarHorizontal />);

    expect(screen.getByTestId('toolbox')).toBeInTheDocument();
  });

  it('does not render the toolbox when there is no image', () => {
    storeState.hasImage = false;
    storeState.toolName = 'draw';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('does not render the toolbox when toolName is empty', () => {
    storeState.hasImage = true;
    storeState.toolName = '';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('does not render the toolbox when there is neither an image nor a tool', () => {
    storeState.hasImage = false;
    storeState.toolName = '';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
    expect(screen.queryByText('TODO: unregistered tool placeholder')).toBeNull();
  });

  it('renders a placeholder instead of crashing for a tool that is not registered in the map', () => {
    storeState.hasImage = true;
    storeState.toolName = 'crop';
    render(<ToolbarHorizontal />);

    expect(screen.getByText('TODO: unregistered tool placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('keeps the placeholder and the toolbox mutually exclusive when the tool changes back', () => {
    const { rerender } = render(<ToolbarHorizontal />);
    storeState.toolName = 'draw';
    rerender(<ToolbarHorizontal />);
    expect(screen.getByTestId('toolbox')).toBeInTheDocument();

    storeState.toolName = 'magic-wand';
    rerender(<ToolbarHorizontal />);
    expect(screen.getByText('TODO: unregistered tool placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('renders an empty toolbar bar without placeholder copy when the image is missing', () => {
    storeState.hasImage = false;
    storeState.toolName = 'draw';
    const { container } = render(<ToolbarHorizontal />);

    expect(container.firstElementChild).toBeEmptyDOMElement();
    expect(container).toHaveTextContent('');
  });
});
