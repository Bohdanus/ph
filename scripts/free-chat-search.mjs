#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { open, stat, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { completeWithFreeModel } from './free-model-pool.mjs';

const MAX_PROMPT_CHARS = 2000;
const MAX_PROMPT_FILE_BYTES = 4 * 1024;
const MAX_SEARCH_TERMS = 5;
const MAX_RESULT_SESSIONS = 10;
const MAX_MATCHES_PER_QUERY = 200;
const DEFAULT_SEARCH_SESSIONS = 50;
const MAX_SEARCH_SESSIONS = 500;
const MIN_SEARCH_SESSIONS = 10;
const MAX_SNIPPET_CHARS = 300;
const DEFAULT_SNIPPET_CHARS = 90;
const CHAT_STORE_KILO = 'kilo';
const CHAT_STORE_CODEX = 'codex';
const SEARCH_ALL = 'all';
const SUPPORTED_SEARCH_SOURCES = new Set([SEARCH_ALL, CHAT_STORE_KILO, CHAT_STORE_CODEX]);
const MAX_SUMMARY_TOKENS = 800;
const DEFAULT_SUMMARY_TOKENS = 400;
const SQLITE_TIMEOUT_MS = 15_000;
const MAX_SQLITE_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RAW_RESULTS_JSON_CHARS = 8_000;

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

const EXPAND_TERMS_PROMPT =
  'Extract 1-5 concise search terms or key phrases from the query below.\n' +
  'Return ONLY the terms, one per line, with no numbering, quotes, brackets, or punctuation.\n' +
  'Skip common stop words. Prioritize nouns, tool names, file names, and specific identifiers.\n\n' +
  'Query: {PROMPT}';

const SUMMARIZE_PROMPT =
  'You are a chat-history search assistant. The user searched their conversation history.\n' +
  'Below are matching snippets from past chats (JSON array). Provide a concise summary\n' +
  'of what was found. For each relevant result, cite the session ID (first 8 chars),\n' +
  'approximate date, and role. Group by session. Do not fabricate or invent citations.\n' +
  'If results are insufficient, say so.\n\n' +
  'Search query: {PROMPT}\n\n' +
  'Results (JSON):\n' +
  '{SNIPPETS}';

