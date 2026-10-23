import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { decide, resolveWorktree, run, OVERRIDE_VAR } from '../main-worktree-guard.mjs';

/**
 * This file's budget, and the reason it is not Vitest's default 5s.
 *
 * The spawns here are `git init` and `git worktree add` into a temp directory,
 * measured at tens of milliseconds each against a 5s default, so the budget is
 * headroom for a cold or a loaded machine rather than a description of the work.
 * `scripts/__tests__/suite-budgets.test.mjs` derives which suites in this
 * directory need one — a file that spawns and declares none fails that guard,
 * which is how this file came to be included after being missed once.
 */
vi.setConfig({ testTimeout: 20_000 });

/**
 * Two things are under test, and the second is the one that cannot be read off
 * the source:
 *
 *  1. the RULES — which commits are refused — with no process and no repository,
 *     so the decision table is testable in microseconds;
 *  2. the INSTALLATION and the DETECTION — that `.husky/pre-commit` runs the
 *     guard, that the shared dispatcher that git actually invokes is present, and
 *     that `resolveWorktree` tells a main worktree from a linked one on a real
 *     repository.
 *
 * (2) is the one that can be silently absent. A guard that is written, tested and
 * never wired is a guard that does not exist, and a detection that answered
 * "main worktree" for every checkout would refuse every commit in the repository
 * — including the merges this guard exists to leave alone.
 */

const REPO_ROOT = realpathSync(join(import.meta.dirname, '..', '..'));

/** A `git` that cannot answer is the fail-open arm, and it is a real directory. */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function commonDir(cwd) {
  const raw = git(cwd, ['rev-parse', '--git-common-dir']);
  return raw === null ? null : resolve(cwd, raw);
}

describe('the main-worktree guard refuses a commit recorded in the main worktree', () => {
  it('refuses in the designated main worktree', () => {
    expect(decide({ worktree: { isMainWorktree: true } })).toEqual({ action: 'refuse' });
  });

  it('refuses in the primary checkout even when it has a task branch checked out', () => {
    expect(decide({ worktree: { isPrimaryWorktree: true, isMainWorktree: false, isProtectedWorktree: true } })).toEqual(
      {
        action: 'refuse',
      }
    );
  });

  it('allows in a linked worktree, which is where the rule says the work belongs', () => {
    expect(decide({ worktree: { isMainWorktree: false } })).toEqual({ action: 'allow', reason: 'linked worktree' });
  });

  it('allows when the operator asked for this commit on main by name', () => {
    expect(decide({ worktree: { isMainWorktree: true }, override: '1' })).toEqual({
      action: 'allow',
      reason: `${OVERRIDE_VAR}=1`,
    });
  });

  it('does not let the main-only override authorize a commit in the primary task checkout', () => {
    expect(
      decide({
        worktree: { isPrimaryWorktree: true, isMainWorktree: false, isProtectedWorktree: true },
        override: '1',
      })
    ).toEqual({ action: 'refuse' });
  });

  it('allows a landing only when reviewed parents, tree, and isolated index match', () => {
    const landing = {
      head: 'main-reviewed',
      incoming: 'candidate-reviewed',
      tree: 'candidate-tree',
      expectedMain: 'main-reviewed',
      expectedIncoming: 'candidate-reviewed',
      expectedTree: 'candidate-tree',
      expectedBranch: 'feature-reviewed',
      expectedChat: 'chat-reviewed',
      incomingCount: 1,
      isolatedIndex: true,
      reviewedSnapshot: true,
    };
    expect(decide({ worktree: { isMainWorktree: true }, landing })).toEqual({
      action: 'allow',
      reason: 'pinned merge landing',
    });
    expect(
      decide({ worktree: { isMainWorktree: true }, landing: { ...landing, incoming: 'other-candidate' } })
    ).toEqual({ action: 'refuse' });
    expect(decide({ worktree: { isMainWorktree: true }, landing: { ...landing, tree: 'changed-tree' } })).toEqual({
      action: 'refuse',
    });
    expect(decide({ worktree: { isMainWorktree: true }, landing: { ...landing, isolatedIndex: false } })).toEqual({
      action: 'refuse',
    });
    expect(decide({ worktree: { isMainWorktree: true }, landing: { ...landing, incoming: null } })).toEqual({
      action: 'refuse',
    });
    expect(decide({ worktree: { isMainWorktree: true }, landing: { ...landing, incomingCount: 2 } })).toEqual({
      action: 'refuse',
    });
  });

  it('treats every other value of the override as absent, including 0 and false', () => {
    // The trap this pins: a truthiness test reads `ALLOW_MAIN_COMMIT=0` as
    // permission, because in a language where `''` is falsy the string `'0'` is
    // true. So a spelling that LOOKS like a denial would behave as a bypass, and
    // the named exception would stop being a decision anyone made out loud.
    for (const override of ['', '0', 'false', 'no', 'true', 'yes', ' 1', '1 ']) {
      expect(decide({ worktree: { isMainWorktree: true }, override })).toEqual({ action: 'refuse' });
    }
  });

  it('allows when the worktree cannot be identified at all', () => {
    // Fail open on DETECTION, fail closed on POLICY. This guard is repo-scoped
    // and every checkout here is one git repository, so a git that will not
    // answer is a broken environment; blocking there trades a real gate for a
    // phantom one.
    expect(decide({ worktree: null })).toEqual({ action: 'allow', reason: 'undetectable' });
    expect(decide({})).toEqual({ action: 'allow', reason: 'undetectable' });
  });
});

