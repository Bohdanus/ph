#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { activeQuarantineKeys, DEFAULT_QUARANTINE_FILE, readQuarantineState } from '../lib/free-model-quarantine.mjs';
import { loadCatalogs, probeOpenRouterQuota } from '../free-model-pool.mjs';

const KILO_DIR = dirname(DEFAULT_QUARANTINE_FILE);
const REPORT_DIR = resolve(KILO_DIR, 'sweep-reports');
const USER_HOME = process.env.HOME || process.env.USERPROFILE || homedir();
const KILO_DB_CANDIDATES = [
  ...(process.env.XDG_DATA_HOME ? [resolve(process.env.XDG_DATA_HOME, 'kilo/kilo.db')] : []),
  resolve(USER_HOME, '.local/share/kilo/kilo.db'),
  ...(process.platform === 'darwin' ? [resolve(USER_HOME, 'Library/Application Support/kilo/kilo.db')] : []),
];
const KILO_LOG_CANDIDATES = [
  ...(process.env.XDG_DATA_HOME ? [resolve(process.env.XDG_DATA_HOME, 'kilo/log/opencode.log')] : []),
  resolve(USER_HOME, '.local/share/kilo/log/opencode.log'),
  ...(process.platform === 'darwin' ? [resolve(USER_HOME, 'Library/Application Support/kilo/log/opencode.log')] : []),
];
const CODEX_HOME = resolve(process.env.CODEX_HOME || `${USER_HOME}/.codex`);
const SCAN_WINDOW_MS = 60 * 60 * 1000;
const SQLITE_TIMEOUT_MS = 30_000;
const CODEX_DECOMPRESS_TIMEOUT_MS = 30_000;
const MAX_SQLITE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_SQLITE_ERROR_BYTES = 8 * 1024;
const MAX_KILO_LOG_TAIL_BYTES = 64 * 1024 * 1024;
const MAX_CODEX_ROLLOUT_BYTES = 16 * 1024 * 1024;
const MAX_CODEX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CODEX_THREADS = 100;
const MAX_CODEX_SCAN_MS = 180_000;
const MAX_SWEEP_RUNTIME_MS = 240_000;
const FREE_MODEL_ID_SOURCE =
  '(?:[a-z0-9][a-z0-9._-]*\\/[a-z0-9][a-z0-9._-]*:(?:free|s-free|free-plan)|kilo-auto\\/free)';
const FREE_MODEL_ID = new RegExp(`^${FREE_MODEL_ID_SOURCE}$`, 'i');
const FREE_MODEL_ID_EXTRACTOR = new RegExp(FREE_MODEL_ID_SOURCE, 'gi');
const SUPPORTED_SOURCES = new Set(['kilo', 'openrouter']);
const ACTIVE_CHILDREN = new Set();

