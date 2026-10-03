import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuardError, findTakeovers, main, resolveIncomingRef } from '../merge-takeover-guard.mjs';

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

function write(name, body) {
  writeFileSync(join(dir, name), body);
}

function commit(message) {
  git(['add', '-A']);
  git(['commit', '-qm', message]);
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

/** `--theirs` then stage, as a block. Never `git(...) && git(...)`: git prints nothing on
 * some paths, an empty string is falsy, and the second command silently never runs. */
function takeTheirs(...paths) {
  for (const path of paths) git(['checkout', '--theirs', path]);
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
    expect(seen.takeovers[0].reason).toMatch(/kept this side/);
    // The whole point, asserted rather than described: the line is really gone.
    expect(git(['show', ':0:f.txt'])).not.toContain('BRANCH');
    expect(git(['show', ':0:f.txt'])).toContain('MAIN');
  });

  it('reports a `-s ours` merge, which is the documented idiom and the worse case', () => {
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

function restoreAction(previous) {
  if (previous === undefined) delete process.env.GIT_REFLOG_ACTION;
  else process.env.GIT_REFLOG_ACTION = previous;
}