function escapeSqlValue(value) {
  return String(value).replace(/'/g, "''");
}

export function resolveKiloDbPath({ kiloDbPath, homeDir, xdgDataHome, platform: plat } = {}) {
  if (kiloDbPath) return kiloDbPath;
  const home = (homeDir ?? process.env.HOME) || process.env.USERPROFILE || '';
  const xdg = xdgDataHome ?? process.env.XDG_DATA_HOME;
  if (xdg) return `${xdg}/kilo/kilo.db`;
  if (home) return `${home}/.local/share/kilo/kilo.db`;
  return '/tmp/kilo/kilo.db';
}

export function resolveKiloDbCandidates({ kiloDbPath, homeDir, xdgDataHome, platform: plat } = {}) {
  if (kiloDbPath) return [kiloDbPath];
  const home = (homeDir ?? process.env.HOME) || process.env.USERPROFILE || '';
  const xdg = xdgDataHome ?? process.env.XDG_DATA_HOME;
  const candidates = [];
  if (xdg) candidates.push(`${xdg}/kilo/kilo.db`);
  if (home) {
    candidates.push(`${home}/.local/share/kilo/kilo.db`);
    if (plat === 'darwin') {
      candidates.push(`${home}/Library/Application Support/kilo/kilo.db`);
    }
  }
  if (candidates.length === 0) candidates.push('/tmp/kilo/kilo.db');
  return candidates;
}

export async function findExistingDbPath(options = {}, { statFn = stat } = {}) {
  if (options.kiloDbPath) return options.kiloDbPath;
  const candidates = resolveKiloDbCandidates(options);
  for (const candidate of candidates) {
    try {
      await statFn(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0];
}

export function resolveCodexDbPath({ codexDbPath, homeDir, platform: plat } = {}) {
  if (codexDbPath) return codexDbPath;
  const home = (homeDir ?? process.env.HOME) || process.env.USERPROFILE || '';
  if (!home) return '/tmp/codex/session-store.db';
  if (plat === 'darwin') {
    return `${home}/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db`;
  }
  return `${home}/.config/Code/User/globalStorage/github.copilot-chat/session-store.db`;
}

export function resolveCodexDbCandidates({ codexDbPath, homeDir, platform: plat } = {}) {
  if (codexDbPath) return [codexDbPath];
  const home = (homeDir ?? process.env.HOME) || process.env.USERPROFILE || '';
  const candidates = [];
  if (home) {
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

export async function findExistingCodexDbPath(options = {}, { statFn = stat } = {}) {
  if (options.codexDbPath) return options.codexDbPath;
  const candidates = resolveCodexDbCandidates(options);
  for (const candidate of candidates) {
    try {
      await statFn(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0];
}

export function buildSearchQuery(
  terms,
  { maxMatches = MAX_MATCHES_PER_QUERY, maxSessions = DEFAULT_SEARCH_SESSIONS } = {}
) {
  const validTerms = (Array.isArray(terms) ? terms : []).filter((t) => t && t.trim());
  if (validTerms.length === 0) return null;
  const conditions = validTerms
    .map((term) => {
      const escaped = escapeSqlValue(term.trim());
      return `instr(lower(coalesce(json_extract(p.data, '$.text'), '')), lower('${escaped}')) > 0`;
    })
    .filter((condition) => condition.length > 0)
    .join(' OR ');
  if (!conditions) return null;
  const limit = Math.min(Math.max(1, maxMatches), MAX_MATCHES_PER_QUERY);
  const sessionLimit = Math.min(Math.max(MIN_SEARCH_SESSIONS, maxSessions), MAX_SEARCH_SESSIONS);
  return `
WITH recent AS (
  SELECT id FROM session ORDER BY time_updated DESC LIMIT ${sessionLimit}
)
SELECT
  s.id AS session_id,
  s.title,
  s.directory,
  datetime(s.time_updated / 1000, 'unixepoch') AS updated,
  json_extract(m.data, '$.role') AS role,
  substr(coalesce(json_extract(p.data, '$.text'), ''), 1, ${MAX_SNIPPET_CHARS}) AS snippet
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
}

export function buildCodexSearchQuery(
  terms,
  { maxMatches = MAX_MATCHES_PER_QUERY, maxSessions = DEFAULT_SEARCH_SESSIONS } = {}
) {
  const validTerms = (Array.isArray(terms) ? terms : []).filter((t) => t && t.trim());
  if (validTerms.length === 0) return null;
  const conditions = validTerms
    .map((term) => {
      const escaped = escapeSqlValue(term.trim());
      return `instr(lower(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, '')), lower('${escaped}')) > 0`;
    })
    .filter((condition) => condition.length > 0)
    .join(' OR ');
  if (!conditions) return null;
  const limit = Math.min(Math.max(1, maxMatches), MAX_MATCHES_PER_QUERY);
  const sessionLimit = Math.min(Math.max(MIN_SEARCH_SESSIONS, maxSessions), MAX_SEARCH_SESSIONS);
  return `
WITH recent AS (
  SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ${sessionLimit}
)
SELECT
  s.id AS session_id,
  s.summary AS title,
  s.cwd AS directory,
  datetime(s.updated_at / 1000, 'unixepoch') AS updated,
  t.turn_index,
  substr(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, ''), 1, ${MAX_SNIPPET_CHARS}) AS snippet
FROM recent r
JOIN sessions AS s ON s.id = r.id
JOIN turns AS t ON t.session_id = s.id
WHERE (${conditions})
ORDER BY s.updated_at DESC, t.turn_index
LIMIT ${limit};
  `.trim();
}

export function deduplicateSessions(rows, { source = CHAT_STORE_KILO } = {}) {
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
      snippet: (row.snippet || '').slice(0, MAX_SNIPPET_CHARS),
    });
    if (results.length >= MAX_RESULT_SESSIONS) break;
  }
  return results;
}

export function shapeSessions(sessions, { verbose = false } = {}) {
  return sessions.map((session) => {
    const fullSnippet = session.snippet || '';
    const shaped = {
      session_id: session.session_id,
      title: session.title,
      updated: session.updated,
      snippet: fullSnippet.slice(0, DEFAULT_SNIPPET_CHARS),
    };
    if (verbose) {
      shaped.directory = session.directory;
      shaped.source = session.source ?? CHAT_STORE_KILO;
      shaped.snippet_full = fullSnippet.slice(0, MAX_SNIPPET_CHARS);
    }
    return shaped;
  });
}

export function defaultTerms(prompt) {
  const tokens = prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length >= 3 && !STOP_WORDS.has(token));
  const unique = [];
  for (const token of tokens) {
    if (!unique.includes(token)) unique.push(token);
    if (unique.length >= MAX_SEARCH_TERMS) break;
  }
  return unique;
}

export async function expandSearchTerms(
  prompt,
  { completeImpl = completeWithFreeModel, maxTokens = 200, onError, ...completeOpts } = {}
) {
  const filled = EXPAND_TERMS_PROMPT.replace('{PROMPT}', prompt.slice(0, MAX_PROMPT_CHARS));
  try {
    const result = await completeImpl(filled, { maxTokens, onCatalogError: onError, ...completeOpts });
    const terms = (result.content || '')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .map((term) => term.replace(/[^\w\s-]/g, '').trim())
      .filter((term) => term && term.length >= 2 && !STOP_WORDS.has(term));
    if (terms.length > 0) return terms.slice(0, MAX_SEARCH_TERMS);
  } catch (error) {
    if (onError) onError(error);
  }
  return defaultTerms(prompt);
}

function safeUnref(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
}

export async function queryKiloDb(
  dbPath,
  sql,
  { spawnImpl = spawn, sqlitePath = 'sqlite3', timeoutMs = SQLITE_TIMEOUT_MS } = {}
) {
  if (!sql || typeof sql !== 'string') throw new Error('SQL query must be a non-empty string');
  return new Promise((resolveP, rejectP) => {
    const child = spawnImpl(sqlitePath, ['-readonly', '-json', '-bail', dbPath, sql], {
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
      safeUnref(setTimeout(() => child.kill('SIGKILL'), 2000));
      rejectP(new Error(`sqlite3 query timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_SQLITE_OUTPUT_BYTES) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGTERM');
        safeUnref(setTimeout(() => child.kill('SIGKILL'), 2000));
        rejectP(new Error('SQLite response exceeded the output byte limit'));
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
        rejectP(new Error(`SQLite CLI not found at "${sqlitePath}"; install sqlite3 and ensure it is on PATH`));
      } else {
        rejectP(error);
      }
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        rejectP(new Error(`sqlite3 exited with code ${code ?? signal}${stderr ? `: ${stderr.slice(0, 500)}` : ''}`));
        return;
      }
      try {
        resolveP(JSON.parse(stdout));
      } catch {
        resolveP([]);
      }
    });
  });
}

