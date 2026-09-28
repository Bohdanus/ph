/**
 * The board's tests, at the layer where its guarantees live: two processes
 * racing for one claim, a lease that runs out under a live task, a file that two
 * agents both believe is theirs, and a fixer trying to verify their own fix.
 *
 * Each test gets its own directory, so nothing here depends on the operator's
 * real board, and a test that leaks a lock cannot reach the next one.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board, BoardError, parseDuration } from '../lib/agent-board/db.mjs';
import { resolveIdentity } from '../lib/agent-board/identity.mjs';
import { run } from '../agent-board.mjs';

let dir;
const agents = {};
let clock = Date.parse('2026-09-28T12:00:00.000Z');

const identityFor = (agentId) =>
  (agents[agentId] ??= {
    agentId,
    kind: 'kilo',
    worktree: join(dir, `wt-${agentId}`),
    branch: `feat/${agentId}`,
    sessionId: `run-${agentId}`,
    pid: 1000,
    meta: {},
  });

/** A clock the test moves by hand, so lease expiry is tested, not waited for. */
const boardFor = (agentId) =>
  new Board({
    dir,
    identity: identityFor(agentId),
    now: () => clock,
  }).open();

/**
 * A board on the real clock, for the tests that are about two processes seeing
 * one database rather than about lease arithmetic. A lease written by one board
 * on an injected clock and read by another on the real one expires at a moment
 * neither party chose, which is a test artefact and not a defect.
 */
const liveBoardFor = (agentId) => new Board({ dir, identity: identityFor(agentId) }).open();

const advance = (ms) => {
  clock += ms;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-board-test-'));
  clock = Date.parse('2026-09-28T12:00:00.000Z');
  for (const key of Object.keys(agents)) delete agents[key];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the board is testable where it is going to run', () => {
  /**
   * A load-bearing assumption, not a curiosity: the board's only dependency is
   * `node:sqlite`, and this suite runs under the root Vitest project, whose
   * pool is `vmThreads`. If a pool or environment change ever took the built-in
   * sqlite binding out of that context, every test in this file would fail to
   * import for a reason that has nothing to do with the board.
   */
  it('has node:sqlite available in the root vitest project', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE probe (a TEXT)');
    db.prepare('INSERT INTO probe VALUES (?)').run('ok');
    expect(db.prepare('SELECT a FROM probe').get()).toEqual({ a: 'ok' });
    db.close();
  });
});

describe('schema', () => {
  it('creates itself on first open and is idempotent', () => {
    const board = boardFor('a');
    const version = board.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    expect(Number(version.value)).toBe(1);
    board.close();
    board.open();
    expect(board.db.prepare('SELECT COUNT(*) AS n FROM issues').get().n).toBe(0);
  });

  it('refuses to write over a newer schema instead of corrupting it', () => {
    const board = boardFor('a');
    board.db.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run();
    board.close();
    expect(() => new Board({ dir, identity: identityFor('a') }).open()).toThrow(/schema is v99/);
  });

  it('refuses to open a board that does not exist when told not to create one', () => {
    const missing = join(dir, 'nope');
    expect(() => new Board({ dir: missing }).open({ create: false })).toThrow(/no board at/);
  });
});

