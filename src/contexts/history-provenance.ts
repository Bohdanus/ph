import { SET_DOCUMENT_FRAME_ACTION, SET_LAYER_OPACITY_ACTION, TOOL_ACTION } from '../util/constants.ts';
import type { DurableEntryProvenance } from './history-model.ts';
import type { HistoryItem } from './history-types.ts';

/**
 * Carries only the legacy identity needed to reproduce a history-panel label.
 * It is metadata for the durable entry, not another replay operation.
 */
export function durableEntryProvenance(item: HistoryItem): DurableEntryProvenance {
  const sourceToolName =
    item.layerSource?.kind === 'tool'
      ? (item.layerSource.args as { toolName?: unknown } | undefined)?.toolName
      : item.actionName === TOOL_ACTION
        ? (item.args as { toolName?: unknown } | undefined)?.toolName
        : undefined;
  const toolName = typeof sourceToolName === 'string' ? sourceToolName : undefined;
  return Object.freeze({
    actionName: item.actionName,
    ...(toolName !== undefined ? { toolName } : {}),
  });
}

/**
 * The durable equivalent of `getHistoryItemTitle`. A bare TOOL_ACTION remains
 * untitled, matching the legacy panel rather than inventing the word "tool".
 */
export function durableEntryTitle(provenance: DurableEntryProvenance): string | undefined {
  if (provenance.toolName !== undefined) return provenance.toolName;
  if (provenance.actionName === TOOL_ACTION) return undefined;
  if (provenance.actionName === SET_DOCUMENT_FRAME_ACTION) return 'crop';
  if (provenance.actionName === SET_LAYER_OPACITY_ACTION) return 'set layer opacity';
  return provenance.actionName;
}
