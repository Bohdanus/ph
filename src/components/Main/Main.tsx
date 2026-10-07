import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { PRIMARY_BUTTON_LARGE, TEXT_LINK_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { loadDocumentFile } from '../../contexts/image-load-save-utils.ts';
import { MoveToolArea } from './MoveToolArea.tsx';
import { SelectionMarchingAnts } from './SelectionMarchingAnts.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext.tsx';
import { resizeCanvas } from '../../util/canvas.ts';
import { DEFAULT_VIEW_STATE } from '../../contexts/view-state.ts';

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
      totalSize,
      documentFrame,
      viewState,
    },
  ] = useStore();
  const { theme } = useTheme();
  const { setBlankImage, setImageFromUpload } = useApp();
  const { openLoadImageDialog, openNewImageDialog } = useFile();
  const { confirmDiscard } = useUnsavedChanges();
  const { drawAllLayers } = useLayers();

  const [isDragging, setIsDragging] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !hasImage || toolName === 'text') return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    const handleBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
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

  if (spacePressed && toolName !== 'text' && hasImage) interactionMode = 'hand';

  // One read, because the canvas's `display` and the loop's `enabled` gate the same question and
  // have to answer it identically: the canvas is the ants' only output, so a `display: none`
  // beside a running loop would run 60 frames a second into a canvas nobody can see.
  const selectionToolActive = SELECTION_INTERACTION_MODES.has(interactionMode);

  useEffect(() => {
    drawAllLayers();
  }, [documentFrame, drawAllLayers, layers]);

  useLayoutEffect(() => {
    const { width, height } = totalSize;
    if (toolOverlayRef.current) {
      resizeCanvas(toolOverlayRef.current, width, height);

      // `getContext('2d')` returns null when the canvas has no 2D context, and the
      // `!` here used to turn that into a TypeError on the next line. It threw inside
      // this layout effect, so it escaped render and landed in the `Canvas`
      // ErrorBoundary: the whole canvas region became the fallback, the layer stack
      // and the tool rail stopped responding, and nothing retried.
      //
      // Nothing downstream needs it not to be null. `toolCtxRef` is declared
      // `CanvasRenderingContext2D | null`, it is handed to the tool areas as
      // `overlayCtxRef: RefObject<CanvasRenderingContext2D | null>`, and they all
      // already handle the null case — `DrawToolArea.tsx:81` returns early and
      // `DrawToolArea.tsx:146` optional-chains. So publishing the null is the
      // contract; throwing on it was the bug.
      //
      // `e2e/error-boundary.spec.ts` reaches this line deliberately by making
      // `getContext('2d')` return null, so the fallback's behaviour stays pinned
      // while this line stops feeding it.
      const toolCtx = toolOverlayRef.current.getContext('2d');
      toolCtxRef.current = toolCtx;
      if (toolCtx) {
        toolCtx.imageSmoothingEnabled = true;
        toolCtx.imageSmoothingQuality = 'low';
      }
    }

    if (rectOverlayRef.current) {
      resizeCanvas(rectOverlayRef.current, width, height);
      // Same null-tolerance as the tool overlay above, and the same reason.
      const rectCtx = rectOverlayRef.current.getContext('2d');
      if (rectCtx) {
        rectCtx.imageSmoothingEnabled = false;
      }
    }
    if (selectionAntsOverlayRef.current) {
      resizeCanvas(selectionAntsOverlayRef.current, width, height);
    }
  }, [rectOverlayRef, toolOverlayRef, totalSize]);

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
    const viewTransform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom}) rotate(${view.rotation}deg)`;
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
      | typeof SpotHealingToolArea;

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
        <div className="zoom-container relative h-full w-full" style={{ transform: viewTransform }}>
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
            display: selectionToolActive ? 'block' : 'none',
          }}
        />
        <SelectionMarchingAnts overlayRef={selectionAntsOverlayRef} enabled={selectionToolActive} />
        {(['hand', 'zoom', 'rotate-view'] as string[]).includes(interactionMode) ? (
          <ViewToolArea className="absolute inset-0 h-full w-full" mode={interactionMode as ViewToolMode} />
        ) : (
          <EventHandler className="absolute inset-0 h-full w-full" overlayCtxRef={toolCtxRef} />
        )}
        {/*
         * LAST, by DOM order rather than by z-index: this app stacks nothing by z-index at all, so
         * the last child paints on top. The in-place editor has to receive the pointer, because
         * placing a caret is a click INSIDE the box — which is the `absolute inset-0` tool area's
         * territory — so it cannot sit below `EventHandler`. It covers exactly the type box and
         * nothing else, so every canvas gesture outside it still reaches the tool area.
         *
         * Gated on the text mode for the same reason `EventHandler` gates the tool areas: the
         * editor reads `useCurrentTool`, and a hook that throws outside its provider takes the whole
         * canvas region down with it through the `Canvas` ErrorBoundary. Measuring the workspace
         * fit for every one of the twenty-odd tools would also be work no tool but this one needs.
         * See `TextEditOverlay.tsx`.
         */}
        {interactionMode === 'text' && <TextEditOverlay />}
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
      {!hasImage && (
        <div className="flex flex-col items-center gap-4">
          <button
            className={PRIMARY_BUTTON_LARGE}
            onClick={async () => {
              try {
                const data = await openLoadImageDialog();
                if (data) await setImageFromUpload(data);
              } catch (error) {
                console.error('Failed to open file:', error);
              }
            }}
            data-testid="main-open-file-button"
          >
            Open File
          </button>
          <button
            className={`${TEXT_LINK_BUTTON} focus:outline-none`}
            onClick={async () => {
              try {
                const data = await openNewImageDialog();
                if (data) setBlankImage(data);
              } catch (error) {
                console.error('Failed to create document:', error);
              }
            }}
            data-testid="main-blank-image-button"
          >
            blank image
          </button>
        </div>
      )}
    </main>
  );
};

export default Main;
