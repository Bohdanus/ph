import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/recover-stale-auto-merge.mjs');
const roots = [];
vi.setConfig({ testTimeout: 60_000 });

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'recovery test',
  GIT_AUTHOR_EMAIL: 'recovery@example.invalid',
  GIT_COMMITTER_NAME: 'recovery test',
  GIT_COMMITTER_EMAIL: 'recovery@example.invalid',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'stale-auto-merge-'));
  roots.push(root);
  git(root, 'init', '-b', 'fix/recovery-test');
  git(root, 'config', 'user.name', 'recovery test');
  git(root, 'config', 'user.email', 'recovery@example.invalid');
  writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
  git(root, 'add', 'tracked.txt');
  git(root, 'commit', '-m', 'initial');
  return root;
}

function makeMarker(root) {
  const head = git(root, 'rev-parse', 'HEAD');
  const tree = git(root, 'rev-parse', 'HEAD^{tree}');
  const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
  const marker = join(gitDir, 'AUTO_MERGE');
  writeFileSync(marker, `${tree}\n`);
  return { head, marker };
}

function makeMatchingWorktree(root) {
  const { head, marker } = makeMarker(root);
  writeFileSync(join(root, 'tracked.txt'), 'preserved tracked work\n');
  git(root, 'add', 'tracked.txt');
  const autoMergeTree = git(root, 'write-tree');
  git(root, 'reset', '--mixed', head);
  writeFileSync(marker, `${autoMergeTree}\n`);
  writeFileSync(join(root, 'untracked.txt'), 'preserved untracked work\n');
  return { head, marker, autoMergeTree };
}

