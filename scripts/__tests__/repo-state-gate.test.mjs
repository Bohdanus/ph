/**
 * `repo-state-gate.mjs` and the library behind it.
 * ---------------------------------------------
 * This is the guard for the hazard `MERGE-INTEGRITY-AUDIT.md` §1 calls "the whole
 * hazard class in one place": a worktree holding a merge, a rebase or a bisect keeps
 * that state in files no commit records, no branch name carries, and `git status` in
 * the main checkout cannot see. On 2026-10-04 a worktree in this repository held an
 * eight-path unresolved merge for hours, and the only reason anybody knew was that a
 * person ran the audit's `find .git/worktrees -name MERGE_HEAD` by hand.
 *
 * WHY REAL REPOSITORIES
 * ---------------------
 * The markers being detected are FILES THAT GIT CREATES, so a fixture that
 * hand-writes `MERGE_HEAD` proves only that this code reads a file it was told
 * about. Every case below therefore drives a real `git merge` that really conflicts
 * and then reads what git really wrote. The one thing NOT driven for real is the
 * failure of a git read, which a scratch repository cannot be made to do on demand;
 * that case injects the reader, and says so.
 *
 * WHY THE ASSERTIONS ARE ABOUT THE REMEDY
 * ---------------------------------------
 * The dangerous property of this state is not that it is invisible — that is a
 * reporting defect — but that the obvious command is destructive on the shape that
 * matters. `MERGE-INTEGRITY-AUDIT.md` §1 says it directly: a merge whose conflicts
 * were all resolved but never committed reports a clean tree, `git merge --abort`
 * throws the resolution away, and `git commit` lands whatever the tree holds. Both
 * are one command away. So the assertions below check WHICH remedy the report names
 * for which shape, not merely that something was printed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  OPERATION_MARKERS,
  abortCommand,
  findings,
  parseWorktreeListing,
  readOperations,
  resolveAdminDirFor,
  resolveCommonDir,
  resolveGitDir,
  scanRepository,
  unmergedPaths,
} from '../lib/git-operation-state.mjs';
import { run } from '../repo-state-gate.mjs';

/**
 * Spawn-heavy: every case below builds one or more real repositories, and `git init`
 * plus `git merge` costs tens of milliseconds each against a 5s default. See the
 * sibling `suite-budgets.test.mjs` for why the number is pinned in both places.
 */
vi.setConfig({ testTimeout: 60_000 });

const created = [];

/** A temporary directory removed by the `afterEach` below, whatever the test did. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'repo-state-gate-'));
  created.push(dir);
  return dir;
}

/** Git's identity, so a commit does not depend on the developer's global config. */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
};

/** Run git and THROW unless it succeeded, for setup steps that must work. */
const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV });

/**
 * A `git merge` that is EXPECTED to conflict, so its non-zero exit is not a failure.
 *
 * `spawnSync` rather than a caught `execFileSync` throw, because the assertion below
 * needs git's OWN stderr and an explicit `stdio` array does not put it on the thrown
 * error — the first version of this helper asserted against `''` and would have
 * passed on any failure at all, including "not a repository".
 *
 * The assertion is the point: a test that read the resulting state without checking
 * that the merge conflicted would still pass on a git that merged cleanly, which is
 * the one outcome under which `unmergedPaths` is empty and the suite is vacuous.
 */
function mergeThatConflicts(repo, ref) {
  const result = spawnSync('git', ['merge', ref], { cwd: repo, encoding: 'utf8', env: GIT_ENV });
  expect(result.status, `git merge ${ref} did not conflict, so the state this test needs was never created`).not.toBe(
    0
  );
  expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/CONFLICT|Automatic merge failed/);
}

/**
 * A directory shaped like a worktree's git directory, holding `files`.
 *
 * For the one assertion that must be about the READER rather than about git: that it
 * consults `OPERATION_MARKERS` instead of a hard-coded list. A fixture written by
 * hand is legitimate here precisely because the claim is "this filename, when it
 * exists, is reported" — not "git creates this filename", which the cases above
 * prove for real.
 */
function makeGitDirWith(files) {
  const dir = join(scratch(), 'gitdir');
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    if (contents !== null) writeFileSync(join(dir, name), contents);
  }
  return dir;
}

