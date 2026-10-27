import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CropToolArea } from './CropToolArea.tsx';
import { DrawToolArea } from './DrawToolArea.tsx';
import { TextToolArea } from './TextToolArea.tsx';
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
import { HandToolArea } from './HandToolArea.tsx';
import { RotateViewToolArea } from './RotateViewToolArea.tsx';
import { EraserToolArea } from './EraserToolArea.tsx';
import { CloneStampToolArea } from './CloneStampToolArea.tsx';
import { SharpenToolArea } from './SharpenToolArea.tsx';
import { SmudgeToolArea } from './SmudgeToolArea.tsx';
import { DodgeToolArea } from './DodgeToolArea.tsx';
import { BurnToolArea } from './BurnToolArea.tsx';
import { SpongeToolArea } from './SpongeToolArea.tsx';
import { GradientToolArea } from './GradientToolArea.tsx';
import { FillToolArea } from './FillToolArea.tsx';
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
import { resetView, stepZoomAt, panBy } from '../../hooks/document-view.ts';
import { isSpaceHeld, useSpaceHeld } from '../../hooks/useTemporaryHand.ts';
import { useViewTransform } from '../../hooks/useViewTransform.ts';

/**
 * The mode a tool falls through to when nothing above claims it, and the one that mounts
 * `DummyToolArea`.
 *
 * NAMED, and previously spelled `'zoom'`. That string read like a feature and was not one: no
 * branch in the chain below ever assigned it, so it was the value every unrecognised tool
 * landed on — a hidden no-op area wearing the name of the one tool the rail used to have a tile
 * for. `HANDOFF.md` §151 named it as one of the two cheap sub-items of the view work.
 *
 * Renaming it is the whole of the fix. It deliberately still routes to `DummyToolArea` rather
 * than to the Hand: the tools that reach it have no gesture surface by design — `custom-shape`
 * is a placeholder panel, `transform` is a one-shot operation the canvas route drives, the pen
 * family drives its own paths — and giving them a pan surface would be inventing behaviour
 * nobody asked for. `Main.toolAreas.test.tsx` pins that allow-list, and its comment is the
 * reason this stayed a no-op rather than becoming one.
 */
const UNHANDLED_TOOL_MODE = 'unhandled-tool';

