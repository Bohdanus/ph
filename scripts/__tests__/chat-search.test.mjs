import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs, integerOption } from '../chat-search.mjs';
import {
  escapeLike,
  searchTermsFromQuery,
  truncateMiddle,
  openReadOnlyDb,
  searchCopilotSessions,
  executeChatSearch,
  MAX_PROMPT_CHARS,
  validatePath,
  validateCodexRolloutPath,
} from '../lib/chat-search.mjs';

/* ---------- helpers ---------- */

function makeMockStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
    },
    get output() {
      return chunks.join('');
    },
  };
}

function createTestKiloDb(
  dbPath,
  { sessionId = 'sess-1', sessionText = 'chat search test content', partSessionId = sessionId } = {}
) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT,
      title TEXT,
      directory TEXT,
      agent TEXT,
      time_updated INTEGER,
      parent_id TEXT
    );
    CREATE TABLE message (
      id TEXT,
      session_id TEXT,
      time_created INTEGER,
      data TEXT
    );
    CREATE TABLE part (
      message_id TEXT,
      time_created INTEGER,
      session_id TEXT,
      data TEXT
    );
  `);

  const timeMs = Date.now();
  const partData = JSON.stringify({
    type: 'text',
    text: sessionText,
    synthetic: 0,
    ignored: 0,
  });
  const messageData = JSON.stringify({ role: 'user', text: sessionText });

  db.prepare(
    'INSERT INTO session (id, title, directory, agent, time_updated, parent_id) VALUES (?, ?, ?, ?, ?, NULL)'
  ).run(sessionId, 'Test Session', '/tmp/test', 'kilo', timeMs);
  db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    `${sessionId}-msg`,
    sessionId,
    timeMs,
    messageData
  );
  db.prepare('INSERT INTO part (message_id, time_created, session_id, data) VALUES (?, ?, ?, ?)').run(
    `${sessionId}-msg`,
    timeMs,
    partSessionId,
    partData
  );

  db.close();
}

function makeMockComplete() {
  return vi.fn(async (prompt) => {
    if (prompt.includes('relevance-ranking')) {
      const count = (prompt.match(/--- Excerpt \d+/g) || []).length;
      const ranking = Array.from({ length: count }, (_, i) => ({
        index: i,
        relevance: 10 - i,
      }));
      return {
        content: JSON.stringify(ranking),
        source: 'mock',
        model: 'mock-model',
        finishReason: 'stop',
        usage: { prompt_tokens: 100, completion_tokens: 10 },
        requestCounts: { total: 1 },
      };
    }
    return {
      content: 'Test synthesized answer.',
      source: 'mock',
      model: 'mock-model',
      finishReason: 'stop',
      usage: { prompt_tokens: 200, completion_tokens: 20 },
      requestCounts: { total: 2 },
    };
  });
}

function makeMockResolveStores(kiloDbPath) {
  return () => ({
    kiloDb: kiloDbPath,
    codexHome: '/nonexistent-codex-home',
    codexSessionsDir: '/nonexistent-codex-home/sessions',
    codexArchivedDir: '/nonexistent-codex-home/archived_sessions',
    copilotDb: '/nonexistent-copilot.db',
    codeUser: '/nonexistent-code-user',
  });
}

/* ---------- escapeLike ---------- */

describe('escapeLike', () => {
  it('escapes percent signs', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes underscores', () => {
    expect(escapeLike('a_b_c')).toBe('a\\_b\\_c');
  });

  it('escapes backslashes', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('escapes all three wildcard chars together', () => {
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world');
  });

  it('handles mixed content', () => {
    expect(escapeLike('50% off_test\\path')).toBe('50\\% off\\_test\\\\path');
  });
});

/* ---------- searchTermsFromQuery ---------- */

describe('searchTermsFromQuery', () => {
  it('splits on whitespace and lowercases', () => {
    expect(searchTermsFromQuery('Hello World TEST')).toEqual(['hello', 'world', 'test']);
  });

  it('splits on commas and semicolons', () => {
    expect(searchTermsFromQuery('hello, world; test')).toEqual(['hello', 'world', 'test']);
  });

  it('deduplicates terms', () => {
    expect(searchTermsFromQuery('hello hello world')).toEqual(['hello', 'world']);
  });

  it('filters out terms shorter than 2 characters', () => {
    expect(searchTermsFromQuery('a b cd')).toEqual(['cd']);
  });

  it('strips non-word characters except dot and hyphen', () => {
    expect(searchTermsFromQuery('hello! world? @test')).toEqual(['hello', 'world', 'test']);
  });

  it('preserves hyphens and dots in terms', () => {
    expect(searchTermsFromQuery('e2e-test hello.world')).toEqual(['e2e-test', 'hello.world']);
  });

  it('trims leading and trailing hyphens and dots from tokens', () => {
    expect(searchTermsFromQuery('-hello- .world.')).toEqual(['hello', 'world']);
  });

  it('returns empty array for empty or whitespace-only query', () => {
    expect(searchTermsFromQuery('')).toEqual([]);
    expect(searchTermsFromQuery('   ')).toEqual([]);
    expect(searchTermsFromQuery(null)).toEqual([]);
    expect(searchTermsFromQuery(undefined)).toEqual([]);
  });

  it('falls back to truncated whole query when no term qualifies', () => {
    expect(searchTermsFromQuery('a b')).toEqual(['a b']);
  });

  it('truncates fallback to 60 characters', () => {
    const longQuery = Array.from({ length: 80 }, () => 'a').join(' ');
    const result = searchTermsFromQuery(longQuery);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(60);
  });

  it('handles multiple spaces between terms', () => {
    expect(searchTermsFromQuery('hello    world')).toEqual(['hello', 'world']);
  });

  it('handles mixed separators', () => {
    expect(searchTermsFromQuery('hello, world;test foo.bar')).toEqual(['hello', 'world', 'test', 'foo.bar']);
  });

  it('preserves Unicode words in search queries', () => {
    expect(searchTermsFromQuery('Малювання слой')).toEqual(['малювання', 'слой']);
  });
});

describe('path validation', () => {
  it('rejects path-prefix siblings and symlink escapes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-search-path-'));
    const allowed = join(dir, 'allowed');
    const prefixSibling = `${allowed}-escape`;
    const outside = join(dir, 'outside');
    const link = join(allowed, 'linked');
    const outsideFile = join(outside, 'secret.jsonl');
    const siblingFile = join(prefixSibling, 'prompt.txt');

    try {
      mkdirSync(allowed);
      mkdirSync(prefixSibling);
      mkdirSync(outside);
      writeFileSync(outsideFile, 'private');
      symlinkSync(outside, link, 'dir');

      expect(validatePath(siblingFile, [allowed])).toBe(false);
      expect(validatePath(join(link, 'secret.jsonl'), [allowed])).toBe(false);
      expect(validateCodexRolloutPath(join(`${allowed}-escape`, 'rollout.jsonl'), allowed)).toBe(false);
      expect(validateCodexRolloutPath(join(link, 'secret.jsonl'), allowed)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ---------- truncateMiddle ---------- */

describe('truncateMiddle', () => {
  it('returns text as-is when shorter than maxChars', () => {
    expect(truncateMiddle('hello world', 100)).toBe('hello world');
  });

  it('returns text as-is when exactly maxChars', () => {
    const text = 'abc';
    expect(truncateMiddle(text, 3)).toBe(text);
  });

  it('truncates long text with marker in the middle', () => {
    const text = 'A'.repeat(20);
    const result = truncateMiddle(text, 10);
    expect(result).toContain('…[truncated]…');
    const parts = result.split('\n…[truncated]…\n');
    expect(parts[0].length).toBe(5);
    expect(parts[1].length).toBe(5);
  });

  it('returns empty string for empty string input', () => {
    expect(truncateMiddle('', 10)).toBe('');
  });

  it('returns non-string input as-is', () => {
    expect(truncateMiddle(null, 10)).toBeNull();
    expect(truncateMiddle(undefined, 10)).toBeUndefined();
    expect(truncateMiddle(42, 10)).toBe(42);
  });

  it('produces head + middle + tail structure for very long text', () => {
    const text = 'HEAD' + 'X'.repeat(100) + 'TAIL';
    const result = truncateMiddle(text, 16);
    expect(result).toBe('HEADXXXX\n…[truncated]…\nXXXXTAIL');
  });

  it('uses floor for odd maxChars', () => {
    const text = 'A'.repeat(21);
    const result = truncateMiddle(text, 11);
    const half = Math.floor(11 / 2);
    const parts = result.split('\n…[truncated]…\n');
    expect(parts[0].length).toBe(half);
    expect(parts[1].length).toBe(half);
  });
});

/* ---------- openReadOnlyDb ---------- */

describe('openReadOnlyDb', () => {
  it('returns null for a non-existent file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const missingPath = join(dir, 'does-not-exist.db');
    expect(openReadOnlyDb(missingPath)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a directory path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    expect(openReadOnlyDb(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens a non-SQLite file but actual queries fail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const txtPath = join(dir, 'not-a-db.txt');
    writeFileSync(txtPath, 'this is plain text, not a SQLite database');
    const db = openReadOnlyDb(txtPath);
    expect(db).not.toBeNull();
    expect(() => {
      db.prepare('SELECT name FROM sqlite_master WHERE type = "table"').get();
    }).toThrow();
    try {
      db.close();
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens a valid SQLite database read-only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE test (id INTEGER)');
    db.exec('INSERT INTO test VALUES (1)');
    db.close();

    const opened = openReadOnlyDb(dbPath);
    expect(opened).not.toBeNull();

    const row = opened.prepare('SELECT id FROM test').get();
    expect(row.id).toBe(1);

    opened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enforces query_only pragma so writes are rejected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'test.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE test (id INTEGER)');
    db.close();

    const opened = openReadOnlyDb(dbPath);
    expect(opened).not.toBeNull();
    expect(() => {
      opened.exec('CREATE TABLE fail (x INTEGER)');
    }).toThrow();

    opened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('searchCopilotSessions', () => {
  it('filters and orders ISO timestamp text as dates', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sessions (
        id TEXT,
        updated_at TEXT,
        cwd TEXT,
        repository TEXT,
        branch TEXT,
        agent_name TEXT,
        created_at TEXT
      );
      CREATE TABLE turns (
        session_id TEXT,
        turn_index INTEGER,
        user_message TEXT,
        assistant_response TEXT,
        timestamp TEXT
      );
    `);
    const insertSession = db.prepare('INSERT INTO sessions (id, updated_at, cwd) VALUES (?, ?, ?)');
    const insertTurn = db.prepare(
      'INSERT INTO turns (session_id, turn_index, user_message, assistant_response) VALUES (?, ?, ?, ?)'
    );
    const sinceMs = Date.parse('2026-10-30T00:00:00.000Z');
    insertSession.run('old', '2026-10-29T23:59:59.999Z', '/old');
    insertSession.run('first', '2026-10-30T00:00:00.001Z', '/first');
    insertSession.run('last', '2026-10-31T12:00:00.000Z', '/last');
    insertSession.run('invalid', 'not-a-timestamp', '/invalid');
    for (const id of ['old', 'first', 'last', 'invalid']) {
      insertTurn.run(id, 0, 'needle', 'matching turn');
    }

    try {
      const results = searchCopilotSessions(db, ['needle'], sinceMs);
      expect(results.map((result) => result.id)).toEqual(['last', 'first']);
      expect(results[0].timeUpdatedMs).toBe(Date.parse('2026-10-31T12:00:00.000Z'));
    } finally {
      db.close();
    }
  });
});

