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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OPERATION_MARKERS,
  abortCommand,
  findings,
  readOperations,
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

  it('reports a cherry-pick and a revert, each from real git', () => {
    // Both rows existed in the table with NO real-git assertion — removing either one
    // failed nothing, which a test that hand-writes the marker could not have caught.
    const repo = makeRepo();
    const markerFile = { 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' };

    for (const operation of ['cherry-pick', 'revert']) {
      const marker = markerFile[operation];
      writeFileSync(join(resolveGitDir(repo), marker), 'x');
      expect(readOperations(resolveGitDir(repo)).map((o) => o.operation)).toEqual([operation]);
      rmSync(join(resolveGitDir(repo), marker), { force: true });
    }
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

  it('derives its marker set from the table, so a marker git adds is covered by data', () => {
    // The table is the part of this module that has to track git. A reader that
    // hard-coded the filenames would report every operation correctly today and
    // silently miss the next one git adds — so this proves the READER consults the
    // table, by adding an entry git does not have and seeing it reported.
    const before = readOperations(makeGitDirWith({ GIT_EDITOR_HINT: null }));
    expect(before).toEqual([]);

    const marker = OPERATION_MARKERS[0];
    expect(readOperations(makeGitDirWith({ [marker.file]: 'abc123' }))).toEqual([
      { operation: marker.operation, marker: marker.file, value: 'abc123' },
    ]);
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
    let code = null;
    const result = run({
      cwd: join(tmpdir(), 'definitely-not-a-repository-here'),
      out: { write: (s) => out.push(s) },
      err: { write: (s) => err.push(s) },
      exit: (c) => {
        code = c;
      },
    });
    expect(code).toBe(1);
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
  /** Capture both streams and the exit code, so the assertions read what an operator reads. */
  function report(cwd) {
    const out = [];
    const err = [];
    let code = null;
    // `run` calls `exit` and then RETURNS its own code, so recording the argument is
    // enough and the stub must not throw: a stub that threw would replace the report
    // this test exists to read with a stack trace about the stub.
    const result = run({
      cwd,
      out: { write: (s) => out.push(s) },
      err: { write: (s) => err.push(s) },
      exit: (c) => {
        code = c;
      },
    });
    // `run` calls `exit` ONLY on the refusing path, so the stub and the returned code
    // can only be compared when the stub fired. Asserting they always agree would
    // demand that a clean report call `exit(0)`, which would end the process.
    if (code !== null) expect(code).toBe(result.code);
    return { out: out.join(''), err: err.join(''), code: result.code };
  }

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
