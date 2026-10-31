#!/usr/bin/env node
/**
 * Agent-friendly chat history search - simplified API for coding agents
 *
 * Usage (programmatic):
 *   import { search, searchAll, searchStream, summarizeResults } from './free-chat-search-agent.mjs';
 *   const results = await searchAll({ query: 'how to fix bug', limit: 20 });
 *   const summary = await summarizeResults('how to fix bug', results);
 *   const single = await search({ query: 'error', source: 'kilo' });
 *
 * Usage (CLI):
 *   node scripts/free-chat-search-agent.mjs "search query" [--json] [--limit N] [--source kilo|codex|all]
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { platform } from 'node:os';
import { completeWithFreeModel } from './free-model-pool.mjs';

// Constants - simplified and agent-friendly
const CHAT_STORE_KILO = 'kilo';
const CHAT_STORE_CODEX = 'codex';
const SEARCH_ALL = 'all';

const DEFAULTS = {
  maxResults: 20,
  maxSessions: 50,
  maxSnippetChars: 200,
  summaryTokens: 400,
  sqliteTimeoutMs: 15_000,
};

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'about',
  'as',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'my',
  'your',
  'our',
  'their',
  'how',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'will',
  'would',
  'should',
  'could',
]);

const VALID_SOURCES = new Set([SEARCH_ALL, CHAT_STORE_KILO, CHAT_STORE_CODEX]);

/**
 * Validate source value
 * @param {string} source
 * @returns {string}
 */
function validateSource(source) {
  if (!VALID_SOURCES.has(source)) {
    throw new Error(`Invalid source: "${source}". Must be one of: ${[...VALID_SOURCES].join(', ')}`);
  }
  return source;
}

// Types (as JSDoc for IDE support)
/**
 * @typedef {Object} SearchResult
 * @property {string} session_id
 * @property {string} title
 * @property {string} directory
 * @property {string} source - 'kilo' or 'codex'
 * @property {string} updated - ISO date string
 * @property {string} snippet
 * @property {string} [role] - message role (user/assistant)
 */

/**
 * @typedef {Object} SearchOptions
 * @property {string} query - Search query text
 * @property {number} [limit=20] - Max results to return
 * @property {number} [maxSessions=50] - Max sessions to search
 * @property {string} [source='all'] - 'kilo', 'codex', or 'all'
 * @property {string} [dbPath] - Override database path
 * @property {boolean} [includeSummary=false] - Include AI summary
 * @property {number} [summaryTokens=400] - Max tokens for summary
 */

/**
 * @typedef {Object} SearchResponse
 * @property {SearchResult[]} results
 * @property {string} [summary] - AI-generated summary (if requested)
 * @property {string[]} terms - Search terms used
 * @property {number} totalSearched - Total sessions searched
 */

/**
 * Extract search terms from query (simple, no LLM needed for basic use)
 * @param {string} query
 * @param {number} maxTerms
 * @returns {string[]}
 */
export function extractTerms(query, maxTerms = 5) {
  const tokens = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length >= 3 && !STOP_WORDS.has(t));

  const unique = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
    if (unique.length >= maxTerms) break;
  }
  return unique;
}

/**
 * Resolve Kilo database path
 * @param {Object} opts
 * @returns {string}
 */
export function resolveKiloDbPath(opts = {}) {
  if (opts.kiloDbPath) return opts.kiloDbPath;
  const home = opts.homeDir || process.env.HOME || process.env.USERPROFILE || '';
  const xdg = opts.xdgDataHome || process.env.XDG_DATA_HOME;
  if (xdg) return `${xdg}/kilo/kilo.db`;
  if (home) return `${home}/.local/share/kilo/kilo.db`;
  return '/tmp/kilo/kilo.db';
}

/**
 * Resolve Codex database path
 * @param {Object} opts
 * @returns {string}
 */
export function resolveCodexDbPath(opts = {}) {
  if (opts.codexDbPath) return opts.codexDbPath;
  const home = opts.homeDir || process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '/tmp/codex/session-store.db';
  const plat = opts.platform || platform();
  if (plat === 'darwin') {
    return `${home}/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db`;
  }
  return `${home}/.config/Code/User/globalStorage/github.copilot-chat/session-store.db`;
}

/**
 * Find existing database from candidates
 * @param {string[]} candidates
 * @returns {Promise<string>}
 */
async function findExistingDb(candidates) {
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0];
}