/** Run git and return its status, for a step whose failure IS the state under test. */
function gitAllowingExit(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

/**
 * A repository with one commit, so a merge has something to conflict over.
 *
 * `--initial-branch` rather than a first branch and a rename: the branch name is
 * load-bearing below, because `scanRepository` reports it and the report prints it.
 */
function makeRepo() {
  const dir = scratch();
  git(dir, 'init', '--initial-branch=main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@example.invalid');
  writeFileSync(join(dir, 'f.txt'), 'base\n');
  git(dir, 'add', 'f.txt');
  git(dir, 'commit', '-m', 'base');
  return dir;
}

/** A branch that edits `f.txt` differently from `main`, so merging it conflicts. */
function addConflictingBranch(repo, name) {
  git(repo, 'checkout', '-b', name);
  writeFileSync(join(repo, 'f.txt'), 'theirs\n');
  git(repo, 'commit', '-am', 'theirs');
  git(repo, 'checkout', 'main');
  writeFileSync(join(repo, 'f.txt'), 'ours\n');
  git(repo, 'commit', '-am', 'ours');
  return repo;
}

/** A linked worktree at `path`, checked out on a branch of its own. */
function addWorktree(repo, name) {
  const path = join(scratch(), name);
  git(repo, 'worktree', 'add', '-b', `wt/${name}`, path);
  return path;
}

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

/** Capture both streams and the exit code, so the assertions read what an operator reads. */
function report(recordsOrCwd) {
  const out = [];
  const err = [];
  const cwd = typeof recordsOrCwd === 'function' ? undefined : recordsOrCwd;
  const records = typeof recordsOrCwd === 'function' ? recordsOrCwd() : null;
  // The returned `code` is the whole signal now — there is no exit to intercept, because
  // `run` sets `process.exitCode` and returns rather than cutting itself off mid-write.
  const result = run({
    cwd,
    scan: records === null ? undefined : () => ({ ok: true, reason: null, worktrees: records }),
    out: { write: (s) => out.push(s) },
    err: { write: (s) => err.push(s) },
  });
  return { out: out.join(''), err: err.join(''), code: result.code };
}

describe('readOperations reads what git actually writes', () => {
  it('reports a merge in progress, and names the commit being merged in', () => {
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    mergeThatConflicts(repo, 'theirs');

    // The refusal-free direction: a conflicting merge exits non-zero, and this test
    // needs the state that failure leaves behind rather than the failure itself.
    const operations = readOperations(resolveGitDir(repo));
    expect(operations).toEqual([
      { operation: 'merge', marker: 'MERGE_HEAD', value: git(repo, 'rev-parse', 'theirs').trim() },
    ]);
  });

  it('reports the paths the index cannot resolve, which porcelain calls modifications', () => {
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    mergeThatConflicts(repo, 'theirs');

    // The same fact through the two readers, side by side, because the whole defect
    // is that they disagree: `git status --porcelain` prints `UU f.txt`, and every
    // parser in `worktree-inventory` treats a non-`??` line as modified.
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toContain('UU f.txt');
    expect(unmergedPaths(repo)).toEqual(['f.txt']);
  });

  it('reports nothing for a worktree with no operation in progress', () => {
    const repo = makeRepo();
    expect(readOperations(resolveGitDir(repo))).toEqual([]);
    expect(unmergedPaths(repo)).toEqual([]);
  });

  it('reports a rebase in progress under one name, whichever directory git uses', () => {
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    // `rebase-merge` is what `git rebase` writes; `rebase-apply` is what `git am`
    // writes. Both are reported as `rebase`, and a directory rather than a file is
    // what each of them is — a reader that checked for a FILE would find neither.
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      mkdirSync(join(resolveGitDir(repo), dir), { recursive: true });
      expect(readOperations(resolveGitDir(repo)).map((o) => o.operation)).toEqual(['rebase']);
      rmSync(join(resolveGitDir(repo), dir), { recursive: true, force: true });
    }
  });

  it('reports a bisect, which porcelain calls a clean detached HEAD', () => {
    const repo = makeRepo();
    writeFileSync(join(resolveGitDir(repo), 'BISECT_LOG'), 'git bisect start\n');
    expect(readOperations(resolveGitDir(repo))).toEqual([{ operation: 'bisect', marker: 'BISECT_LOG', value: null }]);
  });

  it('reports a cherry-pick and a revert, each driven by real git', () => {
    // Both rows existed in the table with NO assertion at all — removing either one
    // failed nothing. The first attempt at this test hand-wrote the marker files, which
    // its own comment said would prove nothing, and a review caught it; so the marker
    // here is produced by actually starting the sequence. `git cherry-pick --quit` and
    // `git revert --quit` are what clear it again, so the shape does not leak into the
    // next case.
    const repo = makeRepo();

    git(repo, 'checkout', '-b', 'source');
    writeFileSync(join(repo, 'f.txt'), 'theirs\n');
    git(repo, 'commit', '-am', 'theirs');
    const theirs = git(repo, 'rev-parse', 'HEAD').trim();

    git(repo, 'checkout', 'main');
    writeFileSync(join(repo, 'f.txt'), 'ours\n');
    git(repo, 'commit', '-am', 'ours');

    // A cherry-pick onto a line that already touched the same file conflicts, which is
    // the state where git writes the marker.
    gitAllowingExit(repo, 'cherry-pick', theirs);
    expect(readOperations(resolveGitDir(repo)).map((o) => o.operation)).toEqual(['cherry-pick']);
    gitAllowingExit(repo, 'cherry-pick', '--quit');

    // A revert needs a line the inverse patch cannot apply to, which one divergent
    // commit supplies: the first attempt reverted straight onto the commit that
    // conflicted the cherry-pick and it applied CLEANLY, so the marker was absent and
    // the assertion below was reading nothing.
    writeFileSync(join(repo, 'f.txt'), 'third\n');
    git(repo, 'commit', '-am', 'third');
    gitAllowingExit(repo, 'revert', '--no-edit', theirs);
    expect(readOperations(resolveGitDir(repo)).map((o) => o.operation)).toEqual(['revert']);
    gitAllowingExit(repo, 'revert', '--quit');

    expect(readOperations(resolveGitDir(repo))).toEqual([]);
  });

  it('reports nothing for a worktree that has finished and been cleaned up', () => {
    // The false-positive direction, driven for real rather than asserted: a merge
    // that was completed and aborted must leave no marker, or every finished merge
    // in the repository would be reported forever.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    mergeThatConflicts(repo, 'theirs');
    git(repo, 'merge', '--abort');
    expect(readOperations(resolveGitDir(repo))).toEqual([]);
    expect(unmergedPaths(repo)).toEqual([]);
  });

  it('does not report MERGE_MSG on its own, because that file outlives the merge', () => {
    const repo = makeRepo();
    writeFileSync(join(resolveGitDir(repo), 'MERGE_MSG'), 'Merge branch x\n');
    // `MERGE_MSG` is written before the conflict and is the file git leaves behind
    // after `git merge --abort`. Reporting it would make every aborted merge in the
    // repository look like an operation in progress — which is precisely how a
    // report like this gets ignored.
    expect(readOperations(resolveGitDir(repo))).toEqual([]);
  });

  it('reports nothing for a directory that is not a git directory', () => {
    expect(readOperations(null)).toEqual([]);
    expect(readOperations(scratch())).toEqual([]);
    expect(readOperations('/nowhere/at/all')).toEqual([]);
  });

  it('consults the marker table rather than a hard-coded list', () => {
    // A mutation review replaced `readOperations`'s table loop with a literal copy of
    // the same seven rows and this test PASSED, because it read `OPERATION_MARKERS[0]`
    // — `MERGE_HEAD`, the first row a hard-coded list would also contain. It proved the
    // table has a first entry, not that the reader consults it.
    //
    // So this pushes a row git has never written onto the exported table and asserts
    // the reader reports it. A hard-coded list cannot see a row added after it was
    // written; this one can. Popped in a `finally` because the table is module state and
    // a leaked row would make every later case in this file report a phantom operation.
    const before = readOperations(makeGitDirWith({ GIT_EDITOR_HINT: null }));
    expect(before).toEqual([]);

    OPERATION_MARKERS.push({ operation: 'probe', file: 'PROBE_MARKER', value: true });
    try {
      expect(readOperations(makeGitDirWith({ PROBE_MARKER: 'probe-sha' }))).toEqual([
        { operation: 'probe', marker: 'PROBE_MARKER', value: 'probe-sha' },
      ]);
      // And the abort mapping follows the new row, so a row added to the table cannot
      // arrive without a remedy decision.
      expect(abortCommand({ operation: 'probe', marker: 'PROBE_MARKER' })).toBe('git probe --abort');
    } finally {
      OPERATION_MARKERS.pop();
    }
    expect(readOperations(makeGitDirWith({ PROBE_MARKER: 'probe-sha' }))).toEqual([]);
    expect(OPERATION_MARKERS.every((m) => m.file ?? m.dir)).toBe(true);
  });
});