describe('issues', () => {
  it('assigns sequential ids and returns them ordered by priority', () => {
    const board = boardFor('a');
    const low = board.createIssue({ title: 'low', priority: 'low' });
    const critical = board.createIssue({ title: 'critical', priority: 'critical' });
    const high = board.createIssue({ title: 'high', priority: 'high' });
    expect([low.id, critical.id, high.id]).toEqual(['ph-1', 'ph-2', 'ph-3']);
    expect(board.listIssues().map((issue) => issue.id)).toEqual(['ph-2', 'ph-3', 'ph-1']);
  });

  it('keeps counting past ph-9, where a string maximum would start colliding', () => {
    const board = boardFor('a');
    // 'ph-9' sorts above 'ph-10' as TEXT, so an allocator built on MAX(id) hands
    // out ph-3 here and the insert fails on the primary key. An import of one
    // real handoff document creates fifty issues, so this is not a corner case.
    const ids = Array.from({ length: 14 }, (_, index) => board.createIssue({ title: `issue ${index}` }).id);
    expect(ids).toEqual(Array.from({ length: 14 }, (_, index) => `ph-${index + 1}`));
    expect(new Set(ids).size).toBe(14);
  });

  it('is idempotent on origin, so an import can be run twice', () => {
    const board = boardFor('a');
    const first = board.createIssue({ title: 'x', origin: 'HANDOFF.md#12' });
    const second = board.createIssue({ title: 'x again', origin: 'HANDOFF.md#12' });
    expect(second).toEqual({ id: first.id, created: false });
    expect(board.listIssues()).toHaveLength(1);
  });

  it('rejects an unknown priority or scope rather than storing them', () => {
    const board = boardFor('a');
    expect(() => board.createIssue({ title: 'x', priority: 'urgent' })).toThrow(/unknown priority/);
    expect(() => board.createIssue({ title: 'x', scope: 'ui' })).toThrow(/unknown scope/);
    expect(() => board.createIssue({ title: '  ' })).toThrow(/needs a title/);
  });

  it('records the files an item names as context, without taking the lock', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({
      title: 'handoff item',
      files: ['src/util/history-adapter.ts'],
      holdFiles: false,
    });
    expect(board.locksHeldBy('a')).toHaveLength(0);
    const events = board.events({ issue: id });
    expect(events.map((event) => event.kind)).toEqual(['issue.create', 'lock.hold']);
    expect(events[1].data).toContain('"held":false');
  });

  it('filings an issue about a held file reports the holder instead of taking it', () => {
    const holder = boardFor('a');
    holder.holdFiles(['src/x.ts']);
    holder.close();
    const other = boardFor('b');
    const result = other.createIssue({ title: 'about src/x.ts', files: ['src/x.ts'] });
    expect(result.conflicts.map((conflict) => conflict.holder.agent_id)).toEqual(['a']);
    expect(other.locksHeldBy('b')).toHaveLength(0);
    other.close();
  });
});

describe('claims are exclusive and leased', () => {
  it('gives one agent the claim and refuses the other with the holder named', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'single writer' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();

    const b = boardFor('b');
    expect(() => b.claimIssue(id)).toThrow(/claimed by a/);
    try {
      b.claimIssue(id);
    } catch (error) {
      expect(error).toBeInstanceOf(BoardError);
      expect(error.code).toBe(3);
      expect(error.detail.holder.agent_id).toBe('a');
    }
    expect(b.getIssue(id).status).toBe('claimed');
    b.close();
  });

  it('renews for the holder instead of reporting a conflict', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'long job' });
    a.claimIssue(id, { leaseMs: 60_000 });
    advance(30_000);
    const renewed = a.claimIssue(id, { leaseMs: 60_000 });
    expect(renewed.renewed).toBe(true);
    expect(Date.parse(renewed.lease_until)).toBe(clock + 60_000);
  });

  it('returns an abandoned claim to the swarm when the lease runs out', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'agent died mid-task' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();

    advance(60_001);
    const b = boardFor('b');
    expect(b.liveClaimOrNull(id)).toBeNull();
    expect(b.readyIssues().map((issue) => issue.id)).toEqual([id]);
    b.claimIssue(id, { leaseMs: 60_000 });
    expect(b.liveClaimOrNull(id).agent_id).toBe('b');
    expect(b.events({ issue: id }).map((event) => event.kind)).toContain('claim.acquire');
    b.close();
  });

  it('records the takeover in the log, with both agents named', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'stolen' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();
    advance(60_001);
    const b = boardFor('b');
    b.claimIssue(id, { leaseMs: 60_000 });
    const steal = b.events({ issue: id }).find((event) => event.kind === 'claim.steal');
    expect(steal.message).toBe('took over from a (lease expired 2026-09-28T12:01:00.000Z)');
    expect(JSON.parse(steal.data)).toMatchObject({ previous_agent: 'a', forced: false });
    b.close();
  });

  it('refuses a closed issue, and names the states that can be claimed', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'done' });
    board.claimIssue(id, { leaseMs: 60_000 });
    board.resolveIssue(id);
    board.closeIssue(id, { verifiedBy: 'reviewer' });
    expect(() => board.claimIssue(id)).toThrow(/ph-\d+ is closed, not claimable/);
  });

  it('releases the claim and the locks it held together', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'releases' });
    board.claimIssue(id, { leaseMs: 60_000 });
    board.holdFiles(['src/y.ts'], { issueId: id });
    expect(board.locksHeldBy('a')).toHaveLength(1);
    board.releaseClaim(id);
    expect(board.getIssue(id).status).toBe('open');
    expect(board.locksHeldBy('a')).toHaveLength(0);
  });

  it("will not let one agent release another agent's claim", () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'not yours' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();
    const b = boardFor('b');
    expect(() => b.releaseClaim(id)).toThrow(/claimed by a/);
    expect(() => b.releaseClaim(id, { force: true })).not.toThrow();
    b.close();
  });
});

