import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildCodexSearchQuery,
  buildSearchQuery,
  defaultTerms,
  deduplicateSessions,
  expandSearchTerms,
  fallbackSummary,
  findExistingCodexDbPath,
  findExistingDbPath,
  main,
  parseArgs,
  queryKiloDb,
  readPrompt,
  resolveCodexDbCandidates,
  resolveKiloDbCandidates,
  searchAllSources,
  searchChatHistory,
  shapeSessions,
  summarizeSearchResults,
} from '../free-chat-search.mjs';

function mockSpawnChild({ stdout = '', stderr = '', code = 0, signal = null, error = null, delay = 0 } = {}) {
  const child = new EventEmitter();
  child.kill = vi.fn();
  child.stdout = new EventEmitter();
  child.stdout.readable = true;
  child.stderr = new EventEmitter();
  child.stderr.readable = true;
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    child.stdout.emit('end');
    if (error) {
      child.emit('error', error);
    } else {
      child.emit('close', code, signal);
    }
  }, delay);
  return child;
}

const sampleDbRows = [
  {
    session_id: 'ses_abc123',
    title: 'Photoshop tool creation',
    directory: '/Users/test/project',
    updated: '2026-10-30 07:00:00',
    role: 'user',
    snippet: 'I need a new Color Replacement tool with its own options bar.',
  },
  {
    session_id: 'ses_abc123',
    title: 'Photoshop tool creation',
    directory: '/Users/test/project',
    updated: '2026-10-30 07:00:00',
    role: 'assistant',
    snippet: 'The operator decision: color/levels/transform must leave the rail.',
  },
  {
    session_id: 'ses_def456',
    title: 'E2E hardening',
    directory: '/Users/test/ph',
    updated: '2026-10-29 12:00:00',
    role: 'assistant',
    snippet: 'Fixed flaky Playwright visual regression baselines on Linux headless.',
  },
];

describe('SQL escaping', () => {
  it('doubles single quotes in search terms', () => {
    const sql = buildSearchQuery(["O'Brien"]) ?? '';
    expect(sql).toContain("O''Brien");
    expect(sql).not.toContain("O'Brien");
  });

  it('prevents SQL injection by doubling injected quotes', () => {
    const sql = buildSearchQuery(["'; DROP TABLE session; --"]) ?? '';
    expect(sql).toContain("'''; DROP TABLE session; --");
  });
});

describe('resolveKiloDbCandidates', () => {
  it('returns only the explicit path when kiLoDbPath is given', () => {
    expect(resolveKiloDbCandidates({ kiloDbPath: '/custom/db.db' })).toEqual(['/custom/db.db']);
  });

  it('includes XDG, local/share, and macOS Library paths in order', () => {
    const candidates = resolveKiloDbCandidates({
      homeDir: '/Users/user',
      xdgDataHome: '/xdg',
      platform: 'darwin',
    });
    expect(candidates).toEqual([
      '/xdg/kilo/kilo.db',
      '/Users/user/.local/share/kilo/kilo.db',
      '/Users/user/Library/Application Support/kilo/kilo.db',
    ]);
  });

  it('omits the macOS Library path on Linux', () => {
    const candidates = resolveKiloDbCandidates({ homeDir: '/home/user', platform: 'linux' });
    expect(candidates).toEqual(['/home/user/.local/share/kilo/kilo.db']);
  });
});

