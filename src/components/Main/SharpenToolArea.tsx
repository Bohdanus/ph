import type { RefObject } from 'react';

type sharpenToolAreaProps = {
  className?: string;
  /**
   * Accepted for the mount contract and deliberately not read.
   *
   * Sharpen is a ONE-SHOT filter like Blur and Levels: the options bar previews it through
   * `tempUpdateLayer` (`src/contexts/useLayer.ts:473`) and `commitDirtyTool` (`:323`) bakes
   * it on tool switch, on export and in `mergeAllLayers`. There is no gesture on the canvas
   * for this area to own, so both contexts belong to the layer republish rather than to a tool
   * painting by hand — which is the un-undoable defect `usePaintStroke`'s JSDoc warns about,
   * and the reason a Sharpen may not reach for the shared stroke hook.
   */
  /**
   * Optional: accepted so every tool area in the union can be rendered with one prop set, and
   * read from the store rather than the prop when it is needed. `Main` passes only
   * `overlayCtxRef`, so a required declaration here is a type error at the call site and a
   * `undefined` at runtime. `EllipticalSelectionToolArea` and `QuickSelectionToolArea` already
   * declare it this way.
   */
  canvasCtxRef?: RefObject<CanvasRenderingContext2D | null>;
  /** The sibling of `canvasCtxRef`, unused for the same reason. */
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * Sharpen's tool area, which is the documented ABSENCE of one.
 *
 * `interactionMode` carries the tool name for as long as the Sharpen is selected, so the
 * canvas needs a surface mounted for it — but the surface must not claim a gesture. Blur, the
 * sibling in the same Focus flyout, has no tool area at all and falls through to
 * `DummyToolArea`, which renders `display: none`; this is that same surface under a name of
 * its own, for the same reason. A mounted-and-interactive area would be worse than nothing:
 * it would swallow every pointer event over the document without doing anything with any of
 * them, and a drag across the canvas would select text, scrub the layers panel, or do whatever
 * else sits underneath instead of being inert.
 *
 * Nothing is read from the store here, deliberately. A one-shot filter's whole state lives in
 * the options bar, and the one thing a tool area could usefully report — that there is no
 * layer to sharpen — is already reported where the user acts on it: `tempUpdateLayer` no-ops
 * without a layer, and the bar's sliders go through it. Duplicating that read here would be a
 * second source of truth that says nothing the first one does not.
 */
export const SharpenToolArea = ({ className }: sharpenToolAreaProps) => {
  return <div className={className} style={{ display: 'none' }} />;
};
