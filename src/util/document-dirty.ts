import type { ToolArgs } from '../contexts/tool-types.ts';
import { hasPendingText } from './typeGuards.ts';

/**
 * Everything the discard guard is allowed to reason about, gathered at the moment the
 * question is asked rather than captured at render.
 */
export interface DocumentDirtiness {
  /** A document exists at all. `false` means there is nothing to discard. */
  hasImage: boolean;
  /** The store's own durable-dirty projection. */
  hasUnsavedChanges: boolean;
  /** The live tool args, for a typed-but-unplaced text box. */
  currentArgs: ToolArgs;
  /**
   * How many layers are in the transient preview transaction. A live tool drag writes
   * there and dispatches nothing, so `hasUnsavedChanges` stays `false` for the whole
   * gesture: a brush stroke mid-drag, or a Levels slider pulled halfway, is work that
   * `clearPreviewLayers()` and `previewLayersRef.current = {}` throw away without a word.
   */
  pendingPreviewCount: number;
}

/**
 * The single definition of "replacing the document would destroy work".
 *
 * Three terms, and the first two are not sufficient on their own:
 *
 * - `hasUnsavedChanges` covers everything already committed to the timeline.
 * - `hasPendingText` covers a text box the user has typed into but not placed, which
 *   lives only in `currentArgs` until the tool commits it.
 * - `pendingPreviewCount` covers an in-flight tool transaction, which is neither
 *   committed nor pending-args.
 *
 * `hasImage` gates all three. The app has no "close document" path, and every
 * replacement surface that can run with no document — the startup blank document and
 * the `Main` empty-state buttons — has nothing to lose, so asking there would be a
 * prompt with no possible answer but "yes".
 */
export function hasDiscardableWork(dirtiness: DocumentDirtiness): boolean {
  if (!dirtiness.hasImage) return false;
  return dirtiness.hasUnsavedChanges || hasPendingText(dirtiness.currentArgs) || dirtiness.pendingPreviewCount > 0;
}
