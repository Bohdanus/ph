import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const SCRIPT = join(import.meta.dirname, '..', 'quiet-command.mjs');

vi.setConfig({ testTimeout: 15_000 });

function run(command, ...args) {
  return spawnSync(process.execPath, [SCRIPT, command, ...args], {
    encoding: 'buffer',
    maxBuffer: 3 * 1024 * 1024,
  });
}

describe('quiet-command', () => {
  it('discards stdout and stderr from a successful command', () => {
    const result = run(process.execPath, '-e', "process.stdout.write('out'); process.stderr.write('err')");

    expect(result.status).toBe(0);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toBe('');
  });

  it('preserves the exact nonzero exit code of a failing command', () => {
    const result = run(process.execPath, '-e', 'process.exit(7)');

    expect(result.status).toBe(7);
    expect(result.stderr.toString()).toBe('');
  });

  it('replays captured output when a command fails', () => {
    const result = run(
      process.execPath,
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"
    );

    expect(result.status).toBe(7);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain('out');
    expect(result.stderr.toString()).toContain('err');
  });

  it('bounds combined failure output and reports when it is truncated', () => {
    const maxCaptureBytes = 1024 * 1024;
    const code =
      'process.stdout.write(Buffer.alloc(600 * 1024, 97)); ' +
      'process.stderr.write(Buffer.alloc(600 * 1024, 98)); ' +
      'process.exitCode = 1;';
    const result = run(process.execPath, '-e', code);

    expect(result.status).toBe(1);
    expect(result.stdout).toEqual(Buffer.alloc(0));
    expect(result.stderr.byteLength).toBeLessThanOrEqual(maxCaptureBytes + 100);
    expect(result.stderr.toString('utf8')).toContain(
      `[quiet-command: output truncated after ${maxCaptureBytes} bytes]`
    );
  });

  it('replays failure diagnostics with byte-exact UTF-8', () => {
    const result = run(process.execPath, '-e', 'process.stderr.write(Buffer.from([0xe2,0x82,0xac])); process.exit(1)');

    expect(result.status).toBe(1);
    expect(result.stderr).toEqual(Buffer.from([0xe2, 0x82, 0xac]));
  });

  it('preserves split UTF-8 sequences across chunks', () => {
    const result = run(
      process.execPath,
      '-e',
      'process.stderr.write(Buffer.from([0xe2])); setImmediate(() => { process.stderr.write(Buffer.from([0x82,0xac])); process.exit(1); })'
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toEqual(Buffer.from([0xe2, 0x82, 0xac]));
  });

  it('clears repository context inherited from a git hook before starting a gate', () => {
    const variables = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_PREFIX',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    ];
    const env = {
      ...process.env,
      ...Object.fromEntries(variables.map((key) => [key, `/fixture/${key}`])),
    };
    const script =
      `const keys = ${JSON.stringify(variables)}; ` +
      'process.stdout.write(JSON.stringify(keys.filter((key) => process.env[key] !== undefined))); ' +
      'process.exit(1);';
    const result = spawnSync(process.execPath, [SCRIPT, process.execPath, '-e', script], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toEqual(Buffer.from('[]'));
  });

  it('reports spawn errors with a nonzero status', () => {
    const result = run('this-command-does-not-exist-xyz');

    expect(result.status).toBe(1);
  });

  it.skipIf(process.platform !== 'win32')('preserves .cmd argument boundaries without enabling shell parsing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'quiet command (test)-'));
    const command = join(directory, 'fake.cmd');
    const script = join(directory, 'fake.cjs');
    const args = ['argument with spaces', 'C:\\tmp\\'];
    writeFileSync(script, `process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(7);\n`);
    writeFileSync(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);

    try {
      const result = run(command, ...args);
      expect(result.status).toBe(7);
      expect(result.stderr.toString()).toContain(JSON.stringify(args));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('rejects shell metacharacters before a .cmd shim can run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'quiet command injection-'));
    const command = join(directory, 'fake.cmd');
    const marker = join(directory, 'launched.txt');
    writeFileSync(command, `@echo off\r\necho launched > "${marker}"\r\n`);

    try {
      const result = run(command, '& echo injected');
      expect(result.status).toBe(2);
      expect(result.stderr.toString()).toContain('cannot be passed safely');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('routes failure output to stderr and leaves stdout empty', () => {
    const result = run(
      process.execPath,
      '-e',
      "process.stdout.write('stdout-msg'); process.stderr.write('stderr-msg'); process.exit(2)"
    );

    expect(result.status).toBe(2);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain('stdout-msg');
    expect(result.stderr.toString()).toContain('stderr-msg');
  });
});
