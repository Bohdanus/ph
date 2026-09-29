import {
  REMOVE_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
} from '../util/constants.ts';
import type { DocumentFrame } from './document-frame.ts';
import {
  deriveRemoveLayerEntry,
  deriveSetDocumentFrameEntry,
  deriveSetLayerPropertiesEntry,
  deriveSetSelectionEntry,
  isSetLayerPropertiesAction,
  isEntryEnabled,
  layerPropertyKeyFor,
  type MigrationDiagnostic,
} from './history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  freezeDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  type SelectionSnapshot,
} from './history-model.ts';
import type { HistoryTimeline } from './history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';
import type { LayerId } from './layer-types.ts';

const EMPTY_SELECTIONS: SelectionSnapshot = Object.freeze({ selections: Object.freeze([]), activeSelectionId: null });

/**
 * Phase 1 append boundary.
 *
 * Input is normalized UI/tool arguments plus the current legacy timeline.
 * Output is exactly one legacy `HistoryItem` plus either one equivalent durable
 * entry or an explicit durable-unavailable diagnostic.
 *
 * The planned durable entry is published only when `StoreContext` proves that
 * its durable shadow still describes this append's legacy pre-state. Otherwise
 * the store falls back to a full conversion and keeps legacy history/runtime
 * authority unchanged.
 *
 * Invariants:
 *
 * 1. One append mints one entry id. A caller-supplied id is preserved so the
 *    durable entry carries the same id and the legacy-to-durable cursor map
 *    keeps its identity.
 * 2. Branch truncation, cursor mapping, and disabled-entry state stay with the
 *    single reducer transition. This boundary never rewrites the timeline, and
 *    the durable entry carries `enabled` so a publisher cannot drop that gate.
 * 3. Source ownership is untouched: the entry keeps the caller's raster
 *    references, and nothing here adopts, copies, or closes a bitmap. An action
 *    whose durable form needs an asset is therefore not translated yet.
 * 4. A document-frame change never moves layer world coordinates. The durable
 *    entry comes from the adapter's own derivation, so an invalid next frame
 *    yields no durable entry instead of a frame durable replay cannot use. A
 *    selection change is held to the same rule for the same reason: an entry
 *    whose `after` was invented would clear the selection on every durable
 *    replay, so an unusable next selection state yields no durable entry.
 * 5. A boundary failure can never reject or undo a legacy-valid edit. Every
 *    failure is reported as a durable-unavailable diagnostic.
 */
export type AppendBoundaryInput = Readonly<{
  item: NewHistoryItem;
  timeline: HistoryTimeline;
  currentFrame: DocumentFrame;
  /**
   * The selection state the durable model currently holds, used as the `before`
   * baseline when a selection entry carries no `previousSelectionState`.
   *
   * Optional so a caller with no selection context can still plan an entry, but
   * a publisher that actually passes the entry MUST pass the tracked state: a
   * defaulted empty `before` is a wrong baseline, not a harmless one.
   */
  currentSelections?: SelectionSnapshot;
  id?: string;
}>;

export type AppendBoundaryResult = Readonly<{
  entry: HistoryItem;
  /** `null` means the durable branch is unavailable for this append. */
  durableEntry: DurableHistoryEntry | null;
  diagnostics: readonly MigrationDiagnostic[];
}>;

function unavailable(entry: HistoryItem, message: string, code: MigrationDiagnostic['code']): AppendBoundaryResult {
  return {
    entry,
    durableEntry: null,
    diagnostics: [
      {
        historyId: entry.id,
        actionName: entry.actionName,
        severity: 'warning',
        code,
        message,
      },
    ],
  };
}

