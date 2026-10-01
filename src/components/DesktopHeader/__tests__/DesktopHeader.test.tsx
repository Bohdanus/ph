import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopHeader, { MENUS_EXCLUDE } from '../DesktopHeader.tsx';
import { availableTools } from '../../../../toolbar-mapping.ts';
import { createMockLayers } from '../../../__tests__/fixtures/layer.ts';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';
import type { TextToolArgs } from '../../../tools/text.ts';

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
}));

const currentTool = vi.hoisted(() => ({
  patchToolArgs: vi.fn(),
}));

const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark', toggleTheme: vi.fn() }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({ useStore: () => [storeState, dispatch] }));
vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => app }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => file }));
vi.mock('../../../contexts/useHistory.ts', () => ({ useHistory: () => history }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => layers }));
vi.mock('../../../contexts/useCurrentTool.tsx', () => ({ useCurrentTool: () => currentTool }));
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => themeState,
}));

const NEW_CONFIRM_MESSAGE = 'Discard unsaved changes and start a new image?';
const OPEN_CONFIRM_MESSAGE = 'Discard unsaved changes and open another file?';

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

function stubConfirm(result: boolean) {
  const confirm = vi.fn(() => result);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

function openMenu(name: 'File' | 'Tools' | 'Edit') {
  fireEvent.click(screen.getByRole('button', { name }));
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
  it('renders File, Tools, and Edit menu buttons', () => {
    render(<DesktopHeader />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows all available tools in the Tools menu', () => {
    render(<DesktopHeader />);

    openMenu('Tools');

    // Derived from the registry rather than written out by hand. This was a literal list of
    // 24 names that never included the Dodge, the Burn, the Smudge, the Sharpen or the eraser
    // family, so it could not have caught a tool missing from `TOOL_MENU_ITEMS` — which is
    // exactly how the Sponge shipped without a menu entry. Every `availableTools` name now has
    // to produce a row, so the next omission fails here instead of in the app.
    const missing = availableTools
      .filter((tool) => !MENUS_EXCLUDE.includes(tool))
      .filter((tool) => screen.queryByTestId(`tools-menu-${tool}-button`) === null);
    expect(missing, `tools absent from the Tools menu: ${missing.join(', ')}`).toEqual([]);
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
    expect(screen.getByTestId('edit-menu-colors-button')).toBeInTheDocument();

    fireEvent.click(editButton);
    expect(screen.queryByTestId('edit-menu-colors-button')).toBeNull();
  });

  it('goes to the correct tool when edit menu items are clicked', () => {
    render(<DesktopHeader />);

    const editButton = screen.getByRole('button', { name: 'Edit' });

    fireEvent.click(editButton);
    fireEvent.click(screen.getByTestId('edit-menu-colors-button'));
    expect(app.goToTool).toHaveBeenCalledWith('color');

    vi.clearAllMocks();

    fireEvent.click(editButton);
    fireEvent.click(screen.getByTestId('edit-menu-blur-button'));
    expect(app.goToTool).toHaveBeenCalledWith('blur');
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
    stubConfirm(true);
    file.openNewImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(file.openNewImageDialog).toHaveBeenCalledTimes(1);
  });

  it('opens the load file dialog when File > Open is clicked', async () => {
    stubConfirm(true);
    file.openLoadImageDialog.mockResolvedValue(undefined);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(file.openLoadImageDialog).toHaveBeenCalledTimes(1);
  });

  it('shows Confirm dialog when opening file with unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    const confirm = stubConfirm(false);
    file.openLoadImageDialog.mockResolvedValue(undefined);

    render(<DesktopHeader />);

    openMenu('File');
    await act(async () => {
      fireEvent.click(screen.getByTestId('header-file-open-button'));
    });

    expect(confirm).toHaveBeenCalledWith(OPEN_CONFIRM_MESSAGE);
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
  it('keeps only one menu open at a time', () => {
    render(<DesktopHeader />);

    openMenu('File');
    expect(screen.getByTestId('header-file-new-button')).toBeInTheDocument();

    openMenu('Tools');
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
    expect(screen.getByTestId('tools-menu-draw-button')).toBeInTheDocument();

    openMenu('Edit');
    expect(screen.queryByTestId('tools-menu-draw-button')).toBeNull();
    expect(screen.getByTestId('edit-menu-colors-button')).toBeInTheDocument();
  });

  it('closes the tools menu on a second click of the Tools button', () => {
    render(<DesktopHeader />);

    openMenu('Tools');
    expect(screen.getByTestId('tools-menu-draw-button')).toBeInTheDocument();

    openMenu('Tools');
    expect(screen.queryByTestId('tools-menu-draw-button')).toBeNull();
  });

  it.each([
    ['File', 'header-file-new-button'],
    ['Tools', 'tools-menu-draw-button'],
    ['Edit', 'edit-menu-colors-button'],
  ] as const)('closes the open %s menu when a mousedown lands outside of it', (menu, itemTestId) => {
    render(<DesktopHeader />);

    openMenu(menu);
    expect(screen.getByTestId(itemTestId)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId(itemTestId)).toBeNull();
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

    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
    expect(screen.queryByTestId('tools-menu-draw-button')).toBeNull();
    expect(screen.queryByTestId('edit-menu-colors-button')).toBeNull();
  });

  it('stops reacting to outside mousedowns after unmount', () => {
    const { unmount } = render(<DesktopHeader />);

    openMenu('File');
    unmount();

    expect(() => fireEvent.mouseDown(document.body)).not.toThrow();
  });
});

describe('DesktopHeader Edit menu actions', () => {
  it.each([
    ['edit-menu-colors-button', 'color'],
    ['edit-menu-blur-button', 'blur'],
    ['edit-menu-levels-button', 'levels'],
    ['edit-menu-transform-button', 'transform'],
    ['edit-menu-draw-button', 'draw'],
    ['edit-menu-text-button', 'text'],
  ] as const)('routes %s to exactly one goToTool call and closes the menu', (testId, toolName) => {
    render(<DesktopHeader />);

    openMenu('Edit');
    fireEvent.click(screen.getByTestId(testId));

    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith(toolName);
    expect(screen.queryByTestId(testId)).toBeNull();
  });

  it('opens one Tools menu entry and closes the menu', () => {
    render(<DesktopHeader />);

    openMenu('Tools');
    fireEvent.click(screen.getByTestId('tools-menu-polygonal-lasso-button'));

    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith('polygonal-lasso');
    expect(screen.queryByTestId('tools-menu-polygonal-lasso-button')).toBeNull();
  });

  it.each([
    ['tools-menu-crop-button', 'crop'],
    ['tools-menu-magic-wand-button', 'magic-wand'],
    ['tools-menu-custom-shape-button', 'custom-shape'],
  ] as const)('selects %s from the Tools menu', (testId, toolName) => {
    render(<DesktopHeader />);

    openMenu('Tools');
    fireEvent.click(screen.getByTestId(testId));

    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith(toolName);
  });
});

describe('DesktopHeader Tools menu figure entries', () => {
  // These five entries are the second selection surface for the figures. The sidebar
  // already reaches them as `goToTool('shape')` plus a `figure` patch; dispatching the
  // registered figure `ToolName`s mounted the Shape panel with e.g. `toolName: 'rectangle'`,
  // where the `args.toolName !== 'shape'` guard at Shape.tsx:32 suppressed the store-colour
  // publish — so Tools > Rectangle Tool + a red colour well committed black.
  //
  // `ellipse` is the trap: the registered `ToolName` is `ellipse`, the stored figure is `oval`.
  it.each([
    ['tools-menu-rectangle-button', 'rectangle'],
    ['tools-menu-ellipse-button', 'oval'],
    ['tools-menu-triangle-button', 'triangle'],
    ['tools-menu-polygon-button', 'polygon'],
    ['tools-menu-line-button', 'line'],
  ] as const)('selects %s as the shape tool with its figure, and closes the menu', (testId, figure) => {
    render(<DesktopHeader />);

    openMenu('Tools');
    fireEvent.click(screen.getByTestId(testId));

    expect(currentTool.patchToolArgs).toHaveBeenCalledExactlyOnceWith('shape', { figure });
    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith('shape');
    expect(screen.queryByTestId(testId)).toBeNull();
  });

  // The order of those two calls is load-bearing, but not for the reason a
  // call-order assertion suggests. `goToTool` runs `commitDirtyTool()` against the
  // OUTGOING tool (`useApp.ts:157`), and `patchToolArgs` writes straight into the live
  // `currentArgsRef` (`useCurrentTool.tsx:61`). Patch first and the text branch at
  // `useLayer.ts:329` reads shape args — no `.text`, no `.rect` — and early-returns, so
  // an unapplied text layer is dropped with no layer and nothing to undo.
  //
  // So this models the real side effects instead of only the call shape:
  // `patchToolArgs` overwrites the live args ref exactly as `_setToolArgs` does, and
  // `goToTool` reads it exactly as `commitDirtyTool` does. The assertion is therefore
  // about what the outgoing commit SEES, not about which mock ran first. Both calls are
  // batched in one click handler, so no stale-figure render can exist between them.
  it('commits the pending text draft before the tool changes', () => {
    const pendingText: TextToolArgs = {
      toolName: 'text',
      text: 'draft',
      rect: { x1: 0, y1: 0, x2: 40, y2: 12 },
      align: 'left',
      bold: false,
      italic: false,
      color: '#000000',
      fontFamily: 'Roboto',
      fontSize: 12,
      lineHeight: 1.2,
    };
    const shapeArgs: ToolArgs = { toolName: 'shape', figure: 'oval' } as ToolArgs;
    storeState.toolName = 'text';
    storeState.currentArgs = { current: pendingText };

    // What `commitDirtyTool` does on the way through `goToTool`.
    const seenByCommit: Array<{ args: ToolArgs; outcome: 'committed' | 'dropped' }> = [];
    currentTool.patchToolArgs.mockImplementationOnce(() => {
      storeState.currentArgs.current = shapeArgs;
    });
    app.goToTool.mockImplementationOnce(() => {
      const args = storeState.currentArgs.current;
      // `useLayer.ts:328-330`: the same cast, then the guard that drops the draft.
      const { text, rect } = args as TextToolArgs;
      seenByCommit.push({ args, outcome: !text || !rect ? 'dropped' : 'committed' });
    });

    render(<DesktopHeader />);

    openMenu('Tools');
    fireEvent.click(screen.getByTestId('tools-menu-ellipse-button'));

    expect(seenByCommit).toHaveLength(1);
    // The commit must read the outgoing tool's args...
    expect(seenByCommit[0].args).toBe(pendingText);
    // ...so it takes the commit branch rather than the drop branch.
    expect(seenByCommit[0].outcome).toBe('committed');
    // And the reorder must not cost the figure the entry exists to select.
    expect(storeState.currentArgs.current).toBe(shapeArgs);
  });

  it('leaves a non-figure tool on its own selection path', () => {
    render(<DesktopHeader />);

    openMenu('Tools');
    fireEvent.click(screen.getByTestId('tools-menu-crop-button'));

    expect(currentTool.patchToolArgs).not.toHaveBeenCalled();
    expect(app.goToTool).toHaveBeenCalledExactlyOnceWith('crop');
  });
});

describe('DesktopHeader File > New', () => {
  it('creates a blank image without a discard prompt on a pristine document and closes the menu', async () => {
    const params = { color: '#ff0000', opacity: 0.5, size: { width: 640, height: 480 }, isBedrock: true };
    const confirm = stubConfirm(false);
    file.openNewImageDialog.mockResolvedValue(params);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    // A pristine document has nothing to discard, so it must never be asked about one.
    expect(confirm).not.toHaveBeenCalled();
    expect(app.setBlankImage).toHaveBeenCalledExactlyOnceWith(params);
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('skips the new document dialog when the user dismisses the confirmation', async () => {
    const confirm = stubConfirm(false);
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(confirm).toHaveBeenCalledExactlyOnceWith(NEW_CONFIRM_MESSAGE);
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
    // A declined discard leaves the document exactly as it was, and it also leaves no
    // dropdown behind: `setOpenMenu(null)` now runs before the guard, so the early return
    // cannot skip it. The open menu overlapped the top-left of the workspace canvas, so a
    // spec that captured the canvas after a decline used to read a contaminated region.
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('asks before discarding a document that really has unsaved changes', async () => {
    const confirm = stubConfirm(false);
    storeState.hasUnsavedChanges = true;
    file.openNewImageDialog.mockResolvedValue({
      color: '#ffffff',
      opacity: 1,
      size: { width: 8, height: 8 },
      isBedrock: true,
    });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(confirm).toHaveBeenCalledExactlyOnceWith(NEW_CONFIRM_MESSAGE);
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
    expect(app.setBlankImage).not.toHaveBeenCalled();
  });

  it('asks before discarding a text draft the document is not yet tracking as an unsaved change', async () => {
    const confirm = stubConfirm(false);
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

    expect(confirm).toHaveBeenCalledExactlyOnceWith(NEW_CONFIRM_MESSAGE);
    expect(file.openNewImageDialog).not.toHaveBeenCalled();
  });

  it('leaves the document untouched when the dialog is cancelled and still closes the menu', async () => {
    stubConfirm(true);
    file.openNewImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-new-button');

    expect(app.setBlankImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('header-file-new-button')).toBeNull();
  });

  it('logs the Error when the new document dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubConfirm(true);
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
    stubConfirm(true);
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

  it('does not ask for confirmation when neither unsaved changes nor pending text exist', async () => {
    const confirm = stubConfirm(false);
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks for confirmation when the text tool holds an uncommitted draft', async () => {
    const confirm = stubConfirm(false);
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

    expect(confirm).toHaveBeenCalledExactlyOnceWith(OPEN_CONFIRM_MESSAGE);
    expect(file.openLoadImageDialog).not.toHaveBeenCalled();
    // Declining the discard dismisses the menu, same as New: the close is no longer after
    // the branch that returns early.
    expect(screen.queryByTestId('header-file-open-button')).toBeNull();
  });

  it('does not ask for confirmation when the text tool holds an empty draft', async () => {
    const confirm = stubConfirm(false);
    storeState.currentArgs = {
      current: { toolName: 'text', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } },
    } as unknown as { current: ToolArgs };
    file.openLoadImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-open-button');

    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the current document when the file picker is cancelled', async () => {
    stubConfirm(true);
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
      canvas: storeState.canvasRef.current,
      fileName: 'test.png',
      layers: committedLayers,
      size: { width: 800, height: 600 },
      documentFrame: { x: 5, y: 6, width: 800, height: 600 },
    });
    expect(app.handleImageSave).toHaveBeenCalledExactlyOnceWith(response);
    expect(screen.queryByTestId('header-file-save-button')).toBeNull();
  });

  it('never asks for confirmation before saving', async () => {
    const confirm = stubConfirm(false);
    storeState.hasUnsavedChanges = true;
    file.openSaveImageDialog.mockResolvedValue(null);
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(confirm).not.toHaveBeenCalled();
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

  it('does nothing when the canvas ref has not been attached yet', async () => {
    storeState.canvasRef = { current: null };
    file.openSaveImageDialog.mockResolvedValue({ fileName: 'test (copy)', format: 'image/png' });
    render(<DesktopHeader />);

    await clickFileMenuItem('header-file-save-button');

    expect(layers.commitDirtyTool).not.toHaveBeenCalled();
    expect(file.openSaveImageDialog).not.toHaveBeenCalled();
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
