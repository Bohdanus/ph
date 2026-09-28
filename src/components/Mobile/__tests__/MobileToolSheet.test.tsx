import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileToolSheet } from '../MobileToolSheet.tsx';
import { mobileToolGroups } from '../mobile-tools.ts';

const useStoreMock = vi.hoisted(() => vi.fn());
const goToToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());
const currentToolMock = vi.hoisted(() => ({
  isToolDirty: false,
  toolArgs: { toolName: 'draw' } as Record<string, unknown>,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => useStoreMock(),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ ...currentToolMock, patchToolArgs: patchToolArgsMock }),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock }),
}));

// Only the toolbox panel is under test here; the real `toolsMap` pulls in every
// tool component in the app.
vi.mock('../../../tools/toolsMap.ts', () => ({
  toolsMap: {
    draw: { toolboxComponent: () => <p>Custom Draw Settings</p> },
    brush: { toolboxComponent: () => <p>Brush Settings</p> },
  },
}));

const setTool = (toolName: string) => useStoreMock.mockReturnValue([{ toolName, hasImage: true }]);

describe('MobileToolSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentToolMock.isToolDirty = false;
    currentToolMock.toolArgs = { toolName: 'draw' };
    setTool('draw');
  });

  it('keeps the options panel unmounted while closed and advertises that on the header', () => {
    render(<MobileToolSheet isOpen={false} onToggle={vi.fn()} />);

    expect(document.getElementById('mobile-tool-options')).toBeNull();

    const header = screen.getByRole('button', { name: /draw options/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveAttribute('aria-controls', 'mobile-tool-options');
  });

  it('is reachable by keyboard, because the header is the button rather than a clickable div', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MobileToolSheet isOpen={false} onToggle={onToggle} />);

    const header = screen.getByRole('button', { name: /draw options/i });
    // The old markup was a `div onClick` with no role and no key handler, wrapping a
    // `<button>` with no handler of its own. `getByRole('button')` finding it at all
    // is the proof that it is a real button now.
    expect(header.tagName).toBe('BUTTON');
    expect(header.querySelector('button')).toBeNull();

    header.focus();
    expect(header).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('reports the open state through aria-expanded and renders the panel', () => {
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: /draw options/i })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('mobile-tool-options')).not.toBeNull();
    expect(screen.getByText('Custom Draw Settings')).toBeInTheDocument();
  });

  it('toggles from the header click as well as from the keyboard', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<MobileToolSheet isOpen={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: /draw options/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('keeps both axes touch-pannable, so the panel scrolls under an ancestor touch-action', () => {
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    // Only observable as classes; there is no behavioural probe for `touch-action`.
    const panel = document.getElementById('mobile-tool-options')!;
    expect(panel.className).toContain('overflow-x-auto');
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.className).toContain('touch-pan-x');
    expect(panel.className).toContain('touch-pan-y');
  });

  // Deleted for the reason recorded in `MobileHeader.test.tsx`: `isToolDirty` has no
  // writer, so the "Modified" badge this asserted could never appear in the app. The
  // badge is gone with the flag rather than left as a permanently hidden element.

  it('offers every tool of the active rail group, so the tile primary is not the only reachable member', async () => {
    const user = userEvent.setup();
    setTool('brush');
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    const brushGroup = mobileToolGroups.find((group) => group.matchingTools.includes('brush'))!;
    expect(brushGroup.tools.map((tool) => tool.name)).toEqual([
      'brush',
      'pencil',
      'color-replacement',
      'eraser',
      'magic-eraser',
      'paint-bucket',
    ]);

    for (const tool of brushGroup.tools) {
      expect(screen.getByRole('button', { name: tool.label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Eraser Tool' }));
    expect(goToToolMock).toHaveBeenCalledWith('eraser');
  });

  it('marks only the active member of the group as pressed', () => {
    setTool('levels');
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    const editGroup = mobileToolGroups.find((group) => group.matchingTools.includes('levels'))!;
    expect(screen.getByRole('button', { name: 'Levels' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Colors' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Transform' })).toHaveAttribute('aria-pressed', 'false');
    expect(editGroup.matchingTools).toEqual(['color', 'levels', 'transform']);
  });

  it('renders nothing without a document', () => {
    useStoreMock.mockReturnValue([{ toolName: 'draw', hasImage: false }]);
    const { container } = render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
