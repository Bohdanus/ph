import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { processorPresentationBounds } from '../../contexts/presentation-evaluator.ts';
import { documentPointToLayerLocal, documentPointsToLayerLocal } from '../../util/layer-space.ts';
import { canvasToDocumentPoint, documentFrameFromSize, documentToCanvasPoint } from '../../contexts/document-frame.ts';
import type { DocumentFrame } from '../../contexts/document-frame.ts';
import type { Point } from '../../contexts/general-types.ts';
import type { CloneStampToolArgs } from '../../tools/cloneStamp.ts';
import { getActiveSelection, getSelectionAbsolutePoints } from '../../util/selection.ts';

type cloneStampToolAreaProps = {
  className?: string;
  /**
   * Accepted for the mount contract and deliberately not read. The Clone Stamp edits the
   * active layer's own raster through `tempUpdateLayer` / `updateLayerByTool`, which
   * republish the layer and redraw the document canvas themselves; painting into the
   * document canvas by hand is the un-undoable defect `usePaintStroke`'s JSDoc warns
   * about. `overlayCtxRef` IS read, but only for the Alt-key marker below, which is chrome
   * and not a layer edit.
   */
  /**
   * Optional: accepted so every tool area in the union can be rendered with one prop set, and
   * read from the store rather than the prop when it is needed. `Main` passes only
   * `overlayCtxRef`, so a required declaration here is a type error at the call site and a
   * `undefined` at runtime. `EllipticalSelectionToolArea` and `QuickSelectionToolArea` already
   * declare it this way.
   */
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  /** The sibling of `canvasCtxRef`, used only for the Alt-key marker. */
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/** Photoshop draws the Alt-click source as a ring; a hairline ring with a dark halo is the same feedback. */
const MARKER_RADIUS = 10;
const MARKER_HALO_COLOR = 'rgba(0, 0, 0, 0.85)';
const MARKER_COLOR = '#ffffff';
/** Half-length of each arm of the crosshair Photoshop draws under the cursor in clone mode. */
const CROSSHAIR_ARM = 6;
/** The halo stroke is this much wider than the hairline, so the hairline reads on any backdrop. */
const HALO_LINE_WIDTH = 3;
const HAIRLINE_WIDTH = 1;

type SourceMarker = {
  /** The Alt-clicked point, in DOCUMENT space, or `null` when none has been set. */
  source: Point | null;
  /** The pointer under Alt, in CANVAS space, or `null` when the pointer is off the surface. */
  hover: Point | null;
  /** Whether Alt is held. The marker is only feedback while it is. */
  visible: boolean;
  documentFrame: DocumentFrame;
};

/**
 * Repaint the Alt-click marker on the tool overlay: nothing at all unless Alt is held, then
 * a crosshair under the cursor and a ring at the source.
 *
 * Module-level rather than inline in the component for the same reason
 * `src/util/selection.ts`'s `drawSelectionAnchors` is: it is pure overlay painting, it needs
 * no state, and the react-compiler lint rule reads a property assignment on a prop-supplied
 * context as a mutation of the component's inputs. `MagicWandToolArea` and
 * `ShapeToolArea` sidestep it the same way — by calling a drawer.
 *
 * The overlay is shared, so this owns a FULL clear rather than its own bounding box: a
 * stale ring left behind is exactly the failure the marker exists to prevent, and the tool
 * area that drew it is about to be unmounted when the tool changes.
 */
const drawCloneSourceMarker = (
  ctx: CanvasRenderingContext2D,
  { source, hover, visible, documentFrame }: SourceMarker
) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!visible) return;

  ctx.save();
  ctx.lineCap = 'butt';

  // Every stroke is drawn twice, in a wide dark halo and then a hairline in white, because
  // a single-colour ring is invisible over half of any photograph.
  const strokeTwice = (path: () => void) => {
    ctx.strokeStyle = MARKER_HALO_COLOR;
    ctx.lineWidth = HALO_LINE_WIDTH;
    ctx.beginPath();
    path();
    ctx.stroke();

    ctx.strokeStyle = MARKER_COLOR;
    ctx.lineWidth = HAIRLINE_WIDTH;
    ctx.stroke();
  };

  if (hover) {
    strokeTwice(() => {
      ctx.moveTo(hover.x - CROSSHAIR_ARM, hover.y);
      ctx.lineTo(hover.x + CROSSHAIR_ARM, hover.y);
      ctx.moveTo(hover.x, hover.y - CROSSHAIR_ARM);
      ctx.lineTo(hover.x, hover.y + CROSSHAIR_ARM);
    });
  }

  if (source) {
    const center = documentToCanvasPoint(source, documentFrame);
    strokeTwice(() => {
      ctx.arc(center.x, center.y, MARKER_RADIUS, 0, Math.PI * 2);
    });
  }

  ctx.restore();
};