describe('file locks make one-file-one-agent real', () => {
  it('refuses a path another live agent holds, naming the holder', () => {
    const a = boardFor('a');
    a.holdFiles(['src/contexts/StoreContext.tsx']);
    a.close();
    const b = boardFor('b');
    try {
      b.holdFiles(['src/contexts/StoreContext.tsx']);
      throw new Error('should not have been granted');
    } catch (error) {
      expect(error.code).toBe(4);
      expect(error.message).toMatch(/src\/contexts\/StoreContext.tsx \(a\)/);
    }
    b.close();
  });

  it('refuses a whole batch atomically, so a failed claim holds nothing', () => {
    const a = boardFor('a');
    a.holdFiles(['src/held.ts']);
    a.close();
    const b = boardFor('b');
    expect(() => b.holdFiles(['src/free.ts', 'src/held.ts'])).toThrow(/held by another agent/);
    expect(b.locksHeldBy('b')).toHaveLength(0);
    b.close();
  });

  it('lets the same agent re-take its own lock, extending the lease', () => {
    const board = boardFor('a');
    board.holdFiles(['src/self.ts'], { leaseMs: 60_000 });
    advance(30_000);
    board.holdFiles(['src/self.ts'], { leaseMs: 60_000 });
    const lock = board.locksHeldBy('a')[0];
    expect(lock.path).toBe('src/self.ts');
    expect(Date.parse(lock.expires_at)).toBe(clock + 60_000);
  });

  it('frees a path when its lease expires, without anybody releasing it', () => {
    const a = boardFor('a');
    a.holdFiles(['src/expiring.ts'], { leaseMs: 60_000 });
    a.close();
    advance(60_001);
    const b = boardFor('b');
    expect(b.checkPath('src/expiring.ts').free).toBe(true);
    expect(() => b.holdFiles(['src/expiring.ts'])).not.toThrow();
    b.close();
  });

  it('reports a path you hold yourself as free, because it is your lock', () => {
    const board = boardFor('a');
    board.holdFiles(['src/mine.ts']);
    expect(board.checkPath('src/mine.ts').free).toBe(true);
  });

  it('normalizes paths so the same file from two worktrees is one lock', () => {
    const board = boardFor('a');
    board.holdFiles(['./src/util/draw.ts', 'src/util/draw.ts']);
    expect(board.locksHeldBy('a').map((lock) => lock.path)).toEqual(['src/util/draw.ts']);
  });
});