/* ---------- parseArgs ---------- */

describe('parseArgs', () => {
  it('parses a value flag and its argument', () => {
    const parsed = parseArgs(['--query', 'hello world']);
    expect(parsed.values.get('--query')).toBe('hello world');
    expect(parsed.probeQuota).toBe(false);
    expect(parsed.groqFreePlan).toBe(false);
  });

  it('parses multiple flags', () => {
    const parsed = parseArgs(['--query', 'test', '--providers', 'kilo', '--days', '7']);
    expect(parsed.values.get('--query')).toBe('test');
    expect(parsed.values.get('--providers')).toBe('kilo');
    expect(parsed.values.get('--days')).toBe('7');
  });

  it('parses --help as a help flag', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true });
  });

  it('parses -h as a help flag', () => {
    expect(parseArgs(['-h'])).toEqual({ help: true });
  });

  it('parses --probe-openrouter-quota as a boolean flag', () => {
    const parsed = parseArgs(['--probe-openrouter-quota', '--query', 'test']);
    expect(parsed.probeQuota).toBe(true);
    expect(parsed.values.get('--query')).toBe('test');
  });

  it('parses --groq-free-plan as a boolean flag', () => {
    const parsed = parseArgs(['--groq-free-plan']);
    expect(parsed.groqFreePlan).toBe(true);
  });

  it('combines boolean flags with value flags', () => {
    const parsed = parseArgs(['--probe-openrouter-quota', '--groq-free-plan', '--query', 'hello']);
    expect(parsed.probeQuota).toBe(true);
    expect(parsed.groqFreePlan).toBe(true);
    expect(parsed.values.get('--query')).toBe('hello');
  });

  it('returns empty values for no args', () => {
    const parsed = parseArgs([]);
    expect(parsed.values.size).toBe(0);
    expect(parsed.probeQuota).toBe(false);
    expect(parsed.groqFreePlan).toBe(false);
  });

  it('throws on unknown option', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option: --unknown');
  });

  it('does not accept API keys as command-line arguments', () => {
    expect(() => parseArgs(['--groq-api-key', 'placeholder'])).toThrow('Unknown option: --groq-api-key');
  });

  it('throws when a value flag has no value', () => {
    expect(() => parseArgs(['--query'])).toThrow('--query requires a value');
  });

  it('throws when a value flag is followed by another flag', () => {
    expect(() => parseArgs(['--query', '--providers'])).toThrow('--query requires a value');
  });

  it('throws on duplicate option', () => {
    expect(() => parseArgs(['--query', 'a', '--query', 'b'])).toThrow('Duplicate option: --query');
  });
});

