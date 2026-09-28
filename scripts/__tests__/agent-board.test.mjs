/**
 * The board's tests, at the layer where its guarantees live: two processes
 * racing for one claim, a lease that runs out under a live task, a file that two
 * agents both believe is theirs, and a fixer trying to verify their own fix.
 *
 * Each test gets its own directory, so nothing here depends on the operator's
 * real board, and a test that leaks a lock cannot reach the next one.
 *
 * The claim-exclusivity test spawns real processes on purpose. Two connections
 * in one process share a thread and a connection pool; separate OS processes,
 * launched at the same instant against a database that does not exist yet, are
 * the situation the board actually has to survive when a swarm wakes up, and
 * they found two defects the in-process tests could not: a lost claim race
 * hidden by a shared process, and `SQLITE_BUSY` on the very first open.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board, BoardError, parseDuration } from '../lib/agent-board/db.mjs';
import { resolveIdentity } from '../lib/agent-board/identity.mjs';
import { run } from '../agent-board.mjs';

/**
 * The CLI as a filesystem path, for spawning.
 *
 * `import.meta.url` is NOT usable here: under the root jsdom project it is an
 * `http://localhost/...` URL, so spawning it means asking node to load a web
 * page. `import.meta.dirname` is the real directory, and the fallback covers a
 * runner that does not provide it.
 */
