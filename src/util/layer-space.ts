import type { Point, Pos } from '../contexts/general-types.ts';

/**
 * The one conversion between DOCUMENT space and the LAYER-LOCAL space a raster processor
 * addresses, so the six stroke tool areas stop each deriving it by hand.
 *
 * ## The two spaces, and the exact place they stop agreeing
 *
 * DOCUMENT space puts the document's own origin at (0, 0). It is what a pointer coordinate
 * means: `usePaintStroke` converts every sample through the document frame
 * (`src/hooks/usePaintStroke.ts:166-167`) because a pointer is over the DOCUMENT, and it is
 * the space a `Layer['pos']` is expressed in.
 *
 * LAYER-LOCAL space is the processor's own raster. A layer carrying a retained affine or filter
 * is handed a buffer staged at its EVALUATED extent, not its raw one: the live path builds it at
 * `src/contexts/useLayer.ts:730-734` (`transformedProcessorInput`) and replay builds it at
 * `src/contexts/useHistory.ts:49-80` (`replayProcessorInput`). A layer with no retained operation
 * is handed the raw raster with `size: layer.pos`.
 * Every raster tool allocates `new OffscreenCanvas(size.width, size.height)` from that, so
 * pixel (0, 0) is the LAYER's top-left and carries no document origin at all. A processor
 * cannot know where its layer sits — it receives one buffer and its extents, and a stroke
 * running off the layer's edge simply clamps, exactly as it would at the document's edge.
 *
 * The two spaces agree at exactly one place: a layer whose `pos` origin is (0, 0). That is
 * every layer on a freshly opened document, which is why this is invisible until something
 * moves one — a moved layer, a duplicated layer, a pasted one — and why the whole family of
 * tools breaks together rather than one at a time.
 *
 * ## What the defect was
 *
 * The six stroke tool areas received document-space points from `usePaintStroke` and handed
 * them to a processor addressing a layer-local raster, so on a layer at
 * `pos: { x: 40, y: 25 }` every stroke landed (40, 25) pixels off — a stroke near the layer's
 * left edge fell off it entirely — and `clampPointToSize` clamped against a box that started
 * 40px right of and 25px below the raster actually being written. Clone Stamp and Gradient
 * already rebased by hand; Eraser, Smudge, Dodge and Burn did not.
 *
 * ## Where the conversion belongs
 *
 * At the CALLBACK BOUNDARY of a tool area: the last point where the tool still knows which
 * layer it is editing, and the first point where it is producing args for someone else's
 * raster. Two other locations look equally reasonable and are both wrong:
 *
 * - **NOT in `usePaintStroke`.** That hook is layer-agnostic on purpose — it converts canvas
 *   to document and stops there — and every one of its consumers is documented in those
 *   terms. Folding a layer offset in would give a hook with no layer dependency a silent
 *   dependency on `useStore`, and would rebase every future caller of it.
 * - **NOT in the processors.** A processor is handed a buffer and a size and never learns
 *   which layer it belongs to; teaching it about document space would give the same numbers
 *   a second, invisible frame of reference inside a function whose entire contract is one
 *   buffer.
 *
 * History then keeps the rebased numbers, which is correct rather than lossy: replay feeds a
 * stored `TOOL_ACTION`'s args back to the same processor over the same evaluated buffer
 * (`src/contexts/useHistory.ts:169`, staging at `:49-80`), so a stroke replays against the
 * geometry the screen showed when it was recorded. Before that, replay read the raw raster with
 * `size: layer.pos` while the live path evaluated, so a transformed layer undid to a place the
 * screen never showed.
 */

/**
 * Rebase one DOCUMENT-space point onto the layer-local frame its processor addresses:
 * `(point.x - layerPos.x, point.y - layerPos.y)`.
 *
 * Subtracting rather than scaling, because the two spaces share a scale — the layer's raster
 * is the same pixels, only counted from a different origin. The result is a NEW point, never
 * the input: during a live gesture the input is `usePaintStroke`'s live array, and a mutation
 * in place would translate the hook's own accumulator, twice on the second move, and a
 * stroke would creep diagonally at the layer's origin.
 *
 * A MISSING layer position rebases as the origin. That is the honest answer for both ways it
 * happens: a bedrock layer genuinely sits at (0, 0), and a layer that has gone missing under
 * the pointer has no origin to subtract, where throwing would take the whole stroke down
 * inside a pointer handler. Note what is deliberately NOT guarded: a `Pos` whose `x`/`y` is
 * non-finite. A NaN origin is a corrupt store rather than an absent layer, and quietly
 * treating it as (0, 0) would paint the stroke correctly onto the wrong raster, which is the
 * failure this whole module exists to make impossible.
 */
export const documentPointToLayerLocal = (point: Point, layerPos: Pos | null | undefined): Point => ({
  x: point.x - (layerPos?.x ?? 0),
  y: point.y - (layerPos?.y ?? 0),
});

/**
 * Rebase a whole gesture: a NEW array holding a NEW point per element, leaving the input
 * array and every point in it exactly as they were found.
 *
 * Aliasing is the hazard this exists to prevent, and it is worth being precise about why it
 * bites. `onMove` receives `usePaintStroke`'s LIVE array — the same object every later move
 * appends to, and the same one that would be retained by a history item — so a rebase that
 * wrote back into it would shift the hook's own accumulator. The second move would subtract
 * the layer's origin from points the first move had already shifted by it, and the stroke
 * would walk up and to the left by the layer origin on every frame, faster the further the
 * layer sat from (0, 0). `map` rather than a loop over `points[i]` for the same reason: it
 * is the shortest expression of "new array, new elements" that cannot be edited later into
 * an in-place one without looking like an edit.
 *
 * An empty input yields a NEW empty array rather than the input back, so a caller can never
 * come to depend on the identity of the result and keep aliasing a gesture's own array.
 */
export const documentPointsToLayerLocal = (points: Point[], layerPos: Pos | null | undefined): Point[] =>
  points.map((point) => documentPointToLayerLocal(point, layerPos));
