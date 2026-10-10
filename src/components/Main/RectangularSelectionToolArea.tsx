import { type PointerEvent, type RefObject, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useRect } from '../../hooks/useRect.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { claimDocumentGesture, releaseDocumentGesture } from '../../hooks/document-gesture.ts';
import { clearSelectionDragPreview } from '../../hooks/selection-drag-preview.ts';
import type { RectXYSorted } from '../../contexts/general-types.ts';
import {
  createCommittedRectangleSelection,
  getActiveRectangularSelection,
  getSelectionRect,
} from '../../util/selection.ts';
import { documentFrameFromSize, documentToCanvasPos } from '../../contexts/document-frame.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import type { RectangularSelectionToolArgs } from '../../tools/rectangularSelection.ts';

type rectangularSelectionToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

export const RectangularSelectionToolArea = ({ className }: rectangularSelectionToolAreaProps) => {
  const [
    { containerRef, toolOverlayRef, totalSize, documentFrame: currentFrame, selections, activeSelectionId },
    dispatch,
  ] = useStore();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { getToolArgs } = useCurrentTool();
  const args = getToolArgs('rectangular-selection') as RectangularSelectionToolArgs | null;
  const style = args?.style ?? 'normal';
  const fixedRatio = args?.fixedRatio ?? 1;
  const fixedWidth = args?.fixedWidth ?? 100;
  const fixedHeight = args?.fixedHeight ?? 100;
  const isEditingCommittedSelectionRef = useRef(false);
  /**
   * The pointer id this component's own claim was taken with, so the release
   * can prove it owns the claim. `onChangeEnd` receives only the rect, so the id
   * cannot be recovered there; the ref is what lets every release route name the
   * claim it is releasing.
   */
  const claimedPointerIdRef = useRef<number | null>(null);
  const { commitSelection } = useSelectionHistory();

  function getPointerId(event: PointerEvent<HTMLDivElement>): number | null {
    return typeof event.pointerId === 'number' ? event.pointerId : null;
  }

  /**
   * Give up this component's claim, and only this one.
   *
   * `releaseDocumentGesture` ignores a release that names no open claim, a
   * different kind or a different pointer, so every abort route can call this
   * unconditionally — including the unmount cleanup, which is what bounds a
   * leaked claim to the mount that leaked it.
   */
  function releaseDocumentClaim() {
    releaseDocumentGesture('rectangular-selection', claimedPointerIdRef.current);
    claimedPointerIdRef.current = null;
  }

  const activeRectangleSelection = getActiveRectangularSelection(selections, activeSelectionId);
  const activeRectangleRect = useMemo(
    () =>
      activeRectangleSelection
        ? getSelectionRect({
            ...activeRectangleSelection,
            pos: documentToCanvasPos(activeRectangleSelection.pos, documentFrame),
          })
        : null,
    [activeRectangleSelection, documentFrame]
  );

  const { pointerHandlers, pointerState } = useRect({
    imageSize: totalSize,
    initialRect: activeRectangleRect,
    aspectRatio: style === 'fixed-ratio' ? fixedRatio : null,
    fixedSize: style === 'fixed-size' ? { width: fixedWidth, height: fixedHeight } : null,
    containerRef,
    overlayRef: toolOverlayRef,
    // Adobe's marquee modifiers. They are asked for here rather than defaulted on in the hook
    // because `useRect` is shared with crop and the Move tool, and neither of them constrains a
    // drag. Shift squares the marquee, Alt grows it from the press point, and both at once is a
    // square centred on it.
    constrainToSquare: true,
    fromCentre: true,
    // The ants are this selection's border (`Main.tsx:63`), so `useRect`'s own stroke is the same
    // rectangle one canvas below it. It is kept for the drag only, and the hook is the only thing
    // that knows when the drag starts and ends, so it is also the only thing that can tell the ants
    // loop to stand down for it — hence one prop rather than two separate wirings that could
    // disagree about the same gesture.
    borderMode: 'while-dragging',
    onChangeEnd: (rect: RectXYSorted) => {
      // FIRST, before anything can return. `onChangeEnd` is the single function
      // whose body covers BOTH exits — the early return below and the commit at
      // the end — so releasing here rather than at the commit statement is what
      // keeps a zero-size drag, whose `createCommittedRectangleSelection` returns
      // null, from leaving the claim set forever and the keyboard dead.
      releaseDocumentClaim();

      const existingSelection = isEditingCommittedSelectionRef.current ? activeRectangleSelection : null;
      const metadata = existingSelection
        ? {
            ...existingSelection.metadata,
            movedAtVersion: (existingSelection.metadata?.movedAtVersion ?? 0) + 1,
          }
        : undefined;
      const localSelection = createCommittedRectangleSelection({
        id: existingSelection?.id ?? uuidv4(),
        rect,
        imageSize: totalSize,
        metadata,
      });

      isEditingCommittedSelectionRef.current = false;

      if (!localSelection) {
        dispatch({ type: 'CANCEL_SELECTION_DRAFT' });
        return;
      }

      const selection = {
        ...localSelection,
        pos: {
          ...localSelection.pos,
          x: localSelection.pos.x + documentFrame.x,
          y: localSelection.pos.y + documentFrame.y,
        },
      };
      // `onChangeEnd` is the gesture's real end: `useRect` calls it from its
      // pointer-up handler, after the RAF-throttled drag has finished
      // (`useRect.ts:392`). No `onChange`/`onRepaint` is wired up, so every
      // intermediate pointer move stayed a canvas overlay draw and dispatched
      // nothing — the store was untouched until this line. That is what makes one
      // call per completed gesture the whole story for a rectangle drag, and the
      // load-bearing reason this cannot be moved up into the move handler.
      commitSelection(selection, existingSelection ? 'move' : 'create');
    },
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Whether this press will start a gesture at all, read BEFORE the delegation.
    // `useRect` refuses a non-primary button and a second pointer, and a press it
    // refused starts nothing, so the claim is taken under the same rule rather
    // than under the return value — that return cannot tell "refused" apart from
    // "started a new rectangle", both of which are `false`. It also has to be
    // read first because `isPointerDownValid` flips `isMouseDown` on the way in,
    // after which the flag can no longer tell the two apart either. A right-click
    // that claimed the document would refuse every shortcut until some later
    // drag happened to release it.
    const startsGesture = event.button === 0 && !pointerState.isMouseDown.current;
    const pointerId = getPointerId(event);

    const isEditingCommittedSelection = pointerHandlers.onPointerDown(event);
    isEditingCommittedSelectionRef.current = isEditingCommittedSelection;

    if (!isEditingCommittedSelection) {
      dispatch({ type: 'START_SELECTION_DRAFT', payload: { sourceTool: 'rectangular-selection' } });
    }

    // The claim, not the draft dispatch: a rectangle is the one gesture whose
    // write lands on release, so the window between this press and the
    // `onChangeEnd` above is exactly the window where a document-mutating
    // shortcut would mutate the document the pending commit then truncates.
    if (startsGesture && claimDocumentGesture('rectangular-selection', pointerId)) {
      claimedPointerIdRef.current = pointerId;
    }
  };

  /**
   * A cancel is genuinely terminal even under `useRect`'s capture: `useRect` does
   * not surface its internal `onPointerCancel`, so no `onChangeEnd` follows and
   * the claim has to be dropped here or it would outlive the gesture.
   *
   * The preview clear rides the same route for the same reason and is deliberately
   * redundant with the hook's: the entry hides the ants, a leaked one hides them for
   * the rest of the session (`selection-drag-preview.ts:58`-`:63`), and it is
   * unconditional and idempotent, so two callers clearing the same cancel costs
   * nothing and covers the one route `useRect` cannot run code on.
   */
  const handlePointerCancel = () => {
    releaseDocumentClaim();
    clearSelectionDragPreview();
  };

  useEffect(() => {
    return () => {
      // An unmount between claim and commit is an abort like any other. Paired
      // with the provider-level `resetDocumentGestures`, this is what bounds a
      // leaked claim to the mount that leaked it.
      releaseDocumentClaim();
      // Same reasoning for the preview entry, and the same bound: the slot is a
      // module-level variable that outlives this mount. `useRect`'s own teardown
      // clears it too, and on this tool the two run in the same commit.
      clearSelectionDragPreview();
    };
  }, []);

  return (
    <div
      className={`${className} cursor-crosshair`}
      {...pointerHandlers}
      onPointerDown={handlePointerDown}
      onPointerCancel={handlePointerCancel}
    ></div>
  );
};
