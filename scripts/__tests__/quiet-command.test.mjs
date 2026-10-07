import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, '..', 'quiet-command.mjs');

function run(command, ...args) {
  return spawnSync(process.execPath, [SCRIPT, command, ...args], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024,
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

  it('replays failure diagnostics with byte-exact UTF-8', () => {
    const result = run(process.execPath, '-e', 'process.stderr.write(Buffer.from([0xe2,0x82,0xac])); process.exit(1)');

    expect(result.status).toBe(1);
    expect(result.stderr).toEqual(Buffer.from([0xe2, 0x82, 0xac]));
  });

  it('reports spawn errors with a nonzero status', () => {
    const result = run('this-command-does-not-exist-xyz');

    expect(result.status).toBe(1);
  });
});
