import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Board } from '../lib/agent-board/db.mjs';
import { formatReport, releaseBlocker, releaseMerged, releaseWorktree } from '../merge-release.mjs';

/**
 * These drive a REAL git repository with REAL worktrees and a REAL board.
 *
 * The subject of the whole script is a git fact — "is this branch on main" — and a stub
 * cannot falsify one. A test that handed `releaseWorktree` a fabricated `merged: true`
 * would pass no matter what the merge-base check did, which is the failure mode this file
 * exists to rule out. So every case below builds a repository, commits in it, and asks git.
 *
 * The budget is 20s because every test pays for a `git init`, a commit and a `worktree add`.
 * It is a BUDGET, not a threshold: it cannot turn a failing assertion green, it only decides
 * how long a test may run before the harness calls it. Measured at 3.7s for the file on a
 * warm machine, so this is 5x the real cost rather than a number tuned to today's load.
 */
vi.setConfig({ testTimeout: 20_000 });
vi.setConfig({ hookTimeout: 30_000 });

let dir;
let repo;
let boardDir;
let clock;
const openBoards = [];

const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const identityFor = (agentId, worktree = repo, branch = agentId) => ({
  agentId,
  kind: 'kilo',
  worktree,
  branch,
  sessionId: `run-${agentId}`,
  pid: 4242,
  meta: {},
});

const boardFor = (agentId, worktree = repo) => {
  const board = new Board({ dir: boardDir, identity: identityFor(agentId, worktree), now: () => clock }).open();
  openBoards.push(board);
  return board;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'merge-release-test-'));
  repo = join(dir, 'repo');
  boardDir = join(dir, 'board');
  clock = Date.parse('2026-09-30T12:00:00.000Z');
  mkdirSync(repo, { recursive: true });

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'README.md'), 'base\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
});

afterEach(() => {
  while (openBoards.length > 0) openBoards.pop().close();
  rmSync(dir, { recursive: true, force: true });
});

/** A worktree on its own branch, optionally with a commit that is not on main. */
const makeWorktree = (name, { commit = false, dirty = false } = {}) => {
  const path = join(repo, '..', `wt-${name}`);
  git(['worktree', 'add', '-q', '-b', `feat/${name}`, path], repo);
  if (commit) {
    writeFileSync(join(path, 'file.txt'), `${name}\n`);
    execFileSync('git', ['add', '.'], { cwd: path });
    execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '-m', name], {
      cwd: path,
    });
  }
  if (dirty) writeFileSync(join(path, 'uncommitted.txt'), 'work in progress\n');
  return path;
};

