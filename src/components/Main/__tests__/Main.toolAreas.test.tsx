import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Main from '../Main.tsx';
import { DummyToolArea } from '../DummyToolArea.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';

/**
 * Tool-area routing and drop handling. DummyToolArea is the real component so
 * the "no tool" branch is observable, every other tool area is replaced by a
 * marker component.
 */

const setBlankImage = vi.hoisted(() => vi.fn());
const setImageFromUpload = vi.hoisted(() => vi.fn());
const openLoadImageDialog = vi.hoisted(() => vi.fn());
const openNewImageDialog = vi.hoisted(() => vi.fn());
const drawAllLayers = vi.hoisted(() => vi.fn());
const loadDocumentFile = vi.hoisted(() => vi.fn());
const themeState = vi.hoisted(() => ({ theme: 'light' as 'light' | 'dark' }));

const storeState = vi.hoisted(
  () =>
    ({
      canvasRef: { current: null },
      containerRef: { current: null },
      toolOverlayRef: { current: null },
      rectOverlayRef: { current: null },
      hasImage: true,
      hasUnsavedChanges: false,
      currentArgs: { current: { toolName: 'brush' } as ToolArgs },
      layers: {},
      selections: [],
      toolName: 'reposition' as ToolName,
      totalSize: { width: 640, height: 480 },
      documentFrame: { x: 0, y: 0, width: 640, height: 480 },
    }) as Record<string, unknown>
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../hooks/useApp.ts', () => ({ useApp: () => ({ setBlankImage, setImageFromUpload }) }));
vi.mock('../../../contexts/useFile.tsx', () => ({ useFile: () => ({ openLoadImageDialog, openNewImageDialog }) }));
vi.mock('../../../contexts/useLayer.ts', () => ({ useLayers: () => ({ drawAllLayers }) }));
const marker = vi.hoisted(() => {
  return (name: string) => {
    const Component = () => createElement('div', { 'data-testid': `tool-area-${name}` });
    Component.displayName = name;
    return Component;
  };
});

vi.mock('../../../contexts/ThemeContext.tsx', () => ({ useTheme: () => themeState }));
vi.mock('../../../contexts/image-load-save-utils.ts', () => ({ loadDocumentFile }));

vi.mock('../MoveToolArea.tsx', () => ({ MoveToolArea: marker('move') }));
vi.mock('../CropToolArea.tsx', () => ({ CropToolArea: marker('crop') }));
vi.mock('../DrawToolArea.tsx', () => ({ DrawToolArea: marker('draw') }));
vi.mock('../ShapeToolArea.tsx', () => ({ ShapeToolArea: marker('shape') }));
vi.mock('../TextToolArea.tsx', () => ({ TextToolArea: marker('text') }));
vi.mock('../PolygonClickToolArea.tsx', () => ({ PolygonClickToolArea: marker('lasso') }));
vi.mock('../FeatherMagneticLassoToolArea.tsx', () => ({
  FeatherMagneticLassoToolArea: marker('feather-magnetic-lasso'),
}));
vi.mock('../MagicWandToolArea.tsx', () => ({ MagicWandToolArea: marker('magic-wand') }));
vi.mock('../RectangularSelectionToolArea.tsx', () => ({
  RectangularSelectionToolArea: marker('rectangular-selection'),
}));

const toolAreaTestId = () => {
  const ids = [
    'move',
    'crop',
    'draw',
    'shape',
    'text',
    'lasso',
    'feather-magnetic-lasso',
    'magic-wand',
    'rectangular-selection',
  ];
  return ids.map((id) => screen.queryByTestId(`tool-area-${id}`)).findIndex((el) => el !== null);
};

const canvases = (container: HTMLElement) => Array.from(container.querySelectorAll('canvas'));

beforeEach(() => {
  vi.clearAllMocks();
  themeState.theme = 'light';
  storeState.hasImage = true;
  storeState.hasUnsavedChanges = false;
  storeState.toolName = 'reposition';
  storeState.currentArgs = { current: { toolName: 'brush' } as ToolArgs };
  loadDocumentFile.mockResolvedValue({ fileName: 'photo.png' });
  setImageFromUpload.mockResolvedValue(undefined);
  setBlankImage.mockImplementation(() => {});
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
  vi.spyOn(globalThis, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Main tool-area routing', () => {
  it.each([
    ['reposition', 'move'],
    ['crop', 'crop'],
    ['draw', 'draw'],
    ['brush', 'draw'],
    ['pencil', 'draw'],
    ['color-replacement', 'draw'],
    ['shape', 'shape'],
    ['rectangle', 'shape'],
    ['ellipse', 'shape'],
    ['triangle', 'shape'],
    ['polygon', 'shape'],
    ['line', 'shape'],
    ['text', 'text'],
    ['polygonal-lasso', 'lasso'],
    ['freehand-lasso', 'lasso'],
    ['feather-magnetic-lasso', 'feather-magnetic-lasso'],
    ['magic-wand', 'magic-wand'],
    ['rectangular-selection', 'rectangular-selection'],
  ])('routes the %s tool to the %s tool area', (toolName, expected) => {
    storeState.toolName = toolName;

    render(<Main />);

    expect(screen.getByTestId(`tool-area-${expected}`)).toBeTruthy();
  });

  it.each(['zoom', 'custom-shape', 'transform'] as const)('falls back to the hidden dummy area for %s', (toolName) => {
    storeState.toolName = toolName;

    const { container } = render(<Main />);

    expect(toolAreaTestId()).toBe(-1);
    const dummy = container.querySelector('div[style*="display: none"]');
    expect(dummy).toBeInstanceOf(HTMLElement);
    expect((dummy as HTMLElement).getAttribute('style')).toContain('display: none');
  });

  it('never mounts any tool area while no image is open', () => {
    storeState.hasImage = false;
    storeState.toolName = 'brush';

    render(<Main />);

    expect(toolAreaTestId()).toBe(-1);
    expect(screen.getByRole('button', { name: 'Open File' })).toBeTruthy();
  });

  it('hides the canvas stack while no image is open', () => {
    storeState.hasImage = false;
    const { container } = render(<Main />);
    const stack = container.querySelector('main > div') as HTMLElement;

    expect(stack.style.display).toBe('none');
  });

  it('shows the tool overlay for interactive tools and hides it for zoom', () => {
    storeState.toolName = 'reposition';
    const { container, rerender } = render(<Main />);
    const [, toolOverlay, rectOverlay] = canvases(container);

    expect(toolOverlay.style.display).toBe('block');
    expect(rectOverlay.style.display).toBe('block');

    storeState.toolName = 'zoom';
    rerender(<Main />);

    expect(canvases(container)[1].style.display).toBe('none');
    expect(canvases(container)[2].style.display).toBe('none');
  });

  it('keeps the rect overlay hidden for every non reposition tool', () => {
    storeState.toolName = 'brush';
    const { container } = render(<Main />);

    expect(canvases(container)[1].style.display).toBe('block');
    expect(canvases(container)[2].style.display).toBe('none');
  });

  it('sizes every overlay to the document and enables smoothing on the main canvas', () => {
    render(<Main />);

    const [canvas, toolOverlay, rectOverlay, selectionAnts] = canvases(document.body);
    expect([canvas, toolOverlay, rectOverlay, selectionAnts].map((el) => [el.width, el.height])).toEqual([
      [300, 150],
      [640, 480],
      [640, 480],
      [640, 480],
    ]);
  });

  it('shows the selection ants overlay for every polygon selection tool and hides it otherwise', () => {
    storeState.toolName = 'polygonal-lasso';
    const { container, rerender } = render(<Main />);
    const ants = () => container.querySelector('[data-testid="selection-ants-canvas"]') as HTMLCanvasElement;

    expect(ants().style.display).toBe('block');

    for (const toolName of ['freehand-lasso', 'feather-magnetic-lasso', 'magic-wand'] as const) {
      storeState.toolName = toolName;
      rerender(<Main />);

      expect(ants().style.display).toBe('block');
    }

    // `rectangular-selection` is the one selection tool excluded: `useRect` already
    // strokes that border, with handles, on the tool overlay.
    for (const toolName of ['rectangular-selection', 'reposition', 'brush', 'zoom'] as const) {
      storeState.toolName = toolName;
      rerender(<Main />);

      expect(ants().style.display).toBe('none');
    }
  });

  it('repaints every layer when the document frame changes', () => {
    const { rerender } = render(<Main />);
    drawAllLayers.mockClear();
    const previousFrame = storeState.documentFrame;

    storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
    rerender(<Main />);

    expect(drawAllLayers).toHaveBeenCalled();
    storeState.documentFrame = previousFrame;
  });

  it('applies the dark chessboard class for the dark theme', () => {
    themeState.theme = 'dark';
    const { container } = render(<Main />);
    const stack = container.querySelector('main > div') as HTMLElement;

    expect(stack.className).toContain('chessboard-dark');
  });
});

describe('Main empty-document actions', () => {
  beforeEach(() => {
    storeState.hasImage = false;
  });

  it('opens a file through the dialog and uploads it', async () => {
    const data = { fileName: 'photo.png' };
    openLoadImageDialog.mockResolvedValue(data);
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalledExactlyOnceWith(data));
    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('does not upload when the file dialog is dismissed', async () => {
    openLoadImageDialog.mockResolvedValue(null);
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    await vi.waitFor(() => expect(openLoadImageDialog).toHaveBeenCalled());

    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('alerts when the file dialog rejects', async () => {
    openLoadImageDialog.mockRejectedValue(new Error('no access'));
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to open file: no access'));
  });

  it('creates a blank document from the new image dialog', async () => {
    const size = { width: 10, height: 10 };
    openNewImageDialog.mockResolvedValue(size);
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    await vi.waitFor(() => expect(setBlankImage).toHaveBeenCalledExactlyOnceWith(size));
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('does not create a document when the new image dialog is dismissed', async () => {
    openNewImageDialog.mockResolvedValue(null);
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    await vi.waitFor(() => expect(openNewImageDialog).toHaveBeenCalled());

    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('alerts when the new image dialog rejects', async () => {
    openNewImageDialog.mockRejectedValue(new Error('canceled'));
    render(<Main />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to create document: canceled'));
  });
});

describe('Main file drop', () => {
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const dropOnMain = (target: HTMLElement, files: File[] = [file], types: string[] = ['Files']) => {
    fireEvent.dragOver(target, { dataTransfer: { types, files } });
    fireEvent.drop(target, { dataTransfer: { types, files } });
  };

  beforeEach(() => {
    storeState.hasImage = true;
  });

  it('highlights the drop target only for file drags', () => {
    const { container } = render(<Main />);
    const main = container.querySelector('main') as HTMLElement;

    fireEvent.dragOver(main, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(main.className).not.toContain('border-dashed');

    fireEvent.dragOver(main, { dataTransfer: { types: ['Files'], files: [] } });
    expect(main.className).toContain('border-dashed');

    fireEvent.dragLeave(main);
    expect(main.className).not.toContain('border-dashed');
  });

  it('opens a dropped file', async () => {
    render(<Main />);
    const main = screen.getByRole('main');

    dropOnMain(main);

    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalledWith({ fileName: 'photo.png' }));
    expect(loadDocumentFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(main.className).not.toContain('border-dashed');
  });

  it('ignores a drop that carries no files', () => {
    render(<Main />);

    dropOnMain(screen.getByRole('main'), []);

    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('ignores a drop whose data transfer has no Files type', () => {
    render(<Main />);

    dropOnMain(screen.getByRole('main'), [file], ['text/plain']);

    expect(loadDocumentFile).not.toHaveBeenCalled();
  });

  it('asks for confirmation before discarding unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    render(<Main />);

    dropOnMain(screen.getByRole('main'));

    expect(globalThis.confirm).toHaveBeenCalledWith('Discard unsaved changes and open another file?');
    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('asks for confirmation when the text tool holds uncommitted text', async () => {
    storeState.currentArgs = { current: { toolName: 'text', text: 'hi', rect: { x: 0, y: 0, width: 5, height: 5 } } };
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    render(<Main />);

    dropOnMain(screen.getByRole('main'));

    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('does not confirm when the text tool holds text without a rectangle', async () => {
    storeState.currentArgs = { current: { toolName: 'text', text: 'hi', rect: null } };
    render(<Main />);

    dropOnMain(screen.getByRole('main'));

    expect(globalThis.confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalled());
  });

  it('opens the file after the discard confirmation is accepted', async () => {
    storeState.hasUnsavedChanges = true;
    render(<Main />);

    dropOnMain(screen.getByRole('main'));

    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalled());
  });

  it('alerts when a dropped file cannot be decoded', async () => {
    loadDocumentFile.mockRejectedValue(new Error('corrupt'));
    render(<Main />);

    dropOnMain(screen.getByRole('main'));

    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith('Failed to open file: corrupt'));
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });
});

describe('DummyToolArea', () => {
  it('renders an invisible div that keeps the shared className', () => {
    const { container } = render(<DummyToolArea className="absolute inset-0" />);
    const el = container.firstElementChild as HTMLElement;

    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('absolute inset-0');
    expect(el.style.display).toBe('none');
    expect(el.children).toHaveLength(0);
  });

  it('renders without a className', () => {
    const { container } = render(<DummyToolArea />);

    expect((container.firstElementChild as HTMLElement).className).toBe('');
  });
});
