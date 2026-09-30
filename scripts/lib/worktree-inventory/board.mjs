/**
 * The board's contribution to the inventory: which worktree holds a live
 * claim, which files are locked, which agent was last seen in which worktree,
 * and which issue a worktree is tracking.
 *
 * WHY THE AGENTS TABLE IS THE BETTER LIVENESS SIGNAL
 * ---------------------------------------------------
 * `session.directory` in the Kilo database records where a session was OPENED,
 * not where it is working. A session started in the main checkout and then
 * driven into a task worktree is recorded against the main checkout for its
 * whole life — measured on this repository, an agent working exclusively in
 * `.kilo/worktrees/worktree-inventory` had zero sessions attributed to that
 * path and its worktree read as `prunable` while it was being actively used.
 * The board's `agents` table records the worktree, so it answers the question
 * the session database cannot. Both are reported, and either makes a worktree
 * in-use.
 *
 * READ-ONLY, AND DEGRADES TO NOTHING
 * -----------------------------------
 * The board database lives in the common git directory and is machine-local.
 * A clone without one is a normal state, not a failure, so every function
 * here returns an empty result rather than throwing. An inventory that cannot
 * be generated because a coordination database is missing would be a worse tool
 * than one that generates and says the board was unavailable.
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { LIVE_WINDOW_MS } from './classify.mjs';

/**
 * The board's database path, resolved exactly as `agent-board` resolves it.
 *
 * `--path-format=absolute` is load-bearing and the reason is easy to miss:
 * plain `git rev-parse --git-common-dir` returns the RELATIVE string `.git`
 * from the main checkout. Joining that and handing it to `DatabaseSync`
 * resolves it against `process.cwd()`, which inside a task worktree is a
 * directory whose `.git` is a gitlink FILE, not a directory — so the whole
 * board half of the inventory degrades to "unavailable" and every worktree
 * reports zero claims, with nothing on screen to say why. The fallback to
 * `join(cwd, …)` covers the git versions that lack the flag.
 */
export function resolveBoardDb(cwd) {
  if (process.env.AGENT_BOARD_DIR) return join(process.env.AGENT_BOARD_DIR, 'board.db');
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return join(isAbsolute(common) ? common : cwd, 'agent-board', 'board.db');
}

function openBoard(dbPath) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * The key one lock is identified by across `file_locks` and `issue_locks`: a
 * path AND the agent in it, because the schema's own key is that pair and
 * because two agents may hold the same file.
 *
 * NUL is the separator rather than a space because a space is legal in both a
 * path and an agent id, and a key built with one collides: `(a b, c)` and
 * `(a, b c)` are the same string. `db.mjs` keys its own lock lookups the same
 * way.
 */
function lockKey(path, agentId) {
  return `${path}\u0000${agentId}`;
}

/**
 * Which issues a lock is being used for, keyed by `lockKey`.
 *
 * ATTRIBUTION LIVES IN `issue_locks`, NOT ON THE LOCK — and the v1 column this
 * used to read is a trap, not a legacy detail. `file_locks` has carried no
 * `issue_id` since schema v2 (the `CREATE TABLE IF NOT EXISTS file_locks` block
 * in `db.mjs`): a lock says an agent is IN a file,
 * and a separate row says which issue that is for, because one lock may serve
 * as many issues as there are legitimate uses of it. Reading `file_locks.issue_id`
 * therefore selected a column no current board has, and on a FRESH board — a new
 * clone, a new machine, CI — the query threw `no such column`, unguarded, out of
 * a command AGENTS.md makes mandatory before deleting a worktree. It never
 * failed only because the v1 → v2 migration copies the column's contents into
 * `issue_locks` and never drops the column, so every board this repository has
 * ever run is carrying a leftover that hides the defect. That is the whole reason
 * the test fixture that "passed" against it was asserting a schema the product
 * stopped creating.
 *
 * Returns `available: false` rather than throwing when `issue_locks` is absent,
 * which is a real state and not a hypothetical: this reader opens the database
 * READ-ONLY and so never migrates it, so a v1 board file that nothing has opened
 * since the upgrade still has the old column and no `issue_locks` at all. The
 * caller reports that as a value (`lockIssueAttribution`) instead of an empty
 * list, because "no lock has an issue" and "no lock's issue could be read" are
 * different answers and only one of them is true.
 */
function readLockIssueAttribution(db) {
  const present = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'issue_locks'")
    .get();
  if (!present) return { available: false, byLock: new Map() };
  const byLock = new Map();
  // `created_at` then `issue_id` so the reported set is in a stable order: this
  // payload is written to a file a human reads, and an unordered result makes
  // two runs of the same board differ.
  for (const row of db
    .prepare('SELECT issue_id, path, agent_id FROM issue_locks ORDER BY created_at, issue_id')
    .all()) {
    const key = lockKey(row.path, row.agent_id);
    const list = byLock.get(key) ?? [];
    // `issue_locks` is keyed (issue_id, path), so one (path, agent) lock can
    // pair with MANY issues and the same id cannot repeat — but the lock it
    // names need not be a live lock, and a set is what "the issues using this
    // lock" is.
    if (!list.includes(row.issue_id)) list.push(row.issue_id);
    byLock.set(key, list);
  }
  return { available: true, byLock };
}

