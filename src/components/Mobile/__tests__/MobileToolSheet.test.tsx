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
      'spot-healing',
      'healing-brush',
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
    // `eraser` is in the Brush group and is not that group's primary, which is the condition
    // the old `levels`-in-the-Colors-tile case set up: pressed must be resolved per member of
    // the group rather than by handing the whole tile to the one active tool.
    //
    // `color`/`levels`/`transform` carry no rail entry any more — they are `Image ▸
    // Adjustments` and `Edit ▸ Transform` commands, so `mobileToolGroups` has no group for
    // them and the sheet has no picker to mark. The Brush group is a live six-member group.
    setTool('eraser');
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    const brushGroup = mobileToolGroups.find((group) => group.matchingTools.includes('eraser'))!;
    expect(screen.getByRole('button', { name: 'Eraser Tool' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Brush Tool' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Pencil Tool' })).toHaveAttribute('aria-pressed', 'false');
    expect(brushGroup.matchingTools).toEqual([
      'brush',
      'pencil',
      'color-replacement',
      'spot-healing',
      'healing-brush',
      'eraser',
      'magic-eraser',
      'paint-bucket',
    ]);
  });

  it('keeps the full-width overlay out of hit testing, and the card inside it in', () => {
    render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    // The outer wrapper spans the viewport (`left-0 right-0`) at `z-40`, so it is a
    // full-width band sitting over the whole shell. With `pointer-events: auto` it becomes
    // a target, and every click aimed past the sheet is swallowed by it — the same rule
    // `AnchoredOverlay` implements for the tool flyout and the tooltip, and the same one
    // their suites pin. The card opts back in, so the sheet's own controls still take a
    // click.
    const sheet = screen.getByTestId('mobile-tool-sheet');
    expect(sheet).toHaveClass('left-0', 'right-0');
    expect(sheet).toHaveClass('pointer-events-none');

    // BOTH elements, because asserting the card alone would pass today and would not notice
    // the outer wrapper losing its class — the card's own `pointer-events-auto` is
    // inherited-proof, and the defect is precisely the half that is not there.
    const card = sheet.firstElementChild as HTMLElement;
    expect(card).toHaveClass('pointer-events-auto');
  });

  it('renders nothing without a document', () => {
    useStoreMock.mockReturnValue([{ toolName: 'draw', hasImage: false }]);
    const { container } = render(<MobileToolSheet isOpen={true} onToggle={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
