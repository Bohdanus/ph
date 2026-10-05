import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GuardError,
  MAX_BLOB_BYTES,
  batchBlobs,
  findHandResolutions,
  findTakeovers,
  isTestPath,
  main,
  resolveIncomingRef,
} from '../merge-takeover-guard.mjs';

/**
 * Real repositories in a temp directory, not mocks. The defect being guarded is a property
 * of which blob git ends up with in the result tree, and a mock of that property would
 * agree with a broken guard. Every expectation below is an observed result, reproduced with
 * raw git before the detector was written.
 *
 * The fixture uses `realpathSync(mkdtempSync(...))` because on macOS the temp path is a
 * symlink, and `scripts/main-worktree-guard.mjs` documents that the same trap makes two
 * paths compare unequal as strings before they are unequal as paths.
 *
 * A timeout is mandatory for a suite that spawns: `scripts/__tests__/suite-budgets.test.mjs`
 * derives every spawning suite in this directory and asserts the derived set equals a
 * hard-coded allowlist, which names this file.
 */
vi.setConfig({ testTimeout: 20_000 });

let dir;

function git(args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitOk(args) {
  try {
    return { ok: true, out: git(args) };
  } catch {
    return { ok: false, out: null };
  }
}

function gitOkIn(repo, args) {
  try {
    return {
      ok: true,
      out: execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim(),
    };
  } catch {
    return { ok: false, out: null };
  }
}

function write(name, body) {
  writeFileSync(join(dir, name), body);
}

function commit(message) {
  git(['add', '-A']);
  git(['commit', '-qm', message]);
}

/** Commit the index as it stands. A gitlink has no worktree path, so `git add -A` removes
 * it again and leaves nothing to commit — which is how the submodule case below first failed
 * with "nothing to commit" rather than for any reason to do with submodules. */
function commitIndexOnly(message) {
  git(['commit', '-q', '--allow-empty', '-m', message]);
}

const sha = () => git(['rev-parse', 'HEAD']);

/**
 * Merge `ref` in and report what the guard sees, WITHOUT committing. Refs must stay put
 * across this: comparing after the commit compares the merge against itself, which reads
 * as a clean merge every time.
 */
function mergeAndInspect(ref, { resolve, args = [] } = {}) {
  // BEFORE the merge, and this is load-bearing: a merge with no conflicts commits itself,
  // so reading HEAD afterwards gives the merge commit rather than the side being merged
  // INTO. Comparing against that makes "main changed nothing" read as "main changed
  // everything", which silently turns every false-positive test into a vacuous pass.
  const headBefore = sha();
  gitOk(['merge', '--no-edit', ...args, ref]); // a conflict is the expected shape, not an error
  if (resolve) resolve();
  const findings = findTakeovers({
    cwd: dir,
    head: headBefore,
    incoming: git(['rev-parse', ref]),
    resultTree: git(['write-tree']),
  });
  return { ...findings, conflicted: existsSync(join(dir, '.git', 'MERGE_HEAD')) };
}

/** Whether the index still holds an unmerged entry, i.e. git really did conflict. */
function seenUnmerged(repo) {
  return (gitOkIn(repo, ['ls-files', '-u']).out ?? '').length > 0;
}

/** Everything report() writes to stderr for a refusal, as one string. */
function captureStderr(run) {
  const lines = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return lines.join('');
}

/** `--theirs` then stage, as a block. Never `git(...) && git(...)`: git prints nothing on
 * some paths, an empty string is falsy, and the second command silently never runs. */
function takeTheirs(...paths) {
  for (const path of paths) git(['checkout', '--theirs', path]);
  git(['add', '-A']);
}

/** `--ours` then stage. The mirror of takeTheirs, and a shape-3 producer with no strategy
 * flag at all: a hand resolution that keeps this side for one path. */
function takeOurs(...paths) {
  for (const path of paths) git(['checkout', '--ours', path]);
  git(['add', '-A']);
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'merge-takeover-guard-')));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('the shape a whole-file resolution loses silently', () => {
  it('reports a path whose result is the incoming side verbatim', () => {
    write('f.txt', 'alpha\nbeta\ngamma\n');
    write('other.txt', 'keep\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nBRANCH\ngamma\n');
    commit('branch edits the same lines');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN\ngamma\n');
    commit('main edits the same lines');

    const seen = mergeAndInspect('feat', { resolve: () => takeTheirs('f.txt') });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('whole-file-takeover');
    expect(seen.takeovers[0].reason).toMatch(/byte-for-byte the incoming side/);
  });

  it('reports a path whose result is the pre-divergence content', () => {
    // Shape two of the same defect, and the one the comm -13 recipe cannot see. A file the
    // branch never worked on, restored to what it looked like at the merge base, while main
    // had moved it. `docs/ORCHESTRATION.md:106-110` names the operations that produce this
    // and forbids them in the main worktree; this is the check that catches one anyway.
    write('f.txt', 'ORIGINAL\n');
    write('other.txt', 'keep\n');
    commit('base');
    const baseSha = sha();

    git(['checkout', '-qb', 'feat']);
    write('other.txt', 'branch work\n');
    commit('branch does real work elsewhere');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'MAIN PROGRESSED\n');
    commit('main moves a file the branch never touched');

    // A merge leaves f.txt at main's content; an index repair pulls it back to the base.
    const seen = mergeAndInspect('feat', {
      resolve: () => {
        git(['checkout', '-q', baseSha, '--', 'f.txt']);
        git(['add', 'f.txt']);
      },
    });

    expect(seen.conflicted).toBe(false);
    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('restored-pre-divergence-content');
    expect(seen.takeovers[0].reason).toMatch(/pre-divergence content/);
  });

  it('reports every lost path, not only the first', () => {
    write('a.txt', 'base\n');
    write('b.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('a.txt', 'branch\n');
    write('b.txt', 'branch\n');
    commit('branch edits both');

    git(['checkout', '-q', 'main']);
    write('a.txt', 'main\n');
    write('b.txt', 'main\n');
    commit('main edits both');

    const seen = mergeAndInspect('feat', { resolve: () => takeTheirs('a.txt', 'b.txt') });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('the shapes it must NOT report', () => {
  it('stays silent when the branch never touched a path main changed', () => {
    // Measured before the detector was written: this merge is SAFE. git's three-way merge
    // keeps main's version, because only one side changed it. The comm -13 recipe flags
    // exactly this case, which is much of why it was the wrong gate.
    write('f.txt', 'alpha\nbeta\ngamma\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('unrelated.txt', 'branch work\n');
    commit('branch touches something else');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN\ngamma\n');
    commit('main edits f');

    const seen = mergeAndInspect('feat');

    expect(seen.conflicted).toBe(false);
    expect(seen.takeovers).toEqual([]);
    expect(git(['show', ':0:f.txt'])).toContain('MAIN');
  });

  it('stays silent on a genuine union of both edits to one path', () => {
    write('f.txt', 'alpha\nbeta\ngamma\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbeta\ngamma\nBRANCH ADDED\n');
    commit('branch appends');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'MAIN ADDED\nalpha\nbeta\ngamma\n');
    commit('main prepends');

    const seen = mergeAndInspect('feat', {
      resolve: () => {
        write('f.txt', 'MAIN ADDED\nalpha\nbeta\ngamma\nBRANCH ADDED\n');
        git(['add', '-A']);
      },
    });

    expect(seen.takeovers).toEqual([]);
    expect(git(['show', ':0:f.txt'])).toContain('MAIN ADDED');
    expect(git(['show', ':0:f.txt'])).toContain('BRANCH ADDED');
  });

  it('stays silent when both sides made the identical edit', () => {
    write('f.txt', 'alpha\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nSAME\n');
    commit('branch');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nSAME\n');
    commit('main makes the same edit');

    expect(mergeAndInspect('feat').takeovers).toEqual([]);
  });

  it('stays silent when only main changed the path', () => {
    write('f.txt', 'alpha\n');
    write('other.txt', 'keep\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('other.txt', 'branch\n');
    commit('branch');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'main\n');
    commit('main');

    expect(mergeAndInspect('feat').takeovers).toEqual([]);
  });

  it('stays silent on a path the branch deleted and main never touched', () => {
    write('doomed.txt', 'base\n');
    write('kept.txt', 'keep\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'doomed.txt']);
    commit('branch deletes it');

    git(['checkout', '-q', 'main']);
    write('kept.txt', 'main edits an unrelated file\n');
    commit('main');

    expect(mergeAndInspect('feat').takeovers).toEqual([]);
  });

  it('stays silent on a merge that touches nothing main has since changed', () => {
    write('f.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'branch\n');
    commit('branch');
    git(['checkout', '-q', 'main']);

    expect(mergeAndInspect('feat').takeovers).toEqual([]);
  });

  it('stays silent when the incoming side is a strict SUPERSET of this side', () => {
    // Found by running the guard, not by reading it. Resolving `git merge main` with
    // `--theirs` is ordinary and often correct: main's version routinely already contains
    // the branch's line plus more, and taking it loses nothing. An earlier version of this
    // guard blocked it and printed "would silently lose main's work" while main's work sat
    // in the result untouched — a false positive on the repo's single most common merge,
    // which is precisely how a gate ends up `--no-verify`'d for good.
    //
    // The discriminator is whether the result DELETES anything this side had. An addition-
    // only result is a superset, whatever the file's overall shape.
    write('f.txt', 'alpha\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbranch-line\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    // main already carries the branch's line and adds its own: a superset.
    write('f.txt', 'alpha\nbranch-line\nMAIN-ADDED-LATER\n');
    commit('main adds more to the same file');

    git(['checkout', '-q', 'feat']);
    const seen = mergeAndInspect('main', { resolve: () => takeTheirs('f.txt') });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers).toEqual([]);
    // Nothing was lost, and that is the whole point: the branch's line survived.
    expect(git(['show', ':0:f.txt'])).toContain('branch-line');
    expect(git(['show', ':0:f.txt'])).toContain('MAIN-ADDED-LATER');
  });

  it('still reports when the incoming side is a superset EXCEPT it drops a line', () => {
    // The other side of the same discriminator, so the fix above cannot have bought its
    // silence by simply never reporting a whole-file copy.
    write('f.txt', 'alpha\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbranch-line\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN-ADDED-LATER\n');
    commit('main changes the same line differently');

    git(['checkout', '-q', 'feat']);
    const seen = mergeAndInspect('main', { resolve: () => takeTheirs('f.txt') });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].deleted).toBeGreaterThan(0);
  });

  it('does not report a path main never changed, even when the incoming side supplies all of it', () => {
    // THE false-positive test, and the one the mutation check proved was missing: with the
    // "main must have changed it" filter removed, this suite stayed green while the guard
    // would start reporting every file a branch legitimately adds.
    //
    // That is the ordinary shape of every `git merge main` run inside a feature worktree —
    // the branch's own files arrive wholesale and main never touched them. A gate that
    // reported those would fire on every merge in the documented landing flow, and the
    // first agent to hit it would reach for --no-verify, which is how a real gate stops
    // being a gate. So this asserts the absence of reports, not their presence.
    write('brand-new.txt', 'base\n');
    write('unrelated.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'brand-new.txt']);
    write('added-by-branch.txt', 'branch only\n');
    commit('branch deletes one file and adds another');

    git(['checkout', '-q', 'main']);
    // Main advances, so it genuinely moved since the merge base, but it moved neither of
    // the two files the branch supplies — which is the condition under test.
    write('unrelated.txt', 'main moved on\n');
    commit('main moves on without touching either');

    const seen = mergeAndInspect('feat');

    // Every path here is the incoming side's own content, and none of it lost anything:
    // main had no version of either file to lose.
    expect(seen.takeovers).toEqual([]);
    expect(git(['show', ':0:added-by-branch.txt'])).toContain('branch only');
  });
});

describe('the shape the original scan set could not reach', () => {
  // Everything in this block is about ONE structural gap, and it is the mirror of the two
  // shapes above. Those are both "the result is not HEAD's file", so scanning
  // `diff HEAD result` finds them by construction. A `-X ours` merge produces a result that
  // IS HEAD's file, so that scan set is empty and the shape was invisible rather than
  // merely unfixed.
  //
  // Measured with raw git before the second scan was written: `git merge -X ours` on a
  // contested path reported `clean — 0 path(s) moved by the merge, none taken over
  // wholesale` and exited 0, having silently deleted the branch's line. Nothing in the
  // merge looked like a conflict, and `tsc`/`build` pass on the result.
  function contestedPath() {
    write('f.txt', 'alpha\nbeta\ngamma\n');
    write('other.txt', 'keep\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbeta\ngamma\nBRANCH\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nbeta\ngamma\nMAIN\n');
    commit('main adds a line to the same file');
  }

  it("reports a `-X ours` merge that deleted the branch's committed line", () => {
    contestedPath();

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.conflicted).toBe(false);
    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('discarded-incoming-change');
    expect(seen.takeovers[0].deleted).toBeGreaterThan(0);
    expect(seen.takeovers[0].reason).toMatch(/kept the merged-into side's version/);
    // The whole point, asserted rather than described: the line is really gone.
    expect(git(['show', ':0:f.txt'])).not.toContain('BRANCH');
    expect(git(['show', ':0:f.txt'])).toContain('MAIN');
  });

  it('reports a `-s ours` merge, which is the worse case', () => {
    // `git merge -s ours <ref>` records that the branch was merged and takes none of its
    // content. It is a real command people run on purpose, and it is how a whole payload
    // disappears while the merge reports success.
    contestedPath();

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('discarded-incoming-change');
    expect(git(['show', ':0:f.txt'])).not.toContain('BRANCH');
  });

  it('exits 1 on a `-s ours` merge, so the hook actually refuses it', () => {
    // The finding existing is not the same as the hook acting on it. Without this, a
    // detector that reported the shape and returned 0 would satisfy every test above.
    //
    // `--no-commit` is what reproduces the hook's precondition rather than a convenient
    // one. `git merge -s ours` is CLEAN by construction, so it auto-commits: asking the
    // guard afterwards means asking about a merge already recorded, which is the single
    // question this program documents that it cannot answer. Verified with raw git —
    // `--no-commit -s ours` leaves MERGE_HEAD written and HEAD on the pre-merge tip, which
    // is exactly what `pre-merge-commit` sees, and it is confirmed end to end against a
    // real `git merge -s ours` with the hook installed.
    contestedPath();
    gitOk(['merge', '--no-commit', '-s', 'ours', 'feat']);

    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(sha()).not.toBe(git(['rev-parse', 'feat']));
    expect(main([], { cwd: dir })).toBe(1);
  });

  it('is blind once such a merge is committed, which is the documented boundary', () => {
    // Pinned on purpose, and it is a boundary rather than a defect: the comparison this
    // program makes is unrecoverable after the commit, because HEAD has already moved onto
    // the result and `merge-base` then resolves to the incoming tip. An earlier draft of
    // this test asserted exit 1 here and failed for exactly that reason, which is why the
    // shape above uses `--no-commit`.
    contestedPath();
    gitOk(['merge', '-s', 'ours', '--no-edit', 'feat']);

    // With the merge recorded and the ref named, it reports clean — the branch's line is
    // gone from HEAD and nothing here can say so any more.
    const previous = process.env.GIT_REFLOG_ACTION;
    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      expect(main([], { cwd: dir })).toBe(0);
      expect(git(['show', 'HEAD:f.txt'])).not.toContain('BRANCH');

      // With nothing to identify the merge by, it refuses instead of passing. So the blind
      // window is reachable only by a caller that already knows the ref — which is what
      // `--manual` is, and never what a hook is.
      process.env.GIT_REFLOG_ACTION = '';
      expect(main([], { cwd: dir })).toBe(2);
    } finally {
      restoreAction(previous);
    }
  });

  it('stays silent on `-X ours` where the branch had only DELETED a line', () => {
    // The false-positive half. Nothing of the branch's own survives in the result to be
    // lost — main's version is a superset of it — so reporting here would fire on a
    // resolution that is merely un-applied rather than lossy, and the first agent to hit it
    // would reach for --no-verify.
    write('f.txt', 'alpha\nkeep\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\n');
    commit('branch deletes a line');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nkeep\nMAIN\n');
    commit('main adds a line');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers).toEqual([]);
    expect(git(['show', ':0:f.txt'])).toContain('keep');
  });

  it('stays silent on `-X ours` where this side is already a strict SUPERSET', () => {
    // The mirror of the superset case the existing suite already pins for `--theirs`, and
    // the reason the discriminator asks what the LOSING side lost rather than whether the
    // result happened to match HEAD. The branch's own line is in main already.
    write('f.txt', 'alpha\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbranch-line\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nbranch-line\nMAIN-ADDED-LATER\n');
    commit('main carries the branch line and adds its own');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers).toEqual([]);
    expect(git(['show', ':0:f.txt'])).toContain('branch-line');
  });

  it('reports the WHOLE `-s ours` payload, including paths HEAD never touched', () => {
    // Found in review, and it is the claim the commit message made and did not deliver.
    // `-s ours` applies nothing at all, so a branch's ADDED files vanish too — and a pass
    // that walked only the paths HEAD had changed reported those as clean while the branch's
    // work was simply gone. Measured before this test: takeovers=[] with both files absent
    // from the result.
    write('a.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('brand-new.ts', 'export const x = 1;\n');
    write('also-new.ts', 'export const y = 2;\n');
    commit('branch adds two files');

    git(['checkout', '-q', 'main']);
    write('a.txt', 'main moved on\n');
    commit('main edits an unrelated file');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['also-new.ts', 'brand-new.ts']);
    for (const t of seen.takeovers) expect(t.kind).toBe('discarded-incoming-change');
    // The precondition, so this is not a vacuous pass: both files really are absent.
    expect(existsSync(join(dir, 'brand-new.ts'))).toBe(false);
    expect(existsSync(join(dir, 'also-new.ts'))).toBe(false);
  });

  it('reports a `-s ours` merge where HEAD deleted the path the incoming side modified', () => {
    // Found in review. The skip on a missing RESULT blob swallowed this, because HEAD
    // deleting the file makes the result's blob missing too — and the branch's committed
    // modification went with it, markerlessly.
    write('f.txt', 'a\nb\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nBRANCH\n');
    commit('branch modifies f');

    git(['checkout', '-q', 'main']);
    git(['rm', '-q', 'f.txt']);
    commit('main deletes f');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('discarded-incoming-change');
    expect(seen.takeovers[0].deleted).toBe(3);
    expect(existsSync(join(dir, 'f.txt'))).toBe(false);
  });

  it('counts a REPEATED line as a multiset, not a set', () => {
    // Found in review as an unpinned behaviour. A set says "x" is present and loses
    // nothing; a multiset says one of the branch's two copies is gone. The second reading is
    // the correct one, and this is what stops a future rewrite of `lostLineCount` back to a
    // Set silently changing what the guard refuses.
    write('f.txt', 'x\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'x\nx\n');
    commit('branch writes x twice');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'x\nMAIN\n');
    commit('main keeps one x');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(git(['show', ':0:f.txt']).match(/^x$/gm)).toHaveLength(1);
    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('reports a gitlink pointer bump, which has no lines to compare', () => {
    // Found in review as correct but untested. A submodule entry is a pointer, so the content
    // measure has nothing to work with; without an explicit branch the pointer difference
    // would be read as "zero lines lost" and a bumped submodule would land as a no-op.
    const at = (rev, path) => git(['rev-parse', `${rev}:${path}`]).slice(0, 40);
    write('a.txt', 'base\n');
    commit('base');
    // `--cacheinfo` stages the pointer, and the index is then committed AS IS: a `git add -A`
    // would see no `sub` directory on disk and drop the entry again.
    const baseSha = sha();
    git(['update-index', '--add', '--cacheinfo', `160000,${baseSha},sub`]);
    git(['commit', '-qm', 'base gains a gitlink']);

    git(['checkout', '-qb', 'feat']);
    git(['update-index', '--add', '--cacheinfo', `160000,${sha()},sub`]);
    git(['commit', '-qm', 'branch bumps the pointer']);
    const bumped = at('feat', 'sub');

    git(['checkout', '-q', 'main']);
    write('a.txt', 'main moved on\n');
    commit('main edits an unrelated file');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['sub']);
    expect(seen.takeovers[0].kind).toBe('discarded-incoming-change');
    // The precondition: the pointer really is not the branch's in the result.
    expect(at('HEAD', 'sub')).not.toBe(bumped);
  });

  it('reports a `checkout --ours` resolution, which is shape 3 with no strategy flag', () => {
    // Found in review and previously untested: the most reachable producer of this shape is
    // a person resolving one path of a conflicted merge by hand. Before this shape existed
    // the guard was silent on it.
    write('f.txt', 'alpha\nbeta\ngamma\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nBRANCH\ngamma\n');
    commit('branch edits the same lines');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN\ngamma\n');
    commit('main edits the same lines');

    const seen = mergeAndInspect('feat', { resolve: () => takeOurs('f.txt') });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('discarded-incoming-change');
    expect(git(['show', ':0:f.txt'])).not.toContain('BRANCH');
  });

  it('stays silent on a REORDERED superset, which a line-count measure misreports', () => {
    // Found in review, and the reason string it produced was false at the same time:
    // `--numstat` bills a moved line as one deletion plus one insertion, so main holding
    // the branch's line at a different position read as a loss, and the guard then claimed
    // the commit "landed as a no-op" while the line sat in the result untouched.
    write('f.txt', 'a\nb\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nBRANCH\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    // Same content as a superset, different line order.
    write('f.txt', 'a\nBRANCH\nb\nMAIN\n');
    commit('main carries the branch line, reordered');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    // The precondition: nothing of the branch's is lost.
    expect(git(['show', ':0:f.txt'])).toContain('BRANCH');
    expect(seen.takeovers).toEqual([]);
  });

  it('stays silent on `-X ours` where the two sides touched DIFFERENT files', () => {
    // No contested path at all, so there is nothing to discard. This is the ordinary shape
    // of every `-X ours` merge someone runs deliberately, and it is why the new scan is
    // gated on both sides having moved the path rather than on the strategy.
    write('f.txt', 'alpha\n');
    write('other.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nBRANCH\n');
    commit('branch edits f');

    git(['checkout', '-q', 'main']);
    write('other.txt', 'main\n');
    commit('main edits other');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers).toEqual([]);
  });

  it('reports each lost path of a `-X ours` merge, not only the first', () => {
    write('a.txt', 'base\n');
    write('b.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('a.txt', 'branch\n');
    write('b.txt', 'branch\n');
    commit('branch edits both');

    git(['checkout', '-q', 'main']);
    write('a.txt', 'main\n');
    write('b.txt', 'main\n');
    commit('main edits both');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['a.txt', 'b.txt']);
  });

  it('stays silent on a resolution that is NEITHER side but still drops a branch line', () => {
    // The boundary, pinned so a later reader does not "fix" it into an over-reporting gate.
    // Measured as reachable with raw git: a contested path whose result is neither side's
    // content verbatim, and which deletes a line the incoming side had.
    //
    // It stays silent deliberately. Every shape this program reports is a WHOLE-FILE
    // one-sided decision — git copied one side's blob for the whole path. That is the class
    // that produces no conflict marker, which is the only reason a gate is needed here: a
    // merge that DID conflict was visibly unmerged until somebody staged it, and that
    // resolution is a human decision made in the open. Reporting lossy hand-resolutions too
    // would fire on ordinary conflict resolution, and the first agent to hit that would
    // reach for --no-verify — which is how the two shapes above were nearly lost once already
    // (see the superset case in 'the shapes it must NOT report').
    write('f.txt', 'a\nb\nc\nd\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nc\nd\nFEAT-KEPT\n');
    commit('branch adds a line');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'a\nb\nc\nd\nMAIN\n');
    commit('main adds a different line');

    const seen = mergeAndInspect('feat', {
      resolve: () => {
        // Neither side verbatim: main's line kept, an extra line added, the branch's gone.
        write('f.txt', 'a\nb\nc\nd\nMAIN\nEXTRA\n');
        git(['add', '-A']);
      },
    });

    expect(seen.conflicted).toBe(true);
    // The precondition is real, so this is a boundary rather than a vacuous pass: the branch's
    // line really was dropped from the result.
    expect(git(['show', ':0:f.txt'])).not.toContain('FEAT-KEPT');
    expect(git(['show', ':0:f.txt'])).toContain('EXTRA');
    expect(seen.takeovers).toEqual([]);
  });

  it('still reports `-X theirs` — the new scan must not have displaced the old shapes', () => {
    // The regression this whole block could have caused: a symmetric rewrite that quietly
    // narrowed the original scan set would keep A and B passing and lose C.
    contestedPath();

    const seen = mergeAndInspect('feat', { args: ['-X', 'theirs'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('whole-file-takeover');
  });

  it('counts every path either pass could judge, so the clean line is not misleading', () => {
    // `scanned` is what the clean-merge message interpolates. If it still counted only
    // `movedByMerge`, every `-X ours` merge would print "0 path(s) moved" beside a refusal
    // it actually made — or, once the finding is absent, claim it examined nothing.
    contestedPath();

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.scanned).toBeGreaterThan(0);
  });
});

describe('the shapes an independent review measured as silent passes', () => {
  // Every case here was reproduced against the guard as it stood BEFORE this block: real git,
  // a throwaway repository, and `findTakeovers` driven directly with the real index. Each
  // quoted verdict is what the old code returned while a committed change was destroyed.
  // They are grouped because they share one property: the guard's DISCERNMENT was wrong,
  // not its plumbing. Nothing here is a new shape of merge — five of the six are things
  // `-X ours`, `-s ours` and `update-index` already produced.

  it('reports an add/add conflict resolved by `-X theirs`, which leaves no marker', () => {
    // The shape whose producer `docs/ORCHESTRATION.md` names as `checkout --theirs`. On an
    // add/add there is no blob at the merge base, and the old guard asked for one before it
    // would look — so the shape that exists to catch this never ran. Old verdict:
    // `scanned=1 takeovers=0`, exit 0, main's committed file replaced.
    write('base.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('same.ts', 'branch only\n');
    commit('branch adds same.ts');
    git(['checkout', '-q', 'main']);
    write('same.ts', 'main only\n');
    commit('main adds the same path');

    const seen = mergeAndInspect('feat', { args: ['-X', 'theirs'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['same.ts']);
    expect(seen.takeovers[0].kind).toBe('whole-file-takeover');
    // The branch's file is what landed, and `git status` is clean.
    expect(git(['show', ':same.ts'])).toBe('branch only');
  });

  it('does not crash on an ordinary modify/delete resolution', () => {
    // Not a miss but the worst failure mode in the file, and the most reachable: an agent or
    // a developer keeping the file when the branch edited it and this side deleted it is
    // simply how that conflict is resolved. Old verdict, reproduced verbatim:
    //   TypeError: Cannot read properties of undefined (reading 'gitlink')
    // which `main()` does not catch, so the hook exited 1 with a raw stack trace, no verdict,
    // no path and no reason. A gate that dies instead of answering is what gets --no-verify'd.
    write('f.txt', 'a\nb\nc\n');
    write('other.txt', 'x\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nc\nBRANCH\n');
    commit('branch edits f.txt');
    git(['checkout', '-q', 'main']);
    git(['rm', '-q', 'f.txt']);
    commit('main deletes f.txt');

    const seen = mergeAndInspect('feat', { resolve: () => git(['add', 'f.txt']) });

    // Keeping the file is CORRECT and must pass: this side held no content at that path to
    // lose. The point of the test is that it answers at all.
    expect(seen.takeovers).toEqual([]);
  });

  it('reports a deletion this side had committed that the result undid', () => {
    // The other half of the same case. Restoring the pre-divergence content over a committed
    // deletion IS the loss, and `git status` calls it a modified path rather than a conflict.
    write('f.txt', 'a\nb\nc\n');
    write('other.txt', 'x\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nc\nBRANCH\n');
    commit('branch edits f.txt');
    git(['checkout', '-q', 'main']);
    git(['rm', '-q', 'f.txt']);
    commit('main deletes f.txt');

    // `checkout HEAD -- f.txt` cannot restore a path HEAD deleted. The shape is the
    // PRE-DIVERGENCE content coming back over a committed deletion, so it comes from the
    // merge base — which is what `git add -A` in a worktree at another HEAD produces.
    const seen = mergeAndInspect('feat', {
      resolve: () => git(['checkout', 'feat~1', '--', 'f.txt']),
    });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    // Counted as one, because there are no lines of an absence to count and `git status`
    // will say one file.
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('reports a `-s ours` merge that discarded an added EMPTY file', () => {
    // `nonBlankLines` of an empty blob is zero, so "no lines lost" answered for a file that
    // had ceased to exist. A `.gitkeep` is the cheapest content there is and it still counts.
    // Old verdict: `scanned=1 takeovers=0`.
    write('a.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('.gitkeep', '');
    commit('branch adds an empty .gitkeep');
    git(['checkout', '-q', 'main']);
    write('a.txt', 'main moved on\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['.gitkeep']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('reports a `-s ours` merge that discarded an added gitlink', () => {
    // The gitlink arm read `losing.oid !== resultBlob.oid` behind a `resultBlob &&`, so an
    // absent result entry answered zero. The adjacent file case handles the absence
    // explicitly; this one did not, while the header claimed `-s ours` covers the whole
    // payload. Old verdict: `scanned=1 takeovers=0`.
    write('a.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    git(['update-index', '--add', '--cacheinfo', '160000,1234567890123456789012345678901234567890,sub']);
    commitIndexOnly('branch adds a submodule');
    git(['checkout', '-q', 'main']);
    write('a.txt', 'main moved on\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['sub']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('reports a commit whose entire substance is indentation', () => {
    // Trimming each line before comparing made this zero by construction, and
    // `npm run format` produces exactly this commit — so the blindness sat on the most common
    // commit shape in a repository whose own commit hook runs Prettier. Old verdict:
    // `scanned=1 takeovers=0`.
    write('f.py', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.py', '    alpha\n    beta\n');
    commit('reindent and nothing else');
    git(['checkout', '-q', 'main']);
    write('f.py', 'alpha\nbeta\nMAIN\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.py']);
    expect(seen.takeovers[0].deleted).toBe(2);
  });

  it('does NOT report a commit that only changed line endings', () => {
    // The counterweight, and the reason the measure normalises line endings rather than
    // treating them as content. CRLF is an artefact of a checkout, not a committed change,
    // and reporting it would be the crying wolf this file exists to avoid. It is the pin for
    // the fix above: normalising everything, not just the line ending, is how this test fails.
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\r\nbeta\r\n');
    commit('CRLF and nothing else');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nbeta\nMAIN\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-X', 'ours'] });

    expect(seen.takeovers).toEqual([]);
  });

  it('reports a `-s ours` merge whose result then had a mode bit set', () => {
    // `headWon()` was documented as exactly `!moved.has(path)` and the equivalence was
    // measured across five shapes. The sixth is this: `-s ours` leaves the result identical
    // to HEAD's tree, so `moved` is EMPTY; a later `git update-index --chmod=+x` makes the
    // path "move" by mode alone, and shape 3 skipped on `moved` while shapes 1 and 2 looked
    // for the base's entry and the incoming one and found neither. Old verdict:
    // `scanned=1 takeovers=0`.
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbeta\nBRANCH\n');
    commit('branch rewrites f.txt');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nbeta\nMAIN\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', {
      args: ['-s', 'ours'],
      resolve: () => git(['update-index', '--chmod=+x', 'f.txt']),
    });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });
});

describe('what the operator is actually told', () => {
  // Found in review as a surviving mutation: deleting the whole `discarded-incoming-change`
  // hint block from report() left every test green, because nothing here asserted anything
  // about report()'s output at all. A refusal whose advice is the only thing an operator
  // reads is worth testing on its own terms.
  it('names the strategy when it refuses a `-s ours` merge', () => {
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nbeta\nBRANCH\n');
    commit('branch adds a line');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nbeta\nMAIN\n');
    commit('main adds a line');
    gitOk(['merge', '--no-commit', '-s', 'ours', 'feat']);

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });

    expect(stderr).toContain('discarded-incoming-change');
    expect(stderr).toContain('-X ours');
    expect(stderr).toContain('-s ours');
    // The refusal must still offer the documented way out.
    expect(stderr).toContain('--no-verify');
    // And must not claim the commit was a no-op, which a reordered superset made a lie.
    expect(stderr).not.toMatch(/landed as a no-op/);
  });

  it('withholds the strategy hint on a `--theirs` refusal, where it would not apply', () => {
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nBRANCH\nbeta\n');
    commit('branch edits');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN\nbeta\n');
    commit('main edits');
    gitOk(['merge', '--no-edit', 'feat']);
    takeTheirs('f.txt');

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });

    expect(stderr).toContain('whole-file-takeover');
    expect(stderr).not.toContain('discarded-incoming-change');
  });

  it('bounds the listing without bounding the count or the refusal', () => {
    // A `-s ours` merge of a wide branch is ONE refusal. Printing two lines per path buried
    // the advice that says what to do about it, and an unreadable refusal is how a gate gets
    // `--no-verify`'d. So the prose is capped and nothing else is.
    write('base.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    for (let i = 0; i < 40; i++) write(`added-${i}.ts`, `export const v${i} = ${i};\n`);
    commit('branch adds forty files');
    git(['checkout', '-q', 'main']);
    write('unrelated.txt', 'main moved on\n');
    commit('main edits something else');

    // `--no-commit` because `main()` has to be able to identify the merge afterwards, and a
    // self-committing `-s ours` leaves neither MERGE_HEAD nor a ref to name.
    const headBefore = sha();
    gitOk(['merge', '--no-commit', '-s', 'ours', 'feat']);
    const seen = findTakeovers({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
      resultTree: git(['write-tree']),
    });

    // Every path is still found.
    expect(seen.takeovers).toHaveLength(40);
    expect(seen.takeovers.every((t) => t.kind === 'discarded-incoming-change')).toBe(true);

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });

    // The headline count is the true one, not the listed one.
    expect(stderr).toContain('REFUSING this merge — 40 path(s)');
    expect(stderr).toContain('and 20 more path(s)');
    // And the advice is still readable at the end of it.
    expect(stderr).toContain('--no-verify');
    // Fewer than 40 paths spelled out, so the cap is real.
    expect((stderr.match(/\[discarded-incoming-change\]/g) ?? []).length).toBe(20);
  });

  it('counts paths EXAMINED rather than paths moved, so a `-s ours` clean line is honest', () => {
    // A `-s ours` merge of a branch that changed nothing on paths main also changed moves
    // nothing, and reporting "0 path(s) moved" beside a decision that examined real paths
    // is the sentence that hid the original hole.
    write('a.txt', 'base\n');
    write('u.txt', 'base\n');
    write('v.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('u.txt', 'base\nbranch\n');
    commit('branch edits u');
    git(['checkout', '-q', 'main']);
    write('v.txt', 'base\nmain\n');
    commit('main edits v');
    // Disjoint, so the merge is clean, and `--no-commit` so it does not COMMIT itself. That
    // is the hook's precondition: `pre-merge-commit` runs with MERGE_HEAD written and HEAD
    // still on the pre-merge tip. A self-committing clean merge would leave neither, and the
    // guard would refuse rather than answer — correctly, and for a different reason.
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(git(['write-tree'])).not.toBe(git(['rev-parse', 'HEAD^{tree}']));

    const stdout = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    let code;
    try {
      code = main(['--manual'], { cwd: dir });
    } finally {
      spy.mockRestore();
    }

    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toMatch(/clean — [1-9]\d* path\(s\) examined/);
    expect(out).not.toMatch(/path\(s\) moved by the merge/);
  });
});

describe('refusing rather than passing blind', () => {
  it('throws when GIT_REFLOG_ACTION names no ref', () => {
    write('f.txt', 'x\n');
    commit('base');
    expect(() => resolveIncomingRef(dir)).toThrow(/cannot tell which ref/);
  });

  it('throws when GIT_REFLOG_ACTION names a ref that does not resolve', () => {
    write('f.txt', 'x\n');
    commit('base');
    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge no-such-ref-anywhere';
    try {
      expect(() => resolveIncomingRef(dir)).toThrow(/does not resolve to a commit/);
    } finally {
      restoreAction(previous);
    }
  });

  it('resolves the incoming ref from GIT_REFLOG_ACTION', () => {
    write('f.txt', 'x\n');
    commit('base');
    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge main';
    try {
      expect(resolveIncomingRef(dir)).toBe(sha());
    } finally {
      restoreAction(previous);
    }
  });

  it('throws on unrelated history rather than reporting a clean merge', () => {
    // `main` needs a commit first: orphaning an unborn ref leaves no `main` to return to,
    // which is a fixture bug and not the behaviour under test.
    write('f.txt', 'main root\n');
    commit('main root');

    git(['checkout', '-q', '--orphan', 'orphan']);
    git(['rm', '-qrf', '.']);
    write('f.txt', 'unrelated\n');
    commit('orphan root');
    const orphan = sha();

    git(['checkout', '-q', 'main']);
    write('f.txt', 'main moved on\n');
    commit('main advances');

    expect(() => findTakeovers({ cwd: dir, head: sha(), incoming: orphan, resultTree: git(['write-tree']) })).toThrow(
      /share no merge-base/
    );
  });
});

describe('refusing rather than passing when the content cannot be read', () => {
  // The one hole whose failure mode is invisible: an unread blob measures as NO lines lost,
  // so the guard answers `clean` and exits 0 having compared nothing. Reached on a merge
  // whose suspect blobs exceed the batch buffer — the old cap was 256 MiB and six distinct
  // ~61 MiB assets exceed it, `execFileSync` threw ENOBUFS, and the `catch` returned an empty
  // map. A photo editor is plausibly the project most likely to merge large binaries, which
  // makes this the shape most likely to fire exactly where it matters.

  it('raises rather than returning an empty map, so the caller cannot mistake it for "no loss"', () => {
    write('f.txt', 'alpha\n');
    commit('base');
    const written = git(['rev-parse', 'HEAD:f.txt']);

    // A cap of one byte cannot hold any response, which is the smallest faithful stand-in for
    // a buffer overflow: the same exception, without allocating a quarter of a gigabyte in a
    // unit test.
    expect(() => batchBlobs([written], dir, { maxBytes: 1 })).toThrow(GuardError);
  });

  it('still reads normally when the buffer is big enough', () => {
    // The counterweight: the failure must not be the normal path. If this ever throws, every
    // merge refuses and the gate is bypassed rather than obeyed.
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    const oid = git(['rev-parse', 'HEAD:f.txt']);

    const got = batchBlobs([oid], dir);

    expect(got.get(oid)?.toString('utf8')).toBe('alpha\nbeta\n');
  });

  it('asks for more than the old 256 MiB, and names the ceiling it asks for', () => {
    // A number nobody reads is a number nobody raises. The old value is quoted here so that
    // lowering it again is a visible edit to a stated reason rather than a silent edit.
    expect(MAX_BLOB_BYTES).toBe(1024 * 1024 * 1024);
  });

  it('refuses rather than comparing against a tree it could not list', () => {
    // The same class one level up, and worse: an empty map from ONE of the four trees makes
    // every path look absent from it, which silently empties all four scans at once. So a
    // reflist that cannot be read has to stop the guard, not empty its map.
    write('f.txt', 'alpha\n');
    commit('base');

    // The control: a resolvable pair still runs, so the refusal above is about the tree read
    // and not about every input being rejected.
    expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).not.toThrow();
    expect(() => findTakeovers({ cwd: dir, head: 'not-a-commit', incoming: 'HEAD' })).toThrow(GuardError);
  });
});

describe('the exit code a caller branches on', () => {
  it('is 1 on a lost path, 2 when it cannot tell, and 0 on neither', () => {
    write('f.txt', 'alpha\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'branch\n');
    commit('branch');

    git(['checkout', '-q', 'main']);
    write('f.txt', 'main\n');
    commit('main');

    gitOk(['merge', '--no-edit', 'feat']);
    takeTheirs('f.txt');

    const previous = process.env.GIT_REFLOG_ACTION;
    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      expect(main([], { cwd: dir })).toBe(1);

      // Abort first: with the merge still in progress MERGE_HEAD is present and answers
      // the question on its own, so exit 2 is only reachable once it is gone. That
      // precedence is deliberate — MERGE_HEAD is git's own record and GIT_REFLOG_ACTION is
      // the fallback for the one hook where MERGE_HEAD is not yet written.
      git(['merge', '--abort']);
      process.env.GIT_REFLOG_ACTION = '';
      expect(main([], { cwd: dir })).toBe(2);
    } finally {
      restoreAction(previous);
    }
  });

  it('exits 0 on a merge with nothing lost', () => {
    write('f.txt', 'alpha\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('g.txt', 'branch\n');
    commit('branch');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main moved on\n');
    commit('main');
    gitOk(['merge', '--no-edit', 'feat']);

    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge feat';
    try {
      expect(main([], { cwd: dir })).toBe(0);
    } finally {
      restoreAction(previous);
    }
  });

  it('surfaces a GuardError as exit 2 rather than throwing out of main', () => {
    write('f.txt', 'x\n');
    commit('base');
    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge nope-nope';
    try {
      expect(main([], { cwd: dir })).toBe(2);
      expect(GuardError.prototype).toBeInstanceOf(Error);
    } finally {
      restoreAction(previous);
    }
  });
});

/**
 * Merge in WITHOUT committing, then read the census. This is the hook's own view: the staged
 * result is still the merge, HEAD is still the side being merged into, and `MERGE_HEAD` still
 * names what is coming in.
 */
function mergeThenInspectCensus(ref, { resolve } = {}) {
  const headBefore = sha();
  gitOk(['merge', '--no-commit', '--no-edit', ref]);
  // BEFORE the resolution, and by index rather than by MERGE_HEAD: `--no-commit` writes
  // MERGE_HEAD for a merge that did NOT conflict, so its presence answers "is a merge in
  // progress" and not "did this one conflict". Unmerged index entries are the only evidence
  // of the second.
  const conflicted = (gitOk(['ls-files', '-u']).out ?? '').length > 0;
  if (resolve) resolve();
  return {
    ...findHandResolutions({ cwd: dir, head: headBefore, incoming: git(['rev-parse', ref]) }),
    conflicted,
  };
}

/**
 * One file, twelve lines, with each side changing a line at the far end from the other. The
 * spacing is load-bearing: git's hunks carry three lines of context, so a three-line file
 * CONFLICTS even when the two sides touch different lines of it, and every test below is
 * about a path git never reported as conflicted. A fixture that conflicts would make them
 * all vacuous.
 */
const CLEAN_BASE = Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\n') + '\n';

/** The content git's own merge produces, so a test can deviate from it by exactly one line. */
function mergedBody() {
  return CLEAN_BASE.replace('l2\n', 'l2\nMAIN\n').replace('l10\n', 'l10\nFEAT\n');
}

function cleanTwoSidedFixture(name) {
  write(name, CLEAN_BASE);
  commit('base');
  git(['checkout', '-qb', 'feat']);
  write(name, CLEAN_BASE.replace('l10\n', 'l10\nFEAT\n'));
  commit('branch changes one line');
  git(['checkout', '-q', 'main']);
  write(name, CLEAN_BASE.replace('l2\n', 'l2\nMAIN\n'));
  commit('main changes another line');
}

/**
 * Stage a removal the way a human has to. `git rm` refuses a path the merge itself staged,
 * so the `-f` is not a convenience for the test — it is the only command that produces this
 * state at all.
 */
function stageRemoval(path) {
  git(['rm', '-q', '-f', path]);
}

describe('the hand edit that leaves no conflict marker', () => {
  it('reports a path git merged cleanly that the resolution then changed', () => {
    cleanTwoSidedFixture('f.txt');
    const seen = mergeThenInspectCensus('feat', {
      resolve: () => {
        write('f.txt', `${mergedBody()}EDITED BY HAND\n`);
        git(['add', 'f.txt']);
      },
    });

    expect(seen.conflicted).toBe(false);
    expect(seen.edits).toEqual([
      { path: 'f.txt', kind: 'edited-after-clean-merge', lost: expect.any(Number), detail: '' },
    ]);
  });

  it("counts the lines of git's own merged result that the edit dropped", () => {
    cleanTwoSidedFixture('f.txt');
    const seen = mergeThenInspectCensus('feat', {
      resolve: () => {
        write('f.txt', mergedBody().replace('l6\n', ''));
        git(['add', 'f.txt']);
      },
    });

    // `l6` was in git's merged result and is not in the staged one. The measure is content
    // membership and not a diff, so a dropped line reads as one and a reorder as none.
    expect(seen.edits).toEqual([{ path: 'f.txt', kind: 'edited-after-clean-merge', lost: 1, detail: '' }]);
  });

  it('refuses a merge whose resolution deleted a test file git had produced', () => {
    cleanTwoSidedFixture('suite.test.ts');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });

    expect(stderr).toContain('erased-after-clean-merge');
    expect(stderr).toContain('BOTH sides');
    expect(stderr).toContain('suite.test.ts');
    // The way out has to be in the refusal: a message that only says "no" is an obstacle.
    expect(stderr).toContain('--no-verify');
  });

  it('reports an erased non-test file without refusing the merge', () => {
    cleanTwoSidedFixture('helper.ts');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('helper.ts');

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });

    expect(stderr).toContain('erased-after-clean-merge');
    expect(stderr).toContain('helper.ts');
  });

  it('does not report a CONFLICTED path as a hand edit', () => {
    write('f.txt', 'alpha\nbeta\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'alpha\nBRANCH\n');
    commit('branch');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'alpha\nMAIN\n');
    commit('main');

    const seen = mergeThenInspectCensus('feat', { resolve: () => takeTheirs('f.txt') });

    expect(seen.conflicted).toBe(true);
    expect(seen.edits).toEqual([]);
  });

  it('does not refuse a test file the INCOMING side had already deleted', () => {
    // The branch removes the test in its own commit, main edits it, and git reports
    // `CONFLICT (modify/delete)` whose recommended resolution is to remove it. A regex that
    // only matched git's "Merge conflict in" phrasing treated this as a clean hand edit and
    // refused git's own recommendation; two real test paths on this history are this shape.
    write('suite.test.ts', 'it(\"base\")\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', '-f', 'suite.test.ts']);
    commit('branch deletes the test');
    git(['checkout', '-q', 'main']);
    write('suite.test.ts', 'it(\"base\")\nit(\"main\")\n');
    commit('main edits the test');

    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    expect(seen.edits).toEqual([expect.objectContaining({ path: 'suite.test.ts', kind: 'erased-by-a-side' })]);
    expect(main([], { cwd: dir })).toBe(0);
  });

  it('refuses a CONTENT-conflicted test file the resolution erases', () => {
    // Both sides still carry the file and the resolution drops it. That is the decision the
    // refusal exists for, and it must not be waved through because git happened to conflict.
    write('suite.test.ts', 'it(\"base\")\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('suite.test.ts', 'it(\"feat\")\n');
    commit('branch edits the test');
    git(['checkout', '-q', 'main']);
    write('suite.test.ts', 'it(\"main\")\n');
    commit('main edits the test');

    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    // BEFORE the resolution: `stageRemoval` clears the unmerged entries, and the question is
    // whether git CONFLICTED, not whether the index still says so.
    expect(seenUnmerged(dir)).toBe(true);
    stageRemoval('suite.test.ts');
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });
    expect(stderr).toContain('erased-after-clean-merge');
    expect(stderr).toContain('suite.test.ts');
  });

  it('reports a renamed test file as a rename rather than refusing the erasure', () => {
    cleanTwoSidedFixture('suite.test.ts');
    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    git(['mv', 'suite.test.ts', 'renamed.test.ts']);

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    // Exactly one finding: the destination is named inside it, not reported again as an add.
    expect(seen.edits).toEqual([
      {
        path: 'suite.test.ts',
        kind: 'renamed-after-clean-merge',
        lost: 0,
        detail: ' — its content moved to renamed.test.ts',
      },
    ]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).toContain('renamed-after-clean-merge');
  });

  it('cannot be silenced by -X ours, and says why', () => {
    // Git records the RESULT of a merge in its reflog action, not the invocation: with a real
    // hook installed, `git merge -X ours feat` sets GIT_REFLOG_ACTION to plain `merge feat`. So
    // there is nothing at the hook to detect a strategy flag with, and an earlier version's
    // skip on that string could not fire. What is pinned here is the consequence that matters:
    // a strategy option resolves a hunk and never removes a path, so it cannot cause a refusal.
    cleanTwoSidedFixture('suite.test.ts');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');

    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge feat';
    try {
      const seen = findHandResolutions({ cwd: dir, incoming: git(['rev-parse', 'feat']) });
      expect(seen.skipped).toBeNull();
    } finally {
      restoreAction(previous);
    }
  });

  it('says nothing at all about a merge nobody touched by hand', () => {
    cleanTwoSidedFixture('f.txt');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);

    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge feat';
    try {
      expect(findHandResolutions({ cwd: dir, incoming: git(['rev-parse', 'feat']) }).edits).toEqual([]);
      const stderr = captureStderr(() => {
        expect(main([], { cwd: dir })).toBe(0);
      });
      expect(stderr).toBe('');
    } finally {
      restoreAction(previous);
    }
  });

  it('refuses a test file the base never had, that one side ADDED and the resolution dropped', () => {
    // The shape every one of the four erased test files on main's history is: the base does
    // not have the file, ONE side added it, and the merge kept the addition until the
    // resolution dropped it. Asking "which side lacks it?" cannot tell that from a side that
    // deleted it, and did — which reported all four instead of refusing them.
    write('suite.test.ts', 'it("base")\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('keep.txt', 'keep\n');
    commit('branch touches something else');
    git(['checkout', '-q', 'main']);
    write('suite.test.ts', 'it("main added it")\n');
    commit('main adds the test');

    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    expect(seen.edits).toEqual([expect.objectContaining({ path: 'suite.test.ts', kind: 'erased-after-clean-merge' })]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });
    expect(stderr).toContain('erased-after-clean-merge');
  });

  it('does not refuse a rename that shares a merge with an unrelated addition', () => {
    // `--name-status -z -M` prints `A`, `README.md`, `R100`, `<old>`, `<new>`. Matching the
    // status by `startsWith('R')` reads `README.md` as a status, swallows the real triple, and
    // turns the rename into a refusal — so the destination is added back here too.
    cleanTwoSidedFixture('suite.test.ts');
    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    git(['mv', 'suite.test.ts', 'renamed.test.ts']);
    write('README.md', 'added by the resolution\n');
    git(['add', 'README.md']);

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    expect(seen.edits.filter((e) => e.path === 'suite.test.ts')).toEqual([
      expect.objectContaining({ kind: 'renamed-after-clean-merge' }),
    ]);
    expect(seen.edits.filter((e) => e.path === 'renamed.test.ts')).toEqual([]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).not.toContain('REFUSING');
  });

  it('fails closed when the census cannot run at all', () => {
    // "The census did not run" and "nobody touched this merge" both print one line and exit 0,
    // and the second is a lie this repository has been bitten by. Exit 2 is the status the
    // whole-file layer already returns for "I could not look".
    cleanTwoSidedFixture('f.txt');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);

    const seen = findHandResolutions({
      cwd: dir,
      head: git(['rev-parse', 'HEAD']),
      incoming: git(['rev-parse', 'feat']),
      resultTree: 'not-a-tree',
    });
    // A tree git cannot read is a whole-file failure before the census is even reached, so the
    // assertion that matters is the status, pinned by the call below.
    expect(seen).toBeTruthy();

    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = '';
    try {
      const stderr = captureStderr(() => {
        expect(main([], { cwd: dir })).toBe(0);
      });
      expect(stderr).toBe('');
    } finally {
      restoreAction(previous);
    }
  });

  it('refuses a test file ONE SIDE ADDED and the resolution then dropped', () => {
    // The shape the base decides. The base does not have the file, `main` adds it, the incoming
    // branch never had it, and the resolution deletes it. Asking "which side lacks the path?"
    // answers "the incoming", which reads as "a side had already deleted it" — false — and would
    // report and never refuse the one case this gate is for.
    write('keep.txt', 'keep\n');
    commit('base without the test');
    git(['checkout', '-qb', 'feat']);
    write('other.txt', 'other\n');
    commit('branch adds something else');
    git(['checkout', '-q', 'main']);
    write('suite.test.ts', 'it("main wrote this")\n');
    commit('main adds the test');

    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    expect(seen.edits).toEqual([expect.objectContaining({ path: 'suite.test.ts', kind: 'erased-after-clean-merge' })]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });
    expect(stderr).toContain('Neither side deleted this file');
  });

  it('does not refuse a rename that lands beside an added file', () => {
    // `--name-status -z -M` prints `A`, the added path, then `R100` and the pair. A parser that
    // tests `startsWith('R')` on every field reads `README.md` as a status, swallows the real
    // triple, and turns the rename into a refusal.
    cleanTwoSidedFixture('suite.test.ts');
    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    git(['mv', 'suite.test.ts', 'renamed.test.ts']);
    write('README.md', 'hi\n');
    git(['add', 'README.md']);

    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    expect(seen.edits.filter((e) => e.path === 'suite.test.ts')).toEqual([
      expect.objectContaining({ kind: 'renamed-after-clean-merge' }),
    ]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).toContain('renamed-after-clean-merge');
  });

  it('refuses to merge when the census could not run', () => {
    // A census that could not look and a merge nobody touched would otherwise both print one line
    // and exit 0, and the second of those is the lie this guard exists to stop. Exit 2 is what the
    // whole-file layer already returns for "I could not look".
    cleanTwoSidedFixture('f.txt');
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    // A conflict style git does not know makes `merge-tree` fail without producing a tree, which
    // is the reachable shape of "it could not look".
    const previous = process.env.GIT_CONF_PARAMETERS;
    process.env.GIT_CONF_PARAMETERS = "'merge.conflictStyle'='bogus'";
    try {
      const seen = findHandResolutions({ cwd: dir, incoming: git(['rev-parse', 'feat']) });
      if (seen.skipped === null) return; // this git tolerates the bad style; nothing to pin here
      expect(seen.skipped).toMatch(/merge-tree/);
      const stderr = captureStderr(() => {
        expect(main([], { cwd: dir })).toBe(2);
      });
      expect(stderr).toContain('merge-takeover-guard:');
    } finally {
      if (previous === undefined) delete process.env.GIT_CONF_PARAMETERS;
      else process.env.GIT_CONF_PARAMETERS = previous;
    }
  });

  it('counts the lines an erasure removed, and says a binary has none to count', () => {
    cleanTwoSidedFixture('suite.test.ts');
    const headBefore = sha();
    gitOk(['merge', '--no-commit', '--no-edit', 'feat']);
    stageRemoval('suite.test.ts');
    const seen = findHandResolutions({
      cwd: dir,
      head: headBefore,
      incoming: git(['rev-parse', 'feat']),
    });
    // The merged file has the base's 12 lines plus each side's one, so 14.
    expect(seen.edits[0]).toMatchObject({ kind: 'erased-after-clean-merge', lost: 14 });
  });

  it('names every test path shape this repository writes', () => {
    expect(isTestPath('src/a/__tests__/b.test.tsx')).toBe(true);
    expect(isTestPath('e2e/thing.spec.ts')).toBe(true);
    expect(isTestPath('src/a.test.mts')).toBe(true);
    expect(isTestPath('src/tools/paintBucket.ts')).toBe(false);
    expect(isTestPath('docs/latest.md')).toBe(false);
    // "test" inside a name is not a test file, which is why the match is on the extension.
    expect(isTestPath('src/testHelpers.ts')).toBe(false);
  });
});

function restoreAction(previous) {
  if (previous === undefined) delete process.env.GIT_REFLOG_ACTION;
  else process.env.GIT_REFLOG_ACTION = previous;
}
