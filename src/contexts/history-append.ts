import { SET_DOCUMENT_FRAME_ACTION } from '../util/constants.ts';
import type { DocumentFrame } from './document-frame.ts';
import { deriveSetDocumentFrameEntry, isEntryEnabled, type MigrationDiagnostic } from './history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  freezeDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
} from './history-model.ts';
import type { HistoryTimeline } from './history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';

/**
 * Phase 1 append boundary.
 *
 * Input is normalized UI/tool arguments plus the current legacy timeline.
 * Output is exactly one legacy `HistoryItem` plus either one equivalent durable
 * entry or an explicit durable-unavailable diagnostic.
 *
 * Phase 1 status: plan only. The durable entry is derived at the append point but
 * is not published. `StoreContext` still converts the whole timeline into the
 * diagnostic shadow, so publishing the planned entry here would create a second
 * writer for a single append. The next slice passes the planned entry through
 * `COMMIT_DOCUMENT_EDIT` and adopts it for one action at a time.
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
 *    yields no durable entry instead of a frame durable replay cannot use.
 * 5. A boundary failure can never reject or undo a legacy-valid edit. Every
 *    failure is reported as a durable-unavailable diagnostic.
 */
export type AppendBoundaryInput = Readonly<{
  item: NewHistoryItem;
  timeline: HistoryTimeline;
  currentFrame: DocumentFrame;
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
 */
function translate(entry: HistoryItem, currentFrame: DocumentFrame): AppendBoundaryResult {
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

export function planHistoryAppend({ item, timeline, currentFrame, id }: AppendBoundaryInput): AppendBoundaryResult {
  const entry = createHistoryItem(item, id);
  const result = translate(entry, currentFrame);
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
 * Proves the planned entry is the entry this legacy item must produce. A
 * disagreement is a defect in the writer, not a reason to reject the edit, so
 * the caller still falls back to the conversion and reports it.
 */
export function validatePlannedDurableEntry(entry: HistoryItem, planned: DurableHistoryEntry): string | null {
  if (planned.schemaVersion !== DURABLE_SCHEMA_VERSION) return `durable schema version ${planned.schemaVersion}`;
  if (planned.id !== entry.id) return `durable entry id ${planned.id} does not match the legacy entry id ${entry.id}`;
  if (planned.enabled !== isEntryEnabled(entry)) return 'the durable enabled state does not match the legacy entry';

  if (entry.actionName !== SET_DOCUMENT_FRAME_ACTION) {
    return `no durable translation is published for "${entry.actionName}" yet`;
  }
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