function invoke(root, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, env, encoding: 'utf8' });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('recover-stale-auto-merge', () => {
  it('defaults to a read-only preflight and requires explicit owner acknowledgment to apply', () => {
    const root = repo();
    const { head, marker } = makeMarker(root);

    const dryRun = invoke(root, ['--expected-head', head]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain('SAFE PREFLIGHT ONLY');
    expect(existsSync(marker)).toBe(true);

    const noAcknowledgment = invoke(root, ['--expected-head', head, '--apply']);
    expect(noAcknowledgment.status).toBe(1);
    expect(existsSync(marker)).toBe(true);

    const applied = invoke(root, ['--expected-head', head, '--apply', '--confirm-owner-stopped']);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('HEAD and index were unchanged');
    expect(existsSync(marker)).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('removes only the marker when tracked WIP matches AUTO_MERGE and pins the dirty worktree', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const trackedPath = join(root, 'tracked.txt');
    const untrackedPath = join(root, 'untracked.txt');
    const statusBefore = git(root, 'status', '--short');
    const indexBefore = git(root, 'write-tree');

    const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    expect(preflight.status).toBe(0);
    expect(preflight.stdout).toContain('PRESERVING-WIP PREFLIGHT');
    expect(preflight.stdout).toContain(`AUTO_MERGE tree=${autoMergeTree}`);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    expect(statusPin).toBeTruthy();
    expect(existsSync(marker)).toBe(true);

    const missingPins = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(missingPins.status).toBe(1);
    expect(missingPins.stdout).toContain('requires both worktree pins');
    expect(existsSync(marker)).toBe(true);

    const applied = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('tracked work matched the marker');
    expect(existsSync(marker)).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'write-tree')).toBe(indexBefore);
    expect(git(root, 'status', '--short')).toBe(statusBefore);
    expect(readFileSync(trackedPath, 'utf8')).toBe('preserved tracked work\n');
    expect(readFileSync(untrackedPath, 'utf8')).toBe('preserved untracked work\n');
  });

  it('refuses preserved WIP if the status pin changes after preflight', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);
    expect(statusPin).toBeTruthy();

    writeFileSync(join(root, 'later.txt'), 'new work after preflight\n');
    const result = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Worktree status changed');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('preserved tracked work\n');
    expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('preserved untracked work\n');
    expect(readFileSync(join(root, 'later.txt'), 'utf8')).toBe('new work after preflight\n');
  });

  it('refuses preserve mode when staged or hidden index state could obscure tracked files', () => {
    const stagedRoot = repo();
    const staged = makeMatchingWorktree(stagedRoot);
    git(stagedRoot, 'add', 'tracked.txt');
    const stagedResult = invoke(stagedRoot, ['--expected-head', staged.head, '--preserve-matching-worktree']);
    expect(stagedResult.status).toBe(1);
    expect(stagedResult.stdout).toContain('index to match HEAD');
    expect(existsSync(staged.marker)).toBe(true);

    const flaggedRoot = repo();
    const flagged = makeMatchingWorktree(flaggedRoot);
    git(flaggedRoot, 'update-index', '--assume-unchanged', 'tracked.txt');
    const flaggedResult = invoke(flaggedRoot, ['--expected-head', flagged.head, '--preserve-matching-worktree']);
    expect(flaggedResult.status).toBe(1);
    expect(flaggedResult.stdout).toContain('assume-unchanged or skip-worktree');
    expect(existsSync(flagged.marker)).toBe(true);
  });

  it('refuses preserved work when tracked files no longer match the marker tree', () => {
    const root = repo();
    const { head, marker } = makeMatchingWorktree(root);
    writeFileSync(join(root, 'tracked.txt'), 'changed after AUTO_MERGE\n');
    const result = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Tracked worktree differs from AUTO_MERGE tree');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('changed after AUTO_MERGE\n');
  });

  it.each([
    [
      'changed HEAD pin',
      (root) => {
        const { head } = makeMarker(root);
        return `${head.slice(0, -1)}${head.endsWith('0') ? '1' : '0'}`;
      },
    ],
    [
      'untracked file',
      (root) => (
        makeMarker(root),
        writeFileSync(join(root, 'untracked.txt'), 'pending\n'),
        git(root, 'rev-parse', 'HEAD')
      ),
    ],
    [
      'modified tracked file',
      (root) => (
        makeMarker(root),
        writeFileSync(join(root, 'tracked.txt'), 'changed\n'),
        git(root, 'rev-parse', 'HEAD')
      ),
    ],
    [
      'another operation marker',
      (root) => (
        makeMarker(root),
        writeFileSync(join(git(root, 'rev-parse', '--absolute-git-dir'), 'MERGE_HEAD'), 'deadbeef\n'),
        git(root, 'rev-parse', 'HEAD')
      ),
    ],
    [
      'orphan merge message',
      (root) => (
        makeMarker(root),
        writeFileSync(join(git(root, 'rev-parse', '--absolute-git-dir'), 'MERGE_MSG'), 'merge in progress\n'),
        git(root, 'rev-parse', 'HEAD')
      ),
    ],
    ...['MERGE_MODE', 'SQUASH_MSG', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'BISECT_LOG'].map(
      (markerName) => [
        `orphan ${markerName}`,
        (root) => (
          makeMarker(root),
          writeFileSync(join(git(root, 'rev-parse', '--absolute-git-dir'), markerName), 'operation state\n'),
          git(root, 'rev-parse', 'HEAD')
        ),
      ]
    ),
    ...['rebase-merge', 'rebase-apply', 'sequencer'].map((markerName) => [
      `orphan ${markerName} directory`,
      (root) => (
        makeMarker(root),
        mkdirSync(join(git(root, 'rev-parse', '--absolute-git-dir'), markerName)),
        git(root, 'rev-parse', 'HEAD')
      ),
    ]),
    [
      'marker tree mismatch',
      (root) => {
        const info = makeMarker(root);
        const tree = git(root, 'rev-parse', 'HEAD^{tree}');
        writeFileSync(info.marker, `${'0'.repeat(tree.length)}\n`);
        return info.head;
      },
    ],
    [
      'malformed marker',
      (root) => {
        const info = makeMarker(root);
        writeFileSync(info.marker, 'not-an-object-id\n');
        return info.head;
      },
    ],
    [
      'commit object marker',
      (root) => {
        const info = makeMarker(root);
        writeFileSync(info.marker, `${info.head}\n`);
        return info.head;
      },
    ],
    [
      'symlink marker',
      (root) => {
        const info = makeMarker(root);
        rmSync(info.marker);
        symlinkSync(join(root, 'tracked.txt'), info.marker);
        return info.head;
      },
    ],
    [
      'directory marker',
      (root) => {
        const info = makeMarker(root);
        rmSync(info.marker);
        mkdirSync(info.marker);
        return info.head;
      },
    ],
  ])('refuses %s without removing the marker', (_label, prepare) => {
    const root = repo();
    const expectedHead = prepare(root);
    const marker = join(git(root, 'rev-parse', '--absolute-git-dir'), 'AUTO_MERGE');
    const result = invoke(root, ['--expected-head', expectedHead, '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Refusing stale AUTO_MERGE recovery');
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses to operate on the main branch', () => {
    const root = repo();
    git(root, 'branch', '-M', 'main');
    const { head, marker } = makeMarker(root);
    const result = invoke(root, ['--expected-head', head, '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Refusing recovery on the main branch');
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses a detached HEAD with a clear diagnostic', () => {
    const root = repo();
    git(root, 'checkout', '--detach');
    const { head, marker } = makeMarker(root);
    const result = invoke(root, ['--expected-head', head, '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Refusing recovery from a detached or unborn HEAD');
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses an unborn branch with a clear diagnostic', () => {
    const root = mkdtempSync(join(tmpdir(), 'stale-auto-merge-unborn-'));
    roots.push(root);
    git(root, 'init', '-b', 'fix/unborn-test');
    const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
    const marker = join(gitDir, 'AUTO_MERGE');
    writeFileSync(marker, `${'0'.repeat(40)}\n`);
    const result = invoke(root, ['--expected-head', 'a'.repeat(40), '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Refusing recovery from a detached or unborn HEAD');
    expect(existsSync(marker)).toBe(true);
  });

  it('resolves and removes the marker in a linked worktree admin directory', () => {
    const root = repo();
    const linked = join(root, 'linked');
    git(root, 'worktree', 'add', '-b', 'fix/linked-recovery', linked);
    const { head, marker } = makeMarker(linked);
    const result = invoke(linked, ['--expected-head', head, '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(git(linked, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('refuses when not run from the target worktree root', () => {
    const root = repo();
    const { head } = makeMarker(root);
    const subdirectory = join(root, 'subdirectory');
    mkdirSync(subdirectory);
    const result = spawnSync(process.execPath, [SCRIPT, '--expected-head', head], {
      cwd: subdirectory,
      env,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Run from the worktree root');
  });

  it('refuses an orphan marker when the index still has unresolved paths', () => {
    const root = repo();
    git(root, 'checkout', '-b', 'theirs');
    writeFileSync(join(root, 'tracked.txt'), 'theirs\n');
    git(root, 'add', 'tracked.txt');
    git(root, 'commit', '-m', 'theirs');
    git(root, 'checkout', 'fix/recovery-test');
    writeFileSync(join(root, 'tracked.txt'), 'ours\n');
    git(root, 'add', 'tracked.txt');
    git(root, 'commit', '-m', 'ours');
    const merge = spawnSync('git', ['merge', 'theirs'], { cwd: root, env, encoding: 'utf8' });
    expect(merge.status).not.toBe(0);
    const head = git(root, 'rev-parse', 'HEAD');
    const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
    const marker = join(gitDir, 'AUTO_MERGE');
    expect(existsSync(marker)).toBe(true);
    rmSync(join(gitDir, 'MERGE_HEAD'));
    rmSync(join(gitDir, 'MERGE_MSG'), { force: true });
    rmSync(join(gitDir, 'MERGE_MODE'), { force: true });

    const result = invoke(root, ['--expected-head', head, '--apply', '--confirm-owner-stopped']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Index has unresolved paths');
    expect(existsSync(marker)).toBe(true);
  });
});