export async function searchChatHistory(
  dbPath,
  terms,
  {
    queryDb = queryKiloDb,
    maxMatches = MAX_MATCHES_PER_QUERY,
    maxSessions = DEFAULT_SEARCH_SESSIONS,
    source = CHAT_STORE_KILO,
  } = {}
) {
  const sql =
    source === CHAT_STORE_CODEX
      ? buildCodexSearchQuery(terms, { maxMatches, maxSessions })
      : buildSearchQuery(terms, { maxMatches, maxSessions });
  if (!sql) return [];
  const rows = await queryDb(dbPath, sql);
  return deduplicateSessions(rows, { source });
}

export async function searchAllSources(
  terms,
  { queryDb = queryKiloDb, maxMatches = MAX_MATCHES_PER_QUERY, maxSessions = DEFAULT_SEARCH_SESSIONS } = {}
) {
  const allResults = [];
  // Search Kilo DB
  try {
    const kiloDbPath = await findExistingDbPath({});
    const sql = buildSearchQuery(terms, { maxMatches, maxSessions });
    if (sql) {
      const rows = await queryDb(kiloDbPath, sql);
      allResults.push(...deduplicateSessions(rows, { source: CHAT_STORE_KILO }));
    }
  } catch (error) {
    // Log but continue with other sources
  }
  // Search Codex DB
  try {
    const codexDbPath = await findExistingCodexDbPath({});
    const sql = buildCodexSearchQuery(terms, { maxMatches, maxSessions });
    if (sql) {
      const rows = await queryDb(codexDbPath, sql);
      allResults.push(...deduplicateSessions(rows, { source: CHAT_STORE_CODEX }));
    }
  } catch (error) {
    // Log but continue with other sources
  }
  allResults.sort((a, b) => b.updated.localeCompare(a.updated));
  return allResults.slice(0, MAX_RESULT_SESSIONS);
}