export function isPathInside(root, candidate) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function safeIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) return 'unknown';
  const normalized = value.replace(/[^a-z0-9._:-]/gi, '_');
  if (normalized === value && value.length <= 160) return value;
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${normalized.slice(0, 140)}_${digest}`;
}

function normalizeTimestamp(value) {
  const time =
    typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
      ? Number(value)
      : typeof value === 'string'
        ? Date.parse(value)
        : NaN;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'unknown';
}

export function classifyFailure(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (/daily.{0,40}(?:quota|limit)|free.model.daily|account.{0,30}(?:quota|allowance)/i.test(text)) {
    return 'account_quota';
  }
  if (/temporarily rate.?limited upstream|rate limit exceeded|too many requests/i.test(text)) {
    return 'explicit_upstream_rate_limit';
  }
  return 'unclassified';
}

export function summarizeFailureEvents(rows, { ownSessionId = null } = {}) {
  const seen = new Set();
  const events = [];
  const ignored = { duplicate: 0, ownSession: 0, nonFreeRoute: 0, unsupportedSource: 0, unclassified: 0 };

  for (const row of rows) {
    const partId = typeof row.part_id === 'string' ? row.part_id : '';
    if (!partId || seen.has(partId)) {
      ignored.duplicate += 1;
      continue;
    }
    seen.add(partId);

    const sessionId = typeof row.session_id === 'string' ? row.session_id : '';
    if (ownSessionId && sessionId === ownSessionId) {
      ignored.ownSession += 1;
      continue;
    }

    const source = typeof row.provider_id === 'string' ? row.provider_id : '';
    if (!SUPPORTED_SOURCES.has(source)) {
      ignored.unsupportedSource += 1;
      continue;
    }

    const model = typeof row.model_id === 'string' ? row.model_id : '';
    if (!FREE_MODEL_ID.test(model)) {
      ignored.nonFreeRoute += 1;
      continue;
    }

    const classification = classifyFailure(row.error);
    if (classification === 'unclassified') {
      ignored.unclassified += 1;
      continue;
    }

    events.push({
      partId: safeIdentifier(partId),
      sessionId: safeIdentifier(sessionId),
      source,
      model,
      occurredAt: normalizeTimestamp(row.occurred_at_ms ?? row.occurred_at),
      classification,
    });
  }

  return { events, ignored };
}

export function classifyCandidates(events) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.source}:${event.model}`;
    const group = groups.get(key) ?? {
      source: event.source,
      model: event.model,
      rateLimitEvents: 0,
      quotaEvents: 0,
      sessions: new Set(),
      runs: new Set(),
      partIds: [],
      occurredAt: [],
    };
    group.sessions.add(event.sessionId);
    if (event.runId && event.runId !== 'unknown') group.runs.add(event.runId);
    group.partIds.push(event.partId ?? event.eventId ?? 'unknown');
    group.occurredAt.push(event.occurredAt);
    if (event.classification === 'explicit_upstream_rate_limit') group.rateLimitEvents += 1;
    if (event.classification === 'account_quota') group.quotaEvents += 1;
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => ({
    source: group.source,
    model: group.model,
    rateLimitEvents: group.rateLimitEvents,
    quotaEvents: group.quotaEvents,
    sessionCount: group.sessions.size,
    runCount: group.runs.size,
    sessionIds: [...group.sessions],
    runIds: [...group.runs],
    partIds: group.partIds,
    occurredAt: group.occurredAt,
    recommendation:
      group.rateLimitEvents >= 2 && group.sessions.size >= 2 && group.runs.size >= 2
        ? 'manual_review_candidate'
        : group.rateLimitEvents >= 2
          ? 'needs_manual_triage_single_or_unlinked_run'
          : 'no_quarantine_insufficient_independent_evidence',
  }));
}

function parseCodexRollout(text, { threadId = 'unknown', windowStart, windowEnd } = {}) {
  const events = [];
  const seen = new Set();
  let oldestTimestamp = Infinity;
  let missingTimestampCandidates = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const timestampText =
      typeof record.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(record.timestamp)
        ? record.timestamp.slice(0, 32)
        : null;
    const timestamp = timestampText ? Date.parse(timestampText) : NaN;
    if (Number.isFinite(timestamp)) oldestTimestamp = Math.min(oldestTimestamp, timestamp);

    const payload = record.payload;
    if (
      record.type !== 'response_item' ||
      !['custom_tool_call_output', 'function_call_output'].includes(payload?.type) ||
      typeof payload.output !== 'string'
    ) {
      continue;
    }

    const classification = classifyFailure(payload.output);
    if (classification === 'unclassified') continue;
    const models = [...new Set(payload.output.match(FREE_MODEL_ID_EXTRACTOR) ?? [])];
    if (models.length !== 1) continue;
    if (!Number.isFinite(timestamp)) {
      missingTimestampCandidates += 1;
      continue;
    }
    if (
      (Number.isFinite(windowStart) && timestamp < windowStart) ||
      (Number.isFinite(windowEnd) && timestamp >= windowEnd)
    )
      continue;

    const rawRecordId = payload.id ?? record.id;
    if (typeof rawRecordId !== 'string' || rawRecordId.length === 0 || seen.has(rawRecordId)) continue;
    seen.add(rawRecordId);
    const recordId = safeIdentifier(rawRecordId);
    events.push({
      threadId: safeIdentifier(threadId),
      recordId,
      model: models[0],
      source: 'unknown',
      classification,
      occurredAt: timestampText,
    });
  }
  return { events, oldestTimestamp, missingTimestampCandidates };
}

