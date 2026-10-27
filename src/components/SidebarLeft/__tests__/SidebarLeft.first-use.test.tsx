import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { toolbarButtonByName, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

const openPenFlyout = () => {
  fireEvent.contextMenu(toolbarButtonByName('pen'));
  return screen.getByRole('menu');
};

describe('SidebarLeft first-use badges', () => {
  useSidebarLeftHarness();

  it('marks unimplemented tools as new without marking implemented tools', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('tool-new-badge-pen')).toBeInTheDocument();
    expect(screen.queryByTestId('tool-new-badge-brush')).not.toBeInTheDocument();
  });

  it.each(['hover', 'focus'] as const)('marks a tile seen on %s', (interaction) => {
    render(<SidebarLeft />);
    const tile = toolbarButtonByName('pen');

    if (interaction === 'hover') fireEvent.mouseEnter(tile);
    else fireEvent.focus(tile);

    expect(screen.queryByTestId('tool-new-badge-pen')).not.toBeInTheDocument();
  });

  it('marks a flyout row seen on hover and keyboard focus', () => {
    render(<SidebarLeft />);
    const flyout = openPenFlyout();
    const freeformPen = within(flyout).getByRole('menuitemradio', { name: 'Freeform Pen Tool' });

    expect(screen.getByTestId('tool-new-badge-freeform-pen')).toBeInTheDocument();
    fireEvent.mouseEnter(freeformPen);
    expect(screen.queryByTestId('tool-new-badge-freeform-pen')).not.toBeInTheDocument();

    const curvaturePen = within(flyout).getByRole('menuitemradio', { name: 'Curvature Pen Tool' });
    expect(screen.getByTestId('tool-new-badge-curvature-pen')).toBeInTheDocument();
    fireEvent.focus(curvaturePen);
    expect(screen.queryByTestId('tool-new-badge-curvature-pen')).not.toBeInTheDocument();
  });

  it('positions each flyout badge relative to its own row', () => {
    render(<SidebarLeft />);
    const flyout = openPenFlyout();
    const freeformPen = within(flyout).getByRole('menuitemradio', { name: 'Freeform Pen Tool' });
    const badge = screen.getByTestId('tool-new-badge-freeform-pen');

    expect(freeformPen).toHaveClass('relative');
    expect(freeformPen).toContainElement(badge);
  });

  it('updates after another tab changes the first-use record', () => {
    render(<SidebarLeft />);
    expect(screen.getByTestId('tool-new-badge-pen')).toBeInTheDocument();

    localStorage.setItem('ph.firstUse', JSON.stringify({ pen: false }));
    fireEvent(window, new StorageEvent('storage', { key: 'ph.firstUse', newValue: JSON.stringify({ pen: false }) }));

    expect(screen.queryByTestId('tool-new-badge-pen')).not.toBeInTheDocument();
  });
});
