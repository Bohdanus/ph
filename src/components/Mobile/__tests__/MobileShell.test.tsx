import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileShell } from '../MobileShell.tsx';

const goToToolMock = vi.hoisted(() => vi.fn());
const setActiveLayerMock = vi.hoisted(() => vi.fn());
const createBlankLayerMock = vi.hoisted(() => vi.fn());
const removeLayerMock = vi.hoisted(() => vi.fn());
const toggleVisibilityMock = vi.hoisted(() => vi.fn());
const updateLayerMock = vi.hoisted(() => vi.fn());
const moveLayerAfterMock = vi.hoisted(() => vi.fn());
const resetHistoryToMock = vi.hoisted(() => vi.fn());
const toggleDisabledMock = vi.hoisted(() => vi.fn());
const resetToLastSavedArgsMock = vi.hoisted(() => vi.fn());
const commitDirtyToolMock = vi.hoisted(() => vi.fn(() => ({})));
const openNewImageDialogMock = vi.hoisted(() => vi.fn());
const openLoadImageDialogMock = vi.hoisted(() => vi.fn());
const openSaveImageDialogMock = vi.hoisted(() => vi.fn());
const setBlankImageMock = vi.hoisted(() => vi.fn());
const setImageFromUploadMock = vi.hoisted(() => vi.fn());
const handleImageSaveMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());

const storeStateMock = vi.hoisted(() => ({
  toolName: 'draw',
  hasImage: true,
  fileName: 'photo.jpg',
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: {} as Record<string, unknown> },
  totalSize: { width: 800, height: 600 },
  hasUnsavedChanges: false,
  documentFrame: null as unknown,
  activeLayerId: null as string | null,
  history: [] as Array<Record<string, unknown>>,
  historyIndex: 0,
  layers: {
    bottom: {
      id: 'bottom',
      name: 'Bottom',
      order: 0,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      isBedrock: true,
      pos: { x: 0, y: 0, width: 800, height: 600 },
      operations: [],
      bitmap: null,
      tmpCanvas: null,
    },
    top: {
      id: 'top',
      name: 'Top',
      order: 1,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      isBedrock: false,
      pos: { x: 0, y: 0, width: 800, height: 600 },
      operations: [],
      bitmap: null,
      tmpCanvas: null,
    },
  } as Record<string, Record<string, unknown>>,
}));

const currentToolMock = vi.hoisted(() => ({ isToolDirty: false, toolArgs: { toolName: 'draw' } }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

vi.mock('../../../contexts/useHistory.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../contexts/useHistory.ts')>();
  return {
    ...actual,
    useHistory: () => ({
      resetHistoryTo: resetHistoryToMock,
      toggleDisabled: toggleDisabledMock,
      canUndo: () => true,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
    }),
  };
});

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    isToolDirty: currentToolMock.isToolDirty,
    toolArgs: currentToolMock.toolArgs,
    patchToolArgs: vi.fn(),
    resetToLastSavedArgs: resetToLastSavedArgsMock,
  }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({
    openNewImageDialog: openNewImageDialogMock,
    openLoadImageDialog: openLoadImageDialogMock,
    openSaveImageDialog: openSaveImageDialogMock,
  }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({
    goToTool: goToToolMock,
    setBlankImage: setBlankImageMock,
    setImageFromUpload: setImageFromUploadMock,
    handleImageSave: handleImageSaveMock,
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createBlankLayer: createBlankLayerMock,
    removeLayer: removeLayerMock,
    toggleVisibility: toggleVisibilityMock,
    setActiveLayer: setActiveLayerMock,
    updateLayer: updateLayerMock,
    moveLayerAfter: moveLayerAfterMock,
    commitDirtyTool: commitDirtyToolMock,
  }),
}));

vi.mock('../../../tools/toolsMap.ts', () => ({
  toolsMap: { draw: { toolboxComponent: () => <p>Draw Settings</p> } },
}));

/** The layers drawer is controlled by props, so the shell needs a stateful wrapper. */
const Harness = ({
  layersOpen = false,
  toolSheetOpen = false,
  onToggleToolSheet,
}: {
  layersOpen?: boolean;
  toolSheetOpen?: boolean;
  onToggleToolSheet?: () => void;
}) => {
  const [isLayersOpen, setIsLayersOpen] = useState(layersOpen);
  return (
    <MobileShell
      isToolSheetOpen={toolSheetOpen}
      onToggleToolSheet={() => onToggleToolSheet?.()}
      isLayersOpen={isLayersOpen}
      onToggleLayers={() => setIsLayersOpen((open) => !open)}
    />
  );
};

