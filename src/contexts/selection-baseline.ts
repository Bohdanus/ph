import { SELECTION_ACTION } from '../util/constants.ts';
import type { Selection } from './general-types.ts';
import type { SelectionSnapshot } from './history-model.ts';
import type { HistoryItem } from './history-types.ts';

/**
 * The selection payload carried by a legacy `SELECTION_ACTION` entry. Both the
 * baseline and the per-entry transition are read through this one shape so the
 * legacy replay and the durable conversion cannot disagree about the field
 * names.
 */
export type SelectionHistoryArgs = {
  previousSelectionState?: SelectionSnapshot;
  nextSelectionState?: SelectionSnapshot;
};

function cloneSelection(selection: Selection): Selection {
  return {
    ...selection,
    points: selection.points.map((point) => ({ ...point })),
    pos: { ...selection.pos },
    ...(selection.metadata ? { metadata: JSON.parse(JSON.stringify(selection.metadata)) } : {}),
  };
}

/**
 * The shared owner of the selection baseline rule, and the clone both replay
 * paths use to keep a selection snapshot off the legacy history args.
 *
 * `points`, `pos`, and `metadata` are deep-copied and the wrapper and the
 * selections array are frozen, so nothing returned here aliases the array it
 * was given. The `Selection` elements and their nested objects are copied but
 * not frozen; the durable model deep-freezes those itself when it clones an
 * operation.
 */
export function selectionSnapshot(
  selections: readonly Selection[] = [],
  activeSelectionId: string | null = null
): SelectionSnapshot {
  return Object.freeze({
    selections: Object.freeze(selections.map(cloneSelection)),
    activeSelectionId,
  });
}

/**
 * The single derivation of the selection state a legacy timeline starts from.
 *
 * The lookup is deliberately unbounded. A selection is created by a gesture that
 * writes no history entry, so the first non-disabled `SELECTION_ACTION` entry's
 * `previousSelectionState` is the only record that the selection ever existed;
 * bounding this at a replay target would make undoing a tool-switch deselect a
 * silent visual no-op. The same reasoning is why the durable baseline is seeded
 * from the same unbounded lookup, so both branches agree at every cursor.
 */
export function deriveSelectionBaseline(history: readonly HistoryItem[]): SelectionSnapshot {
  const first = history.find((item) => item.actionName === SELECTION_ACTION && !item.disabled);
  const previous = (first?.args as SelectionHistoryArgs | undefined)?.previousSelectionState;
  return selectionSnapshot(previous?.selections, previous?.activeSelectionId ?? null);
}
