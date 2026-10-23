import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GuardError,
  MAX_BLOB_BYTES,
  batchBlobs,
  findTakeovers,
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
const GUARD_PATH = realpathSync(join(import.meta.dirname, '../merge-takeover-guard.mjs'));
const MAIN_GUARD_PATH = realpathSync(join(import.meta.dirname, '../main-worktree-guard.mjs'));
const LANDING_COMMIT_PATH = realpathSync(join(import.meta.dirname, '../commit-reviewed-landing.mjs'));
const LANDING_MESSAGE_GUARD_PATH = realpathSync(
  join(import.meta.dirname, '../commit-reviewed-landing-message-guard.mjs')
);
const PRE_MERGE_HOOK_PATH = realpathSync(join(import.meta.dirname, '../../.husky/pre-merge-commit'));

function git(args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitAt(cwd, args) {
  return execFileSync('git', args, {
    cwd,
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

function prepareDisjointMerge() {
  mkdirSync(join(dir, '.kilo'), { recursive: true });
  write('AGENTS.md', '# temporary project policy marker\n');
  write('base.txt', 'base\n');
  commit('base');
  const base = sha();

  write('main.txt', 'main\n');
  commit('main change');
  const main = sha();

  git(['checkout', '-qb', 'feat']);
  write('feature.txt', 'feature\n');
  commit('feature change');
  const incoming = sha();
  const incomingTree = git(['rev-parse', `${incoming}^{tree}`]);
  git(['checkout', '-q', 'main']);
  return { base, incoming, incomingTree, main };
}

function installPreMergeGuard() {
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks);
  const hook = join(hooks, 'pre-merge-commit');
  copyFileSync(PRE_MERGE_HOOK_PATH, hook);
  chmodSync(hook, 0o755);
  git(['config', 'core.hooksPath', hooks]);
}

function installPinnedPreCommitGuards({ afterChecks = '' } = {}) {
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-commit');
  writeFileSync(
    hook,
    `#!/bin/sh\nnode "${LANDING_MESSAGE_GUARD_PATH}" --record-prepared-merge-before || exit $?\n(\nset -e\nif git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then node "${GUARD_PATH}"; fi\nnode "${MAIN_GUARD_PATH}"\n${afterChecks}\n)\nstatus=$?\nnode "${LANDING_MESSAGE_GUARD_PATH}" --record-prepared-merge-after || exit $?\nif [ "$status" -ne 0 ]; then exit "$status"; fi\n`
  );
  chmodSync(hook, 0o755);
  const messageHook = join(hooks, 'commit-msg');
  writeFileSync(messageHook, `#!/bin/sh\nset -e\nnode "${LANDING_MESSAGE_GUARD_PATH}" "$1"\n`);
  chmodSync(messageHook, 0o755);
  git(['config', 'core.hooksPath', hooks]);
}

function installMainWorktreeCommitGuards() {
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const hook = join(hooks, 'pre-commit');
  writeFileSync(hook, `#!/bin/sh\nset -e\nnode "${MAIN_GUARD_PATH}"\n`);
  chmodSync(hook, 0o755);
  const messageHook = join(hooks, 'commit-msg');
  writeFileSync(messageHook, `#!/bin/sh\nset -e\nnode "${LANDING_MESSAGE_GUARD_PATH}" "$1"\n`);
  chmodSync(messageHook, 0o755);
  git(['config', 'core.hooksPath', hooks]);
}

function removePreMergeGuard() {
  git(['config', '--unset', 'core.hooksPath']);
  rmSync(join(dir, 'hooks'), { recursive: true, force: true });
}

function withExpectedLanding({ main, incoming, tree, branch = 'feat', chat = 'test-session' }, run) {
  const previousMain = process.env.KILO_EXPECTED_MAIN_SHA;
  const previousIncoming = process.env.KILO_EXPECTED_INCOMING_SHA;
  const previousTree = process.env.KILO_EXPECTED_TREE_SHA;
  const previousBranch = process.env.KILO_EXPECTED_BRANCH;
  const previousChat = process.env.KILO_EXPECTED_CHAT_ID;
  process.env.KILO_EXPECTED_MAIN_SHA = main;
  process.env.KILO_EXPECTED_INCOMING_SHA = incoming;
  process.env.KILO_EXPECTED_TREE_SHA = tree;
  process.env.KILO_EXPECTED_BRANCH = branch;
  process.env.KILO_EXPECTED_CHAT_ID = chat;
  try {
    return run();
  } finally {
    if (previousMain === undefined) delete process.env.KILO_EXPECTED_MAIN_SHA;
    else process.env.KILO_EXPECTED_MAIN_SHA = previousMain;
    if (previousIncoming === undefined) delete process.env.KILO_EXPECTED_INCOMING_SHA;
    else process.env.KILO_EXPECTED_INCOMING_SHA = previousIncoming;
    if (previousTree === undefined) delete process.env.KILO_EXPECTED_TREE_SHA;
    else process.env.KILO_EXPECTED_TREE_SHA = previousTree;
    if (previousBranch === undefined) delete process.env.KILO_EXPECTED_BRANCH;
    else process.env.KILO_EXPECTED_BRANCH = previousBranch;
    if (previousChat === undefined) delete process.env.KILO_EXPECTED_CHAT_ID;
    else process.env.KILO_EXPECTED_CHAT_ID = previousChat;
  }
}

function withNoExpectedLanding(run) {
  const previousMain = process.env.KILO_EXPECTED_MAIN_SHA;
  const previousIncoming = process.env.KILO_EXPECTED_INCOMING_SHA;
  const previousTree = process.env.KILO_EXPECTED_TREE_SHA;
  const previousBranch = process.env.KILO_EXPECTED_BRANCH;
  const previousChat = process.env.KILO_EXPECTED_CHAT_ID;
  delete process.env.KILO_EXPECTED_MAIN_SHA;
  delete process.env.KILO_EXPECTED_INCOMING_SHA;
  delete process.env.KILO_EXPECTED_TREE_SHA;
  delete process.env.KILO_EXPECTED_BRANCH;
  delete process.env.KILO_EXPECTED_CHAT_ID;
  try {
    return run();
  } finally {
    if (previousMain === undefined) delete process.env.KILO_EXPECTED_MAIN_SHA;
    else process.env.KILO_EXPECTED_MAIN_SHA = previousMain;
    if (previousIncoming === undefined) delete process.env.KILO_EXPECTED_INCOMING_SHA;
    else process.env.KILO_EXPECTED_INCOMING_SHA = previousIncoming;
    if (previousTree === undefined) delete process.env.KILO_EXPECTED_TREE_SHA;
    else process.env.KILO_EXPECTED_TREE_SHA = previousTree;
    if (previousBranch === undefined) delete process.env.KILO_EXPECTED_BRANCH;
    else process.env.KILO_EXPECTED_BRANCH = previousBranch;
    if (previousChat === undefined) delete process.env.KILO_EXPECTED_CHAT_ID;
    else process.env.KILO_EXPECTED_CHAT_ID = previousChat;
  }
}

function commitReviewedLanding(message) {
  return execFileSync(process.execPath, [LANDING_COMMIT_PATH, '-m', message], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function recordPreparedMergeState(cwd, phase = 'before') {
  const result = spawnSync(process.execPath, [LANDING_MESSAGE_GUARD_PATH, `--record-prepared-merge-${phase}`], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
  git(['config', 'core.autocrlf', 'false']);
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
    // is the prepared state `pre-commit` can inspect.
    contestedPath();
    gitOk(['merge', '--no-commit', '-s', 'ours', 'feat']);

    expect(existsSync(join(dir, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(sha()).not.toBe(git(['rev-parse', 'feat']));
    expect(main([], { cwd: dir })).toBe(1);
  });

  it('refuses once such a merge is committed because no prepared merge side remains', () => {
    // Pinned on purpose, and it is a boundary rather than a defect: the comparison this
    // program makes is unrecoverable after the commit, because HEAD has already moved onto
    // the result and `merge-base` then resolves to the incoming tip. An earlier draft of
    // this test asserted exit 1 here and failed for exactly that reason, which is why the
    // shape above uses `--no-commit`.
    contestedPath();
    gitOk(['merge', '-s', 'ours', '--no-edit', 'feat']);

    // Reflog text cannot recover the merge side after the operation is committed. It must
    // refuse rather than report a false clean result, even when the caller names a ref.
    const previous = process.env.GIT_REFLOG_ACTION;
    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      expect(main([], { cwd: dir })).toBe(2);
      expect(git(['show', 'HEAD:f.txt'])).not.toContain('BRANCH');

      // Removing the caller-controlled value yields the same refusal.
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

  it('reports an incoming whole-file deletion discarded by `-s ours`', () => {
    write('f.txt', 'base\n');
    write('other.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'f.txt']);
    commit('branch deletes the whole file');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main edits the file\n');
    commit('main edits the deleted file');

    const seen = mergeAndInspect('feat', { args: ['--no-commit', '-s', 'ours'] });

    expect(seen.takeovers.map((takeover) => takeover.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].deleted).toBe(1);
    expect(seen.takeovers[0].incomingDeletedPath).toBe(true);
    expect(seen.takeovers[0].reason).toContain('incoming side deleted this path');

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });
    expect(stderr).toContain('the incoming commit has no blob at that path');
    expect(stderr).toContain('fails by design');
    expect(stderr).toContain('Listed paths are JSON-escaped');
  });

  it('accepts an incoming modify/delete conflict explicitly resolved by deleting the path', () => {
    write('f.txt', 'base\n');
    write('other.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'f.txt']);
    commit('branch deletes the whole file');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main edit\n');
    commit('main edits the deleted file');

    const seen = mergeAndInspect('feat', { resolve: () => git(['rm', '-qf', 'f.txt']) });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers).toEqual([]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).toBe('');
  });

  it('accepts an incoming modify/delete conflict explicitly resolved by keeping HEAD', () => {
    write('f.txt', 'base\n');
    write('other.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'f.txt']);
    commit('branch deletes the whole file');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main edit\n');
    commit('main edits the deleted file');

    const seen = mergeAndInspect('feat', {
      resolve: () => {
        git(['checkout', '--ours', '--', 'f.txt']);
        git(['add', 'f.txt']);
      },
    });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers).toEqual([]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).toBe('');
  });

  it('reports an incoming deletion result that removes HEAD changes without resolve-undo evidence', () => {
    write('f.txt', 'base\n');
    write('other.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'f.txt']);
    commit('branch deletes the whole file');
    git(['checkout', '-q', 'main']);
    write('f.txt', 'main edit\n');
    commit('main edits the deleted file');

    const head = sha();
    const incoming = git(['rev-parse', 'feat']);
    // Model a result tree where the incoming deletion won without a recorded
    // modify/delete resolution. A manually staged deletion is covered above and is allowed.
    const seen = findTakeovers({ cwd: dir, head, incoming, resultTree: git(['rev-parse', 'feat^{tree}']) });

    expect(seen.takeovers.map((takeover) => takeover.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].kind).toBe('discarded-merged-into-change');
    expect(seen.takeovers[0].deleted).toBe(1);
    expect(seen.takeovers[0].reason).toContain("this side's committed change");
  });

  it('allows an incoming whole-file deletion when HEAD has no change since base', () => {
    write('f.txt', 'base\n');
    commit('base');

    git(['checkout', '-qb', 'feat']);
    git(['rm', '-q', 'f.txt']);
    commit('branch deletes the whole file');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main work\n');
    commit('main advances elsewhere');

    const seen = mergeAndInspect('feat', { args: ['--no-commit', '-X', 'theirs'] });

    expect(seen.takeovers).toEqual([]);
  });

  it('escapes newlines and terminal controls in paths printed by the refusal', () => {
    const unsafePath = 'bad\n\u001b[31mforged.txt';
    write('other.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write(unsafePath, 'incoming\n');
    commit('branch adds a control-character path');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main changed elsewhere\n');
    commit('main advances');

    const seen = mergeAndInspect('feat', { args: ['--no-commit', '-s', 'ours'] });
    expect(seen.takeovers.map((takeover) => takeover.path)).toEqual([unsafePath]);

    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(1);
    });
    expect(stderr).toContain(JSON.stringify(unsafePath));
    expect(stderr).not.toContain(unsafePath);
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
    // one-sided decision — git copied one side's blob for the whole path. A conflict
    // resolution that chooses one side verbatim remains detectable and is reported. A custom
    // resolution that combines neither side's blob is outside this detector's boundary;
    // reporting every such resolution would also report ordinary hand-edited merges.
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

  it('accepts a modify/delete conflict resolved by deleting the path', () => {
    write('f.txt', 'a\nb\nc\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', 'a\nb\nc\nBRANCH\n');
    commit('branch modifies f');
    git(['checkout', '-q', 'main']);
    git(['rm', '-q', 'f.txt']);
    commit('main deletes f');

    const seen = mergeAndInspect('feat', { resolve: () => git(['rm', '-qf', 'f.txt']) });

    expect(seen.conflicted).toBe(true);
    expect(seen.takeovers).toEqual([]);
    const stderr = captureStderr(() => {
      expect(main([], { cwd: dir })).toBe(0);
    });
    expect(stderr).toBe('');
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

  it('preserves leading whitespace in NUL-delimited path scans', () => {
    write('base.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write(' branch.txt', 'incoming\n');
    commit('branch adds a leading-space path');
    git(['checkout', '-q', 'main']);
    write('base.txt', 'main moved on\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual([' branch.txt']);
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

  it('reports a lost interior blank line that separates Markdown paragraphs', () => {
    write('f.md', '# Heading\nParagraph\n');
    write('other.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.md', '# Heading\n\nParagraph\n');
    commit('branch adds a paragraph separator');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main moved on\n');
    commit('main moves on elsewhere');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.md']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('reports a lost blank record at end of file', () => {
    write('f.md', 'Paragraph\n');
    write('other.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.md', 'Paragraph\n\n');
    commit('branch adds a terminal blank record');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main moved on\n');
    commit('main moves on elsewhere');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.md']);
    expect(seen.takeovers[0].deleted).toBe(1);
  });

  it('uses byte identity for malformed UTF-8 instead of collapsing replacement characters', () => {
    write('f.txt', Buffer.from([0x61, 0x0a, 0x78, 0xff, 0x0a]));
    write('other.txt', 'base\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    write('f.txt', Buffer.from([0x61, 0x0a, 0x78, 0xfe, 0x0a]));
    commit('branch changes malformed byte');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main moved on\n');
    commit('main moves on elsewhere');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

    expect(seen.takeovers.map((t) => t.path)).toEqual(['f.txt']);
    expect(seen.takeovers[0].deleted).toBe(Number.POSITIVE_INFINITY);
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

  it('reports a branch mode-only change swallowed by `-s ours`', () => {
    write('f.txt', 'alpha\n');
    commit('base');
    git(['checkout', '-qb', 'feat']);
    git(['update-index', '--chmod=+x', 'f.txt']);
    chmodSync(join(dir, 'f.txt'), 0o755);
    commitIndexOnly('branch makes f executable');
    git(['checkout', '-q', 'main']);
    write('other.txt', 'main moved on\n');
    commit('main moves on');

    const seen = mergeAndInspect('feat', { args: ['-s', 'ours'] });

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
    expect(stderr).toContain('git commit --no-verify');
    expect(stderr).not.toContain('git merge --no-verify');
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
    gitOk(['merge', '--no-commit', '--no-ff', 'feat']);
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
    // Disjoint, so the merge is clean, and `--no-commit` so the prepared MERGE_HEAD and
    // pre-merge HEAD remain available to the manual inspection command. A self-committing
    // clean merge would reach the hook before this guard can identify the incoming commit.
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
  it('throws when no prepared MERGE_HEAD exists, regardless of reflog text', () => {
    write('f.txt', 'x\n');
    commit('base');
    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge no-such-ref-anywhere';
    try {
      expect(() => resolveIncomingRef(dir)).toThrow(/Git has not written MERGE_HEAD/);
    } finally {
      restoreAction(previous);
    }
  });

  it('resolves the actual incoming commit from MERGE_HEAD even when reflog text is spoofed', () => {
    const refs = prepareDisjointMerge();
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    const previous = process.env.GIT_REFLOG_ACTION;
    process.env.GIT_REFLOG_ACTION = 'merge main';
    try {
      expect(resolveIncomingRef(dir)).toBe(refs.incoming);
    } finally {
      restoreAction(previous);
      git(['merge', '--abort']);
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

describe('pinned main landing', () => {
  it('refuses a direct self-committing merge even when reflog text names the reviewed candidate', () => {
    const refs = prepareDisjointMerge();
    installPreMergeGuard();
    const previous = process.env.GIT_REFLOG_ACTION;
    let failure;

    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      try {
        withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
          git(['merge', '--no-ff', '--no-edit', 'feat']);
        });
      } catch (error) {
        failure = error;
      }
    } finally {
      restoreAction(previous);
    }

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('direct self-committing merges are refused');
    expect(sha()).toBe(refs.main);
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) {
      git(['merge', '--abort']);
    }
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a direct self-committing merge on a feature branch in the same worktree', () => {
    const refs = prepareDisjointMerge();
    git(['checkout', '-qb', 'target', refs.main]);
    installPreMergeGuard();
    const previous = process.env.GIT_REFLOG_ACTION;
    let failure;

    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      try {
        git(['merge', '--no-ff', '--no-edit', 'feat']);
      } catch (error) {
        failure = error;
      }
    } finally {
      restoreAction(previous);
    }

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('direct self-committing merges are refused');
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', '--verify', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    expect(gitOk(['rev-parse', '--verify', 'MERGE_HEAD']).ok).toBe(false);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a direct self-committing merge in a linked feature worktree', () => {
    const refs = prepareDisjointMerge();
    const linked = mkdtempSync(join(tmpdir(), 'merge-guard-linked-'));
    rmSync(linked, { recursive: true, force: true });
    git(['worktree', 'add', '-b', 'linked-target', linked, refs.main]);
    installPreMergeGuard();
    const previous = process.env.GIT_REFLOG_ACTION;
    let failure;

    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      try {
        gitAt(linked, ['merge', '--no-ff', '--no-edit', 'feat']);
      } catch (error) {
        failure = error;
      }
    } finally {
      restoreAction(previous);
      if (gitOk(['-C', linked, 'rev-parse', '--verify', 'MERGE_HEAD']).ok) gitAt(linked, ['merge', '--abort']);
      removePreMergeGuard();
      git(['worktree', 'remove', linked]);
    }

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('direct self-committing merges are refused');
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('requires the reviewed parent and tree pins before committing a prepared merge on main', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    let failure;

    withNoExpectedLanding(() => {
      try {
        git(['commit', '-m', 'un-pinned merge']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('expected landing requires KILO_EXPECTED_MAIN_SHA');
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses the exact pins when the shared index is used for the commit', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      try {
        git(['commit', '-m', 'shared index landing']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('main landing requires a private index snapshot');
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a caller-controlled alternate index without the helper workflow marker', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    const isolatedIndex = join(dir, 'caller-controlled-index');
    copyFileSync(join(dir, '.git', 'index'), isolatedIndex);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      try {
        execFileSync('git', ['commit', '-m', 'direct alternate index\n\nBranch: feat\nChat: test-session'], {
          cwd: dir,
          env: { ...process.env, GIT_INDEX_FILE: isolatedIndex },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('private index snapshot');
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    rmSync(isolatedIndex, { force: true });
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('accepts the exact main and incoming SHAs from actual MERGE_HEAD state', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
      commitReviewedLanding('pinned merge\n\nBranch: feat\nChat: test-session');
    });

    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ');
    expect(parents[1]).toBe(refs.main);
    expect(parents[2]).toBe(refs.incoming);
  });

  it('commits the reviewed snapshot while preserving later staging in the shared index', () => {
    const refs = prepareDisjointMerge();
    const sharedPath = 'staged-after-hook.txt';
    write(sharedPath, 'another main-worktree writer staged this after the guards\n');
    installPinnedPreCommitGuards({ afterChecks: `unset GIT_INDEX_FILE\ngit add ${sharedPath}` });

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      commitReviewedLanding('isolated pinned merge\n\nBranch: feat\nChat: test-session');
    });

    expect(git(['rev-parse', 'HEAD^{tree}'])).toBe(refs.incomingTree);
    expect(gitOk(['cat-file', '-e', `HEAD:${sharedPath}`]).ok).toBe(false);
    expect(git(['status', '--porcelain'])).toContain(`A  ${sharedPath}`);
    removePreMergeGuard();
  });

  it('binds the source branch and chat trailers to the reviewed candidate', () => {
    const refs = prepareDisjointMerge();
    git(['branch', 'wrong-feat', refs.base]);
    git(['merge', '--no-commit', '--no-ff', 'feat']);

    const messages = [
      'wrong branch\n\nBranch: wrong-feat\nChat: test-session',
      'wrong chat\n\nBranch: feat\nChat: another-session',
      'duplicate branch\n\nBranch: feat\nBranch: feat\nChat: test-session',
      'duplicate chat\n\nBranch: feat\nChat: test-session\nChat: test-session',
      'missing chat\n\nBranch: feat',
    ];
    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      for (const message of messages) {
        let failure;
        try {
          commitReviewedLanding(message);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeDefined();
        expect(String(failure.stderr)).toContain(
          'merge message must have exactly one Branch: feat and Chat: test-session trailer'
        );
      }
    });

    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a prepare-commit-msg hook that changes the reviewed Chat trailer', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nnode -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,m.replace("Chat: test-session","Chat: altered-session"));' "$1"\n`
    );
    chmodSync(prepareHook, 0o755);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      try {
        commitReviewedLanding('pinned merge\n\nBranch: feat\nChat: test-session');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain("commit-reviewed-landing-message-guard: Git's final merge message");
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a prepare-commit-msg hook that removes MERGE_HEAD during a reviewed landing', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nnode -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,m.replace("Chat: test-session","Chat: altered-session"));' "$1"\nrm -f "$(git rev-parse --git-path MERGE_HEAD)"\n`
    );
    chmodSync(prepareHook, 0o755);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      try {
        commitReviewedLanding('pinned merge\n\nBranch: feat\nChat: test-session');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge markers disappeared after pre-commit'
    );
    expect(sha()).toBe(refs.main);
    expect(gitOk(['rev-parse', 'MERGE_HEAD']).ok).toBe(false);
    git(['reset', '--hard', 'main']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a prepare-commit-msg hook that changes symbolic HEAD during a reviewed landing', () => {
    const refs = prepareDisjointMerge();
    git(['branch', 'attacker']);
    installPinnedPreCommitGuards();
    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nnode -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,m.replace("Chat: test-session","Chat: altered-session"));' "$1"\ngit symbolic-ref HEAD refs/heads/attacker\n`
    );
    chmodSync(prepareHook, 0o755);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      try {
        commitReviewedLanding('pinned merge\n\nBranch: feat\nChat: test-session');
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: reviewed landing checkout changed away from the designated main worktree'
    );
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('requires a Chat trailer for an operator hotfix on main', () => {
    const refs = prepareDisjointMerge();
    installMainWorktreeCommitGuards();
    write('hotfix.txt', 'hotfix\n');
    git(['add', 'hotfix.txt']);

    let missingChatFailure;
    try {
      execFileSync('git', ['commit', '-m', 'Hotfix: missing attribution'], {
        cwd: dir,
        env: { ...process.env, ALLOW_MAIN_COMMIT: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      missingChatFailure = error;
    }
    expect(missingChatFailure).toBeDefined();
    expect(String(missingChatFailure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: an operator hotfix on main must have exactly one non-empty Chat: trailer'
    );
    expect(sha()).toBe(refs.main);

    execFileSync('git', ['commit', '-m', 'Hotfix: attributed', '-m', 'Chat: operator-session'], {
      cwd: dir,
      env: { ...process.env, ALLOW_MAIN_COMMIT: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(sha()).not.toBe(refs.main);
    expect(git(['show', '-s', '--format=%B', 'HEAD'])).toContain('Chat: operator-session');
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a main hotfix while AUTO_MERGE remains after MERGE_HEAD disappears', () => {
    const refs = prepareDisjointMerge();

    git(['checkout', '-qb', 'hotfix-conflict', refs.base]);
    write('base.txt', 'feature conflict\n');
    commit('feature conflict');
    git(['checkout', '-q', 'main']);
    write('base.txt', 'main conflict\n');
    commit('main conflict');
    const mainBeforeHotfix = sha();
    installMainWorktreeCommitGuards();

    const merge = gitOk(['merge', '--no-commit', '--no-ff', 'hotfix-conflict']);
    expect(merge.ok).toBe(false);
    write('base.txt', 'resolved conflict\n');
    git(['add', 'base.txt']);
    const autoMergePath = resolve(dir, git(['rev-parse', '--git-path', 'AUTO_MERGE']));
    const mergeHeadPath = resolve(dir, git(['rev-parse', '--git-path', 'MERGE_HEAD']));
    expect(existsSync(autoMergePath)).toBe(true);
    rmSync(mergeHeadPath, { force: true });

    write('hotfix.txt', 'hotfix beside the unresolved merge\n');
    git(['add', 'hotfix.txt']);
    let failure;
    try {
      execFileSync('git', ['commit', '-m', 'Hotfix: interrupted merge', '-m', 'Chat: operator-session'], {
        cwd: dir,
        env: { ...process.env, ALLOW_MAIN_COMMIT: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('AUTO_MERGE remains');
    expect(sha()).toBe(mainBeforeHotfix);
    expect(existsSync(autoMergePath)).toBe(true);
  });

  it('allows optional expected pins on a feature-worktree merge', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    let missingChatFailure;
    try {
      gitAt(featureWorktree, ['commit', '-m', 'Feature change without attribution']);
    } catch (error) {
      missingChatFailure = error;
    }
    expect(missingChatFailure).toBeDefined();
    expect(String(missingChatFailure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: every commit must have exactly one non-empty Chat: trailer'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(refs.main);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);

    installPinnedPreCommitGuards();
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    const resultTree = gitAt(featureWorktree, ['write-tree']);
    withExpectedLanding(
      { main: featureHead, incoming: refs.incoming, tree: resultTree, branch: 'feat', chat: 'test-session' },
      () => {
        gitAt(featureWorktree, ['commit', '-m', 'Feature merge\n\nBranch: feat\nChat: test-session']);
      }
    );

    const landed = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD^{tree}'])).toBe(resultTree);
    expect(gitAt(featureWorktree, ['rev-list', '--parents', '-n', '1', landed]).split(' ')).toEqual([
      landed,
      featureHead,
      refs.incoming,
    ]);
    expect(gitAt(featureWorktree, ['show', '-s', '--format=%B', landed])).toContain('Chat: test-session');
    removePreMergeGuard();
  });

  it('binds optional feature-worktree merge pins to the final message and prepared MERGE_HEAD', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards();

    const messageArgs = ['commit', '-m', 'Feature merge\n\nBranch: feat\nChat: test-session'];
    const attemptPinnedCommit = (resultTree) => {
      let failure;
      withExpectedLanding(
        { main: featureHead, incoming: refs.incoming, tree: resultTree, branch: 'feat', chat: 'test-session' },
        () => {
          try {
            gitAt(featureWorktree, messageArgs);
          } catch (error) {
            failure = error;
          }
        }
      );
      expect(failure).toBeDefined();
      expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    };
    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');

    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    let resultTree = gitAt(featureWorktree, ['write-tree']);
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nnode -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,m.replace("Chat: test-session","Chat: altered-session"));' "$1"\n`
    );
    chmodSync(prepareHook, 0o755);
    attemptPinnedCommit(resultTree);
    expect(gitAt(featureWorktree, ['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    gitAt(featureWorktree, ['merge', '--abort']);

    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    resultTree = gitAt(featureWorktree, ['write-tree']);
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nnode -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=fs.readFileSync(p,"utf8"); fs.writeFileSync(p,m.replace("Branch: feat","Branch: changed-branch"));' "$1"\n`
    );
    chmodSync(prepareHook, 0o755);
    attemptPinnedCommit(resultTree);
    expect(gitAt(featureWorktree, ['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    gitAt(featureWorktree, ['merge', '--abort']);

    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    resultTree = gitAt(featureWorktree, ['write-tree']);
    writeFileSync(prepareHook, `#!/bin/sh\nrm -f "$(git rev-parse --git-path MERGE_HEAD)"\n`);
    chmodSync(prepareHook, 0o755);
    let disappearedMergeFailure;
    withExpectedLanding(
      { main: featureHead, incoming: refs.incoming, tree: resultTree, branch: 'feat', chat: 'test-session' },
      () => {
        try {
          gitAt(featureWorktree, messageArgs);
        } catch (error) {
          disappearedMergeFailure = error;
        }
      }
    );
    expect(disappearedMergeFailure).toBeDefined();
    expect(String(disappearedMergeFailure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge markers disappeared after pre-commit'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    let mergeHeadAfterRemoval = null;
    try {
      mergeHeadAfterRemoval = gitAt(featureWorktree, ['rev-parse', '--verify', 'MERGE_HEAD']);
    } catch {
      // The prepare hook deliberately removed the merge record before commit-msg ran.
    }
    expect(mergeHeadAfterRemoval).toBeNull();

    gitAt(featureWorktree, ['reset', '--hard', featureHead]);
    rmSync(prepareHook, { force: true });
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    resultTree = gitAt(featureWorktree, ['write-tree']);
    withExpectedLanding(
      { main: featureHead, incoming: refs.incoming, tree: resultTree, branch: 'feat', chat: 'test-session' },
      () => gitAt(featureWorktree, messageArgs)
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD^{tree}'])).toBe(resultTree);
  });

  it('refuses an unpinned feature merge whose prepared tree changes after pre-commit', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards();

    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    const resultTree = gitAt(featureWorktree, ['write-tree']);
    expect(recordPreparedMergeState(featureWorktree).status).toBe(0);
    writeFileSync(prepareHook, '#!/bin/sh\ngit rm -f feature.txt\n');
    chmodSync(prepareHook, 0o755);

    let failure;
    withNoExpectedLanding(() => {
      try {
        gitAt(featureWorktree, ['commit', '-m', 'Unpinned feature merge', '-m', 'Chat: test-session']);
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge parents or result tree changed after pre-commit'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    expect(gitAt(featureWorktree, ['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    expect(gitAt(featureWorktree, ['write-tree'])).not.toBe(resultTree);

    gitAt(featureWorktree, ['merge', '--abort']);
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    expect(recordPreparedMergeState(featureWorktree).status).toBe(0);
    writeFileSync(prepareHook, '#!/bin/sh\nrm -f "$(git rev-parse --git-path MERGE_HEAD)"\n');
    chmodSync(prepareHook, 0o755);
    let disappearedMergeFailure;
    withNoExpectedLanding(() => {
      try {
        gitAt(featureWorktree, ['commit', '-m', 'Unpinned feature merge', '-m', 'Chat: test-session']);
      } catch (error) {
        disappearedMergeFailure = error;
      }
    });
    expect(disappearedMergeFailure).toBeDefined();
    expect(String(disappearedMergeFailure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge markers disappeared after pre-commit'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
  });

  it('refuses an unpinned feature merge if pre-commit removes both merge markers', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards({
      afterChecks:
        'rm -f "$(git rev-parse --git-path MERGE_HEAD)" "$(git rev-parse --git-path MERGE_MSG)"\ngit rm -f feature.txt\nprintf "pre-commit change\\n" > gate-change.txt\ngit add gate-change.txt\nexit 1',
    });
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);

    let failure;
    withNoExpectedLanding(() => {
      try {
        gitAt(featureWorktree, ['commit', '-m', 'Unpinned feature merge', '-m', 'Chat: test-session']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge markers disappeared during pre-commit'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    const retryRecord = recordPreparedMergeState(featureWorktree);
    expect(retryRecord.status).not.toBe(0);
    expect(retryRecord.stderr).toContain('prepared merge state records missing merge markers');
    expect(gitAt(featureWorktree, ['write-tree'])).not.toBe(gitAt(featureWorktree, ['rev-parse', 'HEAD^{tree}']));

    gitAt(featureWorktree, ['reset', '--hard', featureHead]);
    const autoMergePath = resolve(featureWorktree, gitAt(featureWorktree, ['rev-parse', '--git-path', 'AUTO_MERGE']));
    rmSync(autoMergePath, { force: true });
    const discard = spawnSync(process.execPath, [LANDING_MESSAGE_GUARD_PATH, '--discard-abandoned-prepared-merge'], {
      cwd: featureWorktree,
      encoding: 'utf8',
    });
    expect(discard.status, discard.stderr).toBe(0);
    const mergeStatePath = resolve(
      featureWorktree,
      gitAt(featureWorktree, ['rev-parse', '--git-path', 'kilo-prepared-merge-state.json'])
    );
    expect(existsSync(mergeStatePath)).toBe(false);
    const recoveredPreCommit = join(dir, 'hooks', 'pre-commit');
    writeFileSync(
      recoveredPreCommit,
      `#!/bin/sh\nnode "${LANDING_MESSAGE_GUARD_PATH}" --record-prepared-merge-before || exit $?\nnode "${MAIN_GUARD_PATH}" || exit $?\nnode "${LANDING_MESSAGE_GUARD_PATH}" --record-prepared-merge-after\n`
    );
    chmodSync(recoveredPreCommit, 0o755);
    writeFileSync(join(featureWorktree, 'ordinary-after-recovery.txt'), 'ordinary commit after recovery\n');
    gitAt(featureWorktree, ['add', 'ordinary-after-recovery.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Ordinary after recovery', '-m', 'Chat: test-session']);
  });

  it('clears aborted merge state when MERGE_MSG remains behind', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    installPinnedPreCommitGuards();
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    expect(recordPreparedMergeState(featureWorktree).status).toBe(0);

    gitAt(featureWorktree, ['merge', '--abort']);
    const mergeMessagePath = resolve(featureWorktree, gitAt(featureWorktree, ['rev-parse', '--git-path', 'MERGE_MSG']));
    writeFileSync(mergeMessagePath, 'Stale message left by the aborted merge\n');
    expect(recordPreparedMergeState(featureWorktree).status).toBe(0);

    const statePath = resolve(
      featureWorktree,
      gitAt(featureWorktree, ['rev-parse', '--git-path', 'kilo-prepared-merge-state.json'])
    );
    expect(existsSync(statePath)).toBe(false);
    const preCommitHook = join(dir, 'hooks', 'pre-commit');
    writeFileSync(preCommitHook, '#!/bin/sh\nexit 0\n');
    chmodSync(preCommitHook, 0o755);
    writeFileSync(join(featureWorktree, 'ordinary-change.txt'), 'ordinary\n');
    gitAt(featureWorktree, ['add', 'ordinary-change.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Ordinary commit', '-m', 'Chat: test-session']);
    expect(gitAt(featureWorktree, ['show', 'HEAD:ordinary-change.txt'])).toBe('ordinary');
  });

  it('discards an aborted prepared merge before recording a different merge', () => {
    const refs = prepareDisjointMerge();
    git(['checkout', '-qb', 'other', refs.base]);
    write('other.txt', 'other feature\n');
    commit('other feature change');
    git(['checkout', '-q', 'main']);
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards({ afterChecks: 'exit 1' });
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);

    let firstCommitFailure;
    try {
      gitAt(featureWorktree, ['commit', '-m', 'Failed feature merge', '-m', 'Chat: test-session']);
    } catch (error) {
      firstCommitFailure = error;
    }
    expect(firstCommitFailure).toBeDefined();
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    expect(gitAt(featureWorktree, ['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
    gitAt(featureWorktree, ['merge', '--abort']);

    installPinnedPreCommitGuards();
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'other']);
    let changedParentsFailure;
    try {
      gitAt(featureWorktree, ['commit', '-m', 'Other feature merge', '-m', 'Chat: test-session']);
    } catch (error) {
      changedParentsFailure = error;
    }
    expect(changedParentsFailure).toBeDefined();
    expect(String(changedParentsFailure.stderr)).toContain('prepared merge parents changed before pre-commit');
    expect(String(changedParentsFailure.stderr)).toContain('--discard-abandoned-prepared-merge');
    gitAt(featureWorktree, ['merge', '--abort']);

    const discard = spawnSync(process.execPath, [LANDING_MESSAGE_GUARD_PATH, '--discard-abandoned-prepared-merge'], {
      cwd: featureWorktree,
      encoding: 'utf8',
    });
    expect(discard.status, discard.stderr).toBe(0);
    const mergeStatePath = resolve(
      featureWorktree,
      gitAt(featureWorktree, ['rev-parse', '--git-path', 'kilo-prepared-merge-state.json'])
    );
    expect(existsSync(mergeStatePath)).toBe(false);

    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'other']);
    gitAt(featureWorktree, ['commit', '-m', 'Other feature merge', '-m', 'Chat: test-session']);
    expect(gitAt(featureWorktree, ['show', 'HEAD:other.txt'])).toBe('other feature');
    expect(gitAt(featureWorktree, ['ls-tree', '--name-only', 'HEAD'])).not.toContain('feature.txt');
  });

  it('rejects an unpinned feature merge whose MERGE_HEAD becomes octopus after pre-commit', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards();

    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    writeFileSync(
      prepareHook,
      `#!/bin/sh\nprintf '%s\\n' '${refs.base}' >> "$(git rev-parse --git-path MERGE_HEAD)"\n`
    );
    chmodSync(prepareHook, 0o755);
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);

    let failure;
    withNoExpectedLanding(() => {
      try {
        gitAt(featureWorktree, ['commit', '-m', 'Unpinned feature merge', '-m', 'Chat: test-session']);
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: feature merge requires exactly one incoming commit; refusing an octopus merge'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);
    const mergeHeadPath = resolve(featureWorktree, gitAt(featureWorktree, ['rev-parse', '--git-path', 'MERGE_HEAD']));
    expect(readFileSync(mergeHeadPath, 'utf8').trim().split('\n')).toEqual([refs.incoming, refs.base]);
  });

  it('refuses an unpinned feature merge if prepare-commit-msg removes both merge markers', () => {
    const refs = prepareDisjointMerge();
    const featureWorktree = join(dir, 'feature-worktree');
    git(['worktree', 'add', '-qb', 'feature-target', featureWorktree, refs.main]);
    installMainWorktreeCommitGuards();

    writeFileSync(join(featureWorktree, 'feature-note.txt'), 'feature note\n');
    gitAt(featureWorktree, ['add', 'feature-note.txt']);
    gitAt(featureWorktree, ['commit', '-m', 'Feature change', '-m', 'Chat: test-session']);
    const featureHead = gitAt(featureWorktree, ['rev-parse', 'HEAD']);
    installPinnedPreCommitGuards();
    gitAt(featureWorktree, ['merge', '--no-commit', '--no-ff', 'feat']);
    const recorded = recordPreparedMergeState(featureWorktree);
    expect(recorded.status, recorded.stderr).toBe(0);

    const prepareHook = join(dir, 'hooks', 'prepare-commit-msg');
    writeFileSync(
      prepareHook,
      '#!/bin/sh\n' +
        'git rm -f feature.txt >/dev/null\n' +
        'rm -f "$(git rev-parse --git-path MERGE_HEAD)" "$(git rev-parse --git-path MERGE_MSG)"\n'
    );
    chmodSync(prepareHook, 0o755);

    let failure;
    withNoExpectedLanding(() => {
      try {
        gitAt(featureWorktree, ['commit', '-m', 'Unpinned feature merge', '-m', 'Chat: test-session']);
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'commit-reviewed-landing-message-guard: prepared merge markers disappeared after pre-commit'
    );
    expect(gitAt(featureWorktree, ['rev-parse', 'HEAD'])).toBe(featureHead);

    gitAt(featureWorktree, ['reset', '--hard', featureHead]);
    const clearedAfterAbort = recordPreparedMergeState(featureWorktree);
    expect(clearedAfterAbort.status, clearedAfterAbort.stderr).toBe(0);
    const mergeStatePath = resolve(
      featureWorktree,
      gitAt(featureWorktree, ['rev-parse', '--git-path', 'kilo-prepared-merge-state.json'])
    );
    expect(existsSync(mergeStatePath)).toBe(false);
  });

  it('requires the reviewed source branch ref to point at the incoming candidate', () => {
    const refs = prepareDisjointMerge();
    git(['branch', 'wrong-feat', refs.base]);
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    let failure;

    withExpectedLanding(
      { main: refs.main, incoming: refs.incoming, tree: refs.incomingTree, branch: 'wrong-feat' },
      () => {
        try {
          commitReviewedLanding('wrong source ref\n\nBranch: wrong-feat\nChat: test-session');
        } catch (error) {
          failure = error;
        }
      }
    );

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain(
      'expected source branch does not point to the reviewed incoming candidate'
    );
    expect(sha()).toBe(refs.main);
    git(['merge', '--abort']);
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses octopus merges in both the landing helper and pre-commit guard', () => {
    const refs = prepareDisjointMerge();
    git(['checkout', '-qb', 'feat-two', refs.base]);
    write('second-feature.txt', 'second candidate\n');
    commit('second feature change');
    const secondIncoming = sha();
    git(['checkout', '-q', 'main']);
    installPinnedPreCommitGuards();
    git(['merge', '--no-commit', '--no-ff', 'feat', 'feat-two']);
    const preparedTree = git(['write-tree']);

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: preparedTree }, () => {
      let helperFailure;
      try {
        commitReviewedLanding('octopus landing\n\nBranch: feat\nChat: test-session');
      } catch (error) {
        helperFailure = error;
      }
      expect(helperFailure).toBeDefined();
      expect(String(helperFailure.stderr)).toContain('refusing an octopus merge');

      const isolatedIndex = join(dir, 'isolated-index');
      copyFileSync(join(dir, '.git', 'index'), isolatedIndex);
      let hookFailure;
      try {
        execFileSync('git', ['commit', '-m', 'octopus landing\n\nBranch: feat\nChat: test-session'], {
          cwd: dir,
          env: { ...process.env, GIT_INDEX_FILE: isolatedIndex },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        hookFailure = error;
      } finally {
        rmSync(isolatedIndex, { force: true });
      }
      expect(hookFailure).toBeDefined();
      expect(String(hookFailure.stderr)).toContain('refusing an octopus merge');
    });

    expect(sha()).toBe(refs.main);
    const mergeHeadPath = resolve(dir, git(['rev-parse', '--git-path', 'MERGE_HEAD']));
    expect(readFileSync(mergeHeadPath, 'utf8').trim().split('\n')).toEqual([refs.incoming, secondIncoming]);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('finds its reviewed landing if main advances before the helper returns', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    const postCommit = join(dir, 'hooks', 'post-commit');
    writeFileSync(
      postCommit,
      '#!/bin/sh\nunset GIT_INDEX_FILE\nprintf "later main work\\n" > later-main.txt\ngit add later-main.txt\ngit -c core.hooksPath=/dev/null commit -m "next main commit" >/dev/null\n'
    );
    chmodSync(postCommit, 0o755);

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      git(['merge', '--no-commit', '--no-ff', 'feat']);
      commitReviewedLanding('pinned merge with concurrent advance\n\nBranch: feat\nChat: test-session');
    });

    const firstParentCommits = git(['rev-list', '--first-parent', '--reverse', `${refs.main}..HEAD`]).split('\n');
    expect(firstParentCommits).toHaveLength(2);
    const landedParents = git(['rev-list', '--parents', '-n', '1', firstParentCommits[0]]).split(' ');
    expect(landedParents[1]).toBe(refs.main);
    expect(landedParents[2]).toBe(refs.incoming);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses an index changed after the reviewed candidate merge was prepared', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    git(['merge', '--no-commit', '--no-ff', 'feat']);
    write('main.txt', 'unreviewed landing edit\n');
    git(['add', 'main.txt']);
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      try {
        git(['commit', '-m', 'changed merge tree']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('prepared merge tree changed since review');
    expect(sha()).toBe(refs.main);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a clean merge prepared against a newer main than the reviewed SHA', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    let failure;

    withExpectedLanding({ main: refs.base, incoming: refs.incoming, tree: refs.incomingTree }, () => {
      try {
        git(['merge', '--no-commit', '--no-ff', 'feat']);
        git(['commit', '-m', 'stale main pin']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('main moved since the candidate was reviewed');
    expect(sha()).toBe(refs.main);
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) {
      expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
      git(['merge', '--abort']);
    }
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('refuses a different incoming commit than the reviewed candidate SHA', () => {
    const refs = prepareDisjointMerge();
    installPinnedPreCommitGuards();
    let failure;

    withExpectedLanding({ main: refs.main, incoming: refs.base, tree: refs.incomingTree }, () => {
      try {
        git(['merge', '--no-commit', '--no-ff', 'feat']);
        git(['commit', '-m', 'wrong incoming pin']);
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('incoming candidate changed since review');
    expect(sha()).toBe(refs.main);
    if (existsSync(join(dir, '.git', 'MERGE_HEAD'))) {
      expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(refs.incoming);
      git(['merge', '--abort']);
    }
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
  });

  it('ignores spoofed reflog text when the prepared incoming commit differs from the reviewed one', () => {
    const refs = prepareDisjointMerge();
    git(['checkout', '-q', refs.base]);
    git(['checkout', '-qb', 'impostor']);
    write('impostor.txt', 'different incoming commit\n');
    commit('impostor candidate');
    const impostor = sha();
    git(['checkout', '-q', 'main']);
    installPinnedPreCommitGuards();
    const previous = process.env.GIT_REFLOG_ACTION;
    let failure;

    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      withExpectedLanding({ main: refs.main, incoming: refs.incoming, tree: refs.incomingTree }, () => {
        try {
          git(['merge', '--no-commit', '--no-ff', 'impostor']);
          expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(impostor);
          git(['commit', '-m', 'spoofed reflog']);
        } catch (error) {
          failure = error;
        }
      });
    } finally {
      restoreAction(previous);
    }

    expect(failure).toBeDefined();
    expect(String(failure.stderr)).toContain('incoming candidate changed since review');
    expect(sha()).toBe(refs.main);
    expect(git(['rev-parse', 'MERGE_HEAD'])).toBe(impostor);
    git(['merge', '--abort']);
    removePreMergeGuard();
    expect(git(['status', '--porcelain'])).toBe('');
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

  it('refuses a valid but absent object instead of returning an incomplete batch', () => {
    write('f.txt', 'present\n');
    commit('base');
    const missing = execFileSync('git', ['hash-object', '--stdin'], {
      cwd: dir,
      input: 'object intentionally not written to the database\n',
      encoding: 'utf8',
    }).trim();

    expect(() => batchBlobs([missing], dir)).toThrow(/could not read requested blob/);
  });

  it('refuses when Git cannot return a complete changed-path list', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'fake-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      '#!/bin/sh\nif [ "$1" = "diff" ] && [ "$2" = "--name-only" ]; then exit 73; fi\nexec "$REAL_GIT_PATH" "$@"\n'
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(
        /git diff failed while listing HEAD-side paths/
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses invalid UTF-8 path bytes instead of collapsing distinct path identities', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'invalid-path-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-tree" ]; then printf '100644 blob 0000000000000000000000000000000000000000\\t\\377bad\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/path that is not valid UTF-8/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses successful but malformed ls-tree metadata', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'malformed-tree-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-tree" ]; then printf 'foo\\tbad.txt\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/invalid entry metadata/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses successful but malformed resolve-undo metadata', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'malformed-undo-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-files" ] && [ "$2" = "--resolve-undo" ]; then printf 'bad\\tf.txt\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/invalid metadata/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses duplicate resolve-undo stages instead of treating them as one explicit resolution', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'duplicate-undo-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    const oid = '0000000000000000000000000000000000000000';
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-files" ] && [ "$2" = "--resolve-undo" ]; then printf '100644 ${oid} 1\\tf.txt\\000100644 ${oid} 1\\tf.txt\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/duplicate path\/stage record/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses resolve-undo metadata that does not match the merge trees', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'inconsistent-undo-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    const oid = '0000000000000000000000000000000000000000';
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-files" ] && [ "$2" = "--resolve-undo" ]; then printf '100644 ${oid} 1\\tf.txt\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(
        /metadata inconsistent with the merge trees/
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('refuses non-ASCII bytes in tree metadata before ASCII decoding can normalize them', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'non-ascii-tree-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-tree" ]; then printf '\\26100644 blob 0000000000000000000000000000000000000000\\tf.txt\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/non-ASCII metadata/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
  });

  it('rejects empty NUL records instead of accepting a partial path list', () => {
    write('f.txt', 'present\n');
    commit('base');
    const bin = join(dir, 'empty-record-bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nif [ "$1" = "ls-tree" ]; then printf '100644 blob 0000000000000000000000000000000000000000\\tf.txt\\000\\000'; exit 0; fi\nexec "$REAL_GIT_PATH" "$@"\n`
    );
    chmodSync(wrapper, 0o755);

    const previousPath = process.env.PATH;
    const previousRealGit = process.env.REAL_GIT_PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ''}`;
      process.env.REAL_GIT_PATH = realGit;
      expect(() => findTakeovers({ cwd: dir, head: 'HEAD', incoming: 'HEAD' })).toThrow(/empty path record/);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRealGit === undefined) delete process.env.REAL_GIT_PATH;
      else process.env.REAL_GIT_PATH = previousRealGit;
    }
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

    const mergedInto = sha();
    const incoming = git(['rev-parse', 'feat']);
    gitOk(['merge', '--no-commit', '--no-ff', 'feat']);
    takeTheirs('f.txt');

    const previous = process.env.GIT_REFLOG_ACTION;
    try {
      process.env.GIT_REFLOG_ACTION = 'merge feat';
      const refusal = captureStderr(() => {
        expect(main([], { cwd: dir })).toBe(1);
      });
      expect(refusal).toContain(`git show ${mergedInto}:<path>`);
      expect(refusal).toContain(`git show ${incoming}:<path>`);
      expect(refusal).toContain('work after Git has staged a resolution');

      // Abort first: MERGE_HEAD is Git's prepared merge record. Once it is gone, no reflog
      // description can stand in for the actual incoming commit.
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
    gitOk(['merge', '--no-commit', '--no-ff', 'feat']);

    expect(main([], { cwd: dir })).toBe(0);
  });

  it('surfaces missing merge state as exit 2 rather than throwing out of main', () => {
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