describe('findExistingDbPath', () => {
  it('returns the first candidate that exists', async () => {
    const statFn = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValueOnce(undefined);
    const result = await findExistingDbPath({ homeDir: '/Users/user', platform: 'darwin' }, { statFn });
    expect(result).toBe('/Users/user/Library/Application Support/kilo/kilo.db');
    expect(statFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to the first candidate when none exist', async () => {
    const statFn = vi.fn().mockRejectedValue(new Error('missing'));
    const result = await findExistingDbPath({ homeDir: '/home/user', platform: 'linux' }, { statFn });
    expect(result).toBe('/home/user/.local/share/kilo/kilo.db');
  });

  it('uses the explicit dbPath when provided without stat', async () => {
    const statFn = vi.fn();
    const result = await findExistingDbPath({ kiloDbPath: '/explicit/db.db', homeDir: '/home/user' }, { statFn });
    expect(result).toBe('/explicit/db.db');
    expect(statFn).not.toHaveBeenCalled();
  });
});

describe('buildSearchQuery', () => {
  it('builds a query for multiple terms with OR logic', () => {
    const sql = buildSearchQuery(['brush', 'tool']);
    expect(sql).toContain("instr(lower(coalesce(json_extract(p.data, '$.text'), '')), lower('brush')) > 0");
    expect(sql).toContain("instr(lower(coalesce(json_extract(p.data, '$.text'), '')), lower('tool')) > 0");
    expect(sql).toContain('WITH recent AS');
    expect(sql).toContain('LIMIT');
  });

  it('uses a CTE to scope the search to recent sessions', () => {
    const sql = buildSearchQuery(['test'], { maxSessions: 50 }) ?? '';
    expect(sql).toContain('WITH recent AS (');
    expect(sql).toContain('SELECT id FROM session ORDER BY time_updated DESC LIMIT 50');
    expect(sql).toContain('JOIN session AS s ON s.id = r.id');
  });

  it('clamps maxSessions to the allowed range', () => {
    const sqlLow = buildSearchQuery(['test'], { maxSessions: 1 }) ?? '';
    expect(sqlLow).toContain('LIMIT 10');
    const sqlHigh = buildSearchQuery(['test'], { maxSessions: 99999 }) ?? '';
    expect(sqlHigh).toContain('LIMIT 500');
  });

  it('escapes single quotes in terms', () => {
    const sql = buildSearchQuery(["O'Brien"]) ?? '';
    expect(sql).toContain("O''Brien");
  });

  it('returns null for empty or invalid terms', () => {
    expect(buildSearchQuery([])).toBeNull();
    expect(buildSearchQuery([''])).toBeNull();
    expect(buildSearchQuery(['   '])).toBeNull();
    expect(buildSearchQuery([null])).toBeNull();
  });

  it('caps the LIMIT to MAX_MATCHES_PER_QUERY', () => {
    const sql = buildSearchQuery(['test'], { maxMatches: 99999 });
    const limitMatch = sql?.match(/LIMIT (\d+)/);
    expect(limitMatch).toBeTruthy();
    expect(Number(limitMatch[1])).toBeLessThanOrEqual(200);
  });

  it('uses a minimum limit of 1', () => {
    const sql = buildSearchQuery(['test'], { maxMatches: -5 });
    const limitMatch = sql?.match(/LIMIT (\d+)/);
    expect(Number(limitMatch[1])).toBeGreaterThanOrEqual(1);
  });
});

describe('buildCodexSearchQuery', () => {
  it('builds a query for multiple terms with OR logic on user/assistant messages', () => {
    const sql = buildCodexSearchQuery(['brush', 'tool']);
    expect(sql).toContain(
      "instr(lower(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, '')), lower('brush')) > 0"
    );
    expect(sql).toContain(
      "instr(lower(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, '')), lower('tool')) > 0"
    );
    expect(sql).toContain('WITH recent AS');
    expect(sql).toContain('LIMIT');
  });

  it('uses a CTE to scope the search to recent sessions', () => {
    const sql = buildCodexSearchQuery(['test'], { maxSessions: 50 }) ?? '';
    expect(sql).toContain('WITH recent AS (');
    expect(sql).toContain('SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 50');
    expect(sql).toContain('JOIN sessions AS s ON s.id = r.id');
    expect(sql).toContain('JOIN turns AS t ON t.session_id = s.id');
  });

  it('clamps maxSessions to the allowed range', () => {
    const sqlLow = buildCodexSearchQuery(['test'], { maxSessions: 1 }) ?? '';
    expect(sqlLow).toContain('LIMIT 10');
    const sqlHigh = buildCodexSearchQuery(['test'], { maxSessions: 99999 }) ?? '';
    expect(sqlHigh).toContain('LIMIT 500');
  });

  it('escapes single quotes in terms', () => {
    const sql = buildCodexSearchQuery(["O'Brien"]) ?? '';
    expect(sql).toContain("O''Brien");
  });

  it('returns null for empty or invalid terms', () => {
    expect(buildCodexSearchQuery([])).toBeNull();
    expect(buildCodexSearchQuery([''])).toBeNull();
    expect(buildCodexSearchQuery(['   '])).toBeNull();
    expect(buildCodexSearchQuery([null])).toBeNull();
  });

  it('uses user_message as title_source, summary as separate column, and ISO 8601 datetime', () => {
    const sql = buildCodexSearchQuery(['test']) ?? '';
    expect(sql).toContain("substr(coalesce(t.user_message, ''), 1, 80) AS title_source");
    expect(sql).toContain('s.summary AS summary');
    expect(sql).toContain('s.cwd AS directory');
    expect(sql).not.toContain('s.summary AS title');
    expect(sql).not.toContain('s.title');
    expect(sql).toContain('datetime(s.updated_at)');
    expect(sql).not.toContain('updated_at / 1000');
    expect(sql).not.toContain("datetime(s.updated_at / 1000, 'unixepoch')");
  });
});

describe('resolveCodexDbCandidates', () => {
  it('returns only the explicit path when codexDbPath is given', () => {
    expect(resolveCodexDbCandidates({ codexDbPath: '/custom/codex.db' })).toEqual(['/custom/codex.db']);
  });

  it('includes macOS path on darwin', () => {
    const candidates = resolveCodexDbCandidates({
      homeDir: '/Users/user',
      platform: 'darwin',
    });
    expect(candidates).toContain(
      '/Users/user/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db'
    );
  });

  it('includes Linux path on linux', () => {
    const candidates = resolveCodexDbCandidates({
      homeDir: '/home/user',
      platform: 'linux',
    });
    expect(candidates).toContain('/home/user/.config/Code/User/globalStorage/github.copilot-chat/session-store.db');
  });

  it('includes VS Code server path', () => {
    const candidates = resolveCodexDbCandidates({
      homeDir: '/home/user',
      platform: 'linux',
    });
    expect(candidates).toContain(
      '/home/user/.vscode-server/data/User/globalStorage/github.copilot-chat/session-store.db'
    );
  });
});

describe('findExistingCodexDbPath', () => {
  it('returns the first candidate that exists', async () => {
    const statFn = vi.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValueOnce(undefined);
    const result = await findExistingCodexDbPath({ homeDir: '/Users/user', platform: 'darwin' }, { statFn });
    expect(result).toBe('/Users/user/.vscode-server/data/User/globalStorage/github.copilot-chat/session-store.db');
    expect(statFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to the first candidate when none exist', async () => {
    const statFn = vi.fn().mockRejectedValue(new Error('missing'));
    const result = await findExistingCodexDbPath({ homeDir: '/home/user', platform: 'linux' }, { statFn });
    expect(result).toBe('/home/user/.config/Code/User/globalStorage/github.copilot-chat/session-store.db');
  });

  it('uses the explicit codexDbPath when provided without stat', async () => {
    const statFn = vi.fn();
    const result = await findExistingCodexDbPath(
      { codexDbPath: '/explicit/codex.db', homeDir: '/home/user' },
      { statFn }
    );
    expect(result).toBe('/explicit/codex.db');
    expect(statFn).not.toHaveBeenCalled();
  });
});

describe('searchAllSources', () => {
  const mockKiloRows = [
    {
      session_id: 'kilo_1',
      title: 'Kilo Session',
      directory: '/kilo',
      updated: '2026-10-30 12:00:00',
      snippet: 'kilo content',
    },
  ];
  const mockCodexRows = [
    {
      session_id: 'codex_1',
      title_source: 'How to use brush tools',
      summary: 'Codex Session',
      directory: '/codex',
      updated: '2026-10-30 13:00:00',
      snippet: 'codex content',
    },
  ];

  it('queries both Kilo and Codex DBs and merges results', async () => {
    const statFn = vi.fn().mockResolvedValue(undefined);
    const queryDb = vi.fn().mockResolvedValueOnce(mockKiloRows).mockResolvedValueOnce(mockCodexRows);
    const onInfo = vi.fn();
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
      onInfo,
    });
    expect(queryDb).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].source).toBe('codex');
    expect(result.results[1].source).toBe('kilo');
    expect(result.dbPaths).toHaveLength(2);
    expect(result.results[0].title).toBe('How to use brush tools');
    expect(onInfo).not.toHaveBeenCalled();
  });

  it('handles missing Codex DB gracefully', async () => {
    const statFn = vi.fn().mockImplementation((path) => {
      if (path.includes('copilot-chat') || path.includes('vscode-server')) {
        return Promise.reject(new Error('no such file'));
      }
      return Promise.resolve();
    });
    const queryDb = vi.fn().mockResolvedValueOnce(mockKiloRows);
    const onInfo = vi.fn();
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
      onInfo,
    });
    expect(queryDb).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('kilo');
    expect(onInfo).toHaveBeenCalledWith(expect.stringContaining('Skipping Codex source'));
  });

  it('handles missing Kilo DB gracefully', async () => {
    const statFn = vi.fn().mockImplementation((path) => {
      if (path.includes('kilo')) {
        return Promise.reject(new Error('no such file'));
      }
      return Promise.resolve();
    });
    const queryDb = vi.fn().mockResolvedValueOnce(mockCodexRows);
    const onInfo = vi.fn();
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
      onInfo,
    });
    expect(queryDb).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toBe('codex');
    expect(onInfo).toHaveBeenCalledWith(expect.stringContaining('Skipping Kilo source'));
  });

  it('returns empty results when both DBs are missing', async () => {
    const statFn = vi.fn().mockRejectedValue(new Error('no such file'));
    const queryDb = vi.fn();
    const onInfo = vi.fn();
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
      onInfo,
    });
    expect(queryDb).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(0);
    expect(onInfo).toHaveBeenCalledTimes(2);
    expect(onInfo).toHaveBeenCalledWith(expect.stringContaining('Kilo'));
    expect(onInfo).toHaveBeenCalledWith(expect.stringContaining('Codex'));
  });

  it('logs queryDb errors to stderr and continues with other sources', async () => {
    const stderr = { write: vi.fn() };
    const statFn = vi.fn().mockResolvedValue(undefined);
    const queryDb = vi
      .fn()
      .mockRejectedValueOnce(new Error('Kilo SQL error'))
      .mockResolvedValueOnce([
        {
          session_id: 'codex_id',
          title_source: 'Codex',
          directory: '/codex',
          updated: '2026-10-30 13:00:00',
          snippet: 'codex',
        },
      ]);
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
      stderr,
    });
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Kilo DB query failed'));
    expect(result.results).toHaveLength(1);
    expect(result.results[0].session_id).toBe('codex_id');
  });

  it('deduplicates session IDs across sources', async () => {
    const statFn = vi.fn().mockResolvedValue(undefined);
    const queryDb = vi
      .fn()
      .mockResolvedValueOnce([
        { session_id: 'shared_id', title: 'Kilo', directory: '/kilo', updated: '2026-10-30 12:00:00', snippet: 'kilo' },
      ])
      .mockResolvedValueOnce([
        {
          session_id: 'shared_id',
          title_source: 'Codex',
          summary: 'Codex',
          directory: '/codex',
          updated: '2026-10-30 13:00:00',
          snippet: 'codex',
        },
      ]);
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].session_id).toBe('shared_id');
    expect(result.results[0].title).toBe('Kilo');
  });

  it('sorts results by updated descending', async () => {
    const statFn = vi.fn().mockResolvedValue(undefined);
    const queryDb = vi.fn().mockResolvedValueOnce(mockKiloRows).mockResolvedValueOnce(mockCodexRows);
    const result = await searchAllSources(['test'], {
      queryDb,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      maxSessions: 50,
    });
    expect(result.results[0].session_id).toBe('codex_1');
    expect(result.results[1].session_id).toBe('kilo_1');
  });
});

