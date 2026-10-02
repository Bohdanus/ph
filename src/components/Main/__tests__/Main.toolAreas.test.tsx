import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Main, { SELECTION_INTERACTION_MODES } from '../Main.tsx';
import { DummyToolArea } from '../DummyToolArea.tsx';
import type { ToolArgs, ToolName } from '../../../contexts/tool-types.ts';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext.tsx';

/**
 * Tool-area routing and drop handling. DummyToolArea is the real component so
 * the "no tool" branch is observable, every other tool area is replaced by a
 * marker component.
 */

/**
 * Every render of `Main` in this file goes through the REAL discard guard.
 *
 * `Main` calls `useUnsavedChanges()` on its drop handler, so the provider is mounted rather
 * than the context mocked: it reads `useStore`, which this file already mocks, and the guard
 * under test is then the production one — `hasDiscardableWork` over the store, the shared
 * `ConfirmDialog`, and the real resolve-from-the-answer promise. The drop rows below drive the
 * dialog itself instead of stubbing `window.confirm`, which no longer exists on this path.
 *
 * It renders no DOM of its own (a context provider, plus the dialog when one is open), so every
 * `container.querySelectorAll('canvas')` count below is unaffected.
 */
const GuardedMain = () => (
  <UnsavedChangesProvider>
    <Main />
  </UnsavedChangesProvider>
);

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
      // Read by `UnsavedChangesProvider` as `previewLayers.current`, so it has to be a REF like
      // `currentArgs` above: the guard counts the keys of `.current`, and a plain `{}` would
      // throw inside the predicate instead of describing the document. Empty means "no live tool
      // transaction", which is the default state of a document at rest.
      previewLayers: { current: {} },
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
vi.mock('../EllipticalSelectionToolArea.tsx', () => ({
  EllipticalSelectionToolArea: marker('elliptical-selection'),
}));
vi.mock('../QuickSelectionToolArea.tsx', () => ({ QuickSelectionToolArea: marker('quick-selection') }));
// Its own area, not `DrawToolArea`: the Color Replacement is a click-to-sample followed by a
// drag, and it commits to the ACTIVE layer rather than creating one.
vi.mock('../ColorReplacementToolArea.tsx', () => ({ ColorReplacementToolArea: marker('color-replacement') }));
vi.mock('../EyedropperToolArea.tsx', () => ({ EyedropperToolArea: marker('eyedropper') }));
vi.mock('../EraserToolArea.tsx', () => ({ EraserToolArea: marker('eraser') }));
vi.mock('../CloneStampToolArea.tsx', () => ({ CloneStampToolArea: marker('clone-stamp') }));
vi.mock('../SharpenToolArea.tsx', () => ({ SharpenToolArea: marker('sharpen') }));
vi.mock('../SmudgeToolArea.tsx', () => ({ SmudgeToolArea: marker('smudge') }));
vi.mock('../DodgeToolArea.tsx', () => ({ DodgeToolArea: marker('dodge') }));
vi.mock('../BurnToolArea.tsx', () => ({ BurnToolArea: marker('burn') }));
vi.mock('../SpongeToolArea.tsx', () => ({ SpongeToolArea: marker('sponge') }));
vi.mock('../FillToolArea.tsx', () => ({ FillToolArea: marker('fill') }));
vi.mock('../GradientToolArea.tsx', () => ({ GradientToolArea: marker('gradient') }));

/**
 * Every mocked tool area, in the order the routing table names them. `toolAreaTestId` walks this
 * list, so an area mounted by a tool the table does not expect is still detected rather than
 * passing as "no tool area at all".
 */
const TOOL_AREA_IDS = [
  'move',
  'crop',
  'draw',
  'shape',
  'text',
  'lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'rectangular-selection',
  'elliptical-selection',
  'quick-selection',
  'eyedropper',
  'eraser',
  'clone-stamp',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
  'sponge',
  'fill',
  'color-replacement',
  'gradient',
] as const;

const toolAreaTestId = () => {
  return TOOL_AREA_IDS.map((id) => screen.queryByTestId(`tool-area-${id}`)).findIndex((el) => el !== null);
};