describe('abortCommand names a command that exists', () => {
  it('uses the real abort flag for merge, cherry-pick and revert', () => {
    expect(abortCommand({ operation: 'merge', marker: 'MERGE_HEAD' })).toBe('git merge --abort');
    expect(abortCommand({ operation: 'cherry-pick', marker: 'CHERRY_PICK_HEAD' })).toBe('git cherry-pick --abort');
    expect(abortCommand({ operation: 'revert', marker: 'REVERT_HEAD' })).toBe('git revert --abort');
  });

  it('distinguishes `git am` from `git rebase`, because they do not share a remedy', () => {
    // Both rows of the table are operation `rebase`, and an earlier version took the
    // operation NAME, so `rebase-apply` — which `git am` writes — was told to run
    // `git rebase --abort`. Checked against the real binary rather than from memory:
    // this string is what an operator copies, and the failure mode is a fatal.
    expect(abortCommand({ operation: 'rebase', marker: 'rebase-merge' })).toBe('git rebase --abort');
    expect(abortCommand({ operation: 'rebase', marker: 'rebase-apply' })).toBe('git am --abort');
  });

  it('returns null for a squash, because git has no command that abandons one', () => {
    // Measured on a real conflicted `git merge --squash`: `git merge --abort` answers
    // "fatal: There is no merge to abort (MERGE_HEAD missing)" and `git squash` is not
    // a command. `null` says there is no remedy, which is actionable; any string here
    // would be a command to copy that fatals.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const result = spawnSync('git', ['merge', '--squash', 'theirs'], { cwd: repo, encoding: 'utf8', env: GIT_ENV });
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toMatch(/CONFLICT|Automatic merge failed/);
    writeFileSync(join(repo, 'f.txt'), 'a resolution nobody reviewed\n');
    git(repo, 'add', 'f.txt');
    expect(readOperations(resolveGitDir(repo)).map((o) => o.operation)).toEqual(['squash']);
    expect(() => git(repo, 'merge', '--abort')).toThrow(/no merge to abort/);
    expect(abortCommand({ operation: 'squash', marker: 'SQUASH_MSG' })).toBeNull();
  });

  it('uses `git bisect reset`, because `git bisect --abort` is not a command', () => {
    // Checked against the real binary rather than from memory, because a remedy that
    // does not work is worse than none: this string is what a reader copies.
    const repo = makeRepo();
    expect(() => git(repo, 'bisect', '--abort')).toThrow();
    expect(spawnSync('git', ['bisect', 'reset'], { cwd: repo, encoding: 'utf8' }).status).toBe(0);
  });

  it('is asserted for EVERY operation the table can report', () => {
    // The mutation that motivated this: replacing `abortCommand('bisect')` with the
    // wrong answer failed NOTHING, because the one test that proves `git bisect
    // --abort` does not exist never called the function. So this pins the output of
    // every reachable input rather than a hand-picked few, which is what makes a
    // change to the table or to the mapping fail here.
    expect(OPERATION_MARKERS.map((m) => abortCommand({ operation: m.operation, marker: m.file ?? m.dir }))).toEqual([
      'git merge --abort',
      null,
      'git cherry-pick --abort',
      'git revert --abort',
      'git rebase --abort',
      'git am --abort',
      'git bisect reset',
    ]);
  });
});

