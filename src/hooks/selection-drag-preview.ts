import type { Selection } from '../contexts/general-types.ts';

/**
 * What the tool areas tell the marching-ants loop about the selection gesture in flight.
 *
 * `follow` — a COMMITTED selection is being moved or reshaped. The ants must keep showing that
 * selection's border, because it is the only thing on screen that says where the selection is,
 * and it must stop crawling while it moves. It has to be the ants that move it: the tool overlay
 * cannot, because `useSelectionAnts` owns a canvas of its own and the polygon tool areas
 * full-clear the tool overlay on every repaint.
 *
 * `marquee` — a NEW selection is being drawn, and the tool overlay is already painting it. The
 * rectangle marquee is the case that forces the distinction: `useRect` draws its dashed border on
 * the tool overlay, which is the same border the ants would draw for the same rectangle, so during
 * the gesture the ants would show the COMMITTED rectangle beside the one being dragged. Two
 * outlines of one selection is worse than either alone, and Adobe's own answer is to substitute:
 * `Select > Transform Selection` swaps the ants for the transform box and restores them on commit.
 *
 * The polygon tools' create gestures are deliberately NOT this: their marquee is a different
 * shape from the committed selection, so both are true at once and Photoshop shows both. They
 * publish nothing, and the committed border keeps marching behind the marquee being drawn.
 */
export type SelectionDragPreview =
  { readonly kind: 'follow'; readonly selection: Selection } | { readonly kind: 'marquee' };

/**
 * The published preview, or `null` for "no gesture is reshaping a selection" — which is a
 * DIFFERENT state from `{ kind: 'marquee' }`, not a synonym for it.
 *
 * A leaf module and a single slot, for the two reasons `document-gesture.ts` is one. It has to be
 * a module because these values never enter React state: a selection drag keeps its running state
 * in a ref and reaches the store only on release, so a pointermove that dispatched anything would
 * re-render the whole tree per pointermove for a picture no component renders. And it has to be a
 * slot rather than a queue because the ants loop reads the LATEST value every frame; anything
 * older is by definition a frame the loop has already passed.
 */
let preview: SelectionDragPreview | null = null;

/** Record what the ants loop should paint for the gesture in flight. */
export function publishSelectionDragPreview(next: SelectionDragPreview): void {
  preview = next;
}

/**
 * What the ants loop should paint this frame, or `null` to march the committed selections.
 *
 * A live reference, not a copy: the tool area already rebuilds the preview selection on every
 * pointermove, and copying it would add an allocation to the input path to guard against a caller
 * mutating a value it already replaced.
 */
export function readSelectionDragPreview(): SelectionDragPreview | null {
  return preview;
}

/**
 * Drop the preview, and only the caller's own.
 *
 * Unconditional on purpose, like `releaseDocumentGesture`: every route out of a gesture — commit,
 * abort, pointer-leave, pointer-cancel, unmount — calls it, and the slot is cleared by whichever
 * of them runs, because the loop reads the value fresh each frame and a stale entry would freeze
 * the ants for the rest of the session. Only one tool area is mounted at a time and each of the
 * four that publish owns its own entry, so there is nothing for this to displace.
 */
export function clearSelectionDragPreview(): void {
  preview = null;
}
