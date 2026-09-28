/**
 * The board's contribution to the inventory: which worktree holds a live
 * claim, which files are locked, and which issue a worktree is tracking.
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
 * Live claims, file locks and issues, keyed for lookup by worktree path.
 *
 * A claim is "live" when it has neither been released nor had its lease run
 * out, which is the same rule `board status` applies, so a worktree marked
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
    return { available: false, dbPath, claims: new Map(), fileLocks: new Map(), issues: [] };
  }

  try {
    const issues = db.prepare('SELECT id, title, scope, status, priority, origin FROM issues ORDER BY id').all();

    const claims = db
      .prepare('SELECT issue_id, agent_id, worktree, branch, lease_until, released_at FROM claims')
      .all()
      .filter((c) => isLive(c, 'lease_until', nowMs));

    const fileLocks = db
      .prepare('SELECT path, agent_id, issue_id, worktree, expires_at, released_at FROM file_locks')
      .all()
      .filter((l) => isLive(l, 'expires_at', nowMs));

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
      list.push({ path: l.path, agentId: l.agent_id, issueId: l.issue_id, expiresAt: l.expires_at });
      locksByWorktree.set(key, list);
    }

    return {
      available: true,
      dbPath,
      claims: claimsByWorktree,
      fileLocks: locksByWorktree,
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
