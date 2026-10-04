import { type RefObject, useEffect, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  PLACEHOLDER_TEXT,
  POINT_TYPE_MAX_DRAG_PX,
  drawOverflowIndicator,
  layoutText,
  resolveTextKind,
  resolveTextStyle,
  textWrapWidth,
  type TextKind,
  type TextToolArgs,
} from '../../tools/text.ts';
import { useRect } from '../../hooks/useRect.ts';
import { calculateNewRect } from '../../util/rect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import type { Ctx2D, RectXY, RectXYSorted } from '../../contexts/general-types.ts';

type TextToolAreaProps = {
  className?: string;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

export const TextToolArea = ({ className, overlayCtxRef }: TextToolAreaProps) => {
  const [{ containerRef, toolOverlayRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const { commitDirtyTool } = useLayers();

  const args = toolArgs as TextToolArgs;
  const argsRef = useRef(args);
  useEffect(() => {
    argsRef.current = args;
  }, [args]);

  // The press and the release in CLIENT pixels, which is the space `POINT_TYPE_MAX_DRAG_PX` is
  // defined in — CSS px, unscaled by the contain fit. `useRect` reports document px, which
  // `getLocalCoords` has already divided by that fit, so a threshold compared against a rect's
  // extent in document px was in the wrong units by the fit scale: the same 3 travelled 2.92 screen
  // px on an 800x600 document and 0.58 screen px on a 4000x3000 one, where a single pixel of
  // pointer jitter placed paragraph type.
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const releaseRef = useRef<{ x: number; y: number } | null>(null);

  const { rectHandles, pointerHandlers, pointerState } = useRect({
    imageSize: totalSize,
    initialRect: args.rect,
    containerRef,
    overlayRef: toolOverlayRef,
    /**
     * `hideBlend`, and it is the difference between a text box and a crop frame.
     *
     * `drawMask` lays `rgba(0, 0, 0, 0.7)` over the whole document and then cuts the frame out of
     * it — that dim is the crop tool's "everything outside the crop is not part of the result", and
     * it is the DEFAULT because most of `useRect`'s consumers are crop-shaped. Left on for the Type
     * tool it dims every committed layer to 30% for as long as a draft is open, which was nearly
     * invisible while a draft began EMPTY and only fired once the user had typed into the options
     * bar; seeding the placeholder made it fire on the very click that places the box.
     *
     * MEASURED, headless Chromium: a committed red glyph reads `maxRed` 76 with a draft open and
     * 255 with none. 255 × (1 − 0.7) = 76.5, which is the arithmetic of that fill and nothing else.
     */
    hideBlend: true,
    onRepaint: redrawDraftChrome,
    onChangeEnd: (rect: RectXYSorted) => {
      // Whether this press PLACED a box or merely acted on one that was already there. A press that
      // began inside an existing draft, or on one of its handles, is a move or a resize — and it must
      // not change what kind of box the draft is. Only `useRect` can answer it, because only
      // `useRect` ran `getEdgeAtPoint`.
      const placing = pointerState.currentEdgeRef.current === null;

      // Adobe distinguishes the two gestures by intent and documents no threshold, no minimum box
      // size and nothing about which way a box grows, so this is the app's own: a press that
      // travelled no more than `POINT_TYPE_MAX_DRAG_PX` on either axis is a click and places point
      // type, and anything further is a drag and places paragraph type.
      //
      // The travel is the POINTER'S, not the box's extent. It used to be the extent, and that was
      // wrong in a way no threshold fixes: a press on an existing draft handed back that draft, so a
      // box holding any text always measured greater than the threshold and was silently
      // RECLASSIFIED — a point draft turned into a paragraph one on the first click inside it, and
      // `calculateNewRect` then re-wrapped the text at the new width inside an unchanged frame.
      const press = pressRef.current;
      const release = releaseRef.current;
      const travelled = press && release ? Math.max(Math.abs(release.x - press.x), Math.abs(release.y - press.y)) : 0;

      const kind: TextKind = placing
        ? travelled <= POINT_TYPE_MAX_DRAG_PX
          ? 'point'
          : 'paragraph'
        : resolveTextKind(args);
      // The click's rect is collapsed onto the press point, which is what `adjustFreePoint` already
      // produces for a press with no movement, so the point-type box is grown from the click by the
      // same code path that always grew it. A press that was NOT a placement passes its rect
      // through untouched: collapsing it would throw away the move or the resize.
      const placed: RectXYSorted =
        kind === 'point' && placing ? { ...rect, x1: rect.x1, x2: rect.x1, y1: rect.y1, y2: rect.y1 } : rect;

      /**
       * A placement while a draft is already open COMMITS that draft, and only then places the new
       * one. It did not commit, it did not prompt, and it did not merge: a second click on the
       * canvas silently overwrote `args` with a fresh box and the typed text was gone, with no
       * history entry, because a draft is not yet a layer and nothing had recorded it.
       *
       * The order is the whole thing. `commitDirtyTool` creates the layer and clears `text`/`rect` by
       * writing the tool args back, so publishing the new placement first would commit the NEW box
       * with the OLD text — a text layer, at the second click's coordinates, holding the first
       * click's words.
       *
       * **`flushSync` around the commit, and it is load-bearing.** Without it both writes land in one
       * batched render, `hasPendingText` never goes false, and the in-place editor is never
       * unmounted between the two drafts — so `TextEditOverlay`'s entry effect, whose whole trigger
       * is that its element's text no longer matches the model, has nothing to fire on when the
       * first draft was still holding the untouched placeholder. MEASURED, headless Chromium: place,
       * do not type, click elsewhere, type — the second box came up unfocused and unselected and
       * swallowed every keystroke. Synchronously rendering the commit in between unmounts the editor,
       * so the next draft is a genuinely new element and cannot inherit a stale selection.
       *
       * Adobe commits on far less: "select any tool in the toolbox; click in the Layers, Channels,
       * Paths, Actions, History, or Styles panel; or select any available menu command"
       * (https://helpx.adobe.com/photoshop/using/creating-type.html).
       */
      if (placing && args.text && args.rect) flushSync(() => commitDirtyTool());

      // Adobe's placeholder, born with the box rather than typed into it: "A layer is created
      // immediately, containing placeholder text that previews font, size and colour, and that is
      // pre-selected so typing replaces it". The SELECTION is the overlay's half
      // (`TextEditOverlay` — `selectAllIn` on entry); this is the text half, and the two are one
      // behaviour split across the gesture that places the box and the element that receives keys.
      //
      // **Only a PLACEMENT seeds it, and the alternative is a data-loss bug.** A press inside an
      // existing draft is a move or a resize of a box the user is typing into, and seeding there
      // published 'Lorem ipsum' over the text and threw away everything typed into the layer — the
      // same shape of loss this commit removes for the second-click case, reached by the opposite
      // gesture.
      const seeded: TextToolArgs = {
        ...args,
        text: placing ? PLACEHOLDER_TEXT : args.text,
        placeholderUntouched: placing ? true : args.placeholderUntouched,
      };

      /**
       * A paragraph box is at least one pixel wide, whatever the drag.
       *
       * Dragging straight DOWN classifies as paragraph (one axis over the threshold is enough) and
       * arrives with a zero-width rect, and the paragraph arm keeps the width it was handed rather
       * than growing it. `createLayerSource` then throws "Layer width and height must be greater
       * than 0" — from the Commit button, from Escape, and from `goToTool`, which means the tool
       * switch itself throws before dispatching, so the app is stuck on the Type tool with every
       * later switch throwing too. Only Cancel escapes. None of that is new, but the placeholder made
       * a zero-width box trivially reachable: a click used to produce an EMPTY point box that grew,
       * and a click cannot be both zero-width and paragraph.
       */
      const widthable = kind === 'paragraph' && placed.x2 - placed.x1 < 1 ? { ...placed, x2: placed.x1 + 1 } : placed;

      const newRect = calculateNewRect({ ...seeded, rect: widthable, kind }, toolOverlayRef, totalSize);
      if (!newRect) return;

      setToolArgs({ ...seeded, rect: newRect, kind });
    },
  });
  const redrawRect = rectHandles.redraw;

  // The two pointer positions the classification needs, captured around `useRect`'s own handlers.
  // `onChangeEnd` is called synchronously from inside `handlePointerUp`, so the release is recorded
  // before it is read.
  const trackedPointerHandlers = useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
        pressRef.current = { x: event.clientX, y: event.clientY };
        pointerHandlers.onPointerDown(event);
      },
      onPointerMove: pointerHandlers.onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
        releaseRef.current = { x: event.clientX, y: event.clientY };
        pointerHandlers.onPointerUp(event);
      },
    }),
    [pointerHandlers]
  );

  /**
   * Repaint the boundary whenever the box moves, which is on every keystroke.
   *
   * `useRect` strokes the box from its own pointer handlers, and the box is recomputed from the
   * text on every keystroke — point type grows and shrinks with its content — so the boundary would
   * otherwise stay at the size the click gave it while the DOM ink inside it moved. The DOM overlay
   * positions itself from the same rect, and the two have to move together or the ink leaves the box.
   */
  useEffect(() => {
    if (args.text && args.rect) redrawRect();
  }, [args.rect, args.text, redrawRect]);

  /**
   * Repaint the draft's BOX, and nothing else.
   *
   * `useRect`'s `drawMask` has already cleared the overlay and stroked the boundary by the time it
   * calls `onRepaint`, so this used to add the type on top of it — and it must not any more. The
   * ink now belongs to `TextEditOverlay`, a transparent DOM element over the same box, and two
   * renderers of one string in one place is either exact or visibly doubled; the overlay's
   * background is transparent precisely so the ink below shows through, which is another way of
   * saying the canvas ink would be visible under the DOM ink.
   *
   * The overflow indicator is the exception and stays: it is box CHROME, not type. Adobe draws "a
   * small box or circle containing a plus symbol (+) appears in place of a handle in the corner of
   * the boundary" (https://helpx.adobe.com/photoshop/using/creating-type.html), and it belongs to
   * the boundary, which is the one thing on this canvas.
   *
   * `layoutText` is asked the overflow question rather than `renderText`, because `renderText` now
   * draws ink this method must not draw — and asking it would draw that ink on the way to the
   * answer.
   */
  function redrawDraftChrome(rect: RectXY) {
    const currentArgs = argsRef.current;
    const text = currentArgs.text;
    if (!text) return;

    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    const style = resolveTextStyle(currentArgs);
    const wrapWidth = resolveTextKind(currentArgs) === 'paragraph' ? textWrapWidth(rect as RectXYSorted) : Infinity;
    const { overflow } = layoutText(ctx as Ctx2D, style, text, wrapWidth, rect.y2 - rect.y1);
    if (overflow) drawOverflowIndicator(ctx as Ctx2D, rect as RectXYSorted, style.color);
  }

  return <div className={`${className} cursor-text`} {...trackedPointerHandlers} />;
};
