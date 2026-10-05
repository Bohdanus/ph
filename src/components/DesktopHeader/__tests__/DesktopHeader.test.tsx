/**
 * The figure routing this file used to cover is gone with the `Tools` menu, and it is
 * worth saying where it went rather than leaving a hole.
 *
 * The five figure rows were a SECOND selection surface over the rail, and they had a trap in
 * them: `tools-menu-ellipse-button` had to dispatch `goToTool('shape')` plus a
 * `patchToolArgs('shape', { figure: 'oval' })`, because dispatching the registered
 * `ToolName` `ellipse` mounted the Shape panel with `toolName: 'ellipse'`, where a bare
 * `args.toolName !== 'shape'` guard returned early and suppressed the store-colour publish —
 * a red colour well committing black.
 *
 * **That trap is closed, and it was the colour publish that closed it.** The guard is now
 * `isShapeFamilyToolName()` in `src/components/ToolbarsRight/Figures/Shape.tsx`, and
 * `SHAPE_FAMILY_TOOL_NAMES` admits all six names including `ellipse`, so the early return no
 * longer fires for a figure and the publish proceeds. `Main.tsx`'s interaction-mode arm lists the
 * same six, so all of them mount `ShapeToolArea`. So the colour argument above no longer forces
 * the routing and must not be repeated as the reason for it.
 *
 * What still forces it is one literal, and it is not in the guard:
 * `ShapeToolArea`'s `editsActiveLayer` tests `args.toolName === 'shape'` to decide whether a
 * commit REPLACES the active layer's source rather than creating a new one. A figure that arrived
 * as `toolName: 'ellipse'` would mount the same panel and still refuse to be dragged or resized
 * in place. The routing therefore stands, on that reason alone, and
 * `toolbar-mapping.test.ts` pins `toolbarMap`'s order and members directly.
 *
 * The other thing this file proved was that the header's tool rows committed a pending
 * text draft before switching, because `goToTool` runs `commitDirtyTool()` against the
 * OUTGOING tool and patching first would leave that commit reading shape args. With no
 * figure rows left that leaves exactly three tool-selecting commands, all a plain `goToTool`
 * with nothing patched — `Edit ▸ Free Transform`, and the two `Image ▸ Adjustments` rows that
 * carry a `toolName` at all, `Brightness/Contrast` and `Desaturate`. The other twenty rows of
 * `ADJUSTMENTS_ITEMS` are `unbuilt` and select nothing. So there is no ordering left to get
 * wrong here, and nothing left to assert about it.
 *
 * WHERE THE ORDER STILL MATTERS, so this is not read as "the rule moved to the rail":
 * `mobile-tools.ts`'s `makeSelectTool` selects first and patches second, which is the safe
 * order. Three call sites patch FIRST and then select, and all three carry the same hazard
 * `HANDOFF.md` §237 describes — the outgoing tool commits against already-replaced args:
 * `SidebarLeft`'s own `selectTool`, and `AppKeyboardShortcuts`'s `selectShapeTool` at both of
 * its patch sites, reachable from plain `U` and from `Shift+U`. Nothing here pins any of them,
 * and this file cannot: it no longer has a surface that patches. §237 names only
 * `SidebarLeft.tsx`, so its claim that reordering there removes the last place the surfaces can
 * disagree does not hold either. The defect is recorded in `HANDOFF.md`, not enshrined by a test
 * written to match the code.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopHeader from '../DesktopHeader.tsx';
import { createMockLayers } from '../../../__tests__/fixtures/layer.ts';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

const committedLayers = createMockLayers(1);

const storeState = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw' as ToolName,
}));

const dispatch = vi.hoisted(() => vi.fn());

const history = vi.hoisted(() => ({
  canUndo: vi.fn(() => false),
  undo: vi.fn(),
  canRedo: vi.fn(() => false),
  redo: vi.fn(),
}));

const app = vi.hoisted(() => ({
  goToTool: vi.fn(),
  setBlankImage: vi.fn(),
  setImageFromUpload: vi.fn(),
  handleImageSave: vi.fn(),
}));

const file = vi.hoisted(() => ({
  openNewImageDialog: vi.fn(),
  openLoadImageDialog: vi.fn(),
  openSaveImageDialog: vi.fn(),
}));

const layers = vi.hoisted(() => ({
  commitDirtyTool: vi.fn(),
  mergeAllLayers: vi.fn(),
}));

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark', toggleTheme: vi.fn() }));

/**
 * The discard question belongs to `UnsavedChangesContext`, which owns the copy and decides
 * what counts as discardable work. These tests drive `confirmDiscard` and assert the REASON
 * it was asked for; whether an empty draft or a pristine document counts is
 * `hasDiscardableWork`'s claim, asserted where it is implemented.
 */