export function summarizeCodexRollout(text, options = {}) {
  return parseCodexRollout(text, options).events;
}

function runCommand(command, args, { timeoutMs, maxOutputBytes = MAX_SQLITE_OUTPUT_BYTES } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    ACTIVE_CHILDREN.add(child);
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    let killTimer;

    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(output);
    };

    const terminate = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    };

    const timer = setTimeout(() => {
      terminate();
      finish(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        terminate();
        finish(new Error(`${command} output exceeded ${maxOutputBytes} bytes`));
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_SQLITE_ERROR_BYTES);
    });
    child.once('error', (error) => {
      ACTIVE_CHILDREN.delete(child);
      clearTimeout(killTimer);
      finish(error);
    });
    child.once('close', (code) => {
      ACTIVE_CHILDREN.delete(child);
      clearTimeout(killTimer);
      if (code === 0) finish(null, Buffer.concat(stdout).toString('utf8'));
      else finish(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function firstExistingFile(candidates, statPath = stat) {
  for (const candidate of candidates) {
    try {
      if ((await statPath(candidate)).isFile()) return candidate;
    } catch {
      // Try the next documented location; the selected path will report a useful failure later.
    }
  }
  return candidates[0];
}

async function resolveKiloDatabase() {
  if (process.env.KILO_DB_PATH) return resolve(process.env.KILO_DB_PATH);
  try {
    const path = (await runCommand('kilo', ['db', 'path'], { timeoutMs: 5000, maxOutputBytes: 4096 })).trim();
    if (path) return resolve(path);
  } catch {
    // Fall back to the documented default location when the CLI is unavailable.
  }
  return firstExistingFile(KILO_DB_CANDIDATES);
}

export async function scanKiloFailures(
  startMs,
  endMs,
  { resolveDatabase = resolveKiloDatabase, run = runCommand } = {}
) {
  const dbPath = await resolveDatabase();
  const sql = `
    SELECT s.id AS session_id,
           p.id AS part_id,
           p.time_created AS occurred_at_ms,
           CASE WHEN json_valid(s.model) THEN json_extract(s.model, '$.providerID') END AS provider_id,
           CASE WHEN json_valid(s.model) THEN json_extract(s.model, '$.id') END AS model_id,
           json_extract(p.data, '$.state.error') AS error
    FROM session AS s
    CROSS JOIN part AS p INDEXED BY part_session_idx
      ON p.session_id = s.id
      AND p.time_created >= ${Math.trunc(startMs)}
      AND p.time_created < ${Math.trunc(endMs)}
     WHERE s.time_updated >= ${Math.trunc(startMs)}
      AND json_valid(p.data)
      AND json_extract(p.data, '$.type') = 'tool'
      AND json_extract(p.data, '$.state.status') = 'error'
      AND json_extract(p.data, '$.state.error') IS NOT NULL
    ORDER BY p.time_created DESC;
  `;
  const output = await run('sqlite3', ['-readonly', '-json', dbPath, sql], {
    timeoutMs: SQLITE_TIMEOUT_MS,
  });
  const rows = JSON.parse(output);
  if (!Array.isArray(rows)) throw new Error('Kilo SQLite query did not return a JSON array');
  return { dbPath, rows };
}

export async function scanKiloLogFailures(startMs, endMs, options = {}) {
  const { logPath: configuredLogPath, sessionId = null, statPath = stat, createStream = createReadStream } = options;
  const logPath = configuredLogPath
    ? resolve(configuredLogPath)
    : process.env.KILO_LOG_PATH
      ? resolve(process.env.KILO_LOG_PATH)
      : await firstExistingFile(KILO_LOG_CANDIDATES, statPath);
  const info = await statPath(logPath);
  if (!info.isFile()) throw new Error('Kilo log path is not a regular file');
  if (info.size === 0) {
    return { status: 'empty log file', complete: false, events: [], ignored: { selfSession: 0, selfRun: 0 } };
  }

  const tailStart = Math.max(0, info.size - MAX_KILO_LOG_TAIL_BYTES);
  const streamStart = tailStart > 0 ? tailStart - 1 : 0;
  const ownRunIds = new Set();
  const timestampPattern = /timestamp=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;
  const field = (line, name) => line.match(new RegExp(`\\b${name}=([^\\s]+)`, 'i'))?.[1] ?? null;

  const forEachLine = async (visit) => {
    const stream = createStream(logPath, { start: streamStart, end: info.size - 1, encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let dropPartialLine = tailStart > 0;
    for await (const line of lines) {
      if (dropPartialLine) {
        dropPartialLine = false;
        continue;
      }
      visit(line);
    }
    return stream.bytesRead;
  };

  if (sessionId) {
    await forEachLine((line) => {
      const timestamp = line.match(timestampPattern)?.[1];
      if (!timestamp) return;
      const epoch = Date.parse(timestamp);
      if (epoch < startMs || epoch >= endMs || field(line, 'session\\.id') !== sessionId) return;
      const runId = field(line, 'run');
      if (runId) ownRunIds.add(runId);
    });
  }

  const events = [];
  const seen = new Set();
  const ignored = { selfSession: 0, selfRun: 0 };
  let oldestTimestamp = Infinity;
  let missingTimestampErrors = 0;
  let windowLines = 0;
  const pattern =
    /temporarily rate.?limited upstream|rate limit exceeded|too many requests|daily.{0,40}(?:quota|limit)|free.model.daily|quota exceeded/i;

  const bytesRead = await forEachLine((line) => {
    const timestampText = line.match(timestampPattern)?.[1];
    const level = field(line, 'level')?.toLowerCase();
    const looksActionable = level === 'error' && pattern.test(line);
    if (!timestampText) {
      if (looksActionable) missingTimestampErrors += 1;
      return;
    }
    const timestamp = Date.parse(timestampText);
    if (!Number.isFinite(timestamp)) {
      if (looksActionable) missingTimestampErrors += 1;
      return;
    }
    oldestTimestamp = Math.min(oldestTimestamp, timestamp);
    if (timestamp < startMs || timestamp >= endMs) return;
    windowLines += 1;
    if (!looksActionable) return;

    const source = field(line, 'providerID');
    const model = field(line, 'modelID');
    const eventSessionId = field(line, 'session\\.id') ?? 'unknown';
    const runId = field(line, 'run') ?? 'unknown';
    if (!source || !SUPPORTED_SOURCES.has(source) || !model || !FREE_MODEL_ID.test(model)) return;
    if (sessionId && eventSessionId === sessionId) {
      ignored.selfSession += 1;
      return;
    }
    if (runId !== 'unknown' && ownRunIds.has(runId)) {
      ignored.selfRun += 1;
      return;
    }

    const classification = classifyFailure(line);
    if (classification === 'unclassified') return;
    const eventId = createHash('sha256').update(line).digest('hex').slice(0, 16);
    if (seen.has(eventId)) return;
    seen.add(eventId);
    events.push({
      source,
      model,
      classification,
      sessionId: safeIdentifier(eventSessionId),
      runId: safeIdentifier(runId),
      occurredAt: timestampText,
      eventId,
    });
  });

  const expectedBytes = info.size - streamStart;
  const fullyRead = bytesRead === expectedBytes;
  const tailCoversWindow = oldestTimestamp <= startMs;
  const complete = fullyRead && tailCoversWindow && missingTimestampErrors === 0;
  const coverage = tailStart === 0 ? 'whole file' : `${Math.round((info.size - tailStart) / (1024 * 1024))} MiB tail`;
  const status = `read-only Kilo log ${complete ? 'complete' : 'incomplete'} (${coverage}, ${windowLines} window line(s), ${events.length} provider error(s), ${ignored.selfSession + ignored.selfRun} self line(s) excluded)`;
  return { status, complete, events, ignored };
}

async function resolveCodexDatabase() {
  let names;
  try {
    names = await readdir(CODEX_HOME);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const databases = await Promise.all(
    names
      .filter((name) => /^state_.*\.sqlite$/.test(name))
      .map(async (name) => {
        const path = resolve(CODEX_HOME, name);
        try {
          return { path, mtimeMs: (await stat(path)).mtimeMs };
        } catch {
          return null;
        }
      })
  );
  return databases.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null;
}

async function readCodexTail(path, size) {
  const tailStart = Math.max(0, size - MAX_CODEX_ROLLOUT_BYTES);
  const streamStart = tailStart > 0 ? tailStart - 1 : 0;
  const stream = createReadStream(path, { start: streamStart, end: size - 1 });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytesRead = Buffer.concat(chunks);
  if (bytesRead.byteLength !== size - streamStart) throw new Error('Codex rollout changed during bounded read');
  let text = bytesRead.toString('utf8');
  if (tailStart > 0) {
    const lineEnd = text.indexOf('\n');
    text = lineEnd < 0 ? '' : text.slice(lineEnd + 1);
  }
  return { text, truncated: tailStart > 0 };
}

export async function scanCodexFailures(
  startMs,
  endMs,
  {
    codexHome = CODEX_HOME,
    resolveDatabase = resolveCodexDatabase,
    realpathPath = realpath,
    run = runCommand,
    statPath = stat,
    readText = readFile,
    readTail = readCodexTail,
  } = {}
) {
  const dbPath = await resolveDatabase();
  if (!dbPath) return { status: 'no Codex state database found; scan skipped', complete: true, events: [] };
  const codexRoot = await realpathPath(codexHome);
  const realDbPath = await realpathPath(dbPath);
  if (!isPathInside(codexRoot, realDbPath)) {
    throw new Error('Codex database path escapes the Codex home directory');
  }

  const columns = JSON.parse(
    await run('sqlite3', ['-readonly', '-json', realDbPath, 'PRAGMA table_info(threads);'], {
      timeoutMs: SQLITE_TIMEOUT_MS,
      maxOutputBytes: 128 * 1024,
    })
  );
  const columnNames = new Set(columns.map((column) => column.name));
  const timeColumn = columnNames.has('updated_at_ms')
    ? 'updated_at_ms'
    : columnNames.has('updated_at')
      ? 'updated_at'
      : null;
  if (!columnNames.has('id') || !columnNames.has('rollout_path') || !timeColumn) {
    return { status: 'unsupported threads schema; no records analyzed', complete: false, events: [] };
  }

  const backfillRows = JSON.parse(
    await run('sqlite3', ['-readonly', '-json', realDbPath, 'SELECT status FROM backfill_state WHERE id = 1;'], {
      timeoutMs: SQLITE_TIMEOUT_MS,
      maxOutputBytes: 16 * 1024,
    })
  );
  if (backfillRows[0]?.status !== 'complete') {
    return { status: 'backfill incomplete or unknown; no records analyzed', complete: false, events: [] };
  }

  const timeFactor = timeColumn === 'updated_at_ms' ? 1 : 1000;
  const rows = JSON.parse(
    await run(
      'sqlite3',
      [
        '-readonly',
        '-json',
        realDbPath,
        `SELECT id AS thread_id, rollout_path FROM threads WHERE ${timeColumn} >= ${Math.trunc(startMs / timeFactor)} AND ${timeColumn} < ${Math.trunc(endMs / timeFactor)} ORDER BY ${timeColumn} DESC;`,
      ],
      { timeoutMs: SQLITE_TIMEOUT_MS }
    )
  );
  if (rows.length > MAX_CODEX_THREADS) throw new Error('Codex scan exceeded its thread-count bound');

  const events = [];
  let skippedThreads = 0;
  let bytesRead = 0;
  const skippedReasons = new Map();
  const deadline = Date.now() + MAX_CODEX_SCAN_MS;
  for (const row of rows) {
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error('Codex scan exceeded its time bound');
      if (typeof row.rollout_path !== 'string' || !row.rollout_path.startsWith('/')) {
        throw new Error('Codex rollout path is not absolute');
      }
      const rolloutPath = await realpathPath(resolve(row.rollout_path));
      if (!isPathInside(codexRoot, rolloutPath)) {
        throw new Error('Codex rollout path escapes the Codex home directory');
      }
      let contents;
      let truncated = false;
      if (rolloutPath.endsWith('.zst')) {
        contents = await run('zstd', ['-dc', rolloutPath], {
          timeoutMs: Math.min(CODEX_DECOMPRESS_TIMEOUT_MS, remainingMs),
          maxOutputBytes: MAX_CODEX_ROLLOUT_BYTES,
        });
      } else {
        const info = await statPath(rolloutPath);
        if (info.size > MAX_CODEX_ROLLOUT_BYTES) {
          const tail = await readTail(rolloutPath, info.size);
          contents = tail.text;
          truncated = tail.truncated;
        } else {
          contents = await readText(rolloutPath, 'utf8');
        }
      }
      bytesRead += Buffer.byteLength(contents, 'utf8');
      if (bytesRead > MAX_CODEX_TOTAL_BYTES) throw new Error('Codex scan exceeded its total size bound');
      const parsed = parseCodexRollout(contents, {
        threadId: row.thread_id,
        windowStart: startMs,
        windowEnd: endMs,
      });
      events.push(...parsed.events);
      let threadSkipped = false;
      if (truncated && parsed.oldestTimestamp > startMs) {
        threadSkipped = true;
        skippedReasons.set(
          'tail lacks preceding-hour boundary',
          (skippedReasons.get('tail lacks preceding-hour boundary') ?? 0) + 1
        );
      }
      if (parsed.missingTimestampCandidates > 0) {
        threadSkipped = true;
        skippedReasons.set(
          'potential failure has no timestamp',
          (skippedReasons.get('potential failure has no timestamp') ?? 0) + 1
        );
      }
      if (threadSkipped) skippedThreads += 1;
    } catch (error) {
      skippedThreads += 1;
      const message = error?.message ?? '';
      const reason = message.includes('escapes the Codex home')
        ? 'path outside Codex home'
        : message.includes('size bound') || message.includes('output exceeded')
          ? 'size bound'
          : message.includes('time bound') || message.includes('timed out')
            ? 'time bound'
            : message.includes('Command not found: zstd')
              ? 'zstd unavailable'
              : 'unreadable or invalid rollout';
      skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
    }
  }
  const skippedSummary = [...skippedReasons].map(([reason, count]) => `${count} ${reason}`).join(', ');
  return {
    status: `read-only index scanned (${rows.length} thread(s), ${bytesRead} bytes inspected, ${skippedThreads} skipped${skippedSummary ? `: ${skippedSummary}` : ''})`,
    complete: skippedThreads === 0,
    events,
  };
}

export async function readQuarantineSnapshot(filePath = DEFAULT_QUARANTINE_FILE, now = Date.now()) {
  const state = await readQuarantineState(filePath);
  const activeKeys = activeQuarantineKeys(state, now);
  return Object.entries(state.entries).map(([key, entry]) => ({
    key,
    reason: entry.reason,
    expiresAt: entry.expiresAt,
    active: activeKeys.has(key),
  }));
}

async function getHealthSnapshots() {
  const catalogErrors = [];
  const [quota, catalogs] = await Promise.all([
    probeOpenRouterQuota({ openRouterKey: process.env.OPENROUTER_API_KEY }).catch((error) => ({
      reason: 'error',
      detail: safeFailure(error, 'OpenRouter quota check'),
    })),
    loadCatalogs({
      includeOpenRouterCatalog: true,
      onCatalogError: (source, error) => catalogErrors.push(`${source}: ${safeFailure(error, 'catalog fetch')}`),
    }).then(
      (models) => ({ models, errors: catalogErrors }),
      (error) => ({ error: safeFailure(error, 'Catalog health check'), models: [], errors: catalogErrors })
    ),
  ]);
  return { quota, catalogs };
}

function renderReport(run) {
  const lines = [
    '# Free Model Sweep Report',
    `- Started: ${new Date(run.startedAt).toISOString()}`,
    `- Window: ${new Date(run.windowStart).toISOString()} to ${new Date(run.startedAt).toISOString()} (preceding hour)`,
    '- Chat transcript/error text was not sent to any model or copied into this report.',
    '- Quarantine mutations: disabled; candidates require operator review and the quarantine CLI.',
    '',
    '## Scan health',
    `- Kilo SQLite: ${run.kiloStatus}`,
    `- Kilo provider log: ${run.kiloLogStatus ?? 'not scanned'}`,
    `- Codex store: ${run.codexStatus ?? 'not scanned'}`,
    `- Duplicate records ignored: ${run.ignored?.duplicate ?? 0}`,
    `- Own-session records ignored: ${run.ignored?.ownSession ?? 0}`,
    `- Non-free routes ignored: ${run.ignored?.nonFreeRoute ?? 0}`,
    `- Unsupported provider routes ignored: ${run.ignored?.unsupportedSource ?? 0}`,
    `- Unclassified errors ignored: ${run.ignored?.unclassified ?? 0}`,
    '',
    '## Provider health',
    `- OpenRouter quota: ${run.health?.quota?.used ?? '?'} / ${run.health?.quota?.limit ?? '?'} used; ${run.health?.quota?.remaining ?? '?'} remaining (reason: ${run.health?.quota?.reason ?? 'unavailable'})`,
    `- Free catalog candidates: ${run.health?.catalogs?.models?.length ?? 0}`,
    ...(run.health?.catalogs?.error ? [`- Catalog error: ${run.health.catalogs.error}`] : []),
    ...(run.health?.catalogs?.errors ?? []).map((error) => `- Catalog unavailable: ${error}`),
    '',
    '## Quarantine state',
    '- Quarantine changes applied: none (report-only).',
    `- Expired entries present: ${(run.quarantine ?? []).filter((entry) => !entry.active).length}`,
    ...(run.quarantineReadError ? [`- State read error: ${run.quarantineReadError}`] : []),
    ...(run.quarantine ?? []).map(
      (entry) => `- ${entry.key}: ${entry.reason}; expires ${entry.expiresAt}; ${entry.active ? 'active' : 'expired'}`
    ),
    '',
    '## Failure evidence',
    `- Kilo SQLite explicit error parts with free session-model metadata (supporting evidence, not provider attribution): ${run.events?.length ?? 0}`,
    ...(run.events ?? []).map(
      (event) =>
        `- ${event.occurredAt} | ${event.source}:${event.model} | ${event.classification} | session ${event.sessionId} | part ${event.partId}`
    ),
    `- Kilo provider-log explicit errors: ${run.kiloLogEvents?.length ?? 0}`,
    ...(run.kiloLogEvents ?? []).map(
      (event) =>
        `- ${event.occurredAt} | ${event.source}:${event.model} | ${event.classification} | session ${event.sessionId} | run ${event.runId} | record ${event.eventId}`
    ),
    `- Codex records with free model IDs but unknown route: ${run.codexEvents?.length ?? 0}`,
    ...(run.codexEvents ?? []).map(
      (event) =>
        `- ${event.occurredAt} | route unknown:${event.model} | ${event.classification} | thread ${event.threadId} | record ${event.recordId} (not a quarantine candidate)`
    ),
    '',
    '## Assessment',
    ...(run.candidates?.length
      ? run.candidates.map((candidate) => {
          const timestamps = candidate.occurredAt.filter((value) => value !== 'unknown').sort();
          return `- ${candidate.source}:${candidate.model}: ${candidate.rateLimitEvents} explicit upstream rate-limit event(s), ${candidate.sessionCount} distinct session(s), ${candidate.runCount} distinct run(s), ${candidate.quotaEvents} account-quota event(s), ${candidate.partIds.length} record(s) from ${timestamps[0] ?? 'unknown'} through ${timestamps.at(-1) ?? 'unknown'}; ${candidate.recommendation}.`;
        })
      : ['- No verified free-route upstream rate-limit events found.']),
    '',
    ...(run.error ? [`## Sweep error\n- ${run.error}`, ''] : []),
  ];
  return `${lines.join('\n')}\n`;
}

async function writeReport(run) {
  await mkdir(REPORT_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date(run.startedAt).toISOString().replace(/[:.]/g, '-');
  const runId = randomUUID();
  const reportPath = resolve(REPORT_DIR, `free-model-sweep-${stamp}-${runId}.md`);
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, renderReport(run), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, reportPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return reportPath;
}

async function ownSessionId() {
  try {
    return (await readFile(resolve(KILO_DIR, 'session-id'), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

function safeFailure(error, kind) {
  if (/timed out/i.test(error?.message ?? '')) return `${kind} timed out`;
  if (/exceeded \d+ bytes/i.test(error?.message ?? '')) return `${kind} exceeded its output bound`;
  return `${kind} failed; diagnostic details withheld to avoid recording local paths or payloads`;
}

export async function runSweep({
  now = Date.now(),
  sessionId,
  scanKilo = scanKiloFailures,
  scanKiloLog = scanKiloLogFailures,
  scanCodex = scanCodexFailures,
  readQuarantine = readQuarantineSnapshot,
  healthSnapshot = getHealthSnapshots,
  write = writeReport,
} = {}) {
  const run = {
    startedAt: now,
    windowStart: now - SCAN_WINDOW_MS,
    kiloStatus: 'not scanned',
    kiloLogStatus: 'not scanned',
    kiloLogEvents: [],
    kiloLogComplete: false,
    kiloLogIgnored: { selfSession: 0, selfRun: 0 },
    events: [],
    ignored: {},
    candidates: [],
    health: null,
    codexStatus: 'not scanned',
    codexEvents: [],
    kiloComplete: false,
    codexComplete: false,
  };

  const ownId = sessionId ?? (await ownSessionId());
  try {
    const { rows } = await scanKilo(run.windowStart, run.startedAt);
    const summary = summarizeFailureEvents(rows, { ownSessionId: ownId || null });
    run.events = summary.events;
    run.ignored = summary.ignored;
    run.kiloStatus = `read-only SQLite scan complete (${rows.length} error record(s))`;
    run.kiloComplete = true;
  } catch (error) {
    run.kiloStatus = 'incomplete';
    run.error = safeFailure(error, 'Kilo read-only SQLite scan');
  }

  try {
    const log = await scanKiloLog(run.windowStart, run.startedAt, { sessionId: ownId || null });
    run.kiloLogStatus = log.status;
    run.kiloLogEvents = log.events;
    run.kiloLogIgnored = log.ignored;
    run.kiloLogComplete = log.complete;
    run.candidates = classifyCandidates(log.events);
  } catch (error) {
    run.kiloLogStatus = safeFailure(error, 'Kilo provider-log scan');
  }

  try {
    const codex = await scanCodex(run.windowStart, run.startedAt);
    run.codexStatus = codex.status;
    run.codexEvents = codex.events;
    run.codexComplete = codex.complete;
  } catch (error) {
    run.codexStatus = safeFailure(error, 'Codex read-only rollout scan');
  }

  try {
    run.quarantine = await readQuarantine();
  } catch (error) {
    run.quarantineReadError = safeFailure(error, 'Quarantine state read');
  }

  if (!run.quarantineReadError) {
    run.health = await healthSnapshot();
  }
  const reportPath = await write(run);
  return { run, reportPath };
}

function usage() {
  return [
    'Usage: node scripts/cron/free-model-sweep.mjs [--report-only]',
    'The sweep is read-only against chat history and cannot apply quarantine decisions.',
    'Review a report, then use scripts/free-model-quarantine.mjs for an explicitly approved exact route.',
  ].join('\n');
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.some((arg) => arg !== '--report-only')) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  try {
    const { run, reportPath } = await runSweep();
    process.stdout.write(`Sweep complete: ${reportPath}\n`);
    if (run.error || run.quarantineReadError || !run.kiloComplete || !run.kiloLogComplete || !run.codexComplete)
      return 1;
    return 0;
  } catch (error) {
    process.stderr.write(`Sweep failed: ${safeFailure(error, 'Sweep')}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const watchdog = setTimeout(() => {
    process.stderr.write(`Sweep exceeded ${MAX_SWEEP_RUNTIME_MS}ms; terminating active subprocesses.\n`);
    for (const child of ACTIVE_CHILDREN) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Continue terminating other children if one has already closed.
      }
    }
    process.exit(124);
  }, MAX_SWEEP_RUNTIME_MS);

  main()
    .then((code) => {
      clearTimeout(watchdog);
      process.exitCode = code;
    })
    .catch((error) => {
      clearTimeout(watchdog);
      process.stderr.write(`Fatal sweep error: ${safeFailure(error, 'Sweep')}\n`);
      process.exitCode = 1;
    });
}