/**
 * The Clone Stamp's gesture surface: Alt-click picks the source, a drag copies from it, and
 * every completed drag is one undoable edit of the ACTIVE LAYER.
 *
 * ## Two gestures, mutually exclusive
 *
 * Photoshop's Clone Stamp has two pointer gestures, and this component implements them as
 * two NON-OVERLAPPING handlers rather than teaching one handler about modifiers:
 *
 * 1. **Alt-click** (Option-click on macOS) sets `source` and paints nothing. It is handled
 *    here, because `usePaintStroke` has no modifier awareness at all — its `enabled` flag
 *    cannot express "this gesture is a different gesture".
 * 2. **A plain drag** clones, through `usePaintStroke`, unchanged.
 *
 * The switch is at pointer-DOWN only, which is what makes them exclusive: a drag that began
 * as a plain press keeps cloning even if the user releases Alt mid-stroke, and a press that
 * began with Alt down never starts a stroke for the Alt branch to have to cancel. That is
 * also Photoshop's own rule, and it is the only arrangement in which the Alt branch does not
 * have to reach into `usePaintStroke` and abort a gesture it never owned.
 *
 * ## Where the Alt state comes from
 *
 * `event.altKey` on the PointerEvent is the authority for the GESTURE: Pointer Events
 * carries the modifier state of the physical key at the moment the event was generated, for
 * `Alt` on Windows/Linux and `Option` on macOS alike, and it is the same field
 * `ShapeToolArea` reads for its from-centre modifier and `useRect` reads for its
 * aspect-ratio constraint. No `keydown` listener is needed to decide the gesture, which is
 * what keeps this from disagreeing with the browser about whether Alt was down.
 *
 * A `keydown`/`keyup` pair on `window` IS registered, and only for the MARKER, which has to
 * appear the instant Alt goes down, before any pointer has moved. That is the same
 * `window.addEventListener` + state shape `ShapeToolArea` uses for its Space-pan
 * state, with the addition of a `blur` listener: a `keyup` never arrives if the window loses
 * focus with Alt held, and a marker stuck on screen with no Alt down is worse than no marker.
 *
 * ## `source` is in DOCUMENT space, and REBASED on the way to the processor
 *
 * `patchToolArgs({ source: point })` stores the point exactly as `usePaintStroke` reports
 * strokes, i.e. after `canvasToDocumentPoint`. That is deliberate: the `source` field and the
 * `points` field then mean the same space, which is the only reason the offset arithmetic is
 * readable at all.
 *
 * The processor is then called with the LAYER's own bitmap in that layer's space
 * through `stageProcessorInput()`, so the frame the processor addresses is
 * layer-local [0, pos.width) x [0, pos.height) and carries no document origin. Every point
 * is therefore translated by `-activeLayer.pos` on the way into the processor — the same
 * rebase `buildArgs` in `GradientToolArea.tsx` does and for the same reason, and both now
 * go through `src/util/layer-space.ts` rather than each spelling the subtraction out.
 *
 * Rebasing `source` and `points` by the SAME translation is what makes it safe: the processor
 * only ever uses their DIFFERENCE (`cloneOffset` in `src/tools/cloneStamp.ts`), and a common
 * translation cancels inside a difference, so a layer at any origin clones by exactly the
 * offset a layer at the origin does. What the rebase buys is the edge — `clampPointToSize`
 * runs against the layer's own extents, so a read that hangs off the layer's right edge is
 * clamped to the layer's right edge rather than to the document's.
 *
 * ## The commit split is the whole file
 *
 * `tempUpdateLayer` is the only writer of `previewLayersRef`
 * through `tempUpdateLayer()`, so every move goes through it or `commitDirtyTool` takes
 * its `PUBLISH_RUNTIME_PRESENTATION` branch, writes no history item, and the pixels are
 * silently and permanently un-undoable. `updateLayerByTool()` is the undo boundary and
 * is reached exactly ONCE per gesture: `usePaintStroke` fires `onCommit` only on pointer-up,
 * so committing from `onMove` as well would put one `TOOL_ACTION` per pointer event on the
 * timeline.
 *
 * `points` arrives already converted to document space by the hook, and `onMove` gets the
 * LIVE accumulating array, which keeps growing after the callback returns. It is mapped into
 * a fresh array and consumed synchronously by the processor, so nothing here retains it;
 * `onCommit` gets a copy and may.
 *
 * ## No `onPreview`
 *
 * `usePaintStroke` offers `onPreview` for a tool that repaints the overlay from the
 * accumulated points. This tool does not, and must not: the live pixels come from
 * `tempUpdateLayer`, so a second overlay repaint of the same stroke would be a second,
 * un-undoable copy of the same edit. The overlay here carries chrome only — the Alt marker —
 * which is why the two live in different code paths and cannot be confused.
 */
