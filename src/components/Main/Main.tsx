import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CropToolArea } from './CropToolArea.tsx';
import { DrawToolArea } from './DrawToolArea.tsx';
import { TextToolArea } from './TextToolArea.tsx';
import { TextEditOverlay } from './TextEditOverlay.tsx';
import { DummyToolArea } from './DummyToolArea.tsx';

import './Main.scss';
import { ShapeToolArea } from './ShapeToolArea.tsx';
import { PolygonClickToolArea } from './PolygonClickToolArea.tsx';
import { RectangularSelectionToolArea } from './RectangularSelectionToolArea.tsx';
import { FeatherMagneticLassoToolArea } from './FeatherMagneticLassoToolArea.tsx';
import { MagicWandToolArea } from './MagicWandToolArea.tsx';
import { EllipticalSelectionToolArea } from './EllipticalSelectionToolArea.tsx';
import { QuickSelectionToolArea } from './QuickSelectionToolArea.tsx';
import { SingleRowColumnMarqueeToolArea } from './SingleRowColumnMarqueeToolArea.tsx';
import { ColorReplacementToolArea } from './ColorReplacementToolArea.tsx';
import { EyedropperToolArea } from './EyedropperToolArea.tsx';
import { RulerToolArea } from './RulerToolArea.tsx';
import { ColorSamplerToolArea } from './ColorSamplerToolArea.tsx';
import { RedEyeToolArea } from './RedEyeToolArea.tsx';
import { SpotHealingToolArea } from './SpotHealingToolArea.tsx';
import { HealingBrushToolArea } from './HealingBrushToolArea.tsx';
import { PatchToolArea } from './PatchToolArea.tsx';
import { EraserToolArea } from './EraserToolArea.tsx';
import { CloneStampToolArea } from './CloneStampToolArea.tsx';
import { SharpenToolArea } from './SharpenToolArea.tsx';
import { SmudgeToolArea } from './SmudgeToolArea.tsx';
import { DodgeToolArea } from './DodgeToolArea.tsx';
import { BurnToolArea } from './BurnToolArea.tsx';
import { SpongeToolArea } from './SpongeToolArea.tsx';
import { GradientToolArea } from './GradientToolArea.tsx';
import { FillToolArea } from './FillToolArea.tsx';
import { ViewToolArea, type ViewToolMode } from './ViewToolArea.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { PRIMARY_BUTTON_LARGE } from '../ToolbarsRight/buttonStyles.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { useAutoSave } from '../../contexts/AutoSaveContext.tsx';
import { loadDocumentFile } from '../../contexts/image-load-save-utils.ts';
import { MoveToolArea } from './MoveToolArea.tsx';
import { SelectionMarchingAnts } from './SelectionMarchingAnts.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext.tsx';
import { resizeCanvas } from '../../util/canvas.ts';
import { DEFAULT_VIEW_STATE, effectiveViewZoom } from '../../contexts/view-state.ts';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.ts';
import { isDocumentGestureOpen, subscribeDocumentGesture } from '../../hooks/document-gesture.ts';
import { setTemporaryHandActive } from '../../hooks/temporary-hand.ts';
import { useCanvasTouchNavigation } from '../../hooks/useCanvasTouchNavigation.ts';
import { SELECTION_PRESERVING_TOOL_NAMES } from '../../util/selection-tool-support.ts';

/**
 * The interaction modes whose tool owns a selection, which is every mode that can have a
 * marching-ants border — the ants ARE the selection border in this editor, for all of them.
 *
 * This replaces a narrower list that named only the polygon modes and left the rectangular
 * selection out on the stated ground that `useRect` strokes a border of its own. That reason
 * has two halves and only one of them was ever true. `useRect` still owns the four handles,
 * and they are the resize hit area, so they stay; but Adobe documents the ants as the display
 * of a selection and not as a per-tool option
 * (`helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html`
 * lists all nine marquee and lasso tools as making selections, and none of them as producing a
 * different kind of border), and nothing in `useRect`'s own API makes its static stroke the
 * selection border rather than a draft preview of it.
 *
 * Exported so the tool-area test asserts the list itself rather than a copy of it that can
 * drift.
 */
export const SELECTION_INTERACTION_MODES: ReadonlySet<string> = new Set([
  'lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'quick-selection',
  'elliptical-selection',
  'single-row-column-marquee',
  'rectangular-selection',
]);

