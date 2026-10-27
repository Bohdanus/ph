import type { PanelSide } from '../contexts/PanelLayout.tsx';

/**
 * Where an edge column's occupant sits in the shell grid.
 *
 * ## Why this is placement by LINE rather than by named area
 *
 * The shell's grid template lives in `App.tsx`, and its side cells are deliberately left UNNAMED
 * (`.`). Naming them is what made the swap bug possible in the first place: `left` and `right`
 * were each ONE cell, so exactly one occupant could claim each, which is a rule that silently
 * forces the tools rail and the panel dock onto opposite edges whether or not the user asked for
 * that. Adobe's model is the opposite — a dock is "a collection of panels grouped together vertically",
 * so two groups belong in one column.
 *
 * Placement by line can express that, because two items in one column are two different row spans
 * rather than one shared rectangle. The desktop band is two `1fr` rows (rows 3 and 4); an occupant
 * alone spans both, and two occupants split them. Both row counts sum to the same band, so the
 * canvas — which spans both rows through the `main` area — is the height it always was.
 *
 * ## Why a module of its own
 *
 * `SidebarLeft.tsx` and `SidebarRight.tsx` both need this, and `App.tsx` imports both of them, so
 * putting the helper in `App.tsx` would make it a circular import. It is pure string derivation
 * over layout state with no React in it, which is what `src/util/` is for.
 */

/** Which half of the band an occupant takes when the column holds two. */
export type EdgeHalf = 'top' | 'bottom' | 'full';

/**
 * The grid placement for one edge occupant.
 *
 * `full` spans both rows of the band and is the ordinary case — the rail and the dock each own
 * their edge outright. `top` and `bottom` are the stacked case, and they are the ONLY thing this
 * change needed the row split for: a rail dropped onto the edge the dock is already on joins that
 * column as the panel group above it.
 *
 * A rail is `top` and a dock is `bottom` whenever a split happens, on both edges. That is not
 * arbitrary — it is the Photoshop arrangement, where the Tools panel sits above the panel groups
 * it shares a column with, and it is what keeps the rail's chrome and its tool fit at the top of
 * the window rather than under a History panel the user may have made tall.
 *
 * ## The split is about what is ON SCREEN, not what is STORED
 *
 * Both sides equal is necessary and not sufficient, and only the RAIL needs the second half:
 * `SidebarLeft` adds `useRightPanelVisibility().isOpen`, because a collapsed dock renders a
 * `display: none` aside and there is then no bottom row of the column to be the top of. `SidebarRight`
 * does not need the same term — when it is collapsed its placement is moot — which is why the
 * predicate is spelled out in `SidebarLeft.tsx` beside the rail's `style` rather than here. Two
 * callers disagreeing about when a column is shared is the bug this note exists to prevent, so
 * the rule lives in one place and the other caller says why it does not need it.
 *
 * The class strings are written out in full rather than interpolated, because Tailwind extracts
 * candidates by scanning source text: a `[grid-row:3/${end}]` built at runtime contains no class
 * Tailwind can see, and the rule would silently not exist in the built stylesheet.
 */
export function edgePlacement(side: PanelSide, half: EdgeHalf): string {
  const column = side === 'left' ? '[grid-column-start:1]' : '[grid-column-start:3]';
  if (half === 'full') return `${column} [grid-row:3/5]`;
  return `${column} ${half === 'top' ? '[grid-row:3/4]' : '[grid-row:4/5]'}`;
}
