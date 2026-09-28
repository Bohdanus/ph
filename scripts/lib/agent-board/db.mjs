/**
 * The swarm board's storage layer: one SQLite database, shared by every worktree
 * of this repository, holding the live coordination state that the Markdown
 * handoff documents cannot hold.
 *
 * WHY SQLITE IN THE COMMON GIT DIRECTORY
 * --------------------------------------
 * `git rev-parse --git-common-dir` is the one path every worktree of a
 * repository agrees on: 137 of them share `.git/`, and each resolves to it, so
 * a single database file is visible from all of them without a symlink, a
 * server, or a copy per worktree. `AGENT_BOARD_DIR` overrides it for tests and
 * for a board that should outlive a reclone.
 *
 * WHY THERE IS NO DAEMON
 * ----------------------
 * A daemon is a process that can die, hold a lock, and leave the swarm unable
 * to coordinate. SQLite in WAL mode with a busy timeout is a library, not a
 * service: every command opens the file, does its work inside a transaction
 * and exits. Nothing needs to be running for a claim to be atomic, and nothing
 * needs restarting after a crash. `board watch` polls; it is a reader, never a
 * required participant.
 *
 * WHY CLAIMS AND LOCKS EXPIRE
 * ---------------------------
 * A worktree that is deleted mid-task, or an agent that loses its session,
 * would otherwise hold a claim forever and block the swarm with no visible
 * reason. A lease bounds that: past `lease_until` the claim is available again,
 * and the takeover is recorded in the event log with both agents named, so a
 * stale claim is a fact in the history rather than a mystery.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCHEMA_VERSION = 1;

/**
 * Default lease. Long enough that an agent mid-refactor does not lose its
 * claim to a heartbeat it did not think to send, short enough that an
 * abandoned claim returns to the swarm without anyone noticing the gap.
 */
export const DEFAULT_LEASE_MS = 45 * 60 * 1000;

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
export const PRIORITIES = Object.keys(PRIORITY_ORDER);
export const SCOPES = ['history', 'test', 'e2e', 'prod'];
export const STATUSES = ['open', 'claimed', 'resolved', 'closed', 'deferred'];

/** Claimable states. A resolved, closed or deferred issue is not up for grabs. */
const CLAIMABLE = new Set(['open', 'deferred']);

/**
 * `claimed` is claimable again, and this is why it is not in `CLAIMABLE`: the
 * status records that somebody holds it, while the LEASE records whether they
 * still are. Gating on the status alone would make a claim permanent — no
 * heartbeat could extend it and no other agent could ever take it over — and
 * the lease would be decorative.
 */
const RECLAIMABLE = 'claimed';

/** Offerable to the swarm: unclaimed, unfinished, and not already taken. */
const READY_STATUSES = new Set(['open', 'deferred', 'claimed']);

/**
 * A dependency is satisfied once its work is finished — `resolved` or
 * `closed`. It deliberately does NOT wait for verification: the fix is in the
 * tree either way, and making successors wait for a second agent to look would
 * turn one idle reviewer into a stoppage across every issue queued behind it.
 * Verification is still enforced, on the dependency's own `close`.
 */
const DEP_SATISFIED = ['resolved', 'closed'];

