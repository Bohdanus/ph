/**
 * The swarm board's storage layer: one SQLite database, shared by every worktree
 * of this repository, holding the live coordination state that the Markdown
 * handoff documents cannot hold.
 *
 * WHY SQLITE IN THE COMMON GIT DIRECTORY
 * --------------------------------------
 * `git rev-parse --path-format=absolute --git-common-dir` is the one path every
 * worktree of a repository agrees on: they all share `.git/`, and each resolves
 * to it, so a single database file is visible from all of them without a symlink,
 * a server, or a copy per worktree. `AGENT_BOARD_DIR` overrides it for tests and
 * for a board that should outlive a reclone.
 *
 * WHY THERE IS NO DAEMON
 * ----------------------
 * A daemon is a process that can die, hold a lock, and leave the swarm unable
 * to coordinate. SQLite in WAL mode with a busy timeout is a library, not a
 * service: every command opens the file, does its work inside a transaction
 * and exits. Nothing needs to be running for a claim to be atomic, and nothing
 * needs restarting after a crash. `swarm watch` polls; it is a reader, never a
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
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCHEMA_VERSION = 2;

/**
 * Default lease. Long enough that an agent mid-refactor does not lose its
 * claim to a heartbeat it did not think to send, short enough that an
 * abandoned claim returns to the swarm without anyone noticing the gap.
 */
export const DEFAULT_LEASE_MS = 45 * 60 * 1000;

/**
 * How long a live finding can go untouched before `health` calls it idle.
 *
 * Long enough to span an overnight gap in a swarm that is genuinely paused, and
 * short enough that a finding nobody came back for is visible before it is
 * forgotten. It only ever REPORTS such a finding.
 */
export const IDLE_LIVE_MS = 6 * 60 * 60 * 1000;

/** "No cap" for an internal aggregation, as opposed to a displayed page. */
export const NO_LIMIT = Number.MAX_SAFE_INTEGER;

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
export const PRIORITIES = Object.keys(PRIORITY_ORDER);

/**
 * How urgent a priority is, lowest first. An unrecognised value sorts last
 * rather than first, so a typo in a flag cannot promote itself to the head of
 * the queue — the failure mode of a lookup that defaulted to zero.
 */
export const priorityRank = (priority) => PRIORITY_ORDER[priority] ?? 9;
export const SCOPES = ['history', 'test', 'e2e', 'prod'];
export const STATUSES = ['open', 'claimed', 'resolved', 'closed', 'deferred'];

/**
 * An origin that names one item of a handoff document — `HANDOFF.md#12`.
 *
 * Only the importer writes this shape. A live swarm finding is filed with no
 * origin at all, or with a free-text one recording where it came from
 * (`main: 2026-09-28 operator request`), and `handoff-import.mjs` keys
 * idempotency on this exact grammar.
 *
 * The path characters are in there for a reason. The importer writes the bare
 * filename (`OPEN_PROBLEMS.md#p3-…`, the scope map is what knows the `e2e/`
 * part), so a stricter pattern would match everything real — and would then
 * quietly call a path-qualified origin `live`, which is the one answer that
 * promotes a mirror to the top of the work queue. A pattern that fails open here
 * is worse than one that fails closed: the cost of a false negative is a row
 * sorted slightly low, and the cost of a false positive is a queue that lies.
 *
 * Telling the two apart is the difference between a work queue and a mirror.
 * Fifty-four imported rows and two live ones are not fifty-six pieces of work:
 * the durable record already owns the prose, `AGENTS.md` says so in as many
 * words, and a queue that cannot say which is which looks authoritative while
 * being ninety-six percent noise.
 */
const IMPORTED_ORIGIN = /^[\w./-]+\.md#(?:\d+|[a-z0-9-]+)$/;

/** True when this issue was imported from a handoff document rather than filed live. */
export const isImportedOrigin = (origin) => IMPORTED_ORIGIN.test(String(origin ?? ''));

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

-- A file lock: one row per (path, agent), and NOTHING about which issue it
-- belongs to.
--
-- That separation is the point of this table's shape, and its absence was the
-- source of two blockers in review. The lock used to carry an issue_id, so
-- "release the locks of issue X" was a WHERE on that column -- and an agent
-- working two issues at once had the second issue's file freed by releasing the
-- first. Whoever held that file afterwards was told, truthfully, that nobody
-- had it. One column could only hold one answer, so two different questions
-- ("who is in this file" and "which issues is this agent using it for") were
-- forced to share it. issue_locks below is the second question's own table, and
-- one lock may appear in as many of those rows as there are issues it is
-- legitimately being used for.
CREATE TABLE IF NOT EXISTS file_locks (
  path        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  worktree    TEXT,
  acquired_at TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (path, agent_id)
);

/** "Issue X is being worked on using file Y." Many rows may name one lock. */
CREATE TABLE IF NOT EXISTS issue_locks (
  issue_id   TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, path)
);

CREATE INDEX IF NOT EXISTS issue_locks_path_idx ON issue_locks(path);

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
    throw new BoardError(
      'cannot read the common git directory here, and AGENT_BOARD_DIR is unset; the board has no home',
      { code: 1 }
    );
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
 * A synchronous sleep, because `node:sqlite` is synchronous and the retry loop
 * that waits for another process to finish converting a journal cannot be an
 * `await`. `Atomics.wait` is the one way to block a thread in Node without a
 * child process; the CLI is a batch tool, so there is no event loop to starve.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Resolves the symlinks in a path that may not exist yet, by resolving its
 * deepest existing ancestor and re-attaching the rest. Returns null when even
 * the root cannot be resolved, so the caller can fall back rather than guess.
 */