/**
 * Build SQL query for Kilo database - returns parameterized query for better-sqlite3
 * @param {string[]} terms
 * @param {Object} opts
 * @returns {{sql: string, params: string[]}|null}
 */
export function buildKiloQuery(terms, opts = {}) {
  const validTerms = terms.filter((t) => t && t.trim());
  if (!validTerms.length) return null;

  const conditions = validTerms
    .map(() => `instr(lower(coalesce(json_extract(p.data, '$.text'), '')), lower(?)) > 0`)
    .join(' OR ');

  const limit = Math.min(opts.limit || DEFAULTS.maxResults, 200);
  const sessionLimit = Math.min(opts.maxSessions || DEFAULTS.maxSessions, 500);

  const sql = `
WITH recent AS (
  SELECT id FROM session ORDER BY time_updated DESC LIMIT ${sessionLimit}
)
SELECT
  s.id AS session_id,
  s.title,
  s.directory,
  datetime(s.time_updated / 1000, 'unixepoch') AS updated,
  json_extract(m.data, '$.role') AS role,
  substr(coalesce(json_extract(p.data, '$.text'), ''), 1, ${opts.maxSnippetChars || DEFAULTS.maxSnippetChars}) AS snippet
FROM recent r
JOIN session AS s ON s.id = r.id
JOIN message AS m ON m.session_id = s.id
JOIN part AS p ON p.message_id = m.id
WHERE json_valid(p.data)
  AND json_extract(p.data, '$.type') = 'text'
  AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
  AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0
  AND (${conditions})
ORDER BY s.time_updated DESC, m.time_created, p.time_created
LIMIT ${limit};
`.trim();

  return { sql, params: validTerms };
}

/**
 * Build SQL query for Codex database - returns parameterized query for better-sqlite3
 * @param {string[]} terms
 * @param {Object} opts
 * @returns {{sql: string, params: string[]}|null}
 */
export function buildCodexQuery(terms, opts = {}) {
  const validTerms = terms.filter((t) => t && t.trim());
  if (!validTerms.length) return null;

  const conditions = validTerms
    .map(() => `instr(lower(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, '')), lower(?)) > 0`)
    .join(' OR ');

  const limit = Math.min(opts.limit || DEFAULTS.maxResults, 200);
  const sessionLimit = Math.min(opts.maxSessions || DEFAULTS.maxSessions, 500);

  const sql = `
WITH recent AS (
  SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ${sessionLimit}
)
SELECT
  s.id AS session_id,
  s.summary AS title,
  s.cwd AS directory,
  datetime(s.updated_at / 1000, 'unixepoch') AS updated,
  t.turn_index,
  substr(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, ''), 1, ${opts.maxSnippetChars || DEFAULTS.maxSnippetChars}) AS snippet
FROM recent r
JOIN sessions AS s ON s.id = r.id
JOIN turns AS t ON t.session_id = s.id
WHERE (${conditions})
ORDER BY s.updated_at DESC, t.turn_index
LIMIT ${limit};
`.trim();

  return { sql, params: validTerms };
}

/**
 * Deduplicate sessions by session_id
 * @param {Object[]} rows
 * @param {string} source
 * @param {number} maxResults
 * @returns {SearchResult[]}
 */