/* ---------- integerOption ---------- */

describe('integerOption', () => {
  it('returns the fallback when the flag is absent', () => {
    const values = new Map();
    expect(integerOption(values, '--days', 30, 1, 3650)).toBe(30);
  });

  it('returns the parsed integer when valid', () => {
    const values = new Map([['--days', '7']]);
    expect(integerOption(values, '--days', 30, 1, 3650)).toBe(7);
  });

  it('returns the min boundary value', () => {
    const values = new Map([['--days', '1']]);
    expect(integerOption(values, '--days', 30, 1, 3650)).toBe(1);
  });

  it('returns the max boundary value', () => {
    const values = new Map([['--days', '3650']]);
    expect(integerOption(values, '--days', 30, 1, 3650)).toBe(3650);
  });

  it('throws when the value is not a digit string', () => {
    const values = new Map([['--days', 'abc']]);
    expect(() => integerOption(values, '--days', 30, 1, 3650)).toThrow('--days must be an integer from 1 to 3650');
  });

  it('throws when the value is below the minimum', () => {
    const values = new Map([['--days', '0']]);
    expect(() => integerOption(values, '--days', 30, 1, 3650)).toThrow('--days must be an integer from 1 to 3650');
  });

  it('throws when the value is above the maximum', () => {
    const values = new Map([['--days', '3651']]);
    expect(() => integerOption(values, '--days', 30, 1, 3650)).toThrow('--days must be an integer from 1 to 3650');
  });

  it('throws for negative numbers (regex rejects the minus sign)', () => {
    const values = new Map([['--days', '-5']]);
    expect(() => integerOption(values, '--days', 30, 1, 3650)).toThrow('--days must be an integer from 1 to 3650');
  });
});