describe('the resolution lifecycle separates a fix from its verification', () => {
  it('needs a claim before a resolve, and names the claim holder if it is not yours', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'needs a claim' });
    const b = boardFor('b');
    expect(() => b.resolveIssue(id)).toThrow(/not claimed/);
    a.claimIssue(id, { leaseMs: 60_000 });
    expect(() => b.resolveIssue(id)).toThrow(/claimed by a/);
    a.resolveIssue(id);
    expect(a.getIssue(id).status).toBe('resolved');
    a.close();
    b.close();
  });

  it('refuses to let the agent that resolved an issue also close it', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'self-verified' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.resolveIssue(id);
    try {
      a.closeIssue(id, { verifiedBy: 'a' });
      throw new Error('should not have closed');
    } catch (error) {
      expect(error.code).toBe(5);
      expect(error.message).toMatch(/verification is somebody else's/);
    }
    expect(a.getIssue(id).status).toBe('resolved');
  });

  it('closes when a different agent verifies, and records who', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'verified by a review' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.resolveIssue(id);
    const b = boardFor('b');
    const result = b.closeIssue(id, { verifiedBy: 'reviewer' });
    expect(result.status).toBe('closed');
    expect(b.getIssue(id).verified_by).toBe('reviewer');
    expect(b.events({ issue: id }).at(-1).kind).toBe('issue.close');
    a.close();
    b.close();
  });

  it('reopens a closed issue back to open, dropping its claim', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'regression' });
    board.claimIssue(id, { leaseMs: 60_000 });
    board.resolveIssue(id);
    board.closeIssue(id, { verifiedBy: 'reviewer' });
    board.reopenIssue(id, { reason: 'it came back' });
    const issue = board.getIssue(id);
    expect(issue.status).toBe('open');
    expect(issue.resolver).toBeNull();
    expect(board.liveClaimOrNull(id)).toBeNull();
  });

  it('requires a reason to defer, so a parked issue says why', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'blocked on a decision' });
    expect(() => board.deferIssue(id)).toThrow(/needs a reason/);
    board.deferIssue(id, { reason: 'waiting on the operator', until: '2026-10-01' });
    expect(board.getIssue(id).status).toBe('deferred');
    expect(board.getIssue(id).defer_reason).toBe('waiting on the operator');
  });
});

describe('dependencies decide what is ready', () => {
  it('hides an issue behind an unclosed dependency and offers it after', () => {
    const board = boardFor('a');
    const first = board.createIssue({ title: 'first' });
    const second = board.createIssue({ title: 'second', deps: [first.id] });
    expect(board.readyIssues().map((issue) => issue.id)).toEqual([first.id]);
    expect(board.blockedIssues().map((issue) => issue.id)).toEqual([second.id]);

    board.claimIssue(first.id, { leaseMs: 60_000 });
    board.resolveIssue(first.id);
    expect(board.readyIssues().map((issue) => issue.id)).toEqual([second.id]);
  });

  it('refuses a dependency on itself and on an issue that does not exist', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'self-referential' });
    expect(() => board.addDep(id, id)).toThrow(/cannot depend on itself/);
    expect(() => board.addDep(id, 'ph-999')).toThrow(/no such issue/);
  });
});

describe('doctor reclaims what dead agents left', () => {
  it('releases a claim held from a worktree that no longer exists', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'worktree deleted mid-task' });
    a.claimIssue(id, { leaseMs: 86_400_000 });
    a.holdFiles(['src/orphan.ts'], { issueId: id, leaseMs: 86_400_000 });
    a.close();
    // The lease is nowhere near expiry; the worktree is simply gone.
    rmSync(join(dir, 'wt-a'), { recursive: true, force: true });

    const b = boardFor('b');
    const findings = b.doctor();
    // One finding, not two: the claim and the file lock it took are the same
    // abandonment, and releasing the claim releases its locks.
    expect(findings.map((finding) => finding.kind)).toEqual(['dead-worktree']);
    expect(b.getIssue(id).status).toBe('open');
    expect(b.locksHeldBy('a')).toHaveLength(0);
    b.close();
  });

  it('reports without changing anything on a dry run', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'expired' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();
    advance(60_001);
    const b = boardFor('b');
    const findings = b.doctor({ dryRun: true });
    expect(findings).toHaveLength(1);
    expect(b.getIssue(id).status).toBe('claimed');
    b.doctor();
    expect(b.getIssue(id).status).toBe('open');
    b.close();
  });

  it('leaves a live claim from a live worktree alone', () => {
    const a = boardFor('a');
    mkdirSync(join(dir, 'wt-a'), { recursive: true });
    const { id } = a.createIssue({ title: 'in progress' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.close();
    const b = boardFor('b');
    expect(b.doctor()).toHaveLength(0);
    expect(b.getIssue(id).status).toBe('claimed');
    b.close();
  });
});

