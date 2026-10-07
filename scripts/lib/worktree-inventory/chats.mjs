/**
 * The chat side of the inventory: which Kilo sessions ran in each worktree,
 * which of them are still going, which stopped with work unfinished, which are
 * wedged on a question, and which died.
 *
 * WHY READ THE DATABASE RATHER THAN ASK A RUNNING AGENT
 * -----------------------------------------------------
 * A live agent knows what it is doing. It cannot know what happened in the
 * eleven other worktrees while it was blocked, and the sessions that most need
 * reporting — the ones that died, and the ones whose worktree was deleted
 * underneath them — are by definition not running and will never answer. The
 * session database is the only place that history exists.
 *
 * WHAT COUNTS AS "DEAD", PRECISELY
 * ---------------------------------
 * Four distinct failures look identical from the outside and are separated here
 * because they need different responses:
 *
 * - `rejected-credits` — the launcher's model resolved to a paid GPT model, so
 *   the subagent died at zero tokens with `APIError: Add credits to continue`.
 *   This repository hit this 213 times in 48h because a free orchestrator sent
 *   bare model names that the gateway resolved to `~openai/gpt-luna-latest`.
 *   The work never started; there is nothing to salvage and the fix is the
 *   caller's, not the dead session's.
 * - `died-at-birth` — zero output tokens and no assistant reply. The session
 *   row exists, the work does not.
 * - `orphaned` — the session's worktree directory no longer exists. Whatever
 *   it produced is on whatever ref it produced it on, and nothing else.
 * - `abandoned-midflight` — the last turn ended in a tool call rather than a
 *   stop, so the agent was still working when the session was closed.
 *
 * `blocked` is separate from all of those: the session is alive and waiting on
 * a human answer to a question, and is the one category where the fix is simply
 * to go answer it.
 *
 * Every query below is bounded by a time window. The session queries are also
 * bounded to `parent_id IS NULL`, so subagent sessions are never returned as
 * records — but the `step-finish` scan is NOT, because a subagent's turn
 * boundary is not the parent's, and the parent's own last turn is the thing
 * that classifies it. A 24 h audit over this repository's database costs tens
 * of seconds, dominated by two unindexed `LIKE` scans over `part`; that is
 * why the window is a flag and why the queries are not run per worktree.
 */

import { DatabaseSync } from 'node:sqlite';
import { LIVE_WINDOW_MS } from './classify.mjs';

/**
 * Every chat state that means an agent has NOT finished, in one place.
 *
 * This list was previously written out three times — here, in `classify.mjs`
 * and in `assemble.mjs` — with one copy as a negation of another. They agreed
 * only by hand, and nothing tested the agreement, so a fourth state added to
 * one copy would have been silently invisible in `unfinished`. It is exported
 * now so the three cannot drift.
 */
export const UNFINISHED_STATES = new Set([
  'active',
  'abandoned-midflight',
  'died-at-birth',
  'rejected-credits',
  'orphaned',
  'blocked',
]);

/** The subset that will never produce anything again. */
export const DEAD_STATES = new Set(['died-at-birth', 'rejected-credits', 'orphaned']);

/** True when a session has stopped with work outstanding. */
export function isUnfinished(session) {
  return UNFINISHED_STATES.has(session.state);
}

/** True when a session is gone for good and holds nothing recoverable. */
export function isDead(session) {
  return DEAD_STATES.has(session.state);
}

/** Where the Kilo session database lives. `KILO_DB` overrides it for tests. */
export function resolveSessionDb(home = process.env.HOME) {
  return process.env.KILO_DB || `${home}/.local/share/kilo/kilo.db`;
}

/**
 * Open the session database read-only, or return `null` when it is absent.
 *
 * A missing database is not an error: the inventory must still generate on a
 * machine with no Kilo history, with every chat field empty and a
 * `dataSources` entry saying why.
 */
function openDb(dbPath) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * Every top-level session whose last activity falls inside the window,
 * keyed for grouping by the worktree directory it ran in.
 */
function readSessions(db, sinceMs) {
  return db
    .prepare(
      `SELECT id, directory, title, parent_id, agent, slug,
              tokens_output, tokens_input, time_created, time_updated, time_archived
         FROM session
        WHERE parent_id IS NULL AND time_updated >= ?`
    )
    .all(sinceMs)
    .map((r) => ({
      id: r.id,
      directory: r.directory,
      title: r.title,
      agent: r.agent,
      slug: r.slug,
      tokensOutput: r.tokens_output,
      tokensInput: r.tokens_input,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
      timeArchived: r.time_archived,
    }));
}

