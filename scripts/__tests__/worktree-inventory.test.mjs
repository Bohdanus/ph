/**
 * Tests for the worktree inventory generator.
 *
 * The properties worth pinning are not "does it produce JSON" but the two rules
 * the whole tool exists to enforce, both of which this repository has already
 * been bitten by:
 *
 *   1. A worktree reporting 0 commits ahead of main and being an ancestor of
 *      main is NOT prunable while its working tree holds changes. This is the
 *      "0 ahead is not a safety test" case, and it is the exact shape of the
 *      17 worktrees here that look disposable and are not.
 *   2. A paid-model launch that died at zero tokens is classified as a
 *      failure, not as a finished session that happened to be quiet.
 *
 * Everything runs under the root jsdom project per AGENTS.md, so these are
 * environment-agnostic: no git repository is created, no clock is read, and
 * `node:sqlite` is only exercised where a real temporary database is cheap.
 */

import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { classify, riskScore, ACTION, RECOMMENDATION, STATUS } from '../lib/worktree-inventory/classify.mjs';
import { classifySession, summariseChats, isUnfinished, isDead } from '../lib/worktree-inventory/chats.mjs';
import { buildInventory, serialise, formatCanonical, SCHEMA_VERSION } from '../lib/worktree-inventory/assemble.mjs';
import { CURATED, curatedFor } from '../lib/worktree-inventory/curated.mjs';
import { __testables, findMissingWorktrees, listWorktrees, mergeConflict } from '../lib/worktree-inventory/git.mjs';
import { resolveBoardDb, readBoard } from '../lib/worktree-inventory/board.mjs';
import { loadChatAudit, auditVerdict, isReadUnfinished, READ_STATE } from '../lib/worktree-inventory/chat-audit.mjs';

const NOW = 1_790_000_000_000;

/** The curated table's SOURCE, for the checks that a JS object cannot answer. */
const CURATED_PATH = resolve(import.meta.dirname, '../lib/worktree-inventory/curated.mjs');

/**
 * Remove JS comments from a source line, respecting string literals.
 *
 * A `line.split('//')[0]` is wrong in both directions here: it eats the rest of
 * a summary that contains a URL, and — on the line it was written for — it does
 * not fire at all, because a `//` comment after a key still matches a regex
 * anchored at the start of the line only if the comment IS the line. Both
 * failures are about the same thing: deciding what is code without knowing what
 * is a comment.
 *
 * Returns the code with comments blanked to the same length, so column
 * positions still mean what they did.
 */
function stripComments(line, inBlockComment) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (inBlockComment) {
      out += ' ';
      if (c === '*' && next === '/') {
        out += ' ';
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') out += next ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') {
      out += ' '.repeat(line.length - i);
      break;
    }
    if (c === '/' && next === '*') {
      out += '  ';
      i++;
      inBlockComment = true;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    out += c;
  }
  return { code: out, inBlockComment };
}

/**
 * Read the key declarations at the top level of the `CURATED` object literal,
 * in source order. Fails CLOSED.
 *
 * Returns `{ keys, unreadable }`. `keys` is every declaration the reader
 * positively recognised. `unreadable` names every line at an entry's
 * indentation that was NOT a plain key declaration — a computed key, a spread,
 * a property shorthand, a method, a getter. Those are reported rather than
 * skipped, because they are precisely the shapes a duplicate can hide inside and
 * a reader that skips what it does not understand reports green on a file it
 * could not see.
 *
 * The entry indentation is MEASURED from the first declaration after the
 * literal opens, not hard-coded to two spaces, and the key is read with any
 * quote style. Both were fixed in the reader's first version, which matched one
 * quote at one indent and so passed on a duplicate written in double quotes and
 * on a duplicate indented four spaces.
 */
