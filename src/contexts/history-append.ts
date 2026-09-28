import { SELECTION_ACTION, SET_DOCUMENT_FRAME_ACTION, SHOW_LAYER_ACTION } from '../util/constants.ts';
import type { DocumentFrame } from './document-frame.ts';
import {
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

  return unavailable(
    entry,
    `The append boundary does not translate "${entry.actionName}" yet; the legacy entry remains authoritative.`,
    'unsupported-history-feature'
  );
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

/**
 * Proves the planned entry is the entry this legacy item must produce. A
 * disagreement is a defect in the writer, not a reason to reject the edit, so
 * the caller still falls back to the conversion and reports it.
 */
export function validatePlannedDurableEntry(entry: HistoryItem, planned: DurableHistoryEntry): string | null {
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

  const problem = validatePlannedDurableEntry(entry, planned);
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