// The tools that commit a polygon selection, and so the only modes with a border
// to march. The rectangular selection tool is absent on purpose: `useRect` strokes
// its own rect, with handles, and marching it as well would double the outline.
const POLYGON_SELECTION_MODES: string[] = ['lasso', 'feather-magnetic-lasso', 'magic-wand'];

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
      documentId,
    },
  ] = useStore();
  const { theme } = useTheme();
  const { setBlankImage, setImageFromUpload } = useApp();
  const { openLoadImageDialog, openNewImageDialog } = useFile();
  const { confirmDiscard } = useUnsavedChanges();
  const { drawAllLayers } = useLayers();

  const [isDragging, setIsDragging] = useState(false);

  const toolCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const selectionAntsOverlayRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * The transformed element. Separate from `containerRef`, which the store owns and which the
   * tool areas measure: the view transform belongs to `Main` because `Main` is what renders
   * `.zoom-container`, and `useViewTransform` writes to the node imperatively rather than
   * through a style prop so that a pan does not re-render this subtree sixty times a second.
   */
  const zoomContainerRef = useRef<HTMLDivElement | null>(null);

  useViewTransform(zoomContainerRef);

  /**
   * The spring-loaded Hand, subscribed for its RENDER and not for its value.
   *
   * Called with no assignment on purpose. `Main` has to re-render when `Space` arms so that the
   * routing below mounts `HandToolArea` and the canvas cursor changes with it; the boolean this
   * returns would be the same answer the synchronous read gives, one commit later. Keeping the
   * two apart is what lets the pointer path read `isSpaceHeld()` and be correct on the same tick
   * as the keypress.
   */
  useSpaceHeld();

  /**
   * Drop the view when the document identity changes.
   *
   * On `documentId` rather than on `totalSize`, which is the distinction that matters: `Canvas
   * Size` changes `totalSize` without changing the document, and a user who has zoomed in to
   * retouch should keep that view across a canvas resize. `fitScale` belongs to the OLD
   * document's dimensions, so carrying a zoom multiplier across an Open or New would open the
   * next document at an arbitrary magnification of the last one's fit.
   */
  useEffect(() => {
    resetView();
  }, [documentId]);

  /**
   * Wheel: zoom at the pointer, pan otherwise.
   *
   * ATTACHED DIRECTLY RATHER THAN THROUGH `onWheel`, and that is the whole point of the
   * `{ passive: false }` third argument. React registers `wheel` as passive on its root, so a
   * React `onWheel` cannot `preventDefault()` — the call is a no-op and logs a warning, and the
   * e2e suite's `consolePolice` fixture fails a test on an unaccepted console error. Without the
   * `preventDefault` the browser zooms the PAGE on a `Ctrl`/`Cmd` wheel, which is the one
   * behaviour here that is not ours to choose. The same shape as the `pointercancel` listener
   * `usePointerPosition` installs.
   *
   * `overscroll-behavior: none` on `.zoom-container` is already suppressing scroll-chaining; it
   * does not stop the browser's own zoom shortcut, which is why this handler exists.
   */
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleWheel = (event: WheelEvent) => {
      if (!hasImage) return;

      event.preventDefault();

      // Anchor the zoom at the pointer so the pixel under the cursor stays under the cursor,
      // which is what makes a wheel zoom read as moving a window rather than jumping.
      const rect = node.getBoundingClientRect();

      if (event.ctrlKey || event.metaKey) {
        stepZoomAt({ x: event.clientX, y: event.clientY }, rect, event.deltaY < 0 ? 1 : -1);
        return;
      }

      // A trackpad's two-finger scroll arrives as a wheel event with no modifier, and it is the
      // gesture most people reach for. `shiftKey` is the browser's own horizontal-scroll
      // convention and Adobe's too, so a Shift+wheel pans sideways and a plain one pans down.
      panBy(event.shiftKey ? -event.deltaY : 0, event.shiftKey ? 0 : -event.deltaY);
    };

    node.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      node.removeEventListener('wheel', handleWheel);
    };
  }, [containerRef, hasImage]);

  let interactionMode = UNHANDLED_TOOL_MODE;
  if (toolName === 'rotate-view') {
    // Checked BEFORE the Hand, not after, and the ordering is not a preference. Both tools share
    // one rail tile, and the spring-loaded Spacebar below routes to the Hand when it is held — so
    // a toolName check placed after the `isSpaceHeld()` arm could be pre-empted by a held Space
    // bar, which would mean Space silently switches a selected Rotate View back to the Hand. The
    // `toolName === 'hand'` arm keeps its own precedence for the same reason.
    interactionMode = 'rotate-view';
  } else if (toolName === 'hand') {
    interactionMode = 'hand';
  } else if (isSpaceHeld()) {
    // SPRING-LOADED, and deliberately not `goToTool`. Adobe's page: "press and hold the
    // spacebar key to temporarily switch to the Hand tool" — temporary means the selected tool
    // is untouched and comes back on release, so the rail's pressed tile must not move.
    //
    // Checked AFTER `toolName === 'hand'` so that holding Space while the Hand is already
    // selected is a no-op rather than a second source of truth competing with the first.
    interactionMode = 'hand';
  } else if (toolName === 'reposition') {
    interactionMode = 'reposition';
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
      | typeof HandToolArea
      | typeof RotateViewToolArea
      | typeof EraserToolArea
      | typeof SmudgeToolArea
      | typeof DodgeToolArea
      | typeof BurnToolArea
      | typeof SpongeToolArea
      | typeof CloneStampToolArea
      | typeof SharpenToolArea
      | typeof GradientToolArea
      | typeof FillToolArea
      | typeof ColorReplacementToolArea;

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
      else if (interactionMode === 'hand') EventHandler = HandToolArea;
      else if (interactionMode === 'rotate-view') EventHandler = RotateViewToolArea;
      else if (interactionMode === 'eraser') EventHandler = EraserToolArea;
      else if (interactionMode === 'smudge') EventHandler = SmudgeToolArea;
      else if (interactionMode === 'dodge') EventHandler = DodgeToolArea;
      else if (interactionMode === 'burn') EventHandler = BurnToolArea;
      else if (interactionMode === 'sponge') EventHandler = SpongeToolArea;
      else if (interactionMode === 'clone-stamp') EventHandler = CloneStampToolArea;
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
        <div className="zoom-container h-full w-full" ref={zoomContainerRef}>
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
            // One entry per mode whose mounted area paints into `overlayCtxRef` — the
            // list is a LOOKUP KEY, not a summary of "tools with an area", so a mode that
            // paints and is missing here renders a blank preview with no error, and a
            // mode listed here that paints nothing just shows an already-clear canvas.
            // Painted: clone-stamp (the Alt source marker, CloneStampToolArea.tsx:249),
            // and the two selection tools (EllipticalSelectionToolArea.tsx:107,
            // QuickSelectionToolArea.tsx:99). NOT painted, and so deliberately absent:
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
            display: POLYGON_SELECTION_MODES.includes(interactionMode) ? 'block' : 'none',
          }}
        />
        <SelectionMarchingAnts
          overlayRef={selectionAntsOverlayRef}
          enabled={POLYGON_SELECTION_MODES.includes(interactionMode)}
        />
        <EventHandler className="absolute inset-0 h-full w-full" overlayCtxRef={toolCtxRef} />
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
