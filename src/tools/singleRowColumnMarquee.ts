import type { RectXYSorted, SelectionSourceTool, Size } from '../contexts/general-types.ts';

/**
 * The two 1-pixel marquee tools, and everything that is a pure function of them.
 *
 * They share one module because they share one rule: a selection is a rectangle whose
 * thickness is fixed at one document pixel and whose other axis is the whole document,
 * so the only free parameter is which row or column was picked. Everything else about
 * them — the processor is a pass-through, the commit kind is `selection`, the geometry
 * is `'rectangle'` — is inherited from the Rectangular Marquee rather than restated.
 */

/** How thick a selection these tools make is, in document pixels. Fixed by Adobe. */
export const MARQUEE_THICKNESS_PX = 1;

export type SingleRowMarqueeToolArgs = {
  toolName: 'single-row-marquee';
};

export type SingleColumnMarqueeToolArgs = {
  toolName: 'single-column-marquee';
};

export type SingleRowOrColumnMarqueeToolName =
  SingleRowMarqueeToolArgs['toolName'] | SingleColumnMarqueeToolArgs['toolName'];

export type SingleRowOrColumnMarqueeToolArgs = SingleRowMarqueeToolArgs | SingleColumnMarqueeToolArgs;

/**
 * The `SelectionSourceTool` each tool commits under.
 *
 * `SelectionSourceTool` in `src/contexts/general-types.ts:17` does not carry these two
 * names, and this is the honest answer to what to do about that rather than the elliptical
 * tool's: the elliptical marquee commits under `'magic-wand'` (`ellipticalSelection.ts:50`)
 * because a borrowed member was the smaller change, and that lie buys it the two
 * `selection.ts` exclusions a tessellated ellipse wants anyway (`ellipticalSelection.ts:40`-`:43`).
 * A 1-pixel band is a rectangle whose corners Photoshop does not decorate either, so the
 * truthful value here is the one the geometry actually is: `'rectangular-selection'`. The
 * alternative — widening `SelectionSourceTool` — is the real fix and it is a separate change,
 * because every `sourceTool` comparison in `selection.ts` and the anchors that key off it
 * would have to be re-read for the two new members.
 *
 * Truthful also means the borrowed source costs this pair nothing. The four white anchor discs
 * the elliptical tool's borrow buys it as a side effect are not painted for a band: nothing
 * calls `drawSelectionAnchors` from `SingleRowColumnMarqueeToolArea.tsx`, which draws only its
 * own `drawMarqueePreview`, so a committed band shows the marching ants and no handles — which
 * is what Photoshop shows. The discs were never draggable here either; a band is placed by its
 * press, so they were decoration the user saw and Photoshop does not, and they are gone. The
 * fix is not pending: `drawSelectionAnts` draws the border for every active selection whatever
 * made it, so nothing needed to know this source at all.
 */
export const SINGLE_ROW_MARQUEE_SOURCE_TOOL: SelectionSourceTool = 'rectangular-selection';
export const SINGLE_COLUMN_MARQUEE_SOURCE_TOOL: SelectionSourceTool = 'rectangular-selection';

/**
 * The document pixel a pointer position falls in, clamped into range.
 *
 * `Math.floor` rather than `Math.round` because a pixel is an interval, not a point: a
 * pointer at `y = 12.9` is inside row 12, and rounding would hand row 13 a press that
 * landed above it. `trimRect` (`src/util/rect.ts:66`) rounds edges for the same reason it
 * rounds them — an edge is a boundary — but it rounds the RESULT of a drag, where the user
 * has already chosen a corner; here the user has chosen a location inside the document.
 *
 * A press outside the document clamps to the first or last row rather than producing no
 * selection. Adobe's scripting API documents the coordinate as required to be in range
 * (`developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/selection`,
 * `@param y … The range should be within the document height`) and publishes no GUI
 * behaviour for the out-of-canvas case, so clamping is this app's documented choice: the
 * marquee flyout shares a tile with two drag tools whose press is also outside the
 * document often enough that rejecting it would be a surprise rather than a fidelity win.
 * The alternative — an empty selection — is what a zero-area drag produces, and
 * `createCommittedRectangleSelection` returns `null` for it, which silently does nothing.
 *
 * **The clamp covers the PRESS, not the drag.** A drag that leaves the tool element is
 * aborted by its `onPointerLeave` before any further axis value is read, so the last row it
 * clamps to is the one under the pointer at the moment of leaving, and the gesture commits
 * nothing. That is house convention rather than a choice of these two tools —
 * `EllipticalSelectionToolArea.tsx:317`-`:318` wires the same pair, and the Rectangular
 * Marquee wires `pointercancel` alone — but it does mean the two marquee families disagree
 * about what an out-of-document pointer does, and Photoshop keeps tracking instead of
 * dropping. Recorded in `HANDOFF.md` rather than fixed here, because narrowing the abort to
 * `pointercancel` would change a behaviour every selection tool shares, and that is a
 * decision about the family rather than about a band.
 */
