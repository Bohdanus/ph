import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileBottomBar } from '../MobileBottomBar.tsx';
import { mobileToolGroups } from '../mobile-tools.ts';
import { toolbarMap } from '../../../../toolbar-mapping.ts';

const useStoreMock = vi.hoisted(() => vi.fn());
const goToToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => useStoreMock(),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock }),
}));

// The bar selects through the shared figure-aware helper, so it needs
// `patchToolArgs` as well as `goToTool`.
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: { toolName: 'draw' }, patchToolArgs: patchToolArgsMock }),
}));

const setTool = (toolName: string, hasImage = true) => useStoreMock.mockReturnValue([{ toolName, hasImage }]);

describe('MobileBottomBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTool('draw');
  });

  it('derives one tile per desktop rail group, so every tool in the registry is on the bar', () => {
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    const railGroups = toolbarMap.flat();
    expect(mobileToolGroups).toHaveLength(railGroups.length);
    expect(mobileToolGroups.map((group) => group.primaryTool)).toEqual(railGroups.map((group) => group[0].name));

    for (const group of railGroups) {
      expect(screen.getByRole('button', { name: group[0].label })).toBeInTheDocument();
    }
  });

  it('reaches the four tools the old hand-written list predated', () => {
    // The old list was `MOBILE_TOOLS: MobileToolItem[]` — a literal that nothing
    // type-checked against `ToolName`, so `eraser`, `magic-eraser`,
    // `paint-bucket` and `eyedropper` (commit 80eb207) simply never appeared. A
    // tile is the desktop rail's group, so these four arrive on the owning tile's
    // group and are selected from the tool sheet's picker for that group
    // (see MobileToolSheet.test.tsx).
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    const brushGroup = mobileToolGroups.find((group) => group.matchingTools.includes('eraser'))!;
    expect(brushGroup.primaryTool).toBe('brush');
    expect(brushGroup.matchingTools).toEqual(
      expect.arrayContaining(['brush', 'eraser', 'magic-eraser', 'paint-bucket', 'color-replacement', 'pencil'])
    );
    expect(screen.getByRole('button', { name: 'Brush Tool' })).toBeInTheDocument();

    const eyedropperGroup = mobileToolGroups.find((group) => group.matchingTools.includes('eyedropper'))!;
    expect(eyedropperGroup.primaryTool).toBe('eyedropper');
    expect(screen.getByRole('button', { name: 'Eyedropper Tool' })).toBeInTheDocument();
  });

  it('selects its own primary tool even when the current tool is already one of its matching tools', async () => {
    const user = userEvent.setup();
    const onToggleToolSheet = vi.fn();
    // `pencil` is in the Brush tile's group and is not that group's primary, so the
    // `matchingTools.includes(toolName)` branch opened the options sheet and never
    // reached `brush`.
    //
    // It was `levels` in the old Colors tile's group. `color`/`levels`/`transform` are
    // `Image ▸ Adjustments` and `Edit ▸ Transform` commands now and have no rail entry, so
    // neither does `mobileToolGroups`; the Brush group is a live tile with six members, which
    // exercises the same branch at least as hard.
    setTool('pencil');
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={onToggleToolSheet} onOpenLayers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Brush Tool' }));

    expect(goToToolMock).toHaveBeenCalledWith('brush');
    expect(onToggleToolSheet).not.toHaveBeenCalled();
  });

  it('selects its own primary tool when the current tool is the primary itself', async () => {
    const user = userEvent.setup();
    const onToggleToolSheet = vi.fn();
    setTool('crop');
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={onToggleToolSheet} onOpenLayers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Crop Tool' }));

    expect(goToToolMock).toHaveBeenCalledWith('crop');
    expect(onToggleToolSheet).not.toHaveBeenCalled();
  });

  it('drives the options sheet from its own control, which is not a tool tile', async () => {
    const user = userEvent.setup();
    const onToggleToolSheet = vi.fn();
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={onToggleToolSheet} onOpenLayers={vi.fn()} />);

    const optionsToggle = screen.getByRole('button', { name: 'Tool options' });
    await user.click(optionsToggle);

    expect(onToggleToolSheet).toHaveBeenCalledTimes(1);
    expect(goToToolMock).not.toHaveBeenCalled();
  });

  it('reflects the open sheet through aria-expanded on the options toggle, and names it only then', () => {
    // Open: the name must be there. This suite renders no `MobileToolSheet`, so resolution is
    // proved in `MobileShell`, which mounts both.
    const { rerender } = render(
      <MobileBottomBar isToolSheetOpen={true} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />
    );

    const optionsToggle = screen.getByRole('button', { name: 'Tool options' });
    expect(optionsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(optionsToggle).toHaveAttribute('aria-controls', 'mobile-tool-options');

    // Closed: the panel is a SIBLING component that renders its body only when open, so the id is
    // not in the tree. `aria-expanded="false"` with no `aria-controls` is the honest pair, and it
    // is the case this toggle's assertion never covered.
    rerender(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);
    expect(optionsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(optionsToggle).not.toHaveAttribute('aria-controls');
  });

  it('marks the active tool’s tile as pressed and every other tile as unpressed', () => {
    // A group member that is NOT the group's primary, so "pressed" is proven to come from
    // `matchingTools` and not from the tile's own identity. `pencil` stands in for `levels`,
    // whose tile no longer exists.
    setTool('pencil');
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Brush Tool' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Crop Tool' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Tool options' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Layers' })).not.toHaveAttribute('aria-pressed');
  });

  it('opens the layers drawer from its own control', async () => {
    const user = userEvent.setup();
    const onOpenLayers = vi.fn();
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={onOpenLayers} />);

    await user.click(screen.getByRole('button', { name: 'Layers' }));

    expect(onOpenLayers).toHaveBeenCalledTimes(1);
    expect(goToToolMock).not.toHaveBeenCalled();
  });

  it('keeps every tile at least 44px on both axes', () => {
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    // The bar is `h-16` with `items-stretch`, so every tile is 64px tall; `min-w-16`
    // is 64px on the narrow axis. The options and layers controls opt out of the
    // stretch only on width, so they carry the same floor.
    for (const group of mobileToolGroups) {
      const tile = screen.getByRole('button', { name: group.tools[0].label });
      expect(tile.className).toMatch(/min-w-16/);
    }
    for (const name of ['Tool options', 'Layers']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/min-w-16/);
    }
  });

  it('disables every tool control without a document', () => {
    setTool('draw', false);
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    for (const group of mobileToolGroups) {
      expect(screen.getByRole('button', { name: group.tools[0].label })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Tool options' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Layers' })).toBeDisabled();
  });
});

