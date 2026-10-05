/**
 * The grabbing cursor and the selection lock, counted.
 *
 * Both live on `document.body` because they are global by nature: a drag that leaves an 8px
 * handle must keep its cursor, and only a rule that reaches the whole tree does that. That makes
 * the unlock a shared resource, and every writer has to share the count — a second writer that
 * adds and removes the class directly will take the lock away from a gesture it never knew about.
 *
 * There are two writers and both go through here: `useDockDrag` (the dock gestures) and
 * `LayersTab` (the layer-row reorder, which predates this). They used to be independent, and a
 * layer drag that ended while a dock divider was still being dragged removed the class from under
 * the dock gesture.
 */

let liveLocks = 0;

export const lockDragCursor = () => {
  liveLocks += 1;
  if (liveLocks > 1) return;
  // `cursor-grabbing` is already a rule in `index.scss:69-71` and is applied to the whole tree
  // by `*`, which is what keeps the cursor steady once the pointer is off the handle.
  document.body.classList.add('cursor-grabbing');
  document.body.style.setProperty('user-select', 'none');
};

export const unlockDragCursor = () => {
  // `Math.max` because a double release must not drive the count negative and hand the lock to
  // the next gesture before its own release.
  liveLocks = Math.max(0, liveLocks - 1);
  if (liveLocks > 0) return;
  document.body.classList.remove('cursor-grabbing');
  document.body.style.removeProperty('user-select');
};

/** The lock's live depth. Exported for the tests that pin the counting, not for callers. */
export const liveDragCursorCount = () => liveLocks;
