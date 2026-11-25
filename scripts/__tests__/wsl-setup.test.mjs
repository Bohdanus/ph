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

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('WSL setup worktree guard', () => {
  it.skipIf(process.platform === 'win32')('refuses Windows-mounted worktrees before Git or npm setup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'wsl-setup-test-'));
    temporaryDirectories.push(directory);

    const worktreeRoot = join(directory, 'repo', '.kilo', 'worktrees', 'task');
    const scriptsDirectory = join(worktreeRoot, 'scripts');
    const fakeBin = join(directory, 'bin');
    const gitMarker = join(directory, 'git-was-run');
    mkdirSync(scriptsDirectory, { recursive: true });
    mkdirSync(fakeBin);
    copyFileSync(join(import.meta.dirname, '..', 'wsl-setup.sh'), join(scriptsDirectory, 'wsl-setup.sh'));

    const fakeStat = join(fakeBin, 'stat');
    writeFileSync(
      fakeStat,
      '#!/usr/bin/env bash\nif [[ "$#" == 4 && "$1" == "-f" && "$2" == "-c" && "$3" == "%T" && "$4" == "$WSL_SETUP_EXPECTED_WORKTREE_ROOT" ]]; then\n  printf "drvfs\\n"\nelse\n  printf "ext4\\n"\nfi\n'
    );
    chmodSync(fakeStat, 0o755);

    const fakeGit = join(fakeBin, 'git');
    writeFileSync(fakeGit, '#!/usr/bin/env bash\n: > "$WSL_SETUP_GIT_MARKER"\nexit 1\n');
    chmodSync(fakeGit, 0o755);

    const result = spawnSync('bash', [join(scriptsDirectory, 'wsl-setup.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
        WSL_SETUP_EXPECTED_WORKTREE_ROOT: realpathSync(worktreeRoot),
        WSL_SETUP_GIT_MARKER: gitMarker,
      },
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a Windows mount (drvfs)');
    expect(existsSync(gitMarker)).toBe(false);
  });
});
