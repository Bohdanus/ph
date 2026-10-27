import { SET_DOCUMENT_FRAME_ACTION, SET_LAYER_OPACITY_ACTION, TOOL_ACTION } from '../util/constants.ts';
import type { DurableEntryProvenance } from './history-model.ts';
import type { HistoryItem } from './history-types.ts';

function readDataProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

/**
 * Carries only the legacy identity needed to reproduce a history-panel label.
 * It is metadata for the durable entry, not another replay operation.
 */
export function durableEntryProvenance(item: HistoryItem): DurableEntryProvenance {
  const actionName = readDataProperty(item, 'actionName');
  const layerSource = readDataProperty(item, 'layerSource');
  const sourceKind = readDataProperty(layerSource, 'kind');
  const sourceToolName =
    sourceKind === 'tool'
      ? readDataProperty(readDataProperty(layerSource, 'args'), 'toolName')
      : actionName === TOOL_ACTION
        ? readDataProperty(readDataProperty(item, 'args'), 'toolName')
        : undefined;
  const toolName = typeof sourceToolName === 'string' ? sourceToolName : undefined;
  return Object.freeze({
    actionName: actionName as HistoryItem['actionName'],
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