describe('MobileBottomBar figure selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTool('draw');
  });

  it('selects the figure the tile is captioned with', async () => {
    const user = userEvent.setup();
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    // Five `toolbarMap` entries share the `shape` name and differ only by `figure`; the
    // shape group's primary is `{ name: 'shape', figure: 'rectangle' }`. The tile was built
    // from `primaryTool` alone, so it read "Rectangle" and selected plain `shape`, leaving
    // the figure at whatever the outgoing tool held. `SidebarLeft.selectTool` avoids this by
    // taking the whole `ToolbarTool`.
    await user.click(screen.getByRole('button', { name: 'Rectangle Tool' }));

    expect(goToToolMock).toHaveBeenCalledWith('shape');
    expect(patchToolArgsMock).toHaveBeenCalledWith('shape', { figure: 'rectangle' });
  });

  it('selects first and patches second, so the outgoing tool commits its own args', async () => {
    const user = userEvent.setup();
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Rectangle Tool' }));

    // `goToTool` runs `commitDirtyTool()` against the OUTGOING tool, which reads the
    // outgoing args. Patching the incoming tool's args first would clobber them.
    expect(goToToolMock.mock.invocationCallOrder[0]).toBeLessThan(patchToolArgsMock.mock.invocationCallOrder[0]);
  });

  it('does not patch a figure for a tool that has none', async () => {
    const user = userEvent.setup();
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Crop Tool' }));

    expect(goToToolMock).toHaveBeenCalledWith('crop');
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });
});