describe('scanRepository covers every registered worktree, not one', () => {
  it('includes a linked worktree beside the primary, with its own git directory', () => {
    const repo = makeRepo();
    const path = addWorktree(repo, 'linked');

    const found = scanRepository(repo).worktrees;
    // `realpathSync` on this side of the comparison, because git reports worktree
    // paths already resolved while `mkdtempSync` hands back the unresolved form.
    // On macOS `TMPDIR` is under `/var`, which is a symlink to `/private/var`, so
    // the two strings differ while the directories are the same — the identical trap
    // `main-worktree-guard.mjs` documents and the reason it normalises both sides.
    const asPaths = (entries) => entries.map((w) => realpathSync(w.path)).sort();
    expect(asPaths(found)).toEqual([realpathSync(repo), realpathSync(path)].sort());

    const primary = found.find((w) => realpathSync(w.path) === realpathSync(repo));
    const linked = found.find((w) => realpathSync(w.path) === realpathSync(path));
    // The primary's git dir is the repository's own; a linked worktree's is a
    // directory INSIDE it. A reader that assumed the first form for both would read
    // every linked worktree's state out of the shared `.git`, which is the primary's.
    expect(primary.gitDir).not.toBe(linked.gitDir);
    expect(linked.gitDir.startsWith(`${primary.gitDir}/worktrees/`)).toBe(true);
    expect(linked.branch).toBe('wt/linked');
  });

  it('finds a merge in a linked worktree while the primary is clean', () => {
    // The case the incident was: the merge is in one worktree and the reader stands
    // in another. A reader scoped to `process.cwd()` reports nothing, correctly and
    // uselessly.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = addWorktree(repo, 'linked');
    mergeThatConflicts(path, 'theirs');

    expect(unmergedPaths(repo)).toEqual([]);
    const found = findings(scanRepository(repo).worktrees);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('linked');
    expect(found[0].unmerged).toEqual(['f.txt']);
    expect(found[0].operations.map((o) => o.operation)).toEqual(['merge']);
  });

  it('reports a registration whose directory is gone, WITH the operations git left behind', () => {
    // The disposal case. `rm -rf` on a worktree mid-merge is what a runaway session
    // does, and `git worktree prune` then deletes `.git/worktrees/<name>/` with no
    // reflog entry and nothing for `git fsck` to recover. An earlier version reported
    // such a worktree as `operations: []` — arguing that reporting it beat dropping
    // it — and then dropped it one line later in `findings`, so the net behaviour was
    // the thing it argued against.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = addWorktree(repo, 'linked');
    git(path, 'checkout', '-B', 'wt/linked');
    mergeThatConflicts(path, 'theirs');
    rmSync(path, { recursive: true, force: true });

    const gone = scanRepository(repo).worktrees.find((w) => w.name === 'linked');
    expect(gone).toMatchObject({ present: false, readError: null });
    expect(gone.operations.map((o) => o.operation)).toEqual(['merge']);
    expect(findings([gone])).toHaveLength(1);
  });

  it('cannot report a registration whose git directory git itself has dropped', () => {
    // The limit of the roster, asserted rather than glossed: with BOTH the worktree
    // directory and its git directory gone, `git worktree list` omits the entry, so
    // there is nothing for `scanRepository` to report. That is git's contract for the
    // one query this module builds on, and the reason the worktree-directory-only case
    // above — where the git directory survives — is the one that matters: those state
    // files are what `git worktree prune` is about to delete, and they are still there
    // to be read.
    const repo = makeRepo();
    const path = addWorktree(repo, 'linked');
    rmSync(path, { recursive: true, force: true });
    rmSync(join(repo, '.git', 'worktrees', 'linked'), { recursive: true, force: true });
    expect(scanRepository(repo).worktrees.map((w) => w.name)).not.toContain('linked');
    expect(scanRepository(repo).worktrees).toHaveLength(1);

    // And the record shape the surviving case falls back to when nothing is readable
    // at all, which `findings` must still surface rather than treat as clean.
    const unreadable = {
      name: 'linked',
      path: '/gone',
      branch: null,
      present: false,
      gitDir: null,
      operations: [],
      unmerged: [],
      readError: 'the worktree directory and its git directory are both gone',
    };
    expect(findings([unreadable])).toHaveLength(1);
  });
});

