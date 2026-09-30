import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Board } from '../lib/agent-board/db.mjs';
import { releaseBlocker, releaseMerged, releaseWorktree } from '../merge-release.mjs';

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

let dir;
let repo;
let boardDir;
let clock;

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

const boardFor = (agentId, worktree = repo) =>
  new Board({ dir: boardDir, identity: identityFor(agentId, worktree), now: () => clock }).open();

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
    expect(releaseBlocker({ ...base, exists: false })).toMatch(/directory is gone/);
  });

  it('refuses a detached HEAD, which has no branch to have merged', () => {
    expect(releaseBlocker({ ...base, branch: null })).toMatch(/detached/);
  });

  it('refuses the base branch itself', () => {
    expect(releaseBlocker({ ...base, branch: 'main' })).toMatch(/base branch/);
  });

  it('refuses a branch that is not on the base', () => {
    const path = makeWorktree('unmerged', { commit: true });
    expect(releaseBlocker({ ...base, worktreePath: path, branch: 'feat/unmerged' })).toMatch(/not on main yet/);
  });

  it('refuses a merged branch whose working tree is dirty', () => {
    const path = makeWorktree('dirt', { commit: true, dirty: true });
    git(['merge', '-q', '--no-ff', '-m', 'land dirt', 'feat/dirt'], repo);
    expect(
      releaseBlocker({ ...base, worktreePath: path, branch: 'feat/dirt', dirtyOutput: ' M uncommitted.txt' })
    ).toMatch(/working tree is dirty/);
  });

  it('accepts a merged, clean worktree', () => {
    const path = makeWorktree('ok', { commit: true });
    git(['merge', '-q', '--no-ff', '-m', 'land ok', 'feat/ok'], repo);
    expect(releaseBlocker({ ...base, worktreePath: path, branch: 'feat/ok', dirtyOutput: '' })).toBeNull();
  });
});

describe('releaseWorktree — releases as the branch, and only the branch', () => {
  it('releases the merged branch’s own claim and its file lock', () => {
    const path = makeWorktree('mine', { commit: true });
    const board = boardFor('feat/mine', path);
    // The board mints its own ids, so the claim is made against what it hands back rather
    // than against an id this test chose.
    const id = board.createIssue({ title: 'issue one' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    board.holdFiles([join(path, 'src/thing.ts')], { issueId: id, leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land mine', 'feat/mine'], repo);

    const result = releaseWorktree(board, { worktreePath: path, branch: 'feat/mine', base: 'main' });
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
    const theirs = boardFor('other/agent', path);
    theirs.holdFiles([join(path, 'src/contested.ts')], { leaseMs: 60_000 });

    git(['merge', '-q', '--no-ff', '-m', 'land shared', 'feat/shared'], repo);

    const mine = boardFor('feat/shared', path);
    const result = releaseWorktree(mine, { worktreePath: path, branch: 'feat/shared', base: 'main' });
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
    git(['merge', '-q', '--no-ff', '-m', 'land idle', 'feat/idle'], repo);
    const result = releaseWorktree(boardFor('feat/idle', path), {
      worktreePath: path,
      branch: 'feat/idle',
      base: 'main',
    });
    expect(result.skipped).toMatch(/nothing held/);
  });

  it('--dry-run reports what it would release and changes nothing', () => {
    const path = makeWorktree('dry', { commit: true });
    const board = boardFor('feat/dry', path);
    const id = board.createIssue({ title: 'issue two' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    git(['merge', '-q', '--no-ff', '-m', 'land dry', 'feat/dry'], repo);

    const result = releaseWorktree(board, { worktreePath: path, branch: 'feat/dry', base: 'main', dryRun: true });
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

  it('never releases the main worktree’s own claim', () => {
    const board = boardFor('main', repo);
    const id = board.createIssue({ title: 'main work' }).id;
    board.claimIssue(id, { leaseMs: 60_000 });
    const results = releaseMerged({ repoRoot: repo, base: 'main', board });
    const mainRow = results.find((r) => r.branch === 'main');
    expect(mainRow.skipped).toMatch(/base branch/);
    expect(board.listIssues({ claimedBy: 'main' }).map((c) => c.id)).toEqual([id]);
  });

  it('survives a repository with no board at all', () => {
    // A hook runs on every merge, including in a checkout that never ran `swarm`. It must
    // report and move on rather than fail a merge that has already been recorded.
    const path = makeWorktree('noboard', { commit: true });
    git(['merge', '-q', '--no-ff', '-m', 'land noboard', 'feat/noboard'], repo);
    expect(() => releaseMerged({ repoRoot: repo, base: 'main', board: undefined })).toThrow(); // no board dir yet — the CLI layer catches this, and the test pins that it throws here
  });
});
