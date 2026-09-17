import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SidebarLeft from '../SidebarLeft.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useApp } from '../../../hooks/useApp.ts';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      hasImage: true,
      toolName: 'draw',
      color: '#000000',
      backgroundColor: '#ffffff',
      dispatch: vi.fn(),
    },
  ],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({
    goToTool: vi.fn(),
  }),
}));

vi.mock('./toolIcons.tsx', () => ({
  toolIcons: {
    draw: ({ title }: { title: string }) => <svg data-testid="tool-icon-draw">{title}</svg>,
  },
}));

describe('SidebarLeft', () => {
  it('renders tool buttons', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('left-sidebar')).toBeTruthy();
    expect(screen.getByTestId('left-toolbar-tools')).toBeTruthy();
    expect(screen.getByTestId('tool-button-draw')).toBeTruthy();
  });

  it('renders color pickers', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('color-pickers')).toBeTruthy();
    expect(screen.getByTestId('foreground-color-swatch')).toBeTruthy();
    expect(screen.getByTestId('background-color-swatch')).toBeTruthy();
  });

  it('renders swap colors button', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('swap-colors-button')).toBeTruthy();
  });
});