/**
 * `set-document-frame` is the first operation canonical in both models: it
 * carries no raster, no affine normalization, and no registry ownership, so the
 * writer's own arguments determine the durable entry completely. Deriving it
 * through the adapter's helper is what keeps the planned entry and the converted
 * entry from ever disagreeing.
 *
 * `currentFrame` must be the frame the durable model currently holds, which is
 * the last enabled durable frame. A live writer observes that frame unless the
 * previous entry is disabled, in which case a publisher must re-read it instead
 * of trusting the caller.
 *
 * `set-selection` joins it for the same reason, minus the raster: it carries only
 * the two snapshots the writer already has. The difference is what its derivation
 * refuses. A next selection state that is absent or unreadable produces no entry
 * at all, because the only alternative is an empty `after` that asserts "no
 * selection" for a state the model cannot read, so such an action reports
 * `unsupported-history-feature` exactly like any other untranslated action. Note
 * the deliberate contrast with the conversion in `legacyHistoryToDurable`, which
 * clears for parity with `replayHistory` on an absent state and voids the document
 * on an unreadable one; the boundary has no second authority to stay equal to, so
 * it reports in both cases.
 */
function translate(
  entry: HistoryItem,
  currentFrame: DocumentFrame,
  currentSelections: SelectionSnapshot
): AppendBoundaryResult {
  if (entry.actionName === SET_DOCUMENT_FRAME_ACTION) {
    if (entry.documentSource) {
      return unavailable(
        entry,
        'A document frame change cannot carry a document replacement; use REPLACE_DOCUMENT.',
        'document-replacement'
      );
    }
    const durableEntry = deriveSetDocumentFrameEntry(entry, currentFrame);
    if (!durableEntry) {
      return unavailable(entry, 'A document frame change requires a valid next frame.', 'invalid-history-entry');
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (entry.actionName === SELECTION_ACTION) {
    const durableEntry = deriveSetSelectionEntry(entry, currentSelections);
    if (!durableEntry) {
      // A selection action whose next state is missing or unusable is one this
      // boundary does not translate, so it takes the same unsupported path as
      // every other untranslated action rather than a frame-specific code. The
      // durable model never fabricates a cleared selection to make room for it.
      return unavailable(
        entry,
        'A selection change without a valid next selection state has no durable translation; the durable model never fabricates a cleared selection.',
        'unsupported-history-feature'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (isSetLayerPropertiesAction(entry.actionName)) {
    const durableEntry = deriveSetLayerPropertiesEntry(entry);
    if (!durableEntry) {
      return unavailable(
        entry,
        `The ${entry.actionName} entry does not carry a valid layer-property value.`,
        'invalid-history-entry'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (entry.actionName === REMOVE_ACTION) {
    // Layer presence is deliberately not a precondition here or in validation:
    // conversion and both replay models retain unknown removals as no-ops, and
    // `replayHistory` filters the id out of the layer record rather than
    // refusing the entry (`history-replay.ts:138`). The derivation is the parity
    // path, so it has no refusal to make for a layer the document never held.
    // This guard is therefore a narrowing guard, not a check: the derivation
    // returns null only for an action that is not a removal, which this arm has
    // already excluded, so the branch below cannot be reached today.
    const durableEntry = deriveRemoveLayerEntry(entry);
    if (!durableEntry) {
      return unavailable(
        entry,
        'The removal could not be described as a durable operation, so the legacy entry remains authoritative.',
        'invalid-history-entry'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  return unavailable(
    entry,
    `The append boundary does not translate "${entry.actionName}" yet; the legacy entry remains authoritative.`,
    'unsupported-history-feature'
  );
}

/**
 * The durable order a legacy reorder must produce, recomputed here rather than
 * read out of `legacyHistoryToDurable`.
 *
 * A reorder is the one translated action whose durable operation cannot be a
 * function of the history item: `orderByLayerId` names the resulting position of
 * *every* layer, and the item carries only the intent. So the answer has to come
 * from the pre-append layer order, and the only trustworthy copy of that is the
 * store's live record — a hook closure is 200 ms stale by the time a drag
 * dispatches.
 *
 * This is deliberately a second implementation of the rule rather than a call
 * into the converter's. Reusing the converter's copy would make a bug in it
 * reproduce itself here, which is the opposite of a check. Two copies can drift,
 * so `history-append.reorder.test.ts` pins them against each other over a
 * matrix of orders and intents, and the store test pins the published document
 * against a full conversion.
 *
 * `preOrder` is the layer sequence bottom first — index 0 is the bottom of the
 * stack — which is the same sequence `reorderLayers` and `replayHistory` operate
 * on, and the same one the converter normalizes its own layer snapshots into.
 *
 * A `null` result is the one answer this function refuses: the mover is not in
 * the document, a named anchor is not, or the anchor is the mover itself. All
 * three of the first two are already agreed no-ops rather than placements
 * (`replayHistory` skips, `reorderLayers` refuses, the converter records
 * nothing), so a refusal must not become a fabricated map. Returning `null`
 * routes the append to conversion, which is where that no-op belongs.
 *
 * A self-anchored move is refused for a different reason, and the reason is a
 * known disagreement rather than a settled rule. `reorderLayers` anchors on the
 * layer's own order, shifts everything above it, and then re-assigns the layer —
 * so the resulting *sequence* is unchanged and only the sparse order values
 * move. The converter drops the mover from the list first, so its `indexOf` is
 * -1 and it records a move to the bottom. Executed, not assumed: on a stack
 * ordered bottom-first as `a, b, c`, a self-anchored move of `c` leaves the
 * document reading `a, b, c` and the converter recording `c, a, b`. (The two
 * agree when the mover is already the bottom layer, so the disagreement is a
 * function of the stack, not a blanket one.)
 *
 * This boundary is written to agree with the converter rather than to become a
 * third opinion, and the two implementations of the durable rule are pinned
 * against each other, so returning the sequence-preserving map here would break
 * that pin. It is recorded in `HANDOFF.md` as a conversion defect; fixing it
 * means changing the converter and this function together.
 *
 * Note what the refusal does and does not buy. It stops THIS append from
 * publishing, and the reconversion it falls back to leaves the shadow ordered
 * the converter's way while the document keeps the sequence it had — so the two
 * models now disagree. That disagreement is caught by the `durableLayerOrder`
 * precondition on the NEXT append, not by this refusal. The refusal is the
 * first line; the order comparison is what actually keeps a publication and a
 * reconversion interchangeable.
 */
export function reorderOrderAfterIntent(
  preOrder: readonly LayerId[],
  intent: { layerToMoveId: LayerId; afterWhichLayerId?: LayerId | null }
): Readonly<Record<LayerId, number>> | null {
  if (!intent.layerToMoveId) return null;
  if (!preOrder.includes(intent.layerToMoveId)) return null;
  if (intent.afterWhichLayerId && !preOrder.includes(intent.afterWhichLayerId)) return null;
  // The anchor is the mover. See the doc block: the document keeps the sequence
  // and the converter does not, and this function does not get to pick.
  if (intent.afterWhichLayerId === intent.layerToMoveId) return null;

  const remaining = preOrder.filter((id) => id !== intent.layerToMoveId);
  // A falsy anchor means the bottom, which is index 0 here. A named anchor is
  // known to be present, so `indexOf` cannot be -1 and the `+ 1` is its slot.
  const targetIndex = intent.afterWhichLayerId ? remaining.indexOf(intent.afterWhichLayerId) + 1 : 0;
  remaining.splice(targetIndex, 0, intent.layerToMoveId);
  return Object.freeze(Object.fromEntries(remaining.map((id, index) => [id, index])));
}

/**
 * The durable entry for a legacy reorder, or `null` when the append is not a
 * reorder or the intent does not apply to the store's layer order.
 *
 * `preOrder` is `null`/absent at every caller that cannot see the live record —
 * including `planHistoryAppend`, which is why reorder is absent from
 * `translate` and planned at the store boundary instead.
 */
export function deriveReorderLayersEntry(
  item: HistoryItem,
  preOrder: readonly LayerId[] | null | undefined
): DurableHistoryEntry | null {
  if (item.actionName !== REORDER_ACTION) return null;
  if (!preOrder) return null;
  const args = item.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
  const layerToMoveId = args?.layerToMoveId;
  if (!layerToMoveId) return null;
  const orderByLayerId = reorderOrderAfterIntent(preOrder, {
    layerToMoveId,
    afterWhichLayerId: args?.afterWhichLayerId,
  });
  if (!orderByLayerId) return null;
  return Object.freeze({
    id: item.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: isEntryEnabled(item),
    operation: Object.freeze({ kind: 'reorder-layers' as const, orderByLayerId }),
  });
}

function validateTimeline(entry: HistoryItem, timeline: HistoryTimeline): MigrationDiagnostic | null {
  if (timeline.entries.some((candidate) => candidate.id === entry.id)) {
    return {
      historyId: entry.id,
      actionName: entry.actionName,
      severity: 'error',
      code: 'invalid-history-entry',
      message: 'A history entry id must be unique within a document timeline.',
    };
  }
  if (!Number.isInteger(timeline.cursor) || timeline.cursor < 0 || timeline.cursor >= timeline.entries.length) {
    return {
      historyId: entry.id,
      actionName: entry.actionName,
      severity: 'error',
      code: 'invalid-history-entry',
      message: 'The append point is outside the legacy timeline, so durable cursor mapping is undefined.',
    };
  }
  return null;
}

export function planHistoryAppend({
  item,
  timeline,
  currentFrame,
  currentSelections = EMPTY_SELECTIONS,
  id,
}: AppendBoundaryInput): AppendBoundaryResult {
  const entry = createHistoryItem(item, id);
  const result = translate(entry, currentFrame, currentSelections);
  const timelineDiagnostic = validateTimeline(entry, timeline);
  if (!timelineDiagnostic) return result;
  return {
    entry: result.entry,
    durableEntry: result.durableEntry,
    diagnostics: [...result.diagnostics, timelineDiagnostic],
  };
}

/**
 * Single-writer publication of a planned durable entry.
 *
 * The planned entry is published only when the store's durable document still
 * describes exactly the legacy timeline the append is based on. Anything else
 * (a redo truncation, a replay, a document replacement, a revision that moved
 * without a rebuild) falls back to the full conversion, so the shadow is never
 * patched against a stale base.
 */
export type DurableAppendDecision =
  | Readonly<{ outcome: 'published'; document: DurableDocument }>
  | Readonly<{ outcome: 'preconditions'; reason: string }>
  | Readonly<{ outcome: 'mismatch'; reason: string }>;

export type DurableAppendInput = Readonly<{
  documentId: string;
  /** The durable document the store currently holds, or null when unavailable. */
  base: DurableDocument | null;
  /** The legacy timeline before the append. */
  prior: HistoryTimeline;
  /** The legacy timeline after the append. */
  next: HistoryTimeline;
  /** The entry the writer appended. */
  entry: HistoryItem;
  /** The entry the boundary planned for it, if any. */
  planned?: DurableHistoryEntry | null;
  documentRevision: number;
  /**
   * The store's authoritative pre-append layer order, bottom first.
   *
   * A reorder is the only published action that needs it, because its operation
   * names the resulting order of every layer rather than a change to one of
   * them. It is supplied by the store from the live record, never by a writer.
   */
  preLayerOrder?: readonly LayerId[] | null;
  /**
   * The layer ids the durable document itself holds at its cursor, in the order
   * its own snapshots sort into.
   *
   * A reorder map is keyed on the whole layer set, and durable replay silently
   * skips ids it does not know (`durable-replay.ts`), so a map derived from a
   * layer set the shadow does not share would renumber the layers the two models
   * do agree on and leave the shadow ordered differently from the document. The
   * store supplies the comparison so this module never has to replay anything.
   *
   * The ORDER is compared, not just the membership, and the difference is the
   * whole point. A published map is a fresh normalisation of the order, so it
   * overwrites whatever order the shadow had; publishing it while the two models
   * already disagree about the order launders that disagreement into a document
   * no reconversion will reproduce. Sequence equality is what makes a publication
   * and a reconversion interchangeable.
   */
  durableLayerOrder?: readonly LayerId[] | null;
}>;

function sameFrame(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftFrame = left as Record<string, unknown>;
  const rightFrame = right as Record<string, unknown>;
  return (
    leftFrame.x === rightFrame.x &&
    leftFrame.y === rightFrame.y &&
    leftFrame.width === rightFrame.width &&
    leftFrame.height === rightFrame.height
  );
}

/**
 * Structural comparison of a plain JSON value, key-order independent.
 *
 * The durable selection snapshots are rebuilt by spread and `Object.fromEntries`
 * on their way into the document, so key order is not a stable identity. This
 * compares shape and values only, and never throws on an unexpected value: a
 * disagreement is reported, not raised.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]))
    );
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return (
    leftKeys.length === Object.keys(rightRecord).length &&
    leftKeys.every((key) => key in rightRecord && sameJsonValue(leftRecord[key], rightRecord[key]))
  );
}

function sameSelection(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftSelection = left as Record<string, unknown>;
  const rightSelection = right as Record<string, unknown>;
  return (
    leftSelection.id === rightSelection.id &&
    leftSelection.isActive === rightSelection.isActive &&
    leftSelection.lifecycle === rightSelection.lifecycle &&
    leftSelection.geometry === rightSelection.geometry &&
    leftSelection.sourceTool === rightSelection.sourceTool &&
    sameJsonValue(leftSelection.points, rightSelection.points) &&
    sameJsonValue(leftSelection.pos, rightSelection.pos) &&
    sameJsonValue(leftSelection.metadata, rightSelection.metadata)
  );
}

/**
 * The selection twin of `sameFrame`: a structural proof that a planned snapshot
 * is the snapshot the legacy item must produce, without depending on which of
 * the two deep-copied it is.
 *
 * `activeSelectionId` is compared through `?? null` because both the derivation
 * and `replayHistory` (`history-replay.ts:102`) read a key-absent id as `null`.
 * A strict `!==` would report a mismatch between a legacy arg that omits the key
 * and the normalized planned entry, degrading a correct append to reconversion.
 */
function sameSelectionSnapshot(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftSnapshot = left as { selections?: unknown; activeSelectionId?: unknown };
  const rightSnapshot = right as { selections?: unknown; activeSelectionId?: unknown };
  if ((leftSnapshot.activeSelectionId ?? null) !== (rightSnapshot.activeSelectionId ?? null)) return false;
  if (!Array.isArray(leftSnapshot.selections) || !Array.isArray(rightSnapshot.selections)) return false;
  const leftSelections = leftSnapshot.selections;
  const rightSelections = rightSnapshot.selections;
  if (leftSelections.length !== rightSelections.length) return false;
  return leftSelections.every((selection, index) => sameSelection(selection, rightSelections[index]));
}

function sameOrderMap(left: Readonly<Record<LayerId, number>>, right: Readonly<Record<LayerId, number>>): boolean {
  const leftIds = Object.keys(left);
  if (leftIds.length !== Object.keys(right).length) return false;
  return leftIds.every((id) => left[id] === right[id]);
}

/** Two layer sequences are equal when they name the same ids in the same order. */
function sameLayerSequence(left: readonly LayerId[], right: readonly LayerId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Proves the planned entry is the entry this legacy item must produce. A
 * disagreement is a defect in the writer, not a reason to reject the edit, so
 * the caller still falls back to the conversion and reports it.
 *
 * `preLayerOrder` is the reorder branch's independent source. Note what that
 * does and does not buy: it catches a `durableEntry` that was built or supplied
 * somewhere other than the store boundary, which is the case that can actually
 * occur, because it is fed the store's record rather than the plan's own output.
 * It does not make `reorderOrderAfterIntent` self-proving — the parity test
 * against the converter, and the store test against a full conversion, are.
 */
export function validatePlannedDurableEntry(
  entry: HistoryItem,
  planned: DurableHistoryEntry,
  preLayerOrder?: readonly LayerId[] | null
): string | null {
  if (planned.schemaVersion !== DURABLE_SCHEMA_VERSION) return `durable schema version ${planned.schemaVersion}`;
  if (planned.id !== entry.id) return `durable entry id ${planned.id} does not match the legacy entry id ${entry.id}`;
  if (planned.enabled !== isEntryEnabled(entry)) return 'the durable enabled state does not match the legacy entry';

  if (entry.actionName === SET_DOCUMENT_FRAME_ACTION) {
    if (planned.operation.kind !== 'set-document-frame') {
      return `a document frame change produced a "${planned.operation.kind}" operation`;
    }
    const args = entry.args as { previousFrame?: DocumentFrame; nextFrame?: DocumentFrame } | undefined;
    if (!args?.nextFrame) return 'a document frame change has no next frame';
    if (!sameFrame(planned.operation.next, args.nextFrame))
      return 'the durable next frame does not match the legacy entry';
    if (args.previousFrame && !sameFrame(planned.operation.previous, args.previousFrame)) {
      return 'the durable previous frame does not match the legacy entry';
    }
    return null;
  }

  if (entry.actionName === SELECTION_ACTION) {
    if (planned.operation.kind !== 'set-selection') {
      return `a selection change produced a "${planned.operation.kind}" operation`;
    }
    // `after` is unconditional: it is the state durable replay applies, so a
    // disagreement here is a wrong entry even when the legacy item is bare.
    // `before` is only a baseline, so it is checked when the legacy item
    // actually supplies one — the same treatment the frame branch gives
    // `previousFrame`, and the same reason the boundary may default it.
    const args = entry.args as
      { previousSelectionState?: SelectionSnapshot; nextSelectionState?: SelectionSnapshot } | undefined;
    if (!args?.nextSelectionState) return 'a selection change has no next selection state';
    if (!sameSelectionSnapshot(planned.operation.after, args.nextSelectionState)) {
      return 'the durable next selection state does not match the legacy entry';
    }
    if (args.previousSelectionState && !sameSelectionSnapshot(planned.operation.before, args.previousSelectionState)) {
      return 'the durable previous selection state does not match the legacy entry';
    }
    return null;
  }

  if (entry.actionName === REORDER_ACTION) {
    if (planned.operation.kind !== 'reorder-layers') {
      return `a layer reorder produced a "${planned.operation.kind}" operation`;
    }
    const args = entry.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
    const layerToMoveId = args?.layerToMoveId;
    if (!layerToMoveId) return 'a layer reorder has no moving layer id';
    if (!preLayerOrder) return 'a layer reorder was checked without the store layer order it was planned against';
    const expected = reorderOrderAfterIntent(preLayerOrder, {
      layerToMoveId,
      afterWhichLayerId: args?.afterWhichLayerId,
    });
    // The refusal cases never reach here: `decideDurableAppend` sends a reorder
    // whose intent does not apply down the `preconditions` path before it calls
    // this. Grading one as a mismatch would report a writer defect for an append
    // that is behaving exactly as legacy replay does.
    if (!expected) return 'the layer reorder names a layer the document does not hold';
    return sameOrderMap(planned.operation.orderByLayerId, expected)
      ? null
      : 'the durable layer order does not match the store order';
  }

  if (isSetLayerPropertiesAction(entry.actionName)) {
    if (planned.operation.kind !== 'set-layer-properties') {
      return `a layer-property change produced a "${planned.operation.kind}" operation`;
    }
    const { layerId, patch } = planned.operation;
    if (layerId !== entry.layerId) return 'the durable layer id does not match the legacy entry';
    // Checked against the legacy entry, not against a second call to the
    // derivation that produced this plan: re-deriving would compare a value
    // with itself and could only ever catch a hand-supplied entry, never a
    // defect in the derivation. Exactly one key, and that key's value read
    // from the action and the legacy args.
    if (Object.keys(patch).length !== 1) {
      return 'the durable layer-property operation does not match the legacy entry';
    }
    // Exhaustive on the owned key rather than `name` versus "everything else":
    // an action that owned some other property would otherwise be graded
    // against `visible` and reported as a mismatch for a correct entry.
    switch (layerPropertyKeyFor(entry.actionName)) {
      case 'name': {
        const name = (entry.args as { name?: unknown } | undefined)?.name;
        if (typeof name !== 'string') return 'the layer-property value is invalid';
        if (patch.name !== name) return 'the durable layer name does not match the legacy entry';
        return null;
      }
      case 'visible':
        return patch.visible === (entry.actionName === SHOW_LAYER_ACTION)
          ? null
          : 'the durable layer visibility does not match the legacy entry';
      default:
        return 'the action does not own a durable layer property';
    }
  }

  if (entry.actionName === REMOVE_ACTION) {
    if (planned.operation.kind !== 'remove-layer') {
      return `a layer removal produced a "${planned.operation.kind}" operation`;
    }
    const operationKeys = Object.keys(planned.operation);
    if (operationKeys.length !== 2 || !operationKeys.includes('kind') || !operationKeys.includes('layerId')) {
      return 'the durable remove-layer operation does not have the canonical shape';
    }
    return planned.operation.layerId === entry.layerId ? null : 'the durable layer id does not match the legacy entry';
  }

  return `no durable translation is published for "${entry.actionName}" yet`;
}

export function decideDurableAppend({
  documentId,
  base,
  prior,
  next,
  entry,
  planned,
  documentRevision,
  preLayerOrder,
  durableLayerOrder,
}: DurableAppendInput): DurableAppendDecision {
  if (!planned) return { outcome: 'preconditions', reason: 'no durable entry was planned for this append' };
  if (!base) return { outcome: 'preconditions', reason: 'the durable document is unavailable' };
  if (base.documentId !== documentId) return { outcome: 'preconditions', reason: 'the durable document is stale' };
  if (base.documentRevision !== documentRevision) {
    return { outcome: 'preconditions', reason: 'the durable document was built for another document revision' };
  }
  if (base.branchRevision !== prior.branchRevision) {
    return { outcome: 'preconditions', reason: 'the durable document was built for another branch' };
  }
  if (prior.cursor !== prior.entries.length - 1) {
    return { outcome: 'preconditions', reason: 'the append is not at the tip of the legacy timeline' };
  }
  if (next.entries.length !== prior.entries.length + 1) {
    return { outcome: 'preconditions', reason: 'the append truncated the legacy timeline' };
  }
  if (next.cursor !== next.entries.length - 1) {
    return { outcome: 'preconditions', reason: 'the append is not the legacy cursor' };
  }
  if (next.entries[next.entries.length - 1] !== entry) {
    return { outcome: 'preconditions', reason: 'the appended entry is not the one that was planned' };
  }

  // A reorder is the only publication whose correctness depends on the whole
  // layer order, so it is the only one that has to prove it. The refusal is a
  // precondition rather than a mismatch: it describes a store that cannot answer
  // the question, not a writer that answered it wrongly, and the conversion that
  // replaces it already handles the no-op correctly.
  //
  // Of the three, only the sequence comparison is reachable from the store: it
  // supplies an array for the store order by construction, and the base it reads
  // the durable order from was already required non-null above. The other two are
  // the module's API contract — a caller that cannot see the live record has no
  // way to publish a reorder, and must be told that rather than be trusted.
  if (entry.actionName === REORDER_ACTION) {
    if (!preLayerOrder) {
      return { outcome: 'preconditions', reason: 'a layer reorder needs the store layer order it was planned against' };
    }
    if (!durableLayerOrder) {
      return {
        outcome: 'preconditions',
        reason: 'a layer reorder needs the durable layer order to compare the store order against',
      };
    }
    if (!sameLayerSequence(durableLayerOrder, preLayerOrder)) {
      return {
        outcome: 'preconditions',
        reason: 'the durable document and the store record disagree about the layer order',
      };
    }
  }

  const problem = validatePlannedDurableEntry(entry, planned, preLayerOrder);
  if (problem) return { outcome: 'mismatch', reason: problem };

  const cursor = base.history.length;
  // The durable cursor is the legacy-to-durable map of the appended entry, and a
  // skipped legacy entry can only make it lag. It can never lead.
  if (cursor > next.cursor)
    return { outcome: 'preconditions', reason: 'the durable cursor would lead the legacy cursor' };

  return {
    outcome: 'published',
    document: freezeDurableDocument({
      ...base,
      documentRevision,
      branchRevision: next.branchRevision,
      durableRevision: base.durableRevision + 1,
      history: [...base.history, planned],
      cursor,
    }),
  };
}

export function durableAppendDiagnostic(entry: HistoryItem, reason: string): MigrationDiagnostic {
  return {
    historyId: entry.id,
    actionName: entry.actionName,
    severity: 'error',
    code: 'durable-append-mismatch',
    message: `The planned durable entry was not published: ${reason}. The durable state was rebuilt from the legacy timeline instead.`,
  };
}