/** How many subagent sessions each top-level session spawned. */
function readSubagentCounts(db, sinceMs) {
  return db
    .prepare(
      `SELECT parent_id, COUNT(*) AS n
         FROM session
        WHERE parent_id IS NOT NULL AND time_created >= ?
        GROUP BY parent_id`
    )
    .all(sinceMs)
    .map((row) => [row.parent_id, row.n]);
}

/**
 * The failure reason for each session, derived from the last turn's shape.
 *
 * `step-finish` rows carry the reason a turn ended: `stop` is the agent
 * choosing to finish, `tool-calls` means it stopped to call a tool, and
 * `length` means the model's output was cut off. A session whose last turn was
 * `tool-calls` never got to summarise, which is the machine-readable form of
 * "stopped with work unfinished".
 *
 * Combined into one query over only the relevant top-level parts. The scalar
 * lookups retain the latest event in the requested window.
 */
function readOutcomes(db, sinceMs) {
  // Read outcome counts in one pass. The two scalar lookups preserve the
  // previous "latest event in the window" behavior without a separate scan.
  const rows = db
    .prepare(
      `SELECT
         p.session_id AS session_id,
         (SELECT json_extract(p2.data, '$.reason')
            FROM part p2
           WHERE p2.session_id = p.session_id
             AND json_extract(p2.data, '$.type') = 'step-finish'
             AND p2.time_created >= ?
           ORDER BY p2.time_created DESC
           LIMIT 1) AS last_reason,
         COUNT(CASE WHEN json_extract(p.data, '$.type') = 'tool'
                    AND json_extract(p.data, '$.state.status') = 'error' THEN 1 END) AS tool_errors,
         COUNT(CASE WHEN json_extract(p.data, '$.type') = 'tool'
                    AND p.data LIKE '%Add credits%' THEN 1 END) AS credits_failures,
         COUNT(CASE WHEN json_extract(p.data, '$.type') = 'tool'
                    AND json_extract(p.data, '$.state.status') = 'error'
                    AND p.data LIKE '%is waiting for input%' THEN 1 END) AS blocked_count,
         (SELECT p2.data
            FROM part p2
           WHERE p2.session_id = p.session_id
             AND json_extract(p2.data, '$.type') = 'tool'
             AND json_extract(p2.data, '$.state.status') = 'error'
             AND p2.data LIKE '%is waiting for input%'
             AND p2.time_created >= ?
           ORDER BY p2.time_created DESC
           LIMIT 1) AS blocked_data
         FROM part p
         JOIN session s ON s.id = p.session_id
        WHERE s.parent_id IS NULL
          AND p.time_created >= ?
          AND json_extract(p.data, '$.type') IN ('tool', 'step-finish')
        GROUP BY p.session_id`
    )
    .all(sinceMs, sinceMs, sinceMs);

  const out = new Map();
  for (const row of rows) {
    const e = {};
    if (row.tool_errors > 0) e.toolErrors = row.tool_errors;
    if (row.credits_failures > 0) e.creditsFailures = row.credits_failures;
    if (row.last_reason) e.lastReason = row.last_reason;
    if (row.blocked_count > 0 && row.blocked_data) {
      const m = /questionID\s+\\?"([^"\\]+)\\?"/.exec(row.blocked_data);
      e.blockedOn = m ? m[1] : null;
    }
    out.set(row.session_id, e);
  }
  return out;
}

/**
 * Classify one session.
 */
export function classifySession(session, outcome, { nowMs, exists }) {
  const idleMs = nowMs - session.timeUpdated;
  const reasons = [];

  let state = 'finished';
  if (session.tokensOutput === 0) {
    state = 'died-at-birth';
    reasons.push('zero output tokens and no assistant reply');
    if (outcome?.creditsFailures) {
      state = 'rejected-credits';
      reasons.push(`${outcome.creditsFailures}x "Add credits to continue" from a paid-model launch`);
    }
  } else if (!exists) {
    state = 'orphaned';
    reasons.push('the worktree this session ran in no longer exists');
  } else if (idleMs < LIVE_WINDOW_MS) {
    // Recency wins over the last turn's reason, and deliberately so: a
    // session that is still being worked on has not finished whatever the
    // shape of its most recent turn was. A recent `tool-calls` is a machine
    // mid-turn, and reporting it as abandoned would cry wolf on every live
    // session in the repository.
    state = 'active';
    reasons.push(`last message ${Math.round(idleMs / 60000)}m ago`);
  } else if (outcome?.lastReason && outcome.lastReason !== 'stop') {
    state = 'abandoned-midflight';
    reasons.push(
      `idle for ${Math.round(idleMs / 3600000)}h and the last turn ended on "${outcome.lastReason}", not a completed stop`
    );
  } else {
    // A stale session whose last turn completed is FINISHED, not idle. There is
    // no fourth bucket: an older `idle` state collapsed these two and so
    // reported every completed agent as still-open, which makes the
    // `unfinished` array a list of everything rather than a list of what
    // stopped. "The agent finished its turn and has said nothing since" is
    // exactly what a finished agent looks like.
    state = 'finished';
    reasons.push(`last turn completed ${Math.round(idleMs / 3600000)}h ago and nothing has happened since`);
  }

  return {
    id: session.id,
    title: session.title,
    agent: session.agent,
    directory: session.directory,
    timeCreated: session.timeCreated,
    timeUpdated: session.timeUpdated,
    idleMs,
    state,
    reasons,
    toolErrors: outcome?.toolErrors ?? 0,
    creditsFailures: outcome?.creditsFailures ?? 0,
    lastTurnReason: outcome?.lastReason ?? null,
    tokensOutput: session.tokensOutput,
  };
}

