import { describe, expect, it } from 'vitest';

import { resolveCommandShim } from '../lib/windows-command-shim.mjs';

describe('Windows command shim', () => {
  it.skipIf(process.platform !== 'win32')('rejects arguments that require cmd.exe metacharacter parsing', () => {
    for (const value of ['&', '|', '<', '>', '^', '%', '!', '"']) {
      expect(() => resolveCommandShim('tool.cmd', [value])).toThrow('cannot be passed safely');
    }
  });

  it.skipIf(process.platform === 'win32')('passes non-Windows invocations through unchanged', () => {
    const args = ['arg&value'];

    expect(resolveCommandShim('tool.cmd', args)).toEqual({ command: 'tool.cmd', args, spawnOptions: {} });
  });
});