describe('it fails closed on what it could not read', () => {
  it('refuses rather than reporting an unreadable repository as clean', () => {
    // The most dangerous arm of the whole module: `git worktree list` failing used to
    // yield exit 0 and the word "clean", so a stripped `.git`, a wrong `workdir` or a
    // transient git failure all produced a clean bill of health.
    const scanned = scanRepository(join(tmpdir(), 'definitely-not-a-repository-here'));
    expect(scanned.ok).toBe(false);
    expect(scanned.worktrees).toEqual([]);
  });

  it('reports a roster it could not read through `run`, on stderr, with exit 1', () => {
    const out = [];
    const err = [];
    const result = run({
      cwd: join(tmpdir(), 'definitely-not-a-repository-here'),
      out: { write: (s) => out.push(s) },
      err: { write: (s) => err.push(s) },
    });
    expect(result.code).toBe(1);
    expect(result.ok).toBe(false);
    expect(err.join('')).toContain('could not be read');
    expect(out.join('')).not.toContain('clean');
  });

  it('keeps reporting the rest when ONE worktree cannot be described', () => {
    // `readError` is a finding in its own right, and the other worktrees are still
    // reported: a reader that aborted on the first unreadable registration would hide
    // the merge that matters most behind the registration that could not be read.
    const readable = {
      name: 'ok',
      path: '/ok',
      branch: 'b',
      present: true,
      operations: [{ operation: 'merge', marker: 'MERGE_HEAD', value: 'abc' }],
      unmerged: ['f.txt'],
      readError: null,
    };
    const unreadable = {
      name: 'broken',
      path: '/broken',
      branch: null,
      present: true,
      operations: [],
      unmerged: [],
      readError: 'exit 129',
    };
    expect(findings([readable, unreadable])).toHaveLength(2);
    expect(findings([unreadable])[0]).toMatchObject({ name: 'broken', readError: 'exit 129', destructive: false });
  });
});

describe('findings separates the two shapes that need opposite remedies', () => {
  it('names a destructive abort only when there is an abortable operation', () => {
    const repo = makeRepo();
    const path = addWorktree(repo, 'linked');
    const unmergedOnly = {
      name: 'linked',
      path,
      branch: 'wt/linked',
      present: true,
      operations: [],
      unmerged: ['f.txt'],
    };
    // Unmerged paths with no marker is a real shape: `MERGE_HEAD` removed by hand,
    // or an `am` whose queue is gone. `git merge --abort` does nothing for it, so
    // the report has to say so rather than implying an abort would clean it up.
    expect(findings([unmergedOnly])[0]).toMatchObject({ destructive: false });

    const mergeInProgress = {
      ...unmergedOnly,
      operations: [{ operation: 'merge', marker: 'MERGE_HEAD', value: 'abc' }],
    };
    expect(findings([mergeInProgress])[0]).toMatchObject({ destructive: true });
  });

  it('does not call a bisect destructive, because there is nothing to discard', () => {
    const bisect = {
      name: 'w',
      path: '/w',
      branch: null,
      present: true,
      operations: [{ operation: 'bisect', marker: 'BISECT_LOG', value: null }],
      unmerged: [],
    };
    expect(findings([bisect])[0]).toMatchObject({ destructive: false });
  });

  it('leaves a clean worktree out of the findings', () => {
    expect(findings([{ name: 'w', path: '/w', present: true, operations: [], unmerged: [], readError: null }])).toEqual(
      []
    );
  });

  it('keeps a registration whose directory is gone but whose merge is still recorded', () => {
    // The reversal of the earlier behaviour, and the reason it is a finding at all:
    // the worktree is unreadable AS A DIRECTORY, but its git directory still holds the
    // `MERGE_HEAD` that `git worktree prune` is about to delete.
    const gone = {
      name: 'gone',
      path: '/gone',
      branch: null,
      present: false,
      operations: [{ operation: 'merge', marker: 'MERGE_HEAD', value: 'abc' }],
      unmerged: [],
      readError: null,
    };
    expect(findings([gone])).toHaveLength(1);
    expect(findings([gone])[0]).toMatchObject({ destructive: true });
  });
});