describe('the event log is the swarm talking', () => {
  it('orders every mutation under one increasing sequence', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'lifecycle' });
    board.claimIssue(id, { leaseMs: 60_000 });
    board.comment(id, 'the tricky part is the after state');
    board.holdFiles(['src/lifecycle.ts'], { issueId: id });
    board.resolveIssue(id, { note: 'fixed in the adapter' });
    board.closeIssue(id, { verifiedBy: 'reviewer' });
    const events = board.events({ issue: id });
    expect(events.map((event) => event.kind)).toEqual([
      'issue.create',
      'claim.acquire',
      'issue.comment',
      'lock.hold',
      'issue.resolve',
      'issue.close',
    ]);
    expect(events.map((event) => event.seq)).toEqual([...events.map((event) => event.seq)].sort((a, b) => a - b));
  });

  it('pages from a sequence number, so a watcher does not re-read the log', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'paged' });
    board.comment(id, 'one');
    const checkpoint = board.lastSeq();
    board.comment(id, 'two');
    expect(board.events({ since: checkpoint }).map((event) => event.message)).toEqual(['two']);
    expect(board.events({ issue: id, since: 0 })).toHaveLength(3);
  });

  it('carries an issue-less note, which is how one agent addresses the swarm', () => {
    const board = boardFor('a');
    board.note('I am touching StoreContext for the next hour');
    const [event] = board.events({ since: 0, kind: 'note' });
    expect(event.issue_id).toBeNull();
    expect(event.message).toBe('I am touching StoreContext for the next hour');
  });
});

describe('one board is shared by every worktree', () => {
  it("lets a second process see the first one's claims and locks", () => {
    const a = liveBoardFor('a');
    const { id } = a.createIssue({ title: 'shared' });
    a.claimIssue(id, { leaseMs: 600_000 });
    a.holdFiles(['src/shared.ts'], { issueId: id });
    a.close();

    // A separate connection, which is what a second worktree's process is.
    const b = new Board({ dir, identity: identityFor('b') }).open();
    expect(b.getIssue(id).status).toBe('claimed');
    expect(b.liveClaimOrNull(id).agent_id).toBe('a');
    expect(b.checkPath('src/shared.ts').holders[0].agent_id).toBe('a');
    b.close();
  });
});

describe('durations', () => {
  it('reads every unit an agent is likely to type', () => {
    expect(parseDuration('45m')).toBe(2_700_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('30')).toBe(1_800_000);
    expect(parseDuration(undefined, 1234)).toBe(1234);
    expect(() => parseDuration('soon')).toThrow(/not a duration/);
  });
});

describe('identity defaults to the branch, which is the unit of work', () => {
  it('uses the current git branch and records the worktree', () => {
    const identity = resolveIdentity({ cwd: process.cwd(), env: {} });
    expect(identity.agentId).toMatch(/[\w./@-]+/);
    expect(identity.worktree ?? '').toContain('/');
  });

  it('prefers an explicit agent, then the environment', () => {
    expect(resolveIdentity({ agent: 'reviewer', cwd: dir, env: {} }).agentId).toBe('reviewer');
    expect(resolveIdentity({ cwd: dir, env: { AGENT_BOARD_AGENT: 'from-env' } }).agentId).toBe('from-env');
  });

  it('falls back to the session id when there is no repository at all', () => {
    const identity = resolveIdentity({ cwd: dir, env: { KILO_RUN_ID: '720a1945-a960-4ddc-ab57-5a5bc1b92960' } });
    expect(identity.agentId).toBe('session-720a1945');
    expect(identity.sessionId).toBe('720a1945-a960-4ddc-ab57-5a5bc1b92960');
  });
});

