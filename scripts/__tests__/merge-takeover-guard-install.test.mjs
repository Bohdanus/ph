import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * Mandatory for a suite that spawns: `scripts/__tests__/suite-budgets.test.mjs` requires the
 * declaration on a line of its own, and without it the file runs on Vitest's 5000ms
 * default — at or below the span of its own slowest test, which is how a suite starts
 * failing `npm run test` with no code change.
 */
vi.setConfig({ testTimeout: 20_000 });

/**
 * These assertions read the REAL repository from disk. The failure they pin is the one
 * that makes a gate decorative: the hook exists in `.husky/`, so it reads as protection,
 * and `scripts/install-git-hooks.js` never installs it, so git never runs it. That
 * happened here — `docs/ORCHESTRATION.md:86` and `scripts/main-worktree-guard.mjs:40`
 * both claimed a landing runs `pre-merge-commit`, the claim was pinned by a test at
 * `main-worktree-guard.test.mjs:114`, and no such hook existed anywhere. Two things have
 * to be true and neither implies the other, so both are checked.
 */
const REPO_ROOT = realpathSync(join(import.meta.dirname, '..', '..'));

/**
 * `core.hooksPath` points into the COMMON git dir, not the worktree, because every
 * worktree shares one set of hooks. Asked of git rather than assumed from `.git`, for the
 * same reason `main-worktree-guard.mjs` asks: `rev-parse --show-toplevel` is not a safe
 * answer in a linked worktree.
 */
function hooksGateDir() {
  return realpathSync(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  );
}

describe('the silent-revert gate is installed, not merely written', () => {
  it('has a tracked hook in .husky/', () => {
    expect(() => realpathSync(join(REPO_ROOT, '.husky', 'pre-merge-commit'))).not.toThrow();
  });

  it('is listed in install-git-hooks.js HOOKS', () => {
    const source = realpathSync(join(REPO_ROOT, 'scripts', 'install-git-hooks.js'));
    const text = readFileSync(source, 'utf8');
    expect(text).toContain('pre-merge-commit');
  });

  it('is INSTALLED into the shared hooks-gate directory git actually runs from', () => {
    // The assertion that would have caught the original gap. The hook existed in `.husky/`
    // and read as protection while `HOOKS` never named it, so git found nothing to run.
    const installed = join(hooksGateDir(), 'hooks-gate', 'pre-merge-commit');
    expect(() => realpathSync(installed)).not.toThrow();
    // And it is a dispatcher for this worktree's hook, not a stale copy of some other one.
    expect(readFileSync(installed, 'utf8')).toContain('.husky/pre-merge-commit');
  });

  it('runs the guard, and does not swallow its exit code', () => {
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'pre-merge-commit'), 'utf8');
    expect(hook).toMatch(/node scripts\/merge-takeover-guard\.mjs/);
    // The dispatcher runs `sh -e "$hook"`, so the guard's exit code is what blocks the
    // merge. A `|| true` or a piped swallow here would make the whole thing a report.
    expect(hook).not.toMatch(/\|\|\s*true/);
    expect(hook).not.toMatch(/merge-takeover-guard\.mjs\s*\|\|/);
  });

  it('names the fast-forward limit rather than implying total coverage', () => {
    const hook = readFileSync(join(REPO_ROOT, '.husky', 'pre-merge-commit'), 'utf8');
    // A gate whose header claims more than it does is the failure this whole change was
    // made to stop. If the FF limit is ever removed from the comment, git behaviour has
    // to have changed first.
    //
    // Read the whole bullet, not just the line naming it: the claim and its correction sit
    // on different lines, and an assertion that only saw the heading could not tell them
    // apart. `toContain('FAST-FORWARD')` was exactly that assertion — it passed for "fires
    // no hook at all" and for "fires no gating hook" alike, so it sat green over the false
    // claim for as long as the false claim was on main.
    const bullet = hook.split('\n# - ').find((chunk) => chunk.toUpperCase().includes('FAST-FORWARD')) ?? '';
    expect(bullet).not.toBe('');
    // A fast-forward reaches `post-merge`, which cannot block. Verified against raw git,
    // not read off a document, so the bullet has to name the hook rather than deny one.
    expect(bullet).toContain('post-merge');
    expect(bullet.toUpperCase()).not.toContain('NO HOOK AT ALL');
    expect(bullet.toUpperCase()).not.toContain('FIRES NO HOOK');
  });
});

describe('the guard it installs exists and is honest about what it detects', () => {
  it('is tracked', () => {
    expect(() => realpathSync(join(REPO_ROOT, 'scripts', 'merge-takeover-guard.mjs'))).not.toThrow();
  });

  it('documents both loss shapes, not only the one that was fixed', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts', 'merge-takeover-guard.mjs'), 'utf8');
    // Both appear because they are the same defect with two causes. Reporting only the
    // `--theirs` shape is what an earlier draft of this detector did, and it missed the
    // recorded incident entirely.
    expect(source).toContain('restored-pre-divergence-content');
    expect(source).toContain('whole-file-takeover');
    expect(source).toContain('17');
  });
});
