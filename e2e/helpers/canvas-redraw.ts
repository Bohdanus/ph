/**
 * Spec-facing entry point for the canvas redraw wait.
 *
 * The implementation is deliberately NOT here: `canvas-helpers.ts` owns the single poll
 * loop, its clip derivation and its timeout constants, because `waitForCanvasRedraw` lives
 * there and delegates into it. Keeping this module a re-export of those leaves one
 * implementation and one import direction (canvas-helpers -> nothing, canvas-redraw ->
 * canvas-helpers) instead of a cycle between two files that both poll.
 */
export {
  canvasRedrawClip,
  waitForCanvasPixels,
  type CanvasPixelPredicate,
  type WaitForCanvasPixelsOptions,
} from './canvas-helpers';