/**
 * Audit every session in the window and group the result by worktree path.
 *
 * `existingPaths` is the set of worktree directories that still exist; a
 * session whose directory is not in it is `orphaned`, which is how the chats
 * of deleted worktrees get reported instead of vanishing.
 */
export function auditChats({
  dbPath = resolveSessionDb(),
  sinceMs,
  nowMs = Date.now(),
  existingPaths = new Set(),
} = {}) {
  const db = openDb(dbPath);
  if (!db) {
    return { available: false, dbPath, byDirectory: new Map(), total: 0, newestSessionAt: 0 };
  }

  try {
    const sessions = readSessions(db, sinceMs);

    // A `--now` earlier than the newest session makes `idleMs` negative, and a
    // negative idle time satisfies the liveness test — so pinning the clock
    // backwards silently reclassified 22 worktrees `in-use` and hid a prunable
    // one. Clamp instead: the flag is for reproducibility, and reproducing a
    // future is not a state this data can be in.
    const newest = sessions.reduce((n, s) => (s.timeUpdated > n ? s.timeUpdated : n), 0);
    const effectiveNow = Math.max(nowMs, newest);

    const outcomes = readOutcomes(db, sinceMs);
    const subagents = new Map(readSubagentCounts(db, sinceMs).map((row) => [row.parent_id, row.n]));

    const byDirectory = new Map();
    for (const s of sessions) {
      const classified = classifySession(s, outcomes.get(s.id), {
        nowMs: effectiveNow,
        exists: existingPaths.has(s.directory),
      });
      classified.subagentCount = subagents.get(s.id) ?? 0;
      const outcome = outcomes.get(s.id);
      if (outcome?.blockedOn) {
        classified.blockedOn = outcome.blockedOn;
        // Promote from whatever state it is actually in. An earlier draft
        // promoted only from `idle`, which `classifySession` no longer returns,
        // so `blocked` was unreachable — and the branch still ran its body,
        // producing a record that said `finished` and, in the next field, that
        // it was waiting for input. The two halves of one record contradicted.
        if (classified.state !== 'active' && classified.state !== 'orphaned') {
          classified.state = 'blocked';
        }
        classified.reasons.push('an agent_manager call reported a managed session waiting for input');
      }

      const list = byDirectory.get(s.directory) ?? [];
      list.push(classified);
      byDirectory.set(s.directory, list);
    }

    for (const list of byDirectory.values()) {
      list.sort((a, b) => b.timeUpdated - a.timeUpdated);
    }

    return {
      available: true,
      dbPath,
      byDirectory,
      total: sessions.length,
      // Exposed so `assemble.mjs` can clamp the clock on the worktree side too,
      // not just here. Clamping in one place only left `classify` reading the
      // raw value and produced exactly the drift the clamp exists to prevent.
      newestSessionAt: newest,
      windowMs: nowMs - sinceMs,
    };
  } finally {
    db.close();
  }
}

/** Roll a directory's sessions up into the counts and ids the inventory needs. */
export function summariseChats(sessions = []) {
  const byState = {};
  for (const s of sessions) byState[s.state] = (byState[s.state] ?? 0) + 1;

  const unfinished = sessions.filter(isUnfinished);
  const active = sessions.filter((s) => s.state === 'active');

  return {
    count: sessions.length,
    byState,
    chatIds: sessions.map((s) => s.id),
    subagentCount: sessions.reduce((n, s) => n + s.subagentCount, 0),
    activeChatIds: active.map((s) => s.id),
    unfinishedChatIds: unfinished.map((s) => s.id),
    // reduce, not `Math.max(...)`: a wide `--window-hours` spread over
    // thousands of sessions overflows the argument limit and throws.
    lastActivity: sessions.reduce((n, s) => (s.timeUpdated > n ? s.timeUpdated : n), 0) || null,
  };
}
