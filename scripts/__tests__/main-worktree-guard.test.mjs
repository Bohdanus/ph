import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('the main-worktree guard refuses a commit recorded in the main worktree', () => {
  it('refuses in the main worktree', () => {
    expect(decide({ worktree: { isMainWorktree: true } })).toEqual({ action: 'refuse' });
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
    expect(text).toContain('refusing to record a commit in the MAIN worktree');
  });

  it('names the override, the worktree command, and what not to reach for', () => {
    // An agent that hits a bare "no" commits anyway, from the same checkout, on
    // a branch nobody made. So the recipe is asserted as content, not as
    // sentiment: without a named way forward the guard only moves the failure.
    const { text } = refuseInMain();
    expect(text).toContain(`${OVERRIDE_VAR}=1`);
    expect(text).toContain('git worktree add -b fix/task .kilo/worktrees/task');
    expect(text).toContain('Not git stash');
    // The landing path must be stated, or the natural reading is that a merge
    // into main is also refused, and it is not: pre-merge-commit is a different
    // hook and a fast-forward runs none.
    expect(text).toContain('pre-merge-commit');
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

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'main-worktree-guard-')));
    const init = ['-c', 'init.defaultBranch=main', '-c', 'user.email=g@e.test', '-c', 'user.name=G', 'init'];
    expect(git(root, init)).not.toBeNull();
    writeFileSync(join(root, 'a.txt'), 'a\n');
    expect(git(root, ['add', 'a.txt'])).not.toBeNull();
    expect(git(root, ['commit', '-m', 'first'])).not.toBeNull();
    expect(git(root, ['worktree', 'add', '-b', 'fix/task', join(root, 'wt')])).not.toBeNull();
    linked = join(root, 'wt');
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reports the root checkout as the main worktree', () => {
    expect(resolveWorktree(root)).toMatchObject({ isMainWorktree: true });
  });

  it('reports a linked worktree as not main, so a commit there is allowed', () => {
    // The failure this pins is the expensive one: answering `true` for a linked
    // worktree would refuse every commit in the one-per-task workflow
    // AGENTS.md mandates, and the first agent to hit it would reach for
    // `--no-verify`.
    expect(resolveWorktree(linked)).toMatchObject({ isMainWorktree: false });
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
    const commonDir = git(REPO_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    expect(commonDir).not.toBeNull();
    expect(existsSync(join(commonDir, 'hooks-gate', 'post-merge'))).toBe(true);
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

  it('has a shared entry point for git to find, so the gate is not skipped in a worktree', () => {
    // The whole reason `core.hooksPath` points into the common git dir instead
    // of `.husky/_`: that path does not exist in a worktree made with
    // `git worktree add`, so git finds no hook, runs nothing and exits 0 — a
    // commit gate skipped silently. A guard inherits that failure exactly, so its
    // installation is asserted rather than assumed. `npm ci` runs `prepare`,
    // which writes it.
    const commonDir = git(REPO_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    expect(commonDir).not.toBeNull();
    expect(existsSync(join(commonDir, 'hooks-gate', 'pre-commit'))).toBe(true);
  });
});