const unsaved = vi.hoisted(() => ({ confirmDiscard: vi.fn<(reason: string) => Promise<boolean>>() }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, dispatch] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => app }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => file }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => layers }));
vi.mock('../../../contexts/UnsavedChangesContext.tsx', () => ({ useUnsavedChanges: () => unsaved }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => themeState,
}));

const defaultStore = {
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw' as ToolName,
};

function openMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * Adobe's ten, in Adobe's order. This is the whole point of the menu bar, so it is written
 * out once here and asserted against rather than imported from the component: a constant the
 * test and the component share proves only that they agree, and agreeing is not the claim.
 */
const ADOBE_MENUS = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window', 'Help'] as const;

/**
 * `Image ▸ Adjustments` is a two-level menu, so reaching an item needs the host opened and
 * then the submenu parent clicked. There is no hover affordance on purpose — a hover-only
 * submenu is unreachable by keyboard — so a spec that skips the second click is asserting
 * against a menu that does not exist.
 */
function openAdjustments() {
  openMenu('Image');
  fireEvent.click(screen.getByTestId('image-menu-adjustments-button'));
}

function pathDataOf(accessibleName: string) {
  const button = screen.getByRole('button', { name: accessibleName });
  return button.querySelector('path')?.getAttribute('d');
}

async function clickFileMenuItem(testId: string) {
  openMenu('File');
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.canvasRef = { current: null };
  storeState.currentArgs = { current: { toolName: 'draw' } as ToolArgs };
  storeState.fileName = 'test.png';
  storeState.hasUnsavedChanges = false;
  storeState.hasImage = true;
  storeState.toolName = 'draw';
  storeState.totalSize = { width: 800, height: 600 };
  storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
  history.canUndo.mockReturnValue(false);
  history.canRedo.mockReturnValue(false);
  layers.commitDirtyTool.mockReturnValue(committedLayers);
  themeState.theme = 'light';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.assign(storeState, { ...defaultStore });
  themeState.theme = 'light';
});