const START_IMAGE_PRESETS = [
  { id: 'landscape', label: 'Landscape', width: 1920, height: 1080 },
  { id: 'square', label: 'Square', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait', width: 1080, height: 1350 },
] as const;

const Main = () => {
  const [
    {
      canvasRef,
      containerRef,
      toolOverlayRef,
      rectOverlayRef,
      hasImage,
      layers,
      toolName,
      selections,
      totalSize,
      documentFrame,
      viewState,
    },
  ] = useStore();
  const { theme } = useTheme();
  const { isCheckingAutosave } = useAutoSave();
  const { setBlankImage, setImageFromUpload } = useApp();
  const { openLoadImageDialog, openNewImageDialog } = useFile();
  const { confirmDiscard } = useUnsavedChanges();
  const { drawAllLayers } = useLayers();
  const documentGestureOpen = useSyncExternalStore(subscribeDocumentGesture, isDocumentGestureOpen, () => false);

  const [isDragging, setIsDragging] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const touchNavigation = useCanvasTouchNavigation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !hasImage || toolName === 'text') return;
      event.preventDefault();
      setTemporaryHandActive(true);
      setSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setTemporaryHandActive(false);
        setSpacePressed(false);
      }
    };
    const handleBlur = () => {
      setTemporaryHandActive(false);
      setSpacePressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      setTemporaryHandActive(false);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [hasImage, toolName]);

  const toolCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const selectionAntsOverlayRef = useRef<HTMLCanvasElement | null>(null);

  let interactionMode = 'idle';
  if (toolName === 'reposition') {
    interactionMode = 'reposition';
  } else if (toolName === 'hand') {
    interactionMode = 'hand';
  } else if (toolName === 'zoom') {
    interactionMode = 'zoom';
  } else if (toolName === 'rotate-view') {
    interactionMode = 'rotate-view';
  } else if (toolName === 'crop') {
    interactionMode = 'crop';
  } else if (toolName === 'draw' || toolName === 'brush' || toolName === 'pencil') {
    interactionMode = 'draw';
  } else if (toolName === 'color-replacement') {
    // Its own area, not `draw`. A Color Replacement is a click-to-sample followed by a drag, and
    // `DrawToolArea` has no step for the first half of that: it would stroke the sampling click as
    // if it were paint. It is also an ACTIVE-layer edit like the eraser, committing through
    // `updateLayerByTool` rather than creating a layer.
    interactionMode = 'color-replacement';
  } else if (
    toolName === 'shape' ||
    toolName === 'rectangle' ||
    toolName === 'ellipse' ||
    toolName === 'triangle' ||
    toolName === 'polygon' ||
    toolName === 'line'
  ) {
    interactionMode = 'shape';
  } else if (toolName === 'text') {
    interactionMode = 'text';
  } else if (toolName === 'polygonal-lasso' || toolName === 'freehand-lasso') {
    interactionMode = 'lasso';
  } else if (toolName === 'feather-magnetic-lasso') {
    interactionMode = 'feather-magnetic-lasso';
  } else if (toolName === 'magic-wand') {
    interactionMode = 'magic-wand';
  } else if (toolName === 'rectangular-selection') {
    interactionMode = 'rectangular-selection';
  } else if (toolName === 'single-row-marquee' || toolName === 'single-column-marquee') {
    // ONE mode for both tools, and the opposite choice from the elliptical one above:
    // the two areas paint the same kind of geometry from the same code, and the only
    // difference between them is which pointer axis is read, which
    // `SingleRowColumnMarqueeToolArea` decides from `useStore().toolName`. Two mode
    // strings would mean two entries in the overlay display list and the routing table
    // below for a component that is mounted identically either way.
    interactionMode = 'single-row-column-marquee';
  } else if (toolName === 'elliptical-selection') {
    // Its own mode rather than a second name on the rectangular one: the two areas
    // paint different geometry (an axis-aligned box and an ellipse) off different args,
    // so the mode has to name the area, not just the family.
    interactionMode = 'elliptical-selection';
  } else if (toolName === 'quick-selection') {
    interactionMode = 'quick-selection';
  } else if (toolName === 'eyedropper') {
    interactionMode = 'eyedropper';
  } else if (toolName === 'ruler') {
    // Its own mode, not a mode shared with the Eyedropper: the two are one `I`-family tile but they
    // do different things with a pointer — one samples a pixel, the other drags a nonprinting line
    // across the overlay — and one mode mounts one area, so a shared mode would mount one of them.
    interactionMode = 'ruler';
  } else if (toolName === 'color-sampler') {
    // Its own mode, and NOT a mode shared with the eyedropper above. The two are one `I`-family
    // tile and they both read a pixel, but they do different things with the result — one writes it
    // to the foreground swatch and commits nothing, the other leaves a numbered marker on the
    // overlay that a later drag can pick up and move — and one mode mounts one area. The Eyedropper's
    // Shift-click place-a-sampler path calls the same store rather than sharing this mode, which is
    // why the two can agree about the hit test without one area mounting for both.
    interactionMode = 'color-sampler';
  } else if (toolName === 'eraser') {
    // A brush, but NOT the `draw` mode: `DrawToolArea` creates a new layer from a
    // `{ ...args, points }` and draws the `DrawToolArgs` preview, where the eraser
    // edits the ACTIVE layer in place through `tempUpdateLayer`. Sharing the mode would
    // mount the wrong area rather than a differently-parameterised one.
    interactionMode = 'eraser';
  } else if (toolName === 'smudge') {
    interactionMode = 'smudge';
  } else if (toolName === 'dodge') {
    interactionMode = 'dodge';
  } else if (toolName === 'burn') {
    interactionMode = 'burn';
  } else if (toolName === 'sponge') {
    interactionMode = 'sponge';
  } else if (toolName === 'clone-stamp') {
    interactionMode = 'clone-stamp';
  } else if (toolName === 'red-eye') {
    interactionMode = 'red-eye';
  } else if (toolName === 'spot-healing') {
    interactionMode = 'spot-healing';
  } else if (toolName === 'healing-brush') {
    interactionMode = 'healing-brush';
  } else if (toolName === 'patch') {
    interactionMode = 'patch';
  } else if (toolName === 'sharpen') {
    interactionMode = 'sharpen';
  } else if (toolName === 'magic-eraser' || toolName === 'paint-bucket') {
    // One area, two tools: they differ only in what their processor writes into the fill mask.
    // The bucket is a click rather than a drag, which `FillToolArea` already handles for both.
    interactionMode = 'fill';
  } else if (toolName === 'gradient') {
    // A drag, unlike the bucket it shares an options bar with.
    interactionMode = 'gradient';
  }

  // A temporary Hand press must not unmount a tool while its pointer owns a document gesture.
  // Marquee tools read the same key state and reposition the live marquee while the drag is open.
  if (spacePressed && toolName !== 'text' && hasImage && !documentGestureOpen) interactionMode = 'hand';

  // Marching ants remain visible while a committed selection is used with other tools. Selection
  // tools also keep the overlay enabled during a new draft before a committed selection exists.
  // Both the canvas and animation use one gate so no hidden 60fps loop is left running.
  const showSelectionAnts =
    SELECTION_INTERACTION_MODES.has(interactionMode) ||
    (SELECTION_PRESERVING_TOOL_NAMES.has(toolName) && selections.some((selection) => selection.isActive));
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    drawAllLayers();
  }, [documentFrame, drawAllLayers, layers]);

  useLayoutEffect(() => {
    const { width, height } = totalSize;
    if (toolOverlayRef.current) {
      resizeCanvas(toolOverlayRef.current, width, height, dpr);

      const toolCtx = toolOverlayRef.current.getContext('2d');
      toolCtxRef.current = toolCtx;
      if (toolCtx) {
        toolCtx.imageSmoothingEnabled = false;
        toolCtx.imageSmoothingQuality = 'low';
      }
    }

    if (rectOverlayRef.current) {
      resizeCanvas(rectOverlayRef.current, width, height, dpr);
      const rectCtx = rectOverlayRef.current.getContext('2d');
      if (rectCtx) {
        rectCtx.imageSmoothingEnabled = false;
      }
    }
    if (selectionAntsOverlayRef.current) {
      resizeCanvas(selectionAntsOverlayRef.current, width, height, dpr);
    }
  }, [rectOverlayRef, toolOverlayRef, totalSize, dpr]);

  const handleDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      // The one destructive entry point a bare gesture reaches on a populated document:
      // unlike the empty-state buttons below, the drop handler is not gated on `!hasImage`.
      // Inside the `try`, so a rejection from the guard is reported through the same channel
      // as a decode failure rather than escaping as an unhandled rejection.
      try {
        if (!(await confirmDiscard('open-document'))) return;
        await setImageFromUpload(await loadDocumentFile(file));
      } catch (error) {
        console.error('Failed to open file:', error);
      }
    }
  };

  const renderContent = () => {
    const view = viewState ?? DEFAULT_VIEW_STATE;
    const viewZoom = effectiveViewZoom(view);
    const viewTransform =
      view.panX === 0 && view.panY === 0 && viewZoom === 1 && view.rotation === 0
        ? ''
        : `translate(${view.panX}px, ${view.panY}px) scale(${viewZoom}) rotate(${view.rotation}deg)`;
    type ToolAreaComponent =
      | typeof DummyToolArea
      | typeof MoveToolArea
      | typeof CropToolArea
      | typeof DrawToolArea
      | typeof ShapeToolArea
      | typeof TextToolArea
      | typeof PolygonClickToolArea
      | typeof FeatherMagneticLassoToolArea
      | typeof MagicWandToolArea
      | typeof RectangularSelectionToolArea
      | typeof EllipticalSelectionToolArea
      | typeof SingleRowColumnMarqueeToolArea
      | typeof QuickSelectionToolArea
      | typeof EyedropperToolArea
      | typeof RulerToolArea
      | typeof ColorSamplerToolArea
      | typeof EraserToolArea
      | typeof SmudgeToolArea
      | typeof DodgeToolArea
      | typeof BurnToolArea
      | typeof SpongeToolArea
      | typeof CloneStampToolArea
      | typeof SharpenToolArea
      | typeof GradientToolArea
      | typeof FillToolArea
      | typeof ColorReplacementToolArea
      | typeof RedEyeToolArea
      | typeof SpotHealingToolArea
      | typeof HealingBrushToolArea
      | typeof PatchToolArea;

    let EventHandler: ToolAreaComponent = DummyToolArea;
    if (hasImage) {
      if (interactionMode === 'reposition') EventHandler = MoveToolArea;
      else if (interactionMode === 'crop') EventHandler = CropToolArea;
      else if (interactionMode === 'draw') EventHandler = DrawToolArea;
      else if (interactionMode === 'shape') EventHandler = ShapeToolArea;
      else if (interactionMode === 'text') EventHandler = TextToolArea;
      else if (interactionMode === 'lasso') EventHandler = PolygonClickToolArea;
      else if (interactionMode === 'feather-magnetic-lasso') EventHandler = FeatherMagneticLassoToolArea;
      else if (interactionMode === 'magic-wand') EventHandler = MagicWandToolArea;
      else if (interactionMode === 'rectangular-selection') EventHandler = RectangularSelectionToolArea;
      else if (interactionMode === 'elliptical-selection') EventHandler = EllipticalSelectionToolArea;
      else if (interactionMode === 'single-row-column-marquee') EventHandler = SingleRowColumnMarqueeToolArea;
      else if (interactionMode === 'quick-selection') EventHandler = QuickSelectionToolArea;
      else if (interactionMode === 'color-replacement') EventHandler = ColorReplacementToolArea;
      else if (interactionMode === 'eyedropper') EventHandler = EyedropperToolArea;
      else if (interactionMode === 'ruler') EventHandler = RulerToolArea;
      else if (interactionMode === 'color-sampler') EventHandler = ColorSamplerToolArea;
      else if (interactionMode === 'eraser') EventHandler = EraserToolArea;
      else if (interactionMode === 'smudge') EventHandler = SmudgeToolArea;
      else if (interactionMode === 'dodge') EventHandler = DodgeToolArea;
      else if (interactionMode === 'burn') EventHandler = BurnToolArea;
      else if (interactionMode === 'sponge') EventHandler = SpongeToolArea;
      else if (interactionMode === 'clone-stamp') EventHandler = CloneStampToolArea;
      else if (interactionMode === 'red-eye') EventHandler = RedEyeToolArea;
      else if (interactionMode === 'spot-healing') EventHandler = SpotHealingToolArea;
      else if (interactionMode === 'healing-brush') EventHandler = HealingBrushToolArea;
      else if (interactionMode === 'patch') EventHandler = PatchToolArea;
      else if (interactionMode === 'sharpen') EventHandler = SharpenToolArea;
      else if (interactionMode === 'fill') EventHandler = FillToolArea;
      else if (interactionMode === 'gradient') EventHandler = GradientToolArea;
      else EventHandler = DummyToolArea;
    }

    return (
      <div
        className={`absolute left-0 top-0 flex h-full w-full items-center justify-center ${theme === 'dark' ? 'chessboard-dark' : 'chessboard-light'}`}
        style={{ display: hasImage ? undefined : 'none' }}
      >
        <div
          className="zoom-container relative h-full w-full"
          style={{ transform: viewTransform }}
          onPointerDownCapture={touchNavigation.onPointerDownCapture}
          onPointerMoveCapture={touchNavigation.onPointerMoveCapture}
          onPointerUpCapture={touchNavigation.onPointerUpCapture}
          onPointerCancelCapture={touchNavigation.onPointerCancelCapture}
          onLostPointerCaptureCapture={touchNavigation.onLostPointerCaptureCapture}
        >
          <canvas
            ref={canvasRef}
            data-testid="workspace-canvas"
            className="h-full w-full object-contain pointer-events-none"
          />
        </div>
        <canvas
          ref={toolOverlayRef}
          data-testid="tool-overlay-canvas"
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            transform: viewTransform,
            // One entry per mode whose mounted area paints into `overlayCtxRef` — the
            // list is a LOOKUP KEY, not a summary of "tools with an area", so a mode that
            // paints and is missing here renders a blank preview with no error, and a
            // mode listed here that paints nothing just shows an already-clear canvas.
            // Painted: clone-stamp (the Alt source marker, CloneStampToolArea.tsx:249),
            // and the two selection tools (EllipticalSelectionToolArea.tsx:113,
            // QuickSelectionToolArea.tsx:120). NOT painted, and so deliberately absent:
            // eraser, smudge, dodge, burn, sharpen, paint-bucket, gradient and the
            // eyedropper — every one of them previews through `tempUpdateLayer`, which
            // republishes the layer and redraws the document canvas, and the eyedropper
            // paints neither context at all (EyedropperToolArea.tsx:12).
            display: [
              'draw',
              'crop',
              'text',
              'shape',
              'reposition',
              'lasso',
              'feather-magnetic-lasso',
              'magic-wand',
              'rectangular-selection',
              // The eraser is deliberately NOT here. It previews by mutating the active layer
              // through `tempUpdateLayer` (see `EraserToolArea`), because `destination-out` on
              // an empty transparent overlay computes `da' = 0` and can never draw a pixel. The
              // fill and the eyedropper also commit on the click itself and never draw a preview,
              // so keeping the overlay hidden for all three is what stops a stale overlay from an
              // earlier tool from sitting on top of the document.
              'elliptical-selection',
              'single-row-column-marquee',
              'quick-selection',
              'clone-stamp',
              // The Ruler paints its measuring line here and nowhere else: it commits no pixels, so
              // there is no layer to preview through `tempUpdateLayer`, and the line is chrome that
              // must survive on top of the document rather than be composited into it.
              'ruler',
              // The Color Sampler paints its markers here for the Ruler's reason: a sampler is
              // chrome over the document and never part of it, so there is no layer to preview
              // through `tempUpdateLayer` and the markers must sit on top of the canvas instead.
              'color-sampler',
              'spot-healing',
              'healing-brush',
              'patch',
            ].includes(interactionMode)
              ? 'block'
              : 'none',
          }}
        />
        <canvas
          ref={rectOverlayRef}
          data-testid="rect-overlay-canvas"
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            transform: viewTransform,
            display: ['reposition'].includes(interactionMode) ? 'block' : 'none',
          }}
        />
        {/*
          Last in the stack on purpose: the tool overlay and the rect overlay are
          addressed by index in `Main.toolAreas.test.tsx`, and the ants belong
          above both so a border is never half-covered by a draft outline.
        */}
        <canvas
          ref={selectionAntsOverlayRef}
          data-testid="selection-ants-canvas"
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            transform: viewTransform,
            display: showSelectionAnts ? 'block' : 'none',
          }}
        />
        <SelectionMarchingAnts overlayRef={selectionAntsOverlayRef} enabled={showSelectionAnts} />
        {(['hand', 'zoom', 'rotate-view'] as string[]).includes(interactionMode) ? (
          <ViewToolArea className="absolute inset-0 h-full w-full" mode={interactionMode as ViewToolMode} />
        ) : (
          // Keep browser touch-action suppression on this selected tool surface. The in-place
          // text editor is a sibling, so it does not inherit the canvas gesture policy.
          <EventHandler className="absolute inset-0 h-full w-full touch-none" overlayCtxRef={toolCtxRef} />
        )}
        {/*
         * LAST, by DOM order rather than by z-index: this app stacks nothing by z-index at all, so
         * the last child paints on top. Its full-size coordinate plane mirrors the canvas's view
         * transform; only the contenteditable child receives pointers, so clicks outside the type
         * box still reach `EventHandler`.
         *
         * Gated on the text mode for the same reason `EventHandler` gates the tool areas: the
         * editor reads `useCurrentTool`, and a hook that throws outside its provider takes the whole
         * canvas region down with it through the `Canvas` ErrorBoundary. Measuring the workspace
         * fit for every one of the twenty-odd tools would also be work no tool but this one needs.
         * See `TextEditOverlay.tsx`.
         */}
        {interactionMode === 'text' && (
          <div
            data-testid="text-edit-view-transform"
            className="pointer-events-none absolute inset-0"
            style={{ transform: viewTransform, transformOrigin: 'center center' }}
          >
            <TextEditOverlay />
          </div>
        )}
      </div>
    );
  };

  return (
    <main
      ref={containerRef}
      // The element `usePointerPosition` measures the contain fit against, and the element
      // it publishes that fit on as `data-fit-*` (see `FIT_ATTRIBUTES`). The test id is what
      // lets the e2e suite name that element instead of selecting a bare `main` tag and
      // trusting that it is the one the fit was computed from.
      data-testid="workspace-container"
      data-view-pan-x={String((viewState ?? DEFAULT_VIEW_STATE).panX)}
      data-view-pan-y={String((viewState ?? DEFAULT_VIEW_STATE).panY)}
      data-view-zoom={String((viewState ?? DEFAULT_VIEW_STATE).zoom)}
      data-view-effective-zoom={String(effectiveViewZoom(viewState ?? DEFAULT_VIEW_STATE))}
      data-view-rotation={String((viewState ?? DEFAULT_VIEW_STATE).rotation)}
      className={`relative overflow-y-auto [grid-area:main] mobile-safe-bottom ${
        isDragging
          ? 'bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-blue-500'
          : 'bg-white dark:bg-[#1a1a1a]'
      } ${hasImage ? '' : 'flex items-center justify-center'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {renderContent()}
      {!hasImage &&
        (isCheckingAutosave ? (
          <div
            className="flex h-full w-full items-center justify-center text-sm text-gray-500 dark:text-gray-400"
            role="status"
          >
            Loading your workspace…
          </div>
        ) : (
          <section
            aria-labelledby="start-page-title"
            className="mx-auto flex min-h-full w-full max-w-5xl flex-col justify-center gap-8 px-6 py-10"
            data-testid="start-page"
          >
            <div>
              <p className="mb-2 text-sm font-medium uppercase tracking-[0.16em] text-blue-600 dark:text-blue-400">
                Photo
              </p>
              <h1
                className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100"
                id="start-page-title"
              >
                Create a new image
              </h1>
              <p className="mt-2 max-w-xl text-sm text-gray-600 dark:text-gray-300">
                Choose a canvas size to start with, set your own dimensions, or open an image from your device.
              </p>
            </div>

            <div aria-label="Canvas size presets" className="grid grid-cols-3 gap-4" role="group">
              {START_IMAGE_PRESETS.map(({ id, label, width, height }) => (
                <button
                  className="flex min-h-44 min-w-0 flex-col items-start rounded-lg border border-gray-300 bg-white p-4 text-left shadow-sm transition hover:border-blue-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-400"
                  data-testid={`main-preset-${id}-button`}
                  key={id}
                  onClick={() =>
                    setBlankImage({
                      color: '#ffffff',
                      opacity: 1,
                      size: { width, height },
                      isBedrock: true,
                    })
                  }
                  type="button"
                >
                  <span className="mb-4 flex h-16 w-full items-center justify-center" aria-hidden="true">
                    <span
                      className="block rounded-sm border border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-950"
                      style={{ aspectRatio: `${width} / ${height}`, maxHeight: '4rem', maxWidth: '8rem', width: '80%' }}
                    />
                  </span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{label}</span>
                  <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {width} × {height} px
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className={PRIMARY_BUTTON_LARGE}
                data-testid="main-blank-image-button"
                onClick={async () => {
                  try {
                    const data = await openNewImageDialog();
                    if (data) setBlankImage(data);
                  } catch (error) {
                    console.error('Failed to create document:', error);
                  }
                }}
                type="button"
              >
                Custom size…
              </button>
              <button
                className="rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                data-testid="main-open-file-button"
                onClick={async () => {
                  try {
                    const data = await openLoadImageDialog();
                    if (data) await setImageFromUpload(data);
                  } catch (error) {
                    console.error('Failed to open file:', error);
                  }
                }}
                type="button"
              >
                Open image
              </button>
            </div>
          </section>
        ))}
    </main>
  );
};

export default Main;