export function fallbackSummary(sessions, terms) {
  const lines = [`Searched for: ${terms.join(', ')}`, `Found ${sessions.length} matching session(s):`, ''];
  for (const s of sessions) {
    lines.push(`  - ${s.session_id.slice(0, 8)} (${s.updated}) ${s.title}\n    ${s.snippet.slice(0, 120)}`);
  }
  return lines.join('\n');
}

export async function summarizeSearchResults(
  prompt,
  sessions,
  { completeImpl = completeWithFreeModel, maxTokens = DEFAULT_SUMMARY_TOKENS, onError, terms, ...completeOpts } = {}
) {
  if (!sessions.length) return 'No matching chat history found.';
  const json = JSON.stringify(
    sessions.map((session) => ({
      session_id: session.session_id,
      title: session.title,
      updated: session.updated,
      snippet: (session.snippet || '').slice(0, MAX_SNIPPET_CHARS),
    })),
    null,
    2
  );
  const snippets = json.length > MAX_RAW_RESULTS_JSON_CHARS ? json.slice(0, MAX_RAW_RESULTS_JSON_CHARS) : json;
  const filled = SUMMARIZE_PROMPT.replace('{PROMPT}', prompt.slice(0, MAX_PROMPT_CHARS)).replace(
    '{SNIPPETS}',
    snippets
  );
  try {
    const result = await completeImpl(filled, { maxTokens, onCatalogError: onError, ...completeOpts });
    return (result.content || '').trim();
  } catch (error) {
    if (onError) onError(error);
    return fallbackSummary(sessions, terms || []);
  }
}

const VALUE_FLAGS = new Set([
  '--prompt-file',
  '--output-file',
  '--max-summary-tokens',
  '--db-path',
  '--max-sessions',
  '--source',
]);

export function parseArgs(args) {
  const values = new Map();
  let rawPrompt = null;
  const errors = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--prompt') {
      const value = args[i + 1];
      if (!value) {
        errors.push('--prompt requires a value');
      } else {
        if (rawPrompt !== null) errors.push('--prompt may be specified only once');
        rawPrompt = value;
        i += 1;
      }
    } else if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        errors.push(`${arg} requires a value`);
      } else {
        if (values.has(arg)) errors.push(`${arg} may be specified only once`);
        values.set(arg, value);
        i += 1;
      }
    } else if (
      arg === '--no-summarize' ||
      arg === '--probe-openrouter-quota' ||
      arg === '--help' ||
      arg === '-h' ||
      arg === '--verbose' ||
      arg === '-v'
    ) {
      values.set(arg, 'true');
    } else {
      errors.push(`Unknown option: ${arg}`);
    }
  }
  if (errors.length > 0) return { error: errors.join('\n') };
  if (values.get('--help') === 'true' || values.get('-h') === 'true') {
    return { help: true };
  }

  const promptFile = values.get('--prompt-file') || null;
  const outputFile = values.get('--output-file') || null;
  const dbPath = values.get('--db-path') || null;
  const maxSessions = values.has('--max-sessions') ? Number(values.get('--max-sessions')) : DEFAULT_SEARCH_SESSIONS;
  const maxSummaryTokens = values.has('--max-summary-tokens')
    ? Number(values.get('--max-summary-tokens'))
    : DEFAULT_SUMMARY_TOKENS;
  const source = values.get('--source') || SEARCH_ALL;
  if (!SUPPORTED_SEARCH_SOURCES.has(source)) {
    return { error: `--source must be one of: ${[...SUPPORTED_SEARCH_SOURCES].join(', ')} (got "${source}")` };
  }
  const verbose = Boolean(values.get('--verbose') || values.get('-v'));

  if (!rawPrompt && !promptFile) return { error: 'Either --prompt or --prompt-file must be specified' };
  if (rawPrompt && promptFile) return { error: 'Specify either --prompt or --prompt-file, not both' };
  if (!Number.isSafeInteger(maxSessions) || maxSessions < MIN_SEARCH_SESSIONS || maxSessions > MAX_SEARCH_SESSIONS) {
    return { error: `--max-sessions must be an integer from ${MIN_SEARCH_SESSIONS} to ${MAX_SEARCH_SESSIONS}` };
  }
  if (!Number.isSafeInteger(maxSummaryTokens) || maxSummaryTokens < 1 || maxSummaryTokens > MAX_SUMMARY_TOKENS) {
    return { error: `--max-summary-tokens must be an integer from 1 to ${MAX_SUMMARY_TOKENS}` };
  }

  return {
    rawPrompt,
    promptFile,
    outputFile,
    dbPath,
    maxSummaryTokens,
    maxSessions,
    source,
    verbose,
    noSummarize: Boolean(values.get('--no-summarize')),
    probeOpenRouterQuota: Boolean(values.get('--probe-openrouter-quota')),
    help: false,
  };
}