/**
 * Live claims, file locks and issues, keyed for lookup by worktree path.
 *
 * A claim is "live" when it has neither been released nor had its lease run
 * out, which is the same rule `swarm status` applies, so a worktree marked
 * in-use here is one the board also still shows as held.
 *
 * `lease_until` and `expires_at` are ISO-8601 TEXT, not numbers, so they must
 * go through `Date.parse`. A bare `Number(x) > nowMs` is `NaN > n`, which is
 * false for every row — so the filter silently dropped every claim and every
 * lock, and the board half of the inventory reported zero contention on a
 * repository where agents were actively holding files. `agent-board.mjs` uses
 * `Date.parse` on the same columns.
 */
function isLive(row, timestampField, nowMs) {
  if (row.released_at !== null && row.released_at !== undefined) return false;
  const until = Date.parse(row[timestampField]);
  // An unparseable timestamp is treated as LIVE: the safe direction is to show
  // a claim that may have lapsed, not to hide one that has not.
  return Number.isNaN(until) || until > nowMs;
}
export function readBoard(cwd, { nowMs = Date.now(), dbPath = resolveBoardDb(cwd) } = {}) {
  const db = openBoard(dbPath);
  if (!db) {
    return {
      available: false,
      dbPath,
      // Every key is present in every return, so a caller can read the payload
      // without knowing which way `readBoard` came out.
      lockIssueAttribution: 'unavailable',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
  }

  try {
    const issues = db.prepare('SELECT id, title, scope, status, priority, origin FROM issues ORDER BY id').all();

    const claims = db
      .prepare('SELECT issue_id, agent_id, worktree, branch, lease_until, released_at FROM claims')
      .all()
      .filter((c) => isLive(c, 'lease_until', nowMs));

    // The columns of the CURRENT schema, which are not the columns of every
    // board that exists: `issue_id` is selected from `issue_locks` below, not
    // from here. See `readLockIssueAttribution`.
    const fileLocks = db
      .prepare('SELECT path, agent_id, worktree, expires_at, released_at FROM file_locks')
      .all()
      .filter((l) => isLive(l, 'expires_at', nowMs));
    const attribution = readLockIssueAttribution(db);

    const agents = db.prepare('SELECT agent_id, kind, worktree, branch, session_id, last_seen FROM agents').all();

    const claimsByWorktree = new Map();
    for (const c of claims) {
      const key = c.worktree ?? '';
      const list = claimsByWorktree.get(key) ?? [];
      list.push({ issueId: c.issue_id, agentId: c.agent_id, branch: c.branch, leaseUntil: c.lease_until });
      claimsByWorktree.set(key, list);
    }

    const locksByWorktree = new Map();
    for (const l of fileLocks) {
      const key = l.worktree ?? '';
      const list = locksByWorktree.get(key) ?? [];
      // A LIST, and the only attribution field on a lock, because `issue_locks`
      // is keyed (issue_id, path) and one lock can be being used for more than
      // one issue. A singular field here would have to invent an answer for the
      // second issue — dropping it silently is the same defect as reporting the
      // wrong one. Empty means no issue is using this lock, which is the normal
      // state of `hold <path>` with no `--issue`, the form AGENTS.md prescribes.
      list.push({
        path: l.path,
        agentId: l.agent_id,
        issueIds: attribution.byLock.get(lockKey(l.path, l.agent_id)) ?? [],
        expiresAt: l.expires_at,
      });
      locksByWorktree.set(key, list);
    }

    const agentsByWorktree = new Map();
    for (const a of agents) {
      const key = a.worktree ?? '';
      const list = agentsByWorktree.get(key) ?? [];
      const seen = Date.parse(a.last_seen);
      list.push({
        agentId: a.agent_id,
        branch: a.branch,
        lastSeenMs: Number.isNaN(seen) ? null : seen,
        live: !Number.isNaN(seen) && seen > nowMs - LIVE_WINDOW_MS,
      });
      agentsByWorktree.set(key, list);
    }

    return {
      available: true,
      dbPath,
      lockIssueAttribution: attribution.available ? 'issue_locks' : 'unavailable',
      claims: claimsByWorktree,
      fileLocks: locksByWorktree,
      agents: agentsByWorktree,
      issues,
    };
  } finally {
    db.close();
  }
}

/**
 * Issues whose body or title names a branch or worktree, as a best-effort link
 * from a worktree to what it is tracking.
 *
 * Deliberately a substring match over the text and nothing smarter. It is
 * reported as `inferredBoardIssues` rather than as fact, because a body that
 * mentions a branch in passing is not a claim that the branch owns the issue.
 */
export function inferBoardIssues(issues, { branch, name }) {
  const needles = [branch, name].filter(Boolean);
  return issues
    .filter((i) => {
      const hay = `${i.title} ${i.origin}`;
      return needles.some((n) => n && hay.includes(n));
    })
    .map((i) => ({ id: i.id, title: i.title, status: i.status, inferred: true }));
}
