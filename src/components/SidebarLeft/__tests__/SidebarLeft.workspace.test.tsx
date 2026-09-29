import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import SidebarLeft from '../SidebarLeft.tsx';
import { PanelLayoutProvider } from '../../../contexts/PanelLayout.tsx';

/**
 * The rail's place in the workspace, which is the one part of its layout that is not a column
 * count.
 *
 * "You can dock the Tools panel to either the right or left sides of the application window"
 * (teachucomp; the CC-era Adobe book says the same by its title bar), and "Unlike most panels
 * in Photoshop, however, you cannot dock the Tools panel at the bottom... or group it with
 * other panels" — the same page continues that the Tools panel has a fixed width in each of
 * its two layouts, which is why nothing here resizes the rail.
 *
 * The width assertions are the pre-existing ones and the drag assertions are new: what has to
 * hold is that re-docking moves the rail BETWEEN the two named grid areas, changes the border
 * to the side that now faces the canvas, and flips the overlays to the other side of their
 * tiles, and that a cancelled drag does none of it.
 */

const goToTool = vi.fn();
const patchToolArgsMock = vi.fn();

const storeStateRef = vi.hoisted(() => ({
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  hasImage: true,
  dispatch: vi.fn(),
}));

const toolArgsRef = vi.hoisted(() => ({ toolName: 'draw' as string, figure: undefined as string | undefined }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateRef, storeStateRef.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => ({ goToTool }) }));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolArgsRef, patchToolArgs: patchToolArgsMock }),
}));

vi.mock('../toolIcons.tsx', () => {
  const Icon = () => <svg aria-hidden="true" />;
  const names = [
    'reposition',
    'rectangular-selection',
    'elliptical-selection',
    'freehand-lasso',
    'polygonal-lasso',
    'feather-magnetic-lasso',
    'magic-wand',
    'quick-selection',
    'eyedropper',
    'eraser',
    'clone-stamp',
    'paint-bucket',
    'gradient',
    'sharpen',
    'smudge',
    'dodge',
    'burn',
    'crop',
    'draw',
    'shape',
    'text',
    'color',
    'blur',
    'levels',
    'transform',
    'brush',
    'pencil',
    'color-replacement',
    'magic-eraser',
    'pen',
    'freehand-pen',
    'curvature-pen',
    'add-anchor-point',
    'delete-anchor-point',
    'convert-point',
    'rectangle',
    'ellipse',
    'triangle',
    'polygon',
    'line',
    'custom-shape',
  ];
  return { toolIcons: Object.fromEntries(names.map((name) => [name, Icon])) };
});

const renderRail = (children: ReactNode = <SidebarLeft />) =>
  render(<PanelLayoutProvider>{children}</PanelLayoutProvider>);

/**
 * jsdom reports a 0px-wide document, and the re-dock zone is a fraction of it — so a drag
 * from any `clientX` is "at the edge" and every test would pass for the wrong reason. The
 * viewport is stubbed to 1024px so the 25% threshold is a real distance.
 */
const stubViewportWidth = (width: number) =>
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(width);

