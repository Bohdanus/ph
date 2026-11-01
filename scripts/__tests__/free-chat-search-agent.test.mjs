import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cliPath = resolve('scripts/free-chat-search-agent.mjs');

describe('chat search CLI numeric options', () => {
  it.each([
    ['--limit', '20junk'],
    ['--max-sessions', '50junk'],
    ['--summary-tokens', '400junk'],
  ])('rejects a malformed value for %s', (flag, value) => {
    const result = spawnSync(process.execPath, [cliPath, 'history', flag, value], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be an integer');
  });
});