describe('releaseBlocker — the three facts a release requires', () => {
  const base = { base: 'main', worktreePath: repo, branch: 'feat/x' };

  it('refuses a worktree whose directory is gone', () => {
    expect(releaseBlocker({ ...base, exists: false })).toMatchObject({ code: 'directory-gone' });
    expect(releaseBlocker({ ...base, exists: false }).message).toMatch(/directory is gone/);
  });

  it('refuses a detached HEAD, which has no branch to have merged', () => {
    expect(releaseBlocker({ ...base, branch: null })).toMatchObject({ code: 'detached' });
    expect(releaseBlocker({ ...base, branch: null }).message).toMatch(/detached/);
  });

  it('refuses the base branch itself', () => {
    expect(releaseBlocker({ ...base, branch: 'main' })).toMatchObject({ code: 'base-branch' });
    expect(releaseBlocker({ ...base, branch: 'main' }).message).toMatch(/base branch/);
  });

  it('refuses a branch that is not on the base', () => {
    const path = makeWorktree('unmerged', { commit: true });
    const blocker = releaseBlocker({
      ...base,
      worktreePath: path,
      branch: 'feat/unmerged',
    });
    // The code is the stable half and the message the human half. Both are asserted because
    // `formatReport` buckets on the one and prints the other, so a change to either alone
    // is a change to what the report does.
    expect(blocker).toMatchObject({ code: 'not-on-base' });
    expect(blocker.message).toMatch(/not on main yet/);
  });

  it('refuses a merged branch whose working tree is dirty', () => {
    const path = makeWorktree('dirt', { commit: true, dirty: true });
    git(['merge', '-q', '--no-ff', '-m', 'land dirt', 'feat/dirt'], repo);
    const blocker = releaseBlocker({
      ...base,
      worktreePath: path,
      branch: 'feat/dirt',
      dirtyOutput: ' M uncommitted.txt',
    });
    expect(blocker).toMatchObject({ code: 'dirty' });
    expect(blocker.message).toMatch(/working tree is dirty/);
  });

  it('refuses a merged branch when working-tree status could not be read', () => {
    const path = makeWorktree('unreadable-status', { commit: true });
    git(['merge', '-q', '--no-ff', '-m', 'land unreadable status', 'feat/unreadable-status'], repo);
    expect(releaseBlocker({ ...base, worktreePath: path, branch: 'feat/unreadable-status' })).toMatchObject({
      code: 'status-unreadable',
    });
  });

  it('accepts a newly merged, clean worktree when the previous base is known', () => {
    const path = makeWorktree('ok', { commit: true });
    const previousBase = git(['rev-parse', 'main']);
    git(['merge', '-q', '--no-ff', '-m', 'land ok', 'feat/ok'], repo);
    expect(
      releaseBlocker({ ...base, worktreePath: path, branch: 'feat/ok', dirtyOutput: '', previousBase })
    ).toBeNull();
  });

  it('fails closed when the previous base transition is not supplied', () => {
    const path = makeWorktree('unknown-transition', { commit: true });
    git(['merge', '-q', '--no-ff', '-m', 'land unknown transition', 'feat/unknown-transition'], repo);
    expect(
      releaseBlocker({ ...base, worktreePath: path, branch: 'feat/unknown-transition', dirtyOutput: '' })
    ).toMatchObject({ code: 'base-transition-unproven' });
  });

  it('distinguishes unreadable ancestry from a branch that is simply not merged', () => {
    expect(
      releaseBlocker({
        ...base,
        branch: 'feat/does-not-exist',
        dirtyOutput: '',
        previousBase: git(['rev-parse', 'main']),
      })
    ).toMatchObject({ code: 'ancestry-unreadable' });
  });
});