describe('the refusal is a redirect, not an obstacle', () => {
  function refuseInMain() {
    const lines = [];
    let code = null;
    run({
      worktree: { isMainWorktree: true },
      env: {},
      err: { write: (chunk) => lines.push(chunk) },
      exit: (c) => {
        code = c;
      },
    });
    return { code, text: lines.join('') };
  }

  it('exits non-zero and writes the refusal to stderr', () => {
    const { code, text } = refuseInMain();
    expect(code).toBe(1);
    expect(text).toContain('refusing to record a commit in the primary or MAIN worktree');
  });

  it('names the override, the worktree command, and what not to reach for', () => {
    // An agent that hits a bare "no" commits anyway, from the same checkout, on
    // a branch nobody made. So the recipe is asserted as content, not as
    // sentiment: without a named way forward the guard only moves the failure.
    const { text } = refuseInMain();
    expect(text).toContain(`${OVERRIDE_VAR}=1`);
    expect(text).toContain('Chat: <native-session-id>');
    expect(text).toContain('git worktree add -b fix/task .kilo/worktrees/task');
    expect(text).toContain('Not git stash');
    // The allowed landing shape must be explicit, including the prepared merge state
    // and pins the hooks use to verify its parents and result tree.
    expect(text).toContain('--no-commit --no-ff');
    expect(text).toContain('MERGE_HEAD');
  });

  it('stays silent when it allows, so an ordinary commit in a worktree is quiet', () => {
    const lines = [];
    const result = run({
      worktree: { isMainWorktree: false },
      env: {},
      err: { write: (chunk) => lines.push(chunk) },
      exit: () => {
        throw new Error('the guard exited on a commit it allows');
      },
    });
    expect(result).toEqual({ refused: false, reason: 'linked worktree', code: null });
    expect(lines).toEqual([]);
  });
});