/* ---------- executeChatSearch ---------- */

describe('executeChatSearch', () => {
  it('quiet mode suppresses progress while preserving the final answer and errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-quiet-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);
    const stderr = makeMockStream();
    const stdout = makeMockStream();

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      quiet: true,
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl: makeMockComplete(),
    });

    expect(code).toBe(0);
    expect(stderr.output).toBe('');
    expect(stdout.output).toContain('Test synthesized answer.');

    const invalidStderr = makeMockStream();
    const invalidCode = await executeChatSearch({ query: '', quiet: true, stderr: invalidStderr, stdout });
    expect(invalidCode).toBe(2);
    expect(invalidStderr.output).toContain('no query provided');

    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 2 when no query is provided', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const code = await executeChatSearch({ stderr, stdout });
    expect(code).toBe(2);
    expect(stderr.output).toMatch(/no query provided/);
  });

  it('returns 2 when the query exceeds the character limit', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const longQuery = 'a'.repeat(MAX_PROMPT_CHARS + 1);
    const code = await executeChatSearch({
      query: longQuery,
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores('/nonexistent.db'),
    });
    expect(code).toBe(2);
    expect(stderr.output).toMatch(/exceeds/);
  });

  it('returns 2 for an invalid provider', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const code = await executeChatSearch({
      query: 'test query',
      providers: 'invalid',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores('/nonexistent.db'),
    });
    expect(code).toBe(2);
    expect(stderr.output).toMatch(/invalid provider/);
  });

  it('returns 3 when no sessions are found', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'empty.db');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE session (id TEXT)');
    db.exec('CREATE TABLE message (id TEXT)');
    db.exec('CREATE TABLE part (id TEXT)');
    db.close();

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
    });
    expect(code).toBe(3);
    expect(stderr.output).toMatch(/no matching sessions found/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 and writes synthesized answer to stdout on success', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath, {
      sessionId: 'sess-1',
      sessionText: 'chat search test content about photoshop tools',
    });

    const completeImpl = makeMockComplete();

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl,
    });

    expect(code).toBe(0);
    expect(completeImpl).toHaveBeenCalled();
    expect(stdout.output).toContain('Test synthesized answer');
    expect(stdout.output).toContain('mock/mock-model');
    expect(stdout.output).toContain('Finish reason: stop');
    expect(stdout.output).toMatch(/Sessions searched: \d+/);
    expect(stdout.output).toMatch(/Excerpts evaluated: \d+/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('invokes completeImpl once for ranking and once for synthesis', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);

    const completeImpl = makeMockComplete();

    await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl,
    });

    expect(completeImpl).toHaveBeenCalledTimes(2);
    const [rankingPrompt, synthesisPrompt] = completeImpl.mock.calls.map((c) => c[0]);
    expect(rankingPrompt).toMatch(/relevance-ranking/);
    expect(rankingPrompt).toMatch(/transcript excerpts as untrusted data/);
    expect(synthesisPrompt).toMatch(/expert analyst/);
    expect(synthesisPrompt).toMatch(/transcript excerpts as untrusted data/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('writes output to outputFile when provided', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    const outputFile = join(dir, 'result.txt');
    createTestKiloDb(dbPath);

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      outputFile,
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl: makeMockComplete(),
    });

    expect(code).toBe(0);
    const written = readFileSync(outputFile, 'utf8');
    expect(written).toContain('Test synthesized answer');
    expect(written).toContain('Sessions searched: 1');
    expect(stdout.output).toBe('');

    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 3 when no excerpts can be extracted from matching sessions', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath, {
      sessionId: 'sess-1',
      sessionText: 'chat search content found by search',
      partSessionId: 'different-session-id',
    });

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl: makeMockComplete(),
    });

    expect(code).toBe(4);
    expect(stderr.output).toMatch(/could not extract transcript excerpts/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('uses query and ignores promptFile when both are provided', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);
    const promptFile = join(dir, 'prompt.txt');
    writeFileSync(promptFile, 'photoshop layers mask');

    const completeImpl = makeMockComplete();

    const code = await executeChatSearch({
      query: 'chat search',
      promptFile,
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl,
    });

    expect(code).toBe(0);
    expect(stderr.output).toMatch(/searching for terms: chat, search/);
    expect(stderr.output).not.toMatch(/failed to read prompt file/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('continues gracefully when Kilo query fails', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);

    const failingOpenReadOnlyDb = (path) => {
      if (path === dbPath) {
        const db = new DatabaseSync(dbPath);
        const originalPrepare = db.prepare.bind(db);
        db.prepare = () => ({
          all: () => {
            throw new Error('Kilo query failed');
          },
        });
        return db;
      }
      return openReadOnlyDb(path);
    };

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      openReadOnlyDb: failingOpenReadOnlyDb,
      completeImpl: makeMockComplete(),
    });

    expect(code).toBe(3);
    expect(stderr.output).toMatch(/Kilo query failed/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('continues gracefully when Codex rollout scan fails', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'codex',
      stderr,
      stdout,
      resolveChatStores: () => ({
        kiloDb: dbPath,
        codexHome: '/nonexistent-codex-home',
        codexSessionsDir: '/nonexistent-codex-home/sessions',
        codexArchivedDir: '/nonexistent-codex-home/archived_sessions',
        copilotDb: '/nonexistent-copilot.db',
      }),
      openReadOnlyDb: (path) => {
        if (path.includes('state')) {
          const db = new DatabaseSync(':memory:');
          db.exec(`CREATE TABLE backfill_state (id INTEGER, status TEXT);`);
          db.exec(`INSERT INTO backfill_state VALUES (1, 'complete');`);
          return db;
        }
        return openReadOnlyDb(path);
      },
      findLatestStateDb: () => '/fake/state.db',
      isBackfillComplete: () => true,
      searchCodexRollouts: async () => {
        throw new Error('Codex rollout scan failed');
      },
      completeImpl: makeMockComplete(),
    });

    expect(stderr.output).toMatch(/Codex rollout scan failed/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('continues gracefully when Copilot query fails', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    createTestKiloDb(dbPath);

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'copilot',
      stderr,
      stdout,
      resolveChatStores: () => ({
        kiloDb: dbPath,
        codexHome: '/nonexistent-codex-home',
        codexSessionsDir: '/nonexistent-codex-home/sessions',
        codexArchivedDir: '/nonexistent-codex-home/archived_sessions',
        copilotDb: '/fake/copilot.db',
      }),
      openReadOnlyDb: (path) => {
        if (path === '/fake/copilot.db') {
          const db = new DatabaseSync(':memory:');
          db.exec(`CREATE TABLE sessions (id TEXT, updated_at TEXT, cwd TEXT, summary TEXT);`);
          db.exec(
            `CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT);`
          );
          const prepare = db.prepare.bind(db);
          db.prepare = () => ({
            all: () => {
              throw new Error('Copilot query failed');
            },
          });
          return db;
        }
        return openReadOnlyDb(path);
      },
      completeImpl: makeMockComplete(),
    });

    expect(stderr.output).toMatch(/Copilot query failed/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('handles output file write failure', async () => {
    const stderr = makeMockStream();
    const stdout = makeMockStream();
    const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
    const dbPath = join(dir, 'kilo.db');
    const outputFile = join(dir, 'result.txt');
    createTestKiloDb(dbPath);

    const failingWriteFile = async (path, content, encoding) => {
      if (path === outputFile) throw new Error('Permission denied');
      return Promise.resolve();
    };

    const code = await executeChatSearch({
      query: 'chat search',
      providers: 'kilo',
      outputFile,
      stderr,
      stdout,
      resolveChatStores: makeMockResolveStores(dbPath),
      completeImpl: makeMockComplete(),
      writeFileFn: failingWriteFile,
    });

    expect(code).toBe(1);
    expect(stderr.output).toMatch(/Failed to write output file: Permission denied/);

    rmSync(dir, { recursive: true, force: true });
  });
});
