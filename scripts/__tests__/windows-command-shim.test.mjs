import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

import { resolveCommandShim } from '../lib/windows-command-shim.mjs';

describe('Windows command shim', () => {
  it.skipIf(process.platform !== 'win32')('rejects arguments that require cmd.exe metacharacter parsing', () => {
    for (const value of ['&', '|', '<', '>', '^', '%', '!', '"', '\r', '\n']) {
      expect(() => resolveCommandShim('tool.cmd', [value])).toThrow('cannot be passed safely');
    }
  });

  it.skipIf(process.platform !== 'win32')('resolves a shim through case-insensitive PATH and PATHEXT', () => {
    const directory = mkdtempSync(join(tmpdir(), 'command shim-'));
    const shadowDirectory = mkdtempSync(join(tmpdir(), 'command path-shadow-'));
    const shimPath = join(directory, 'tool.cmd');
    const exePath = join(directory, 'tool.exe');
    writeFileSync(shimPath, '');
    writeFileSync(exePath, '');
    const env = {
      Path: directory,
      path: shadowDirectory,
      pAtHeXt: '.CMD;.EXE',
      cOmSpEc: 'C:\\Windows\\System32\\cmd.exe',
    };

    try {
      const invocation = resolveCommandShim('tool', ['argument with spaces'], { env, cwd: directory });
      expect(invocation.command).toBe(env.cOmSpEc);
      expect(invocation.args).toEqual(['/d', '/s', '/c', `""${shimPath}" "argument with spaces""`]);
      expect(invocation.spawnOptions).toEqual({ windowsVerbatimArguments: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(shadowDirectory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('skips missing PATH entries and honors native PATHEXT precedence', () => {
    const emptyDirectory = mkdtempSync(join(tmpdir(), 'command-empty-path-'));
    const directory = mkdtempSync(join(tmpdir(), 'command-native-'));
    const shimPath = join(directory, 'tool.cmd');
    const exePath = join(directory, 'tool.exe');
    writeFileSync(shimPath, '');
    writeFileSync(exePath, '');

    try {
      expect(
        resolveCommandShim('tool', ['arg'], {
          env: { PATH: `${emptyDirectory};${directory}`, PATHEXT: '.EXE;.CMD' },
        })
      ).toEqual({ command: exePath, args: ['arg'], spawnOptions: {} });
      expect(resolveCommandShim('tool.exe', ['arg'], { env: { PATH: `${emptyDirectory};${directory}` } })).toEqual({
        command: exePath,
        args: ['arg'],
        spawnOptions: {},
      });
    } finally {
      rmSync(emptyDirectory, { recursive: true, force: true });
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('resolves relative PATH entries against the invocation directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'command relative-path-'));
    const binDirectory = join(directory, 'bin');
    const shimPath = join(binDirectory, 'tool.cmd');
    mkdirSync(binDirectory);
    writeFileSync(shimPath, '');

    try {
      const invocation = resolveCommandShim('tool.cmd', [], {
        env: { PATH: 'bin', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
        cwd: directory,
      });
      expect(invocation.args[3]).toContain(shimPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('does not resolve an unqualified shim from the current directory', () => {
    const currentDirectory = mkdtempSync(join(tmpdir(), 'command-cwd-'));
    const pathDirectory = mkdtempSync(join(tmpdir(), 'command-path-'));
    writeFileSync(join(currentDirectory, 'tool.cmd'), '');

    try {
      expect(() => resolveCommandShim('tool.cmd', [], { env: { PATH: pathDirectory }, cwd: currentDirectory })).toThrow(
        'was not found in PATH'
      );
    } finally {
      rmSync(currentDirectory, { recursive: true, force: true });
      rmSync(pathDirectory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'quotes paths with spaces and preserves an unspaced trailing backslash',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'command (quoted)-'));
      const shimPath = join(directory, 'tool.cmd');
      writeFileSync(shimPath, '');
      const trailingSlash = 'C:\\tmp\\';

      try {
        const invocation = resolveCommandShim(shimPath, ['argument with spaces', trailingSlash], {
          env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
          cwd: directory,
        });
        expect(invocation.args[3]).toBe(`""${shimPath}" "argument with spaces" ${trailingSlash}"`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform !== 'win32')('rejects a spaced argument ending in a backslash', () => {
    const directory = mkdtempSync(join(tmpdir(), 'command-space-backslash-'));
    const shimPath = join(directory, 'tool.cmd');
    writeFileSync(shimPath, '');

    try {
      expect(() =>
        resolveCommandShim(shimPath, ['C:\\path with space\\'], {
          env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
          cwd: directory,
        })
      ).toThrow('cannot end in a backslash');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('rejects a missing path-qualified shim before starting cmd.exe', () => {
    const directory = mkdtempSync(join(tmpdir(), 'command-missing-path-'));

    try {
      expect(() =>
        resolveCommandShim(join(directory, 'missing.cmd'), [], { env: { PATH: directory }, cwd: directory })
      ).toThrow('Windows command shim was not found:');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('resolves drive-relative shim paths against the invocation directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'command drive-relative-'));
    const shimPath = join(directory, 'tool.cmd');
    writeFileSync(shimPath, '');
    const command = `${directory.slice(0, 2)}tool.cmd`;

    try {
      const invocation = resolveCommandShim(command, [], {
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
        cwd: directory,
      });
      expect(invocation.args[3]).toContain(`"${win32.resolve(directory, command)}"`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('passes non-Windows invocations through unchanged', () => {
    const args = ['arg&value'];

    expect(resolveCommandShim('tool.cmd', args)).toEqual({ command: 'tool.cmd', args, spawnOptions: {} });
  });
});