function resolveSymlinksBestEffort(path) {
  const parts = String(path).split('/');
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const candidate = parts.slice(0, index).join('/');
    try {
      // Everything from `index` onwards is the part that does not exist yet, so
      // it is re-attached verbatim. Building a tail by hand here lost the
      // components between the resolved ancestor and the leaf, which quietly
      // rewrote `/wt-a-two/src/x.ts` into `/src/x.ts` — a different file, under
      // a different lock, with no error anywhere.
      return join(realpathSync(candidate), ...parts.slice(index));
    } catch {
      // Not there: try the parent.
    }
  }
  return null;
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
    // A THROW ANYWHERE IN HERE MUST NOT LEAVE A HALF-OPEN BOARD. `this.db` is
    // assigned on the line above, and the first line of this method is
    // `if (this.db) return this`, so a caller that catches the failure and
    // retries — the natural reaction to an error message that says exactly what
    // to fix — got a board back on the second call with the rest of `open()`
    // never run and no error, because the short-circuit returned the object that
    // was already holding a live handle. Measured before this: open threw, a
    // second `open()` returned NORMALLY, and the caller held a usable unmigrated
    // board.
    //
    // THE `try` STARTS IMMEDIATELY AFTER THE ASSIGNMENT, and that placement is
    // the whole fix. Wrapping only `migrate()` left the same leak reachable by
    // every statement between here and there: on a corrupt `board.db`,
    // `new DatabaseSync` succeeds and the first `PRAGMA` throws, so `migrate()`
    // is never reached and the try/catch never runs. Verified against both the
    // previous commit and main — same half-open board, same silent second open.
    try {
      // ORDER MATTERS, and setting the timeout first is NECESSARY BUT NOT
      // SUFFICIENT.
      //
      // The timeout first: without it, a second process opening a board gets
      // SQLITE_BUSY immediately instead of waiting.
      //
      // The retry: SQLite does not run the busy handler for the exclusive lock a
      // journal-mode conversion needs, so on a board that does not exist yet —
      // the moment the whole swarm opens it at once — one process in three
      // hundred still lost that lock and died with "database is locked".
      // Reordering alone turned a 12% failure rate into a 0.2% one, which is
      // worse than a fix because it looks like a fix.
      //
      // Giving up is survivable: WAL is what lets a reader run while a writer
      // holds the write lock, and without it SQLite falls back to the rollback
      // journal, where the same BEGIN IMMEDIATE transactions and the same
      // busy_timeout still make every claim exclusive. Correctness comes from
      // the transactions, not from this line; this line buys concurrency, and a
      // board that stays on the rollback journal is slower, not wrong.
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.enableWriteAheadLog();
      this.db.exec('PRAGMA foreign_keys = ON');
      this.migrate();
      return this;
    } catch (err) {
      try {
        this.db.close();
      } catch {
        /* the handle is being discarded either way; a close that fails must not
           replace the error the caller needs to see */
      }
      this.db = null;
      throw err;
    }
  }

  /**
   * Puts the database in WAL, once, and never fails the caller for it.
   *
   * The conversion is skipped when the database is already in WAL, which is
   * every open after the first — so on a busy board the lock is not contended
   * at all, and the retry is here for the one open that creates the file.
   */
  enableWriteAheadLog({ attempts = 40, delayMs = 25 } = {}) {
    if (this.currentJournalMode() === 'wal') return 'wal';
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.db.exec('PRAGMA journal_mode = WAL');
        if (this.currentJournalMode() === 'wal') return 'wal';
      } catch {
        // Another process is converting it. Fall through and wait.
      }
      sleepSync(delayMs);
    }
    return this.currentJournalMode();
  }

  currentJournalMode() {
    const row = this.db.prepare('PRAGMA journal_mode').get();
    return String(row?.journal_mode ?? '').toLowerCase();
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
   * Creates the schema, migrates it forward, and refuses to write over a newer
   * one.
   *
   * The version row is written with a plain conditional insert rather than a
   * read followed by an insert. The read-then-insert was outside any
   * transaction, so two processes opening a brand-new board at the same moment
   * both saw no row and both tried to write it — and the loser failed the very
   * first command of the very first session, with a message about a
   * constraint that has nothing to do with what the user asked for.
   */
  migrate() {
    const existing = this.currentSchemaVersion();
    // BEFORE `exec(SCHEMA)`, not after. A board written by a NEWER script threw
    // here — correctly — but only after CREATE TABLE IF NOT EXISTS had already
    // re-created whatever the newer version had, which is the worst way to lose
    // a board: it half-adopts a schema it is about to refuse.
    if (existing > SCHEMA_VERSION) {
      throw new BoardError(
        `board schema is v${existing}, this script writes v${SCHEMA_VERSION}; update the board script, not the database`,
        { code: 1 }
      );
    }
    // BEFORE `exec(SCHEMA)`, like the version guard above, and for the same
    // reason. `CREATE TABLE IF NOT EXISTS` would otherwise leave the board
    // holding eight tables it was about to declare it could not understand —
    // measured: a v2 board refused by a v3 script gained every table in SCHEMA
    // and kept its v2 stamp. Additive and idempotent, so not corruption, but it
    // is the half-adoption this method exists to avoid, and the two refusals in
    // one method ought to have the same contract.
    if (existing > 0 && existing < SCHEMA_VERSION) this.requireMigrationStep(existing);

    this.db.exec(SCHEMA);
    const migrated = existing > 0 && existing < SCHEMA_VERSION ? this.runMigrations(existing) : false;
    if (existing === 0) {
      this.db
        .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
        .run('schema_version', String(SCHEMA_VERSION));
    } else if (migrated) {
      /**
       * The version advances ONLY when a migration actually ran.
       *
       * An unconditional `UPDATE … WHERE value < 2` looked harmless and was a
       * trap: `currentSchemaVersion()` returns 0 when the read fails for ANY
       * reason, the migration is then skipped, and the stamp lands anyway — so
       * the board announces v2 with every lock's attribution still sitting in a
       * column nothing reads, and there is no error to send anyone back.
       */
      this.db
        .prepare('UPDATE meta SET value = ? WHERE key = ? AND CAST(value AS INTEGER) < ?')
        .run(String(SCHEMA_VERSION), 'schema_version', SCHEMA_VERSION);
    }
  }

  /**
   * Migrations in order, each from the version it actually follows.
   *
   * Returns whether a migration actually ran, and that return value is load
   * bearing: it is the ONLY thing that permits the version row to advance. A
   * version that advances without a migration is a board that claims to be
   * current while its data is not, and there is no error to send anyone back.
   */
  runMigrations(fromVersion) {
    this.requireMigrationStep(fromVersion);
    // RETURNED, not just called: `if (step) step();` discarded it, the version
    // row never advanced, and every open re-ran the migration.
    return this.migrationSteps()[fromVersion]();
  }

  /**
   * The migrations this script knows, each keyed by the version it follows.
   *
   * A METHOD rather than a literal inside `runMigrations`, because `migrate()`
   * has to ask the same question BEFORE it runs `exec(SCHEMA)` and a literal
   * scoped to the other method cannot answer it. Two tables would be two
   * answers.
   */
  migrationSteps() {
    return { 1: () => this.migrateFileLockAttribution() };
  }

  /**
   * A MISSING STEP IS A BUG IN THIS SCRIPT, and it used to pass for a
   * successful open.
   *
   * `SCHEMA_VERSION` was raised to 3 by two branches that both called their
   * first step "v2", while main's `steps` still started at 1 — so a board
   * stamped 2 found no `steps[2]`, got `false`, and the caller read that as
   * "no migration ran", which is precisely the value that WITHHOLDS the version
   * stamp. The board stayed at 2 with the new table created empty by
   * `exec(SCHEMA)` and nothing anywhere reporting an error.
   *
   * `integration/merge-sweep` shipped exactly that: v3, an `issue_files` table,
   * and no `steps[2]`. It reproduces on demand — open a main-written v2 board
   * with it and you get version 2, an empty `issue_files`, and exit 0.
   *
   * So a version this script claims to migrate, with no step to migrate it, now
   * REFUSES. The failure a caller can act on beats the one it cannot: "fix the
   * board script" is answerable, "your index is empty and nothing said so" is
   * not.
   *
   * It does NOT close the neighbouring hole: a v3 script whose `steps` are
   * `{1, 2}` opening a **v1** board runs only step 1 and then stamps v3 anyway,
   * because `migrate()` advances to `SCHEMA_VERSION` rather than to
   * `fromVersion + 1`. That is the same class of silent under-migration and the
   * more likely mistake for a branch that orders its steps wrongly. Left alone
   * deliberately: fixing it means deciding how a chain of steps composes, which
   * is a design question about the next migration rather than a repair of this
   * one.
   */
  requireMigrationStep(fromVersion) {
    if (!this.migrationSteps()[fromVersion]) {
      throw new BoardError(
        `board schema is v${fromVersion} and this script writes v${SCHEMA_VERSION}, but it has no v${fromVersion} migration step; add the step to migrationSteps() in db.mjs`,
        { code: 1 }
      );
    }
  }

  currentSchemaVersion() {
    try {
      const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version');
      return row ? Number(row.value) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * v1 → v2: a lock's `issue_id` became a row in `issue_locks`.
   *
   * Best-effort by necessity, and safe by construction, because a v1 board
   * could only record ONE issue per lock: an agent working two issues with one
   * file had the second silently dropped, and the most that was ever written
   * down is what can be carried forward.
   *
   * Two things make this survivable on a board nobody can inspect first. v1's
   * `file_locks.issue_id` had NO foreign key and `holdFiles` never validated
   * it, so `swarm hold x --issue ph-404` was accepted; v2 turns foreign keys on
   * before this runs, and a straight `INSERT … SELECT` then aborts the whole
   * migration on the first dangling id — leaving a board that cannot be opened
   * by any command, with no repair path, because you cannot open it to fix it.
   * Hence: JOIN the issues table, and count what was dropped.
   */
  migrateFileLockAttribution() {
    const columns = this.db.prepare('PRAGMA table_info(file_locks)').all();
    if (!columns.some((column) => column.name === 'issue_id')) return true;
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO issue_locks (issue_id, path, agent_id, created_at)
           SELECT f.issue_id, f.path, f.agent_id, f.acquired_at
           FROM file_locks f
           JOIN issues i ON i.id = f.issue_id
           WHERE f.issue_id IS NOT NULL AND f.released_at IS NULL`
        )
        .run();
      const dangling = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM file_locks f
           WHERE f.issue_id IS NOT NULL AND f.released_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM issues i WHERE i.id = f.issue_id)`
        )
        .get();
      this.addEvent('board.migrate', {
        message: `v1 → v2: ${result.changes} file-lock attribution(s) moved to issue_locks`,
        data: {
          from: 1,
          to: 2,
          moved: Number(result.changes),
          // Named rather than dropped silently: these were locks on files whose
          // issue no longer exists, and the operator is the only one who can say
          // whether the lock or the issue was the mistake.
          dropped_dangling_issue: Number(dangling?.n ?? 0),
        },
      });
      return true;
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
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

  /**
   * The NEWEST `limit` events, in the ascending order a log reader expects,
   * plus how many matched in total.
   *
   * A window is a set of MATCHING events, not a range of sequence numbers, so
   * the filter has to be inside the query: the last 200 `note` events can sit
   * anywhere in the log, and slicing the log by sequence and then filtering
   * loses them. An earlier version of this fix did the reverse — it read the
   * WHOLE log forward keeping a rolling buffer, on a comment claiming that
   * querying backwards was wrong. The claim was false: `ORDER BY seq DESC
   * LIMIT n` filtered in SQL is exactly this, in one indexed read, and it also
   * removes the O(log length) scan that made a bare `watch` slow on a long
   * board. `events_kind_idx` is `(kind, seq)`, so the filtered case is an index
   * seek as well.
   *
   * The reversal happens here so every caller gets a log in reading order; a
   * caller that forgot it would show the newest event first, which reads as a
   * board running backwards.
   */
  recentEvents({ limit = 200, kind = null, issue = null } = {}) {
    const where = [];
    const params = [];
    if (issue) {
      where.push('issue_id = ?');
      params.push(issue);
    }
    if (kind) {
      where.push('kind = ?');
      params.push(kind);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const matched = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...params)?.n ?? 0);
    const rows = this.db.prepare(`SELECT * FROM events ${clause} ORDER BY seq DESC LIMIT ?`).all(...params, limit);
    return { events: rows.reverse(), matched };
  }

  lastSeq() {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get();
    return Number(row?.seq ?? 0);
  }

  // --- agents -------------------------------------------------------------

  /**
   * Records that an agent exists and refreshes its liveness.
   *
   * `session_id` is written on INSERT and never updated: a branch outlives the
   * sessions that work in it, and overwriting the column on every touch kept
   * only the most recent run — which is the opposite of what the column is for.
   * A branch worked from three sessions wants to be findable from all three, so
   * the FIRST is kept and the live one is visible in `agents` via `last_seen`.
   */
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
        const existing = this.db.prepare('SELECT id, title FROM issues WHERE origin = ?').get(origin);
        if (existing) {
          /**
           * DRIFT. `origin` is a NUMBER, so an item that is renumbered upstream
           * keeps an origin the board already knows while the document's item
           * under that number is a different defect — and the board would then
           * show a correct-looking origin beside a stale title, claimable work
           * for a defect the document no longer contains.
           *
           * Recorded, never corrected. Only an agent reading both documents
           * knows whether item 2 was renumbered, re-titled, or replaced.
           */
          if (foldTitle(existing.title) !== foldTitle(title)) {
            this.recordDrift(existing.id, {
              origin,
              boardTitle: existing.title,
              docTitle: String(title).trim(),
              agent: createdBy,
            });
            return { id: existing.id, created: false, drift: true };
          }
          return { id: existing.id, created: false, drift: false };
        }
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
        for (const path of this.canonicalPaths(files)) {
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
   * default is the whole board because `swarm list` is also a status report.
   */
  listIssues({ status = null, scope = null, files = null, claimedBy = null, origin = null, limit = NO_LIMIT } = {}) {
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
      // `swarm list --claimed-by` saying otherwise sends the next agent round
      // the loop to find work that is already free.
      where.push(
        `EXISTS (SELECT 1 FROM claims c WHERE c.issue_id = issues.id AND c.agent_id = ? AND c.released_at IS NULL AND c.lease_until > ?)`
      );
      params.push(claimedBy, this.iso());
    }
    if (files && files.length > 0) {
      // Normalised, because `holdFiles` normalises: an absolute path here would
      // never match the relative form it stored. And lease-filtered, because
      // this query feeds a human a list of what is being worked on, which a
      // lock whose lease ran out is not.
      const wanted = this.canonicalPaths(files);
      if (wanted.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM issue_locks l WHERE l.issue_id = issues.id AND l.agent_id = ? AND l.path IN (${wanted
            .map(() => '?')
            .join(',')})
            AND EXISTS (SELECT 1 FROM file_locks f WHERE f.path = l.path AND f.agent_id = l.agent_id AND f.released_at IS NULL AND f.expires_at > ?))`
        );
        params.push(claimedBy ?? this.identity?.agentId ?? 'unknown', ...wanted, this.iso());
      }
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM issues ${clause}`)
      .all(...params)
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.created_at.localeCompare(b.created_at))
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
  readyIssues({ limit = NO_LIMIT } = {}) {
    const at = this.now();
    return this.listIssues({ limit: NO_LIMIT })
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
    return this.listIssues({ limit: NO_LIMIT }).filter(
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
      // The locks go through the pairing table, so a file this agent is still
      // using for ANOTHER live claim survives. Dropping them by `issue_id` is
      // what told the next agent a file was free while it was being edited.
      const freed = this.releaseIssueLocksInTransaction(id, at);
      if (['claimed'].includes(currentStatus(this.db, id))) {
        this.db.prepare('UPDATE issues SET status = ?, updated_at = ? WHERE id = ?').run('open', this.iso(), id);
      }
      this.addEvent('claim.release', {
        issue: id,
        agent: claim.agent_id,
        message: reason ?? 'released',
        data: { by: who, forced: Boolean(force), files_released: freed },
      });
      return { id, released: true, files_released: freed };
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
   * live one, which is how `swarm show` and the FILES column of `swarm ready`
   * came to advertise a file that `swarm check`, in the same breath, called
   * free. Anything that renders a lock to a human goes through here or through
   * `liveLocks`; anything that decides a conflict ALWAYS goes through
   * `liveLocks`, and never through this.
   */
  locksFor(issueId, at = this.now()) {
    const live = new Map(this.liveLocks(at).map((lock) => [`${lock.path}\0${lock.agent_id}`, lock]));
    return this.issueLocks(issueId, at)
      .map((pairing) => live.get(`${pairing.path}\0${pairing.agent_id}`))
      .filter(Boolean);
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
    const list = this.canonicalPaths(paths);
    if (list.length === 0) throw new BoardError('no file paths given', { code: 1 });
    // A path outside every worktree of this repository cannot be compared with
    // any lock, so holding it would create a row nothing can ever collide with —
    // a lock that protects nothing while looking like protection. `check`
    // refuses the same path for the same reason, and the two must agree.
    // Both ways of naming a file outside this repository: an absolute path that
    // no worktree prefix matched, and a relative one that climbs out of the
    // worktree root. Either way there is no lock it could ever collide with.
    const outside = list.filter((path) => path.startsWith('/') || path.startsWith('..'));
    if (outside.length > 0) {
      throw new BoardError(
        `not inside this repository: ${outside.join(', ')}. Locks cover this repository's files; ` +
          'pass a path relative to the worktree you are in.',
        { code: 1 }
      );
    }
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

  /**
   * Writes one file lock, and — when the lock is for an issue — records the
   * pairing. Callers must check `liveLocks` for a conflict first: this function
   * is unconditional by design, so that a re-hold extends a lease.
   *
   * The lock and the pairing are two rows because they are two facts. "This
   * agent is in this file" outlives any single issue, and "this issue is being
   * worked on with this file" is what a release has to undo. Forcing the second
   * into a column on the first is what let releasing one issue free a file
   * another live issue was using.
   */
  holdFileInTransaction(path, { issueId = null, agent, leaseMs = DEFAULT_LEASE_MS, at = this.now() } = {}) {
    const who = agent ?? this.identity?.agentId ?? 'unknown';
    this.db
      .prepare(
        `INSERT INTO file_locks (path, agent_id, worktree, acquired_at, expires_at, released_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path, agent_id) DO UPDATE SET
           worktree = COALESCE(excluded.worktree, file_locks.worktree),
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at,
           released_at = NULL`
      )
      .run(path, who, this.identity?.worktree ?? null, this.iso(), msFromNow(leaseMs, at));
    if (issueId) {
      // Resolved BEFORE the write, and not by the foreign key: a claim naming
      // an issue that does not exist is "not found", and the raw constraint
      // error that used to come out of here was neither that nor a message an
      // agent could act on — it was a stack trace, with the wrong exit code.
      this.getIssue(issueId);
      this.db
        .prepare(
          `INSERT INTO issue_locks (issue_id, path, agent_id, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(issue_id, path) DO NOTHING`
        )
        .run(issueId, path, who, this.iso());
    }
    return path;
  }

  /** The live file locks an issue is being worked on with. */
  issueLocks(issueId, at = this.now()) {
    return this.db
      .prepare('SELECT * FROM issue_locks WHERE issue_id = ?')
      .all(issueId)
      .filter((row) => this.liveLocks(at).some((lock) => lock.path === row.path && lock.agent_id === row.agent_id));
  }

  /**
   * Undoes one issue's hold on its files — and releases the underlying lock
   * ONLY when no other pairing still needs it.
   *
   * A lock exists because an agent is IN a file. A pairing says which issues
   * that is for, and the lock outlives any one of them.
   *
   * "Still in use" therefore means a surviving pairing whose issue is not
   * CLOSED — not one that happens to hold a live claim. The claim-based version
   * looked right and was wrong in normal use: `swarm hold src/x.ts --issue ph-2`
   * on an issue the agent has not claimed yet is a documented workflow, and a
   * predicate that only counts claimed issues let `release ph-1` free a file the
   * agent was still in, with no error anywhere. An unclaimed issue is precisely
   * the common case for a file an agent has just reserved.
   *
   * Closed is the right cut-off because closing releases the pairings itself:
   * verified, finished work is the one state in which nobody is editing.
   */
  releaseIssueLocksInTransaction(issueId) {
    const pairings = this.db.prepare('SELECT * FROM issue_locks WHERE issue_id = ?').all(issueId);
    const freed = [];
    for (const pairing of pairings) {
      this.db.prepare('DELETE FROM issue_locks WHERE issue_id = ? AND path = ?').run(issueId, pairing.path);
      const stillInUse = this.db
        .prepare(
          `SELECT l.issue_id FROM issue_locks l
           JOIN issues i ON i.id = l.issue_id
           WHERE l.path = ? AND l.agent_id = ? AND i.status != 'closed'`
        )
        .all(pairing.path, pairing.agent_id);
      if (stillInUse.length > 0) continue;
      this.db
        .prepare('UPDATE file_locks SET released_at = ? WHERE path = ? AND agent_id = ? AND released_at IS NULL')
        .run(this.iso(), pairing.path, pairing.agent_id);
      freed.push(pairing.path);
      this.addEvent('lock.release', {
        issue: issueId,
        agent: pairing.agent_id,
        path: pairing.path,
        message: 'released with the issue that held it',
      });
    }
    return freed;
  }

  releaseFiles(paths, { agent, force = false } = {}) {
    const who = agent ?? this.identity?.agentId;
    const list = this.canonicalPaths(paths);
    return this.transaction(() => {
      const released = [];
      for (const path of list) {
        const rows = this.db.prepare('SELECT * FROM file_locks WHERE path = ? AND released_at IS NULL').all(path);
        for (const row of rows) {
          if (row.agent_id !== who && !force) continue;
          this.db
            .prepare('UPDATE file_locks SET released_at = ? WHERE path = ? AND agent_id = ?')
            .run(this.iso(), path, row.agent_id);
          /**
           * The pairings go with the lock. Leaving them is not a harmless leak:
           * the "still in use" predicate counts a surviving pairing on a
           * non-closed issue, so an orphan pairing would keep this agent's lock
           * alive for ever with no lock row to explain it — the file would be
           * un-takeable and no command would say why.
           */
          const pairings = this.db
            .prepare('SELECT issue_id FROM issue_locks WHERE path = ? AND agent_id = ?')
            .all(path, row.agent_id);
          this.db.prepare('DELETE FROM issue_locks WHERE path = ? AND agent_id = ?').run(path, row.agent_id);
          released.push(path);
          for (const pairing of pairings) {
            this.addEvent('lock.release', {
              issue: pairing.issue_id,
              agent: row.agent_id,
              path,
              message: 'released',
              data: { by: who, forced: Boolean(force) },
            });
          }
          if (pairings.length === 0) {
            this.addEvent('lock.release', {
              agent: row.agent_id,
              path,
              message: 'released',
              data: { by: who, forced: Boolean(force) },
            });
          }
        }
      }
      return { released: [...new Set(released)] };
    });
  }

  /**
   * The path prefixes that mean "this repository" to this board.
   *
   * The caller's own worktree is the obvious one. The others are every worktree
   * the board has seen an agent in, and they matter because a lock is stored
   * repo-relative while a caller may hold an absolute path from a SIBLING
   * worktree: `<wt-b>/src/x.ts` is the same file as `<wt-a>/src/x.ts`, and an
   * agent that only knew its own root reported the file FREE — the silent,
   * dangerous half of this rule, since the whole point of a lock is that the
   * answer is not free.
   *
   * Longest first, so a worktree nested inside another's path cannot shadow it.
   * Cached per Board: one instance is one CLI invocation, and the set can only
   * grow as agents appear.
   */
  pathRoots() {
    if (this._pathRoots) return this._pathRoots;
    const roots = new Set();
    if (this.identity?.worktree) roots.add(this.identity.worktree);
    /**
     * From GIT, not from the `agents` table. Worktrees are a property of the
     * repository — `git worktree list` names all of them, including any that has
     * never run a command — and learning the roots from who has spoken last
     * left a window exactly where it does damage: agent A holds
     * `<worktree-B>/src/x.ts` by absolute path, agent B has never run a board
     * command, so B's `src/x.ts` matched no root, B's hold was GRANTED, and one
     * file ended up with two live locks and each agent told the other was not
     * in it. The agents table stays as a fallback for a board used with `--dir`
     * outside a repository, where git has nothing to enumerate.
     */
    try {
      const listed = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: this.identity?.worktree ?? process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of listed.split('\n')) {
        if (line.startsWith('worktree ')) roots.add(line.slice('worktree '.length).trim());
      }
    } catch {
      // Not a repository, or git refused: what is left is enough.
    }
    try {
      for (const row of this.db.prepare('SELECT DISTINCT worktree FROM agents WHERE worktree IS NOT NULL').all()) {
        roots.add(row.worktree);
      }
    } catch {
      // No agents table yet, or no row.
    }
    this._pathRoots = [...roots]
      .map((root) => `${String(root).split('\\').join('/').replace(/\/+$/, '')}/`)
      .sort((a, b) => b.length - a.length);
    return this._pathRoots;
  }

  /**
   * The repo-relative form of a path, or undefined if it is not in this
   * repository at all.
   *
   * The second attempt is not paranoia: on macOS `/tmp` is a symlink to
   * `/private/tmp`, `git rev-parse --show-toplevel` returns the RESOLVED path,
   * and a path typed by an agent or pasted from a shell keeps the symlink. So
   * `<wt>/src/x.ts` and `/tmp/<wt>/src/x.ts` are the same file and one of them
   * matched no root — and this function's caller is `swarm check`, whose entire
   * job is to answer "may I edit this". It answered FREE.
   *
   * Only the deepest EXISTING ancestor is resolved, because the file a caller
   * names usually does not exist yet and `realpathSync` refuses a path that
   * does not.
   */
  toRepoPath(path) {
    const typed = String(path ?? '').trim();
    const direct = normalizePaths([path], { roots: this.pathRoots() })[0];
    // A path that WAS given and normalised to nothing — the empty string, or a
    // worktree root with a trailing slash — is not a free file. It is a path
    // this board does not cover, and `check` answering "free" there is the
    // disagreement with `hold`, which refuses it.
    if (direct === undefined && typed !== '') return typed;
    // Only an ABSOLUTE path can be a symlinked spelling of a relative one. A
    // path that is already repo-relative is the canonical form, and resolving
    // it against the process's directory would turn the stored answer into an
    // absolute path that matches nothing.
    if (direct === undefined) return undefined;
    if (!String(path).trim().startsWith('/')) return direct;
    if (direct !== String(path).trim().replace(/^\.\//, '')) return direct;
    const resolved = resolveSymlinksBestEffort(path);
    if (resolved === null) return direct;
    return normalizePaths([resolved], { roots: this.pathRoots() })[0] ?? direct;
  }

  /**
   * The canonical form of every path in a list: repo-relative where it can be,
   * and with symlinks collapsed where it cannot.
   *
   * Every path that goes IN or comes OUT of a lock goes through here, on both
   * sides. Canonicalising only when reading meant a path under a symlinked
   * directory — `/tmp/…` on macOS — was stored unresolved by `holdFiles` and
   * compared resolved by `checkPath`, so the two could never meet.
   */
  canonicalPaths(paths) {
    const out = [];
    for (const path of Array.isArray(paths) ? paths : [paths]) {
      const canonical = this.toRepoPath(path);
      if (canonical === undefined || canonical === '') continue;
      if (!out.includes(canonical)) out.push(canonical);
    }
    return out;
  }

  /**
   * The files an issue is ABOUT, as recorded when it was filed.
   *
   * Not the locks. Those are a different question — who is IN a file right now —
   * and the import deliberately takes none, so a table that reported locks
   * showed `-` for all fifty-four imported items and told an agent nothing about
   * the work in front of it. The file list itself lives in the issue's own
   * `issue.create` event, which is where both filing paths (`swarm new` and
   * `swarm import`) put it, so it is there for every issue that exists.
   */
  /**
   * Records that a document's numbering and the board no longer agree.
   *
   * `origin` is a NUMBER, so a renumbered, re-titled or replaced item upstream
   * leaves the board holding a correct-looking origin beside a stale title — in
   * `ready`, claimable, while the document describes something else entirely.
   * That is the one way this board can be confidently wrong, and it is
   * detectable with one comparison because both sides are already here.
   *
   * Recorded and never corrected. Only an agent reading both documents knows
   * whether item 2 was renumbered, re-titled, or replaced — and correcting it
   * automatically would overwrite the board's copy of a defect with a title the
   * board has never seen. An event, so it survives the command that saw it.
   */
  recordDrift(issueId, { origin, boardTitle, docTitle, agent } = {}) {
    /**
     * Idempotent for an unchanged disagreement. Otherwise a single reworded
     * heading appends one `origin.drift` row to every import that ever runs,
     * for ever — an unbounded log entry about a thing nobody is acting on, which
     * is how a signal stops being read.
     */
    const data = { origin, board_title: boardTitle, doc_title: docTitle };
    const already = this.db
      .prepare("SELECT 1 FROM events WHERE kind = 'origin.drift' AND data = ? LIMIT 1")
      .get(JSON.stringify(data));
    if (already) return { issue: issueId, origin, boardTitle, docTitle, recorded: false };
    this.addEvent('origin.drift', {
      issue: issueId,
      agent: agent ?? this.identity?.agentId ?? 'unknown',
      message: `the document's ${origin} is now "${docTitle}"; the board has "${boardTitle}"`,
      data,
    });
    return { issue: issueId, origin, boardTitle, docTitle, recorded: true };
  }

  issueFiles(issueId) {
    const row = this.db
      .prepare("SELECT data FROM events WHERE issue_id = ? AND kind = 'issue.create' ORDER BY seq ASC LIMIT 1")
      .get(issueId);
    if (!row?.data) return [];
    try {
      const files = JSON.parse(row.data)?.files;
      return Array.isArray(files) ? this.canonicalPaths(files) : [];
    } catch {
      // A malformed event is a missing file list, not a crash in a listing.
      return [];
    }
  }

  /**
   * `swarm check <path>`: exit 0 free, 1 held. Scriptable on its own, and the
   * one query an agent or a shell is most likely to trust.
   *
   * It normalises its input with the SAME function `holdFiles` normalises with,
   * and that is load-bearing rather than tidiness. The worktree-prefix strip
   * went into `holdFiles` alone for a while, so a lock stored as `src/x.ts` was
   * compared against `/…/worktree/src/x.ts` and reported FREE — this command
   * exists to be the gate against two agents in one file, and it was inverted
   * for exactly the input a caller is most likely to paste in.
   */
  checkPath(path, { agent, at = this.now() } = {}) {
    const who = agent ?? this.identity?.agentId;
    const typed = String(path ?? '').trim();
    // Nothing was asked about. "Free" is an answer about a FILE, and a command
    // that checked no file must not hand back the exit code that means it did.
    if (typed === '') return { path, free: false, holders: [], outside: true, nothing: true };
    const normalized = this.toRepoPath(path);
    if (normalized === undefined) return { path, free: true, holders: [] };
    // An absolute path that survived the prefix strip is OUTSIDE every worktree
    // of this repository, so the board has no lock on it and cannot say it is
    // free — `hold` refuses such a path outright, and `check` answering "free"
    // where `hold` answers "no" is the disagreement that lets a shell gate on
    // the wrong one.
    if (normalized.startsWith('/') || normalized.startsWith('..')) {
      return { path: normalized, free: false, holders: [], outside: true };
    }
    const holders = this.liveLocks(at).filter((lock) => lock.path === normalized && lock.agent_id !== who);
    return { path: normalized, free: holders.length === 0, holders };
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
      /**
       * A closed issue is finished and VERIFIED, so nobody is editing its files
       * any more — and holding them until the lease runs out reserves work that
       * is already done for up to 45 minutes, after which `doctor` has to be
       * run to give the files back. Closing is the right place to release: not
       * at `resolve`, where the fixer may still be running tests, and not later.
       */
      const claim = this.liveClaimOrNull(id);
      if (claim) {
        this.db
          .prepare('UPDATE claims SET released_at = ?, lease_until = ? WHERE issue_id = ?')
          .run(this.iso(), this.iso(), id);
      }
      this.releaseIssueLocksInTransaction(id);
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
        // A reopened issue is advertised as ready while its own file locks stay
        // live for the rest of the lease, so the next agent reads "ready", takes
        // it, and is then refused its own file by the agent who reopened it.
        this.releaseIssueLocksInTransaction(id);
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
    for (const issue of this.listIssues({ limit: NO_LIMIT }))
      byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
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
      // Reported rather than fixed: `swarm status` is a read, and the one
      // command that releases an abandoned claim is `swarm doctor`.
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
  doctor({ at = this.now(), dryRun = false, record = true } = {}) {
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
    // A sweep is a fact about the swarm and the log is the only place it can be
    // seen from another session. But it is recorded ONLY when it released
    // something, because the sweep now runs on every command: an event per
    // invocation turned a six-event board into one that was two-thirds sweep
    // noise, which is the same flood the tailing fix was written for, and it
    // made `health` inflate the very number it was reporting.
    if (record && findings.length > 0) {
      this.addEvent('doctor.run', {
        message: findings.length
          ? `${findings.length} stale holding(s) ${dryRun ? 'would be released' : 'released'}`
          : 'nothing stale',
      });
    }
    if (!dryRun) {
      for (const finding of findings) {
        if (finding.issue) this.releaseClaim(finding.issue, { agent: finding.agent, force: true });
        /**
         * NO `force` here, and that is the whole point of the line.
         *
         * `releaseFiles` skips any row whose `agent_id` is not the one named —
         * UNLESS `force` is set, and `force` skips the check on EVERY row for
         * the path, not just the offending one. A sweep therefore used to revoke
         * live holders, not stale ones.
         *
         * The sequence needs no `--force` anywhere. A's lock on P lapses, so
         * `liveLocks` stops seeing it and B is granted P; two live rows for one
         * path are schema-legal, because the key is `(path, agent_id)`. Then ANY
         * `swarm` command from ANY agent runs `autoSweep` — `agent-board.mjs`
         * calls it on every command except `doctor` itself — and the sweep
         * released A's stale row *and B's live one*, handing the file to a third
         * agent while B was mid-edit.
         *
         * Without `force`, `finding.agent` is the holder of the row this sweep
         * actually found expired, so the guard releases exactly that row and
         * leaves every other holder alone. A separate finding is generated for
         * each expired row, so a second stale holder is still collected.
         *
         * A sweep agent may reclaim what has lapsed. It may NOT take a file away
         * from an agent that is still writing: only the operator stops a chat.
         */
        if (finding.path) this.releaseFiles([finding.path], { agent: finding.agent });
      }
    }
    return findings;
  }

  /**
   * Keeps this agent's own claims alive, using the only liveness signal nobody
   * has to remember to send.
   *
   * The lease was a promise the holder had to keep by hand: `claim.renew` fired
   * ONCE in 238 events, and 4 of 5 unreleased claims ended up expired while
   * their holders were very likely still working. A heartbeat nobody sends is
   * not a liveness signal, it is a countdown that always runs out.
   *
   * What an agent cannot forget is existing: it has a worktree on disk, and
   * that directory is here long after the session that made it has stopped
   * caring. So the worktree IS the heartbeat, and this renews while it stands.
   *
   * The event is written only when the lease actually needed it — otherwise
   * every command an agent runs writes a `claim.renew`, which turns the log
   * into the thing `watch` already had to be fixed for once: a few hundred
   * events re-printed on every poll.
   */
  renewOwnClaims({ at = this.now(), leaseMs = DEFAULT_LEASE_MS } = {}) {
    const agentId = this.identity?.agentId;
    if (!agentId) return [];
    // An agent with no worktree has no way to prove it is alive, so it keeps
    // the manual contract. That is the outside-a-worktree case, and it is the
    // one where `claim.renew` still means something.
    const worktree = this.identity?.worktree;
    if (!worktree || !existsDir(worktree)) return [];
    const until = new Date(at + leaseMs).toISOString();
    // Scoped to claims made FROM THIS WORKTREE, not merely by this agent id.
    //
    // Identity is the git BRANCH, so two agents on one branch in different
    // worktrees are the same `agent_id` to this table — and the two halves of
    // `autoSweep` were asking different questions about the same row. Renewal
    // asked "is a worktree I can see still on disk?", using the CALLER's path;
    // `doctor` asks "is the worktree named in THIS ROW gone?". For a single
    // agent those coincide. For a shared branch they cannot both be true, and a
    // live agent extended a dead colleague's lease, then released it in the same
    // invocation.
    //
    // `worktree IS NULL` keeps the legacy intent: a claim recorded before a
    // worktree was known still renews, because refusing to renew it would
    // silently convert every such claim into a 45-minute countdown.
    const mine = this.db
      .prepare('SELECT * FROM claims WHERE released_at IS NULL AND agent_id = ? AND (worktree IS NULL OR worktree = ?)')
      .all(agentId, worktree)
      .filter((claim) => Date.parse(claim.lease_until) - at < leaseMs / 2);
    for (const claim of mine) {
      this.db.prepare('UPDATE claims SET lease_until = ? WHERE issue_id = ?').run(until, claim.issue_id);
      this.addEvent('claim.renew', { issue: claim.issue_id, message: 'lease extended by presence' });
    }
    return mine.map((claim) => claim.issue_id);
  }

  /**
   * The maintenance a board should never need a human to run: keep my own
   * claims alive because I exist, then release the ones whose holder does not.
   *
   * Order matters and is the whole reason this is safe. Renewing first means a
   * working agent's lease is never the thing that gets swept, so the sweep can
   * only ever reclaim a claim whose worktree is gone — which is precisely when
   * reclaiming it is correct. Sweeping first, as a bare `doctor` on every open
   * would, hands a 45-minute timer the power to strip a lock off an agent in
   * the middle of an edit.
   */
  autoSweep({ at = this.now(), dryRun = false } = {}) {
    const renewed = dryRun ? [] : this.renewOwnClaims({ at });
    const released = this.doctor({ at, dryRun, record: !dryRun });
    return { renewed, released };
  }

  /**
   * Is this board being used, or only carried? One command, because the
   * question was previously answered by hand-writing SQL against a schema, and
   * an instrument nobody can read is the same as no instrument.
   */
  health({ at = this.now() } = {}) {
    const byKind = new Map();
    for (const event of this.db.prepare('SELECT kind, COUNT(*) n FROM events GROUP BY kind').all()) {
      byKind.set(event.kind, event.n);
    }
    const total = [...byKind.values()].reduce((a, b) => a + b, 0);
    const count = (kind) => byKind.get(kind) ?? 0;
    /**
     * The unit of a row, read off the row rather than off a list kept beside it.
     *
     * Summing these into one total is what produced a published, wrong number.
     * `lock.hold` is ONE event for a command that took any number of files (its
     * message says so: "14 file(s)"), `lock.release` is ONE event PER FILE, and
     * a good share of the holds took no files at all ("filed about 2 file(s),
     * no locks taken" — the filer was refused). So an agent that holds fourteen
     * files and later releases them writes 1 row and 14, and a share computed
     * over the sum describes the ENCODING rather than the swarm: it reported
     * that 66% of locking traffic was `lock.release`, which was an artifact, and
     * that number reached AGENTS.md before anyone noticed.
     *
     * A row that names a path is about one file; a row that does not is about
     * one command. That is derivable from the data, so it is derived, and the
     * two are reported as two numbers rather than added into a third.
     */
    const perFile = new Map();
    const perCommand = new Map();
    for (const row of this.db
      .prepare(
        `SELECT kind, CASE WHEN path IS NULL THEN 0 ELSE 1 END AS is_file, COUNT(*) n
         FROM events GROUP BY kind, is_file`
      )
      .all()) {
      (row.is_file ? perFile : perCommand).set(row.kind, row.n);
    }
    const summed = (map) => [...map.values()].reduce((a, b) => a + b, 0);

    /**
     * The lock truth, from the table rather than from the log: one row per lock
     * actually taken, which is the only count that answers "how much of this
     * repository is under a lock right now".
     */
    const lockRows = this.db
      .prepare('SELECT COUNT(*) taken, SUM(CASE WHEN released_at IS NULL THEN 1 ELSE 0 END) live FROM file_locks')
      .get();
    const taken = lockRows.taken ?? 0;
    const liveLocks = lockRows.live ?? 0;
    const unreleased = this.db.prepare('SELECT * FROM claims WHERE released_at IS NULL').all();
    const live = unreleased.filter((claim) => Date.parse(claim.lease_until) > at);
    const open = this.listIssues({ status: ['open', 'deferred'], limit: NO_LIMIT });
    const liveIssues = open.filter((issue) => !isImportedOrigin(issue.origin));
    return {
      total,
      byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
      /**
       * Split by unit, because the two are not additive and never were. Read
       * these as two separate measures of activity, never as two halves of one
       * number.
       */
      activity: {
        perCommand: Object.fromEntries([...perCommand].sort((a, b) => b[1] - a[1])),
        perFile: Object.fromEntries([...perFile].sort((a, b) => b[1] - a[1])),
        perCommandTotal: summed(perCommand),
        perFileTotal: summed(perFile),
      },
      locks: { taken, live: liveLocks, released: taken - liveLocks },
      claims: { total: unreleased.length, live: live.length, expired: unreleased.length - live.length },
      // Reclaims the board has made by itself, which is the number that says
      // whether maintenance is running — and it stays 0 on a healthy board,
      // because a sweep that found nothing is not an event.
      sweeps: count('doctor.run'),
      deps: this.db.prepare('SELECT COUNT(*) n FROM deps').get().n,
      issues: { open: open.length, live: liveIssues.length, imported: open.length - liveIssues.length },
      /**
       * Live findings nobody has touched, because a finding with no activity is
       * a finding whose reader has gone away.
       *
       * REPORTED, never expired. The durable record for a defect is
       * HANDOFF.md, and this board says so itself: a finding that goes idle
       * here is one that has not been moved somewhere it will still be read.
       * Deleting it would destroy a real observation because nobody happened to
       * be looking, which is the opposite of what a coordination tool is for.
       * What this number is for is telling a human which findings are about to
       * fall out of the conversation.
       */
      idleLive: liveIssues
        .filter((issue) => at - Date.parse(issue.created_at) > IDLE_LIVE_MS)
        .map((issue) => ({
          id: issue.id,
          title: issue.title,
          idleMs: at - Date.parse(issue.created_at),
        })),
    };
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
 * Collapses `.` and `..` segments lexically.
 *
 * `src/../src/held.ts` and `src/held.ts` are the same file, and a lock that
 * treats them as two lets the second agent take a file the first is in. This is
 * lexical on purpose — `resolve` would touch the filesystem, and the point of
 * comparing paths is that the file may not exist yet.
 */
/**
 * A title, folded to the form two spellings of the same sentence share.
 *
 * Drift is a comparison of titles, so anything a word processor or a later hand
 * changes incidentally — an em-dash for a hyphen, a curly quote, a trailing
 * period, a re-wrapped heading — turns a routine rewording into "the document's
 * item 2 is a different defect", permanently, reported on every import. The
 * comparison has to see through typography or it will cry wolf until an agent
 * stops reading it.
 */
export function foldTitle(title) {
  return String(title ?? '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The priority a title states for itself, if any.
 *
 * The handoff documents label their entries `P0`–`P3`, and the board has four
 * levels, so the mapping is direct. It lives here rather than in the import
 * because it is a property of a TITLE, not of where the title came from: when
 * `swarm new` and `swarm import` disagreed about `P0 — …`, the same defect had
 * two urgencies depending on which command filed it.
 */
const SEVERITY_HEADING = /^P(\d{1,3})\b/i;
const SEVERITY_TO_PRIORITY = { 0: 'critical', 1: 'high', 2: 'normal', 3: 'low' };

export function priorityFromTitle(title) {
  const match = SEVERITY_HEADING.exec(String(title ?? '').trim());
  if (!match) return null;
  return SEVERITY_TO_PRIORITY[Number(match[1])] ?? null;
}

function collapseSegments(path) {
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '') {
      if (segments.length === 0 && segment === '') segments.push('');
      continue;
    }
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
      else segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  const collapsed = segments.join('/');
  return collapsed === '' ? '.' : collapsed;
}

/**
 * Paths are recorded as repo-relative, POSIX-separated, so that a lock taken
 * in one worktree matches the same file named in another.
 *
 * The worktree prefixes are stripped because a machine resolves the same
 * repository to different absolute paths — macOS answers `/private/var/...`
 * where Linux answers `/var/...` — and two agents on one machine still name the
 * same file differently when one says `src/x.ts` and the other says
 * `/Users/me/ph/.kilo/worktrees/agent-board/src/x.ts`. That is precisely when a
 * file lock stops working, so the comparison happens on the relative form.
 *
 * A path that is not under ANY known worktree is left alone rather than guessed
 * at: it is outside everything this board coordinates, and a wrong guess there
 * is a lock on the wrong file.
 */
export function normalizePaths(paths, { worktree = null, roots = null } = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  const prefixes = (roots ?? (worktree ? [worktree] : []))
    .map((root) => `${String(root).split('\\').join('/').replace(/\/+$/, '')}/`)
    .sort((a, b) => b.length - a.length);
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let normalized = trimmed.split('\\').join('/').replace(/^\.\//, '');
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length);
        break;
      }
    }
    // AFTER the prefix strip, so `a/b/../b/c` inside a worktree collapses too.
    // Skipping this let `check src/../src/held.ts` report a held file as FREE,
    // which is the one answer this board must never get wrong.
    normalized = collapseSegments(normalized);
    // A bare worktree path collapses to nothing, and a lock on `.` — or on the
    // empty string — is a lock on a file no agent can name, so both are dropped
    // rather than stored.
    if (normalized === '' || normalized === '.') continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}