const regionClasses = (container: HTMLElement) =>
  Array.from(container.children).map((child) => (child as HTMLElement).className);

describe('MobileShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateMock.canvasRef.current = document.createElement('canvas');
    storeStateMock.hasImage = true;
    storeStateMock.toolName = 'draw';
    currentToolMock.isToolDirty = false;
  });

  it('places the header, tool sheet, bar and layers drawer in order while the menu is shut', () => {
    const { container } = render(<Harness layersOpen toolSheetOpen />);

    expect(container.children).toHaveLength(4);
    expect(Array.from(container.children).map((child) => child.tagName)).toEqual(['HEADER', 'DIV', 'NAV', 'DIV']);

    const classes = regionClasses(container);
    expect(classes[0]).toContain('[grid-area:header]');
    expect(classes[0]).toContain('md:hidden');
    expect(classes[1]).toContain('fixed');
    expect(classes[2]).toContain('[grid-area:bottom]');
    expect(classes[2]).toContain('md:hidden');
    expect(classes[3]).toContain('fixed');
  });

  it('renders the five regions in the specified DOM order, menu drawer last', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness layersOpen />);

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    expect(container.children).toHaveLength(5);
    expect(Array.from(container.children).map((child) => child.tagName)).toEqual([
      'HEADER',
      'DIV',
      'NAV',
      'DIV',
      'DIV',
    ]);

    const classes = regionClasses(container);
    expect(classes[0]).toContain('[grid-area:header]');
    expect(classes[0]).toContain('md:hidden');
    expect(classes[1]).toContain('fixed');
    expect(classes[2]).toContain('[grid-area:bottom]');
    expect(classes[2]).toContain('md:hidden');
    expect(classes[3]).toContain('fixed');
    expect(classes[4]).toContain('fixed');

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs.map((dialog) => dialog.getAttribute('aria-label'))).toEqual([
      'Layers & History Drawer',
      'Mobile Navigation Menu',
    ]);
  });

  it('claims no grid area of its own and renders no canvas', () => {
    const { container } = render(<Harness />);

    expect(container.children).toHaveLength(3);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('main')).toBeNull();
  });

  it('treats a missing open state as closed, so nothing covers the canvas on first paint', () => {
    render(<MobileShell onToggleToolSheet={vi.fn()} onToggleLayers={vi.fn()} />);

    // No `isToolSheetOpen` / `isLayersOpen` props at all: the old default of `true`
    // put a 300px panel over the document before any user action.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.getElementById('mobile-tool-options')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tool options' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Toggle layers panel' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('drives the tool sheet from the bar toggle through the one prop it owns', async () => {
    const user = userEvent.setup();
    const onToggleToolSheet = vi.fn();
    render(<Harness onToggleToolSheet={onToggleToolSheet} />);

    await user.click(screen.getByRole('button', { name: 'Tool options' }));

    expect(onToggleToolSheet).toHaveBeenCalledTimes(1);
  });

  it('selects tools through the bar, proving the header and the bar are live', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Crop Tool' }));

    expect(goToToolMock).toHaveBeenCalledWith('crop');
  });

  describe('layers drawer a11y', () => {
    it('opens from the header, moves focus in, and restores focus to the header button', async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const trigger = screen.getByRole('button', { name: 'Toggle layers panel' });
      await user.click(trigger);

      const panel = document.getElementById('mobile-layers-panel')!;
      expect(screen.getByRole('dialog', { name: 'Layers & History Drawer' })).toBeInTheDocument();
      expect(document.activeElement).toBe(panel);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('translates the toggle prop into a close, so a backdrop click does not reopen the drawer', async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Toggle layers panel' }));
      expect(screen.getByRole('dialog', { name: 'Layers & History Drawer' })).toBeInTheDocument();

      // The backdrop is the dialog's first child.
      screen
        .getByRole('dialog', { name: 'Layers & History Drawer' })
        .firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await user.click(document.body);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('menu drawer a11y', () => {
    it('opens from the header, moves focus in, and restores focus to the header button', async () => {
      const user = userEvent.setup();
      render(<Harness />);

      const trigger = screen.getByRole('button', { name: 'Open navigation menu' });
      await user.click(trigger);

      const panel = document.getElementById('mobile-menu-panel')!;
      expect(screen.getByRole('dialog', { name: 'Mobile Navigation Menu' })).toBeInTheDocument();
      expect(document.activeElement).toBe(panel);

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
