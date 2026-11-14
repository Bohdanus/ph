import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  git(root, 'config', 'core.autocrlf', 'false');
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

function invokeWithMarkerRewrite(root, args, { marker, replacementTree, rewriteOnCatFileCall = 4 }) {
  const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
  let environment;
  if (process.platform === 'win32') {
    // Windows cannot execute the POSIX `git` shim below. Patch Node's child-process
    // builtin before this ESM script imports it, then synchronize named exports.
    const preloadPath = join(gitDir, 'recovery-test-preload.cjs');
    writeFileSync(
      preloadPath,
      [
        "const fs = require('node:fs');",
        "const childProcess = require('node:child_process');",
        "const { syncBuiltinESMExports } = require('node:module');",
        'const realExecFileSync = childProcess.execFileSync;',
        'let catFileCalls = 0;',
        'childProcess.execFileSync = function (...args) {',
        '  const result = realExecFileSync.apply(this, args);',
        '  const [command, argv] = args;',
        "  if (command === 'git' && argv?.[0] === 'cat-file' && argv?.[1] === '-t') {",
        '    catFileCalls += 1;',
        '    if (catFileCalls === Number(process.env.AUTO_MERGE_TEST_REWRITE_ON)) {',
        "      fs.writeFileSync(process.env.AUTO_MERGE_TEST_MARKER, process.env.AUTO_MERGE_TEST_TREE + '\\n');",
        '    }',
        '  }',
        '  return result;',
        '};',
        'syncBuiltinESMExports();',
        '',
      ].join('\n')
    );
    const requirePath = preloadPath.replace(/\\/g, '/');
    environment = {
      NODE_OPTIONS: [env.NODE_OPTIONS, `--require="${requirePath}"`].filter(Boolean).join(' '),
    };
  } else {
    const shimPath = join(gitDir, 'git');
    const countPath = join(gitDir, 'recovery-test-cat-file-count');
    const realGit = execFileSync('which', ['git'], { cwd: root, env, encoding: 'utf8' }).trim();
    writeFileSync(
      shimPath,
      [
        '#!/bin/sh',
        `${JSON.stringify(realGit)} "$@"`,
        'result=$?',
        'if [ "$1" = "cat-file" ] && [ "$2" = "-t" ]; then',
        '  count=0',
        '  if [ -f "$AUTO_MERGE_TEST_COUNT" ]; then IFS= read -r count < "$AUTO_MERGE_TEST_COUNT"; fi',
        '  count=$((count + 1))',
        '  printf "%s\\n" "$count" > "$AUTO_MERGE_TEST_COUNT"',
        '  if [ "$count" -eq "$AUTO_MERGE_TEST_REWRITE_ON" ]; then',
        '    printf "%s\\n" "$AUTO_MERGE_TEST_TREE" > "$AUTO_MERGE_TEST_MARKER"',
        '  fi',
        'fi',
        'exit "$result"',
        '',
      ].join('\n')
    );
    chmodSync(shimPath, 0o755);
    environment = {
      PATH: `${gitDir}:${env.PATH ?? ''}`,
      AUTO_MERGE_TEST_COUNT: countPath,
    };
  }
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    env: {
      ...env,
      ...environment,
      AUTO_MERGE_TEST_MARKER: marker,
      AUTO_MERGE_TEST_TREE: replacementTree,
      AUTO_MERGE_TEST_REWRITE_ON: String(rewriteOnCatFileCall),
    },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('recover-stale-auto-merge', () => {
  it('runs the pinned script with the target worktree as cwd, independent of its local package script', () => {
    const root = repo();
    mkdirSync(join(root, 'scripts'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { 'repo:state:recover-auto-merge': 'node scripts/recover-stale-auto-merge.mjs' } })
    );
    writeFileSync(join(root, 'scripts', 'recover-stale-auto-merge.mjs'), 'process.stdout.write("stale target code")');
    git(root, 'add', 'package.json', 'scripts/recover-stale-auto-merge.mjs');
    git(root, 'commit', '-m', 'add stale target recovery command');
    const { head, marker } = makeMarker(root);

    // SCRIPT is resolved from the test checkout; invoke that absolute path while cwd
    // points to a different, potentially stale target checkout.
    const result = invoke(root, ['--expected-head', head]);

    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('SAFE PREFLIGHT ONLY');
    expect(result.stdout).not.toContain('stale target code');
    expect(existsSync(marker)).toBe(true);
  });

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
    const recoveryRef = `refs/recovery/auto-merge/${head}/${autoMergeTree}`;
    expect(preflight.status).toBe(0);
    expect(preflight.stdout).toContain('PRESERVING-WIP PREFLIGHT');
    expect(preflight.stdout).toContain(`AUTO_MERGE tree=${autoMergeTree}`);
    expect(preflight.stdout).toContain(`recovery-ref=${recoveryRef}`);
    expect(git(root, 'for-each-ref', '--format=%(objectname)', recoveryRef)).toBe('');
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();
    expect(existsSync(marker)).toBe(true);

    const missingPins = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(missingPins.status).toBe(1);
    expect(missingPins.stdout).toContain('requires all three worktree pins');
    expect(existsSync(marker)).toBe(true);

    const applied = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('tracked work matched the marker');
    expect(applied.stdout).toContain(`created durable tree ref ${recoveryRef}`);
    expect(existsSync(marker)).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'for-each-ref', '--format=%(objectname)', recoveryRef)).toBe(autoMergeTree);
    expect(git(root, 'cat-file', '-t', recoveryRef)).toBe('tree');
    expect(git(root, 'write-tree')).toBe(indexBefore);
    expect(git(root, 'status', '--short')).toBe(statusBefore);
    expect(readFileSync(trackedPath, 'utf8')).toBe('preserved tracked work\n');
    expect(readFileSync(untrackedPath, 'utf8')).toBe('preserved untracked work\n');
  });

  it('removes only the marker while preserving tracked work that diverges from AUTO_MERGE', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const trackedPath = join(root, 'tracked.txt');
    const untrackedPath = join(root, 'untracked.txt');
    writeFileSync(trackedPath, 'divergent tracked work\n');
    const statusBefore = git(root, 'status', '--short');
    const indexBefore = git(root, 'write-tree');

    const preflight = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    const recoveryRef = `refs/recovery/auto-merge/${head}/${autoMergeTree}`;
    expect(preflight.status).toBe(0);
    expect(preflight.stdout).toContain('PRESERVING-DIVERGENT-WIP PREFLIGHT');
    expect(preflight.stdout).toContain(`AUTO_MERGE tree=${autoMergeTree}`);
    expect(preflight.stdout).toContain(`recovery-ref=${recoveryRef}`);
    expect(preflight.stdout).toContain('tracked-diff-paths=1');
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();
    expect(existsSync(marker)).toBe(true);

    const missingPins = invoke(root, [
      '--expected-head',
      head,
      '--preserve-divergent-worktree',
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(missingPins.status).toBe(1);
    expect(missingPins.stdout).toContain('requires all three worktree pins');
    expect(existsSync(marker)).toBe(true);

    const applied = invoke(root, [
      '--expected-head',
      head,
      '--preserve-divergent-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain('divergent tracked work was preserved');
    expect(applied.stdout).toContain(`created durable tree ref ${recoveryRef}`);
    expect(existsSync(marker)).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(root, 'for-each-ref', '--format=%(objectname)', recoveryRef)).toBe(autoMergeTree);
    expect(git(root, 'cat-file', '-t', recoveryRef)).toBe('tree');
    expect(git(root, 'write-tree')).toBe(indexBefore);
    expect(git(root, 'status', '--short')).toBe(statusBefore);
    expect(readFileSync(trackedPath, 'utf8')).toBe('divergent tracked work\n');
    expect(readFileSync(untrackedPath, 'utf8')).toBe('preserved untracked work\n');
  });

  it('refuses divergent preserve mode when the worktree status changes after preflight', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    writeFileSync(join(root, 'tracked.txt'), 'divergent tracked work\n');
    const preflight = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();

    writeFileSync(join(root, 'later.txt'), 'new work after preflight\n');
    const result = invoke(root, [
      '--expected-head',
      head,
      '--preserve-divergent-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Worktree status changed');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('divergent tracked work\n');
    expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('preserved untracked work\n');
    expect(readFileSync(join(root, 'later.txt'), 'utf8')).toBe('new work after preflight\n');
  });

  it('refuses divergent preserve mode when a modified tracked file changes without changing status', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const trackedPath = join(root, 'tracked.txt');
    writeFileSync(trackedPath, 'first divergent content\n');
    const preflight = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();
    const statusBefore = git(root, 'status', '--short');

    writeFileSync(trackedPath, 'second divergent content\n');
    expect(git(root, 'status', '--short')).toBe(statusBefore);
    const result = invoke(root, [
      '--expected-head',
      head,
      '--preserve-divergent-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Worktree content changed');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(trackedPath, 'utf8')).toBe('second divergent content\n');
  });

  it('refuses to unlink AUTO_MERGE if its contents change in place after the final inspection', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const replacementTree = git(root, 'rev-parse', 'HEAD^{tree}');
    const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();

    const result = invokeWithMarkerRewrite(
      root,
      [
        '--expected-head',
        head,
        '--preserve-matching-worktree',
        '--expected-auto-merge-tree',
        autoMergeTree,
        '--expected-worktree-status-sha256',
        statusPin,
        '--expected-worktree-content-sha256',
        contentPin,
        '--apply',
        '--confirm-owner-stopped',
      ],
      { marker, replacementTree }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('AUTO_MERGE changed after preflight');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe(`${replacementTree}\n`);
    expect(
      git(root, 'for-each-ref', '--format=%(objectname)', `refs/recovery/auto-merge/${head}/${autoMergeTree}`)
    ).toBe(autoMergeTree);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses preserved WIP if an untracked file mode changes after preflight',
    () => {
      const root = repo();
      const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
      const untrackedPath = join(root, 'untracked.txt');
      const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
      const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
      const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
      expect(preflight.status).toBe(0);
      expect(statusPin).toBeTruthy();
      expect(contentPin).toBeTruthy();
      const statusBefore = git(root, 'status', '--porcelain=v2', '--untracked-files=all');

      chmodSync(untrackedPath, 0o755);
      expect(git(root, 'status', '--porcelain=v2', '--untracked-files=all')).toBe(statusBefore);
      const result = invoke(root, [
        '--expected-head',
        head,
        '--preserve-matching-worktree',
        '--expected-auto-merge-tree',
        autoMergeTree,
        '--expected-worktree-status-sha256',
        statusPin,
        '--expected-worktree-content-sha256',
        contentPin,
        '--apply',
        '--confirm-owner-stopped',
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Worktree content changed');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(untrackedPath, 'utf8')).toBe('preserved untracked work\n');
    }
  );

  it('refuses untracked-only work when AUTO_MERGE differs from HEAD', () => {
    const root = repo();
    const { head, marker } = makeMarker(root);
    writeFileSync(join(root, 'tracked.txt'), 'marker tree only\n');
    git(root, 'add', 'tracked.txt');
    const markerTree = git(root, 'write-tree');
    git(root, 'reset', '--mixed', head);
    git(root, 'checkout', '--', 'tracked.txt');
    writeFileSync(marker, `${markerTree}\n`);
    writeFileSync(join(root, 'untracked.txt'), 'untracked only\n');

    const result = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('requires the same unstaged tracked path to differ from both HEAD and AUTO_MERGE');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('tracked\n');
    expect(readFileSync(join(root, 'untracked.txt'), 'utf8')).toBe('untracked only\n');
  });

  it('refuses divergent WIP when its HEAD and AUTO_MERGE differences are on disjoint paths', () => {
    const root = repo();
    writeFileSync(join(root, 'other.txt'), 'base other\n');
    git(root, 'add', 'other.txt');
    git(root, 'commit', '-m', 'add second tracked path');
    const { head, marker } = makeMarker(root);

    writeFileSync(join(root, 'tracked.txt'), 'marker tracked\n');
    writeFileSync(join(root, 'other.txt'), 'worktree tracked\n');
    git(root, 'add', 'tracked.txt', 'other.txt');
    const autoMergeTree = git(root, 'write-tree');
    git(root, 'reset', '--mixed', head);
    writeFileSync(join(root, 'tracked.txt'), 'tracked\n');
    writeFileSync(marker, `${autoMergeTree}\n`);

    const result = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('requires the same unstaged tracked path to differ from both HEAD and AUTO_MERGE');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('tracked\n');
    expect(readFileSync(join(root, 'other.txt'), 'utf8')).toBe('worktree tracked\n');
  });

  it('refuses to pin an invalid UTF-8 untracked path on Linux', () => {
    if (process.platform !== 'linux') return;
    const root = repo();
    const { head, marker } = makeMatchingWorktree(root);
    writeFileSync(join(root, 'tracked.txt'), 'divergent tracked work\n');
    const invalidPath = Buffer.concat([Buffer.from(join(root, 'invalid-')), Buffer.from([0xff])]);
    writeFileSync(invalidPath, 'untracked bytes\n');

    const result = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('invalid UTF-8 encoding');
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(join(root, 'tracked.txt'), 'utf8')).toBe('divergent tracked work\n');
    expect(readFileSync(invalidPath, 'utf8')).toBe('untracked bytes\n');
  });

  it('does not write Git objects while preflighting preserved file content', () => {
    const root = repo();
    const { head } = makeMatchingWorktree(root);
    writeFileSync(join(root, 'tracked.txt'), 'divergent tracked work\n');
    const objectsBefore = git(root, 'count-objects', '-v').match(/^count: (\d+)$/m)?.[1];

    const result = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);

    const objectsAfter = git(root, 'count-objects', '-v').match(/^count: (\d+)$/m)?.[1];
    expect(result.status).toBe(0);
    expect(objectsBefore).toBeTruthy();
    expect(objectsAfter).toBe(objectsBefore);
  });

  it('reuses an exact existing durable tree ref and refuses a mismatched one', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const ref = `refs/recovery/auto-merge/${head}/${autoMergeTree}`;
    git(root, 'update-ref', ref, autoMergeTree);
    const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);

    const applied = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
      '--apply',
      '--confirm-owner-stopped',
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain(`verified durable tree ref ${ref}`);
    expect(git(root, 'for-each-ref', '--format=%(objectname)', ref)).toBe(autoMergeTree);
    expect(existsSync(marker)).toBe(false);

    const collisionRoot = repo();
    const collision = makeMatchingWorktree(collisionRoot);
    const collisionRef = `refs/recovery/auto-merge/${collision.head}/${collision.autoMergeTree}`;
    git(collisionRoot, 'update-ref', collisionRef, git(collisionRoot, 'rev-parse', 'HEAD^{tree}'));
    const refused = invoke(collisionRoot, ['--expected-head', collision.head, '--preserve-matching-worktree']);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain(`Recovery ref ${collisionRef} points to`);
    expect(existsSync(collision.marker)).toBe(true);
  });

  it('refuses preserved WIP if the status pin changes after preflight', () => {
    const root = repo();
    const { head, marker, autoMergeTree } = makeMatchingWorktree(root);
    const preflight = invoke(root, ['--expected-head', head, '--preserve-matching-worktree']);
    const statusPin = preflight.stdout.match(/worktree-status-sha256=([a-f\d]{64})/i)?.[1];
    const contentPin = preflight.stdout.match(/worktree-content-sha256=([a-f\d]{64})/i)?.[1];
    expect(preflight.status).toBe(0);
    expect(statusPin).toBeTruthy();
    expect(contentPin).toBeTruthy();

    writeFileSync(join(root, 'later.txt'), 'new work after preflight\n');
    const result = invoke(root, [
      '--expected-head',
      head,
      '--preserve-matching-worktree',
      '--expected-auto-merge-tree',
      autoMergeTree,
      '--expected-worktree-status-sha256',
      statusPin,
      '--expected-worktree-content-sha256',
      contentPin,
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

  it('requires divergent preserve mode to contain an actual tracked difference from AUTO_MERGE', () => {
    const root = repo();
    const { head, marker } = makeMatchingWorktree(root);
    const result = invoke(root, ['--expected-head', head, '--preserve-divergent-worktree']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('requires tracked work that differs from AUTO_MERGE');
    expect(existsSync(marker)).toBe(true);
  });

  it.each(
    [
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
      // Windows may require Developer Mode or elevation to create file symlinks.
    ].filter(([label]) => process.platform !== 'win32' || label !== 'symlink marker')
  )('refuses %s without removing the marker', (_label, prepare) => {
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