function usage() {
  return (
    'Usage: node scripts/free-chat-search.mjs --prompt "search query"\n' +
    '   or: node scripts/free-chat-search.mjs --prompt-file PATH [--output-file PATH] [--max-summary-tokens N]\n' +
    '   or: node scripts/free-chat-search.mjs --prompt-file PATH --no-summarize\n' +
    '\n' +
    '  --prompt TEXT            Inline search query (or use --prompt-file)\n' +
    '  --prompt-file PATH       File containing the search query\n' +
    '  --output-file PATH       Write results to this file instead of stdout\n' +
    '  --max-summary-tokens N   Max tokens for the free-model summary (default ' +
    DEFAULT_SUMMARY_TOKENS +
    ', max ' +
    MAX_SUMMARY_TOKENS +
    ')\n' +
    '  --max-sessions N         Recent sessions to search (default ' +
    DEFAULT_SEARCH_SESSIONS +
    ', range ' +
    MIN_SEARCH_SESSIONS +
    '-' +
    MAX_SEARCH_SESSIONS +
    ')\n' +
    '  --db-path PATH           Override the Kilo SQLite DB path\n' +
    '  --source NAME            Chat store to search: all (default, searches Kilo and Codex DBs), kilo, or codex\n' +
    '  --verbose, -v            Include a diagnostic header and the directory, source, and snippet_full fields\n' +
    '  --no-summarize           Skip free-model summarization; return raw JSON results\n' +
    '  --probe-openrouter-quota Check OpenRouter daily free counter before routing\n' +
    '\n' +
    'Discovers the Kilo SQLite DB (kilo db path or ~/.local/share/kilo/kilo.db),\n' +
    'extracts search terms via a free model (with fallback), queries session/message parts,\n' +
    'and summarizes the matches using a free model. No orchestrator reasoning required.'
  );
}