export class BoardError extends Error {
  constructor(message, { code = 1, detail = null } = {}) {
    super(message);
    this.name = 'BoardError';
    this.code = code;
    this.detail = detail;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id   TEXT PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'agent',
  worktree   TEXT,
  branch     TEXT,
  session_id TEXT,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  last_pid   INTEGER,
  meta       TEXT
);

CREATE TABLE IF NOT EXISTS issues (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  scope        TEXT NOT NULL DEFAULT 'prod',
  status       TEXT NOT NULL DEFAULT 'open',
  priority     TEXT NOT NULL DEFAULT 'normal',
  origin       TEXT,
  created_by   TEXT NOT NULL,
  resolver     TEXT,
  resolved_at  TEXT,
  verified_by  TEXT,
  verified_at  TEXT,
  defer_reason TEXT,
  defer_until  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS issues_origin_uq ON issues(origin) WHERE origin IS NOT NULL;

CREATE TABLE IF NOT EXISTS deps (
  issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES issues(id),
  PRIMARY KEY (issue_id, depends_on)
);

CREATE TABLE IF NOT EXISTS claims (
  issue_id    TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  worktree    TEXT,
  branch      TEXT,
  note        TEXT,
  claimed_at  TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS file_locks (
  path        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  issue_id    TEXT,
  worktree    TEXT,
  acquired_at TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (path, agent_id)
);

CREATE TABLE IF NOT EXISTS events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  kind     TEXT NOT NULL,
  issue_id TEXT,
  path     TEXT,
  message  TEXT,
  data     TEXT
);

CREATE INDEX IF NOT EXISTS events_issue_idx ON events(issue_id, seq);
CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind, seq);
`;

function git(args, { cwd } = {}) {
  const result = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.trim();
}

/**
 * The directory holding the board database. `AGENT_BOARD_DIR` wins, so a test
 * and an operator can each have their own board without a code change; the
 * common git directory is the shared default.
 */
export function resolveBoardDir({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.AGENT_BOARD_DIR) return env.AGENT_BOARD_DIR;
  let common;
  try {
    common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
  } catch {
    try {
      common = join(cwd, git(['rev-parse', '--git-common-dir'], { cwd }));
    } catch {
      throw new BoardError('not inside a git repository, and AGENT_BOARD_DIR is unset; the board has no home', {
        code: 1,
      });
    }
  }
  return join(common, 'agent-board');
}

/** Accepts `45m`, `90s`, `2h`, or a bare number of minutes. */
export function parseDuration(input, fallbackMs = DEFAULT_LEASE_MS) {
  if (input === undefined || input === null || input === '') return fallbackMs;
  if (typeof input === 'number') return Math.max(0, input * 60_000);
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(String(input).trim());
  if (!match) {
    throw new BoardError(`not a duration: ${input} (use 45m, 90s, 2h, or a bare minute count)`, {
      code: 1,
    });
  }
  const value = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Math.round(value * scale);
}

function msFromNow(ms, from = Date.now()) {
  return new Date(from + ms).toISOString();
}

/**
 * The board. One instance per CLI invocation; the tests hold several, each on
 * its own directory, which is why the directory is a constructor argument
 * rather than a module global.
 */
export class Board {
  constructor({ dir, identity, now = () => Date.now() } = {}) {
    this.dir = dir ?? resolveBoardDir();
    this.identity = identity;
    this.now = now;
    this.path = join(this.dir, 'board.db');
    this.db = null;
  }

  /**
   * Opens (creating if needed) the database and brings the schema up to date.
   * Idempotent: every command may call it, and a board that is already current
   * is not rewritten.
   */
  open({ create = true } = {}) {
    if (this.db) return this;
    if (create) mkdirSync(this.dir, { recursive: true });
    else if (!existsSync(this.path)) {
      throw new BoardError(`no board at ${this.path}`, { code: 2 });
    }
    this.db = new DatabaseSync(this.path);
    // ORDER MATTERS. `busy_timeout` has to be in force before `journal_mode` is
    // touched: setting WAL takes a lock on the database file, and without the
    // timeout a second process that happens to be opening a board for the first
    // time gets SQLITE_BUSY immediately instead of waiting. That is not a rare
    // race — it is what happens the first morning the swarm starts, when every
    // agent opens the board at once, and it surfaced as "database is locked"
    // from this very line on one process in twelve, intermittently, with every
    // single-process test in the suite green.
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Every timestamp the board writes goes through the one clock it was given.
   * A board that stamped some rows from `Date.now()` and read others from its
   * own clock would be correct in production, where both are the same thing,
   * and untestable everywhere else: a lease written by one clock and judged by
   * another expires at a moment neither party chose.
   */
  iso(at = this.now()) {
    return new Date(at).toISOString();
  }

  /**
   * Creates the schema, and refuses to write over a newer one.
   *
   * The version row is written with a plain conditional insert rather than a
   * read followed by an insert. The read-then-insert was outside any
   * transaction, so two processes opening a brand-new board at the same moment
   * both saw no row and both tried to write it — and the loser failed the very
   * first command of the very first session, with a message about a
   * constraint that has nothing to do with what the user asked for.
   */
  migrate() {
    this.db.exec(SCHEMA);
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
      .run('schema_version', String(SCHEMA_VERSION));
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
    if (Number(row.value) > SCHEMA_VERSION) {
      throw new BoardError(
        `board schema is v${row.value}, this script writes v${SCHEMA_VERSION}; update the board script, not the database`,
        { code: 1 }
      );
    }
  }

  /**
   * Every mutation runs inside BEGIN IMMEDIATE. The lock is taken at the start
   * of the transaction rather than on first write, which is what makes
   * read-then-write sequences — "is this claim still live? then take it" —
   * atomic against another process doing the same check.
   */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // A failed ROLLBACK means the transaction was already gone; the
        // original error is the one worth reporting.
      }
      throw error;
    }
  }

  // --- events -------------------------------------------------------------

  addEvent(kind, fields = {}) {
    const result = this.db
      .prepare(
        `INSERT INTO events (ts, agent_id, kind, issue_id, path, message, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.iso(),
        fields.agent ?? this.identity?.agentId ?? 'unknown',
        kind,
        fields.issue ?? null,
        fields.path ?? null,
        fields.message ?? null,
        fields.data === undefined ? null : JSON.stringify(fields.data)
      );
    return Number(result.lastInsertRowid);
  }

  events({ since = 0, limit = 200, issue = null, kind = null, pathsOnly = false } = {}) {
    const where = ['seq > ?'];
    const params = [since];
    if (issue) {
      where.push('issue_id = ?');
      params.push(issue);
    }
    if (kind) {
      where.push('kind = ?');
      params.push(kind);
    }
    if (pathsOnly) where.push('path IS NOT NULL');
    params.push(limit);
    return this.db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`).all(...params);
  }

  lastSeq() {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get();
    return Number(row?.seq ?? 0);
  }

  // --- agents -------------------------------------------------------------

  /** Records that an agent exists and refreshes its liveness. */
  touchAgent(identity = this.identity) {
    if (!identity?.agentId) return;
    const ts = this.iso();
    this.db
      .prepare(
        `INSERT INTO agents (agent_id, kind, worktree, branch, session_id, first_seen, last_seen, last_pid, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET
           worktree = COALESCE(excluded.worktree, agents.worktree),
           branch = COALESCE(excluded.branch, agents.branch),
           session_id = COALESCE(excluded.session_id, agents.session_id),
           last_seen = excluded.last_seen,
           last_pid = excluded.last_pid`
      )
      .run(
        identity.agentId,
        identity.kind ?? 'agent',
        identity.worktree ?? null,
        identity.branch ?? null,
        identity.sessionId ?? null,
        ts,
        ts,
        identity.pid ?? process.pid,
        JSON.stringify(identity.meta ?? {})
      );
  }

  agents() {
    return this.db.prepare('SELECT * FROM agents ORDER BY last_seen DESC').all();
  }

  // --- issues -------------------------------------------------------------

  /**
   * Issue ids are sequential per board (`ph-1`, `ph-2`, ...) so they can be
   * typed in a commit message or a chat without a lookup, and a deleted issue's
   * id is never reused, which is what lets a comment refer to one forever.
   */
  nextIssueId() {
    /**
     * The numeric part, compared as a NUMBER. `MAX(id)` on a TEXT column is a
     * string comparison, and 'ph-9' sorts above 'ph-10' — so the ninth issue
     * makes the allocator hand out `ph-3` again, and the tenth insert dies on
     * the primary key. The import of a real handoff document creates fifty
     * issues, which is how this was found; a board that stops at nine looks
     * fine forever.
     */
    const row = this.db
      .prepare(
        `SELECT MAX(CAST(SUBSTR(id, INSTR(id, '-') + 1) AS INTEGER)) AS n
         FROM issues WHERE id GLOB 'ph-[0-9]*'`
      )
      .get();
    return `ph-${(row?.n ?? 0) + 1}`;
  }

  createIssue(fields) {
    const {
      title,
      body = '',
      scope = 'prod',
      priority = 'normal',
      origin = null,
      files = [],
      deps = [],
      holdFiles = true,
      createdBy = this.identity?.agentId ?? 'unknown',
      data = null,
    } = fields;
    if (!title || !String(title).trim()) {
      throw new BoardError('an issue needs a title', { code: 1 });
    }
    if (!PRIORITIES.includes(priority)) {
      throw new BoardError(`unknown priority: ${priority} (${PRIORITIES.join(', ')})`, { code: 1 });
    }
    if (!SCOPES.includes(scope)) {
      throw new BoardError(`unknown scope: ${scope} (${SCOPES.join(', ')})`, { code: 1 });
    }
    return this.transaction(() => {
      if (origin) {
        const existing = this.db.prepare('SELECT id FROM issues WHERE origin = ?').get(origin);
        if (existing) return { id: existing.id, created: false };
      }
      const id = this.nextIssueId();
      const ts = this.iso();
      this.db
        .prepare(
          `INSERT INTO issues (id, title, body, scope, status, priority, origin, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
        )
        .run(id, String(title).trim(), body, scope, priority, origin, createdBy, ts, ts);
      // Filing an issue about a file somebody else already holds is not an
      // error — the issue is real either way — but the collision is reported
      // and recorded, so the filer finds out here rather than in a merge.
      // `holdFiles: false` is the import path: sixty issues imported at once
      // must not leave the importing agent holding sixty files' leases.
      const conflicts = [];
      if (holdFiles) {
        for (const path of normalizePaths(files, { worktree: this.identity?.worktree })) {
          const holder = this.liveLocks().find((lock) => lock.path === path && lock.agent_id !== createdBy);
          if (holder) {
            conflicts.push({ path, holder });
            this.addEvent('lock.deny', {
              issue: id,
              agent: createdBy,
              path,
              message: `filed about a file held by ${holder.agent_id}`,
              data: { holder },
            });
            continue;
          }
          this.holdFileInTransaction(path, { issueId: id, agent: createdBy });
        }
      }
      for (const dep of deps) this.addDepInTransaction(id, dep);
      this.addEvent('issue.create', {
        issue: id,
        agent: createdBy,
        message: title,
        data: { scope, priority, origin, files, deps, ...(data ? { source: data } : {}) },
      });
      if (files.length > 0) {
        this.addEvent('lock.hold', {
          issue: id,
          agent: createdBy,
          message: holdFiles
            ? `filed with ${files.length} file lock(s)`
            : `filed about ${files.length} file(s), no locks taken`,
          data: { files, held: holdFiles, conflicts: conflicts.map((c) => c.path) },
        });
      }
      return { id, created: true, conflicts };
    });
  }

  getIssue(id) {
    const issue = this.db.prepare('SELECT * FROM issues WHERE id = ?').get(id);
    if (!issue) throw new BoardError(`no such issue: ${id}`, { code: 2 });
    return issue;
  }

  findIssue(idOrOrigin) {
    return (
      this.db.prepare('SELECT * FROM issues WHERE id = ?').get(idOrOrigin) ??
      this.db.prepare('SELECT * FROM issues WHERE origin = ?').get(idOrOrigin) ??
      null
    );
  }

  addDepInTransaction(issueId, dependsOn) {
    if (dependsOn === issueId) {
      throw new BoardError(`${issueId} cannot depend on itself`, { code: 1 });
    }
    this.getIssue(dependsOn);
    this.db.prepare('INSERT OR IGNORE INTO deps (issue_id, depends_on) VALUES (?, ?)').run(issueId, dependsOn);
  }

  addDep(issueId, dependsOn) {
    return this.transaction(() => {
      this.getIssue(issueId);
      this.addDepInTransaction(issueId, dependsOn);
      this.addEvent('issue.dep', { issue: issueId, message: `depends on ${dependsOn}` });
    });
  }

  deps(id) {
    return this.db.prepare('SELECT depends_on FROM deps WHERE issue_id = ?').all(id);
  }

  dependents(id) {
    return this.db.prepare('SELECT issue_id FROM deps WHERE depends_on = ?').all(id);
  }

  /**
   * The unreleased claim row, live or expired. Callers that need "is it
   * actually held" use `liveClaimOrNull`; `doctor` is the caller that wants the
   * expired ones too, because those are the ones it reclaims.
   */
  liveClaim(issueId) {
    return this.db.prepare('SELECT * FROM claims WHERE issue_id = ? AND released_at IS NULL').get(issueId) ?? null;
  }

  liveClaimOrNull(issueId, at = this.now()) {
    const row = this.liveClaim(issueId);
    if (!row) return null;
    return Date.parse(row.lease_until) > at ? row : null;
  }

  isLive(claim, at = this.now()) {
    return Boolean(claim) && claim.released_at === null && Date.parse(claim.lease_until) > at;
  }

  /**
   * Lists issues, most urgent first. `only` narrows to a set of statuses; the
   * default is the whole board because `board list` is also a status report.
   */
  listIssues({ status = null, scope = null, files = null, claimedBy = null, origin = null, limit = 200 } = {}) {
    const where = [];
    const params = [];
    if (status) {
      const list = Array.isArray(status)
        ? status
        : String(status)
            .split(',')
            .map((s) => s.trim());
      where.push(`status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (scope) {
      const list = Array.isArray(scope)
        ? scope
        : String(scope)
            .split(',')
            .map((s) => s.trim());
      where.push(`scope IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
    if (origin) {
      where.push('origin = ?');
      params.push(origin);
    }
    if (claimedBy) {
      // The lease, not just the row: an issue whose claim expired a
      // millisecond ago is not being worked on by anybody, and
      // `board list --claimed-by` saying otherwise sends the next agent round
      // the loop to find work that is already free.
      where.push(
        `EXISTS (SELECT 1 FROM claims c WHERE c.issue_id = issues.id AND c.agent_id = ? AND c.released_at IS NULL AND c.lease_until > ?)`
      );
      params.push(claimedBy, this.iso());
    }
    if (files && files.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM file_locks f WHERE f.issue_id = issues.id AND f.agent_id = ? AND f.released_at IS NULL AND f.path IN (${files
          .map(() => '?')
          .join(',')}))`
      );
      params.push(claimedBy ?? this.identity?.agentId ?? 'unknown', ...files);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM issues ${clause}`)
      .all(...params)
      .sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
          a.created_at.localeCompare(b.created_at)
      )
      .slice(0, limit);
  }

  /**
   * What the swarm can pick up right now: open or deferred, unblocked, and not
   * already claimed under a live lease. This is the query that replaces reading
   * a handoff document to find out whether something is already being done.
   * Expiry is evaluated on read, not by a sweeper: a lease nobody sweeps is
   * still a lease nobody can hold past, and there is no process that would have
   * to be responsible for sweeping it.
   */
  readyIssues({ limit = 50 } = {}) {
    const at = this.now();
    return this.listIssues({})
      .filter((issue) => READY_STATUSES.has(issue.status))
      .filter((issue) => {
        // A `claimed` issue whose lease ran out is back on offer: the status
        // still says somebody claimed it, and the lease is the only thing that
        // says whether they are still there.
        if (this.liveClaimOrNull(issue.id, at)) return false;
        return this.deps(issue.id).every(({ depends_on }) => {
          const dep = this.findIssue(depends_on);
          return !dep || DEP_SATISFIED.includes(dep.status);
        });
      })
      .slice(0, limit);
  }

  /** Issues whose open deps are not yet closed, whatever their own status. */
  blockedIssues() {
    return this.listIssues({}).filter(
      (issue) =>
        issue.status !== 'closed' &&
        this.deps(issue.id).some(({ depends_on }) => {
          const dep = this.findIssue(depends_on);
          return !dep || !DEP_SATISFIED.includes(dep.status);
        })
    );
  }

  // --- claims -------------------------------------------------------------

  /**
   * The single-writer handoff. Inside one IMMEDIATE transaction this checks the
   * issue's state, checks the live claim, and takes it, so two agents racing for
   * the same issue cannot both win: the second transaction blocks on the first
   * and then sees its claim.
   */
  claimIssue(id, { leaseMs = DEFAULT_LEASE_MS, note = null, agent, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    if (!who) throw new BoardError('no agent identity to claim with', { code: 1 });
    return this.transaction(() => {
      // Sampled inside the transaction, after any wait for the write lock: a
      // lease computed from a timestamp taken before a four-second wait is four
      // seconds shorter than asked for, and a claim judged four seconds stale
      // reads a lease as live when it is not.
      const at = this.now();
      const issue = this.getIssue(id);
      const held = this.liveClaimOrNull(id, at);
      // Two gates, in this order and for this reason: the status decides
      // whether this KIND of issue can be worked on at all, and the live claim
      // decides whether it is actually free. Gating on the status alone would
      // make a `claimed` issue permanent — no heartbeat could extend it and no
      // agent could ever take it over — and the lease would be decorative.
      if (!CLAIMABLE.has(issue.status) && issue.status !== RECLAIMABLE && !force) {
        throw new BoardError(
          `${id} is ${issue.status}, not claimable${issue.status === 'resolved' ? ' — close it, or reopen it' : ''}`,
          { code: 3, detail: { id, status: issue.status } }
        );
      }
      if (held && held.agent_id !== who && !force) {
        throw new BoardError(
          `${id} is claimed by ${held.agent_id} until ${held.lease_until}${held.branch ? ` (${held.branch})` : ''}`,
          { code: 3, detail: { id, holder: held } }
        );
      }
      if (held && held.agent_id === who) {
        this.db
          .prepare('UPDATE claims SET lease_until = ?, note = COALESCE(?, note) WHERE issue_id = ?')
          .run(msFromNow(leaseMs, at), note, id);
        this.addEvent('claim.renew', { issue: id, agent: who, message: `lease extended` });
        return { id, renewed: true, agent: who, lease_until: msFromNow(leaseMs, at) };
      }
      if (held && force && held.agent_id !== who) {
        this.addEvent('claim.steal', {
          issue: id,
          agent: who,
          message: `took over from ${held.agent_id} (forced, lease was live)`,
          data: { previous_agent: held.agent_id, previous_lease: held.lease_until, forced: true },
        });
      }
      // An expired lease is a takeover too, and the ordinary case of the two: an
      // agent's worktree died and somebody else picked the issue up. Without
      // this event the log shows a claim appearing out of nowhere, which is
      // precisely the fact the swarm needs and cannot reconstruct later.
      const previous = this.liveClaim(id);
      if (!held && previous && previous.agent_id !== who) {
        this.addEvent('claim.steal', {
          issue: id,
          agent: who,
          message: `took over from ${previous.agent_id} (lease expired ${previous.lease_until})`,
          data: { previous_agent: previous.agent_id, previous_lease: previous.lease_until, forced: false },
        });
      }
      this.db
        .prepare(
          `INSERT INTO claims (issue_id, agent_id, worktree, branch, note, claimed_at, lease_until, released_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(issue_id) DO UPDATE SET
             agent_id = excluded.agent_id,
             worktree = excluded.worktree,
             branch = excluded.branch,
             note = excluded.note,
             claimed_at = excluded.claimed_at,
             lease_until = excluded.lease_until,
             released_at = NULL`
        )
        .run(
          id,
          who,
          this.identity?.worktree ?? null,
          this.identity?.branch ?? null,
          note,
          this.iso(),
          msFromNow(leaseMs, at)
        );
      if (issue.status === 'open' || issue.status === 'deferred') {
        this.db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run('claimed', this.iso(), id);
      }
      this.addEvent('claim.acquire', {
        issue: id,
        agent: who,
        message: `claimed${note ? `: ${note}` : ''}`,
        data: { lease_until: msFromNow(leaseMs, at) },
      });
      return { id, renewed: false, agent: who, lease_until: msFromNow(leaseMs, at) };
    });
  }

  heartbeat(id, { leaseMs = DEFAULT_LEASE_MS, agent } = {}) {
    const who = agent ?? this.identity?.agentId;
    return this.claimIssue(id, { leaseMs, agent: who });
  }

  releaseClaim(id, { agent, force = false, reason = null } = {}) {
    const who = agent ?? this.identity?.agentId;
    const at = this.now();
    return this.transaction(() => {
      this.getIssue(id);
      const claim = this.db.prepare('SELECT * FROM claims WHERE issue_id = ? AND released_at IS NULL').get(id);
      if (!claim) return { id, released: false, reason: 'no live claim' };
      if (claim.agent_id !== who && !force) {
        throw new BoardError(`${id} is claimed by ${claim.agent_id}, not by ${who}; pass --force to take it`, {
          code: 3,
          detail: { id, holder: claim },
        });
      }
      this.db
        .prepare('UPDATE claims SET released_at = ?, lease_until = ? WHERE issue_id = ?')
        .run(this.iso(), this.iso(), id);
      this.db
        .prepare('UPDATE file_locks SET released_at = ? WHERE issue_id = ? AND agent_id = ? AND released_at IS NULL')
        .run(this.iso(), id, claim.agent_id);
      if (['claimed'].includes(currentStatus(this.db, id))) {
        this.db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run('open', this.iso(), id);
      }
      this.addEvent('claim.release', {
        issue: id,
        agent: claim.agent_id,
        message: reason ?? 'released',
        data: { by: who, forced: Boolean(force) },
      });
      return { id, released: true };
    });
  }

  // --- file locks ---------------------------------------------------------

  liveLocks(at = this.now()) {
    return this.db
      .prepare('SELECT * FROM file_locks WHERE released_at IS NULL')
      .all()
      .filter((lock) => Date.parse(lock.expires_at) > at);
  }

  /**
   * The locks still holding on an issue, expired ones excluded.
   *
   * Filtering only on `released_at` reads a lock whose lease has run out as a
   * live one, which is how `board show` and the FILES column of `board ready`
   * came to advertise a file that `board check`, in the same breath, called
   * free. Anything that renders a lock to a human goes through here or through
   * `liveLocks`; anything that decides a conflict ALWAYS goes through
   * `liveLocks`, and never through this.
   */
  locksFor(issueId, at = this.now()) {
    return this.db
      .prepare('SELECT * FROM file_locks WHERE issue_id = ? AND released_at IS NULL')
      .all(issueId)
      .filter((lock) => Date.parse(lock.expires_at) > at);
  }

  locksHeldBy(agent, at = this.now()) {
    return this.liveLocks(at).filter((lock) => lock.agent_id === agent);
  }

  /**
   * The other half of the rule this repo already states in prose — never two
   * agents on the same file — enforced rather than requested. A path held by
   * another live agent is refused, and the refusal names the holder, so the
   * second agent does not have to guess whether the first is still working.
   */
  holdFiles(paths, { issueId = null, leaseMs = DEFAULT_LEASE_MS, agent, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    if (!who) throw new BoardError('no agent identity to hold with', { code: 1 });
    const list = normalizePaths(paths, { worktree: this.identity?.worktree });
    if (list.length === 0) throw new BoardError('no file paths given', { code: 1 });
    try {
      return this.transaction(() => {
        // The clock is sampled inside the transaction, not before it. A claim
        // that waited on the write lock for four seconds and then computed its
        // lease from a timestamp taken before the wait hands out four seconds
        // less than it was asked for, and judges four-second-old leases as
        // still live.
        const at = this.now();
        const conflicts = [];
        for (const path of list) {
          const holder = this.liveLocks(at).find((lock) => lock.path === path && lock.agent_id !== who);
          if (holder && !force) conflicts.push({ path, holder });
        }
        if (conflicts.length > 0) {
          throw new BoardError(
            `held by another agent: ${conflicts.map((c) => `${c.path} (${c.holder.agent_id})`).join(', ')}`,
            { code: 4, detail: { conflicts } }
          );
        }
        // Which of these the caller did not ALREADY hold. A caller that takes
        // locks, then fails at something else, has to give back exactly the ones
        // it acquired and none of the ones it walked in with — the difference
        // is the whole reason a rollback does not quietly free a file the agent
        // was working in before the command started.
        const mine = new Set(
          this.liveLocks(at)
            .filter((lock) => lock.agent_id === who)
            .map((lock) => lock.path)
        );
        for (const path of list) {
          this.holdFileInTransaction(path, { issueId, agent: who, leaseMs, at });
        }
        this.addEvent('lock.hold', {
          issue: issueId,
          agent: who,
          message: `${list.length} file(s)`,
          data: { files: list, forced: Boolean(force) },
        });
        return { held: list, acquired: list.filter((path) => !mine.has(path)), agent: who };
      });
    } catch (error) {
      /**
       * A REFUSAL is one of the most useful things on this board — it is how a
       * second agent learns somebody is already in a file — and it was being
       * written inside the transaction that then rolled it back, so the log
       * recorded no refusals at all. Recording them here, in a fresh
       * transaction, is why the log can be trusted to show contention.
       */
      const conflicts = error?.detail?.conflicts;
      if (Array.isArray(conflicts) && conflicts.length > 0) {
        this.transaction(() => {
          for (const conflict of conflicts) {
            this.addEvent('lock.deny', {
              issue: issueId,
              agent: who,
              path: conflict.path,
              message: `refused, held by ${conflict.holder.agent_id}`,
              data: { holder: conflict.holder },
            });
          }
        });
      }
      throw error;
    }
  }

  holdFileInTransaction(path, { issueId = null, agent, leaseMs = DEFAULT_LEASE_MS, at = this.now() } = {}) {
    const who = agent ?? this.identity?.agentId ?? 'unknown';
    this.db
      .prepare(
        `INSERT INTO file_locks (path, agent_id, issue_id, worktree, acquired_at, expires_at, released_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path, agent_id) DO UPDATE SET
           issue_id = COALESCE(excluded.issue_id, file_locks.issue_id),
           worktree = COALESCE(excluded.worktree, file_locks.worktree),
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at,
           released_at = NULL`
      )
      .run(path, who, issueId, this.identity?.worktree ?? null, this.iso(), msFromNow(leaseMs, at));
    return path;
  }

  releaseFiles(paths, { agent, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    const list = normalizePaths(paths, { worktree: this.identity?.worktree });
    return this.transaction(() => {
      const released = [];
      for (const path of list) {
        const rows = this.db.prepare('SELECT * FROM file_locks WHERE path = ? AND released_at IS NULL').all(path);
        for (const row of rows) {
          if (row.agent_id !== who && !force) continue;
          this.db
            .prepare('UPDATE file_locks SET released_at = ? WHERE path = ? AND agent_id = ?')
            .run(this.iso(), path, row.agent_id);
          released.push(path);
          this.addEvent('lock.release', {
            issue: row.issue_id,
            agent: row.agent_id,
            path,
            message: 'released',
            data: { by: who, forced: Boolean(force) },
          });
        }
      }
      return { released: [...new Set(released)] };
    });
  }

  /** `board lock-check <path>`: exit 0 free, 1 held. Scriptable on its own. */
  checkPath(path, { agent, at = this.now() } = {}) {
    const who = agent ?? this.identity?.agentId;
    const holders = this.liveLocks(at).filter((lock) => lock.path === path && lock.agent_id !== who);
    return { path, free: holders.length === 0, holders };
  }

  // --- lifecycle ----------------------------------------------------------

  comment(id, message, { agent } = {}) {
    const who = agent ?? this.identity?.agentId ?? 'unknown';
    return this.transaction(() => {
      this.getIssue(id);
      this.addEvent('issue.comment', { issue: id, agent: who, message });
      return { seq: this.lastSeq() };
    });
  }

  note(message, { agent, data } = {}) {
    return this.transaction(() => {
      const who = agent ?? this.identity?.agentId ?? 'unknown';
      const seq = this.addEvent('note', { agent: who, message, data });
      return { seq };
    });
  }

  /**
   * `resolve` is the fixer's own claim that the work is done. It requires the
   * live claim, so a "fix" that was never worked cannot be recorded as one.
   */
  resolveIssue(id, { agent, note: text = null, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    const at = this.now();
    return this.transaction(() => {
      this.getIssue(id);
      const claim = this.liveClaimOrNull(id, at);
      if ((!claim || claim.agent_id !== who) && !force) {
        throw new BoardError(
          claim
            ? `${id} is claimed by ${claim.agent_id}; only the claim holder resolves it`
            : `${id} is not claimed; claim it before resolving`,
          { code: 3 }
        );
      }
      this.db
        .prepare('UPDATE issues SET status = ?, resolver = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
        .run('resolved', who, this.iso(), this.iso(), id);
      this.addEvent('issue.resolve', { issue: id, agent: who, message: text ?? 'resolved' });
      return { id, status: 'resolved' };
    });
  }

  /**
   * `close` is somebody else's verification. The board refuses to let the
   * agent that resolved an issue be the agent that closes it, which is the
   * repository's own handoff lifecycle rule made mechanical: a fix is verified
   * by another agent, a review, or a test — not by the fixer's claim.
   *
   * There is no `verifiedBy` argument. It existed, and it defeated the entire
   * rule: `closeIssue(id, { verifiedBy: 'someone-else' })` compared the RESOLVER
   * against a name the caller supplied about an agent that was not in the
   * room, so the agent that resolved the issue could name any other string and
   * close its own work. The verifier is the identity that runs the command; a
   * reviewer closes the issue by being the reviewer.
   */
  closeIssue(id, { agent, note: text = null } = {}) {
    const who = agent ?? this.identity?.agentId;
    const verifier = who;
    return this.transaction(() => {
      const issue = this.getIssue(id);
      if (issue.status !== 'resolved') {
        throw new BoardError(`${id} is ${issue.status}; only a resolved issue can be closed`, {
          code: 3,
        });
      }
      if (issue.resolver && issue.resolver === verifier) {
        throw new BoardError(`${verifier} resolved ${id} and cannot also verify it; verification is somebody else's`, {
          code: 5,
          detail: { id, resolver: issue.resolver },
        });
      }
      this.db
        .prepare('UPDATE issues SET status = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?')
        .run('closed', verifier, this.iso(), this.iso(), id);
      this.addEvent('issue.close', {
        issue: id,
        agent: who,
        message: text ?? `verified by ${verifier}`,
        data: { verified_by: verifier },
      });
      return { id, status: 'closed', verified_by: verifier };
    });
  }

  deferIssue(id, { agent, reason, until = null } = {}) {
    const who = agent ?? this.identity?.agentId;
    if (!reason) throw new BoardError('a deferral needs a reason', { code: 1 });
    return this.transaction(() => {
      this.getIssue(id);
      this.db
        .prepare('UPDATE issues SET status = ?, defer_reason = ?, defer_until = ?, updated_at = ? WHERE id = ?')
        .run('deferred', reason, until, this.iso(), id);
      this.addEvent('issue.defer', { issue: id, agent: who, message: reason, data: { until } });
      return { id, status: 'deferred' };
    });
  }

  reopenIssue(id, { agent, reason = null, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    return this.transaction(() => {
      const issue = this.getIssue(id);
      const claim = this.liveClaimOrNull(id);
      if (claim && claim.agent_id !== who && !force) {
        throw new BoardError(`${id} is claimed by ${claim.agent_id}`, { code: 3 });
      }
      if (claim) {
        this.db.prepare('UPDATE claims SET released_at = ? WHERE issue_id = ?').run(this.iso(), id);
      }
      this.db
        .prepare(
          'UPDATE issues SET status = ?, resolver = NULL, resolved_at = NULL, verified_by = NULL, verified_at = NULL, defer_reason = NULL, defer_until = NULL, updated_at = ? WHERE id = ?'
        )
        .run('open', this.iso(), id);
      this.addEvent('issue.reopen', { issue: id, agent: who, message: reason ?? 'reopened' });
      return { id, status: 'open' };
    });
  }

  // --- maintenance --------------------------------------------------------

  /**
   * The state an agent needs before it starts: what it holds, what is about to
   * expire, and which of the worktree's files somebody else has taken.
   */
  status({ at = this.now() } = {}) {
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const issue of this.listIssues({})) byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    const locks = this.liveLocks(at);
    const unreleased = this.db.prepare('SELECT * FROM claims WHERE released_at IS NULL').all();
    const claims = unreleased.filter((claim) => Date.parse(claim.lease_until) > at);
    const mine = claims.filter((claim) => claim.agent_id === this.identity?.agentId);
    return {
      counts: byStatus,
      ready: this.readyIssues().length,
      blocked: this.blockedIssues().length,
      agents: this.agents().length,
      claims,
      // Reported rather than fixed: `board status` is a read, and the one
      // command that releases an abandoned claim is `board doctor`.
      expiredClaims: unreleased.length - claims.length,
      locks,
      myClaims: mine,
      myLocks: locks.filter((lock) => lock.agent_id === this.identity?.agentId),
      expiringSoon: claims.filter((claim) => Date.parse(claim.lease_until) - at < 10 * 60_000),
      lastSeq: this.lastSeq(),
    };
  }

  /**
   * Reclaims what dead agents left behind. A lease that has expired, or a claim
   * held from a worktree that no longer exists on disk, is released and the
   * release is recorded — so `doctor` is safe to run at any time and explains
   * itself in the log rather than mutating the board silently.
   */
  doctor({ at = this.now(), dryRun = false } = {}) {
    const findings = [];
    const claims = this.db.prepare('SELECT * FROM claims WHERE released_at IS NULL').all();
    for (const claim of claims) {
      const expired = Date.parse(claim.lease_until) <= at;
      const gone = claim.worktree ? !existsDir(claim.worktree) : false;
      if (!expired && !gone) continue;
      findings.push({
        kind: gone ? 'dead-worktree' : 'expired-lease',
        issue: claim.issue_id,
        agent: claim.agent_id,
        worktree: claim.worktree,
        lease_until: claim.lease_until,
        releaseable: true,
      });
    }
    const at2 = this.now();
    for (const lock of this.db.prepare('SELECT * FROM file_locks WHERE released_at IS NULL').all()) {
      if (Date.parse(lock.expires_at) > at2) continue;
      findings.push({ kind: 'expired-lock', path: lock.path, agent: lock.agent_id, releaseable: true });
    }
    if (!dryRun) {
      for (const finding of findings) {
        if (finding.issue) this.releaseClaim(finding.issue, { agent: finding.agent, force: true });
        if (finding.path) this.releaseFiles([finding.path], { agent: finding.agent, force: true });
      }
    }
    return findings;
  }
}

function currentStatus(db, id) {
  return db.prepare('SELECT status FROM issues WHERE id = ?').get(id)?.status ?? null;
}

function existsDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Paths are recorded as repo-relative, POSIX-separated, so that a lock taken
 * in one worktree matches the same file named in another.
 *
 * The worktree prefix is stripped because a machine resolves the same
 * repository to different absolute paths — macOS answers `/private/var/...`
 * where Linux answers `/var/...` — and two agents on the same machine still
 * name the same file differently when one says `src/x.ts` and the other says
 * `/Users/me/ph/.kilo/worktrees/agent-board/src/x.ts`. That is precisely when a
 * file lock stops working, so the comparison happens on the relative form.
 * An absolute path that is NOT under the caller's worktree is left alone
 * rather than guessed at: it is outside everything this board coordinates.
 */
export function normalizePaths(paths, { worktree = null } = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  const root = worktree ? `${String(worktree).split('\\').join('/').replace(/\/+$/, '')}/` : null;
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let normalized = trimmed.split('\\').join('/').replace(/^\.\//, '');
    if (root && normalized.startsWith(root)) normalized = normalized.slice(root.length);
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}