describe('the report says which remedy applies, and warns about the destructive one', () => {
  it('reports a clean repository without printing a hazard', () => {
    const repo = makeRepo();
    const r = report(repo);
    expect(r.code).toBe(0);
    expect(r.out).toContain('clean');
    expect(r.err).toBe('');
  });

  it('warns that aborting a resolved merge throws the resolution away', () => {
    // The audit's own case: conflicts all resolved, nothing committed. `git commit`
    // lands an unattended resolution and `git merge --abort` destroys it, so a
    // report that printed only "1 worktree is mid-merge" would be sending the reader
    // to choose between two bad outcomes with no information.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    mergeThatConflicts(repo, 'theirs');
    writeFileSync(join(repo, 'f.txt'), 'a resolution nobody reviewed\n');
    git(repo, 'add', 'f.txt');

    const r = report(repo);
    expect(r.code).toBe(1);
    expect(r.err).toContain('CAREFUL');
    expect(r.err).toContain('DISCARDS resolution state');
    expect(r.err).toContain('git merge --abort');
    // The resolved index has nothing unmerged left, which is exactly why the
    // warning has to come from the operation marker rather than from the path count.
    expect(r.err).not.toContain('unmerged in the index');
    expect(unmergedPaths(repo)).toEqual([]);
  });

  it('names the unmerged paths and says a marker-less one is not cleaned by abort', () => {
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = addWorktree(repo, 'linked');
    // The merge is started IN the linked worktree, so the conflict belongs to it, and
    // then `MERGE_HEAD` is removed by hand — the shape a half-finished `git merge
    // --quit`, a hand-unwound merge, or an `am` with a gone queue leaves behind.
    git(path, 'checkout', '-B', 'wt/linked');
    mergeThatConflicts(path, 'theirs');
    rmSync(join(resolveGitDir(path), 'MERGE_HEAD'), { force: true });

    const r = report(repo);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no operation marker');
    expect(r.err).toContain('f.txt');
    // The line NAMES the command while saying it will not work, so the assertion is
    // on the warning and the remedy block, not on the command being absent: naming
    // it is the useful part, because the reader's first instinct is to run it.
    expect(r.err).toContain('no `git merge --abort` will clean this up');
    expect(r.err).not.toContain('CAREFUL');
    expect(r.err).not.toContain('DISCARDS resolution state');
  });

  it('emits findings as JSON with no prose mixed in', () => {
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    mergeThatConflicts(repo, 'theirs');

    const out = [];
    const err = [];
    const code = run({
      cwd: repo,
      json: true,
      out: { write: (s) => out.push(s) },
      err: { write: (s) => err.push(s) },
      exit: () => {},
    }).code;

    expect(code).toBe(1);
    // A caller parsing this cannot also be reading a warning it did not ask for.
    expect(err).toEqual([]);
    const doc = JSON.parse(out.join(''));
    expect(doc.scanned).toBe(1);
    expect(doc.findings[0]).toMatchObject({
      name: expect.any(String),
      operations: [{ operation: 'merge' }],
      unmerged: ['f.txt'],
    });
  });
});

