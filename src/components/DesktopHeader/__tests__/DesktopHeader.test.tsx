import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopHeader from '../DesktopHeader.tsx';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext.tsx';
import { createMockLayers } from '../../../__tests__/fixtures/layer.ts';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';
import { DEFAULT_VIEW_STATE } from '../../../contexts/view-state.ts';

const committedLayers = createMockLayers(1);

const storeState = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  // A REF, like `currentArgs`, because `UnsavedChangesProvider` reads
  // `previewLayers.current` for an in-flight tool transaction. Without it the provider
  // throws `Cannot convert undefined or null to object` on `Object.keys`.
  previewLayers: { current: {} as Record<string, unknown> },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw' as ToolName,
  viewState: { panX: 0, panY: 0, zoom: 1, fitScaleCompensation: 1, rotation: 0, fitToScreen: true },
  setViewState: vi.fn(),
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
}));

const invertActiveLayer = vi.hoisted(() => vi.fn(() => Promise.resolve()));

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark', toggleTheme: vi.fn() }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, dispatch] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => app }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => file }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => layers }));
vi.mock('../../../hooks/useInvertLayer.ts', () => ({ useInvertLayer: () => ({ invertActiveLayer }) }));
vi.mock('../../../hooks/useDevicePixelRatio.ts', () => ({ useDevicePixelRatio: () => 2 }));
vi.mock('../../../hooks/useWorkspaceFitScale.ts', () => ({ useWorkspaceFitScale: () => 0.25 }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => themeState,
}));

const NEW_CONFIRM_MESSAGE = 'Discard unsaved changes and start a new image?';
const OPEN_CONFIRM_MESSAGE = 'Discard unsaved changes and open another file?';

const defaultStore = {
  canvasRef: { current: null as HTMLCanvasElement | null },
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  previewLayers: { current: {} as Record<string, unknown> },
  fileName: 'test.png',
  hasUnsavedChanges: false,
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  hasImage: true,
  toolName: 'draw' as ToolName,
  viewState: { panX: 0, panY: 0, zoom: 1, fitScaleCompensation: 1, rotation: 0, fitToScreen: true },
  setViewState: vi.fn(),
};

/**
 * The real `UnsavedChangesProvider`, not a mock of it: the guard under test is the one the
 * provider owns, and it reads the same mocked `useStore` this file already installs.
 */
function renderHeader() {
  return render(
    <UnsavedChangesProvider>
      <DesktopHeader />
    </UnsavedChangesProvider>
  );
}

function openMenu(name: 'File' | 'Tools' | 'Image' | 'Edit' | 'View') {
  fireEvent.click(screen.getByRole('button', { name }));
}

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

/**
 * Click a File menu item and read the prompt the guard raises, if it raises one.
 *
 * The handler is async: `confirmDiscard` resolves straight through when there is nothing to
 * discard, and renders the dialog on a `setState` when there is. `findBy*` rather than
 * `getByTestId` because a prompt on a clean document would not be there yet.
 *
 * The copy is then asserted with `toHaveAccessibleDescription`, not a testid: the prompt
 * `<p>` carries `id="confirm-dialog-message"` and no `data-testid`, and the dialog's
 * `aria-describedby` already points at it. That reads the accessibility wiring as well as
 * the string, and keeps working if the testid is added later.
 */
async function openDiscardPrompt(testId: string) {
  await clickFileMenuItem(testId);
  return screen.findByTestId('confirm-dialog');
}

/** Answer "Discard". The picker that follows is the thing under test, not the dialog. */
async function acceptDiscard() {
  fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));
  await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
}

/**
 * Answer "Cancel", then drain the microtasks the awaiting handler still owes.
 *
 * The second half is the load-bearing one: `answer(false)` resolves the guard's promise on
 * its way out of the click, and the `await` in the handler resumes a microtask later. A
 * test that asserted `expect(openNewImageDialog).not.toHaveBeenCalled()` without it would
 * be asserting before the code under test had finished deciding, and a regression that
 * opened the picker anyway could pass.
 */
