import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 25_000 });

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function makeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wsl-setup-test-'));
  temporaryDirectories.push(directory);

  const worktreeRoot = join(directory, 'repo', '.kilo', 'worktrees', 'task');
  const scriptsDirectory = join(worktreeRoot, 'scripts');
  const fakeBin = join(directory, 'bin');
  const gitMarker = join(directory, 'git-was-run');
  const gitWorktreeListMarker = join(directory, 'git-worktree-list-was-run');
  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(fakeBin);
  copyFileSync(join(import.meta.dirname, '..', 'wsl-setup.sh'), join(scriptsDirectory, 'wsl-setup.sh'));

  const fakeStat = join(fakeBin, 'stat');
  writeFileSync(
    fakeStat,
    '#!/usr/bin/env bash\nif [[ "$#" == 4 && "$1" == "-f" && "$2" == "-c" && "$3" == "%T" && "$4" == "$WSL_SETUP_EXPECTED_WORKTREE_ROOT" ]]; then\n  printf "%s\\n" "$WSL_SETUP_TEST_FILESYSTEM"\nelse\n  printf "ext4\\n"\nfi\n'
  );
  chmodSync(fakeStat, 0o755);

  const fakeGit = join(fakeBin, 'git');
  writeFileSync(
    fakeGit,
    [
      '#!/usr/bin/env bash',
      'if [[ "$1" != "-C" || "$2" != "$WSL_SETUP_EXPECTED_WORKTREE_ROOT" ]]; then exit 90; fi',
      'case "$3:$4:$5" in',
      '  rev-parse:--is-inside-work-tree:) : > "$WSL_SETUP_GIT_MARKER"; exit 0 ;;',
      '  rev-parse:--show-toplevel:) printf "%s\\n" "$WSL_SETUP_EXPECTED_WORKTREE_ROOT"; exit 0 ;;',
      '  symbolic-ref:--quiet:HEAD) printf "refs/heads/task/wsl-test\\n"; exit 0 ;;',
      '  worktree:list:--porcelain) : > "$WSL_SETUP_GIT_WORKTREE_LIST_MARKER"; printf "worktree %s\\n" "$WSL_SETUP_REGISTERED_WORKTREE"; exit 0 ;;',
      'esac',
      'exit 90',
      '',
    ].join('\n')
  );
  chmodSync(fakeGit, 0o755);

  return { worktreeRoot, scriptsDirectory, fakeBin, gitMarker, gitWorktreeListMarker };
}

function runSetup(fixture, filesystemType) {
  return spawnSync('bash', [join(fixture.scriptsDirectory, 'wsl-setup.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      WSL_SETUP_EXPECTED_WORKTREE_ROOT: realpathSync(fixture.worktreeRoot),
      WSL_SETUP_GIT_MARKER: fixture.gitMarker,
      WSL_SETUP_GIT_WORKTREE_LIST_MARKER: fixture.gitWorktreeListMarker,
      WSL_SETUP_REGISTERED_WORKTREE: `${fixture.worktreeRoot}-not-registered`,
      WSL_SETUP_TEST_FILESYSTEM: filesystemType,
    },
    timeout: 5_000,
  });
}

describe('WSL setup worktree guard', () => {
  it.skipIf(process.platform === 'win32')('refuses each Windows-mounted worktree before Git or npm setup', () => {
    for (const filesystemType of ['drvfs', '9p', 'v9fs']) {
      const fixture = makeFixture();
      const result = runSetup(fixture, filesystemType);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`not a Windows mount (${filesystemType})`);
      expect(existsSync(fixture.gitMarker)).toBe(false);
    }
  });

  it.skipIf(process.platform === 'win32')('allows a Linux filesystem through to Git worktree validation', () => {
    const fixture = makeFixture();
    const result = runSetup(fixture, 'ext4');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a registered Git worktree');
    expect(existsSync(fixture.gitMarker)).toBe(true);
    expect(existsSync(fixture.gitWorktreeListMarker)).toBe(true);
  });
});
