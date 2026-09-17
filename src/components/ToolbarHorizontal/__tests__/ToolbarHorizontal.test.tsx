import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ToolbarHorizontal from '../ToolbarHorizontal.tsx';

const storeState = { hasImage: true, toolName: 'draw' };

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
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

describe('ToolbarHorizontal', () => {
  it('renders the tool toolbox component when image is loaded', () => {
    storeState.hasImage = true;
    storeState.toolName = 'draw';
    render(<ToolbarHorizontal />);

    expect(screen.getByTestId('toolbox')).toBeTruthy();
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
});