const CLI = resolve(import.meta.dirname ?? process.cwd(), '..', 'agent-board.mjs');

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
   * A load-bearing assumption, stated as narrowly as it is true: the BUILT-IN
   * `node:sqlite` binding loads and writes under the root Vitest project, whose
   * pool is `vmThreads`. If a pool or environment change ever took that away,
   * every test below would fail to import for a reason that has nothing to do
   * with the board, and this one fails first and says so.
   *
   * It deliberately does not touch `Board`: what proves the BOARD works in this
   * project is the ninety-odd tests that exercise it, not a probe of a
   * dependency in isolation.
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
    board.closeIssue(id, { agent: 'reviewer' });
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

  it('records a refusal in the log, which a rolled-back transaction cannot', () => {
    const a = boardFor('a');
    a.holdFiles(['src/taken.ts']);
    a.close();
    const b = boardFor('b');
    expect(() => b.holdFiles(['src/taken.ts'])).toThrow();
    // The denial is written inside the transaction that then rolls back, so the
    // log used to show no contention at all — losing the one event that tells
    // the swarm a file is busy.
    const denial = b.events({ since: 0, kind: 'lock.deny' });
    expect(denial).toHaveLength(1);
    expect(denial[0].path).toBe('src/taken.ts');
    expect(denial[0].message).toBe('refused, held by a');
    b.close();
  });

  it('normalizes paths so the same file from two worktrees is one lock', () => {
    const board = boardFor('a');
    board.holdFiles(['./src/util/draw.ts', 'src/util/draw.ts']);
    expect(board.locksHeldBy('a').map((lock) => lock.path)).toEqual(['src/util/draw.ts']);
  });

  it('strips the worktree prefix, so an absolute path is the same lock', () => {
    const a = boardFor('a');
    a.holdFiles([`${a.identity.worktree}/src/util/draw.ts`]);
    a.close();
    const b = boardFor('b');
    // Two worktrees, two absolute prefixes, one file: the lock has to collide
    // or the whole rule is off for anyone who passes an absolute path.
    expect(b.checkPath('src/util/draw.ts').holders.map((holder) => holder.agent_id)).toEqual(['a']);
    expect(b.locksHeldBy('a').map((lock) => lock.path)).toEqual(['src/util/draw.ts']);
    b.close();
  });

  it('hides an expired lock from everything that renders it, not just from a conflict check', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'lock outlives its lease' });
    // The claim outlives the lock, so the ONLY thing that can empty this list
    // later is the lock's own lease. With both leases equal, the assertion
    // would pass for the wrong reason and then stop passing for a good one.
    a.claimIssue(id, { leaseMs: 600_000 });
    a.holdFiles(['src/ghost.ts'], { issueId: id, leaseMs: 60_000 });
    expect(a.locksFor(id)).toHaveLength(1);
    expect(a.listIssues({ files: ['src/ghost.ts'], claimedBy: 'a' })).toHaveLength(1);
    advance(60_001);
    // `board show` and the FILES column of `board ready` read locksFor, and used
    // to advertise a lease that had already run out while `board check`, in the
    // same breath, called the file free.
    expect(a.liveClaimOrNull(id)).not.toBeNull();
    expect(a.locksFor(id)).toHaveLength(0);
    expect(a.listIssues({ files: ['src/ghost.ts'], claimedBy: 'a' })).toHaveLength(0);
    a.close();
  });

  it('does not list an issue under --claimed-by once its claim has expired', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'lease ran out' });
    a.claimIssue(id, { leaseMs: 60_000 });
    expect(a.listIssues({ claimedBy: 'a' }).map((issue) => issue.id)).toEqual([id]);
    advance(60_001);
    expect(a.listIssues({ claimedBy: 'a' })).toHaveLength(0);
  });

  it('checks an absolute path against a lock stored relative, and the reverse', () => {
    const a = boardFor('a');
    // `touchAgent` is what the CLI does on every invocation, and it is what
    // teaches the board that `<dir>/wt-a` is a worktree of this repository.
    a.touchAgent();
    a.holdFiles(['src/x.ts']);
    a.close();
    const b = boardFor('b');
    b.touchAgent();
    // `board check` is the gate a shell branches on, so a pasted absolute path
    // has to hit the same lock the hold stored in relative form. Normalising
    // only on the write side made this report a held file as FREE.
    expect(b.checkPath('src/x.ts').free).toBe(false);
    // From B's OWN worktree…
    expect(b.checkPath(`${b.identity.worktree}/src/x.ts`).free).toBe(false);
    // …and from A's, which B only knows about because the board saw A in it.
    expect(b.checkPath(`${a.identity.worktree}/src/x.ts`).holders[0].agent_id).toBe('a');
    expect(b.checkPath(`${a.identity.worktree}/src/x.ts`).free).toBe(false);
    b.close();
  });

  it('does not collapse a sibling directory whose name starts with the worktree', () => {
    const a = boardFor('a');
    const sibling = `${a.identity.worktree}-two/src/x.ts`;
    a.holdFiles([sibling]);
    const stored = a.locksHeldBy('a').map((lock) => lock.path);
    // `/wt` must not chew `-two/src/x.ts` out of `/wt-two/src/x.ts`, and a path
    // that does not exist is canonicalised through its deepest EXISTING
    // ancestor — which must re-attach every component below it, or the lock
    // lands on a file the caller never named.
    expect(stored).toHaveLength(1);
    expect(stored[0].endsWith('/wt-a-two/src/x.ts')).toBe(true);
    expect(stored[0]).not.toBe('src/x.ts');
    a.close();
    const b = boardFor('b');
    // Same string in, same lock found: the two ends agree.
    expect(b.checkPath(sibling).holders.map((holder) => holder.agent_id)).toEqual(['a']);
    expect(b.checkPath('src/x.ts').free).toBe(true);
    b.close();
  });

  it('refuses a path that is nothing but the worktree, rather than locking nothing', () => {
    const a = boardFor('a');
    // The prefix strips to the empty string, and a lock on "" is a lock on a
    // file no agent can name.
    expect(() => a.holdFiles([`${a.identity.worktree}/`])).toThrow(/no file paths/);
    expect(a.locksHeldBy('a')).toHaveLength(0);
    a.close();
  });

  it('leaves a pre-existing lock attributed to the issue that took it', () => {
    const a = boardFor('a');
    const first = a.createIssue({ title: 'owns src/x.ts' });
    a.holdFiles(['src/x.ts'], { issueId: first.id });
    // A later claim names the same file. The file is already ours, so this is
    // not a conflict — but the claim then fails, and the lock must not have been
    // re-pointed at an issue we never took.
    const second = a.createIssue({ title: 'the claim that will be refused' });
    const taken = a.holdFiles(['src/x.ts'], { issueId: second.id });
    expect(taken.acquired).toEqual([]);
    expect(a.locksFor(first.id).map((lock) => lock.path)).toEqual(['src/x.ts']);
    expect(a.locksFor(second.id)).toHaveLength(0);
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
      a.closeIssue(id);
      throw new Error('should not have closed');
    } catch (error) {
      expect(error.code).toBe(5);
      expect(error.message).toMatch(/verification is somebody else's/);
    }
    expect(a.getIssue(id).status).toBe('resolved');
  });

  it('has no way to name a verifier that is not the agent running the command', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'named verifier' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.resolveIssue(id);
    // The parameter that made the rule one flag wide: a caller could hand in the
    // name of an agent that was not in the room and close its own work. The
    // assertion is that it no longer changes anything, not that it is absent
    // from the signature.
    expect(() => a.closeIssue(id, { verifiedBy: 'some-other-agent' })).toThrow(/cannot also verify it/);
    a.close();
  });

  it('closes when a different agent verifies, and records who', () => {
    const a = boardFor('a');
    const { id } = a.createIssue({ title: 'verified by a review' });
    a.claimIssue(id, { leaseMs: 60_000 });
    a.resolveIssue(id);
    const b = boardFor('b');
    const result = b.closeIssue(id);
    expect(result.status).toBe('closed');
    expect(b.getIssue(id).verified_by).toBe('b');
    expect(b.events({ issue: id }).at(-1).kind).toBe('issue.close');
    a.close();
    b.close();
  });

  it('reopens a closed issue back to open, dropping its claim', () => {
    const board = boardFor('a');
    const { id } = board.createIssue({ title: 'regression' });
    board.claimIssue(id, { leaseMs: 60_000 });
    board.resolveIssue(id);
    board.closeIssue(id, { agent: 'reviewer' });
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
    board.closeIssue(id, { agent: 'reviewer' });
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

describe('separate processes, not just separate connections', () => {
  /** Runs the CLI in its own process and resolves with its exit code. */
  const spawnCli = (args, agent) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, ...args, '--dir', dir, '--agent', agent], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('close', (code) => resolve({ code, out, err }));
    });

  it('lets exactly one of ten processes claim one issue', async () => {
    const board = liveBoardFor('setup');
    const { id } = board.createIssue({ title: 'contended by ten processes' });
    board.close();

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => spawnCli(['claim', id], `racer-${index}`))
    );
    const winners = results.filter((result) => result.code === 0);
    const refused = results.filter((result) => result.code === 3);
    expect(winners).toHaveLength(1);
    expect(refused).toHaveLength(9);
    // A refusal must name the winner, or a loser cannot tell a race from a bug.
    expect(refused[0].err).toMatch(/claimed by racer-/);

    const after = new Board({ dir, identity: identityFor('audit') }).open();
    expect(after.getIssue(id).status).toBe('claimed');
    const holder = after.liveClaimOrNull(id).agent_id;
    expect(winners[0].out).toContain(`claimed by ${holder}`);
    expect(after.events({ issue: id }).filter((event) => event.kind === 'claim.acquire')).toHaveLength(1);
    after.close();
  }, 30_000);

  it('survives many processes opening a board that does not exist yet', async () => {
    /**
     * The first-open race. `PRAGMA journal_mode` needs a lock on the file that
     * SQLite's busy handler does NOT wait for, and the version row used to be
     * read-then-inserted outside a transaction. It reproduced on roughly one
     * process in twelve, intermittently, with every in-process test green —
     * which is to say it would have been found the first morning a swarm woke
     * up, and never before.
     *
     * Twenty-four processes, because ten was not enough: the first fix
     * (reordering the pragmas) turned 74 failures per 640 into 2, and a
     * ten-process test could not see the difference. This one asserts on the
     * error text, so the failure mode names itself.
     */
    rmSync(dir, { recursive: true, force: true });
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        spawnCli(['new', `first command from ${index}`, '--json'], `opener-${index}`)
      )
    );
    const failed = results.filter((result) => result.code !== 0);
    expect(failed.map((result) => result.err.split('\n')[0])).toEqual([]);
    const after = new Board({ dir, identity: identityFor('audit') }).open();
    expect(after.listIssues()).toHaveLength(24);
    after.close();
  }, 60_000);

  it('converts a fresh board to WAL exactly once, whoever gets there first', async () => {
    rmSync(dir, { recursive: true, force: true });
    const board = new Board({ dir, identity: identityFor('wal') }).open();
    expect(board.currentJournalMode()).toBe('wal');
    board.close();
    // A second open must not re-attempt the conversion: the exclusive lock is
    // only ever contended by the open that creates the file.
    const again = new Board({ dir, identity: identityFor('wal') }).open();
    expect(again.currentJournalMode()).toBe('wal');
    again.close();
  }, 15_000);
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

  it('shows, in `ready`, the files an issue is about and whether they are free', async () => {
    const filed = JSON.parse(
      (await cli(['new', 'P0 — the worst thing in the adapter', '--files', 'src/a.ts', 'src/b.ts', '--json'])).out
    );
    // The column reports the files the issue is ABOUT, and the same column
    // reported locks — so an imported issue, which takes none on purpose, showed
    // `-` for all fifty-four of them and told a reader nothing at all.
    //
    // Your own locks are not contention, so the filer sees its own files free.
    expect((await cli(['ready'])).out).toContain('2 free');
    // Somebody else sees exactly who is in them, by path.
    const asOther = (await cli(['ready'], 'other')).out;
    expect(asOther).toContain('2/2 held: src/a.ts by a, src/b.ts by a');
    expect(asOther).toContain('src/a.ts');
    expect(filed.id).toMatch(/^ph-\d+$/);
  });

  it('keeps a stray word out of the title when --files takes a list', async () => {
    // `--files a.ts b.ts` used to take `a.ts` as the value and leave `b.ts` as a
    // positional, which on `new` silently became part of the issue TITLE — the
    // documented example in AGENTS.md did not do what it said.
    const filed = JSON.parse((await cli(['new', 'A plain title', '--files', 'src/a.ts', 'src/b.ts', '--json'])).out);
    const shown = JSON.parse((await cli(['show', filed.id, '--json'])).out);
    expect(shown.issue.title).toBe('A plain title');
    expect((await cli(['ready'])).out).toContain('2 free');
  });

  it('sorts ready by priority, not by the order the issues were filed', async () => {
    await cli(['new', 'P3 — cosmetic', '--priority', 'low', '--json']);
    await cli(['new', 'P0 — catastrophic', '--priority', 'critical', '--json']);
    await cli(['new', 'P1 — important', '--priority', 'high', '--json']);
    const { issues } = JSON.parse((await cli(['ready', '--json'])).out);
    expect(issues.map((issue) => issue.priority)).toEqual(['critical', 'high', 'low']);
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

  it("gives back only its own locks when a claim fails, never another agent's", async () => {
    /**
     * The rollback used to release `held`, which includes files this agent
     * already held before the command ran — holding a file you already hold is
     * not a conflict, so it is not in `acquired` — and it used to pass `force`,
     * which releases every other agent's row on the path too. So this sequence
     * destroyed `a`'s lock on `src/x.ts`, taken before the command started, with
     * a command that only ever FAILED. The worst possible moment to free a file
     * somebody is working in.
     */
    await cli(['hold', 'src/x.ts']);
    const taken = JSON.parse((await cli(['new', 'b claims this first', '--json'], 'b')).out);
    await cli(['claim', taken.id], 'b');

    // `a` tries to claim an issue `b` already holds, naming a file `a` holds.
    const refused = await cli(['claim', taken.id, '--files', 'src/x.ts'], 'a');
    expect(refused.code).toBe(3);
    const stillHeld = JSON.parse((await cli(['check', 'src/x.ts', '--json'], 'b')).out);
    expect(stillHeld.report[0].free).toBe(false);
    expect(stillHeld.report[0].holders.map((holder) => holder.agent_id)).toEqual(['a']);
  });

  it('does release the files it did take when the claim is refused', async () => {
    const issue = JSON.parse((await cli(['new', 'a free file, a taken issue', '--json'])).out);
    const other = JSON.parse((await cli(['new', 'claimed by b', '--json'], 'b')).out);
    await cli(['claim', other.id], 'b');
    const refused = await cli(['claim', other.id, '--files', 'src/fresh.ts'], 'a');
    expect(refused.code).toBe(3);
    const report = JSON.parse((await cli(['check', 'src/fresh.ts', '--json'], 'b')).out);
    expect(report.report[0].free).toBe(true);
    expect(issue.id).toBeTruthy();
  });

  it('refuses to close an issue as the agent that resolved it, with no flag to name another', async () => {
    const filed = JSON.parse((await cli(['new', 'no named verifier', '--json'])).out);
    await cli(['claim', filed.id]);
    await cli(['resolve', filed.id]);
    const selfClose = await cli(['close', filed.id]);
    expect(selfClose.code).toBe(5);
    const named = await cli(['close', filed.id, '--verified-by', 'somebody-else']);
    // The flag is not a way around it: the verifier is whoever runs the command.
    expect(JSON.parse((await cli(['show', filed.id, '--json'])).out).issue.status).toBe('resolved');
    expect(named.code).toBe(5);
    const reviewed = await cli(['close', filed.id], 'b');
    expect(reviewed.code).toBe(0);
  });

  it('tails only new events, so --follow does not reprint the log forever', async () => {
    const { id } = JSON.parse((await cli(['new', 'watched twice', '--json'])).out);
    await cli(['comment', id, 'first comment']);

    const child = spawn(process.execPath, [CLI, 'watch', '--follow', '--dir', dir, '--agent', 'watcher'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let seen = '';
    child.stdout.on('data', (chunk) => {
      seen += chunk;
    });
    const occurrences = (text) => seen.split(text).length - 1;
    const waitFor = async (predicate, ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };

    try {
      expect(await waitFor(() => seen.includes('first comment'), 10_000)).toBe(true);
      await cli(['comment', id, 'second comment'], 'watcher');
      expect(await waitFor(() => seen.includes('second comment'), 10_000)).toBe(true);
      // Several more poll rounds. The cursor used not to move, so a `--follow`
      // reprinted the same first 200 events roughly seventy times a second and
      // on a busier board never showed anything new at all.
      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      child.kill('SIGTERM');
    }
    expect(occurrences('first comment')).toBe(1);
    expect(occurrences('second comment')).toBe(1);
  }, 30_000);

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