describe('the guard tells a main worktree from a linked one on a real repository', () => {
  let root;
  let linked;
  let mainLinked;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'main-worktree-guard-')));
    const init = ['-c', 'init.defaultBranch=main', '-c', 'user.email=g@e.test', '-c', 'user.name=G', 'init'];
    expect(git(root, init)).not.toBeNull();
    writeFileSync(join(root, 'a.txt'), 'a\n');
    expect(git(root, ['add', 'a.txt'])).not.toBeNull();
    expect(git(root, ['commit', '-m', 'first'])).not.toBeNull();
    expect(git(root, ['branch', 'task/root'])).not.toBeNull();
    expect(git(root, ['checkout', 'task/root'])).not.toBeNull();
    expect(git(root, ['worktree', 'add', '-b', 'fix/task', join(root, 'wt')])).not.toBeNull();
    linked = join(root, 'wt');
    mainLinked = join(root, 'main-wt');
    expect(git(root, ['worktree', 'add', mainLinked, 'main'])).not.toBeNull();
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('protects a linked checkout of refs/heads/main, even when it is not Git’s primary worktree', () => {
    const worktree = resolveWorktree(mainLinked);
    expect(worktree).toMatchObject({ branchRef: 'refs/heads/main', isMainWorktree: true });
    expect(decide({ worktree })).toEqual({ action: 'refuse' });
  });

  it('keeps the designated checkout protected if its branch changes from main', () => {
    const original = resolveWorktree(mainLinked);
    expect(original).toMatchObject({ isMainWorktree: true, isDesignatedMainWorktree: true });

    const switchBranch = spawnSync('git', ['switch', '--quiet', '-c', 'feature-from-main'], {
      cwd: mainLinked,
      encoding: 'utf8',
    });
    expect(switchBranch.status, switchBranch.stderr).toBe(0);

    const switched = resolveWorktree(mainLinked);
    expect(switched).toMatchObject({
      branchRef: 'refs/heads/feature-from-main',
      isMainWorktree: false,
      isDesignatedMainWorktree: true,
      isProtectedWorktree: true,
    });
    expect(decide({ worktree: switched })).toEqual({ action: 'refuse' });

    const restoreMain = spawnSync('git', ['switch', '--quiet', 'main'], { cwd: mainLinked, encoding: 'utf8' });
    expect(restoreMain.status, restoreMain.stderr).toBe(0);
  });

  it('keeps the designated main checkout protected after HEAD is detached', () => {
    const beforeDetach = resolveWorktree(mainLinked);
    expect(beforeDetach).toMatchObject({ isMainWorktree: true, isDesignatedMainWorktree: true });
    expect(git(mainLinked, ['switch', '--detach'])).not.toBeNull();

    const detached = resolveWorktree(mainLinked);
    expect(detached).toMatchObject({
      branchRef: null,
      isPrimaryWorktree: false,
      isMainWorktree: false,
      isDesignatedMainWorktree: true,
      isProtectedWorktree: true,
    });
    expect(decide({ worktree: detached })).toEqual({ action: 'refuse' });
  });

  it('protects the primary checkout and allows a feature-linked worktree', () => {
    const primary = resolveWorktree(root);
    expect(primary).toMatchObject({
      branchRef: 'refs/heads/task/root',
      isPrimaryWorktree: true,
      isMainWorktree: false,
      isProtectedWorktree: true,
    });
    expect(decide({ worktree: primary })).toEqual({ action: 'refuse' });

    const feature = resolveWorktree(linked);
    expect(feature).toMatchObject({
      branchRef: 'refs/heads/fix/task',
      isPrimaryWorktree: false,
      isMainWorktree: false,
      isProtectedWorktree: false,
    });
    expect(decide({ worktree: feature })).toEqual({ action: 'allow', reason: 'linked worktree' });
  });

  it('recognizes this repository’s designated main checkout', () => {
    const records = git(REPO_ROOT, ['worktree', 'list', '--porcelain']);
    const mainRecord = records.split('\n\n').find((record) => /(?:^|\n)branch refs\/heads\/main(?:\n|$)/.test(record));
    const mainPath = mainRecord?.match(/^worktree (.+)$/m)?.[1];
    expect(mainPath).toBeTruthy();
    expect(resolveWorktree(mainPath)).toMatchObject({ branchRef: 'refs/heads/main', isMainWorktree: true });

    const check = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts', 'main-worktree-guard.mjs')], {
      cwd: mainPath,
      encoding: 'utf8',
    });
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('refusing to record a commit in the primary or MAIN worktree');
  });

  it('reports nothing outside a repository, rather than a guess', () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'main-worktree-guard-bare-')));
    try {
      expect(resolveWorktree(bare)).toBeNull();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('the guard is actually installed', () => {
  it('registers the post-merge release hook, so a merge clears what it made false', () => {
    // Two separate things have to be true and neither implies the other: the tracked hook
    // file has to exist, and `core.hooksPath` has to have a dispatcher for it. A hook file
    // that is never installed is the silent failure this suite already exists to catch for
    // `pre-commit`, and it is quieter here — a merge would go on leaving claims behind and
    // nothing would say so.
    expect(existsSync(join(REPO_ROOT, '.husky', 'post-merge'))).toBe(true);
    const commonGitDir = commonDir(REPO_ROOT);
    expect(commonGitDir).not.toBeNull();
    expect(existsSync(join(commonGitDir, 'hooks-gate', 'post-merge'))).toBe(true);
  });

  it('does not let the post-merge hook stop a merge that already happened', () => {
    // A post-merge hook runs after the merge is recorded, so failing could not prevent
    // anything — it would only leave the operator with a landed merge and an error. The
    // `||` fallback and the absence of `set -e` are what make that true, and both are
    // load-bearing, so they are pinned rather than left to a reader's judgement.
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'post-merge'), 'utf8');
    expect(hook).not.toMatch(/^\s*set -e\s*$/m);
    expect(hook).toMatch(/merge-release\.mjs\s*\|\|/);
  });

  it('runs from .husky/pre-commit, before the gate it would otherwise waste', () => {
    // The ordering is a claim the file's own comment makes, and it is worth
    // about nine seconds per refusal: `gate:commit` is lint-staged plus
    // `tsc -b` plus a production build, and lint-staged rewrites staged files
    // with `--fix` before the commit is ever called illegitimate.
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'pre-commit'), 'utf8');
    const guardAt = hook.indexOf('main-worktree-guard.mjs');
    const gateAt = hook.indexOf('gate:commit');
    expect(guardAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(gateAt);
  });

  it('checks the final prepared landing message and installs the commit-msg gate', () => {
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'commit-msg'), 'utf8');
    const installer = readFileSync(join(REPO_ROOT, 'scripts', 'install-git-hooks.js'), 'utf8');

    expect(hook).toContain('commit-reviewed-landing-message-guard.mjs "$1"');
    expect(installer).toMatch(/const HOOKS = \[[^\]]*'commit-msg'/);
  });

  it('installs a working commit-msg dispatcher and tolerates older linked worktrees', () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'main-guard-hooks-')));
    try {
      const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: fixture, encoding: 'utf8' });
      expect(init.status).toBe(0);
      git(fixture, ['config', 'user.name', 'Hook Fixture']);
      git(fixture, ['config', 'user.email', 'hook-fixture@example.test']);
      writeFileSync(join(fixture, 'README.md'), 'hook fixture\n');
      git(fixture, ['add', 'README.md']);
      git(fixture, ['commit', '--quiet', '-m', 'fixture']);

      const configLock = join(fixture, '.git', 'config.lock');
      writeFileSync(configLock, '');
      const blockedInstall = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(blockedInstall.status).not.toBe(0);
      rmSync(configLock);

      const install = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(install.status).toBe(0);
      expect(git(fixture, ['config', '--local', '--get', 'ph.mainWorktreeGitDir'])).toBe(
        git(fixture, ['rev-parse', '--absolute-git-dir'])
      );
      expect(git(fixture, ['config', '--local', '--get', 'ph.mainWorktreePath'])).toBe(fixture);

      const hooksPath = git(fixture, ['config', '--get', 'core.hooksPath']);
      expect(hooksPath).not.toBeNull();
      const dispatcher = resolve(fixture, hooksPath, 'commit-msg');
      expect(existsSync(dispatcher)).toBe(true);
      expect(readFileSync(dispatcher, 'utf8')).toContain('/.husky/commit-msg');
      const preCommitDispatcher = resolve(fixture, hooksPath, 'pre-commit');
      const preCommitDispatcherText = readFileSync(preCommitDispatcher, 'utf8');
      const beforeRecord = preCommitDispatcherText.indexOf('--record-prepared-merge-before');
      const trackedHook = preCommitDispatcherText.indexOf('sh -e "$hook" "$@"');
      const afterRecord = preCommitDispatcherText.indexOf('--record-prepared-merge-after');
      expect(beforeRecord).toBeGreaterThanOrEqual(0);
      expect(beforeRecord).toBeLessThan(trackedHook);
      expect(afterRecord).toBeGreaterThan(trackedHook);

      const mainCall = spawnSync(dispatcher, ['message-file'], { cwd: fixture, encoding: 'utf8' });
      expect(mainCall.status).toBe(1);
      expect(mainCall.stderr).toContain('commit-msg is missing');

      const detachedMain = spawnSync('git', ['switch', '--quiet', '--detach'], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(detachedMain.status, detachedMain.stderr).toBe(0);
      const detachedMainCall = spawnSync(dispatcher, ['message-file'], { cwd: fixture, encoding: 'utf8' });
      expect(detachedMainCall.status).toBe(1);
      expect(detachedMainCall.stderr).toContain('commit-msg is missing');

      const featureWorktree = join(fixture, 'feature-worktree');
      const featureCheckout = spawnSync(
        'git',
        ['worktree', 'add', '--quiet', '-b', 'feature', featureWorktree, 'main'],
        {
          cwd: fixture,
          encoding: 'utf8',
        }
      );
      expect(featureCheckout.status, featureCheckout.stderr).toBe(0);
      const reinstallWithSavedIdentity = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: featureWorktree,
        encoding: 'utf8',
      });
      expect(reinstallWithSavedIdentity.status, reinstallWithSavedIdentity.stderr).toBe(0);
      writeFileSync(join(featureWorktree, 'message-file'), 'Feature change\n');
      const featureCall = spawnSync(dispatcher, ['message-file'], { cwd: featureWorktree, encoding: 'utf8' });
      expect(featureCall.status).toBe(1);
      expect(featureCall.stderr).toContain('exactly one non-empty Chat: trailer');
      writeFileSync(join(featureWorktree, 'message-file'), 'Feature change\n\nChat: fixture-session\n');
      const attributedFeatureCall = spawnSync(dispatcher, ['message-file'], { cwd: featureWorktree, encoding: 'utf8' });
      expect(attributedFeatureCall.status).toBe(0);

      const scripts = join(fixture, 'scripts');
      mkdirSync(scripts);
      writeFileSync(
        join(scripts, 'commit-reviewed-landing-message-guard.mjs'),
        'import { readFileSync } from "node:fs";\n' +
          'if (readFileSync(process.argv[2], "utf8").includes("run-current-final-guard")) {\n' +
          '  process.stderr.write("designated main final guard evaluated the linked worktree\\n");\n' +
          '  process.exitCode = 1;\n' +
          '}\n'
      );
      writeFileSync(join(featureWorktree, 'message-file'), 'run-current-final-guard\n\nChat: fixture-session\n');
      const finalGuardCall = spawnSync(dispatcher, ['message-file'], { cwd: featureWorktree, encoding: 'utf8' });
      expect(finalGuardCall.status).toBe(1);
      expect(finalGuardCall.stderr).toContain('designated main final guard evaluated the linked worktree');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('refuses first-time hook installation when the linked main checkout is detached', () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'main-guard-detached-install-')));
    try {
      const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: fixture, encoding: 'utf8' });
      expect(init.status).toBe(0);
      git(fixture, ['config', 'user.name', 'Hook Fixture']);
      git(fixture, ['config', 'user.email', 'hook-fixture@example.test']);
      writeFileSync(join(fixture, 'README.md'), 'hook fixture\n');
      git(fixture, ['add', 'README.md']);
      git(fixture, ['commit', '--quiet', '-m', 'fixture']);
      git(fixture, ['branch', 'feature']);
      git(fixture, ['switch', '--quiet', 'feature']);

      const detachedMain = join(fixture, 'detached-main');
      const mainCheckout = spawnSync('git', ['worktree', 'add', '--quiet', detachedMain, 'main'], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(mainCheckout.status, mainCheckout.stderr).toBe(0);
      const detach = spawnSync('git', ['switch', '--quiet', '--detach'], { cwd: detachedMain, encoding: 'utf8' });
      expect(detach.status, detach.stderr).toBe(0);

      const install = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(install.status).not.toBe(0);
      expect(install.stderr).toContain('cannot identify the designated main worktree');
      expect(git(detachedMain, ['config', '--local', '--get', 'ph.mainWorktreeGitDir'])).toBeNull();
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('keeps a recreated detached main path protected when its private gitdir changed', () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'main-guard-reused-path-')));
    try {
      const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: fixture, encoding: 'utf8' });
      expect(init.status).toBe(0);
      git(fixture, ['config', 'user.name', 'Hook Fixture']);
      git(fixture, ['config', 'user.email', 'hook-fixture@example.test']);
      writeFileSync(join(fixture, 'README.md'), 'hook fixture\n');
      git(fixture, ['add', 'README.md']);
      git(fixture, ['commit', '--quiet', '-m', 'fixture']);
      git(fixture, ['branch', 'feature']);
      git(fixture, ['switch', '--quiet', 'feature']);

      const detachedMain = join(fixture, 'detached-main');
      const initialCheckout = spawnSync('git', ['worktree', 'add', '--quiet', detachedMain, 'main'], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(initialCheckout.status, initialCheckout.stderr).toBe(0);
      const initialInstall = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(initialInstall.status, initialInstall.stderr).toBe(0);
      const hooksPath = git(fixture, ['config', '--get', 'core.hooksPath']);
      const dispatcher = resolve(fixture, hooksPath, 'commit-msg');
      const savedGitDir = realpathSync(git(detachedMain, ['rev-parse', '--absolute-git-dir']));
      const savedIdentity = git(fixture, ['config', '--local', '--get', 'ph.mainWorktreeIdentity']);
      expect(savedIdentity).toMatch(/^[0-9a-f-]{36}$/i);

      const detach = spawnSync('git', ['switch', '--quiet', '--detach'], { cwd: detachedMain, encoding: 'utf8' });
      expect(detach.status, detach.stderr).toBe(0);
      const remove = spawnSync('git', ['worktree', 'remove', '--force', detachedMain], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(remove.status, remove.stderr).toBe(0);
      const recreate = spawnSync('git', ['worktree', 'add', '--quiet', '--detach', detachedMain, 'main'], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(recreate.status, recreate.stderr).toBe(0);
      const recreatedGitDir = realpathSync(git(detachedMain, ['rev-parse', '--absolute-git-dir']));
      // Git may reuse the path-derived admin directory, so pin the stale identity
      // state explicitly instead of relying on the worktree name allocator.
      const staleGitDir =
        savedGitDir !== recreatedGitDir ? savedGitDir : join(fixture, '.git', 'worktrees', 'removed-main');
      expect(staleGitDir).not.toBe(recreatedGitDir);
      git(fixture, ['config', '--local', 'ph.mainWorktreeGitDir', staleGitDir]);

      const recreatedMain = resolveWorktree(detachedMain);
      expect(recreatedMain).toMatchObject({
        branchRef: null,
        isMainWorktree: false,
        isDesignatedMainWorktree: true,
        isProtectedWorktree: true,
      });
      expect(decide({ worktree: recreatedMain })).toEqual({ action: 'refuse' });

      const installWithStaleIdentity = spawnSync('node', [join(REPO_ROOT, 'scripts', 'install-git-hooks.js')], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(installWithStaleIdentity.status).not.toBe(0);
      expect(installWithStaleIdentity.stderr).toContain('cannot identify the designated main worktree');

      writeFileSync(join(detachedMain, 'message-file'), 'Feature change\n\nChat: fixture-session\n');
      const staleDetachedMainCall = spawnSync(dispatcher, ['message-file'], { cwd: detachedMain, encoding: 'utf8' });
      expect(staleDetachedMainCall.status).toBe(1);
      expect(staleDetachedMainCall.stderr).toContain('commit-msg is missing');

      const removeRecreatedMain = spawnSync('git', ['worktree', 'remove', '--force', detachedMain], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(removeRecreatedMain.status, removeRecreatedMain.stderr).toBe(0);
      const reuseForFeature = spawnSync(
        'git',
        ['worktree', 'add', '--quiet', '-b', 'feature-reused', detachedMain, 'main'],
        {
          cwd: fixture,
          encoding: 'utf8',
        }
      );
      expect(reuseForFeature.status, reuseForFeature.stderr).toBe(0);
      const featureGitDir = realpathSync(git(detachedMain, ['rev-parse', '--absolute-git-dir']));
      // Model Git reusing the removed main worktree's path-derived admin directory:
      // the shared config still names the old main identity, but the recreated
      // feature worktree has no private marker proving it is that same checkout.
      git(fixture, ['config', '--local', 'ph.mainWorktreeGitDir', featureGitDir]);
      git(fixture, ['config', '--local', 'ph.mainWorktreeIdentity', savedIdentity]);
      rmSync(join(featureGitDir, 'kilo-main-worktree-identity'), { force: true });
      const featureAtOldMainPath = resolveWorktree(detachedMain);
      expect(featureAtOldMainPath).toMatchObject({
        branchRef: 'refs/heads/feature-reused',
        isDesignatedMainWorktree: false,
        isProtectedWorktree: false,
      });
      expect(decide({ worktree: featureAtOldMainPath })).toEqual({ action: 'allow', reason: 'linked worktree' });
      writeFileSync(join(detachedMain, 'message-file'), 'Feature change\n\nChat: fixture-session\n');
      const featureAtOldMainPathCall = spawnSync(dispatcher, ['message-file'], {
        cwd: detachedMain,
        encoding: 'utf8',
      });
      expect(featureAtOldMainPathCall.status).toBe(0);

      writeFileSync(join(detachedMain, 'feature-only.txt'), 'feature commit\n');
      git(detachedMain, ['add', 'feature-only.txt']);
      const featureCommit = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'feature-only'], {
        cwd: detachedMain,
        encoding: 'utf8',
      });
      expect(featureCommit.status, featureCommit.stderr).toBe(0);
      const featureTip = git(detachedMain, ['rev-parse', 'HEAD']);
      const removeFeatureWorktree = spawnSync('git', ['worktree', 'remove', '--force', detachedMain], {
        cwd: fixture,
        encoding: 'utf8',
      });
      expect(removeFeatureWorktree.status, removeFeatureWorktree.stderr).toBe(0);
      const recreateDetachedFeature = spawnSync(
        'git',
        ['worktree', 'add', '--quiet', '--detach', detachedMain, featureTip],
        {
          cwd: fixture,
          encoding: 'utf8',
        }
      );
      expect(recreateDetachedFeature.status, recreateDetachedFeature.stderr).toBe(0);
      const detachedFeatureAtOldMainPath = resolveWorktree(detachedMain);
      expect(detachedFeatureAtOldMainPath).toMatchObject({
        branchRef: null,
        isDesignatedMainWorktree: true,
        isProtectedWorktree: true,
      });
      expect(decide({ worktree: detachedFeatureAtOldMainPath })).toEqual({ action: 'refuse' });
      writeFileSync(join(detachedMain, 'message-file'), 'Feature change\n\nChat: fixture-session\n');
      const detachedFeatureAtOldMainPathCall = spawnSync(dispatcher, ['message-file'], {
        cwd: detachedMain,
        encoding: 'utf8',
      });
      expect(detachedFeatureAtOldMainPathCall.status).toBe(1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rechecks a prepared merge after lint-staged can rewrite the index', () => {
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'pre-commit'), 'utf8');
    const gateAt = hook.indexOf('gate:commit');
    const takeoverChecks = [...hook.matchAll(/node scripts\/merge-takeover-guard\.mjs/g)].map((match) => match.index);
    const mainGuardChecks = [...hook.matchAll(/node scripts\/main-worktree-guard\.mjs/g)].map((match) => match.index);

    expect(takeoverChecks).toHaveLength(2);
    expect(mainGuardChecks).toHaveLength(2);
    expect(takeoverChecks[0]).toBeLessThan(gateAt);
    expect(mainGuardChecks[0]).toBeLessThan(gateAt);
    expect(takeoverChecks[1]).toBeGreaterThan(gateAt);
    expect(mainGuardChecks[1]).toBeGreaterThan(gateAt);
  });

  it('has a shared entry point for git to find, so the gate is not skipped in a worktree', () => {
    // The whole reason `core.hooksPath` points into the common git dir instead
    // of `.husky/_`: that path does not exist in a worktree made with
    // `git worktree add`, so git finds no hook, runs nothing and exits 0 — a
    // commit gate skipped silently. A guard inherits that failure exactly, so its
    // installation is asserted rather than assumed. `npm ci` runs `prepare`,
    // which writes it.
    const commonGitDir = commonDir(REPO_ROOT);
    expect(commonGitDir).not.toBeNull();
    expect(existsSync(join(commonGitDir, 'hooks-gate', 'pre-commit'))).toBe(true);
  });
});