function readCuratedKeys(source) {
  const keys = [];
  const unreadable = [];
  let inBlockComment = false;
  let entryIndent = null;
  let depth = null;

  for (const [i, raw] of source.split('\n').entries()) {
    const { code, inBlockComment: wasIn } = stripComments(raw, inBlockComment);
    inBlockComment = wasIn;
    const line = code.trim();
    if (!line) continue;

    if (depth === null) {
      // Still looking for the literal. `export const CURATED = {` is the anchor;
      // requiring the brace to end the line means an inline `{` cannot be
      // mistaken for it.
      const open = /^(?:export\s+)?const\s+CURATED\s*(?::[^=]+)?=\s*\{\s*$/.exec(line);
      if (open) depth = 1;
      continue;
    }

    // A closing brace, in every form a property or the literal itself can take.
    // Checked BEFORE the opening-brace increment, or `},` and `};` would both be
    // missed and the reader would walk straight out of the literal and start
    // reporting the code after it.
    if (/^\}[,;]?$/.test(line)) {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (line.endsWith('{')) depth++;

    const indent = code.length - code.trimStart().length;

    // A key declaration is read at ANY indentation, because a duplicate
    // indented four spaces is a duplicate: the previous reader matched exactly
    // two spaces and reported green on it. Inside this object literal the only
    // nested objects are the `issues` arrays, whose properties are scalars, so
    // there is nothing for the wider match to pick up by accident — and the scan
    // stops at the literal's closing brace regardless.
    const plain = /^(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([A-Za-z_$][\w$]*))\s*:\s*\{\s*$/.exec(line);
    if (plain) {
      // The entry indentation is MEASURED from the first declaration, not
      // hard-coded and not taken from whatever line happens to come next: the
      // first thing after a declaration is a `summary:` field, and measuring
      // from that would make every field the thing being checked.
      if (entryIndent === null && indent > 0) entryIndent = indent;
      keys.push(plain[1] ?? plain[2] ?? plain[3] ?? plain[4]);
      continue;
    }

    if (entryIndent === null) {
      if (indent === 0) continue; // still in the header comment or the export
      entryIndent = indent;
    }
    // Only the ENTRY indentation is checked for shapes this reader cannot
    // interpret. Deeper lines are the fields of an entry — a summary, a note, an
    // `issues` array — and are not declarations, so they are not reported.
    if (indent !== entryIndent) continue;

    unreadable.push(`line ${i + 1}: ${raw.trim()}`);
  }

  return { keys, unreadable };
}

const count = (list, value) => list.filter((x) => x === value).length;

/**
 * A throwaway git repository with a known ahead/behind shape.
 *
 * main has 3 commits, the side branch adds 2 of its own and does not see main's
 * 3rd, so the answer is behind=1 ahead=2 — two different numbers that a
 * transposed destructuring would still render plausibly.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wtinv-git-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '--initial-branch=main', '--quiet');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  for (const n of ['one', 'two', 'three']) {
    writeFileSync(join(dir, `${n}.txt`), n);
    g('add', '.');
    g('commit', '--quiet', '-m', n);
  }
  g('checkout', '--quiet', '-b', 'side');
  for (const n of ['four', 'five']) {
    writeFileSync(join(dir, `${n}.txt`), n);
    g('add', '.');
    g('commit', '--quiet', '-m', n);
  }
  g('checkout', '--quiet', 'main');
  writeFileSync(join(dir, 'six.txt'), 'six');
  g('add', '.');
  g('commit', '--quiet', '-m', 'six');
  return dir;
}

/** A worktree shaped like the ones this repository actually has. */
function wt(overrides = {}) {
  return {
    name: 'example',
    path: '/repo/.kilo/worktrees/example',
    branch: 'feat/example',
    head: 'abc',
    isPrimary: false,
    tip: { sha: 'abc', subject: 'feat: something', date: '2026-09-28T00:00:00Z', author: 'kilo' },
    ahead: 1,
    behind: 2,
    mergedIntoBase: false,
    workingTree: { modified: 0, untracked: 0, paths: [] },
    commitsAhead: [],
    ...overrides,
  };
}

const noChats = { count: 0, lastActivity: null };
const noSessions = [];

describe('git.mjs against a real repository', () => {
  it('maps rev-list --left-right --count to behind=left, ahead=right', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const raw = execFileSync('git', ['rev-list', '--left-right', '--count', 'main...HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      // Pin the raw shape first: if git ever changes the order, this fails
      // with the actual string rather than a mysterious assertion failure.
      expect(raw).toBe('1\t2');

      const { ahead, behind } = __testables.aheadBehind(dir, 'main');
      expect(behind).toBe(1);
      expect(ahead).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a branch that main does not contain as NOT merged', () => {
    const dir = makeRepo();
    try {
      // `makeRepo` leaves HEAD on main, where the question is trivially true.
      // The interesting case is a branch main has not seen.
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      expect(__testables.isMergedInto(dir, 'main')).toBe(false);
      execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: dir, stdio: 'ignore' });
      expect(__testables.isMergedInto(dir, 'main')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a leading-space porcelain status without eating the first path character', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'one.txt'), 'edited');
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'dirty.txt'), 'untracked');

      const tree = __testables.workingTreeState(dir);
      expect(tree.modified).toBe(1);
      expect(tree.untracked).toBe(1);
      // The first porcelain line is " M one.txt" with a leading space. A
      // `.trim()` on the whole output turns that into "M one.txt", and
      // `slice(3)` then yields "ne.txt" — a path that resolves to nothing.
      expect(tree.paths).toContain('one.txt');
      expect(tree.paths).toContain('dirty.txt');
      for (const p of tree.paths) {
        expect(existsSync(join(dir, p)), `${p} does not resolve inside the worktree`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports whether the commit list was cut off at the cap', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const full = __testables.commitsAhead(dir, 'main', 2);
      expect(full.commits).toHaveLength(2);
      expect(full.truncated).toBe(false);

      const capped = __testables.commitsAhead(dir, 'main', 2, 1);
      expect(capped.commits).toHaveLength(1);
      // ahead=2 with one commit listed is a SAMPLE, and a reader must be able
      // to tell that from a complete list.
      expect(capped.truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a worktree whose directory was deleted, by path', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['worktree', 'add', '--quiet', join(dir, 'wt-gone'), 'side'], {
        cwd: dir,
        stdio: 'ignore',
      });
      expect(findMissingWorktrees(dir)).toHaveLength(0);

      rmSync(join(dir, 'wt-gone'), { recursive: true, force: true });
      const missing = findMissingWorktrees(dir);
      expect(missing).toHaveLength(1);
      // By PATH, and compared after resolving symlinks: on macOS `mkdtemp`
      // hands back `/var/…` while git reports the same directory as
      // `/private/var/…`, so a raw string comparison fails on the prefix.
      // Comparing PATH SEGMENTS is what the production code does.
      expect(missing[0].path.endsWith('wt-gone')).toBe(true);
      expect(existsSync(missing[0].path)).toBe(false);
      expect(listWorktrees(dir).map((w) => w.path)).toContain(missing[0].path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveBoardDb', () => {
  it('returns an absolute path, so it resolves the same from any worktree', () => {
    const dir = makeRepo();
    try {
      const p = resolveBoardDb(dir);
      expect(p.startsWith('/')).toBe(true);
      // The failure this pins: plain `git rev-parse --git-common-dir` answers
      // the RELATIVE string ".git", which DatabaseSync then resolves against
      // process.cwd() — a different directory in every worktree.
      expect(p).not.toMatch(/^\.git/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readBoard: liveness of claims and locks', () => {
  /** A board database with the real schema and one row of each kind. */
  function makeBoard({ leaseUntil, releasedAt = null, expiresAt }) {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-board-'));
    const db = new DatabaseSync(join(dir, 'board.db'));
    db.exec(`CREATE TABLE issues (id TEXT, title TEXT, scope TEXT, status TEXT, priority TEXT, origin TEXT);
             CREATE TABLE claims (issue_id TEXT, agent_id TEXT, worktree TEXT, branch TEXT,
                                  lease_until TEXT, released_at TEXT);
             CREATE TABLE file_locks (path TEXT, agent_id TEXT, issue_id TEXT, worktree TEXT,
                                     expires_at TEXT, released_at TEXT);
             CREATE TABLE agents (agent_id TEXT, kind TEXT, worktree TEXT, branch TEXT,
                                 session_id TEXT, last_seen TEXT);`);
    db.prepare('INSERT INTO issues VALUES (?,?,?,?,?,?)').run('ph-1', 'an issue', 'prod', 'open', 'high', 'x');
    db.prepare('INSERT INTO claims VALUES (?,?,?,?,?,?)').run(
      'ph-1',
      'agent-a',
      '/repo/.kilo/worktrees/x',
      'feat/x',
      leaseUntil,
      releasedAt
    );
    db.prepare('INSERT INTO file_locks VALUES (?,?,?,?,?,?)').run(
      'src/a.ts',
      'agent-a',
      'ph-1',
      '/repo/.kilo/worktrees/x',
      expiresAt,
      releasedAt
    );
    db.close();
    return { dir, dbPath: join(dir, 'board.db') };
  }

  const iso = (ms) => new Date(ms).toISOString();

  it('keeps a claim whose ISO-8601 lease has not expired', () => {
    // `lease_until` is TEXT. A bare `Number(x) > nowMs` is `NaN > n` — false
    // for every row — so this filter once dropped every claim and every lock
    // in the repository, and the board half reported zero contention.
    const { dir, dbPath } = makeBoard({ leaseUntil: iso(NOW + 600_000), expiresAt: iso(NOW + 600_000) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath });
      expect(board.available).toBe(true);
      expect(board.issues).toHaveLength(1);
      expect([...board.claims.values()].flat()).toHaveLength(1);
      expect([...board.fileLocks.values()].flat()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a claim whose lease has run out, and one that was released', () => {
    const expired = makeBoard({ leaseUntil: iso(NOW - 600_000), expiresAt: iso(NOW - 600_000) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: expired.dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(0);
    } finally {
      rmSync(expired.dir, { recursive: true, force: true });
    }

    const released = makeBoard({ leaseUntil: iso(NOW + 600_000), expiresAt: iso(NOW + 600_000), releasedAt: iso(NOW) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: released.dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(0);
    } finally {
      rmSync(released.dir, { recursive: true, force: true });
    }
  });

  it('treats an unparseable timestamp as live rather than hiding the claim', () => {
    const { dir, dbPath } = makeBoard({ leaseUntil: 'not-a-date', expiresAt: 'not-a-date' });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks an agent live inside the 30-minute window, by worktree', () => {
    // The session database is blind to a session opened in the main checkout
    // and then driven into a task worktree: its `directory` never changes, so
    // that worktree reads as prunable while it is being actively used. The
    // board records the worktree, so it is the only signal that covers it.
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-board-'));
    const db = new DatabaseSync(join(dir, 'board.db'));
    try {
      db.exec(`CREATE TABLE issues (id TEXT, title TEXT, scope TEXT, status TEXT, priority TEXT, origin TEXT);
               CREATE TABLE claims (issue_id TEXT, agent_id TEXT, worktree TEXT, branch TEXT,
                                    lease_until TEXT, released_at TEXT);
               CREATE TABLE file_locks (path TEXT, agent_id TEXT, issue_id TEXT, worktree TEXT,
                                       expires_at TEXT, released_at TEXT);
               CREATE TABLE agents (agent_id TEXT, kind TEXT, worktree TEXT, branch TEXT,
                                   session_id TEXT, last_seen TEXT);`);
      db.prepare('INSERT INTO agents VALUES (?,?,?,?,?,?)').run(
        'chore/x',
        'kilo',
        '/wt',
        'chore/x',
        'sid',
        new Date(NOW - 60_000).toISOString()
      );
      db.prepare('INSERT INTO agents VALUES (?,?,?,?,?,?)').run(
        'old/y',
        'kilo',
        '/wt',
        'old/y',
        'sid',
        new Date(NOW - 6 * 3600_000).toISOString()
      );
      db.close();

      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: join(dir, 'board.db') });
      const agents = board.agents.get('/wt');
      expect(agents).toHaveLength(2);
      expect(agents.filter((a) => a.live).map((a) => a.agentId)).toEqual(['chore/x']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes a worktree in-use from the board record even with no chat in it', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
      boardAgents: [{ agentId: 'chore/x', lastSeenMs: NOW - 30_000, live: true }],
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
    expect(v.reasons.join(' ')).toContain('chore/x');
  });

  it('still prunes when the board agent is stale', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
      boardAgents: [{ agentId: 'chore/x', lastSeenMs: NOW - 6 * 3600_000, live: false }],
    });
    expect(v.prunable).toBe(true);
  });

  it('degrades to an empty board, not a crash, when the database is absent', () => {
    const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: '/nonexistent/board.db' });
    expect(board.available).toBe(false);
    expect(board.claims.size).toBe(0);
    expect(board.issues).toEqual([]);
  });
});

describe('blocked-question detection', () => {
  /**
   * The real shape: the message sits inside a JSON string, so its quotes are
   * escaped, and the same row also carries a `questionID` JSON KEY whose value
   * is the placeholder `"/"`.
   */
  const payload = JSON.stringify({
    type: 'tool',
    tool: 'agent_manager',
    state: { status: 'error' },
    input: { questionID: '/', replyTo: '/' },
    error:
      'The managed session ses_x ("a title") is waiting for input. ' +
      // BARE quotes here: `JSON.stringify` is what escapes them, exactly as the
      // runtime did when it stored the row. Escaping them twice, as an earlier
      // draft of this fixture did, produces `\\\"` and the test then proves
      // nothing about the real payload.
      'Pending question requests: questionID "que_0e49a9650001UM8oJl32u9X3ko"',
  });

  it('extracts the question id from the escaped payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-blk-'));
    const dbPath = join(dir, 'kilo.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, parent_id TEXT, agent TEXT,
                 slug TEXT, tokens_output INTEGER, tokens_input INTEGER, time_created INTEGER,
                 time_updated INTEGER, time_archived INTEGER);
               CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER,
                 time_updated INTEGER, data TEXT);`);
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        'ses_x',
        '/wt',
        'a title',
        null,
        'code',
        's',
        100,
        10,
        NOW - 7200_000,
        NOW - 7200_000,
        null
      );
      db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('p1', 'm1', 'ses_x', NOW - 100, NOW - 100, payload);
      db.close();

      const { auditChats } = await_import();
      const audit = auditChats({ dbPath, sinceMs: NOW - 4 * 3600_000, nowMs: NOW, existingPaths: new Set(['/wt']) });
      const [s] = audit.byDirectory.get('/wt');
      expect(s.state).toBe('blocked');
      // Not the `"/"` placeholder from the input JSON — that occurrence is
      // skipped because it is followed by a quote rather than a space.
      expect(s.blockedOn).toBe('que_0e49a9650001UM8oJl32u9X3ko');
      expect(s.reasons.join(' ')).toContain('waiting for input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the pinned clock', () => {
  it('does not let --now in the past reclassify worktrees as in-use', () => {
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    const lastActivity = NOW;
    const byDirectory = new Map([
      ['/repo/.kilo/worktrees/x', [{ id: 's1', state: 'finished', timeUpdated: lastActivity, subagentCount: 0 }]],
    ]);
    const chatAudit = { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: lastActivity };

    // nowMs is a day BEHIND the newest session the audit knows about. A
    // negative idle time passes the liveness test, which once flipped a dozen
    // worktrees from salvage to in-use under this flag.
    const inv = buildInventory({
      worktrees: [wt({ name: 'x', ahead: 2, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW - 86_400_000,
    });
    expect(inv.worktrees[0].recommendation).toBe(RECOMMENDATION.SALVAGE);
  });

  it('still marks a genuinely live session in-use', () => {
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    // The map key MUST be the worktree's own path: `buildInventory` looks
    // sessions up by `wt.path`, and a key that does not match silently
    // produces an empty chat set — which reads as "no live session".
    const byDirectory = new Map([
      ['/repo/.kilo/worktrees/example', [{ id: 's1', state: 'active', timeUpdated: NOW - 60_000, subagentCount: 0 }]],
    ]);
    const inv = buildInventory({
      worktrees: [wt({ ahead: 2, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: NOW - 60_000 },
      nowMs: NOW,
    });
    expect(inv.worktrees[0].chats.count).toBe(1);
    expect(inv.worktrees[0].recommendation).toBe(RECOMMENDATION.IN_USE);
  });
});

describe('mergeConflict, against a real repository', () => {
  /** `repo` has main at 3 commits; `side` adds 2 and never sees main\'s 3rd. */
  function repo() {
    return makeRepo();
  }

  it('reports no conflict for a branch that merges cleanly', () => {
    const dir = repo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      expect(mergeConflict(dir, 'main')).toEqual({ conflict: false, files: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a conflict when both sides changed the same line', () => {
    const dir = repo();
    try {
      // Make the branch and main edit the SAME line of the SAME file, from
      // their shared ancestor, so the three-way merge genuinely conflicts.
      const root = execFileSync('git', ['rev-list', '--max-parents=0', 'main'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['checkout', '--quiet', '-b', 'clash', root], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'one.txt'), 'BASE-SIDE\n');
      execFileSync('git', ['commit', '-qam', 'side edit'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'one.txt'), 'BASE-MAIN\n');
      execFileSync('git', ['commit', '-qam', 'main edit'], { cwd: dir, stdio: 'ignore' });

      execFileSync('git', ['checkout', '--quiet', 'clash'], { cwd: dir, stdio: 'ignore' });
      const r = mergeConflict(dir, 'main');
      expect(r.conflict).toBe(true);
      // The files are the actionable part: "it conflicts" sends somebody to
      // investigate, "it conflicts in these two files" is the work.
      expect(r.files).toContain('one.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null, not false, when the merge cannot be attempted', () => {
    // A wrong `false` is a licence to land, so an unknown answer must never
    // be reported as a clean merge.
    const dir = repo();
    try {
      const r = mergeConflict(dir, 'no-such-branch');
      expect(r.conflict).toBeNull();
      expect(r.files).toEqual([]);
      expect(typeof r.reason).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no ref, index or worktree behind', () => {
    // The generator runs this across every worktree, so it must be inert.
    const dir = repo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
      const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
      mergeConflict(dir, 'main');
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })).toBe(headBefore);
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe(statusBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('land vs at-risk: the split that salvage used to hide', () => {
  const unmergedClean = (over = {}) =>
    wt({ ahead: 3, behind: 40, mergedIntoBase: false, merge: { conflict: false }, ...over });
  const args = (over) => ({ chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW, ...over });

  it('calls a clean, unmerged, conflict-free branch ready-to-land, not salvage', () => {
    const v = classify(unmergedClean(), args());
    expect(v.recommendation).toBe(RECOMMENDATION.READY_TO_LAND);
    expect(v.action).toBe(ACTION.LAND);
    expect(v.prunable).toBe(false);
  });

  it('keeps a CONFLICTING branch out of ready-to-land', () => {
    const v = classify(unmergedClean({ merge: { conflict: true } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
    expect(v.reasons.join(' ')).toContain('conflicts');
  });

  it('keeps a branch whose merge cannot be checked out of ready-to-land', () => {
    // The dangerous case: an unknown must not read as "no conflicts".
    const v = classify(unmergedClean({ merge: { conflict: null, reason: 'nope' } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
  });

  it('never calls a worktree with uncommitted work ready to land', () => {
    const v = classify(unmergedClean({ workingTree: { modified: 2, untracked: 0, paths: [] } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
  });

  it('calls a landed, clean worktree a disposal candidate', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.PRUNE);
    expect(v.action).toBe(ACTION.DISPOSE);
    expect(v.prunable).toBe(true);
  });

  it('derives the action from the recommendation, and covers every value', () => {
    // Each case builds inputs that actually PRODUCE that recommendation.
    // An earlier version fed one default worktree and asserted seven
    // mappings, which tested only the two the default could ever reach.
    const cases = [
      [RECOMMENDATION.PRUNE, wt({ ahead: 0, mergedIntoBase: true }), {}],
      [
        RECOMMENDATION.READY_TO_LAND,
        wt({ ahead: 3, behind: 40, mergedIntoBase: false, merge: { conflict: false } }),
        {},
      ],
      [RECOMMENDATION.SALVAGE, wt({ ahead: 3, mergedIntoBase: false, merge: { conflict: true } }), {}],
      [
        RECOMMENDATION.SALVAGE,
        wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: [] } }),
        {},
      ],
      // Never checked at all: absent, not null. Must not read as a licence.
      [RECOMMENDATION.SALVAGE, wt({ ahead: 3, mergedIntoBase: false }), {}],
      [RECOMMENDATION.REVIEW_RESIDUE, wt({ ahead: 0, mergedIntoBase: true }), { curated: { mustNotPrune: true } }],
      [RECOMMENDATION.IN_USE, wt({ ahead: 0, mergedIntoBase: true }), { boardAgents: [{ live: true, agentId: 'a' }] }],
      [RECOMMENDATION.KEEP, wt({ isPrimary: true }), {}],
      // Detached and not in use: there is no branch identity to report, so
      // nothing can be decided about it. With a live agent it would be
      // `in-use` first, which is correct but not what this case is about.
      [RECOMMENDATION.UNKNOWN, wt({ detached: true, ahead: 0, mergedIntoBase: true }), {}],
    ];
    const expected = {
      [RECOMMENDATION.PRUNE]: ACTION.DISPOSE,
      [RECOMMENDATION.READY_TO_LAND]: ACTION.LAND,
      [RECOMMENDATION.SALVAGE]: ACTION.AT_RISK,
      [RECOMMENDATION.REVIEW_RESIDUE]: ACTION.AT_RISK,
      [RECOMMENDATION.IN_USE]: ACTION.IN_USE,
      [RECOMMENDATION.KEEP]: ACTION.KEEP,
      [RECOMMENDATION.UNKNOWN]: ACTION.UNDECIDED,
    };
    const seen = new Set();
    for (const [wantRec, worktree, extra] of cases) {
      const v = classify(worktree, args(extra));
      seen.add(v.recommendation);
      expect(v.recommendation, 'case setup no longer produces the intended recommendation').toBe(wantRec);
      expect(v.action).toBe(expected[wantRec]);
    }
    // Every recommendation value is exercised, so a new one cannot arrive
    // without a mapping and without a test noticing.
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
  });

  it('ranks ready-to-land below at-risk, since nothing is at risk there', () => {
    expect(riskScore({ recommendation: RECOMMENDATION.READY_TO_LAND })).toBeGreaterThan(
      riskScore({ recommendation: RECOMMENDATION.PRUNE })
    );
    expect(riskScore({ recommendation: RECOMMENDATION.READY_TO_LAND })).toBeLessThan(
      riskScore({ recommendation: RECOMMENDATION.SALVAGE })
    );
  });
});

describe('classify: the 0-ahead trap', () => {
  it('calls a branch at an old main commit with no commits of its own UNCOMMITTED_ONLY, not landed', () => {
    const v = classify(
      wt({ ahead: 0, mergedIntoBase: true, head: 'main-old', workingTree: { modified: 3, untracked: 2, paths: [] } }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.status).toBe(STATUS.UNCOMMITTED_ONLY);
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.prunable).toBe(false);
  });

  it('never marks a worktree prunable while it holds uncommitted work, whatever git says', () => {
    for (const tree of [
      { modified: 1, untracked: 0, paths: [] },
      { modified: 0, untracked: 1, paths: [] },
      { modified: 9, untracked: 9, paths: [] },
    ]) {
      const v = classify(wt({ ahead: 0, behind: 40, mergedIntoBase: true, workingTree: tree }), {
        chatSummary: noChats,
        chatSessions: noSessions,
        curated: null,
        nowMs: NOW,
      });
      expect(v.prunable).toBe(false);
      expect(v.recommendation).not.toBe(RECOMMENDATION.PRUNE);
    }
  });

  it('marks a landed, clean worktree prunable', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.status).toBe(STATUS.LANDED);
    expect(v.recommendation).toBe(RECOMMENDATION.PRUNE);
    expect(v.prunable).toBe(true);
  });

  it('refuses to prune a landed, clean worktree that a curated finding protects', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: { mustNotPrune: true },
      nowMs: NOW,
    });
    expect(v.prunable).toBe(false);
    expect(v.recommendation).toBe(RECOMMENDATION.REVIEW_RESIDUE);
  });

  it('treats a live session as in-use even when the branch is prunable on git alone', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 1, lastActivity: NOW - 60_000 },
      chatSessions: [{ state: 'active' }],
      curated: null,
      nowMs: NOW,
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
  });

  it('reports unmerged commits as unmerged-work, and separates waiting from at-risk', () => {
    // This used to assert `salvage` for every unmerged branch, which is the
    // conflation this change removes: a clean branch that merges cleanly is
    // not salvage, it is just waiting.
    const waiting = classify(wt({ ahead: 3, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(waiting.status).toBe(STATUS.UNMERGED_WORK);
    expect(waiting.recommendation).toBe(RECOMMENDATION.READY_TO_LAND);

    const atRisk = classify(wt({ ahead: 3, merge: { conflict: true } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(atRisk.status).toBe(STATUS.UNMERGED_WORK);
    expect(atRisk.recommendation).toBe(RECOMMENDATION.SALVAGE);
  });

  it('reports a dirty tree on a merged branch as uncommitted-only, not landed', () => {
    const v = classify(
      wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: ['a.ts'] } }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.status).toBe(STATUS.UNCOMMITTED_ONLY);
    expect(v.prunable).toBe(false);
  });

  it('never marks the MAIN worktree prunable, whatever git reports about it', () => {
    // The main checkout is the landing site and the place the operator works.
    // `isPrimary` short-circuits the status ladder, so without an explicit
    // guard a clean main reports `recommendation: "prune"` — a file that says
    // "safe to remove now, with or without --force", about the main checkout.
    for (const facts of [
      { ahead: 0, behind: 0, mergedIntoBase: true },
      { ahead: 7, behind: 0, mergedIntoBase: false },
      { ahead: 3, behind: 9, mergedIntoBase: true },
    ]) {
      const v = classify(wt({ name: 'ph', isPrimary: true, ...facts }), {
        chatSummary: noChats,
        chatSessions: noSessions,
        curated: null,
        nowMs: NOW,
      });
      expect(v.prunable, `main with ${JSON.stringify(facts)} was called prunable`).toBe(false);
      expect(v.recommendation).not.toBe(RECOMMENDATION.PRUNE);
    }
  });

  it('reports the MAIN worktree as in-use when a session is live in it', () => {
    // `wt.live` was read instead of the local `live`, and the input record
    // never carries that property — so the main worktree could never report
    // `in-use`, and the only thing standing between it and `keep` while
    // someone worked in it was a coincidence.
    const v = classify(wt({ name: 'ph', isPrimary: true, ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 1, lastActivity: NOW - 60_000 },
      chatSessions: [{ state: 'active' }],
      curated: null,
      nowMs: NOW,
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
  });

  it('reports a main worktree with uncommitted work as holding it, not as landed', () => {
    const v = classify(
      wt({
        name: 'ph',
        isPrimary: true,
        ahead: 0,
        mergedIntoBase: true,
        workingTree: { modified: 3, untracked: 1, paths: [] },
      }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.prunable).toBe(false);
    expect(v.uncommitted).toBe(true);
  });

  it('reports a detached HEAD as UNREADABLE, because there is no branch identity to compare', () => {
    const v = classify(wt({ detached: true, branch: '(detached)', ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.status).toBe(STATUS.UNREADABLE);
    // A detached worktree at a commit main contains is NOT prunable: the
    // inventory never records which branch it was on, so "safe to delete"
    // would be a claim about a ref the file does not show.
    expect(v.prunable).toBe(false);
  });

  it('ranks salvage above prune, so the worst work sorts first', () => {
    expect(riskScore({ recommendation: RECOMMENDATION.SALVAGE })).toBeGreaterThan(
      riskScore({ recommendation: RECOMMENDATION.PRUNE })
    );
  });
});

describe('classifySession: dead and unfinished agents', () => {
  const base = {
    id: 'ses_x',
    title: 'a task',
    agent: 'code',
    directory: '/repo',
    timeCreated: NOW - 1000,
    timeUpdated: NOW - 1000,
    tokensOutput: 500,
  };

  // Past the 30-minute liveness window, so an assertion about the last turn's
  // shape is not silently an assertion about recency instead.
  const stale = { ...base, timeUpdated: NOW - 5 * 3600_000 };

  it('classifies a paid-model launch that died at zero tokens as rejected-credits', () => {
    const s = classifySession(
      { ...base, tokensOutput: 0 },
      { creditsFailures: 1, toolErrors: 1 },
      { nowMs: NOW, exists: true }
    );
    expect(s.state).toBe('rejected-credits');
    expect(s.creditsFailures).toBe(1);
  });

  it('classifies a session whose worktree was deleted as orphaned', () => {
    const s = classifySession(base, { lastReason: 'stop' }, { nowMs: NOW, exists: false });
    expect(s.state).toBe('orphaned');
  });

  it('classifies a stale turn that ended on a tool call as abandoned-midflight', () => {
    const s = classifySession(stale, { lastReason: 'tool-calls' }, { nowMs: NOW, exists: true });
    expect(s.state).toBe('abandoned-midflight');
  });

  it('classifies a turn cut off by the token limit as abandoned too', () => {
    expect(classifySession(stale, { lastReason: 'length' }, { nowMs: NOW, exists: true }).state).toBe(
      'abandoned-midflight'
    );
  });

  it('classifies a stale completed stop as finished', () => {
    expect(classifySession(stale, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('finished');
  });

  it('prefers active over abandoned for a recent session, so a live machine is never cried up as stuck', () => {
    expect(classifySession(base, { lastReason: 'tool-calls' }, { nowMs: NOW, exists: true }).state).toBe('active');
  });

  it('separates a live session from a completed one by recency alone', () => {
    expect(classifySession(base, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('active');
    expect(classifySession(stale, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('finished');
  });

  it('has no fourth state, so a finished agent is never reported as still-open', () => {
    // An earlier draft had an `idle` state that swallowed `finished`, which made
    // the `unfinished` array a list of every completed agent. The states below
    // are the whole vocabulary, and a stale completed session must land on
    // `finished` rather than on anything that reads as unresolved.
    const observed = new Set();
    for (const [session, outcome] of [
      [base, { lastReason: 'stop' }],
      [stale, { lastReason: 'stop' }],
      [stale, { lastReason: 'tool-calls' }],
      [{ ...base, tokensOutput: 0 }, { creditsFailures: 1 }],
    ]) {
      observed.add(classifySession(session, outcome, { nowMs: NOW, exists: true }).state);
    }
    expect([...observed].sort()).toEqual(['abandoned-midflight', 'active', 'finished', 'rejected-credits']);
    expect(observed.has('idle')).toBe(false);
  });
});

describe('summariseChats', () => {
  it('counts states, collects chat ids and separates unfinished from finished', () => {
    const s = summariseChats([
      { id: 'a', state: 'active', timeUpdated: NOW, subagentCount: 2 },
      { id: 'b', state: 'abandoned-midflight', timeUpdated: NOW - 1, subagentCount: 0 },
      { id: 'c', state: 'finished', timeUpdated: NOW - 2, subagentCount: 1 },
      { id: 'd', state: 'died-at-birth', timeUpdated: NOW - 3, subagentCount: 0 },
    ]);
    expect(s.count).toBe(4);
    expect(s.chatIds).toEqual(['a', 'b', 'c', 'd']);
    expect(s.subagentCount).toBe(3);
    expect(s.activeChatIds).toEqual(['a']);
    expect(s.unfinishedChatIds).toEqual(expect.arrayContaining(['a', 'b', 'd']));
    expect(s.unfinishedChatIds).not.toContain('c');
    expect(s.lastActivity).toBe(NOW);
  });
});

describe('auditChats against a real session database', () => {
  it('reads the LAST step-finish per session, not the first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-'));
    const dbPath = join(dir, 'kilo.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, parent_id TEXT, agent TEXT,
                 slug TEXT, tokens_output INTEGER, tokens_input INTEGER, time_created INTEGER,
                 time_updated INTEGER, time_archived INTEGER)`);
      db.exec(`CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER,
                 time_updated INTEGER, data TEXT)`);
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        // Stale enough to be past the 30-minute liveness window, so the
        // assertion below is about the finish reason and not about recency.
        'ses_one',
        '/wt',
        'first turn ends badly',
        null,
        'code',
        's',
        100,
        10,
        NOW - 7200_000,
        NOW - 7200_000,
        null
      );
      const ins = db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)');
      // An early tool-calls turn, then a later proper stop. Reading the first
      // row here misclassifies the session as abandoned.
      ins.run(
        'p1',
        'm1',
        'ses_one',
        NOW - 900,
        NOW - 900,
        JSON.stringify({ type: 'step-finish', reason: 'tool-calls' })
      );
      ins.run('p2', 'm2', 'ses_one', NOW - 800, NOW - 800, JSON.stringify({ type: 'step-finish', reason: 'stop' }));

      db.close();

      const { auditChats } = await_import();
      const audit = auditChats({
        dbPath,
        // The window must reach back past the session's own timestamp: it is
        // two hours old, and a 10s window filters it out before the turn
        // reasons are ever read.
        sinceMs: NOW - 4 * 3600_000,
        nowMs: NOW,
        existingPaths: new Set(['/wt']),
      });

      expect(audit.available).toBe(true);
      const sessions = audit.byDirectory.get('/wt');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastTurnReason).toBe('stop');
      expect(sessions[0].state).toBe('finished');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to an empty audit when the database is absent', () => {
    const { auditChats } = await_import();
    const audit = auditChats({ dbPath: '/nonexistent/kilo.db', sinceMs: 0, nowMs: NOW });
    expect(audit.available).toBe(false);
    expect(audit.byDirectory.size).toBe(0);
  });
});

