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
 * tool's: the elliptical marquee commits under `'magic-wand'` (`ellipticalSelection.ts:48`)
 * because a borrowed member was the smaller change, and that lie is why `drawSelectionOutline`
 * skips anchors for its own border (`selection.ts:156`-`:159`). A 1-pixel band is a
 * rectangle whose corners Photoshop does not decorate either, so the truthful value here is
 * the one the geometry actually is: `'rectangular-selection'`. The alternative — widening
 * `SelectionSourceTool` — is the real fix and it is a separate change, because every
 * `sourceTool` comparison in `selection.ts` and the anchors that key off it would have to
 * be re-read for the two new members.
 */
export const SINGLE_ROW_MARQUEE_SOURCE_TOOL: SelectionSourceTool = 'rectangular-selection';
export const SINGLE_COLUMN_MARQUEE_SOURCE_TOOL: SelectionSourceTool = 'rectangular-selection';

/**
 * The document pixel a pointer position falls in, clamped into range.
 *
 * `Math.floor` rather than `Math.round` because a pixel is an interval, not a point: a
 * pointer at `y = 12.9` is inside row 12, and rounding would hand row 13 a press that
 * landed above it. `trimRect` (`src/util/rect.ts:32`) rounds edges for the same reason it
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
 */
function clampPixelIndex(value: number, extent: number): number {
  if (!Number.isFinite(value)) return 0;

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
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;

  return (
    (width === MARQUEE_THICKNESS_PX && height >= imageSize.height && rect.y1 === 0) ||
    (height === MARQUEE_THICKNESS_PX && width >= imageSize.width && rect.x1 === 0)
  );
}