export function deduplicateSessions(rows, source, maxResults = DEFAULTS.maxResults) {
  const seen = new Set();
  const results = [];
  for (const row of rows) {
    const key = row?.session_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({
      session_id: key,
      title: row.title || '',
      directory: row.directory || '',
      source,
      updated: row.updated || '',
      snippet: (row.snippet || '').slice(0, DEFAULTS.maxSnippetChars),
      role: row.role || undefined,
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

/**
 * Query SQLite database - tries better-sqlite3 first (with parameterized queries), falls back to CLI
 * @param {string} dbPath
 * @param {string} sql
 * @param {string[]} [params] - Parameters for parameterized query
 * @param {Object} opts
 * @returns {Promise<Object[]>}
 */
export async function queryDb(dbPath, sql, params = [], opts = {}) {
  // Try native better-sqlite3 first with parameterized queries
  if (opts.useNative !== false) {
    try {
      const Database = await import('better-sqlite3').catch(() => null);
      if (Database) {
        const db = new Database.default(dbPath, { readonly: true });
        try {
          const stmt = db.prepare(sql);
          return params.length > 0 ? stmt.all(...params) : stmt.all();
        } finally {
          db.close();
        }
      }
    } catch (err) {
      // Fall through to CLI - log for debugging if needed
      if (opts.debug) console.error('[queryDb] better-sqlite3 failed:', err.message);
    }
  }

  // Fallback to sqlite3 CLI - need to inline parameters for CLI
  // Use a proper parameter substitution that respects SQL string literals
  let cliSql = sql;
  if (params.length > 0) {
    let paramIndex = 0;
    let inString = false;
    let stringChar = '';
    const result = [];
    
    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      const nextChar = sql[i + 1];
      
      if (!inString && (char === '"' || char === "'")) {
        inString = true;
        stringChar = char;
        result.push(char);
      } else if (inString && char === stringChar && nextChar === stringChar) {
        // Escaped quote inside string
        result.push(char, char);
        i++; // Skip next char
      } else if (inString && char === stringChar) {
        inString = false;
        stringChar = '';
        result.push(char);
      } else if (!inString && char === '?') {
        // Replace placeholder with escaped parameter
        const escaped = params[paramIndex++].replace(/'/g, "''");
        result.push(`'${escaped}'`);
      } else {
        result.push(char);
      }
    }
    
    cliSql = result.join('');
  }
  
  const sqlitePath = opts.sqlitePath || 'sqlite3';
  const timeoutMs = opts.timeoutMs || DEFAULTS.sqliteTimeoutMs;

  return new Promise((resolve, reject) => {
    const child = spawn(sqlitePath, ['-readonly', '-json', '-bail', dbPath, cliSql], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      reject(new Error(`sqlite3 query timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 2 * 1024 * 1024) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        reject(new Error('SQLite response exceeded output byte limit'));
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4096) stderr = stderr.slice(0, 4096);
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new Error(`SQLite CLI not found at "${sqlitePath}"; install sqlite3 or better-sqlite3`));
      } else {
        reject(error);
      }
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`sqlite3 exited with code ${code ?? signal}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Search a single database
 * @param {string} dbPath
 * @param {string[]} terms
 * @param {Object} opts
 * @returns {Promise<SearchResult[]>}
 */
export async function searchDatabase(dbPath, terms, opts = {}) {
  const isCodex = opts.source === CHAT_STORE_CODEX;
  const query = isCodex ? buildCodexQuery(terms, opts) : buildKiloQuery(terms, opts);

  if (!query) return [];

  const rows = await queryDb(dbPath, query.sql, query.params, opts);
  return deduplicateSessions(rows, opts.source || CHAT_STORE_KILO, opts.limit);
}

/**
 * Validate and clamp options
 * @param {Object} options
 * @returns {Object}
 */
function validateOptions(options) {
  const source = options.source ? validateSource(options.source) : SEARCH_ALL;
  return {
    ...options,
    source,
    limit: Math.min(Math.max(options.limit || DEFAULTS.maxResults, 1), 200),
    maxSessions: Math.min(Math.max(options.maxSessions || DEFAULTS.maxSessions, 10), 500),
    summaryTokens: Math.min(Math.max(options.summaryTokens || DEFAULTS.summaryTokens, 1), 800),
  };
}

/**
 * Search all available sources
 * @param {Object} options
 * @returns {Promise<SearchResponse>}
 */
export async function searchAll(options = {}) {
  const opts = validateOptions(options);
  const query = opts.query || '';
  const terms = opts.terms || extractTerms(query);
  const source = validateSource(opts.source || SEARCH_ALL);
  const limit = opts.limit;
  const maxSessions = opts.maxSessions;

  const allResults = [];
  const dbPaths = [];

  // Search Kilo
  if (source === SEARCH_ALL || source === CHAT_STORE_KILO) {
    try {
      const kiloDbPath = opts.kiloDbPath || resolveKiloDbPath({ homeDir: opts.homeDir });
      const existingPath = await findExistingDb([kiloDbPath, ...resolveKiloDbCandidates({ homeDir: opts.homeDir })]);
      dbPaths.push({ source: CHAT_STORE_KILO, path: existingPath });

      const results = await searchDatabase(existingPath, terms, {
        source: CHAT_STORE_KILO,
        limit,
        maxSessions,
        useNative: opts.useNative,
      });
      allResults.push(...results);
    } catch (e) {
      // Ignore Kilo DB errors - continue with other sources
    }
  }

  // Search Codex
  if (source === SEARCH_ALL || source === CHAT_STORE_CODEX) {
    try {
      const codexDbPath = opts.codexDbPath || resolveCodexDbPath({ homeDir: opts.homeDir });
      const existingPath = await findExistingDb([codexDbPath, ...resolveCodexDbCandidates({ homeDir: opts.homeDir })]);
      dbPaths.push({ source: CHAT_STORE_CODEX, path: existingPath });

      const results = await searchDatabase(existingPath, terms, {
        source: CHAT_STORE_CODEX,
        limit,
        maxSessions,
        useNative: opts.useNative,
      });
      allResults.push(...results);
    } catch (e) {
      // Ignore Codex DB errors - continue with other sources
    }
  }

  // Sort by updated date descending
  allResults.sort((a, b) => b.updated.localeCompare(a.updated));

  const finalResults = allResults.slice(0, limit);

  const response = {
    results: finalResults,
    terms,
    totalSearched: allResults.length,
    dbPaths,
  };

  // Add summary if requested
  if (opts.includeSummary && finalResults.length > 0) {
    response.summary = await summarizeResults(query, finalResults, {
      maxTokens: opts.summaryTokens,
    });
  }

  return response;
}

/**
 * Search a specific source
 * @param {Object} options
 * @returns {Promise<SearchResponse>}
 */
export async function search(options = {}) {
  const opts = validateOptions(options);
  const query = opts.query || '';
  const terms = opts.terms || extractTerms(query);
  const source = validateSource(opts.source || SEARCH_ALL);

  if (source === SEARCH_ALL) {
    return searchAll(opts);
  }

  const dbPath =
    source === CHAT_STORE_CODEX
      ? opts.codexDbPath || resolveCodexDbPath({ homeDir: opts.homeDir })
      : opts.kiloDbPath || resolveKiloDbPath({ homeDir: opts.homeDir });

  const existingPath = await findExistingDb([dbPath]);
  const results = await searchDatabase(existingPath, terms, {
    source,
    limit: opts.limit,
    maxSessions: opts.maxSessions,
    useNative: opts.useNative,
  });

  const response = {
    results,
    terms,
    totalSearched: results.length,
    dbPaths: [{ source, path: existingPath }],
  };

  if (opts.includeSummary && results.length > 0) {
    response.summary = await summarizeResults(query, results, {
      maxTokens: opts.summaryTokens,
    });
  }

  return response;
}

/**
 * Generate AI summary of search results
 * @param {string} query
 * @param {SearchResult[]} results
 * @param {Object} opts
 * @returns {Promise<string>}
 */
export async function summarizeResults(query, results, opts = {}) {
  const maxTokens = opts.maxTokens || DEFAULTS.summaryTokens;
  const searchTerms = extractTerms(query);

  const json = JSON.stringify(
    results.map((r) => ({
      session_id: r.session_id,
      title: r.title,
      updated: r.updated,
      snippet: r.snippet,
      source: r.source,
    })),
    null,
    2
  );

  const snippets = json.length > 8000 ? json.slice(0, 8000) : json;

  const prompt = `You are a chat-history search assistant. The user searched their conversation history.
Below are matching snippets from past chats (JSON array). Provide a concise summary
of what was found. For each relevant result, cite the session ID (first 8 chars),
approximate date, and role. Group by session. Do not fabricate or invent citations.
If results are insufficient, say so.

Search query: ${query.slice(0, 2000)}

Results (JSON):
${snippets}`;

  try {
    const result = await completeWithFreeModel(prompt, { maxTokens });
    return (result.content || '').trim();
  } catch (error) {
    // Fallback summary
    const lines = [`Searched for: ${searchTerms.join(', ')}`, `Found ${results.length} matching session(s):`, ''];
    for (const r of results) {
      lines.push(
        `  - ${r.session_id.slice(0, 8)} (${r.updated}) [${r.source}] ${r.title}\n    ${r.snippet.slice(0, 120)}`
      );
    }
    return lines.join('\n');
  }
}

/**
 * Simple async iterator for large result sets
 * @param {Object} options
 * @returns {AsyncIterable<SearchResult>}
 */
export async function* searchStream(options = {}) {
  const response = await searchAll(options);
  for (const result of response.results) {
    yield result;
  }
}

/**
 * CLI entry point - simplified
 */
export async function main(args = process.argv.slice(2)) {
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    console.log(`
Usage: node scripts/free-chat-search-agent.mjs "query" [options]

Options:
  --json              Output raw JSON (default: human-readable)
  --limit N           Max results (default: 20, max: 200)
  --max-sessions N    Max sessions to search (default: 50, max: 500)
  --source NAME       Source: kilo, codex, or all (default: all)
  --summary           Include AI summary
  --summary-tokens N  Max tokens for summary (default: 400, max: 800)
  --no-native         Force sqlite3 CLI instead of better-sqlite3
  --help, -h          Show this help

Examples:
  node scripts/free-chat-search-agent.mjs "how to fix bug"
  node scripts/free-chat-search-agent.mjs "react hooks" --json --limit 10
  node scripts/free-chat-search-agent.mjs "typescript error" --source kilo --summary
`);
    return 0;
  }

  // Parse args - query is everything before first flag
  let query = '';
  const flagIndices = args.findIndex((a) => a.startsWith('--'));
  if (flagIndices >= 0) {
    query = args.slice(0, flagIndices).join(' ');
  } else {
    query = args.join(' ');
  }
  query = query.trim();

  if (!query) {
    console.error('Error: Query required. Use --help for usage.');
    return 1;
  }

  const getFlag = (flag, def) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : def;
  };

  const hasFlag = (flag) => args.includes(flag);

  const source = getFlag('--source', 'all');
  if (!VALID_SOURCES.has(source)) {
    console.error(`Error: Invalid --source "${source}". Must be one of: ${[...VALID_SOURCES].join(', ')}`);
    return 1;
  }

  const limit = parseInt(getFlag('--limit', '20'), 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    console.error('Error: --limit must be an integer between 1 and 200');
    return 1;
  }

  const maxSessions = parseInt(getFlag('--max-sessions', '50'), 10);
  if (!Number.isInteger(maxSessions) || maxSessions < 10 || maxSessions > 500) {
    console.error('Error: --max-sessions must be an integer between 10 and 500');
    return 1;
  }

  const summaryTokens = parseInt(getFlag('--summary-tokens', '400'), 10);
  if (!Number.isInteger(summaryTokens) || summaryTokens < 1 || summaryTokens > 800) {
    console.error('Error: --summary-tokens must be an integer between 1 and 800');
    return 1;
  }

  const options = {
    query,
    limit,
    maxSessions,
    source,
    includeSummary: hasFlag('--summary'),
    summaryTokens,
    useNative: !hasFlag('--no-native'),
    outputJson: hasFlag('--json'),
  };

  try {
    const response = await searchAll(options);

    if (options.outputJson) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      // Human-readable output
      if (response.results.length === 0) {
        console.log('No results found.');
        return 0;
      }

      console.log(`Found ${response.results.length} result(s) for: "${query}"\n`);

      for (const r of response.results) {
        console.log(`  ${r.session_id.slice(0, 8)} | ${r.updated} | [${r.source}] ${r.title}`);
        console.log(`    ${r.snippet}`);
        console.log('');
      }

      if (response.summary) {
        console.log('--- Summary ---');
        console.log(response.summary);
      }
    }

    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

/**
 * Helper to get Kilo DB candidates
 */
function resolveKiloDbCandidates(opts = {}) {
  const home = opts.homeDir || process.env.HOME || process.env.USERPROFILE || '';
  const xdg = opts.xdgDataHome || process.env.XDG_DATA_HOME;
  const candidates = [];
  if (xdg) candidates.push(`${xdg}/kilo/kilo.db`);
  if (home) {
    candidates.push(`${home}/.local/share/kilo/kilo.db`);
    const plat = opts.platform || platform();
    if (plat === 'darwin') {
      candidates.push(`${home}/Library/Application Support/kilo/kilo.db`);
    }
  }
  if (candidates.length === 0) candidates.push('/tmp/kilo/kilo.db');
  return candidates;
}

/**
 * Helper to get Codex DB candidates
 */
function resolveCodexDbCandidates(opts = {}) {
  const home = opts.homeDir || process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [];
  if (home) {
    const plat = opts.platform || platform();
    if (plat === 'darwin') {
      candidates.push(
        `${home}/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db`
      );
    } else {
      candidates.push(`${home}/.config/Code/User/globalStorage/github.copilot-chat/session-store.db`);
    }
    candidates.push(`${home}/.vscode-server/data/User/globalStorage/github.copilot-chat/session-store.db`);
  }
  if (candidates.length === 0) candidates.push('/tmp/codex/session-store.db');
  return candidates;
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