describe('DesktopHeader', () => {
  /**
   * The one assertion the menu bar exists to satisfy: Adobe's list, left to right.
   *
   * This replaces two weaker pins. One asked whether five named buttons existed, which a menu
   * bar can do while being in the wrong order and carrying two menus Photoshop does not have.
   * The other derived the `Tools` menu's rows from the tool registry — real coverage of a real
   * defect, and it is not deleted so much as relocated: `Tools` is not a Photoshop menu, so
   * there is nothing there to be complete about, and the guarantee it carried ("no registered
   * tool is unreachable") now lives where the tools are, in
   * `SidebarLeft/__tests__/toolbar-mapping.test.ts`, which walks the same registry against the
   * rail and cannot be satisfied by a hand-written list of menu rows.
   *
   * ORDER is asserted, not membership: `ADOBE_MENUS` is compared to the rendered sequence, so
   * a menu moved back next to `File` fails here.
   */
  it("renders Adobe's ten menus, in Adobe's order", () => {
    render(<DesktopHeader />);

    const bar = screen.getByRole('heading', { level: 1 }).parentElement!.querySelector('ul')!;
    const labels = [...bar.children].map((item) => item.querySelector('button')?.textContent);
    expect(labels).toEqual(ADOBE_MENUS);
  });

  /**
   * The two menus that were in this bar and are not in Adobe's. `Tools` is the load-bearing
   * one — Photoshop reaches the tool set through the Tools panel and the single-key tool
   * bindings, never a menu — and `3D` is the one this repository believed in until the menu
   * bar was checked against Adobe, which removed the 3D features outright in 2020.
   */
  it('carries no menu Photoshop does not have', () => {
    render(<DesktopHeader />);

    expect(screen.queryByRole('button', { name: 'Tools' })).toBeNull();
    expect(screen.queryByRole('button', { name: '3D' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Analysis' })).toBeNull();
  });

  /**
   * Adobe nests the workspace reset one level down, so this follows it there rather than
   * asserting the old flat shape. `DesktopHeader.window-menu.test.tsx` covers the command
   * itself; what is pinned here is that `Window` has a `Workspace` parent to hang it from.
   */
  it('nests the workspace reset under Window > Workspace, as Adobe does', () => {
    render(<DesktopHeader />);

    openMenu('Window');
    expect(screen.queryByTestId('window-menu-workspace-reset-essentials-button')).toBeNull();

    fireEvent.click(screen.getByTestId('window-menu-workspace-button'));
    expect(screen.getByTestId('window-menu-workspace-reset-essentials-button')).toBeInTheDocument();
  });

  it('toggles the file menu open and closed', () => {
    render(<DesktopHeader />);

    const fileButton = screen.getByRole('button', { name: 'File' });

    fireEvent.click(fileButton);
    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();

    fireEvent.click(fileButton);
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('toggles the edit menu open and closed', () => {
    render(<DesktopHeader />);

    const editButton = screen.getByRole('button', { name: 'Edit' });

    fireEvent.click(editButton);
    expect(screen.getByTestId('edit-menu-free-transform-button')).toBeInTheDocument();

    fireEvent.click(editButton);
    expect(screen.queryByTestId('edit-menu-free-transform-button')).toBeNull();
  });

  it('goes to the correct tool when the Image menu adjustment is clicked', () => {
    render(<DesktopHeader />);

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-desaturate-button'));
    expect(app.goToTool).toHaveBeenCalledWith('color');

    vi.clearAllMocks();

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-brightness-contrast-button'));
    expect(app.goToTool).toHaveBeenCalledWith('levels');
  });

  it('toggles the Adjustments submenu open and closed on its own button', () => {
    render(<DesktopHeader />);

    openMenu('Image');
    expect(screen.queryByTestId('image-menu-adjustments')).toBeNull();

    const submenuButton = screen.getByTestId('image-menu-adjustments-button');
    expect(submenuButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(submenuButton);
    expect(screen.getByTestId('image-menu-adjustments')).toBeInTheDocument();
    expect(submenuButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(submenuButton);
    expect(screen.queryByTestId('image-menu-adjustments')).toBeNull();
  });

  /**
   * A disabled item is the recorded shape of a capability this app does not have, so the
   * whole Adobe list has to be present with the unbuilt ones inert. If a label is dropped
   * the gap stops being visible; if one is wrongly enabled the app does something it
   * cannot do.
   */
  it("carries Adobe's Adjustments list with only the two implemented commands enabled", () => {
    render(<DesktopHeader />);

    openAdjustments();

    const enabled = within(screen.getByTestId('image-menu-adjustments'))
      .getAllByRole('button')
      .filter((button) => !(button as HTMLButtonElement).disabled)
      .map((button) => button.textContent);
    expect(enabled).toEqual(['Brightness/Contrast', 'Desaturate']);

    for (const label of [
      'Levels',
      'Curves',
      'Exposure',
      'Black and White',
      'Hue/Saturation',
      'Photo Filter',
      'Invert',
      'Color Balance',
      'Channel Mixer',
      'Selective Color',
      'Shadows/Highlights',
      'Gradient Map',
      'Posterize',
      'Threshold',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('does not select a tool when a disabled adjustment is clicked', () => {
    render(<DesktopHeader />);

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-levels-button'));

    expect(app.goToTool).not.toHaveBeenCalled();
  });

  it('renders theme toggle button', () => {
    render(<DesktopHeader />);

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('calls toggleTheme when the theme toggle button is clicked', () => {
    render(<DesktopHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));

    expect(themeState.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the new file dialog when File > New is clicked', async () => {
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openNewImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(file.openNewImageDialog).toHaveBeenCalledTimes(1);
  });

  it('opens the load file dialog when File > Open is clicked', async () => {
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openLoadImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1);
  });

  it('shows Confirm dialog when opening file with unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    unsaved.confirmDiscard.mockResolvedValue(false);
    file.openLoadImageDialog.mockResolvedValue(undefined);

    render(<DesktopHeader />);

    openMenu('File');
    await act(async () => {
      fireEvent.click(screen.getByTestId('header-file-open-button'));
    });

    expect(unsaved.confirmDiscard).toHaveBeenCalledWith('open-document');
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
  });
});

describe('DesktopHeader theme icon', () => {
  it('renders the moon glyph while the light theme is active', () => {
    themeState.theme = 'light';
    render(<DesktopHeader />);

    expect(pathDataOf('Toggle theme')).toBe(
      'M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278'
    );
  });

  it('renders the sun glyph while the dark theme is active', () => {
    themeState.theme = 'dark';
    render(<DesktopHeader />);

    expect(pathDataOf('Toggle theme')).toBe(
      'M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708'
    );
  });
});

describe('DesktopHeader menu lifecycle', () => {
  /**
   * Walks the whole bar rather than four of its ten, and asserts the list rather than the
   * absence of one row. The old version named which menu replaced which, which is a shape that
   * stays true as the bar grows — a second dropdown left hanging over the canvas is exactly
   * the defect, and it does not care which two hosts cause it.
   */
  it('keeps only one menu open at a time', () => {
    const { container } = render(<DesktopHeader />);
    const openHostLists = () => container.querySelectorAll('[data-testid^="header-"][data-testid$="-menu"]');

    for (const menu of ADOBE_MENUS) {
      openMenu(menu);
      expect(openHostLists()).toHaveLength(1);
      expect(screen.getByTestId(`header-${menu.toLowerCase()}-menu`)).toBeInTheDocument();
    }
  });

  it('closes a menu on a second click of its own button', () => {
    render(<DesktopHeader />);

    openMenu('Layer');
    expect(screen.getByTestId('layer-menu-flatten-image-button')).toBeInTheDocument();

    openMenu('Layer');
    expect(screen.queryByTestId('layer-menu-flatten-image-button')).toBeNull();
  });

  /**
   * Every host, not the four this file happened to cover. The outside-click handler used to
   * be five hand-written branches over five named refs, so a sixth host was one forgotten
   * branch away from a menu that never closed — a defect with no other symptom. The `Map` it
   * runs on and this `it.each` both exist because of that, and the second assertion is the
   * load-bearing one: it proves the host's own `<li>` registered, which is the half a
   * hard-coded branch list got right for the five that existed and would have silently missed
   * for the next one.
   */
  it.each(ADOBE_MENUS)('closes the open %s menu when a mousedown lands outside of it', (menu) => {
    render(<DesktopHeader />);

    openMenu(menu);
    expect(screen.getByTestId(`header-${menu.toLowerCase()}-menu`)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId(`header-${menu.toLowerCase()}-menu`)).toBeNull();
  });

  it('keeps the menu open when a mousedown lands inside it', () => {
    render(<DesktopHeader />);

    openMenu('File');
    fireEvent.mouseDown(screen.getByTestId('header-file-new-button'));

    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();
  });

  it('ignores a mousedown outside while no menu is open', () => {
    render(<DesktopHeader />);

    fireEvent.mouseDown(document.body);

    for (const id of ADOBE_MENUS.map((menu) => `header-${menu.toLowerCase()}-menu`)) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('stops reacting to outside mousedowns after unmount', () => {
    const { unmount } = render(<DesktopHeader />);

    openMenu('File');
    unmount();

    expect(() => fireEvent.mouseDown(document.body)).not.toThrow();
  });
});

describe('DesktopHeader menu commands', () => {
  it.each([['edit-menu-free-transform-button', 'transform']])(
    'routes %s to exactly one goToTool call and closes the menu',
    (testId, toolName) => {
      render(<DesktopHeader />);

      openMenu('Edit');
      fireEvent.click(screen.getByTestId(testId));

      expect(app.goToTool).toHaveBeenCalledExactlyOnceWith(toolName);
      expect(screen.queryByTestId(testId)).toBeNull();
    }
  );

  it.each([
    ['image-menu-adjustments-brightness-contrast-button', 'levels'],
    ['image-menu-adjustments-desaturate-button', 'color'],
  ] as const)('routes %s to exactly one goToTool call and closes the whole menu', (testId, toolName) => {
    render(<DesktopHeader />);

    openAdjustments();
    fireEvent.click(screen.getByTestId(testId));

    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith(toolName);
    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.queryByTestId('header-image-menu')).toBeNull();
  });

  /**
   * Adobe's `Edit` menu holds `Free Transform` at the top level, not inside a `Transform`
   * submenu, and a menu whose items are all tool switches is not Adobe's `Edit` at all.
   * `blur`, `draw` and `text` are all Tools-panel tools, so none of them may appear here.
   *
   * Asserted as "no tool switch is present" rather than as an exact list, because the menu is
   * meant to grow: `Undo` and `Step Forward` were added in the same change that made this
   * menu Adobe-ordered, and pinning the whole list would turn the next Adobe command into a
   * test edit instead of a decision. The list that must not grow is the tool switches.
   */
  it('holds no tool switches in the Edit menu', () => {
    render(<DesktopHeader />);

    openMenu('Edit');

    for (const toolName of ['blur', 'draw', 'text', 'crop', 'brush', 'eyedropper']) {
      expect(screen.queryByTestId(`edit-menu-${toolName}-button`)).toBeNull();
    }
    const rows = within(screen.getByTestId('header-edit-menu'))
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(rows).toContain('Free Transform');
    expect(rows.filter((row) => /Tool$/.test(row ?? ''))).toEqual([]);
  });

  it('offers the two history commands Adobe puts at the top of Edit', () => {
    history.canUndo.mockReturnValue(true);
    history.canRedo.mockReturnValue(true);
    render(<DesktopHeader />);

    openMenu('Edit');

    const undo = screen.getByTestId('edit-menu-undo-button');
    const stepForward = screen.getByTestId('edit-menu-step-forward-button');
    expect(undo).toBeEnabled();
    expect(stepForward).toBeEnabled();

    fireEvent.click(undo);
    expect(history.undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('header-edit-menu')).toBeNull();

    openMenu('Edit');
    fireEvent.click(screen.getByTestId('edit-menu-step-forward-button'));
    expect(history.redo).toHaveBeenCalledTimes(1);
  });

  it('greys the two history commands out when history cannot move, as Adobe does', () => {
    render(<DesktopHeader />);

    openMenu('Edit');

    expect(screen.getByTestId('edit-menu-undo-button')).toBeDisabled();
    expect(screen.getByTestId('edit-menu-step-forward-button')).toBeDisabled();
    // Step Backward is a different kind of unavailable: the command does not exist at all, so
    // it is inert whatever the history says. It is the row beside the two that work, and it is
    // what makes the pair legible as "the history group".
    expect(screen.getByRole('button', { name: 'Step Backward' })).toBeDisabled();
  });

  it("nests Adobe's six single modes under Edit > Transform", () => {
    render(<DesktopHeader />);

    openMenu('Edit');
    expect(screen.queryByTestId('edit-menu-transform-button')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('edit-menu-transform-button'));
    const submenu = screen.getByTestId('edit-menu-transform-button').nextElementSibling as HTMLElement;
    const leaves = within(submenu)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(leaves).toEqual(['Scale', 'Rotate', 'Skew', 'Distort', 'Perspective', 'Warp']);
    for (const leaf of leaves) expect(screen.getByRole('button', { name: leaf })).toBeDisabled();
  });

  it('flattens the document through Layer > Flatten Image', () => {
    render(<DesktopHeader />);

    openMenu('Layer');
    fireEvent.click(screen.getByTestId('layer-menu-flatten-image-button'));

    expect(layers.mergeAllLayers).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('header-layer-menu')).toBeNull();
  });
});

describe('DesktopHeader File > New', () => {
  it('creates a blank image once the discard question is answered yes, and closes the menu', async () => {
    const params = { color: '#ff0000', opacity: 0.5, size: { width: 640, height: 480 }, isBedrock: true };
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openNewImageDialog.mockResolvedValue(params);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    // Whether a pristine document is worth asking about is `hasDiscardableWork`'s call, so
    // what is asserted here is that an accepted answer opens the dialog.
    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('new-document');
    expect(file.openNewImageDialog).toHaveBeenCalledTimes(1);
    expect(app.setBlankImage).toHaveBeenCalledExactlyOnceWith(params);
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('skips the new document dialog when the user dismisses the confirmation', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('new-document');
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
    // A declined discard leaves the document exactly as it was, and it also leaves no
    // dropdown behind: `setOpenMenu(null)` now runs before the guard, so the early return
    // cannot skip it. The open menu overlapped the top-left of the workspace canvas, so a
    // spec that captured the canvas after a decline used to read a contaminated region.
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('asks before discarding a document that really has unsaved changes', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('new-document');
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
  });

  it('asks before discarding a text draft the document is not yet tracking as an unsaved change', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.currentArgs = {
      current: {
        toolName: 'text',
        text: 'draft',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    } as unknown as { current: ToolArgs };
    file.openNewImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('new-document');
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
  });

  it('leaves the document untouched when the dialog is cancelled and still closes the menu', async () => {
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openNewImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(app.setBlankImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('logs the Error when the new document dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openNewImageDialog.mockRejectedValue(new Error('dialog exploded'));
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to create document', expect.any(Error));
    expect(app.setBlankImage).not.toHaveBeenCalled();
    // The throw must not strand the dropdown either. It used to skip `setOpenMenu(null)`
    // and leave the menu over the canvas; activating the item dismisses it on every path.
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openNewImageDialog.mockRejectedValue('plain failure');
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to create document', 'plain failure');
  });
});

describe('DesktopHeader File > Open', () => {
  it('opens the picked document and closes the menu', async () => {
    const upload = { fileName: 'picked.png', image: {} as HTMLImageElement };
    file.openLoadImageDialog.mockResolvedValue(upload);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1);
    expect(app.setImageFromUpload).toHaveBeenCalledExactlyOnceWith(upload);
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('opens the picker once the discard question is answered yes', async () => {
    unsaved.confirmDiscard.mockResolvedValue(true);
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('open-document');
    expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation when the text tool holds an uncommitted draft', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.currentArgs = {
      current: {
        toolName: 'text',
        text: 'draft',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    } as unknown as { current: ToolArgs };
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('open-document');
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    // Declining the discard dismisses the menu, same as New: the close is no longer after
    // the branch that returns early.
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('keeps the document when an empty draft is on the tool and the answer is no', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.currentArgs = {
      current: { toolName: 'text', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
    } as unknown as { current: ToolArgs };
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    // Whether an empty draft counts as discardable is `hasDiscardableWork`'s claim, asserted
    // where it is implemented. What this file owes is that a declined answer keeps the
    // document whatever the tool is holding.
    expect(unsaved.confirmDiscard).toHaveBeenCalledExactlyOnceWith('open-document');
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
  });

  it('keeps the current document when the file picker is cancelled', async () => {
    unsaved.confirmDiscard.mockResolvedValue(true);
    storeState.hasUnsavedChanges = true;
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(app.setImageFromUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('logs the Error when loading rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openLoadImageDialog.mockRejectedValue(new Error('read failed'));
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to open document', expect.any(Error));
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openLoadImageDialog.mockRejectedValue({ code: 42 });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to open document', { code: 42 });
  });
});

describe('DesktopHeader File > Save', () => {
  beforeEach(() => {
    storeState.canvasRef = { current: document.createElement('canvas') };
    storeState.documentFrame = { x: 5, y: 6, width: 800, height: 600 };
  });

  it('commits the dirty tool and forwards the full export payload to the save dialog', async () => {
    const response = { fileName: 'test (copy)', format: 'image/png' };
    file.openSaveImageDialog.mockResolvedValue(response);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(layers.commitDirtyTool).toHaveBeenCalledTimes(1);
    expect(file.openSaveImageDialog).toHaveBeenCalledExactlyOnceWith({
      fileName: 'test.png',
      layers: committedLayers,
      size: { width: 800, height: 600 },
      documentFrame: { x: 5, y: 6, width: 800, height: 600 },
    });
    // The payload deliberately carries NO canvas. Export renders its own document-
    // resolution surface from `layers` + `documentFrame`, so handing it the display
    // canvas would be the coupling `src/contexts/export-canvas.ts` exists to remove.
    expect(file.openSaveImageDialog.mock.calls[0][0]).not.toHaveProperty('canvas');
    expect(app.handleImageSave).toHaveBeenCalledExactlyOnceWith(response);
    expect(screen.queryByTestId('header-file-save-button')).toBeNull();
  });

  it('never asks the context to confirm before saving', async () => {
    unsaved.confirmDiscard.mockResolvedValue(false);
    storeState.hasUnsavedChanges = true;
    file.openSaveImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    // Saving is not a replacement, so it must not put the discard question to anyone.
    expect(unsaved.confirmDiscard).not.toHaveBeenCalled();
    expect(file.openSaveImageDialog).toHaveBeenCalledTimes(1);
  });

  it('does not save when the save dialog is dismissed', async () => {
    file.openSaveImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(app.handleImageSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-save-button')).toBeNull();
  });

  it('does nothing when there is no image', async () => {
    storeState.hasImage = false;
    file.openSaveImageDialog.mockResolvedValue({ fileName: 'test (copy)', format: 'image/png' });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(layers.commitDirtyTool).not.toHaveBeenCalled();
    expect(file.openSaveImageDialog).not.toHaveBeenCalled();
    expect(app.handleImageSave).not.toHaveBeenCalled();
  });

  it('exports with no canvas ref attached, because the export surface is rendered independently', async () => {
    // This test USED TO read "does nothing when the canvas ref has not been attached yet",
    // pinning the opposite: that a null `canvasRef.current` suppressed the export
    // entirely. That was the coupling — export encoded whatever the visible canvas held —
    // and it is what `src/contexts/export-canvas.ts` removes. `hasImage` remains the guard
    // for "there is no document to export" and is pinned by the test above.
    storeState.canvasRef = { current: null };
    file.openSaveImageDialog.mockResolvedValue({ fileName: 'test (copy)', format: 'image/png' });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(layers.commitDirtyTool).toHaveBeenCalledTimes(1);
    expect(file.openSaveImageDialog).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fileName: 'test.png', layers: committedLayers })
    );
  });

  it('logs when the save dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openSaveImageDialog.mockRejectedValue(new Error('encoder died'));
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to prepare document export', expect.any(Error));
    expect(app.handleImageSave).not.toHaveBeenCalled();
  });

  it('logs when committing the dirty tool throws before the dialog opens', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    layers.commitDirtyTool.mockImplementation(() => {
      throw new Error('commit failed');
    });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to prepare document export', expect.any(Error));
    expect(file.openSaveImageDialog).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openSaveImageDialog.mockRejectedValue('disk offline');
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to prepare document export', 'disk offline');
  });
});

describe('DesktopHeader history controls', () => {
  it('disables both history buttons when nothing can be undone or redone', () => {
    render(<DesktopHeader />);

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables undo and redo independently as history allows', () => {
    history.canUndo.mockReturnValue(true);
    render(<DesktopHeader />);

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('undoes through the header undo button when the tool is clean', () => {
    history.canUndo.mockReturnValue(true);
    render(<DesktopHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it('redoes through the header redo button when history allows it', () => {
    history.canRedo.mockReturnValue(true);
    render(<DesktopHeader />);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(history.redo).toHaveBeenCalledTimes(1);
  });
});