function clampPixelIndex(value: number, extent: number): number {
  // Only `NaN` short-circuits. The infinities deliberately fall THROUGH to the clamp below, so
  // `-Infinity` selects the first row and `+Infinity` the last — the nearest row to a press that
  // overshot the document, which is what every other out-of-range value here already gets.
  // Returning 0 for all three would make `+Infinity` select the row furthest from the pointer.
  if (Number.isNaN(value)) return 0;

  return Math.min(Math.max(Math.floor(value), 0), Math.max(0, extent - 1));
}

/**
 * The document row a press at `y` selects: one pixel tall, the whole document wide.
 *
 * `extent` is the document's pixel height. A zero-height document yields `y: 0` and a
 * height of 1, which is the only non-empty answer available rather than a rejection.
 */
export function singleRowMarqueeRect(y: number, imageSize: Size): RectXYSorted {
  const row = clampPixelIndex(y, imageSize.height);

  return { x1: 0, y1: row, x2: Math.max(0, imageSize.width), y2: row + MARQUEE_THICKNESS_PX };
}

/**
 * The document column a press at `x` selects: one pixel wide, the whole document tall.
 *
 * The transpose of `singleRowMarqueeRect`, and the mirror of it rather than a second
 * implementation: both take a pointer position on one axis and produce the band on the
 * other, so a defect fixed in one has to be fixed in the other by construction.
 */
export function singleColumnMarqueeRect(x: number, imageSize: Size): RectXYSorted {
  const column = clampPixelIndex(x, imageSize.width);

  return { x1: column, y1: 0, x2: column + MARQUEE_THICKNESS_PX, y2: Math.max(0, imageSize.height) };
}

/** Which axis a committed 1-pixel band is thin on, or `null` if the rect is not a band. */
export type BandOrientation = 'row' | 'column';

/**
 * What a band's rect IS, asked the same way every time.
 *
 * This is the single answer to "is this rect a band, and if so which way round", and
 * `isSingleRowOrColumnMarqueeRect` below is this function's boolean face. It exists because the
 * question was being asked twice, differently: the tool area's `movedBand` decided the
 * orientation from the rect's THICKNESS alone while the hit test decided it from the rect's
 * SPAN, and the two disagreed — on a document one pixel wide, where a row band is also one
 * pixel wide, a thickness-only rule reads it as a column and transposes it mid-drag. Asking
 * twice, differently, is the defect; this is the one place that answers.
 *
 * **The order of the two clauses is arbitrary, and swapping them changes nothing.** Both can
 * only be true at once when the rect is one pixel on both axes AND the document is at most one
 * pixel on both axes, and there the two readings produce the identical rect, so the answer
 * cannot surface. Every reachable band satisfies exactly one clause. (An earlier version of
 * this comment claimed COLUMN FIRST was what made the degenerate documents come out right; a
 * swap of the two clauses passes every test in the repository, which is how that claim was
 * caught. The SPAN conditions are what separate the degenerate cases, not the order.)
 *
 * What the span conditions do is separate the two documents where a 1x1 rect is a real band.
 * On a document one pixel TALL, a 1x1 band reaches its full height and so is a column; on a
 * document one pixel WIDE, the same rect reaches its full width but only one of its 120 rows,
 * so it is a row. A rect that satisfies neither clause — a 1x1 band on a document with both
 * dimensions above one pixel — is not a band at all and is `null`, which is why such a band
 * can never be reached through a press.
 */
export function bandOrientation(rect: RectXYSorted, imageSize: Size): BandOrientation | null {
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;

  if (width === MARQUEE_THICKNESS_PX && height >= imageSize.height && rect.y1 === 0) return 'column';
  if (height === MARQUEE_THICKNESS_PX && width >= imageSize.width && rect.x1 === 0) return 'row';

  return null;
}

/**
 * Whether the rect is the band one of these two tools produces: one pixel on one axis and
 * the whole document on the other.
 *
 * Used by the tool area to decide whether a press inside the active selection is a MOVE —
 * which every selection tool in this editor treats as such — or a fresh draw. A 1-pixel
 * band is a 1-pixel hit target for the drag-to-move gesture, which is why the tool area
 * pairs this with the whole-band span rather than a point test.
 */
export function isSingleRowOrColumnMarqueeRect(rect: RectXYSorted, imageSize: Size): boolean {
  return bandOrientation(rect, imageSize) !== null;
}