async function declineDiscard() {
  fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));
  await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.canvasRef = { current: null };
  storeState.currentArgs = { current: { toolName: 'draw' } as ToolArgs };
  storeState.previewLayers = { current: {} };
  storeState.fileName = 'test.png';
  storeState.hasUnsavedChanges = false;
  storeState.hasImage = true;
  storeState.toolName = 'draw';
  storeState.totalSize = { width: 800, height: 600 };
  storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
  storeState.viewState = { ...DEFAULT_VIEW_STATE };
  history.canUndo.mockReturnValue(false);
  history.canRedo.mockReturnValue(false);
  layers.commitDirtyTool.mockReturnValue(committedLayers);
  themeState.theme = 'light';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(storeState, { ...defaultStore });
  themeState.theme = 'light';
});

describe('DesktopHeader', () => {
  it('renders the File, Image, Edit, View and Window menu buttons', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Window' })).toBeInTheDocument();
  }, 10000);

  it('opens View with Zoom In, Zoom Out, Fit on Screen and 100% commands', () => {
    renderHeader();

    openMenu('View');

    expect(screen.getByTestId('view-menu-zoom-in-button')).toBeInTheDocument();
    expect(screen.getByTestId('view-menu-zoom-out-button')).toBeInTheDocument();
    expect(screen.getByTestId('view-menu-fit-on-screen-button')).toBeInTheDocument();
    expect(screen.getByTestId('view-menu-100-percent-button')).toBeInTheDocument();
  });

  it('applies the existing zoom-step behavior and closes the menu', () => {
    renderHeader();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-zoom-in-button'));
    expect(storeState.setViewState).toHaveBeenLastCalledWith({ zoom: 1.25 });
    expect(screen.queryByTestId('header-view-menu')).toBeNull();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-zoom-out-button'));
    expect(storeState.setViewState).toHaveBeenLastCalledWith({ zoom: 0.8 });
    expect(screen.queryByTestId('header-view-menu')).toBeNull();
  });

  it('resets the view to Fit on Screen and closes the menu', () => {
    renderHeader();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-fit-on-screen-button'));

    expect(storeState.setViewState).toHaveBeenCalledWith(DEFAULT_VIEW_STATE);
    expect(screen.queryByTestId('header-view-menu')).toBeNull();
  });

  it('sets 100% magnification with DPR-aware scale and resets pan and rotation', () => {
    renderHeader();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-100-percent-button'));

    expect(storeState.setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: 2,
      fitScaleCompensation: 1,
      rotation: 0,
      minimumZoomOverride: undefined,
    });
    expect(screen.queryByTestId('header-view-menu')).toBeNull();
  });

  it('removes the Tools item from the horizontal menu', () => {
    renderHeader();

    expect(screen.queryByTestId('header-tools-menu-button')).toBeNull();
  });

  it('toggles the file menu open and closed', () => {
    renderHeader();

    const fileButton = screen.getByRole('button', { name: 'File' });

    fireEvent.click(fileButton);
    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();

    fireEvent.click(fileButton);
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('toggles the edit menu open and closed', () => {
    renderHeader();

    const editButton = screen.getByRole('button', { name: 'Edit' });

    fireEvent.click(editButton);
    expect(screen.getByTestId('edit-menu-free-transform-button')).toBeInTheDocument();

    fireEvent.click(editButton);
    expect(screen.queryByTestId('edit-menu-free-transform-button')).toBeNull();
  });

  it('goes to the correct tool when the Image menu adjustment is clicked', () => {
    renderHeader();

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-desaturate-button'));
    expect(app.goToTool).toHaveBeenCalledWith('color');

    vi.clearAllMocks();

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-brightness-contrast-button'));
    expect(app.goToTool).toHaveBeenCalledWith('levels');
  });

  it('applies Invert on click without selecting a tool, and closes the menu', () => {
    renderHeader();

    openAdjustments();
    fireEvent.click(screen.getByTestId('image-menu-adjustments-invert-button'));

    expect(invertActiveLayer).toHaveBeenCalledTimes(1);
    expect(app.goToTool).not.toHaveBeenCalled();
    expect(screen.queryByTestId('image-menu-adjustments')).toBeNull();
  });

  it('toggles the Adjustments submenu open and closed on its own button', () => {
    renderHeader();

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
  it("carries Adobe's Adjustments list with only the three implemented commands enabled", () => {
    renderHeader();

    openAdjustments();

    const enabled = within(screen.getByTestId('image-menu-adjustments'))
      .getAllByRole('button')
      .filter((button) => !(button as HTMLButtonElement).disabled)
      .map((button) => button.textContent);
    expect(enabled).toEqual(['Brightness/Contrast', 'Desaturate', 'Invert']);

    for (const label of [
      'Levels',
      'Curves',
      'Exposure',
      'Black and White',
      'Hue/Saturation',
      'Photo Filter',
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

  /**
   * `photo-filter` is the second case and it is the load-bearing one. The Colors bar's
   * leading control is what Adobe's `Desaturate` computes; it is not what `Photo Filter`
   * computes, so an enabled `Photo Filter` opened a bar its own label did not describe, and
   * Adobe's real command is unbuilt — which is what a `disabled` item records. Two
   * assertions above are what hold that, and this one only holds that the row does not act:
   * `expect(enabled).toEqual(['Brightness/Contrast', 'Desaturate', 'Invert'])`, which fails if
   * `Photo Filter` is enabled again, and the disabled-label loop, which asserts
   * `Photo Filter` carries `disabled`.
   */
  it.each(['levels', 'photo-filter'])('does not select a tool when the disabled %s adjustment is clicked', (slug) => {
    renderHeader();

    openAdjustments();
    fireEvent.click(screen.getByTestId(`image-menu-adjustments-${slug}-button`));

    expect(app.goToTool).not.toHaveBeenCalled();
  });

  it('renders theme toggle button', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Toggle theme' })).toBeInTheDocument();
  });

  it('calls toggleTheme when the theme toggle button is clicked', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));

    expect(themeState.toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the new file dialog when File > New is clicked', async () => {
    file.openNewImageDialog.mockResolvedValue(undefined);
    renderHeader();

    await clickFileMenuItem('header-file-new-button');

    await waitFor(() => expect(file.openNewImageDialog).toHaveBeenCalledTimes(1));
  });

  it('opens the load file dialog when File > Open is clicked', async () => {
    file.openLoadImageDialog.mockResolvedValue(undefined);
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    await waitFor(() => expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1));
  });

  it('shows Confirm dialog when opening file with unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    file.openLoadImageDialog.mockResolvedValue(undefined);

    renderHeader();

    const dialog = await openDiscardPrompt('header-file-open-button');

    expect(dialog).toHaveAccessibleDescription(OPEN_CONFIRM_MESSAGE);
    await declineDiscard();
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
  });
});

describe('DesktopHeader theme icon', () => {
  it('renders the moon glyph while the light theme is active', () => {
    themeState.theme = 'light';
    renderHeader();

    expect(pathDataOf('Toggle theme')).toBe(
      'M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278'
    );
  });

  it('renders the sun glyph while the dark theme is active', () => {
    themeState.theme = 'dark';
    renderHeader();

    expect(pathDataOf('Toggle theme')).toBe(
      'M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708'
    );
  });
});

describe('DesktopHeader menu lifecycle', () => {
  it('keeps only one menu open at a time', () => {
    renderHeader();

    openMenu('File');
    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();

    openMenu('Image');
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
    expect(screen.getByTestId('image-menu-adjustments-button')).toBeInTheDocument();

    openMenu('Edit');
    expect(screen.queryByTestId('image-menu-adjustments-button')).toBeNull();
    expect(screen.getByTestId('edit-menu-free-transform-button')).toBeInTheDocument();
  });

  it.each([
    ['File', 'header-file-new-button'],
    ['Image', 'image-menu-adjustments-button'],
    ['Edit', 'edit-menu-free-transform-button'],
  ] as const)('closes the open %s menu when a mousedown lands outside of it', (menu, itemTestId) => {
    renderHeader();

    openMenu(menu);
    expect(screen.getByTestId(itemTestId)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId(itemTestId)).toBeNull();
  });

  it('keeps the menu open when a mousedown lands inside it', () => {
    renderHeader();

    openMenu('File');
    fireEvent.mouseDown(screen.getByTestId('header-file-new-button'));

    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();
  });

  it('ignores a mousedown outside while no menu is open', () => {
    renderHeader();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
    expect(screen.queryByTestId('image-menu-adjustments-button')).toBeNull();
    expect(screen.queryByTestId('edit-menu-free-transform-button')).toBeNull();
  });

  it('stops reacting to outside mousedowns after unmount', () => {
    const { unmount } = renderHeader();

    openMenu('File');
    unmount();

    expect(() => fireEvent.mouseDown(document.body)).not.toThrow();
  });
});

describe('DesktopHeader menu commands', () => {
  it.each([['edit-menu-free-transform-button', 'transform']])(
    'routes %s to exactly one goToTool call and closes the menu',
    (testId, toolName) => {
      renderHeader();

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
    renderHeader();

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
   */
  it('holds no tool switches in the Edit menu', () => {
    renderHeader();

    openMenu('Edit');

    expect(
      within(screen.getByTestId('header-edit-menu'))
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(['Free Transform']);
    for (const toolName of ['blur', 'draw', 'text']) {
      expect(screen.queryByTestId(`edit-menu-${toolName}-button`)).toBeNull();
    }
  });
});

describe('DesktopHeader File > New', () => {
  it('creates a blank image without a discard prompt on a pristine document and closes the menu', async () => {
    const params = { color: '#ff0000', opacity: 0.5, size: { width: 640, height: 480 }, isBedrock: true };
    file.openNewImageDialog.mockResolvedValue(params);
    renderHeader();

    await clickFileMenuItem('header-file-new-button');

    // A pristine document has nothing to discard, so it must never be asked about one —
    // and because the guard resolves `true` on its own, that is now the only thing standing
    // between the click and the picker, so the absence of the dialog IS the assertion.
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    await waitFor(() => expect(app.setBlankImage).toHaveBeenCalledExactlyOnceWith(params));
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('skips the new document dialog when the user dismisses the confirmation', async () => {
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    renderHeader();

    const dialog = await openDiscardPrompt('header-file-new-button');

    expect(dialog).toHaveAccessibleDescription(NEW_CONFIRM_MESSAGE);
    await declineDiscard();
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
    // A declined discard leaves the document exactly as it was, and it also leaves no
    // dropdown behind: `setOpenMenu(null)` now runs before the guard, so the early return
    // cannot skip it. The open menu overlapped the top-left of the workspace canvas, so a
    // spec that captured the canvas after a decline used to read a contaminated region.
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('asks before discarding a document that really has unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    renderHeader();

    const dialog = await openDiscardPrompt('header-file-new-button');

    expect(dialog).toHaveAccessibleDescription(NEW_CONFIRM_MESSAGE);
    await declineDiscard();
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
  });

  it('asks before discarding a text draft the document is not yet tracking as an unsaved change', async () => {
    storeState.currentArgs = {
      current: {
        toolName: 'text',
        text: 'draft',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    } as unknown as { current: ToolArgs };
    file.openNewImageDialog.mockResolvedValue(null);
    renderHeader();

    const dialog = await openDiscardPrompt('header-file-new-button');

    expect(dialog).toHaveAccessibleDescription(NEW_CONFIRM_MESSAGE);
    await declineDiscard();
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
  });

  it('leaves the document untouched when the dialog is cancelled and still closes the menu', async () => {
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue(null);
    renderHeader();

    await openDiscardPrompt('header-file-new-button');
    // The discard is accepted and the New Image dialog that follows is cancelled: the
    // document is still untouched, which is the claim this test has always made.
    await acceptDiscard();

    expect(file.openNewImageDialog).toHaveBeenCalledTimes(1);
    expect(app.setBlankImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('logs the Error when the new document dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openNewImageDialog.mockRejectedValue(new Error('dialog exploded'));
    renderHeader();

    await clickFileMenuItem('header-file-new-button');

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Unable to create document', expect.any(Error)));
    expect(app.setBlankImage).not.toHaveBeenCalled();
    // The throw must not strand the dropdown either. It used to skip `setOpenMenu(null)`
    // and leave the menu over the canvas; activating the item dismisses it on every path.
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openNewImageDialog.mockRejectedValue('plain failure');
    renderHeader();

    await clickFileMenuItem('header-file-new-button');

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to create document', 'plain failure')
    );
  });
});

describe('DesktopHeader File > Open', () => {
  it('opens the picked document and closes the menu', async () => {
    const upload = { fileName: 'picked.png', image: {} as HTMLImageElement };
    file.openLoadImageDialog.mockResolvedValue(upload);
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    await waitFor(() => expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(app.setImageFromUpload).toHaveBeenCalledExactlyOnceWith(upload));
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('does not ask for confirmation when neither unsaved changes nor pending text exist', async () => {
    file.openLoadImageDialog.mockResolvedValue(null);
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    // There is no clean-document branch to test at the call site any more: `confirmDiscard`
    // answers `true` itself when nothing can be lost, so the claim becomes "no prompt
    // appeared and the action went through anyway". Both halves are load-bearing — a prompt
    // would be waiting for an answer the test never gives, which is also why the picker
    // being reached at all proves nothing was blocking it.
    await waitFor(() => expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('asks for confirmation when the text tool holds an uncommitted draft', async () => {
    storeState.currentArgs = {
      current: {
        toolName: 'text',
        text: 'draft',
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    } as unknown as { current: ToolArgs };
    file.openLoadImageDialog.mockResolvedValue(null);
    renderHeader();

    const dialog = await openDiscardPrompt('header-file-open-button');

    expect(dialog).toHaveAccessibleDescription(OPEN_CONFIRM_MESSAGE);
    await declineDiscard();
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    // Declining the discard dismisses the menu, same as New: the close is no longer after
    // the branch that returns early.
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('does not ask for confirmation when the text tool holds an empty draft', async () => {
    storeState.currentArgs = {
      current: { toolName: 'text', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
    } as unknown as { current: ToolArgs };
    file.openLoadImageDialog.mockResolvedValue(null);
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    // Same shape as the test above: no prompt, and the action proceeded. A text box the
    // user typed nothing into is not work, so it must not be worth a prompt.
    await waitFor(() => expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('keeps the current document when the file picker is cancelled', async () => {
    storeState.hasUnsavedChanges = true;
    file.openLoadImageDialog.mockResolvedValue(null);
    renderHeader();

    await openDiscardPrompt('header-file-open-button');
    // The discard is accepted and the picker that follows is cancelled, so the document is
    // still the one it was.
    await acceptDiscard();

    await waitFor(() => expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1));
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('logs the Error when loading rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openLoadImageDialog.mockRejectedValue(new Error('read failed'));
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Unable to open document', expect.any(Error)));
    expect(app.setImageFromUpload).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openLoadImageDialog.mockRejectedValue({ code: 42 });
    renderHeader();

    await clickFileMenuItem('header-file-open-button');

    await waitFor(() => expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to open document', { code: 42 }));
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
    renderHeader();

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

  it('never asks for confirmation before saving', async () => {
    storeState.hasUnsavedChanges = true;
    file.openSaveImageDialog.mockResolvedValue(null);
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    // A document with unsaved changes is exactly the case where New and Open do prompt, so
    // the dirtiness here is what makes the absence meaningful: the discard guard is in the
    // provider above this button and Save never consults it. Reaching the save dialog with
    // no `confirm-dialog` in the tree is the whole claim.
    await waitFor(() => expect(file.openSaveImageDialog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('does not save when the save dialog is dismissed', async () => {
    file.openSaveImageDialog.mockResolvedValue(null);
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    expect(app.handleImageSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-save-button')).toBeNull();
  });

  it('does nothing when there is no image', async () => {
    storeState.hasImage = false;
    file.openSaveImageDialog.mockResolvedValue({ fileName: 'test (copy)', format: 'image/png' });
    renderHeader();

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
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    expect(layers.commitDirtyTool).toHaveBeenCalledTimes(1);
    expect(file.openSaveImageDialog).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ fileName: 'test.png', layers: committedLayers })
    );
  });

  it('logs when the save dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openSaveImageDialog.mockRejectedValue(new Error('encoder died'));
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to prepare document export', expect.any(Error));
    expect(app.handleImageSave).not.toHaveBeenCalled();
  });

  it('logs when committing the dirty tool throws before the dialog opens', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    layers.commitDirtyTool.mockImplementation(() => {
      throw new Error('commit failed');
    });
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledWith('Unable to prepare document export', expect.any(Error));
    expect(file.openSaveImageDialog).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    file.openSaveImageDialog.mockRejectedValue('disk offline');
    renderHeader();

    await clickFileMenuItem('header-file-save-button');

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('Unable to prepare document export', 'disk offline');
  });
});

describe('DesktopHeader history controls', () => {
  it('disables both history buttons when nothing can be undone or redone', () => {
    renderHeader();

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables undo and redo independently as history allows', () => {
    history.canUndo.mockReturnValue(true);
    renderHeader();

    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('undoes through the header undo button when the tool is clean', () => {
    history.canUndo.mockReturnValue(true);
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it('redoes through the header redo button when history allows it', () => {
    history.canRedo.mockReturnValue(true);
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));

    expect(history.redo).toHaveBeenCalledTimes(1);
  });
});

describe('DesktopHeader View menu edge cases', () => {
  it('closes the View menu when Escape is pressed', () => {
    renderHeader();

    openMenu('View');
    expect(screen.getByTestId('header-view-menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('header-view-menu')).toBeNull();
  });

  it('disables View menu items when no image is open', () => {
    storeState.hasImage = false;
    renderHeader();

    openMenu('View');

    expect(screen.getByTestId('view-menu-zoom-in-button')).toBeDisabled();
    expect(screen.getByTestId('view-menu-zoom-out-button')).toBeDisabled();
    expect(screen.getByTestId('view-menu-fit-on-screen-button')).toBeDisabled();
    expect(screen.getByTestId('view-menu-100-percent-button')).toBeDisabled();
  });

  it('View menu items are enabled when an image is open', () => {
    storeState.hasImage = true;
    renderHeader();

    openMenu('View');

    expect(screen.getByTestId('view-menu-zoom-in-button')).not.toBeDisabled();
    expect(screen.getByTestId('view-menu-zoom-out-button')).not.toBeDisabled();
    expect(screen.getByTestId('view-menu-fit-on-screen-button')).not.toBeDisabled();
    expect(screen.getByTestId('view-menu-100-percent-button')).not.toBeDisabled();
  });

  it('Fit on Screen respects fitToScreen false state and toggles it to true', () => {
    storeState.viewState = {
      panX: 100,
      panY: 50,
      zoom: 2,
      fitScaleCompensation: 1,
      rotation: 0,
      fitToScreen: false,
    };
    renderHeader();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-fit-on-screen-button'));

    expect(storeState.setViewState).toHaveBeenCalledWith(DEFAULT_VIEW_STATE);
  });

  it('100% command works correctly with non-zero pan and rotation', () => {
    storeState.viewState = {
      panX: 200,
      panY: 150,
      zoom: 3,
      fitScaleCompensation: 1,
      rotation: 45,
      fitToScreen: false,
    };
    renderHeader();

    openMenu('View');
    fireEvent.click(screen.getByTestId('view-menu-100-percent-button'));

    expect(storeState.setViewState).toHaveBeenCalledWith({
      panX: 0,
      panY: 0,
      zoom: 2,
      fitScaleCompensation: 1,
      rotation: 0,
      minimumZoomOverride: undefined,
    });
  });

  it('View menu closes when clicking outside after opening', () => {
    renderHeader();

    openMenu('View');
    expect(screen.getByTestId('header-view-menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId('header-view-menu')).toBeNull();
  });
});
