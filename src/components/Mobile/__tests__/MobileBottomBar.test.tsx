import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileBottomBar } from '../MobileBottomBar.tsx';
import { mobileToolGroups } from '../mobile-tools.ts';
import { toolbarMap } from '../../../../toolbar-mapping.ts';

const useStoreMock = vi.hoisted(() => vi.fn());
const goToToolMock = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => useStoreMock(),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock }),
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
    // `levels` is in the Colors tile's group, so the old
    // `matchingTools.includes(toolName)` branch opened the options sheet and never
    // reached `color`.
    setTool('levels');
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={onToggleToolSheet} onOpenLayers={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Colors' }));

    expect(goToToolMock).toHaveBeenCalledWith('color');
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

  it('reflects the open sheet through aria-expanded on the options toggle', () => {
    render(<MobileBottomBar isToolSheetOpen={true} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    const optionsToggle = screen.getByRole('button', { name: 'Tool options' });
    expect(optionsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(optionsToggle).toHaveAttribute('aria-controls', 'mobile-tool-options');
  });

  it('marks the active tool’s tile as pressed and every other tile as unpressed', () => {
    setTool('levels');
    render(<MobileBottomBar isToolSheetOpen={false} onToggleToolSheet={vi.fn()} onOpenLayers={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Colors' })).toHaveAttribute('aria-pressed', 'true');
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