const canvases = (container: HTMLElement) => Array.from(container.querySelectorAll('canvas'));

beforeEach(() => {
  vi.clearAllMocks();
  themeState.theme = 'light';
  storeState.hasImage = true;
  storeState.hasUnsavedChanges = false;
  storeState.previewLayers = { current: {} };
  storeState.toolName = 'reposition';
  storeState.totalSize = { width: 640, height: 480 };
  storeState.documentFrame = { x: 0, y: 0, width: 640, height: 480 };
  storeState.currentArgs = { current: { toolName: 'brush' } as ToolArgs };
  loadDocumentFile.mockResolvedValue({ fileName: 'photo.png' });
  setImageFromUpload.mockResolvedValue(undefined);
  setBlankImage.mockImplementation(() => {});
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
    // Not `draw`: the Color Replacement has a click-to-sample step `DrawToolArea` has no place
    // for, and it commits to the ACTIVE layer instead of creating one.
    ['color-replacement', 'color-replacement'],
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
    // Each of the new tools got its own tool area rather than sharing the `draw` one, so each
    // row below pins a DISTINCT area: a tool accidentally pointed at a neighbour's component
    // would render that neighbour's marker and fail here. The eraser is a drag area that is NOT
    // `DrawToolArea`, so it gets its own mode too. The two fill tools share one area because
    // they differ only in what their processor writes into the fill mask.
    ['elliptical-selection', 'elliptical-selection'],
    ['quick-selection', 'quick-selection'],
    ['eyedropper', 'eyedropper'],
    ['eraser', 'eraser'],
    ['clone-stamp', 'clone-stamp'],
    ['sharpen', 'sharpen'],
    ['smudge', 'smudge'],
    ['dodge', 'dodge'],
    ['burn', 'burn'],
    // The Sponge gets its OWN area rather than `Tonal`'s pair, and this row pins that it
    // still resolves: a tool the routing table forgot falls through to the hidden dummy,
    // which renders no marker and would otherwise pass as a working area.
    ['sponge', 'sponge'],
    ['magic-eraser', 'fill'],
    ['paint-bucket', 'fill'],
    ['gradient', 'gradient'],
  ])('routes the %s tool to the %s tool area', (toolName, expected) => {
    storeState.toolName = toolName;

    render(<GuardedMain />);

    expect(screen.getByTestId(`tool-area-${expected}`)).toBeTruthy();
  });

  it('mounts exactly one tool area for every tool that has one', () => {
    // The routing table above checks the expected marker is present, which would still pass
    // if `Main` rendered a SECOND area alongside it. Every tool-area branch is an `else if`
    // over a single `interactionMode`, so one is the only correct number.
    const routed = [
      'reposition',
      'crop',
      'draw',
      'brush',
      'pencil',
      'color-replacement',
      'shape',
      'rectangle',
      'ellipse',
      'triangle',
      'polygon',
      'line',
      'text',
      'polygonal-lasso',
      'freehand-lasso',
      'feather-magnetic-lasso',
      'magic-wand',
      'rectangular-selection',
      'elliptical-selection',
      'quick-selection',
      'eyedropper',
      'eraser',
      'clone-stamp',
      'sharpen',
      'smudge',
      'dodge',
      'burn',
      'sponge',
      'paint-bucket',
      'gradient',
    ] as const;

    for (const toolName of routed) {
      storeState.toolName = toolName;
      const { container, unmount } = render(<GuardedMain />);

      const mounted = TOOL_AREA_IDS.map((id) => container.querySelector(`[data-testid="tool-area-${id}"]`)).filter(
        (element) => element !== null
      );
      expect(mounted, toolName).toHaveLength(1);
      unmount();
    }
  });

  it.each([
    'zoom',
    'custom-shape',
    'transform',
    // These are the only tools left with no tool area at all: the zoom is a store-driven
    // viewport control, `custom-shape` is still a placeholder panel, and `transform` is a
    // one-shot operation the canvas route drives rather than a gesture surface. The eleven
    // Photoshop tools that used to sit in this list have each left it for a real area, so
    // this table is the deliberate allow-list of what may still fall through to the dummy.
    'pen',
    'freeform-pen',
    'curvature-pen',
    'add-anchor-point',
    'delete-anchor-point',
    'convert-point',
  ] as const)('falls back to the hidden dummy area for %s', (toolName) => {
    storeState.toolName = toolName;

    render(<GuardedMain />);

    // The only assertion here that says anything. It reads the whole marker list, so a fall-through
    // that mounted SOME area rather than none would still be caught — which is the half of the
    // old assertion below that was load-bearing. The other half was not: the produced
    // `div[style*="display: none"]` is byte-identical for `SharpenToolArea` and `DummyToolArea`,
    // so it could not tell a hidden area from the hidden one, and would have passed identically
    // if the router had sent some other tool to `SharpenToolArea`. `SharpenToolArea`'s rendered
    // surface is pinned directly in the describe below.
    expect(toolAreaTestId()).toBe(-1);
  });

  /**
   * The two components this file could not tell apart, compared directly.
   *
   * `SharpenToolArea` (`../SharpenToolArea.tsx:46`) renders
   * `<div className={className} style={{ display: 'none' }} />` and `DummyToolArea`
   * (`../DummyToolArea.tsx:11-18`) renders the same element, so the DOM is byte-identical and
   * every `style`-shaped query matched both. The identity is the DESIGN — Sharpen is a one-shot
   * filter with no gesture, and its area is "the documented ABSENCE of one" — so this asserts the
   * identity rather than reporting it as a duplication.
   *
   * The inertness is the load-bearing half, and the reason is spelled out in `SharpenToolArea`'s
   * own JSDoc: `Main` mounts the area with `className="absolute inset-0 h-full w-full"`, i.e. over
   * the whole document. A pointer handler there would swallow every pointer event over the canvas
   * without doing anything with any of them, and a drag would select text or scrub the layers
   * panel instead of being inert. `toBeInTheDocument`-style assertions cannot see that, so the
   * props React attached to the DOM node are read instead.
   */
  it('mounts SharpenToolArea as the same inert surface as DummyToolArea, with no pointer handler at all', async () => {
    // This file mocks every tool area, so the real `SharpenToolArea` is unreachable through a
    // normal import; `importActual` is the route that bypasses the mock without lifting it for
    // the routing table, which needs the marker.
    const { SharpenToolArea: ActualSharpenToolArea } =
      await vi.importActual<typeof import('../SharpenToolArea.tsx')>('../SharpenToolArea.tsx');

    const { container: dummyContainer } = render(<DummyToolArea className="probe" />);
    const { container: sharpenContainer } = render(
      <ActualSharpenToolArea className="probe" overlayCtxRef={{ current: null }} />
    );

    expect(sharpenContainer.innerHTML).toBe(dummyContainer.innerHTML);
    expect(sharpenContainer.innerHTML).not.toBe('');

    // The detector has to be shown to work, or "no handler names" is indistinguishable from
    // "the probe found nothing". React DOM stores the props it attached to every host node under
    // a `__reactProps$<key>` property (`updateFiberProps`), which is the only place an event
    // handler is observable from the outside — React never reflects one onto a DOM attribute.
    const reactProps = (element: Element): Record<string, unknown> => {
      // React's internal prop key is an expando, so it is absent from the DOM's own typing and
      // has to be read through an index signature.
      const host = element as unknown as Record<string, unknown>;
      const key = Object.keys(host).find((candidate) => candidate.startsWith('__reactProps$'));
      if (!key) throw new Error('React attached no props to the element, so this probe proves nothing');

      return host[key] as Record<string, unknown>;
    };
    const handlerNames = (element: Element): string[] =>
      Object.keys(reactProps(element)).filter((name) => /^on[A-Z]/.test(name));

    const control = render(<div className="probe" onPointerDown={() => undefined} />).container
      .firstElementChild as Element;
    expect(handlerNames(control)).toEqual(['onPointerDown']);

    const sharpen = sharpenContainer.firstElementChild as Element;
    expect(handlerNames(sharpen)).toEqual([]);
  });

  it('never mounts any tool area while no image is open', () => {
    storeState.hasImage = false;
    storeState.toolName = 'brush';

    render(<GuardedMain />);

    expect(toolAreaTestId()).toBe(-1);
    expect(screen.getByRole('button', { name: 'Open File' })).toBeTruthy();
  });

  it('hides the canvas stack while no image is open', () => {
    storeState.hasImage = false;
    const { container } = render(<GuardedMain />);
    const stack = container.querySelector('main > div') as HTMLElement;

    expect(stack.style.display).toBe('none');
  });

  it('shows the tool overlay for interactive tools and hides it for zoom', () => {
    storeState.toolName = 'reposition';
    const { container, rerender } = render(<GuardedMain />);
    const [, toolOverlay, rectOverlay] = canvases(container);

    expect(toolOverlay.style.display).toBe('block');
    expect(rectOverlay.style.display).toBe('block');

    storeState.toolName = 'zoom';
    rerender(<GuardedMain />);

    expect(canvases(container)[1].style.display).toBe('none');
    expect(canvases(container)[2].style.display).toBe('none');
  });

  it('keeps the rect overlay hidden for every non reposition tool', () => {
    storeState.toolName = 'brush';
    const { container } = render(<GuardedMain />);

    expect(canvases(container)[1].style.display).toBe('block');
    expect(canvases(container)[2].style.display).toBe('none');
  });

  it('keeps the eraser OFF the overlay canvas, which structurally cannot preview an erase', () => {
    // The eraser previews by mutating the active layer through `tempUpdateLayer`
    // (`EraserToolArea.tsx`), not by drawing into the overlay. It used to draw into the overlay
    // with `composite: 'destination-out'`, and that can never produce a visible pixel: the
    // overlay is cleared to fully transparent each frame and `destination-out` computes
    // `da' = da * (1 - sa)`, so `da = 0` gives `0` for every pixel. The stroke was therefore
    // invisible for the whole gesture and appeared only on pointer-up, and this list entry is
    // what kept the empty canvas stacked over the document. Listing it here again would
    // reintroduce the dead-looking tool.
    storeState.toolName = 'eraser';
    const { container } = render(<GuardedMain />);

    expect(canvases(container)[1].style.display).toBe('none');
  });

  it('keeps the tool overlay hidden for the fill and eyedropper tools', () => {
    // Both commit on the click itself and never draw a preview, so the overlay has nothing to
    // show — and showing it would leave a stale overlay from an earlier tool on the document.
    for (const toolName of ['paint-bucket', 'magic-eraser', 'eyedropper'] as const) {
      storeState.toolName = toolName;
      const { container, unmount } = render(<GuardedMain />);

      expect(canvases(container)[1].style.display).toBe('none');
      unmount();
    }
  });

  it('leaves the workspace canvas to the CSS box and to useApp, never sizing it from the document', () => {
    // `Main`'s `useLayoutEffect` sizes the overlays from `totalSize`. The workspace canvas is
    // deliberately absent from it: the drawing surface is CSS-sized to its container
    // (`h-full w-full object-contain`) and `useApp` owns its backing store, so a `resizeCanvas`
    // call here would fight that and resize a buffer nothing reads.
    //
    // The guard is relational on purpose. The old form asserted `[300, 150]`, which is jsdom's
    // default and a value no one in this app chose — it would pin an environment artefact as
    // though it were a product decision, and it would only say anything at all because `Main`
    // happens not to write those attributes. So instead: the workspace canvas's backing store
    // must not follow the document size, and the overlays are asserted to have followed it, which
    // is what stops "unchanged" from passing merely because the sizing effect never ran.
    const { rerender } = render(<GuardedMain />);
    // The selection-ants canvas is appended LAST, so these three indices are unchanged by it —
    // which is the reason it is appended last, and this destructuring is where that is load-bearing.
    const [workspace, toolOverlay, rectOverlay] = canvases(document.body);
    const ants = document.body.querySelector('[data-testid="selection-ants-canvas"]') as HTMLCanvasElement;
    const untouched = [workspace.width, workspace.height];

    storeState.totalSize = { width: 800, height: 600 };
    rerender(<GuardedMain />);

    expect([workspace.width, workspace.height]).toEqual(untouched);
    expect([toolOverlay.width, toolOverlay.height]).toEqual([800, 600]);
    expect([rectOverlay.width, rectOverlay.height]).toEqual([800, 600]);
    // A canvas that is never sized paints a selection border at the document's own resolution
    // into a buffer of the previous one, which is the "cached canvas box addresses a different
    // pixel after a tool switch" class this suite already files for the other overlays.
    expect([ants.width, ants.height]).toEqual([800, 600]);
  });

  it('shows the selection ants overlay for every selection tool and hides it otherwise', () => {
    storeState.toolName = 'polygonal-lasso';
    const { container, rerender } = render(<GuardedMain />);
    const ants = () => container.querySelector('[data-testid="selection-ants-canvas"]') as HTMLCanvasElement;

    expect(ants().style.display).toBe('block');

    // Every selection tool in the rail, by its tool name. The list is exhaustive over
    // `ToolIconName` rather than over the interaction modes, so a new selection tool that nobody
    // added here shows up as a failure here instead of as a tool with no border.
    //
    // It used to name three of the eight and exclude the rest: `rectangular-selection` because
    // `useRect` stroked that border with handles, and the elliptical and quick selection tools
    // because they are not in `POLYGON_SELECTION_MODES` and so kept the static
    // `drawSelectionOutline`. Both exclusions are defects rather than facts — a border is a
    // border, whichever canvas draws it — and `useRect`'s `borderMode` is what retires the first:
    // the marquee gets the border from the ants, one canvas up, and `useRect` stops drawing a
    // second outline of the same rectangle.
    for (const toolName of [
      'freehand-lasso',
      'feather-magnetic-lasso',
      'magic-wand',
      'quick-selection',
      'elliptical-selection',
      'single-row-marquee',
      'single-column-marquee',
      'rectangular-selection',
    ] as const) {
      storeState.toolName = toolName;
      rerender(<GuardedMain />);

      expect(ants().style.display, `${toolName} is a selection tool and must own the ants canvas`).toBe('block');
    }

    // A non-selection tool must not run a 60fps loop into a canvas nobody can see. The canvas and
    // the loop are gated on one boolean (`selectionToolActive`), so they cannot disagree; this
    // loop is the half of that claim which is not about the list above.
    for (const toolName of ['reposition', 'brush', 'crop', 'text', 'zoom', 'paint-bucket', 'eyedropper'] as const) {
      storeState.toolName = toolName;
      rerender(<Main />);

      expect(ants().style.display).toBe('none');
    }
  });

  it('names every selection interaction mode in the exported gate, and nothing else', () => {
    // The list in `Main.tsx` and the assertion above are the same rule stated twice, so the test
    // asserts the export rather than a copy of it. A tool name that routes to a mode the gate
    // does not list is a selection tool with no border, and this is where it is caught.
    const modesOfSelectionTools: Record<string, string> = {
      'polygonal-lasso': 'lasso',
      'freehand-lasso': 'lasso',
      'feather-magnetic-lasso': 'feather-magnetic-lasso',
      'magic-wand': 'magic-wand',
      'quick-selection': 'quick-selection',
      'elliptical-selection': 'elliptical-selection',
      'single-row-marquee': 'single-row-column-marquee',
      'single-column-marquee': 'single-row-column-marquee',
      'rectangular-selection': 'rectangular-selection',
    };

    for (const mode of Object.values(modesOfSelectionTools)) {
      expect(SELECTION_INTERACTION_MODES.has(mode), `${mode} must own the ants canvas`).toBe(true);
    }

    // Two interaction modes, both `useRect`, and neither a selection: the Move tool repositions
    // a LAYER and Crop frames the document. Marching either would animate a layer outline and a
    // crop frame as if they were selections.
    for (const mode of ['reposition', 'crop']) {
      expect(SELECTION_INTERACTION_MODES.has(mode), `${mode} is not a selection`).toBe(false);
    }
  });

  it('repaints every layer when the document frame changes', () => {
    const { rerender } = render(<GuardedMain />);
    drawAllLayers.mockClear();
    const previousFrame = storeState.documentFrame;

    storeState.documentFrame = { x: 0, y: 0, width: 800, height: 600 };
    rerender(<GuardedMain />);

    expect(drawAllLayers).toHaveBeenCalled();
    storeState.documentFrame = previousFrame;
  });

  it('applies the dark chessboard class for the dark theme', () => {
    themeState.theme = 'dark';
    const { container } = render(<GuardedMain />);
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
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalledExactlyOnceWith(data));
    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('does not upload when the file dialog is dismissed', async () => {
    openLoadImageDialog.mockResolvedValue(null);
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    await vi.waitFor(() => expect(openLoadImageDialog).toHaveBeenCalled());

    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('reports the failure through console.error when the file dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openLoadImageDialog.mockRejectedValue(new Error('no access'));
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));
    // The dialog threw before it could name a file, so the upload must not have been attempted:
    // the console report and the untouched document are the whole of the failure now that the
    // modal is gone, and the second half is what keeps a handler that still called
    // `setImageFromUpload` on the error path from passing this.
    // The Error is the SECOND argument, not an interpolation: passing it through is what leaves the
    // stack in the console, and a single interpolated string would fail this on arity alone.
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to open file:', expect.any(Error)));
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openLoadImageDialog.mockRejectedValue({ code: 'EACCES' });
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File' }));

    // This is the whole point of the two-argument form. Stringified, a rejection that is not an
    // `Error` collapses to `[object Object]` and the reason is gone; passed through, the console
    // prints the object. So the assertion names the exact raw value, and it cannot pass against the
    // interpolated call it replaced.
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to open file:', { code: 'EACCES' })
    );
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('creates a blank document from the new image dialog', async () => {
    const size = { width: 10, height: 10 };
    openNewImageDialog.mockResolvedValue(size);
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    await vi.waitFor(() => expect(setBlankImage).toHaveBeenCalledExactlyOnceWith(size));
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('does not create a document when the new image dialog is dismissed', async () => {
    openNewImageDialog.mockResolvedValue(null);
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    await vi.waitFor(() => expect(openNewImageDialog).toHaveBeenCalled());

    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('reports the failure through console.error when the new image dialog rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openNewImageDialog.mockRejectedValue(new Error('canceled'));
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));
    // A rejected dialog yields no size, so no blank document may be created from it — the
    // console report and an unchanged document are the whole of the failure.
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to create document:', expect.any(Error)));
    expect(setBlankImage).not.toHaveBeenCalled();
  });

  it('passes a non-Error rejection from the new image dialog through unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    openNewImageDialog.mockRejectedValue('plain failure');
    render(<GuardedMain />);

    fireEvent.click(screen.getByRole('button', { name: 'blank image' }));

    // Stringified, this would arrive as `Failed to create document: plain failure` — the reason
    // survives by accident for a string, but only because `String(x)` on a string is `x`; an
    // object reason does not get that. The raw value is the contract.
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to create document:', 'plain failure')
    );
    expect(setBlankImage).not.toHaveBeenCalled();
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
    const { container } = render(<GuardedMain />);
    const main = container.querySelector('main') as HTMLElement;

    fireEvent.dragOver(main, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(main.className).not.toContain('border-dashed');

    fireEvent.dragOver(main, { dataTransfer: { types: ['Files'], files: [] } });
    expect(main.className).toContain('border-dashed');

    fireEvent.dragLeave(main);
    expect(main.className).not.toContain('border-dashed');
  });

  it('opens a dropped file', async () => {
    render(<GuardedMain />);
    const main = screen.getByRole('main');

    dropOnMain(main);

    await waitFor(() => expect(setImageFromUpload).toHaveBeenCalledWith({ fileName: 'photo.png' }));
    expect(loadDocumentFile).toHaveBeenCalledExactlyOnceWith(file);
    expect(main.className).not.toContain('border-dashed');
    // A document at rest has nothing to discard, so `confirmDiscard` resolves `true` without
    // ever mounting a widget. Asserted after the load rather than instead of it: the load is
    // the claim, and this is what keeps a guard that prompted for an empty document from
    // passing by resolving `true` anyway.
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('ignores a drop that carries no files', () => {
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'), []);

    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('ignores a drop whose data transfer has no Files type', () => {
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'), [file], ['text/plain']);

    expect(loadDocumentFile).not.toHaveBeenCalled();
  });

  it('asks for confirmation before discarding unsaved changes', async () => {
    storeState.hasUnsavedChanges = true;
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // The prompt is an in-app modal now, so there is no `window.confirm` left to spy on and
    // the claim has to be made against the widget the user actually sees: the drop reached the
    // replacement guard and asked first. The copy is carried over verbatim, which is what lets
    // the dialog's accessible description stand in for the old `toHaveBeenCalledWith` — the
    // message paragraph is what `aria-describedby` points at, i.e. the text a screen reader
    // announces with the dialog, so asserting through it pins the wording AND the wiring.
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-dialog')).toHaveAccessibleDescription(
      'Discard unsaved changes and open another file?'
    );

    // Declining is what the old `confirm` stub returning `false` expressed, and it is only
    // observable through the answer: the dialog must come down AND the document must be
    // untouched, so a handler that loaded before asking would fail on the second half.
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());

    expect(loadDocumentFile).not.toHaveBeenCalled();
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('asks for confirmation when the text tool holds uncommitted text', async () => {
    storeState.currentArgs = { current: { toolName: 'text', text: 'hi', rect: { x: 0, y: 0, width: 5, height: 5 } } };
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // `hasUnsavedChanges` is FALSE on this row, so the prompt can only have come from
    // `hasPendingText` — which is the point of the row now that the predicate is shared with
    // five other call sites. EXACTLY ONE dialog is the old `toHaveBeenCalledTimes(1)`: a guard
    // that asked twice, or stacked a second prompt behind the first, would still pass a bare
    // presence check, and only the count rules that out.
    await screen.findByTestId('confirm-dialog');
    expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
    expect(setImageFromUpload).not.toHaveBeenCalled();
  });

  it('does not ask when the text tool holds text without a rectangle', async () => {
    storeState.currentArgs = { current: { toolName: 'text', text: 'hi', rect: null } };
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // The old shape was `expect(globalThis.confirm).not.toHaveBeenCalled()`. With a widget there
    // is nothing to spy on, so the claim becomes the observable one: the load went all the way
    // through, and no prompt is mounted at the end of it. Checking only after the load is enough
    // because nothing else dismisses that dialog — one that had appeared would still be up.
    await waitFor(() => expect(setImageFromUpload).toHaveBeenCalled());
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('opens the file after the discard confirmation is accepted', async () => {
    storeState.hasUnsavedChanges = true;
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // The load is blocked on the answer, so the affirmative button is the ONLY route to it —
    // this is the old `confirm(...) === true` path, driven through the widget the product
    // renders rather than through a stub that answered before anything was asked.
    await screen.findByTestId('confirm-dialog');
    expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(setImageFromUpload).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
  });

  it('reports the failure through console.error when a dropped file cannot be decoded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadDocumentFile.mockRejectedValue(new Error('corrupt'));
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // The decode is the last thing the drop handler does before it publishes, so a rejection
    // leaves the open document exactly as it was — the assertion that matters now that the
    // native dialog is gone. The Error is the second argument, so the stack survives into the log.
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to open file:', expect.any(Error)));
    expect(setImageFromUpload).not.toHaveBeenCalled();
    // The replacement prompt is raised in front of the decode, so reaching the decoder at all is
    // also what shows the clean document was never asked about: no prompt is mounted on this path.
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('passes a non-Error decode rejection through to the console unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadDocumentFile.mockRejectedValue({ code: 'ENODATA' });
    render(<GuardedMain />);

    dropOnMain(screen.getByRole('main'));

    // A decoder that rejects with a reason object is the realistic shape here, and under the
    // interpolated log it read `Failed to open file: [object Object]`. The assertion names the
    // exact object, so it fails against that and passes only against the two-argument call.
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledExactlyOnceWith('Failed to open file:', { code: 'ENODATA' })
    );
    expect(setImageFromUpload).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
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
