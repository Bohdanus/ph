import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileShell } from '../MobileShell.tsx';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext.tsx';
import { setViewportWidth } from '../../../test/setup.ts';

/** A width inside the mobile band, where every surface in this suite is meant to live. */
const MOBILE_WIDTH = 500;

const goToToolMock = vi.hoisted(() => vi.fn());
const setActiveLayerMock = vi.hoisted(() => vi.fn());
const createBlankLayerMock = vi.hoisted(() => vi.fn());
const removeLayerMock = vi.hoisted(() => vi.fn());
const toggleVisibilityMock = vi.hoisted(() => vi.fn());
const updateLayerMock = vi.hoisted(() => vi.fn());
const moveLayerAfterMock = vi.hoisted(() => vi.fn());
const resetHistoryToMock = vi.hoisted(() => vi.fn());
const toggleDisabledMock = vi.hoisted(() => vi.fn());
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
  // A REF, like `currentArgs`: `MobileShell` renders `MobileMenuDrawer`, which reads the
  // discard guard, and the provider consults `previewLayers.current` when it asks.
  previewLayers: { current: {} as Record<string, unknown> },
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
/**
 * Mirrors how `App.tsx` owns the two surface flags: as state, with the toggles flipping it.
 *
 * The props are INITIAL values, not the live ones. Holding `isToolSheetOpen` fixed and
 * passing a no-op toggle — which this harness used to do — makes every assertion about the
 * sheet vacuous, because nothing the shell does can change what it renders.
 *
 * The shell owns the menu drawer, and the drawer reads the app's one discard guard, so the
 * provider is mounted here rather than mocked: it is the shipped one, reading the `useStore`
 * mock above. Nothing in this suite makes the document dirty, so it never renders a prompt
 * and the region and dialog counts below describe the shell alone.
 */
const Harness = ({ layersOpen = false, toolSheetOpen = false }: { layersOpen?: boolean; toolSheetOpen?: boolean }) => {
  const [isLayersOpen, setIsLayersOpen] = useState(layersOpen);
  const [isToolSheetOpen, setIsToolSheetOpen] = useState(toolSheetOpen);
  return (
    <UnsavedChangesProvider>
      <MobileShell
        isToolSheetOpen={isToolSheetOpen}
        onToggleToolSheet={() => setIsToolSheetOpen((open) => !open)}
        isLayersOpen={isLayersOpen}
        onToggleLayers={() => setIsLayersOpen((open) => !open)}
      />
    </UnsavedChangesProvider>
  );
};

const regionClasses = (container: HTMLElement) =>
  Array.from(container.children).map((child) => (child as HTMLElement).className);

describe('MobileShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The shell closes every surface outside the mobile band, and jsdom's default
    // `innerWidth` is 1024 — a desktop width. Without this the suite would be asserting the
    // desktop behaviour while named for the mobile one.
    setViewportWidth(MOBILE_WIDTH);
    storeStateMock.canvasRef.current = document.createElement('canvas');
    storeStateMock.hasImage = true;
    storeStateMock.toolName = 'draw';
    currentToolMock.isToolDirty = false;
  });

  // Teardown is a state change like any other: the crossing back to the desktop band is
  // delivered to every still-subscribed `useMediaQuery`, and the shell re-renders over it.
  // `act` is what the two test bodies below already wrap their own crossings with.
  afterEach(() => act(() => setViewportWidth(1280)));

  it('closes the navigation menu when the viewport leaves the mobile band', async () => {
    // The shell is mounted at every width and hidden with `md:hidden`, and `display: none`
    // hides without unmounting — so a surface left open on a phone stays RENDERED on desktop.
    // The two flags the shell does not own are reset by `AppContainer`, which is where that
    // behaviour is tested; this covers the one it does own.
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('dialog', { name: 'Mobile Navigation Menu' })).toBeInTheDocument();

    act(() => {
      setViewportWidth(1280);
    });

    expect(screen.queryByRole('dialog', { name: 'Mobile Navigation Menu' })).toBeNull();
  });

  it('keeps the surfaces open inside the mobile band', () => {
    render(<Harness layersOpen toolSheetOpen />);

    act(() => {
      setViewportWidth(700);
    });

    expect(screen.getByRole('dialog', { name: 'Layers & History Drawer' })).toBeInTheDocument();
    expect(document.getElementById('mobile-tool-options')).not.toBeNull();
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
    render(
      <UnsavedChangesProvider>
        <MobileShell onToggleToolSheet={vi.fn()} onToggleLayers={vi.fn()} />
      </UnsavedChangesProvider>
    );

    // No `isToolSheetOpen` / `isLayersOpen` props at all: the old default of `true`
    // put a 300px panel over the document before any user action.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.getElementById('mobile-tool-options')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tool options' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Toggle layers panel' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('drives the tool sheet from the bar toggle', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const toggle = screen.getByRole('button', { name: 'Tool options' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('mobile-tool-options')).toBeNull();
    // The honest pair while closed: `aria-expanded="false"` and no `aria-controls`, not a name
    // with no target. Both halves matter here because this is the only case that mounts the
    // toggle and its panel together.
    expect(toggle).not.toHaveAttribute('aria-controls');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('mobile-tool-options')).not.toBeNull();
    // And open, the name must RESOLVE — asserting the attribute alone would pass whether or not
    // the id it names is in the tree.
    expect(toggle.getAttribute('aria-controls')).toBe('mobile-tool-options');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('mobile-tool-options')).toBeNull();
    expect(toggle).not.toHaveAttribute('aria-controls');
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
      // The trigger's `aria-controls` must RESOLVE here, where the drawer is actually mounted —
      // the header's own suite renders no drawer, so it can only check which side of the open state
      // the attribute sits on. A reference that only ever appears while closed is the defect.
      expect(trigger.getAttribute('aria-controls')).toBe('mobile-layers-panel');

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      // And gone with it: the honest pair while closed is `aria-expanded="false"` and no
      // `aria-controls` at all, not a name with no target.
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).not.toHaveAttribute('aria-controls');
    });

    it('translates the toggle prop into a close, so a backdrop click does not reopen the drawer', async () => {
      const user = userEvent.setup();
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Toggle layers panel' }));
      expect(screen.getByRole('dialog', { name: 'Layers & History Drawer' })).toBeInTheDocument();

      // The backdrop is the dialog's first child.
      act(() => {
        screen
          .getByRole('dialog', { name: 'Layers & History Drawer' })
          .firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

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