describe("the third review's findings, pinned", () => {
  it('finds the administrative directory of a dot-prefixed worktree, whose name git sanitises', () => {
    // Git rewrites a LEADING `.` to `-` in the administrative directory name, so
    // `basename(path)` is the wrong key for every dot-prefixed worktree. The first
    // version of this lookup derived `<common>/worktrees/<basename>`, which does not
    // exist for these — and reported `readError`, the same "could not look" it uses for
    // a worktree that really is gone. The match is made against the `gitdir` file's
    // contents instead, so it cannot depend on a naming rule.
    const repo = makeRepo();
    const dir = join(scratch(), '.hidden');
    git(repo, 'worktree', 'add', '-b', 'wt/dot', dir);
    expect(basename(resolveAdminDirFor(resolveCommonDir(repo), dir))).toBe('-hidden');
    expect(resolveAdminDirFor(resolveCommonDir(repo), dir)).not.toBeNull();
  });

  it("does not match one worktree's administrative directory to another", () => {
    const repo = makeRepo();
    const a = addWorktree(repo, 'one');
    const b = addWorktree(repo, 'two');
    expect(resolveAdminDirFor(resolveCommonDir(repo), a)).not.toBe(resolveAdminDirFor(resolveCommonDir(repo), b));
    expect(resolveAdminDirFor(resolveCommonDir(repo), join(scratch(), 'never-existed'))).toBeNull();
  });

  it('refuses rather than reporting an empty roster as clean', () => {
    // The previous version of this case asserted `ok: true` and
    // `worktrees.length > 0` — the opposite of its own title — and its `findings([])`
    // line could not fail, because `findings` filters. Neither drove the
    // `entries.length === 0` branch the name promises.
    //
    // Driving it needs a git whose `worktree list` succeeds and answers with nothing,
    // which no real repository does. So the roster reader is driven directly, and the
    // scan's own empty-parse guard is asserted on the real repository as a floor.
    expect(parseWorktreeListing('')).toEqual([]);
    // Attributes before any `worktree` record must not INVENT one. The first version of
    // this case expected `[{ path: null }]` here, which would have made a lost record
    // look like a worktree at the filesystem root.
    expect(parseWorktreeListing('detached\0bare\0')).toEqual([]);
    expect(parseWorktreeListing('HEAD abc123\0branch refs/heads/main\0')).toEqual([]);

    const scanned = scanRepository(makeRepo());
    expect(scanned.ok).toBe(true);
    expect(scanned.worktrees).toHaveLength(1);
  });

  it('records an unmerged read that failed instead of throwing out of the scan', () => {
    // `unmergedPaths` throws on a non-zero exit by design, and `scanRepository` has to
    // catch it: the first version let it escape, which killed the report for every
    // worktree over one unreadable registration and contradicted the module's own
    // docstring.
    //
    // A mutation review DELETED that try/catch and this test still passed, because the
    // body drove a healthy merge and asserted `readError === null` — which is what a
    // guarded healthy read returns too. So it now drives a FAILING reader, which is
    // what the guard exists for; deleting the guard makes it throw.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = addWorktree(repo, 'linked');
    git(path, 'checkout', '-B', 'wt/linked');
    mergeThatConflicts(path, 'theirs');

    const boom = () => {
      throw new Error('Command failed: git diff --name-only --diff-filter=U -z');
    };
    const found = scanRepository(repo, { unmergedOf: boom }).worktrees.find(
      (w) => realpathSync(w.path) === realpathSync(path)
    );
    // The operation is still known — that is the point of recording rather than throwing.
    expect(found.operations.map((o) => o.operation)).toEqual(['merge']);
    expect(found.unmerged).toEqual([]);
    expect(found.readError).toMatch(/diff-filter=U/);
    // And it survives into the report, rather than the worktree being lost.
    expect(findings([found])).toHaveLength(1);
  });

  it('names a discard command that discards, and never `git bisect reset`', () => {
    // The CAREFUL line regressed once: it went back to filtering operations rather than
    // reusing `destructive`, so a bisect beside a merge printed `git bisect reset` under a
    // heading saying it DISCARDS resolution state. Restoring the old filter failed zero
    // tests, which is why this is pinned on the OUTPUT rather than on the implementation.
    const both = {
      name: 'w',
      path: '/w',
      branch: null,
      present: true,
      operations: [
        { operation: 'bisect', marker: 'BISECT_LOG', value: null },
        { operation: 'merge', marker: 'MERGE_HEAD', value: 'abc123' },
      ],
      unmerged: ['f.txt'],
      readError: null,
    };
    const r = report(() => [both]);
    expect(r.err).toContain('CAREFUL');
    expect(r.err).toContain('git merge --abort');
    expect(r.err).not.toContain('git bisect reset');
  });

  it('advises on a squash beside a bisect, where the earlier branch gave up', () => {
    // The else-branch used `every(op => abortCommand(op) === null)`, which a bisect
    // fails because it returns a string — so this shape printed no advice at all.
    const shape = {
      name: 'w',
      path: '/w',
      branch: null,
      present: true,
      operations: [
        { operation: 'squash', marker: 'SQUASH_MSG', value: null },
        { operation: 'bisect', marker: 'BISECT_LOG', value: null },
      ],
      unmerged: [],
      readError: null,
    };
    const r = report(() => [shape]);
    expect(r.err).not.toContain('CAREFUL');
    expect(r.err).toMatch(/decide by hand/);
  });

  it('advises on a bisect alone, which has no discard command to name', () => {
    const bisect = {
      name: 'w',
      path: '/w',
      branch: null,
      present: true,
      operations: [{ operation: 'bisect', marker: 'BISECT_LOG', value: null }],
      unmerged: [],
      readError: null,
    };
    expect(report(() => [bisect]).err).toMatch(/decide by hand/);
  });

  it('says which operation git cannot abandon, and does not claim there is no marker', () => {
    const squash = {
      name: 'w',
      path: '/w',
      branch: null,
      present: true,
      operations: [{ operation: 'squash', marker: 'SQUASH_MSG', value: null }],
      unmerged: ['f.txt'],
      readError: null,
    };
    const r = report(() => [squash]);
    expect(r.err).toMatch(/None of these has a command that would discard/);
    expect(r.err).not.toContain('git squash --abort');
  });
});

