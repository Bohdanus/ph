/**
 * Document-scoped "a pointer gesture that writes the document is in progress" flag.
 *
 * WHAT IT IS FOR. A gesture that commits on release — a rectangle draw, a layer
 * move, a brush stroke, a shape draw, a polygon's anchor or body drag, a freehand
 * lasso — holds the document in a state its own writer will append to later. A
 * keyboard shortcut that runs in that window mutates the document behind the
 * gesture's back, and the two interleavings that do it silently lose committed
 * work: an undo/redo replaces `selections` from the SAME `history` array, so
 * `history.length` never moves and the pending commit's
 * `entries.slice(0, cursor + 1)` then truncates the redo tail with no other
 * symptom; `mod+c` bumps `metadata.copiedAtVersion` in place with no append at
 * all. So the fix belongs at the INPUT layer, before any dispatch: this module
 * says "a document-committing gesture is open", and `useKeyboardEvents` refuses
 * every document-mutating shortcut while it is.
 *
 * WHY A LEAF MODULE AND NOT A CONTEXT VALUE. Two of the components that own
 * gestures are tested with `useKeyboardEvents.tsx` mocked out wholesale, and a
 * gate carried on a context that the keyboard hook reads would simply vanish in
 * those files — the mock replaces the whole module, so the provider that would
 * have carried the value never renders. A module-level ref that the TOOL AREA
 * imports directly survives that mock, because the tool area imports this file
 * for real. It is a module and not React state for the second reason: claiming a
 * gesture must not re-render anything. Every `pointerdown` on a surface would
 * re-render the whole tree through a context value, which is a per-gesture cost
 * on the input path for a flag nothing renders.
 *
 * WHY A REF AND NOT A QUEUE. A refused shortcut is dropped, not queued, and that
 * is a decision rather than an omission. The pointer channel has no queue to copy
 * from — `usePointerPosition` is a set of pure predicates that drop — and there is
 * no flush point that exists today: flushing would have to run after
 * `useRect.handlePointerUp` finished its own bookkeeping, re-entering `goToTool`
 * or `undo` at exactly the layer the race already lives. Queuing `mod+z` is also
 * semantically wrong: once the drag commits, the correct undo target is the drag's
 * OWN entry, which does not exist until release, so a queued undo would undo the
 * new drag instead of what the user pressed it against.
 */
export type DocumentGestureKind =
  | 'polygon-selection'
  | 'freehand-lasso'
  | 'rectangular-selection'
  | 'layer-transform'
  | 'brush-stroke'
  | 'shape-draw'
  | 'eraser-stroke';

export type DocumentGesture = {
  kind: DocumentGestureKind;
  pointerId: number | null;
};

/**
 * The one open claim, or `null`. A single slot rather than a set because the
 * document has one owner at a time, and that is enforced PER SURFACE rather than
 * here: every tool area routes its press through
 * `usePointerPosition.isPointerDownValid` — directly (`DrawToolArea`,
 * `ShapeToolArea`, `EraserToolArea`) or through `useRect`
 * (`MoveToolArea`, `RectangularSelectionToolArea`, `CropToolArea`,
 * `TextToolArea`) — which refuses a non-primary button and a second pointer,
 * and `PolygonClickToolArea`, which never asks the hook, refuses a second press
 * itself while one of its own gestures is running. Two concurrent
 * document-committing gestures cannot exist, and a set would only hide a
 * double-claim behind a success return nobody checks.
 */
let openGesture: DocumentGesture | null = null;

/**
 * Claim the document for a gesture. First claim wins.
 *
 * Returns `false` when a gesture is already open, which is what makes this a
 * gate rather than a counter: a caller that loses the race owns nothing and must
 * not later try to release someone else's claim — `releaseDocumentGesture`
 * ignores a release it does not own, so the losing caller is harmless either way.
 *
 * `pointerId` is recorded so the release can prove ownership. `null` is a real
 * value, not "unknown": it is what a synthetic event without a pointer id yields,
 * and two such claims would then match each other, which is the same
 * indistinguishable case the pointer channel already accepts.
 */
export function claimDocumentGesture(kind: DocumentGestureKind, pointerId: number | null): boolean {
  if (openGesture !== null) return false;

  openGesture = { kind, pointerId };

  return true;
}

/**
 * Release the claim for this gesture, and only this one.
 *
 * A release that names a different kind or a different pointer than the open
 * claim is ignored rather than honoured, so a second surface tearing down an
 * abandoned gesture cannot unblock the keyboard under the gesture that is
 * actually running. Release without an open claim is a no-op, so every abort
 * route can call it unconditionally.
 */
export function releaseDocumentGesture(kind: DocumentGestureKind, pointerId: number | null): void {
  if (openGesture === null) return;
  if (openGesture.kind !== kind || openGesture.pointerId !== pointerId) return;

  openGesture = null;
}

/** Whether a document-committing gesture is open. This is the keyboard gate's whole question. */
export function isDocumentGestureOpen(): boolean {
  return openGesture !== null;
}

/** The open claim, for a caller that needs to name it. Never a stored reference to a live object. */
export function readDocumentGesture(): DocumentGesture | null {
  return openGesture === null ? null : { ...openGesture };
}

/**
 * Drop every claim.
 *
 * The module-level slot outlives any one mount, so without this a gesture whose
 * release route was missed — an unmount between claim and commit, a test that
 * leaked a claim into the next case — would gate every later keystroke in the
 * session. `KeyboardEventsProvider` calls it on mount and on cleanup, which is
 * what bounds a leak to the mount that leaked it: a new provider starts with no
 * claim, and the one that goes away takes its claim with it.
 */
export function resetDocumentGestures(): void {
  openGesture = null;
}