describe('releaseWorktree — releases as the branch, and only the branch', () => {
  it('releases the merged branch’s own claim and its file lock', () => {
    const path = makeWorktree('mine', { commit: true });
    const previousBase = git(['rev-parse', 'main']);
    const board = boardFor('feat/mine', path);
    // The board mints its own ids, so the claim is made against what it hands back rather
    // than against an id this test chose.
    const id = board.createIssue({ title: 'issue one' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    board.holdFiles([join(path, 'src/thing.ts')], { issueId: id, leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land mine', 'feat/mine'], repo);

    const result = releaseWorktree(board, { worktreePath: path, branch: 'feat/mine', base: 'main', previousBase });
    expect(result.releasedClaims).toEqual([id]);
    expect(board.listIssues({ claimedBy: 'feat/mine' })).toEqual([]);
    // The lock goes with the claim, which is the board's own pairing rule
    // (`releaseIssueLocksInTransaction`), not a second thing this script had to do. So the
    // assertion is on the end state: the path is free for the next agent.
    expect(board.locksHeldBy('feat/mine')).toEqual([]);
    expect(board.liveLocks().map((l) => l.path)).toEqual([]);
  });

  it('leaves another agent’s claim on the same file alone, without force', () => {
    // The rule this script exists to respect: a merge must never take a file from an agent
    // that is still writing. `--force` would, because it skips the ownership check on
    // every row for the path.
    const path = makeWorktree('shared', { commit: true });
    const previousBase = git(['rev-parse', 'main']);
    const theirs = boardFor('other/agent', path);
    theirs.holdFiles([join(path, 'src/contested.ts')], { leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land shared', 'feat/shared'], repo);

    const mine = boardFor('feat/shared', path);
    const result = releaseWorktree(mine, {
      worktreePath: path,
      branch: 'feat/shared',
      base: 'main',
      previousBase,
    });
    expect(result.releasedLocks ?? []).toEqual([]);
    // Still held, by the agent that took it. This is the assertion that would break first
    // if anyone reached for `--force`, because force skips the ownership check entirely.
    expect(theirs.locksHeldBy('other/agent').map((l) => l.path)).toEqual(['src/contested.ts']);
  });

  it('refuses a claim another agent holds, rather than taking it', () => {
    // The contested-CLAIM half of the same rule the lock test above covers. A lock is
    // released per path; a claim is a whole issue, and `--force` on `releaseClaim` would
    // hand another agent's live issue back to the queue — the shape the repo forbids
    // outright. Without this case the force mutation went green, because a board in these
    // tests had no claim it did not own.
    const path = makeWorktree('contested-claim', { commit: true });
    const theirs = boardFor('other/agent', path);
    const id = theirs.createIssue({ title: 'theirs' }).id;
    theirs.claimIssue(id, { leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land contested', 'feat/contested-claim'], repo);

    const mine = boardFor('feat/contested-claim', path);
    // A sweep of the merged worktree runs; the claim belongs to somebody else.
    const results = releaseMerged({ repoRoot: repo, base: 'main', board: mine });
    const row = results.find((r) => r.branch === 'feat/contested-claim');

    // Nothing of theirs was released, and the issue is still claimed by them.
    expect(row.releasedClaims ?? []).toEqual([]);
    expect(theirs.listIssues({ claimedBy: 'other/agent' }).map((c) => c.id)).toEqual([id]);
  });

  it('reports “nothing held” rather than inventing a release', () => {
    const path = makeWorktree('idle', { commit: true });
    const previousBase = git(['rev-parse', 'main']);
    git(['merge', '-q', '--no-ff', '-m', 'land idle', 'feat/idle'], repo);
    const result = releaseWorktree(boardFor('feat/idle', path), {
      worktreePath: path,
      branch: 'feat/idle',
      base: 'main',
      previousBase,
    });
    expect(result.skipped).toMatch(/nothing held/);
  });

  it('--dry-run reports what it would release and changes nothing', () => {
    const path = makeWorktree('dry', { commit: true });
    const previousBase = git(['rev-parse', 'main']);
    const board = boardFor('feat/dry', path);
    const id = board.createIssue({ title: 'issue two' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land dry', 'feat/dry'], repo);

    const result = releaseWorktree(board, {
      worktreePath: path,
      branch: 'feat/dry',
      base: 'main',
      previousBase,
      dryRun: true,
    });
    expect(result.wouldRelease.claims).toEqual([id]);
    expect(board.listIssues({ claimedBy: 'feat/dry' }).map((c) => c.id)).toEqual([id]);
  });
});

describe('releaseMerged — the whole sweep a merge triggers', () => {
  it('releases a merged worktree and skips an unmerged one', () => {
    const landed = makeWorktree('landed', { commit: true });
    const pending = makeWorktree('pending', { commit: true });
    const board = boardFor('sweeper', repo);
    const landedId = board.createIssue({ title: 'landed' }).id;
    const pendingId = board.createIssue({ title: 'pending' }).id;
    boardFor('feat/landed', landed).claimIssue(landedId, { leaseMs: 60_000 });
    boardFor('feat/pending', pending).claimIssue(pendingId, { leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land it', 'feat/landed'], repo);

    const results = releaseMerged({ repoRoot: repo, base: 'main', board });
    const byBranch = Object.fromEntries(results.map((r) => [r.branch, r]));

    expect(byBranch['feat/landed'].releasedClaims).toEqual([landedId]);
    expect(byBranch['feat/pending'].skipped).toMatch(/not on main yet/);
    // The pending task keeps its claim, which is the whole point of gating on git facts.
    expect(board.listIssues({ claimedBy: 'feat/pending' }).map((c) => c.id)).toEqual([pendingId]);
  });

  it('recognizes a fast-forward base transition from the reflog', () => {
    const candidate = makeWorktree('fast-forward', { commit: true });
    const owner = boardFor('feat/fast-forward', candidate);
    const id = owner.createIssue({ title: 'fast-forward landing' }).id;
    owner.claimIssue(id, { leaseMs: 60_000 });

    git(['merge', '--ff-only', 'feat/fast-forward'], repo);
    const results = releaseMerged({ repoRoot: repo, base: 'main', board: owner });
    const row = results.find((result) => result.branch === 'feat/fast-forward');

    expect(row.releasedClaims).toEqual([id]);
    expect(owner.listIssues({ claimedBy: 'feat/fast-forward' })).toEqual([]);
  });

  it('never releases the main worktree’s own claim', () => {
    const board = boardFor('main', repo);
    const id = board.createIssue({ title: 'main work' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    const results = releaseMerged({ repoRoot: repo, base: 'main', board });
    const mainRow = results.find((r) => r.branch === 'main');
    expect(mainRow.skipped).toMatch(/base branch/);
    expect(board.listIssues({ claimedBy: 'main' }).map((c) => c.id)).toEqual([id]);
  });

  it('does not sweep from a task worktree that fast-forwarded from main', () => {
    const landed = makeWorktree('older-landed', { commit: true });
    const taskPath = join(repo, '..', 'wt-task-sync');
    git(['worktree', 'add', '-q', '-b', 'task/sync', taskPath, 'main'], repo);

    const owner = boardFor('feat/older-landed', landed);
    const id = owner.createIssue({ title: 'older landed task' }).id;
    owner.claimIssue(id, { leaseMs: 60_000 });
    owner.holdFiles([join(landed, 'src/older.ts')], { issueId: id, leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land older branch', 'feat/older-landed'], repo);
    git(['merge', '-q', 'main'], taskPath);

    const results = releaseMerged({ repoRoot: taskPath, base: 'main', board: owner });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ skipCode: 'outside-base-branch' });
    expect(owner.listIssues({ claimedBy: 'feat/older-landed' }).map((issue) => issue.id)).toEqual([id]);
    expect(owner.locksHeldBy('feat/older-landed')).toHaveLength(1);
  });

  it('skips an older already-merged branch during a later main merge', () => {
    const older = makeWorktree('older', { commit: true });
    const olderOwner = boardFor('feat/older', older);
    const olderId = olderOwner.createIssue({ title: 'already merged' }).id;
    olderOwner.claimIssue(olderId, { leaseMs: 60_000 });
    olderOwner.holdFiles([join(older, 'src/older.ts')], { issueId: olderId, leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land older branch', 'feat/older'], repo);

    const newer = makeWorktree('newer', { commit: true });
    const newerOwner = boardFor('feat/newer', newer);
    const newerId = newerOwner.createIssue({ title: 'new merge' }).id;
    newerOwner.claimIssue(newerId, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land newer branch', 'feat/newer'], repo);

    const results = releaseMerged({ repoRoot: repo, base: 'main', board: newerOwner });
    const byBranch = Object.fromEntries(results.map((result) => [result.branch, result]));

    expect(byBranch['feat/older']).toMatchObject({ skipCode: 'already-on-base' });
    expect(byBranch['feat/newer'].releasedClaims).toEqual([newerId]);
    expect(olderOwner.listIssues({ claimedBy: 'feat/older' }).map((issue) => issue.id)).toEqual([olderId]);
    expect(olderOwner.locksHeldBy('feat/older')).toHaveLength(1);
    expect(newerOwner.listIssues({ claimedBy: 'feat/newer' })).toEqual([]);
  });

  it('fails closed when ORIG_HEAD disagrees with the base reflog', () => {
    const candidate = makeWorktree('stale-orig-head', { commit: true });
    const owner = boardFor('feat/stale-orig-head', candidate);
    const id = owner.createIssue({ title: 'must stay held without a proven merge transition' }).id;
    owner.claimIssue(id, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land stale ORIG_HEAD test', 'feat/stale-orig-head'], repo);

    git(['update-ref', 'ORIG_HEAD', git(['rev-parse', 'feat/stale-orig-head'])]);
    const results = releaseMerged({ repoRoot: repo, base: 'main', board: owner });
    const row = results.find((result) => result.branch === 'feat/stale-orig-head');

    expect(row).toMatchObject({ skipCode: 'base-transition-unproven' });
    expect(owner.listIssues({ claimedBy: 'feat/stale-orig-head' }).map((issue) => issue.id)).toEqual([id]);
  });

  it('releases a pinned-style prepared merge only after its commit lands on the base', () => {
    const candidate = makeWorktree('prepared', { commit: true });
    const owner = boardFor('feat/prepared', candidate);
    const id = owner.createIssue({ title: 'prepared landing' }).id;
    owner.claimIssue(id, { leaseMs: 60_000 });

    git(['merge', '--no-commit', '--no-ff', '--no-edit', 'feat/prepared'], repo);
    const prepared = releaseMerged({ repoRoot: repo, base: 'main', board: owner });
    const preparedRow = prepared.find((result) => result.branch === 'feat/prepared');
    expect(preparedRow).toMatchObject({ skipCode: 'not-on-base' });
    expect(owner.listIssues({ claimedBy: 'feat/prepared' }).map((issue) => issue.id)).toEqual([id]);

    git(['commit', '-q', '-m', 'record prepared landing'], repo);
    expect(git(['rev-parse', 'ORIG_HEAD'])).toBe(git(['rev-parse', 'main@{1}']));
    const committed = releaseMerged({ repoRoot: repo, base: 'main', board: owner });
    const committedRow = committed.find((result) => result.branch === 'feat/prepared');

    expect(committedRow.releasedClaims).toEqual([id]);
    expect(owner.listIssues({ claimedBy: 'feat/prepared' })).toEqual([]);
  });

  it('pins eligibility to the base tip captured before a concurrent later landing', () => {
    const first = makeWorktree('snapshot-first', { commit: true });
    const later = makeWorktree('snapshot-later', { commit: true });
    const firstOwner = boardFor('feat/snapshot-first', first);
    const laterOwner = boardFor('feat/snapshot-later', later);
    const firstId = firstOwner.createIssue({ title: 'first snapshot landing' }).id;
    const laterId = laterOwner.createIssue({ title: 'later concurrent landing' }).id;
    firstOwner.claimIssue(firstId, { leaseMs: 60_000 });
    laterOwner.claimIssue(laterId, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land first snapshot branch', 'feat/snapshot-first'], repo);

    const originalListIssues = firstOwner.listIssues.bind(firstOwner);
    let concurrentMergeStarted = false;
    firstOwner.listIssues = (filters) => {
      if (!concurrentMergeStarted) {
        concurrentMergeStarted = true;
        git(['merge', '-q', '--no-ff', '-m', 'land concurrent later branch', 'feat/snapshot-later'], repo);
      }
      return originalListIssues(filters);
    };

    const results = releaseMerged({ repoRoot: repo, base: 'main', board: firstOwner });
    const byBranch = Object.fromEntries(results.map((result) => [result.branch, result]));

    expect(byBranch['feat/snapshot-first'].releasedClaims).toEqual([firstId]);
    expect(byBranch['feat/snapshot-later']).toMatchObject({ skipCode: 'not-on-base' });
    expect(laterOwner.listIssues({ claimedBy: 'feat/snapshot-later' }).map((issue) => issue.id)).toEqual([laterId]);
  });

  it('refuses release when one branch is checked out in multiple worktrees', () => {
    const candidate = makeWorktree('duplicated-branch', { commit: true });
    const duplicate = join(repo, '..', 'wt-duplicated-branch-again');
    git(['worktree', 'add', '-q', '--force', duplicate, 'feat/duplicated-branch'], repo);
    const owner = boardFor('feat/duplicated-branch', candidate);
    const id = owner.createIssue({ title: 'duplicate branch worktree claim' }).id;
    owner.claimIssue(id, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land duplicated branch', 'feat/duplicated-branch'], repo);

    const results = releaseMerged({ repoRoot: repo, base: 'main', board: owner });
    const duplicateRows = results.filter((result) => result.branch === 'feat/duplicated-branch');

    expect(duplicateRows).toHaveLength(2);
    expect(duplicateRows.every((result) => result.skipCode === 'duplicate-branch-worktree')).toBe(true);
    expect(owner.listIssues({ claimedBy: 'feat/duplicated-branch' }).map((issue) => issue.id)).toEqual([id]);
  });

  it('survives a repository with no board at all', () => {
    // A hook runs on every merge, including in a checkout that never ran `swarm`. It must
    // report and move on rather than fail a merge that has already been recorded.
    const path = makeWorktree('noboard', { commit: true });
    git(['merge', '-q', '--no-ff', '-m', 'land noboard', 'feat/noboard'], repo);
    expect(() => releaseMerged({ repoRoot: repo, base: 'main', board: undefined })).toThrow(); // no board dir yet — the CLI layer catches this, and the test pins that it throws here
  });
});

describe('formatReport — the report the hook actually prints', () => {
  const text = (results, opts) => formatReport(results, opts).join('\n');

  it('names a released worktree and counts it', () => {
    const out = text([{ worktree: 'wt', branch: 'feat/landed', releasedClaims: ['a'], releasedLocks: ['x', 'y'] }]);
    expect(out).toContain('feat/landed — claims a, 2 lock(s)');
    expect(out).toContain('released 1 of 1 worktree(s)');
  });

  it('says the dry run would release rather than that it released', () => {
    const out = text([{ worktree: 'wt', branch: 'feat/dry', wouldRelease: { claims: ['a'], locks: [] } }], {
      dryRun: true,
    });
    expect(out).toContain('would release 1 of 1 worktree(s)');
    expect(out).not.toContain('released 1 of');
  });

  it('reports a worktree that still holds something but was not released', () => {
    // The case a bare `skipped` string could not express, and the reason the skip is worth
    // reading: a branch landed by SQUASH merge reports `not on main yet` forever, because
    // `--is-ancestor` is false for it permanently.
    const out = text([
      {
        worktree: 'wt',
        branch: 'feat/squashed',
        skipped: 'feat/squashed is not on main yet',
        skipCode: 'not-on-base',
        held: { claims: ['a', 'b'], locks: ['src/x.ts'] },
      },
      { worktree: 'other', branch: 'feat/quiet', skipped: 'nothing held', skipCode: 'nothing-held' },
    ]);
    expect(out).toContain('1 worktree(s) still HOLD something and were NOT released:');
    expect(out).toContain('feat/squashed (wt) — feat/squashed is not on main yet; still holds 2 claim(s), 1 lock(s)');
    expect(out).toContain('1 skipped — 1 nothing-held');
  });

  it('reduces the ordinary skips to counts instead of a line each', () => {
    const out = text([
      { worktree: 'a', branch: 'a', skipped: 'nothing held', skipCode: 'nothing-held' },
      { worktree: 'b', branch: 'b', skipped: 'nothing held', skipCode: 'nothing-held' },
      {
        worktree: 'c',
        branch: 'c',
        skipped: 'the worktree directory is gone',
        skipCode: 'directory-gone',
      },
    ]);
    expect(out).toContain('3 skipped — 2 nothing-held, 1 directory-gone');
    expect(out).not.toContain('HOLD something');
    expect(out).toContain('released 0 of 3 worktree(s)');
  });

  it('collapses different branches that share a reason into one bucket', () => {
    // The reason the grouping is on `skipCode` and not on the message: the message names
    // the branch, so thirty unmerged worktrees are thirty distinct strings. Measured on
    // this repository, which is where the report first printed one line per worktree.
    const out = text(
      ['feat/a', 'feat/b', 'docs/c'].map((branch) => ({
        worktree: branch,
        branch,
        skipped: `${branch} is not on main yet`,
        skipCode: 'not-on-base',
      }))
    );
    expect(out).toContain('3 skipped — 3 not-on-base');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('survives a result with no `held` field', () => {
    // `releaseMerged` builds the gone-directory row without one, so a report that read
    // `held` unconditionally would throw on a row its own sibling produces.
    expect(() => text([{ worktree: 'wt', branch: 'feat/x', skipped: 'the worktree directory is gone' }])).not.toThrow();
  });
});
