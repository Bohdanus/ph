/**
 * "Something modal owns the keyboard right now."
 *
 * WHY IT EXISTS. Two surfaces read `event.key === ' '` in their own local React handlers —
 * `PanelGroup` collapses and expands on it, and `SidebarLeft` uses it to activate a flyout
 * item. The keyboard layer claims `Space` for temporary Hand, and a shortcut is dispatched
 * from a listener on `document`, which fires for a key pressed anywhere including on those
 * surfaces. So without a gate, opening a flyout and pressing Space would both activate the
 * highlighted item AND arm a pan.
 *
 * WHY A MODULE AND NOT A CONTEXT VALUE. The same reasoning `document-gesture.ts` records for
 * the gesture flag: several components are tested with their keyboard provider mocked out
 * wholesale, and a value carried on a context the keyboard hook reads would simply vanish in
 * those files. A module-level ref that each surface imports survives the mock. It is a module
 * and not React state for the second reason too — a flyout opening must not re-render the
 * tree, and the flag nothing renders does not need to.
 *
 * THE RULE. First claim wins and a release only honours its own owner, so a surface tearing
 * down on unmount cannot unblock the keyboard for whatever mounted next. Release with no open
 * claim is a no-op, so every abort route can call it unconditionally.
 */

let owner: symbol | null = null;

/** Claim the keyboard for a modal surface. Returns `false` when another surface already holds it. */
export function claimKeyCapture(claimant: symbol): boolean {
  if (owner !== null) return false;
  owner = claimant;
  return true;
}

/** Release the claim, and only this surface's claim. */
export function releaseKeyCapture(claimant: symbol): void {
  if (owner !== claimant) return;
  owner = null;
}

/** Whether a modal surface currently owns the keyboard. */
export function isKeyCaptured(): boolean {
  return owner !== null;
}

/**
 * Drop every claim.
 *
 * The module-level slot outlives any one mount, so a claim leaked by a surface that unmounted
 * without releasing would gate `Space` for the rest of the session with nothing on screen to
 * explain it. `KeyboardEventsProvider` calls this on mount and on cleanup for the same reason
 * it calls `resetDocumentGestures()`.
 */
export function resetKeyCaptures(): void {
  owner = null;
}