async function readPrompt(args, { openFn = open } = {}) {
  if (args.rawPrompt) {
    const text = args.rawPrompt.trim();
    if (!text) throw new Error('Search query is empty');
    if (text.length > MAX_PROMPT_CHARS) {
      throw new Error(`Search query must be at most ${MAX_PROMPT_CHARS} characters`);
    }
    return text;
  }
  const handle = await openFn(args.promptFile, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Prompt file must be a regular file');
    if (metadata.size > MAX_PROMPT_FILE_BYTES) {
      throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    }
    const buffer = Buffer.alloc(MAX_PROMPT_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PROMPT_FILE_BYTES) {
      throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)).trim();
    if (!text) throw new Error('Search query is empty');
    if (text.length > MAX_PROMPT_CHARS) {
      throw new Error(`Search query must be at most ${MAX_PROMPT_CHARS} characters after trimming`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    completeImpl = completeWithFreeModel,
    queryDb = queryKiloDb,
    openFn = open,
    statFn = stat,
    writeFileFn = writeFile,
    homeDir,
    xdgDataHome,
    platform: plat = platform(),
    stdout = process.stdout,
    stderr = process.stderr,
  } = {}
) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    stdout.write(usage() + '\n');
    return 0;
  }
  if (parsed.error) {
    stderr.write(`${parsed.error}\n\n${usage()}\n`);
    return 2;
  }

  let prompt;
  try {
    prompt = await readPrompt(parsed, { openFn });
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 2;
  }

  const dbPath = parsed.dbPath
    ? parsed.dbPath
    : await findExistingDbPath({ homeDir, xdgDataHome, platform: plat }, { statFn });

  stderr.write(`Chat search: "${prompt.slice(0, 80)}"\n`);

  const completeOpts = { fetchImpl, openRouterKey, groqApiKey, groqFreePlan };

  let terms;
  if (parsed.noSummarize) {
    terms = defaultTerms(prompt);
    stderr.write(`Search terms (no free compute): ${terms.join(', ')}\n`);
  } else {
    try {
      terms = await expandSearchTerms(prompt, {
        completeImpl,
        maxTokens: 200,
        onError: (error) => stderr.write(`Term expansion via free model failed: ${error.message}\n`),
        ...completeOpts,
      });
    } catch (error) {
      stderr.write(`Term expansion failed: ${error.message}\n`);
      terms = defaultTerms(prompt);
    }
    stderr.write(`Search terms: ${terms.join(', ')}\n`);
  }

  let sessions;
  let usedDbPaths = [];
  try {
    if (parsed.source === SEARCH_ALL) {
      sessions = await searchAllSources(terms, { queryDb, maxSessions: parsed.maxSessions });
      usedDbPaths = [
        resolveKiloDbCandidates({ homeDir, xdgDataHome, platform: plat })[0],
        resolveCodexDbCandidates({ homeDir, platform: plat })[0],
      ];
    } else if (parsed.source === CHAT_STORE_CODEX) {
      const codexDbPath = parsed.dbPath
        ? parsed.dbPath
        : await findExistingCodexDbPath({ homeDir, platform: plat }, { statFn });
      sessions = await searchChatHistory(codexDbPath, terms, {
        queryDb,
        maxSessions: parsed.maxSessions,
        source: CHAT_STORE_CODEX,
      });
      usedDbPaths = [codexDbPath];
    } else {
      const kiloDbPath = parsed.dbPath
        ? parsed.dbPath
        : await findExistingDbPath({ homeDir, xdgDataHome, platform: plat }, { statFn });
      sessions = await searchChatHistory(kiloDbPath, terms, {
        queryDb,
        maxSessions: parsed.maxSessions,
        source: CHAT_STORE_KILO,
      });
      usedDbPaths = [kiloDbPath];
    }
  } catch (error) {
    stderr.write(`Database query failed: ${error.message}\n`);
    return 4;
  }

  stderr.write(`Found ${sessions.length} matching session(s)\n`);

  const outputSessions = shapeSessions(sessions, { verbose: parsed.verbose });
  let resultText;
  if (parsed.noSummarize) {
    resultText = JSON.stringify(outputSessions, null, 2);
  } else {
    resultText = await summarizeSearchResults(prompt, sessions, {
      completeImpl,
      maxTokens: parsed.maxSummaryTokens,
      terms,
      onError: (error) => stderr.write(`Summarization via free model failed: ${error.message}\n`),
      ...completeOpts,
    });
  }

  const header = parsed.verbose
    ? (() => {
        const source = parsed.source;
        const dbInfo = usedDbPaths.map((p) => `DB: ${p}`).join('\n');
        return `Query: ${prompt}\n${dbInfo}\nSource: ${source}\nTerms: ${terms.join(', ')}\nSessions found: ${sessions.length}\n\n`;
      })()
    : '';
  const report = `${header}${resultText}\n`;

  if (parsed.outputFile) {
    await writeFileFn(parsed.outputFile, report, 'utf8');
    stderr.write(`Results written to ${parsed.outputFile}\n`);
  } else {
    stdout.write(report);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
