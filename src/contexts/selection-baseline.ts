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

/**
 * Structural guard for a durable selection snapshot, and the only definition of
 * what "readable" means for one.
 *
 * It sits beside {@link selectionSnapshot} — its own writer — so the read rule
 * and the write rule cannot drift, and it is shared rather than restated because
 * a `previousSelectionState` and a `nextSelectionState` are the same shape read
 * at two different places: one tolerance for the field, not a position-dependent
 * one.
 *
 * A key-absent `activeSelectionId` is ACCEPTED, because `replayHistory` reads it
 * as `next?.activeSelectionId ?? null` (`history-replay.ts`): a snapshot that
 * omits the id still retains its selections and only loses the active id.
 * Rejecting that shape here would make the shadow clear selections that legacy
 * replay keeps. The guard only asks whether the value can be read as a snapshot
 * at all; normalizing the id to `null` is the caller's job.
 */
export function isValidSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { selections?: unknown; activeSelectionId?: unknown };
  if (!Array.isArray(candidate.selections)) return false;
  const { activeSelectionId } = candidate;
  return activeSelectionId === undefined || activeSelectionId === null || typeof activeSelectionId === 'string';
}

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
 * The entry {@link deriveSelectionBaseline} seeds from: the FIRST non-disabled
 * `SELECTION_ACTION` on the timeline, or `null` when there is none.
 *
 * Published so a caller that has to REPORT something about the derivation —
 * which entry supplied the state, which one carried a state it could not read —
 * names the same entry the derivation read, instead of searching for it again
 * and reaching a second answer.
 */
export function selectionBaselineEntry(history: readonly HistoryItem[]): HistoryItem | null {
  return history.find((item) => item.actionName === SELECTION_ACTION && !item.disabled) ?? null;
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
 *
 * An UNREADABLE `previousSelectionState` falls back to the empty snapshot
 * rather than throwing, through the same {@link isValidSelectionSnapshot} guard
 * the per-entry derivation in `history-adapter.ts` reads `nextSelectionState`
 * through. The asymmetry that guard used to hide is closed: this entry is a
 * field read exactly like any other, and a `TypeError` out of it took the whole
 * conversion down — `document: null`, one `conversion-failed` diagnostic with no
 * `historyId`, and no undo for the document — while the identical value one
 * entry later was silently tolerated. Both callers read the state through this
 * function, so the fallback is not a divergence to be reported: legacy replay
 * seeds empty for the same reason the durable conversion does, which is the
 * parity this helper exists to keep. `SelectionSnapshot` types the field, so a
 * `{ selections: null }` here is already outside the contract; the tolerance is
 * the consequence, not an admission that the shape is valid.
 */
export function deriveSelectionBaseline(history: readonly HistoryItem[]): SelectionSnapshot {
  const previous = (selectionBaselineEntry(history)?.args as SelectionHistoryArgs | undefined)?.previousSelectionState;
  return isValidSelectionSnapshot(previous)
    ? selectionSnapshot(previous.selections, previous.activeSelectionId)
    : selectionSnapshot();
}
