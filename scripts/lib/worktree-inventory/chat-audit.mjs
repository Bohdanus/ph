/**
 * The READ audit: what each agent actually said it did, as opposed to what its
 * turn-shape and error count imply.
 *
 * WHY THIS EXISTS ALONGSIDE THE HEURISTIC
 * ---------------------------------------
 * `chats.mjs` classifies a session from its shape: did the last turn end on a
 * stop, how many tools errored, did it mention "Add credits". That is cheap and
 * it is necessary, but it cannot answer the only question an operator has —
 * *is the work finished* — because two agents with identical shape can have
 * delivered a merged branch and written a plan. It also cannot see the failure
 * that matters most here: an agent that reported "Done" for a branch that was
 * never merged, and which git then reports as clean and prunable.
 *
 * So the transcripts were read. `chat-audit.data.json` records, for every
 * top-level session in the window, the verdict from reading it: what it was
 * asked, what it actually delivered, whether the work exists on any ref, and
 * the specific mismatch when its own summary overstates what happened.
 *
 * THE TWO VERDICTS DELIBERATELY DISAGREE SOMETIMES
 * -------------------------------------------------
 * `chats.byState` is computed, `chats.readState` is observed, and both are
 * emitted. They are not reconciled, because reconciling them would require
 * trusting one over the other in exactly the cases where it matters. A reader
 * who wants to know whether to go and look at something has the observed
 * answer; a reader who wants to know why a session looks idle has the computed
 * one. Where they conflict, that is the finding.
 *
 * WHAT IS NOT HERE
 * ----------------
 * No session body, no tool arguments, no code. The audit records conclusions
 * about sessions, never their contents, so this file cannot leak a transcript
 * and cannot grow without bound as agents talk.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** States a reader can act on, in the order they demand attention. */
export const READ_STATE = {
  /** Still trying, or hit an obstacle it cannot get past. */
  STRUGGLING: 'struggling',
  /** Waiting on a human decision. Go answer it. */
  BLOCKED: 'blocked',
  /** Stopped without a conclusion. */
  ABANDONED: 'abandoned',
  /** Never did the work: died on credits, produced nothing. */
  FAILED: 'failed',
  /** The transcript does not say. */
  UNKNOWN: 'unknown',
  /** Completed. */
  FINISHED: 'finished',
};

export const READ_RISK = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

/**
 * Load the audit, or an empty set when it is missing.
 *
 * The inventory must still generate without it: the file is written by a human
 * pass over transcripts, and a machine that cannot find it should say so rather
 * than fall back to implying the heuristic is the whole truth.
 */
export function loadChatAudit(dataPath = defaultPath()) {
  try {
    const parsed = JSON.parse(readFileSync(dataPath, 'utf8'));
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) throw new Error('chat audit has no records array');
    return {
      available: true,
      path: dataPath,
      byId: new Map(records.map((r) => [r.id, r])),
      records,
      // When the transcripts were read. Every file count and `worktreeGone` in
      // here is true as of this moment and nothing later: agents commit, and
      // directories get deleted. Without the stamp a reader would take a
      // stale "on no ref" for a current fact, which is the one mistake this
      // whole exercise exists to prevent.
      asOf: Array.isArray(parsed) ? null : (parsed.asOf ?? null),
      windowStart: Array.isArray(parsed) ? null : (parsed.windowStart ?? null),
      windowHours: Array.isArray(parsed) ? null : (parsed.windowHours ?? null),
    };
  } catch (err) {
    // ENOENT and a parse error are different failures and must not read the
    // same. A corrupt hand-edited file used to report "no audit at the
    // expected path", so one bad edit silently removed the entire safety
    // signal while claiming it had never been there.
    return {
      available: false,
      path: dataPath,
      byId: new Map(),
      records: [],
      asOf: null,
      windowHours: null,
      reason: err.code === 'ENOENT' ? 'not found at the expected path' : `unreadable: ${err.message}`,
      corrupt: err.code !== 'ENOENT',
    };
  }
}

function defaultPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'chat-audit.data.json');
}

/**
 * How much would be lost if this session's work were discarded right now.
 *
 * `readRisk` is an INPUT, not a derivation. It is what a reader of the
 * transcript concluded, and this function does not re-derive or second-guess
 * it. An earlier version of this docstring claimed the deletion of a worktree
 * was a second route to a high rating, which would read to the next agent as a
 * mechanism that exists; it does not, and the data agrees — of the sessions
 * whose worktree is gone, 3 are high, 1 medium and 13 low, because a human
 * wrote the verdict.
 *
 * What this function does add is the two mechanical facts a reader wants
 * beside the judgement: whether the work is on no ref at all, and the raw
 * counts. A `null` in those counts means the directory no longer exists, and
 * `null > 0` is false — so a deleted worktree can never be reported as holding
 * work on no ref here, which is why that case gets its own top-level list
 * instead of being folded into this one.
 */
export function auditVerdict(record, { risk: readRisk = READ_RISK.LOW, worktreeGone = false } = {}) {
  const uniqueWorkOnlyHere = record.modifiedFiles > 0 && record.commitsAheadOfMain === 0;
  return {
    id: record.id,
    readState: record.readState,
    readRisk,
    note: record.note ?? null,
    // Explicit, because "0 ahead" is not a safety test and a reader who sees
    // these three fields must not have to recompute the conjunction.
    worktreeGone,
    untrackedFiles: record.untrackedFiles ?? 0,
    modifiedFiles: record.modifiedFiles ?? 0,
    // Kept as the raw value including null, because a deleted directory is
    // genuinely "unknown", and coercing it to 0 would claim the worktree was
    // clean — the exact false reassurance this file exists to prevent.
    commitsAheadOfMain: record.commitsAheadOfMain ?? null,
    workOnNoRef: uniqueWorkOnlyHere === true || record.untrackedFiles > 0,
    deadSubagents: record.deadSubagents,
    toolErrors: record.toolErrors,
  };
}

/**
 * Is this read state something a reader has to go and look at?
 *
 * `finished` is the only state that is not, which is the whole point: 81 of
 * the 105 sessions in the window came back `finished`, and the other 24 are
 * the reason this file exists.
 */
export function isReadUnfinished(state) {
  return state !== READ_STATE.FINISHED && state !== null && state !== undefined;
}

/** Sessions that are unfinished by the READ verdict, worst first. */
export function unread(records) {
  return records
    .filter((r) => isReadUnfinished(r.readState))
    .sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
}

function rank(r) {
  switch (r.readState) {
    case READ_STATE.STRUGGLING:
      return 5;
    case READ_STATE.BLOCKED:
      return 4;
    case READ_STATE.ABANDONED:
      return 3;
    case READ_STATE.FAILED:
      return 2;
    case READ_STATE.UNKNOWN:
      return 1;
    default:
      return 0;
  }
}
