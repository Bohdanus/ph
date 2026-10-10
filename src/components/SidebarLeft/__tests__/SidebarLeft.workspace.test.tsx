import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarLeft from '../SidebarLeft.tsx';
import { PanelLayoutProvider } from '../../../contexts/PanelLayout.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ hasImage: true, toolName: 'draw', color: '#000000', backgroundColor: '#ffffff' }, vi.fn()],
}));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => ({ goToTool: vi.fn() }) }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: { toolName: 'draw' }, patchToolArgs: vi.fn() }),
}));
vi.mock('../toolIcons.tsx', () => ({
  toolIcons: new Proxy({}, { get: () => () => null }),
}));

describe('SidebarLeft workspace placement', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const renderRail = () =>
    render(
      <PanelLayoutProvider>
        <SidebarLeft />
      </PanelLayoutProvider>
    );

  it('is pinned to the left edge and has no relocation control', () => {
    renderRail();

    const rail = screen.getByTestId('left-sidebar');
    expect(rail).toHaveClass('[grid-area:left]', 'border-r');
    expect(rail).not.toHaveClass('[grid-area:right]', 'border-l');
    expect(screen.queryByTestId('rail-re-dock-handle')).toBeNull();
    expect(screen.queryByTestId('rail-drop-line')).toBeNull();
  });

  it('normalizes legacy side preferences back to the pinned shell', () => {
    localStorage.setItem('panelLayout', JSON.stringify({ toolsSide: 'right', dockSide: 'left' }));
    renderRail();

    expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:left]', 'border-r');
    expect(screen.queryByTestId('rail-re-dock-handle')).toBeNull();
  });

  it('keeps the Photoshop one-column/two-column toolbar toggle', () => {
    renderRail();

    const rail = screen.getByTestId('left-sidebar');
    const startingWidth = rail.getAttribute('style');
    fireEvent.click(screen.getByTestId('toolbar-layout-toggle'));
    expect(rail.getAttribute('style')).not.toBe(startingWidth);
    fireEvent.click(screen.getByTestId('toolbar-layout-toggle'));
    expect(rail.getAttribute('style')).toBe(startingWidth);
  });
});