export const CloneStampToolArea = ({ className, overlayCtxRef }: cloneStampToolAreaProps) => {
  const [
    { containerRef, activeLayerId, layers, totalSize, documentFrame: currentFrame, selections, activeSelectionId },
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { tempUpdateLayer, updateLayerByTool } = useLayers();
  const { toolArgs, patchToolArgs } = useCurrentTool();

  const args = toolArgs as CloneStampToolArgs;
  const activeLayer = activeLayerId ? layers[activeLayerId] : undefined;

  /**
   * Bedrock is the document's own backing image and is not addressable by a raster tool:
   * there is no layer to commit onto, so a stroke over it would have nowhere to go.
   * `SmudgeToolArea` reads the same flag for the same reason.
   *
   * `source` is the third gate and it is the tool's own: with no source there is nothing to
   * copy FROM, so every stroke would be a no-op. Refusing the gesture is better than
   * accepting one and committing a `TOOL_ACTION` entry for an edit that changed no pixels,
   * which would make undo appear to do nothing either.
   */
  const isEnabled = Boolean(activeLayerId && activeLayer && !activeLayer.isBedrock && args.source);

  /**
   * The canvas-space pointer position under Alt, tracked in a ref rather than state: it is
   * read on every pointer move, and a state write per move would re-render the whole tool
   * area per move to move a crosshair. Read by `redrawMarker` at call time, never retained
   * across renders.
   */
  const altHoverCanvasRef = useRef<Point | null>(null);
  const markerFrameRef = useRef<number | null>(null);
  const selectionSnapshotRef = useRef<
    | {
        points: Point[];
        featherRadius: number;
        antiAlias: boolean;
      }
    | undefined
  >(undefined);
  const [isAltDown, setIsAltDown] = useState(false);

  useEffect(() => {
    // `event.key` is the layout-independent name for the modifier itself; `altKey` is
    // checked too so a synthetic event carrying only the flag still lands. The `keyup` arm
    // is written as the negation of the `keydown` arm so an unrelated key press cannot
    // clear a held Alt.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || event.altKey) setIsAltDown(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) setIsAltDown(false);
    };
    const onBlur = () => setIsAltDown(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /**
   * `getLocalCoords` for the Alt branch, which cannot borrow `usePaintStroke`'s because the
   * hook does not expose it and reaching through the hook to get a conversion would be worse
   * than a second `usePointerPosition` on the same ref. Both instances compute the same
   * contain dimensions from the same `getBoundingClientRect`, so they cannot disagree, and
   * only the hook's instance ever captures a pointer — this one is destructured for
   * `getLocalCoords` alone, the same shape `MagicWandToolArea` uses.
   */
  const { getLocalCoords } = usePointerPosition({ ref: containerRef, imageSize: totalSize });

  const redrawMarker = useCallback(() => {
    markerFrameRef.current = null;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    drawCloneSourceMarker(ctx, {
      source: args.source,
      hover: altHoverCanvasRef.current,
      visible: isAltDown,
      documentFrame,
    });
  }, [args.source, documentFrame, isAltDown, overlayCtxRef]);

  const requestMarkerRedraw = useCallback(() => {
    if (markerFrameRef.current !== null) return;
    markerFrameRef.current = requestAnimationFrame(redrawMarker);
  }, [redrawMarker]);

  useEffect(() => {
    redrawMarker();
  }, [redrawMarker]);

  useEffect(() => {
    const ctx = overlayCtxRef.current;

    return () => {
      if (markerFrameRef.current !== null) {
        cancelAnimationFrame(markerFrameRef.current);
        markerFrameRef.current = null;
      }
      // Unmounting with the ring still on screen leaves it over whatever tool comes next.
      if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    };
  }, [overlayCtxRef]);

  /**
   * Layer-local args for the processor, from document-space inputs.
   *
   * The rebase is one translation applied to BOTH the source and the stroke, so the
   * `source - anchor` difference the processor works in is unchanged by it; what it fixes is
   * that the frame the processor addresses is the layer's own raster rather than the
   * document. `points` is mapped into a new array rather than mutated, because it is the
   * hook's LIVE array and history keeps whatever it is handed — `src/util/layer-space.ts`
   * states both spaces and the aliasing hazard in full.
   */
  const buildLayerArgs = (points: Point[]): CloneStampToolArgs | null => {
    const source = args.source;
    if (!source || !activeLayer) return null;

    // The presented raster's origin, not `pos`: a layer carrying a transform is handed a
    // buffer staged at its evaluated extent, and a rebase against `pos` would address a
    // point in that buffer the layer is not drawn at.
    const origin = processorPresentationBounds(activeLayer);

    return {
      ...args,
      source: documentPointToLayerLocal(source, origin),
      points: documentPointsToLayerLocal(points, origin),
      ...(selectionSnapshotRef.current
        ? {
            selection: {
              ...selectionSnapshotRef.current,
              points: documentPointsToLayerLocal(selectionSnapshotRef.current.points, origin),
            },
          }
        : {}),
    };
  };

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled },
    {
      onStart: () => {
        const activeSelection = getActiveSelection(selections ?? [], activeSelectionId ?? null);
        selectionSnapshotRef.current = activeSelection
          ? {
              points: getSelectionAbsolutePoints(activeSelection),
              featherRadius: activeSelection.metadata?.featherRadius ?? 0,
              antiAlias: activeSelection.metadata?.magneticLasso?.antiAlias ?? true,
            }
          : undefined;
      },
      onMove: (points) => {
        if (!activeLayerId) return;
        const layerArgs = buildLayerArgs(points);
        if (!layerArgs) return;

        // `points` is the live array and keeps growing after this returns. `tempUpdateLayer`
        // runs the processor synchronously over the fresh array built above, which is the
        // documented way to consume it, and nothing here retains it.
        tempUpdateLayer({ id: activeLayerId, toolArgs: layerArgs });
      },
      onCommit: async (points) => {
        if (!activeLayerId) return;
        const layerArgs = buildLayerArgs(points);
        if (!layerArgs) return;

        selectionSnapshotRef.current = undefined;

        // A fresh copy from the hook, so the history item this reaches does not alias a ref
        // the hook is about to reset.
        await updateLayerByTool({ id: activeLayerId, toolArgs: layerArgs });
      },
      onCancel: () => {
        selectionSnapshotRef.current = undefined;
      },
    }
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // `event.altKey` is the authority for the gesture. The state is the same modifier state
    // the marker tracks, and reading it too means a press the browser reported without the
    // flag still refuses to paint rather than cloning with a stale source.
    if (event.altKey || isAltDown) {
      // On macOS an Option-drag is a platform drag-and-drop of the selection; the Alt-click
      // must not start one.
      event.preventDefault();
      const local = getLocalCoords(event);
      altHoverCanvasRef.current = local;
      // The one write, in DOCUMENT space, matching exactly what `points` will be. The
      // canvas->document conversion is `canvasToDocumentPoint` — the same one
      // `usePaintStroke` applies to every stroke sample — and it is NOT duplicated here.
      patchToolArgs('clone-stamp', { source: canvasToDocumentPoint(local, documentFrame) });
      return;
    }

    onPointerDown(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isAltDown) {
      altHoverCanvasRef.current = getLocalCoords(event);
      requestMarkerRedraw();
    }

    // Delegates unconditionally: `usePaintStroke` gates on its own `isPointerMoveValid`,
    // which refuses a move with no captured pointer, so an Alt-hover never starts a gesture.
    onPointerMove(event);
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    altHoverCanvasRef.current = null;
    if (isAltDown) requestMarkerRedraw();
    onPointerLeave(event);
    selectionSnapshotRef.current = undefined;
  };

  return (
    <div
      className={`${className} ${isEnabled ? 'cursor-crosshair' : 'cursor-not-allowed'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={handlePointerLeave}
      style={{ userSelect: 'none' }}
    />
  );
};
