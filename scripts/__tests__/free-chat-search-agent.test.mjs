import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

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

describe('Codex session timestamps', () => {
  it('interprets ISO updated_at values as dates, not epoch milliseconds', () => {
    const agentModule = pathToFileURL(resolve('scripts/free-chat-search-agent.mjs')).href;
    const source = `
      import { DatabaseSync } from 'node:sqlite';
      import { buildCodexQuery } from ${JSON.stringify(agentModule)};
      const query = buildCodexQuery(['needle']);
      const database = new DatabaseSync(':memory:');
      database.exec(\`
        CREATE TABLE sessions (id TEXT, summary TEXT, cwd TEXT, updated_at TEXT);
        CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT);
        INSERT INTO sessions VALUES ('session-1', 'A session', '/tmp', '2026-10-30T12:34:56.789Z');
        INSERT INTO turns VALUES ('session-1', 1, 'needle', '');
      \`);
      console.log(JSON.stringify(database.prepare(query.sql).all(...query.params)));
      database.close();
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)[0].updated).toBe('2026-10-30 12:34:56');
  });
});