describe('the roster cannot be trusted on its own', () => {
  it('reports a worktree whose administrative directory git can no longer describe', () => {
    // Found by a review with a single `chmod`, and it is the worst failure this module
    // can have: `chmod 000 <gitdir>/worktrees/<name>` makes `git worktree list
    // --porcelain` OMIT the registration entirely — the roster silently shrank from
    // three entries to two — while `MERGE_HEAD` sat in the directory that had just
    // become unreadable. The report said "clean" and exited 0, which is the one output
    // this module exists to never produce, and it falsified both `scanRepository`'s
    // docstring and the sentence in `docs/ORCHESTRATION.md` about reporting a worktree
    // it could not describe as unreadable rather than clean.
    //
    // `chmod` rather than a stub because the whole point is that git's OWN roster
    // command loses the entry; an injected reader could only prove the cross-check runs,
    // not that it has anything to catch.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = addWorktree(repo, 'hidden');
    git(path, 'checkout', '-B', 'wt/hidden');
    mergeThatConflicts(path, 'theirs');

    const before = scanRepository(repo).worktrees;
    expect(before.map((w) => w.name)).toContain('hidden');

    const adminDir = join(repo, '.git', 'worktrees', 'hidden');
    chmodSync(adminDir, 0o000);
    try {
      // git itself has now lost it. Asserted, because the rest of the case means nothing
      // if the roster were still complete.
      expect(
        spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout
      ).not.toContain('hidden\n');

      const after = scanRepository(repo);
      const found = after.worktrees.find((w) => w.name === 'hidden');
      expect(found, 'the cross-check must re-add what git dropped').toBeDefined();
      // A `chmod 000` makes the state genuinely unreadable, so the honest answer is NOT
      // a recovered `MERGE_HEAD` — it is "here is a registration, and I could not read
      // it". Claiming the merge was found when it was not would be the same defect in
      // the opposite direction.
      expect(found.operations).toEqual([]);
      expect(found.readError).toMatch(/unreadable/);
      const reported = findings(after.worktrees);
      expect(reported).toHaveLength(1);
      expect(reported[0].name).toBe('hidden');
    } finally {
      chmodSync(adminDir, 0o755);
    }
  });

  it('round-trips a worktree path containing a newline, which the roster does not quote', () => {
    // `git worktree list --porcelain` does NOT quote its paths, so a worktree at
    // `…/wt\nwith-newline` came back as two records and the path was truncated at the
    // newline. The live worktree then read as absent, the tool stated as FACT that git
    // had dropped state still sitting on disk, and the record for the worktree actually
    // holding the merge never existed. This is the trap `unmergedPaths` documents for
    // `git status --porcelain`, in the same module, and the first version had both.
    const repo = addConflictingBranch(makeRepo(), 'theirs');
    const path = join(scratch(), 'wt\nwith-newline');
    git(repo, 'worktree', 'add', '-qb', 'wt/newline', path);
    git(path, 'checkout', '-q', '-B', 'wt/newline');
    mergeThatConflicts(path, 'theirs');

    const found = scanRepository(repo).worktrees.find((w) => w.path.includes('\n'));
    expect(found, 'the newline path must survive parsing').toBeDefined();
    expect(found.path).toBe(realpathSync(path));
    expect(found.present).toBe(true);
    expect(found.operations.map((o) => o.operation)).toEqual(['merge']);
    expect(found.unmerged).toEqual(['f.txt']);
  });

  it('reports how many administrative directories the roster accounted for', () => {
    // The cross-check needs a floor to compare against, and a reader that wants to know
    // whether every admin directory was matched gets it here rather than by counting.
    const scanned = scanRepository(makeRepo());
    // One admin directory per LINKED worktree; the primary has none of its own.
    expect(scanned.roster).toBe(scanned.worktrees.length);
    expect(scanned.adminDirs).toBe(0);
  });

  it('does not run the work-tree-only probe against a bare repository', () => {
    // A bare repository is a first-class git layout — what a mirror lives in — and its
    // only roster entry has no working tree, so `git diff --diff-filter=U` answers
    // "fatal: this operation must be run in a work tree" on every run. The tool was
    // therefore permanently red in a valid configuration, which is this module's own
    // stated reason for not being a hook: a report that is always red gets bypassed.
    const bare = join(scratch(), 'mirror.git');
    spawnSync('git', ['init', '--quiet', '--bare', bare], { encoding: 'utf8' });
    const scanned = scanRepository(bare);
    expect(scanned.ok).toBe(true);
    expect(scanned.worktrees).toHaveLength(1);
    expect(scanned.worktrees[0].bare).toBe(true);
    expect(scanned.worktrees[0].readError).toBeNull();
    expect(findings(scanned.worktrees)).toEqual([]);
  });

  it('still reports an operation in a bare repository, because that state is readable', () => {
    // The probe is skipped, not the reading: `MERGE_HEAD` in a bare git directory is
    // still `MERGE_HEAD`.
    const bare = join(scratch(), 'mid-merge.git');
    spawnSync('git', ['init', '--quiet', '--bare', bare], { encoding: 'utf8' });
    writeFileSync(join(bare, 'MERGE_HEAD'), 'deadbeef');
    const scanned = scanRepository(bare);
    expect(scanned.worktrees[0].operations).toEqual([{ operation: 'merge', marker: 'MERGE_HEAD', value: 'deadbeef' }]);
    expect(findings(scanned.worktrees)).toHaveLength(1);
  });
});