describe('deduplicateSessions', () => {
  it('deduplicates by session_id and preserves first occurrence', () => {
    const results = deduplicateSessions(sampleDbRows);
    expect(results).toHaveLength(2);
    expect(results[0].session_id).toBe('ses_abc123');
    expect(results[1].session_id).toBe('ses_def456');
  });

  it('preserves the first matching snippet per session', () => {
    const results = deduplicateSessions(sampleDbRows);
    expect(results[0].snippet).toContain('Color Replacement tool');
  });

  it('caps at MAX_RESULT_SESSIONS', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      session_id: `ses_${i}`,
      title: `Session ${i}`,
      directory: '/test',
      updated: '2026-10-30',
      snippet: `Snippet ${i}`,
    }));
    expect(deduplicateSessions(rows)).toHaveLength(10);
  });

  it('skips rows without a session_id', () => {
    const rows = [
      { session_id: '', title: 'no id', snippet: 'x' },
      { session_id: 'ses_1', title: 'valid', snippet: 'y' },
      null,
      { session_id: 'ses_1', title: 'dup', snippet: 'z' },
    ];
    expect(deduplicateSessions(rows)).toHaveLength(1);
  });

  it('truncates snippets to MAX_SNIPPET_CHARS', () => {
    const long = 'x'.repeat(500);
    const row = { session_id: 'ses_1', title: 't', directory: 'd', updated: 'u', snippet: long };
    expect(deduplicateSessions([row])[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it('prefers title_source (user_message) over summary and title for Codex', () => {
    const rows = [
      {
        session_id: 'codex_1',
        title_source: 'How to use brushes',
        summary: '{"intent":"fix"}',
        title: 'Old Title',
        directory: '/d',
        updated: 'u',
        snippet: 'x',
      },
    ];
    const results = deduplicateSessions(rows, { source: 'codex' });
    expect(results[0].title).toBe('How to use brushes');
  });

  it('falls back to summary when title_source is empty', () => {
    const rows = [
      { session_id: 'codex_1', title_source: '', summary: 'Plain text summary', title: 'Old', snippet: 'x' },
    ];
    const results = deduplicateSessions(rows, { source: 'codex' });
    expect(results[0].title).toBe('Plain text summary');
  });

  it('falls back to title when title_source and summary are empty', () => {
    const rows = [{ session_id: 'ses_1', title_source: '', summary: '', title: 'Kilo Title', snippet: 'x' }];
    const results = deduplicateSessions(rows, { source: 'kilo' });
    expect(results[0].title).toBe('Kilo Title');
  });

  it('falls back to session_id prefix when all title fields are empty', () => {
    const rows = [{ session_id: 'ses_abcdef123456', title_source: '', summary: '', title: '', snippet: 'x' }];
    const results = deduplicateSessions(rows, { source: 'kilo' });
    expect(results[0].title).toBe('ses_abcd');
  });
});

describe('shapeSessions', () => {
  const full = [
    {
      session_id: 'ses_abc123',
      title: 'T',
      directory: '/d',
      source: 'kilo',
      updated: '2026-10-30',
      snippet: 'x'.repeat(300),
    },
  ];

  it('outputs concise shape by default (no directory/source/snippet_full)', () => {
    const shaped = shapeSessions(full);
    expect(shaped[0]).toEqual({ session_id: 'ses_abc123', title: 'T', updated: '2026-10-30', snippet: 'x'.repeat(90) });
    expect(shaped[0]).not.toHaveProperty('directory');
    expect(shaped[0]).not.toHaveProperty('source');
    expect(shaped[0]).not.toHaveProperty('snippet_full');
  });

  it('includes directory, source, snippet_full when verbose', () => {
    const verbose = shapeSessions(full, { verbose: true });
    expect(verbose[0].snippet).toHaveLength(90);
    expect(verbose[0].snippet_full).toHaveLength(300);
    expect(verbose[0].directory).toBe('/d');
    expect(verbose[0].source).toBe('kilo');
  });

  it('handles missing directory/source gracefully', () => {
    const minimal = [{ session_id: 'ses_1', title: 'T', directory: '', updated: 'u', snippet: 'hello' }];
    const shaped = shapeSessions(minimal, { verbose: true });
    expect(shaped[0].directory).toBe('');
    expect(shaped[0].source).toBe('kilo');
    expect(shaped[0].snippet_full).toBe('hello');
  });

  it('falls back to session_id prefix when title is missing', () => {
    const sessions = [{ session_id: 'ses_abcdef123456', title: '', directory: '/d', updated: 'u', snippet: 'hello' }];
    const shaped = shapeSessions(sessions, { verbose: true });
    expect(shaped[0].title).toBe('ses_abcd');
  });
});

describe('defaultTerms', () => {
  it('splits into tokens, removes stop words and short tokens', () => {
    const terms = defaultTerms('How do I use the brush tool and color replacement?');
    expect(terms).toContain('use');
    expect(terms).toContain('brush');
    expect(terms).toContain('color');
    expect(terms).toContain('replacement');
    expect(terms).not.toContain('how');
    expect(terms).not.toContain('do');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('and');
  });

  it('returns at most MAX_SEARCH_TERMS terms', () => {
    const terms = defaultTerms('one two three four five six seven eight');
    expect(terms).toHaveLength(5);
  });

  it('de-duplicates terms', () => {
    const terms = defaultTerms('brush brush brush tool');
    expect(terms).toEqual(['brush', 'tool']);
  });
});

describe('expandSearchTerms', () => {
  it('uses the free model result when it returns valid terms', async () => {
    const completeImpl = vi.fn().mockResolvedValue({ content: 'brush\ncolor replacement\nlevels' });
    const terms = await expandSearchTerms('How to use brush and color tools', { completeImpl });
    expect(terms).toEqual(['brush', 'color replacement', 'levels']);
  });

  it('caps extracted terms to MAX_SEARCH_TERMS', async () => {
    const completeImpl = vi.fn().mockResolvedValue({
      content: 'one\ntwo\nthree\nfour\nfive\nsix\nseven',
    });
    const terms = await expandSearchTerms('many terms query', { completeImpl });
    expect(terms).toHaveLength(5);
  });

  it('falls back to defaultTerms when the free model returns empty content', async () => {
    const completeImpl = vi.fn().mockResolvedValue({ content: '' });
    const terms = await expandSearchTerms('brush color tool', { completeImpl });
    expect(terms).toContain('brush');
    expect(terms).toContain('color');
  });

  it('falls back to defaultTerms when the free model throws', async () => {
    const completeImpl = vi.fn().mockRejectedValue(new Error('No free models available'));
    const terms = await expandSearchTerms('brush tool', { completeImpl });
    expect(terms).toEqual(['brush', 'tool']);
  });

  it('filters stop words from model output', async () => {
    const completeImpl = vi.fn().mockResolvedValue({ content: 'the\nand\nbrush' });
    const terms = await expandSearchTerms('query', { completeImpl });
    expect(terms).toEqual(['brush']);
  });

  it('passes a distinct onCatalogError callback (source, error) instead of reusing onError', async () => {
    const catalogError = new Error('rate limited');
    const completeImpl = vi.fn().mockImplementation((promptText, opts) => {
      opts.onCatalogError('openrouter', catalogError);
      return Promise.resolve({ content: 'brush\ncolor' });
    });
    const onCatalogError = vi.fn();
    const onError = vi.fn();
    const terms = await expandSearchTerms('brush color tool', { completeImpl, onCatalogError, onError });
    expect(onCatalogError).toHaveBeenCalledWith('openrouter', catalogError);
    expect(onError).not.toHaveBeenCalled();
    expect(terms).toEqual(['brush', 'color']);
  });

  it('routes thrown errors to onError (single-arg) and falls back to defaultTerms', async () => {
    const completeImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const onCatalogError = vi.fn();
    const onError = vi.fn();
    const terms = await expandSearchTerms('brush tool', { completeImpl, onCatalogError, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onCatalogError).not.toHaveBeenCalled();
    expect(terms).toEqual(['brush', 'tool']);
  });

  it('caps individual search-term length to MAX_SEARCH_TERM_CHARS', async () => {
    const longTerm = 'a'.repeat(300);
    const completeImpl = vi.fn().mockResolvedValue({ content: longTerm });
    const terms = await expandSearchTerms('query', { completeImpl });
    expect(terms).toEqual([longTerm.slice(0, 200)]);
    expect(terms[0].length).toBe(200);
  });
});

describe('queryKiloDb', () => {
  it('spawns sqlite3 in read-only mode with -json and -bail', async () => {
    const spawnImpl = vi.fn().mockReturnValue(mockSpawnChild({ stdout: JSON.stringify(sampleDbRows), code: 0 }));
    const result = await queryKiloDb('/fake/db.db', 'SELECT 1', { spawnImpl });
    expect(spawnImpl).toHaveBeenCalledWith(
      'sqlite3',
      ['-readonly', '-json', '-bail', '/fake/db.db', 'SELECT 1'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    );
    expect(result).toEqual(sampleDbRows);
  });

  it('returns an empty array when stdout is empty (no results)', async () => {
    const spawnImpl = vi.fn().mockReturnValue(mockSpawnChild({ stdout: '', code: 0 }));
    expect(await queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).toEqual([]);
  });

  it('returns an empty array when stdout is not valid JSON', async () => {
    const spawnImpl = vi.fn().mockReturnValue(mockSpawnChild({ stdout: 'not json', code: 0 }));
    expect(await queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).toEqual([]);
  });

  it('rejects when sqlite3 exits with a non-zero code', async () => {
    const spawnImpl = vi
      .fn()
      .mockReturnValue(mockSpawnChild({ stdout: '', stderr: 'no such table: session', code: 1 }));
    await expect(queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).rejects.toThrow(/exited with code 1/);
  });

  it('rejects with an ENOENT error message when sqlite3 is not installed', async () => {
    const error = new Error('spawn sqlite3 ENOENT');
    error.code = 'ENOENT';
    const spawnImpl = vi.fn().mockReturnValue(mockSpawnChild({ error }));
    await expect(queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).rejects.toThrow(/SQLite CLI not found/);
  });

  it('rejects other spawn errors', async () => {
    const spawnImpl = vi.fn().mockReturnValue(mockSpawnChild({ error: new Error('some spawn error') }));
    await expect(queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).rejects.toThrow('some spawn error');
  });

  it('times out and kills the child after the timeout', async () => {
    const child = new EventEmitter();
    child.kill = vi.fn();
    child.stdout = new EventEmitter();
    child.stdout.readable = true;
    child.stderr = new EventEmitter();
    child.stderr.readable = true;
    const spawnImpl = vi.fn().mockReturnValue(child);
    const promise = queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl, timeoutMs: 50 });
    await expect(promise).rejects.toThrow(/timed out/);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects when stdout exceeds the byte limit', async () => {
    const bigOutput = 'x'.repeat(3 * 1024 * 1024);
    const spawnImpl = vi.fn().mockReturnValue(
      mockSpawnChild({
        stdout: bigOutput,
        code: 0,
      })
    );
    await expect(queryKiloDb('/fake.db', 'SELECT 1', { spawnImpl })).rejects.toThrow(/output byte limit/);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects when sql is empty or not a string', async () => {
    const spawnImpl = vi.fn();
    await expect(queryKiloDb('/fake.db', '', { spawnImpl })).rejects.toThrow(/non-empty string/);
    await expect(queryKiloDb('/fake.db', null, { spawnImpl })).rejects.toThrow(/non-empty string/);
  });
});

describe('searchChatHistory', () => {
  it('queries the DB and deduplicates results', async () => {
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const results = await searchChatHistory('/fake.db', ['brush'], { queryDb });
    expect(queryDb).toHaveBeenCalledTimes(1);
    expect(queryDb.mock.calls[0][1]).toContain("lower('brush')");
    expect(results).toHaveLength(2);
  });

  it('returns an empty array for empty query results', async () => {
    const queryDb = vi.fn().mockResolvedValue([]);
    expect(await searchChatHistory('/fake.db', ['term'], { queryDb })).toEqual([]);
  });

  it('returns an empty array when terms is empty', async () => {
    const queryDb = vi.fn();
    expect(await searchChatHistory('/fake.db', [], { queryDb })).toEqual([]);
    expect(queryDb).not.toHaveBeenCalled();
  });
});

describe('summarizeSearchResults', () => {
  it('returns a no-results message when sessions is empty', async () => {
    const completeImpl = vi.fn();
    const result = await summarizeSearchResults('query', [], { completeImpl });
    expect(result).toBe('No matching chat history found.');
    expect(completeImpl).not.toHaveBeenCalled();
  });

  it('uses the free model summary when available', async () => {
    const completeImpl = vi.fn().mockResolvedValue({ content: '## Summary\nFound 2 sessions about brushes.' });
    const sessions = deduplicateSessions(sampleDbRows);
    const result = await summarizeSearchResults('brush tool', sessions, { completeImpl });
    expect(result).toBe('## Summary\nFound 2 sessions about brushes.');
    expect(completeImpl).toHaveBeenCalledWith(
      expect.stringContaining('brush tool'),
      expect.objectContaining({ maxTokens: 400 })
    );
  });

  it('falls back to fallbackSummary when the free model throws', async () => {
    const completeImpl = vi.fn().mockRejectedValue(new Error('model unavailable'));
    const sessions = deduplicateSessions(sampleDbRows);
    const result = await summarizeSearchResults('brush tool', sessions, { completeImpl, terms: ['brush'] });
    expect(result).toContain('Searched for: brush');
    expect(result).toContain('ses_abc1');
    expect(result).toContain('ses_def4');
  });

  it('truncates snippets in the fallback output', async () => {
    const completeImpl = vi.fn().mockRejectedValue(new Error('fail'));
    const longSession = [{ session_id: 'ses_x', title: 't', directory: 'd', updated: 'u', snippet: 'A'.repeat(500) }];
    const result = await summarizeSearchResults('query', longSession, { completeImpl, terms: ['q'] });
    expect(result).toContain('A'.repeat(120));
  });

  it('routes thrown errors to onError (single-arg) and falls back to fallbackSummary', async () => {
    const completeImpl = vi.fn().mockRejectedValue(new Error('model down'));
    const onCatalogError = vi.fn();
    const onError = vi.fn();
    const sessions = deduplicateSessions(sampleDbRows);
    const result = await summarizeSearchResults('brush tool', sessions, {
      completeImpl,
      onCatalogError,
      onError,
      terms: ['brush'],
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onCatalogError).not.toHaveBeenCalled();
    expect(result).toContain('Searched for: brush');
    expect(result).toContain('ses_abc1');
  });

  it('passes a distinct onCatalogError callback (source, error) and uses the model summary', async () => {
    const catalogError = new Error('catalog down');
    const completeImpl = vi.fn().mockImplementation((promptText, opts) => {
      opts.onCatalogError('openrouter', catalogError);
      return Promise.resolve({ content: '## Summary' });
    });
    const onCatalogError = vi.fn();
    const onError = vi.fn();
    const sessions = deduplicateSessions(sampleDbRows);
    const result = await summarizeSearchResults('brush tool', sessions, {
      completeImpl,
      onCatalogError,
      onError,
      terms: ['brush'],
    });
    expect(onCatalogError).toHaveBeenCalledWith('openrouter', catalogError);
    expect(onError).not.toHaveBeenCalled();
    expect(result).toBe('## Summary');
  });

  it('truncates the sessions JSON payload to MAX_RAW_RESULTS_JSON_CHARS when oversized', async () => {
    const completeImpl = vi.fn().mockResolvedValue({ content: 'summary' });
    const bigSessions = Array.from({ length: 50 }, (_, i) => ({
      session_id: `ses_${i}`,
      title: `Session ${i}`,
      directory: '/d',
      updated: '2026-10-30',
      snippet: 'x'.repeat(300),
    }));
    await summarizeSearchResults('query', bigSessions, { completeImpl });
    expect(completeImpl).toHaveBeenCalledTimes(1);
    const filled = completeImpl.mock.calls[0][0];
    const prefix = 'Results (JSON):\n';
    const idx = filled.indexOf(prefix);
    expect(idx).toBeGreaterThanOrEqual(0);
    const snippets = filled.slice(idx + prefix.length);
    expect(snippets.length).toBe(8000);
  });
});

describe('fallbackSummary', () => {
  it('formats sessions with IDs, dates, and snippets', () => {
    const sessions = [
      { session_id: 'ses_abc123def', title: 'Test', directory: '/d', updated: '2026-10-30', snippet: 'Hello world' },
    ];
    const result = fallbackSummary(sessions, ['hello']);
    expect(result).toContain('Searched for: hello');
    expect(result).toContain('ses_abc1');
    expect(result).toContain('2026-10-30');
    expect(result).toContain('Hello world');
  });
});

describe('parseArgs', () => {
  it('parses an inline prompt', () => {
    const result = parseArgs(['--prompt', 'brush tool color']);
    expect(result.rawPrompt).toBe('brush tool color');
    expect(result.noSummarize).toBe(false);
    expect(result.help).toBe(false);
  });

  it('parses a prompt file with output and summary options', () => {
    const result = parseArgs([
      '--prompt-file',
      '/tmp/prompt.txt',
      '--output-file',
      '/tmp/out.txt',
      '--max-summary-tokens',
      '200',
    ]);
    expect(result.promptFile).toBe('/tmp/prompt.txt');
    expect(result.outputFile).toBe('/tmp/out.txt');
    expect(result.maxSummaryTokens).toBe(200);
  });

  it('parses the no-summarize flag', () => {
    expect(parseArgs(['--prompt', 'q', '--no-summarize']).noSummarize).toBe(true);
  });

  it('parses --probe-openrouter-quota', () => {
    expect(parseArgs(['--prompt', 'q', '--probe-openrouter-quota']).probeOpenRouterQuota).toBe(true);
  });

  it('shows help for --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('errors when neither --prompt nor --prompt-file is given', () => {
    expect(parseArgs([]).error).toContain('must be specified');
  });

  it('errors when both --prompt and --prompt-file are given', () => {
    const result = parseArgs(['--prompt', 'q', '--prompt-file', '/tmp/p.txt']);
    expect(result.error).toContain('not both');
  });

  it('errors on unknown options', () => {
    expect(parseArgs(['--prompt', 'q', '--bogus']).error).toContain('Unknown option');
  });

  it('errors on out-of-range --max-sessions', () => {
    expect(parseArgs(['--prompt', 'q', '--max-sessions', '5']).error).toContain('must be an integer from 10 to');
    expect(parseArgs(['--prompt', 'q', '--max-sessions', '99999']).error).toContain('must be an integer from 10 to');
  });

  it('errors on out-of-range --max-summary-tokens', () => {
    expect(parseArgs(['--prompt', 'q', '--max-summary-tokens', '0']).error).toContain('must be an integer from 1 to');
    expect(parseArgs(['--prompt', 'q', '--max-summary-tokens', '9999']).error).toContain(
      'must be an integer from 1 to'
    );
  });

  it('errors on duplicate --output-file', () => {
    expect(parseArgs(['--prompt', 'q', '--output-file', '/a.txt', '--output-file', '/b.txt']).error).toContain(
      'only once'
    );
  });

  it('parses --verbose flag', () => {
    expect(parseArgs(['--prompt', 'q', '--verbose']).verbose).toBe(true);
  });

  it('parses -v shortcut', () => {
    expect(parseArgs(['--prompt', 'q', '-v']).verbose).toBe(true);
  });

  it('defaults verbose to false', () => {
    expect(parseArgs(['--prompt', 'q']).verbose).toBe(false);
  });

  it('parses --source with default all', () => {
    expect(parseArgs(['--prompt', 'q']).source).toBe('all');
  });

  it('parses --source kilo', () => {
    expect(parseArgs(['--prompt', 'q', '--source', 'kilo']).source).toBe('kilo');
  });

  it('errors on unsupported --source', () => {
    expect(parseArgs(['--prompt', 'q', '--source', 'copilot']).error).toContain('--source');
  });

  it('parses --source codex', () => {
    expect(parseArgs(['--prompt', 'q', '--source', 'codex']).source).toBe('codex');
  });

  it('errors on non-integer --max-sessions', () => {
    expect(parseArgs(['--prompt', 'q', '--max-sessions', 'abc']).error).toContain('must be an integer');
    expect(parseArgs(['--prompt', 'q', '--max-sessions', '3.5']).error).toContain('must be an integer');
  });

  it('errors on non-integer --max-summary-tokens', () => {
    expect(parseArgs(['--prompt', 'q', '--max-summary-tokens', 'abc']).error).toContain('must be an integer');
    expect(parseArgs(['--prompt', 'q', '--max-summary-tokens', '3.5']).error).toContain('must be an integer');
  });
});

describe('readPrompt', () => {
  function mockFileHandle(content) {
    const buf = Buffer.from(content);
    return {
      stat: vi.fn().mockResolvedValue({ isFile: () => true, size: buf.length }),
      read: vi.fn().mockImplementation(async (target, offset, length, position) => {
        const start = position ?? 0;
        const n = Math.min(buf.length - start, length);
        if (n <= 0) return { bytesRead: 0 };
        buf.copy(target, offset, start, start + n);
        return { bytesRead: n };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('reads an inline prompt directly', async () => {
    const result = await readPrompt({ rawPrompt: '  brush tool  ', promptFile: null });
    expect(result).toBe('brush tool');
  });

  it('rejects when the prompt file does not exist', async () => {
    const openFn = vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(readPrompt({ rawPrompt: null, promptFile: '/nonexistent/prompt.txt' }, { openFn })).rejects.toThrow(
      'ENOENT'
    );
  });

  it('rejects when the prompt path is a directory, not a regular file', async () => {
    const handle = {
      stat: vi.fn().mockResolvedValue({ isFile: () => false, size: 10 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const openFn = vi.fn().mockResolvedValue(handle);
    await expect(readPrompt({ rawPrompt: null, promptFile: '/tmp/dir' }, { openFn })).rejects.toThrow(
      'Prompt file must be a regular file'
    );
    expect(handle.close).toHaveBeenCalled();
  });

  it('rejects a prompt file larger than 4KB (4KB + 1 byte)', async () => {
    const handle = {
      stat: vi.fn().mockResolvedValue({ isFile: () => true, size: 4097 }),
      read: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const openFn = vi.fn().mockResolvedValue(handle);
    await expect(readPrompt({ rawPrompt: null, promptFile: '/tmp/big.txt' }, { openFn })).rejects.toThrow(
      'at most 4096 bytes'
    );
    expect(handle.close).toHaveBeenCalled();
  });

  it('rejects a prompt file containing invalid UTF-8', async () => {
    const openFn = vi.fn().mockResolvedValue(mockFileHandle(Buffer.from([0xff, 0xfe, 0x00])));
    await expect(readPrompt({ rawPrompt: null, promptFile: '/tmp/bad-utf8.txt' }, { openFn })).rejects.toThrow();
  });

  it('rejects a prompt file that is whitespace-only', async () => {
    const openFn = vi.fn().mockResolvedValue(mockFileHandle('   \n\t  '));
    await expect(readPrompt({ rawPrompt: null, promptFile: '/tmp/ws.txt' }, { openFn })).rejects.toThrow(
      'Search query is empty'
    );
  });
});

describe('CLI: --no-summarize returns raw JSON', async () => {
  it('writes raw deduplicated session JSON to the output file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'out.txt');
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const completeImpl = vi.fn();
    try {
      await writeFile(promptPath, 'brush color replacement');
      const code = await main(['--prompt-file', promptPath, '--output-file', outputPath, '--no-summarize'], {
        queryDb,
        completeImpl,
        statFn: vi.fn().mockResolvedValue(undefined),
        homeDir: '/home/user',
        platform: 'linux',
        stderr: { write: vi.fn() },
      });
      expect(code).toBe(0);
      expect(completeImpl).not.toHaveBeenCalled();
      const output = await import('node:fs/promises').then((m) => m.readFile(outputPath, 'utf8'));
      expect(output).toContain('ses_abc123');
      expect(output).toContain('ses_def456');
      expect(output).toContain('Photoshop tool creation');
      expect(output).toContain('"session_id"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI: full integration with mocked deps', async () => {
  it('expands terms, queries the DB, and summarizes via a free model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const completeImpl = vi.fn().mockImplementation((promptText) => {
      if (promptText.includes('Extract 1-5')) {
        return Promise.resolve({ content: 'brush\ncolor' });
      }
      if (promptText.includes('chat-history search assistant')) {
        return Promise.resolve({
          content: '## Summary\nFound 2 sessions: ses_abc123 (Photoshop) and ses_def456 (E2E).',
        });
      }
      return Promise.resolve({ content: '' });
    });
    try {
      await writeFile(promptPath, 'How do I use the brush and color tools?');
      const code = await main(['--prompt-file', promptPath, '--max-summary-tokens', '200'], {
        queryDb,
        completeImpl,
        statFn: vi.fn().mockResolvedValue(undefined),
        homeDir: '/home/user',
        platform: 'linux',
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(completeImpl).toHaveBeenCalledTimes(2);

      const expandCall = completeImpl.mock.calls[0][0];
      expect(expandCall).toContain('Extract 1-5');
      expect(expandCall).toContain('brush and color tools');

      const summarizeCall = completeImpl.mock.calls[1][0];
      expect(summarizeCall).toContain('chat-history search assistant');
      expect(summarizeCall).toContain('brush and color tools');

      const output = stdout.write.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('## Summary');
      expect(output).toContain('Found 2 sessions');
      expect(output).toContain('ses_abc123');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns exit code 4 when the DB query fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const queryDb = vi.fn().mockRejectedValue(new Error('database is locked'));
    const completeImpl = vi.fn();
    try {
      await writeFile(promptPath, 'test query');
      const code = await main(['--prompt-file', promptPath, '--source', 'kilo'], {
        queryDb,
        completeImpl,
        homeDir: '/home/user',
        platform: 'linux',
        stdout,
        stderr,
      });
      expect(code).toBe(4);
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('database is locked'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns exit code 2 for missing prompt', async () => {
    const stderr = { write: vi.fn() };
    const code = await main([], { stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('must be specified'));
  });

  it('reads inline --prompt directly', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const queryDb = vi.fn().mockResolvedValue([]);
    const completeImpl = vi.fn().mockResolvedValue({ content: 'No findings.' });
    const code = await main(['--prompt', 'worktree inventory'], {
      queryDb,
      completeImpl,
      statFn: vi.fn().mockResolvedValue(undefined),
      homeDir: '/home/user',
      platform: 'linux',
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('worktree inventory'));
    const output = stdout.write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('No matching chat history found.');
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Found 0 matching session'));
  });

  it('handles empty search query', async () => {
    const stderr = { write: vi.fn() };
    const code = await main(['--prompt', '   '], { stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith('Search query is empty\n');
  });
});

describe('CLI: --verbose --no-summarize includes directory, source, snippet_full', async () => {
  it('writes verbose JSON with extra keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'out.txt');
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const completeImpl = vi.fn();
    try {
      await writeFile(promptPath, 'brush color replacement');
      const code = await main(
        ['--prompt-file', promptPath, '--output-file', outputPath, '--no-summarize', '--verbose'],
        {
          queryDb,
          completeImpl,
          statFn: vi.fn().mockResolvedValue(undefined),
          homeDir: '/home/user',
          platform: 'linux',
          stderr: { write: vi.fn() },
        }
      );
      expect(code).toBe(0);
      expect(completeImpl).not.toHaveBeenCalled();
      const output = await import('node:fs/promises').then((m) => m.readFile(outputPath, 'utf8'));
      expect(output).toContain('"directory"');
      expect(output).toContain('"source"');
      expect(output).toContain('"snippet_full"');
      expect(output).toContain('"session_id"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI: default --no-summarize omits directory, source, snippet_full', async () => {
  it('writes concise JSON without extra keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'out.txt');
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const completeImpl = vi.fn();
    try {
      await writeFile(promptPath, 'brush color replacement');
      const code = await main(['--prompt-file', promptPath, '--output-file', outputPath, '--no-summarize'], {
        queryDb,
        completeImpl,
        statFn: vi.fn().mockResolvedValue(undefined),
        homeDir: '/home/user',
        platform: 'linux',
        stderr: { write: vi.fn() },
      });
      expect(code).toBe(0);
      expect(completeImpl).not.toHaveBeenCalled();
      const output = await import('node:fs/promises').then((m) => m.readFile(outputPath, 'utf8'));
      expect(output).not.toContain('"directory"');
      expect(output).not.toContain('"source"');
      expect(output).not.toContain('"snippet_full"');
      expect(output).toContain('"session_id"');
      expect(output).toContain('"snippet"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI: --output-file writes the free-model summary', async () => {
  it('writes the summarization result to the output file via writeFileFn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-search-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'out.txt');
    const queryDb = vi.fn().mockResolvedValue(sampleDbRows);
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const completeImpl = vi.fn().mockImplementation((promptText) => {
      if (promptText.includes('Extract 1-5')) {
        return Promise.resolve({ content: 'brush\ncolor' });
      }
      if (promptText.includes('chat-history search assistant')) {
        return Promise.resolve({ content: '## Summary\nFound 2 sessions about brushes.' });
      }
      return Promise.resolve({ content: '' });
    });
    try {
      await writeFile(promptPath, 'How do I use the brush and color tools?');
      const code = await main(['--prompt-file', promptPath, '--output-file', outputPath], {
        queryDb,
        completeImpl,
        writeFileFn,
        statFn: vi.fn().mockResolvedValue(undefined),
        homeDir: '/home/user',
        platform: 'linux',
        stderr: { write: vi.fn() },
      });
      expect(code).toBe(0);
      expect(writeFileFn).toHaveBeenCalledTimes(1);
      const [writtenPath, content, encoding] = writeFileFn.mock.calls[0];
      expect(writtenPath).toBe(outputPath);
      expect(encoding).toBe('utf8');
      expect(content).toContain('## Summary');
      expect(content).toContain('Found 2 sessions about brushes.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('CLI: --db-path bypasses DB discovery', async () => {
  it('uses the explicit dbPath with --source kilo without calling findExistingDbPath/stat', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const statFn = vi.fn();
    const queryDb = vi.fn().mockResolvedValue([]);
    const completeImpl = vi.fn().mockResolvedValue({ content: '' });
    const code = await main(['--prompt', 'worktree inventory', '--source', 'kilo', '--db-path', '/custom/custom.db'], {
      queryDb,
      completeImpl,
      statFn,
      homeDir: '/home/user',
      platform: 'linux',
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(statFn).not.toHaveBeenCalled();
    expect(queryDb).toHaveBeenCalledWith('/custom/custom.db', expect.any(String));
  });
});
