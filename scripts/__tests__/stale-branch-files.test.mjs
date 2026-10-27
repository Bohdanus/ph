import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectBranch } from '../stale-branch-files.mjs';

vi.setConfig({ testTimeout: 30_000 });

let cwd;

function git(args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(path, contents) {
  writeFileSync(join(cwd, path), contents);
}

function commit(message) {
  git(['add', '-A']);
  git(['commit', '-qm', message]);
}

function startStaleBranch() {
  write('asset with spaces.txt', 'old version\n');
  commit('old version');
  const oldCommit = git(['rev-parse', 'HEAD']);

  write('asset with spaces.txt', 'main version\n');
  commit('main update');
  const mergeBase = git(['rev-parse', 'HEAD']);
  git(['checkout', '-qb', 'feature']);
  write('asset with spaces.txt', 'old version\n');
  commit('stale snapshot');

  return { branchSha: git(['rev-parse', 'HEAD']), oldCommit, mergeBase };
}

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'stale-branch-files-')));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
});

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

describe('pre-push stale branch detection', () => {
  it('reports changed files whose content matches an older main ancestor, including paths with spaces', () => {
    const { branchSha, oldCommit, mergeBase } = startStaleBranch();
    const result = inspectBranch({ cwd, branchSha });

    expect(result.mergeBase).toBe(mergeBase);
    expect(result.skipped).toBeNull();
    expect(result.findings).toEqual([{ path: 'asset with spaces.txt', ancestor: oldCommit }]);
  });

  it('leaves unique branch content alone', () => {
    write('asset.txt', 'old version\n');
    commit('old version');
    write('asset.txt', 'main version\n');
    commit('main update');
    git(['checkout', '-qb', 'feature']);
    write('new.txt', 'new feature\n');
    commit('new feature');

    expect(inspectBranch({ cwd, branchSha: git(['rev-parse', 'HEAD']) }).findings).toEqual([]);
  });

  it('skips a first-parent line containing a merge commit', () => {
    const { branchSha } = startStaleBranch();
    git(['checkout', '-qb', 'side', 'main']);
    write('side.txt', 'side change\n');
    commit('side change');
    git(['checkout', 'feature']);
    git(['merge', '--no-ff', '-qm', 'merge side', 'side']);

    const result = inspectBranch({ cwd, branchSha: git(['rev-parse', 'HEAD']) });
    expect(result.skipped).toBe('first-parent merge');
    expect(result.findings).toEqual([]);
    expect(branchSha).not.toBe(git(['rev-parse', 'HEAD']));
  });

  it('reads the standard pre-push input and refuses a stale branch snapshot', () => {
    const { branchSha, mergeBase } = startStaleBranch();
    const script = resolve(import.meta.dirname, '../stale-branch-files.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd,
      input: `refs/heads/feature ${branchSha} refs/heads/feature ${mergeBase}\n`,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"asset with spaces.txt"');
    expect(result.stderr).toContain('verify this is intentional');
  });

  it('runs before the final push-test gate in the tracked hook', () => {
    const hook = readFileSync(resolve(import.meta.dirname, '../../.husky/pre-push'), 'utf8')
      .trim()
      .replace(/\r\n/g, '\n')
      .split('\n');

    expect(hook).toContain('node scripts/stale-branch-files.mjs');
    expect(hook.at(-1)).toBe('npm run --silent gate:push');
  });
});