describe('the command line', () => {
  /** Runs the real CLI surface, capturing its output and its exit code. */
  const cli = async (args, agent = 'a', cwd = dir) => {
    const out = [];
    const err = [];
    const code = await run([...args, '--dir', dir, '--agent', agent], {
      cwd,
      out: { write: (chunk) => out.push(chunk) },
      err: { write: (chunk) => err.push(chunk) },
    });
    return { code, out: out.join(''), err: err.join('') };
  };

  it('documents itself, because that is the first command a fresh agent runs', async () => {
    const { code, out } = await cli(['help']);
    expect(code).toBe(0);
    for (const command of ['ready', 'claim', 'hold', 'status', 'watch', 'doctor', 'import']) {
      expect(out).toContain(command);
    }
    expect(out).toContain('exit codes');
  });

  it('files, claims, comments and shows an issue end to end', async () => {
    const filed = await cli(['new', 'StoreContext drops hasUnsavedChanges', '--scope', 'history', '--json']);
    expect(filed.code).toBe(0);
    const { id } = JSON.parse(filed.out);
    expect(id).toBe('ph-1');

    const claimed = await cli(['claim', id, '--files', 'src/contexts/StoreContext.tsx']);
    expect(claimed.out).toContain('claimed by a');
    expect(claimed.out).toContain('src/contexts/StoreContext.tsx');

    const shown = await cli(['show', id]);
    expect(shown.out).toContain('claimed by a');
    expect(shown.out).toContain('hasUnsavedChanges');
  });

  it('exits 3 when the issue is already claimed, and 4 when the file is held', async () => {
    const filed = JSON.parse((await cli(['new', 'contended', '--json'])).out);
    await cli(['claim', filed.id]);
    const refused = await cli(['claim', filed.id], 'b');
    expect(refused.code).toBe(3);
    expect(refused.err).toMatch(/claimed by a/);

    const locked = await cli(['hold', 'src/util/draw.ts', '--agent', 'a']);
    expect(locked.code).toBe(0);
    const other = await cli(['hold', 'src/util/draw.ts'], 'b');
    expect(other.code).toBe(4);
    expect(other.err).toMatch(/held by another agent/);
  });

  it('exits 1 from `check` when a file is taken, so a shell can gate on it', async () => {
    await cli(['hold', 'src/taken.ts']);
    // Asked as a different agent: your own lock is not a conflict with yourself.
    expect((await cli(['check', 'src/taken.ts'], 'b')).code).toBe(1);
    expect((await cli(['check', 'src/taken.ts'])).code).toBe(0);
    expect((await cli(['check', 'src/free.ts'], 'b')).code).toBe(0);
  });

  it('exits 5 when the fixer tries to verify their own fix', async () => {
    const filed = JSON.parse((await cli(['new', 'self-verified fix', '--json'])).out);
    await cli(['claim', filed.id]);
    await cli(['resolve', filed.id]);
    const selfClose = await cli(['close', filed.id]);
    expect(selfClose.code).toBe(5);
    const reviewed = await cli(['close', filed.id, '--verified-by', 'reviewer'], 'b');
    expect(reviewed.code).toBe(0);
  });

  it('does not leave a claim standing when the file lock it needed is refused', async () => {
    const filed = JSON.parse((await cli(['new', 'needs a free file', '--json'])).out);
    await cli(['hold', 'src/taken.ts']);
    const refused = await cli(['claim', filed.id, '--files', 'src/taken.ts'], 'b');
    expect(refused.code).toBe(4);
    expect((await cli(['show', filed.id])).out).toContain('not claimed');
    expect((await cli(['show', filed.id, '--json'])).code).toBe(0);
  });

  it('lists what is ready, and nothing that is claimed or blocked', async () => {
    const open = JSON.parse((await cli(['new', 'open work', '--json'])).out);
    const taken = JSON.parse((await cli(['new', 'taken work', '--json'])).out);
    const blocked = JSON.parse((await cli(['new', 'blocked work', '--dep', open.id, '--json'])).out);
    await cli(['claim', taken.id]);
    const ready = JSON.parse((await cli(['ready', '--json'])).out);
    expect(ready.issues.map((issue) => issue.id)).toEqual([open.id]);
    expect(ready.issues.map((issue) => issue.id)).not.toContain(blocked.id);
  });

  it('releases a claim and hands the issue back', async () => {
    const filed = JSON.parse((await cli(['new', 'given up', '--json'])).out);
    await cli(['claim', filed.id, '--files', 'src/given-up.ts']);
    const released = await cli(['release', filed.id]);
    expect(released.code).toBe(0);
    const shown = JSON.parse((await cli(['show', filed.id, '--json'])).out);
    expect(shown.issue.status).toBe('open');
    expect(shown.locks).toHaveLength(0);
  });

  it('reports status, including a claim nobody is holding any more', async () => {
    await cli(['new', 'stale one', '--json']);
    const { id } = JSON.parse((await cli(['new', 'claimed by a', '--lease', '1ms', '--json'])).out);
    await cli(['claim', id, '--lease', '1ms']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const status = JSON.parse((await cli(['status', '--json'])).out);
    expect(status.expiredClaims).toBe(1);
    expect(status.ready).toBe(2);
  });

  it('runs doctor over an orphaned worktree and says what it released', async () => {
    // A real repository, because that is the only way a claim records a
    // worktree path: a directory that is not a checkout has no worktree to
    // lose, and `doctor` finding nothing there would be correct.
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    const { id } = JSON.parse((await cli(['new', 'orphaned', '--json'], 'a', repo)).out);
    await cli(['claim', id, '--lease', '24h', '--files', 'src/orphan.ts'], 'a', repo);
    rmSync(repo, { recursive: true, force: true });
    const dry = await cli(['doctor', '--dry-run', '--json']);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.out).findings.length).toBeGreaterThan(0);
    const fixed = await cli(['doctor']);
    expect(fixed.out).toContain('released');
    expect(JSON.parse((await cli(['show', id, '--json'])).out).issue.status).toBe('open');
  });

  it('rejects an unknown command with the usage text', async () => {
    const bad = await cli(['frobnicate']);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('unknown command: frobnicate');
    expect(bad.err).toContain('agent board');
  });

  it('emits JSON for every machine-facing command', async () => {
    const { id } = JSON.parse((await cli(['new', 'json shaped', '--json'])).out);
    await cli(['claim', id, '--json']);
    // `watch` is absent on purpose: it is a stream of lines an agent reads
    // while it works, and there is no single document for it to be.
    for (const args of [
      ['list', '--json'],
      ['ready', '--json'],
      ['status', '--json'],
      ['show', id, '--json'],
      ['export', '--json'],
    ]) {
      const result = await cli(args);
      expect(result.code).toBe(0);
      expect(() => JSON.parse(result.out)).not.toThrow();
    }
  });

  it('streams the event log as readable lines for `watch`', async () => {
    const { id } = JSON.parse((await cli(['new', 'watched', '--json'])).out);
    await cli(['comment', id, 'a line the swarm reads']);
    const watched = await cli(['watch']);
    expect(watched.code).toBe(0);
    expect(watched.out).toContain('issue.create');
    expect(watched.out).toContain('a line the swarm reads');
  });

  it('exits 2 for an issue that does not exist', async () => {
    const missing = await cli(['show', 'ph-404']);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/no such issue: ph-404/);
  });

  it('tells an agent which files an issue is about, and whether they are free', async () => {
    await cli(['hold', 'src/context.tsx']);
    const report = JSON.parse((await cli(['check', 'src/context.tsx', 'src/other.ts', '--json'], 'b')).out);
    expect(report.report[0].free).toBe(false);
    expect(report.report[0].holders[0].agent_id).toBe('a');
    expect(report.report[1].free).toBe(true);
  });
});
