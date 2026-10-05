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
 * The lookup is unbounded and takes the timeline wholesale, so the durable
 * baseline and the legacy replay start from the same snapshot at every cursor.
 * That parity is what `0659ce92` extracted this helper to own.
 *
 * WHY IT IS UNBOUNDED, and the premise that used to be given for it is retired.
 * It was: "a selection is created by a gesture that writes no history entry",
 * which held when `0659ce92` was written and stopped holding two minutes later,
 * in `00a170dc`, which routed every selection gesture through
 * `useSelectionHistory` and made creation record itself. No production path can
 * put a selection in the store that history does not record: the six raw
 * selection actions have no dispatch site outside the reducer, and
 * `REPLACE_DOCUMENT` seeds `selections: []`. So the counterfactual this comment
 * used to argue from — bounding the lookup turns undoing a deselect into a
 * silent visual no-op — describes a state the app can no longer reach.
 *
 * The rule is unchanged because bounding it is a separate decision, not a
 * comment fix. Three tests pin it, all built on fixtures production cannot
 * construct, and they must be retired in the same change as any bound:
 * HANDOFF.md §31 names two of the three. This comment records why the argument
 * for keeping it is weaker than it reads; it is not itself a recommendation.
 */
export function deriveSelectionBaseline(history: readonly HistoryItem[]): SelectionSnapshot {
  const first = history.find((item) => item.actionName === SELECTION_ACTION && !item.disabled);
  const previous = (first?.args as SelectionHistoryArgs | undefined)?.previousSelectionState;
  return selectionSnapshot(previous?.selections, previous?.activeSelectionId ?? null);
}
