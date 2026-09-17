import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ToolbarHorizontal from '../ToolbarHorizontal.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      hasImage: true,
      toolName: 'draw',
    },
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: { toolName: 'draw', lineWidth: 5 },
    setToolArgs: () => {},
  }),
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
    render(<ToolbarHorizontal />);

    expect(screen.getByTestId('toolbox')).toBeTruthy();
  });
});
