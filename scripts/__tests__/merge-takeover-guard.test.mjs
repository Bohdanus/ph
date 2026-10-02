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
function mergeAndInspect(ref, { resolve } = {}) {
  // BEFORE the merge, and this is load-bearing: a merge with no conflicts commits itself,
  // so reading HEAD afterwards gives the merge commit rather than the side being merged
  // INTO. Comparing against that makes "main changed nothing" read as "main changed
  // everything", which silently turns every false-positive test into a vacuous pass.
  const headBefore = sha();
  gitOk(['merge', '--no-edit', ref]); // a conflict is the expected shape, not an error
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