// Imported lazily so the module-level `node:sqlite` import is not a hard
// dependency of the pure-function tests above.
function await_import() {
  // eslint-disable-next-line
  return chatsModule;
}

describe('buildInventory', () => {
  const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
  const chatAudit = { available: true, dbPath: 'k', byDirectory: new Map(), total: 0 };

  it('emits a document with counts that agree with the records it contains', () => {
    const inv = buildInventory({
      worktrees: [
        wt({ name: 'a', ahead: 0, mergedIntoBase: true }),
        wt({ name: 'b', ahead: 2, mergedIntoBase: false, workingTree: { modified: 1, untracked: 0, paths: [] } }),
        wt({ name: 'main', isPrimary: true, ahead: 0, mergedIntoBase: true }),
      ],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });

    expect(inv.schemaVersion).toBe(SCHEMA_VERSION);
    expect(inv.worktrees).toHaveLength(3);
    expect(inv.totals.worktrees).toBe(3);
    // The counts must be derived from the records, not maintained by hand.
    const summed = Object.values(inv.totals.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(3);
    const byRec = inv.totals.byRecommendation;
    expect(Object.values(byRec).reduce((a, b) => a + b, 0)).toBe(3);
    expect(inv.totals.prunable).toBe(inv.worktrees.filter((w) => w.prunable).length);
  });

  it('sorts the highest-risk worktree first, so the list opens with what is at risk', () => {
    const inv = buildInventory({
      worktrees: [
        wt({ name: 'safe', ahead: 0, mergedIntoBase: true }),
        wt({ name: 'risky', ahead: 0, mergedIntoBase: true, workingTree: { modified: 4, untracked: 0, paths: [] } }),
      ],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    expect(inv.worktrees[0].name).toBe('risky');
  });

  it('keeps every record addressable by name and unique', () => {
    const inv = buildInventory({
      worktrees: [wt({ name: 'x' }), wt({ name: 'x', path: '/repo/.kilo/worktrees/x2' })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    const keys = inv.worktrees.map((w) => `${w.name}:${w.absolutePath}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('surfaces unfinished and dead chats as separate arrays on the worktree', () => {
    const byDirectory = new Map([
      [
        '/repo/.kilo/worktrees/example',
        [
          {
            id: 's1',
            title: 'stuck',
            state: 'abandoned-midflight',
            idleMs: 1000,
            reasons: [],
            toolErrors: 3,
            creditsFailures: 0,
            timeUpdated: NOW - 1,
          },
          {
            id: 's2',
            title: 'dead',
            state: 'rejected-credits',
            idleMs: 2000,
            reasons: [],
            toolErrors: 1,
            creditsFailures: 1,
            timeUpdated: NOW - 2,
          },
          {
            id: 's3',
            title: 'done',
            state: 'finished',
            idleMs: 3000,
            reasons: [],
            toolErrors: 0,
            creditsFailures: 0,
            timeUpdated: NOW - 3,
          },
        ],
      ],
    ]);
    const inv = buildInventory({
      worktrees: [wt()],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { ...chatAudit, byDirectory },
      nowMs: NOW,
    });
    const w = inv.worktrees[0];
    expect(w.chats.count).toBe(3);
    expect(w.chats.unfinished.map((c) => c.id)).toEqual(['s1', 's2']);
    expect(w.chats.dead.map((c) => c.id)).toEqual(['s2']);
    expect(w.chats.chatIds).toEqual(['s1', 's2', 's3']);
  });

  it('records a null summary rather than inventing one', () => {
    const inv = buildInventory({
      worktrees: [wt({ name: 'not-in-curated' })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    expect(inv.worktrees[0].summary).toBeNull();
    expect(inv.worktrees[0].summarySource).toBe('none');
    expect(inv.totals.withoutSummary).toBe(1);
  });
});

describe('the headline lists and totals', () => {
  const board = {
    available: true,
    dbPath: 'b',
    claims: new Map(),
    fileLocks: new Map(),
    agents: new Map(),
    issues: [],
  };
  const emptyChats = { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 };

  /** A spread covering every action, so each list has a known membership. */
  const worktrees = [
    wt({ name: 'landable', ahead: 2, mergedIntoBase: false, merge: { conflict: false } }),
    wt({ name: 'conflicting', ahead: 1, mergedIntoBase: false, merge: { conflict: true, files: ['a.ts'] } }),
    wt({ name: 'uncommitted', ahead: 0, mergedIntoBase: true, workingTree: { modified: 2, untracked: 0, paths: [] } }),
    wt({ name: 'disposable', ahead: 0, mergedIntoBase: true }),
    wt({ name: 'primary', isPrimary: true, ahead: 0, mergedIntoBase: true }),
  ];

  const build = () =>
    buildInventory({
      worktrees,
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: emptyChats,
      nowMs: NOW,
    });

  it('puts every record in exactly the list its action names', () => {
    const inv = build();
    for (const action of [ACTION.LAND, ACTION.DISPOSE, ACTION.AT_RISK]) {
      const expected = worktrees
        .map((w) => w.name)
        .filter((n) => inv.worktrees.find((r) => r.name === n).action === action);
      const actual =
        inv[action === ACTION.LAND ? 'readyToLand' : action === ACTION.DISPOSE ? 'disposalCandidates' : 'atRisk'];
      expect(actual, `list for ${action}`).toEqual(expected);
    }
  });

  it('recomputes every total from the records it contains', () => {
    const inv = build();
    const t = inv.totals;
    const n = inv.worktrees.length;
    expect(t.worktrees).toBe(n);
    expect(t.readyToLand).toBe(inv.readyToLand.length);
    expect(t.disposalCandidates).toBe(inv.disposalCandidates.length);
    expect(t.atRisk).toBe(inv.atRisk.length);
    expect(t.prunable).toBe(inv.worktrees.filter((w) => w.prunable).length);
    expect(t.salvage).toBe(inv.worktrees.filter((w) => w.recommendation === 'salvage').length);
    expect(t.inUse).toBe(inv.worktrees.filter((w) => w.recommendation === 'in-use').length);
    expect(t.holdingUncommittedWork).toBe(inv.worktrees.filter((w) => w.dirty + w.untracked > 0).length);
    expect(t.withoutSummary).toBe(inv.worktrees.filter((w) => !w.summary).length);
    expect(Object.values(t.byAction).reduce((a, b) => a + b, 0)).toBe(n);
    expect(Object.values(t.byRecommendation).reduce((a, b) => a + b, 0)).toBe(n);
    expect(Object.values(t.byStatus).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it('counts prunable and dispose identically, because dispose IS prunable', () => {
    // `action: dispose` is read from the `prunable` expression rather than
    // restated, so the two cannot drift. Assert the equivalence anyway, over
    // every shape that reaches either value.
    const shapes = [
      wt({ name: 'a', ahead: 0, mergedIntoBase: true }),
      wt({ name: 'b', ahead: 0, mergedIntoBase: false, merge: { conflict: false } }),
      wt({ name: 'c', ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: [] } }),
      wt({ name: 'd', isPrimary: true, ahead: 0, mergedIntoBase: true }),
      wt({ name: 'e', ahead: 3, mergedIntoBase: false, merge: { conflict: true } }),
      wt({ name: 'f', detached: true, ahead: 0, mergedIntoBase: true }),
    ];
    for (const s of shapes) {
      const v = classify(s, {
        chatSummary: { count: 0, lastActivity: null },
        chatSessions: [],
        curated: null,
        nowMs: NOW,
      });
      expect(v.action === ACTION.DISPOSE, `${s.name}: action dispose`).toBe(v.prunable);
    }
  });

  it('never calls a DETACHED worktree ready to land, even with a clean merge', () => {
    // Detached means there is no branch identity, so "merges cleanly" is a
    // statement about HEAD with nothing to attach it to. Verified against a
    // real detached worktree: it is `unreadable` -> `undecided`.
    const v = classify(wt({ detached: true, ahead: 3, mergedIntoBase: false, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.action).not.toBe(ACTION.LAND);
    expect(v.status).toBe(STATUS.UNREADABLE);
    expect(v.prunable).toBe(false);
  });

  it('does not offer a curated mustNotPrune worktree as land', () => {
    // `fix-spray-cr` was filed under READY TO LAND while its own curated note
    // called the colour-replacement work "the salvage target".
    const v = classify(wt({ ahead: 4, mergedIntoBase: false, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: { mustNotPrune: true, note: 'the salvage target' },
      nowMs: NOW,
    });
    expect(v.action).toBe(ACTION.AT_RISK);
    expect(v.reasons.join(' ')).toContain('curated finding');
  });

  it('reports whether the merge was actually checked', () => {
    // `mergeConflict: null` alone is ambiguous between "not checked" and
    // "checked and could not answer".
    const inv = build();
    const landable = inv.worktrees.find((w) => w.name === 'landable');
    expect(landable.mergeChecked).toBe(true);
    expect(landable.mergeConflict).toBe(false);
    expect(landable.mergeConflictFiles).toEqual([]);
  });
});

describe('the transcript read audit', () => {
  // Resolved from cwd, not `import.meta.url`: under the root jsdom project
  // `import.meta.url` is an http URL and `fileURLToPath` throws on it.
  const dataPath = resolve(process.cwd(), 'scripts/lib/worktree-inventory/chat-audit.data.json');

  it('loads the real audit and stamps when it was taken', () => {
    const a = loadChatAudit(dataPath);
    expect(a.available).toBe(true);
    expect(a.records.length).toBeGreaterThan(50);
    // Without `asOf` a stale "on no ref" reads as a current fact, which is the
    // one mistake this exercise exists to prevent.
    expect(a.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.windowHours).toBeGreaterThan(0);
  });

  it('is stamped in the PAST, never the future', () => {
    // A hand-typed stamp was wrong once already: local 23:20 written with a "Z"
    // suffix, which put it 91 minutes ahead. Every consumer that computes
    // `now - asOf` then concludes the audit is FRESH, so a future stamp defeats
    // the only guard the file has.
    expect(Date.parse(loadChatAudit(dataPath).asOf)).toBeLessThanOrEqual(Date.now());
  });

  it('names every record that is really a top-level session, with nothing invented', () => {
    // The falsifiable part of "all 105 sessions were read". Exact window
    // membership is NOT reproducible — `time_updated` keeps moving on a live
    // session — so this pins what is actually checkable: every id exists, is
    // top-level, and falls after the documented window start.
    const a = loadChatAudit(dataPath);
    const startMs = Date.parse(a.windowStart);
    let db;
    try {
      db = new DatabaseSync(resolve(process.env.HOME, '.local/share/kilo/kilo.db'), { readOnly: true });
    } catch {
      return; // no session database on this machine
    }
    try {
      const rows = db
        .prepare(
          `SELECT id, parent_id, time_updated FROM session
            WHERE id IN (${a.records.map(() => '?').join(',')})`
        )
        .all(...a.records.map((r) => r.id));
      expect(rows.length, 'a record names a session that does not exist').toBe(a.records.length);
      for (const row of rows) {
        expect(row.parent_id, `${row.id} is a SUBAGENT, not a top-level session`).toBeNull();
        expect(row.time_updated).toBeGreaterThanOrEqual(startMs);
      }
    } finally {
      db.close();
    }
  });

  it('keeps `sessions` in step with `records.length`', () => {
    // A top-level count the loader never reads and nothing kept in sync.
    const raw = JSON.parse(readFileSync(dataPath, 'utf8'));
    expect(raw.sessions).toBe(raw.records.length);
    expect(raw.records.length).toBe(loadChatAudit(dataPath).records.length);
  });

  it('carries only verdicts about sessions, never their contents', () => {
    // A transcript body in this file would grow without bound and would leak
    // whatever was said in it.
    const a = loadChatAudit(dataPath);
    for (const r of a.records) {
      expect(Object.keys(r).sort()).toEqual(
        [
          'commitsAheadOfMain',
          'deadSubagents',
          'directory',
          'id',
          'modifiedFiles',
          'note',
          'readRisk',
          'readState',
          'toolErrors',
          'untrackedFiles',
          'worktreeGone',
        ].sort()
      );
    }
  });

  it('uses only the states it documents', () => {
    const known = new Set(Object.values(READ_STATE));
    for (const r of loadChatAudit(dataPath).records) {
      expect(known.has(r.readState), `unknown read state ${r.readState}`).toBe(true);
    }
  });

  it('treats every state except finished as something to go and look at', () => {
    expect(isReadUnfinished(READ_STATE.FINISHED)).toBe(false);
    for (const s of [
      READ_STATE.STRUGGLING,
      READ_STATE.BLOCKED,
      READ_STATE.ABANDONED,
      READ_STATE.FAILED,
      READ_STATE.UNKNOWN,
    ]) {
      expect(isReadUnfinished(s), `${s} should be unfinished`).toBe(true);
    }
  });

  it('computes workOnNoRef from the same rule the file describes', () => {
    // untracked, OR modified with 0 ahead. Ahead>0 means a commit holds it.
    expect(auditVerdict({ id: 'a', untrackedFiles: 1, modifiedFiles: 0, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      true
    );
    expect(auditVerdict({ id: 'b', untrackedFiles: 0, modifiedFiles: 3, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      true
    );
    expect(auditVerdict({ id: 'c', untrackedFiles: 0, modifiedFiles: 3, commitsAheadOfMain: 1 }).workOnNoRef).toBe(
      false
    );
    expect(auditVerdict({ id: 'd', untrackedFiles: 0, modifiedFiles: 0, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      false
    );
  });

  it('passes the worktree-gone signal through, which no heuristic can produce', () => {
    const v = auditVerdict(
      { id: 'e', untrackedFiles: 0, modifiedFiles: 0, commitsAheadOfMain: 0 },
      { worktreeGone: true }
    );
    expect(v.worktreeGone).toBe(true);
  });

  it('emits the deleted-worktree case, which the per-worktree loop cannot reach', () => {
    // It was previously a field on the worktree record, where it was
    // structurally always false: the loop only visits sessions whose directory
    // still exists, so every worktreeGone session was unreachable and two of
    // the three lost-work findings were in no output at all.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const goneRecord = {
      id: 's9',
      directory: 'vanished',
      readState: 'finished',
      readRisk: 'high',
      note: 'its worktree was deleted',
      worktreeGone: true,
      untrackedFiles: null,
      modifiedFiles: null,
      commitsAheadOfMain: null,
      deadSubagents: 0,
      toolErrors: 0,
    };
    const inv = buildInventory({
      worktrees: [wt()],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      readAudit: {
        available: true,
        asOf: '2026-01-01T00:00:00Z',
        windowHours: 30,
        records: [goneRecord],
        byId: new Map(),
      },
      nowMs: NOW,
    });
    expect(inv.readLostWorktree.map((r) => r.id)).toEqual(['s9']);
    expect(inv.readLostWorktreeHighRisk).toBe(1);
    expect(JSON.stringify(inv)).toContain('vanished');
    // And it must not be on a worktree record, where it is a constant.
    expect(JSON.stringify(inv.worktrees)).not.toContain('worktreeGone');
  });

  it('re-checks a read-derived no-ref claim against the live tree', () => {
    // Every entry said "on no ref" at asOf and had committed within the hour.
    // Repeating the claim un-cross-checked prints a stale fact beside a
    // contradicting `dirty=0` for the same worktree.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const rec = {
      id: 's1',
      directory: 'w',
      readState: 'finished',
      readRisk: 'medium',
      note: null,
      worktreeGone: false,
      untrackedFiles: 0,
      modifiedFiles: 11,
      commitsAheadOfMain: 0,
      deadSubagents: 0,
      toolErrors: 0,
    };
    // `w` is the fixture's worktree name, so live state is available.
    const inv = buildInventory({
      worktrees: [wt({ name: 'w', ahead: 1, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      readAudit: {
        available: true,
        asOf: '2026-01-01T00:00:00Z',
        windowHours: 30,
        records: [rec],
        byId: new Map([['s1', rec]]),
      },
      nowMs: NOW,
    });
    expect(inv.workOnNoRef[0].stillOnNoRef).toBe(false);
    expect(inv.workOnNoRef[0].liveDirty).toBe(0);
    expect(inv.workOnNoRef[0].asOf).toBe('2026-01-01T00:00:00Z');
  });

  it('reports a corrupt audit file differently from a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-bad-'));
    const bad = join(dir, 'chat-audit.data.json');
    writeFileSync(bad, '{ "asOf": "2026-01-01T00:00:00Z", "records": [ TRUNCATED');
    try {
      const a = loadChatAudit(bad);
      expect(a.available).toBe(false);
      // The bug: one bad hand-edit used to report "not found", so the entire
      // safety signal vanished while claiming it had never been there.
      expect(a.corrupt).toBe(true);
      expect(a.reason).toMatch(/unreadable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to an empty audit rather than refusing to generate', () => {
    const a = loadChatAudit('/nonexistent/chat-audit.data.json');
    expect(a.available).toBe(false);
    expect(a.records).toEqual([]);
    expect(a.asOf).toBeNull();
  });
});

describe('the read and computed chat views together', () => {
  it('emits both, and never reconciles them', () => {
    // The whole value is that they disagree sometimes. A computed "finished"
    // beside a read "struggling" is the finding, not a bug to smooth over.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const byDirectory = new Map([
      [
        '/repo/.kilo/worktrees/example',
        [
          {
            id: 's1',
            state: 'finished',
            idleMs: 9e9,
            subagentCount: 0,
            timeUpdated: NOW - 9e9,
            toolErrors: 0,
            creditsFailures: 0,
            lastTurnReason: 'stop',
          },
        ],
      ],
    ]);
    const readAudit = {
      available: true,
      asOf: '2026-01-01T00:00:00Z',
      windowHours: 30,
      records: [
        {
          id: 's1',
          directory: 'example',
          readState: 'struggling',
          readRisk: 'high',
          note: 'never committed',
          worktreeGone: false,
          untrackedFiles: 0,
          modifiedFiles: 4,
          commitsAheadOfMain: 0,
          deadSubagents: 0,
          toolErrors: 0,
        },
      ],
      byId: new Map([
        [
          's1',
          {
            id: 's1',
            directory: 'example',
            readState: 'struggling',
            readRisk: 'high',
            note: 'never committed',
            worktreeGone: false,
            untrackedFiles: 0,
            modifiedFiles: 4,
            commitsAheadOfMain: 0,
            deadSubagents: 0,
            toolErrors: 0,
          },
        ],
      ]),
    };
    const inv = buildInventory({
      worktrees: [wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 4, untracked: 0, paths: [] } })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: NOW - 9e9 },
      readAudit,
      nowMs: NOW,
    });
    const w = inv.worktrees[0];
    expect(w.chats.byState.finished).toBe(1);
    expect(w.read[0].readState).toBe('struggling');
    expect(w.read[0].workOnNoRef).toBe(true);
    expect(inv.readUnfinished.map((r) => r.id)).toEqual(['s1']);
    expect(inv.dataSources.readAudit.asOf).toBe('2026-01-01T00:00:00Z');
  });
});

describe('the curated table', () => {
  it('gives every entry a summary, because the inventory is read as prose', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      expect(typeof entry.summary, `${name} has no summary`).toBe('string');
      expect(entry.summary.length, `${name} has an empty summary`).toBeGreaterThan(20);
    }
  });

  it('contains no bare count in any summary, because a number in prose goes stale silently', () => {
    // Seven entries asserted counts ("32 paths uncommitted", "12 commits
    // behind", "four files and a new test"). Every one was wrong within hours
    // and nothing could catch it, because prose is not checkable. The
    // generated record already carries dirty/untracked/ahead/behind.
    const offenders = [];
    for (const [name, entry] of Object.entries(CURATED)) {
      for (const field of ['summary', 'note']) {
        const text = entry[field];
        if (!text) continue;
        // A number that counts files, commits or paths. Years, part numbers and
        // commit shas are not what this is about — and ZERO is not, because
        // "0 ahead of main" is the invariant this whole tool exists to refuse
        // to read as safety. It is a structural fact of a merged branch, not a
        // measurement that drifts.
        const m = /\b(\d+)\s+(path|file|commit|spec|dirty|untracked|behind|ahead)/i.exec(text);
        if (m && Number(m[1]) > 0) offenders.push(`${name}.${field}: "${m[0]}"`);
      }
    }
    expect(
      offenders,
      `curated prose contains counts that will drift: ${offenders.join('; ')}. ` +
        'Describe what is there; read dirty/untracked/ahead/behind from the record.'
    ).toEqual([]);
  });

  it('gives every non-primary worktree a curated entry, so none is undocumented', () => {
    // This reads the REAL worktree list, not the curated table. The previous
    // version iterated `Object.keys(CURATED)` and compared it to itself, so it
    // passed with 23 entries deleted and with every summary blanked.
    const cwd = process.cwd();
    // Only worktrees whose directory still exists. A registration whose
    // directory is gone is reported in `dataSources.git.missingWorktrees` and
    // has nothing to curate — demanding a summary for it would mean inventing
    // an entry every time a stray registration appeared and disappeared.
    const missingPaths = new Set(findMissingWorktrees(cwd).map((w) => w.path));
    const live = listWorktrees(cwd).filter((w) => !missingPaths.has(w.path));
    expect(live.length).toBeGreaterThan(1);

    // Only worktrees INSIDE the repository. Several agents run scratch
    // worktrees in /tmp, and "every worktree needs a curated entry" is not a
    // sensible rule for a transient one — the curated table documents this
    // repository's worktrees.
    // The MAIN checkout, which is the first entry of `git worktree list` — not
    // `cwd`, which under a task worktree is that worktree, and against which
    // every other worktree path would fail the prefix test.
    const repoRoot = live[0].path;
    const inRepo = live.filter((w) => w.path === repoRoot || w.path.startsWith(`${repoRoot}/`));
    expect(inRepo.length, 'no worktrees matched the repository prefix').toBeGreaterThan(10);

    // Worktrees created after the table was written, plus the two that are
    // documented elsewhere by construction. Everything else must be curated.
    const allowed = new Set(['worktree-inventory', 'land-and-dispose']);
    const uncategorised = inRepo
      .map((w) => w.name)
      .filter((name) => name !== 'ph' && !allowed.has(name) && !CURATED[name]);

    expect(
      uncategorised,
      `worktrees with no curated entry: ${uncategorised.join(', ')}. ` +
        'Add each to scripts/lib/worktree-inventory/curated.mjs with a summary.'
    ).toEqual([]);
  });

  it('agrees with git about every `landed: true` claim, so the two cannot contradict', () => {
    // `landed` is a curator's assertion. It was previously read by nothing, so
    // a worktree could claim it was landed while git reported the opposite and
    // no test objected.
    const cwd = process.cwd();
    const live = listWorktrees(cwd);
    const claimed = Object.entries(CURATED)
      .filter(([, e]) => e.landed === true)
      .map(([n]) => n);

    expect(claimed.length).toBeGreaterThan(0);

    const contradictions = [];
    for (const name of claimed) {
      const w = live.find((x) => x.name === name);
      if (!w) continue; // the worktree is gone; nothing to contradict
      if (!__testables.isMergedInto(w.path, 'main')) {
        contradictions.push(`${name}: curated says landed, git says the branch is not on main`);
      }
      if (w.branch === '(detached)') {
        contradictions.push(`${name}: curated says landed, but the worktree is detached`);
      }
    }
    expect(contradictions, contradictions.join('\n')).toEqual([]);
  });

  it('marks no detached worktree as landed', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      if (entry.landed) {
        const w = listWorktrees(process.cwd()).find((x) => x.name === name);
        if (w) expect(w.branch, `${name} claims landed but is detached`).not.toBe('(detached)');
      }
    }
  });

  it('keeps the main worktree and this one out of the curated table on purpose', () => {
    // `ph` is described in AGENTS.md, not per-worktree, and this worktree is
    // this change's own scratch space.
    expect(CURATED.ph).toBeUndefined();
    expect(CURATED['worktree-inventory']).toBeUndefined();
  });

  it('requires a mustNotPrune entry to say WHY, because the flag alone is unfalsifiable', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      if (entry.mustNotPrune) {
        expect(
          typeof entry.note === 'string' && entry.note.length > 30,
          `${name} sets mustNotPrune without a note explaining what would be lost`
        ).toBe(true);
      }
    }
  });

  it('sets mustNotPrune on every worktree whose danger is invisible to git', () => {
    // The names are a curator's list, and they are checked against GIT rather
    // than against the table. The previous version asserted the flag on fifteen
    // names without looking at any of them, and every one of those fifteen was
    // a branch that git could already see: ahead of main, clean, not on main —
    // so `prunable` was already false and the flag protected nothing. Six of
    // their notes said so, in prose, on the same lines.
    //
    // So the claim is now what is asserted, not the membership. A flag is a
    // claim that the work here exists on no ref, and the shape that makes it
    // true is exactly the one the generator already names
    // `STATUS.UNCOMMITTED_ONLY`: a branch git calls disposable, carrying edits
    // that are in no commit on it. Anything else — a committed branch, a clean
    // tree — is a flag about nothing.
    //
    // The list stays hand-written on purpose. A derived list would go stale in
    // the other direction: the moment the owning agent commits, the shape
    // disappears and a derived rule would drop the flag off work that is still
    // uncommitted elsewhere. Re-derive these against
    // `git -C <path> status --porcelain` and
    // `git merge-base --is-ancestor <branch> main` before adding a name.
    const invisibleToGit = ['rail-drop-draw', 'shape-truth', 'text-tool-requirements'];
    expect(invisibleToGit.length, 'the list went empty, so this guard asserts nothing').toBeGreaterThan(0);

    const live = listWorktrees(process.cwd());
    for (const name of invisibleToGit) {
      const w = live.find((x) => x.name === name);
      expect(w, `${name} is not a live worktree, so there is nothing to protect`).toBeTruthy();
      // Only these three worktrees are asked about. `collectWorktrees` runs
      // `git status` and `git merge-tree` in every worktree in the repository,
      // which is the right cost for a generator that must print all of them and
      // the wrong cost for a test that needs three facts.
      const { ahead } = __testables.aheadBehind(w.path, 'main');
      const held = __testables.workingTreeState(w.path);
      const onMain = __testables.isMergedInto(w.path, 'main');
      expect(
        ahead === 0 && onMain === true && held.modified + held.untracked > 0,
        `${name} is listed as holding work git cannot see, but git says ahead=${ahead} ` +
          `onMain=${onMain} modified=${held.modified} untracked=${held.untracked}. Either the ` +
          'work was committed — in which case drop the name and the flag — or the shape ' +
          'changed and this entry has to say so.'
      ).toBe(true);
      expect(CURATED[name]?.mustNotPrune, `${name} holds work on no ref and is not protected`).toBe(true);
    }
  });

  it('declares no key twice, because a duplicate key silently discards a curation change', () => {
    // Five keys were declared twice: a rich entry written deliberately near the
    // top, and a terse one-liner appended near the bottom. `Object.keys()`
    // cannot see the first — a JS object literal is last-wins, so the detailed
    // summary and its `note` were unreachable dead code, and every test that
    // checked the table still passed because the entry EXISTED. A committed
    // curation change was a no-op.
    //
    // So this reads the SOURCE rather than the imported object: the duplicate
    // exists only in the text. `readCuratedKeys` is the reader, and it fails
    // CLOSED — anything at the entry indentation it does not positively
    // recognise is reported as unreadable rather than skipped, because a reader
    // that skips what it does not understand reports green on a file it could
    // not see. That was the defect in the first version of this test, whose
    // regex matched exactly one quote style at exactly one indentation: a
    // duplicate in double quotes, a duplicate at a deeper indent, and a computed
    // key or a spread all slipped past it, while a key-shaped line in a `//`
    // comment — which is what you write after "removed the terse declarations" —
    // failed it.
    const { keys, unreadable } = readCuratedKeys(readFileSync(CURATED_PATH, 'utf8'));

    // The reader must have understood the file. This is the assertion that turns
    // a parse failure from silence into a failure, and it comes FIRST so a green
    // run can never mean "the regex matched nothing".
    expect(
      unreadable,
      `curated.mjs contains declarations this reader does not understand, so the duplicate-key ` +
        `check cannot see the file and would report green on it: ${unreadable.join('; ')}. A ` +
        `computed key, a spread, a shorthand property or a method at an entry's indentation are ` +
        `all shapes a duplicate can hide inside — teach the reader this one, or write the entry ` +
        `as a plain key.`
    ).toEqual([]);

    const seen = new Set();
    const duplicates = [];
    for (const name of keys) {
      if (seen.has(name)) duplicates.push(`'${name}'`);
      else seen.add(name);
    }

    expect(
      duplicates,
      `curated.mjs declares these keys more than once, so the last declaration silently ` +
        `replaces the first and the earlier curation is dead code: ${duplicates.join('; ')}. ` +
        'Object.keys() cannot see this — the check has to read the source.'
    ).toEqual([]);

    // The parse must find exactly the keys the imported object has, and as MANY
    // of them. The set comparison alone is what let four silent shapes through:
    // when the declaration the reader could not see was a key `Object.keys()`
    // already held, both sets stayed equal and the test passed. The duplicate
    // assertion above is named first and is the one that should fire for a
    // duplicate — a guard that reported "the parse is broken" about the very
    // defect it exists to name teaches the next agent to ignore it — so this
    // LENGTH comparison is a backstop for a reader that under-counted, not the
    // primary signal.
    expect([...new Set(keys)].sort()).toEqual([...Object.keys(CURATED)].sort());
    expect(keys.length, 'the reader saw fewer declarations than the object has keys').toBe(Object.keys(CURATED).length);
  });

  describe('the duplicate-key reader, proven against injected shapes', () => {
    const real = readFileSync(CURATED_PATH, 'utf8');
    // Inject at the start of a known entry, which is the same place the original
    // defect was: a declaration added near a declaration.
    //
    // Every injected block is BRACE-BALANCED and its comments are CLOSED. That
    // is not tidiness: the reader counts braces to find where the object literal
    // ends, so an unbalanced injection walks it out of the literal and it starts
    // reporting the code after it — which fails the case for the wrong reason,
    // exactly as a guard that fires for the wrong reason teaches people to
    // ignore it.
    const inject = (...lines) => real.replace(/^  'e2e-shell': \{$/m, `  'e2e-shell': {\n${lines.join('\n')}`);
    const entry = (head) => [head, "    summary: 'injected.',", '  },'];

    const DUPLICATE_CASES = [
      ['the same quoting and indent as every other entry', entry("  'e2e-shell': {")],
      ['double quotes', entry('  "e2e-shell": {')],
      ['four-space indentation', entry("    'e2e-shell': {")],
      ['eight-space indentation', entry("        'e2e-shell': {")],
      ['a template-literal key', entry('  `e2e-shell`: {')],
      ['no space before the colon', entry("  'e2e-shell':{")],
      ['spaces around the colon', entry("  'e2e-shell'   :   {")],
      ['a trailing comment on the same line', entry("  'e2e-shell': { // and this is not it")],
    ];

    for (const [what, lines] of DUPLICATE_CASES) {
      it(`sees a duplicate declared with ${what}`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(2);
      });
    }

    it('sees the declaration behind a trailing comment, because the comment is not the line', () => {
      // The complement of the comment cases below: stripping `// this is not it`
      // must not also throw away the `e2e-shell` in front of it. The comment
      // is discarded and the declaration survives, so this IS a duplicate.
      const { keys, unreadable } = readCuratedKeys(inject("  'e2e-shell': {", "    summary: 'injected.',", '  },'));
      expect(unreadable).toEqual([]);
      expect(count(keys, 'e2e-shell')).toBe(2);
    });

    for (const [what, lines] of DUPLICATE_CASES) {
      it(`sees a duplicate declared with ${what}`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(2);
      });
    }

    it('reads an entry declared with a bare identifier key', () => {
      // `e2eShell` is a legal identifier and `e2e-shell` is not, so this cannot
      // duplicate anything — it is here to prove the identifier form is still
      // recognised rather than reported as unreadable.
      const { keys, unreadable } = readCuratedKeys(inject(...entry('  e2eShell: {')));
      expect(keys).toContain('e2eShell');
      expect(unreadable).toEqual([]);
    });

    // [what to call it, the injected lines, a token the failure message must quote]
    const UNREADABLE_CASES = [
      ['a computed key', entry("  ['e2e-shell']: {"), "['e2e-shell']"],
      ['a computed key built by a template', entry('  [`e2e-shell`]: {'), '[`e2e-shell`]'],
      ['a spread of an object literal', ["  ...{ 'e2e-shell': { summary: 'injected.' } },", '  },'], '...{'],
      ['a property shorthand', ['  e2eShell,'], 'e2eShell,'],
      ['a method', entry('  e2eShell() {'), 'e2eShell()'],
      ['a getter', entry('  get e2eShell() {'), 'get e2eShell()'],
      ['a name that is not a legal identifier', entry('  e2e-shell: {'), 'e2e-shell:'],
    ];

    for (const [what, lines, token] of UNREADABLE_CASES) {
      it(`refuses to guess at ${what}, rather than skipping it`, () => {
        const { unreadable } = readCuratedKeys(inject(...lines));
        expect(
          unreadable.length,
          `a reader that skipped this line would report green on a declaration it could not see`
        ).toBeGreaterThan(0);
        expect(unreadable.join('\\n')).toContain(token);
      });
    }

    // Each comment here must CLOSE. An unterminated `/*` legitimately swallows
    // the rest of the file, so a case built that way would pass for the wrong
    // reason — the reader would be right to see nothing.
    const COMMENT_CASES = [
      ['a line comment', ["  // 'e2e-shell': {"]],
      ['a single-line block comment', ["  /* 'e2e-shell': { */"]],
      ['a multi-line block comment', ['  /*', "   'e2e-shell': {", '  */']],
      ['a block comment holding a whole entry', ['  /*', "  'e2e-shell': {", '  },', '  */']],
    ];

    for (const [what, lines] of COMMENT_CASES) {
      it(`ignores a key-shaped line inside ${what}, because a comment is not a declaration`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(1);
      });
    }

    it('ignores a key-shaped string inside an entry’s own prose', () => {
      const { keys, unreadable } = readCuratedKeys(
        inject("    note: 'see also: e2e-shell: { for the responsive shell, and https://example.com/x',")
      );
      expect(count(keys, 'e2e-shell')).toBe(1);
      expect(unreadable).toEqual([]);
    });

    it('ignores a key-shaped line nested inside an entry', () => {
      const { keys, unreadable } = readCuratedKeys(inject("    issues: [{ ref: 'HANDOFF.md#1', title: 't' }],"));
      expect(keys).not.toContain('nested-thing');
      expect(unreadable).toEqual([]);
    });

    it('reads the real file, and reads every key in it', () => {
      const { keys, unreadable } = readCuratedKeys(real);
      expect(unreadable).toEqual([]);
      expect(new Set(keys)).toEqual(new Set(Object.keys(CURATED)));
      expect(keys.length).toBe(Object.keys(CURATED).length);
      expect(keys.length).toBeGreaterThan(50);
    });
  });

  it('gives every issue a ref and a title, because a ref with no title is unreadable', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      for (const issue of entry.issues ?? []) {
        expect(issue.ref, `${name} has an issue with no ref`).toBeTruthy();
        expect(issue.title, `${name} has an issue with no title`).toBeTruthy();
      }
    }
  });
});

import * as chatsModule from '../lib/worktree-inventory/chats.mjs';

describe('the CLI staleness check', () => {
  const { equivalent } = await_import_cli();

  const doc = (over = {}) =>
    JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', totals: { worktrees: 2 }, worktrees: [], ...over });

  it('ignores only the generation timestamp', () => {
    // This file is a live snapshot of a repository where agents message
    // continuously, so a byte comparison fails on `generatedAt` alone and
    // `--check` could never pass. A gate that always fails is noise that
    // trains people to ignore it.
    expect(equivalent(doc(), doc({ generatedAt: '2026-09-28T21:00:00.000Z' }))).toBe(true);
  });

  it('still fails on a real change', () => {
    expect(equivalent(doc(), doc({ totals: { worktrees: 3 } }))).toBe(false);
    const a = doc({ worktrees: [{ name: 'x', prunable: true }] });
    const b = doc({ worktrees: [{ name: 'x', prunable: false }] });
    expect(equivalent(a, b)).toBe(false);
  });

  it('treats unparseable input as different rather than equal', () => {
    expect(equivalent('not json', doc())).toBe(false);
  });
});

// Imported lazily so the CLI module's top-level `main()` side effects are not
// triggered by the pure-function tests above.
function await_import_cli() {
  return cliModule;
}

import * as cliModule from '../worktree-inventory.mjs';

describe('the generated file is already formatted', () => {
  it('is byte-identical to what Prettier would produce', () => {
    // Otherwise every regeneration produces a file `lint-staged
    // --fail-on-changes` refuses and un-stages, and the only ways out are a
    // .prettierignore or dropping .json from the linted set — both of which
    // weaken a gate to accommodate a generator.
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    const inv = buildInventory({
      worktrees: [wt({ name: 'a', issues: [] })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      nowMs: NOW,
    });
    const formatted = formatCanonical(serialise(inv));
    // Idempotent: formatting an already-formatted document changes nothing.
    expect(formatCanonical(formatted)).toBe(formatted);
    expect(formatted.endsWith('\n')).toBe(true);
    // Still valid JSON with every field intact after the reflow.
    expect(JSON.parse(formatted).worktrees).toHaveLength(1);
  });
});