describe('SidebarLeft workspace placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.assign(storeStateRef, { hasImage: true, toolName: 'draw' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts on the left edge, on the canvas-facing side of that edge', () => {
    renderRail();

    const rail = screen.getByTestId('left-sidebar');
    expect(rail).toHaveClass('[grid-area:left]');
    // The border belongs on the side that faces the canvas, or the rail reads as a separate
    // block from the canvas rather than as the edge of it.
    expect(rail).toHaveClass('border-r');
    expect(rail).not.toHaveClass('border-l');
  });

  it("keeps both of Photoshop's rail widths; re-docking is not a resize", () => {
    renderRail();

    // "Unlike most panels in Photoshop, however, you cannot... resize" the Tools panel. The
    // 108px/56px pair is the one/two-column layout the toggle switches between, and a drag
    // must not be a third thing that changes it.
    expect(screen.getByTestId('left-sidebar')).toHaveStyle({ width: '108px' });

    act(() => {
      fireEvent.click(screen.getByTestId('toolbar-layout-toggle'));
    });
    expect(screen.getByTestId('left-sidebar')).toHaveStyle({ width: '56px' });
  });

  it('drags to the opposite edge, and lands there', () => {
    const restore = stubViewportWidth(1024);
    try {
      renderRail();

      const grip = screen.getByTestId('rail-re-dock-handle');
      fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 20 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 20 });

      // "Release the tab when a blue highlight appears" — the target is shown, not implied.
      expect(screen.getByTestId('rail-drop-line')).toHaveClass('left-0');

      fireEvent.pointerUp(document, { pointerId: 1 });

      const rail = screen.getByTestId('left-sidebar');
      expect(rail).toHaveClass('[grid-area:right]');
      // The border follows: on the right edge, the canvas-facing side is the LEFT one.
      expect(rail).toHaveClass('border-l');
      expect(rail).not.toHaveClass('border-r');
    } finally {
      restore();
    }
  });

  it('offers no drop target over its own edge', () => {
    const restore = stubViewportWidth(1024);
    try {
      renderRail();

      const grip = screen.getByTestId('rail-re-dock-handle');
      fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 1, clientX: 500, clientY: 20 });
      // A small movement, still over the middle of the window.
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 520, clientY: 20 });

      expect(screen.queryByTestId('rail-drop-line')).toBeNull();

      fireEvent.pointerUp(document, { pointerId: 1 });
      expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:left]');
    } finally {
      restore();
    }
  });

  it('does not re-dock when the drag is cancelled with Escape', () => {
    const restore = stubViewportWidth(1024);
    try {
      renderRail();

      const grip = screen.getByTestId('rail-re-dock-handle');
      fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 1, clientX: 900, clientY: 20 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 20 });
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.pointerUp(document, { pointerId: 1 });

      // The gesture moves the rail to the OPPOSITE edge, so committing it after the user has
      // pressed Escape is the one result Escape must never produce.
      expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:left]');
    } finally {
      restore();
    }
  });

  it('swings the drop target to the other edge once the rail is on the right', () => {
    const restore = stubViewportWidth(1024);
    try {
      localStorage.setItem('panelLayout', JSON.stringify({ dockOnLeft: true }));
      renderRail();

      expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:right]');

      const grip = screen.getByTestId('rail-re-dock-handle');
      fireEvent.pointerDown(grip, { button: 0, buttons: 1, pointerId: 1, clientX: 40, clientY: 20 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 900, clientY: 20 });

      expect(screen.getByTestId('rail-drop-line')).toHaveClass('right-0');

      fireEvent.pointerUp(document, { pointerId: 1 });
      expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:left]');
    } finally {
      restore();
    }
  });

  it('ignores a right-click on the grip, so a context menu is still a context menu', () => {
    renderRail();

    const grip = screen.getByTestId('rail-re-dock-handle');
    fireEvent.pointerDown(grip, { button: 2, buttons: 2, pointerId: 1, clientX: 900, clientY: 20 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(document, { pointerId: 1 });

    expect(screen.getByTestId('left-sidebar')).toHaveClass('[grid-area:left]');
  });

  it('keeps the toggle and the grip in the one row that already existed', () => {
    // The rail has no title bar of Photoshop's own to grab, so a second row would be chrome
    // Adobe does not have. The grip joins the row the one/two-column toggle was already in,
    // which is also where a user goes when they want the rail to change shape.
    renderRail();

    const grip = screen.getByTestId('rail-re-dock-handle');
    const toggle = screen.getByTestId('toolbar-layout-toggle');
    expect(grip.parentElement).toBe(toggle.parentElement);
    expect(grip.parentElement).toHaveClass('mb-2', 'w-full');
  });
});
