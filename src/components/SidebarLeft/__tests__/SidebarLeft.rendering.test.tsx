import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { storeState, toolbarButtonByName, useSidebarLeftHarness } from './harness.tsx';
import SidebarLeft from '../SidebarLeft.tsx';

describe('SidebarLeft rendering', () => {
  useSidebarLeftHarness();
  it('renders the available tools in Photoshop-inspired order', () => {
    render(<SidebarLeft />);

    const toolbar = screen.getByTestId('left-toolbar-tools');
    const buttonNames = [...toolbar.querySelectorAll<HTMLButtonElement>('button[data-testid^="tool-button-"]')].map(
      (button) => button.dataset.testid?.replace('tool-button-', '')
    );

    // A hard-coded pin on the tile order, NOT derived from `toolbarMap`: re-deriving it would
    // make this test pass for any map at all, which is the one thing it exists to catch.
    //
    // `color`, `levels` and `transform` are absent because Photoshop's Tools panel has no such
    // entries — they are `Image ▸ Adjustments` and `Edit ▸ Transform` commands, and the
    // command is not a tool. Which registered tools carry no tile at all is pinned in
    // `toolbar-mapping.test.ts`; this list pins the tiles that do exist and the order they
    // appear in.
    expect(buttonNames).toEqual([
      'reposition',
      'hand',
      'zoom',
      'rectangular-selection',
      'freehand-lasso',
      'magic-wand',
      'eyedropper',
      'crop',
      'brush',
      'eraser',
      'spot-healing',
      'paint-bucket',
      'gradient',
      'clone-stamp',
      'red-eye',
      'blur',
      'dodge',
      'draw',
      'pen',
      'text',
      'shape',
    ]);
    expect(screen.queryByText('Artboard Tool')).toBeNull();
  });

  it('does not render anything when there is no image', () => {
    Object.assign(storeState, { hasImage: false });
    const { container } = render(<SidebarLeft />);
    expect(container.firstChild).toBeNull();
  });

  it('renders color pickers and the swap control', () => {
    render(<SidebarLeft />);

    expect(screen.getByTestId('color-pickers')).toBeInTheDocument();
    expect(screen.getByTestId('foreground-color-swatch')).toBeInTheDocument();
    expect(screen.getByTestId('background-color-swatch')).toBeInTheDocument();
    expect(screen.getByTestId('swap-colors-button')).toBeInTheDocument();
  });

  it('names every tool tile after its primary tool', () => {
    render(<SidebarLeft />);

    expect(toolbarButtonByName('reposition')).toHaveAccessibleName('Move Tool');
    expect(toolbarButtonByName('hand')).toHaveAccessibleName('Hand Tool');
    expect(toolbarButtonByName('zoom')).toHaveAccessibleName('Zoom Tool');
    expect(toolbarButtonByName('rectangular-selection')).toHaveAccessibleName('Rectangular Marquee Tool');
    expect(toolbarButtonByName('freehand-lasso')).toHaveAccessibleName('Lasso Tool');
    expect(toolbarButtonByName('magic-wand')).toHaveAccessibleName('Magic Wand Tool');
    expect(toolbarButtonByName('crop')).toHaveAccessibleName('Crop Tool');
    expect(toolbarButtonByName('eyedropper')).toHaveAccessibleName('Eyedropper Tool');
    expect(toolbarButtonByName('brush')).toHaveAccessibleName('Brush Tool');
    expect(toolbarButtonByName('clone-stamp')).toHaveAccessibleName('Clone Stamp Tool');
    expect(toolbarButtonByName('blur')).toHaveAccessibleName('Blur Tool');
    expect(toolbarButtonByName('gradient')).toHaveAccessibleName('Gradient Tool');
    expect(toolbarButtonByName('dodge')).toHaveAccessibleName('Dodge Tool');
    expect(toolbarButtonByName('draw')).toHaveAccessibleName('Draw Tool');
    expect(toolbarButtonByName('pen')).toHaveAccessibleName('Pen Tool');
    expect(toolbarButtonByName('text')).toHaveAccessibleName('Horizontal Type Tool');
    expect(toolbarButtonByName('shape')).toHaveAccessibleName('Rectangle Tool');
  });

  it('marks flyout groups with a corner indicator and leaves single-tool tiles plain', () => {
    render(<SidebarLeft />);

    const hasFlyoutIndicator = (name: string) =>
      toolbarButtonByName(name).querySelector('span[aria-hidden="true"]') !== null;

    expect(hasFlyoutIndicator('freehand-lasso')).toBe(true);
    expect(hasFlyoutIndicator('brush')).toBe(true);
    expect(hasFlyoutIndicator('eraser')).toBe(true);
    expect(hasFlyoutIndicator('spot-healing')).toBe(true);
    expect(hasFlyoutIndicator('pen')).toBe(true);
    expect(hasFlyoutIndicator('shape')).toBe(true);
    // The marquee, quick-selection, focus and tonal tiles are multi-item flyouts, so each
    // one carries the corner indicator.
    expect(hasFlyoutIndicator('rectangular-selection')).toBe(true);
    expect(hasFlyoutIndicator('magic-wand')).toBe(true);
    expect(hasFlyoutIndicator('blur')).toBe(true);
    expect(hasFlyoutIndicator('dodge')).toBe(true);

    expect(hasFlyoutIndicator('reposition')).toBe(false);
    expect(hasFlyoutIndicator('hand')).toBe(true);
    expect(hasFlyoutIndicator('zoom')).toBe(false);
    expect(hasFlyoutIndicator('crop')).toBe(false);
    // The `I` tile is a flyout since the Ruler joined it, so it carries the indicator. Its NAME is
    // still `eyedropper`, because a tile's identity is its first entry.
    expect(hasFlyoutIndicator('eyedropper')).toBe(true);
    // The Stamp flyout carries only the clone stamp for now: Photoshop's pattern and
    // patch stamps are not implemented, so the group has length 1 and stays plain.
    expect(hasFlyoutIndicator('clone-stamp')).toBe(false);
    expect(hasFlyoutIndicator('draw')).toBe(false);
    expect(hasFlyoutIndicator('text')).toBe(false);
    // The Gradient is its own single-tool tile. The Paint Bucket is now its own single-tool tile
    // as well, per the Photoshop-faithful B/E/G group split.
    expect(hasFlyoutIndicator('gradient')).toBe(false);
    expect(hasFlyoutIndicator('paint-bucket')).toBe(false);
  });
});
