#!/usr/bin/env node

import { readdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPLETION_TIMEOUT_MS, resolveKiloCli, runKiloCompletion } from './lib/free-model-kilo.mjs';
import { isDisabledFreeModel, NEMOTRON_3_ULTRA_FREE_MODEL } from './lib/free-model-policy.mjs';
import { resolveCommandShim } from './lib/windows-command-shim.mjs';
import { terminateWindowsProcessTree } from './lib/windows-process-tree.mjs';
import { sanitizeForLogging, sanitizeErrorMessage, sanitizeErrorStack } from './lib/secrets.mjs';
import {
  activeQuarantineKeys,
  DEFAULT_QUARANTINE_FILE,
  isOperatorOnlyQuarantine,
  loadQuarantineState,
  loadQuarantineStateLocked,
  MAX_QUARANTINE_HOURS,
  quarantineKey,
  readQuarantineState,
  upsertQuarantine,
  withQuarantineWriteLock,
} from './lib/free-model-quarantine.mjs';
import {
  DEFAULT_POOL_STATE_FILE,
  getKiloCooldownUntil,
  isOpenRouterQuotaExhaustedToday,
  markKiloRateLimited,
  markOpenRouterQuotaExhausted,
  recordModelFailure,
} from './lib/free-model-pool-state.mjs';

const KILO_MODELS = 'https://api.kilo.ai/api/gateway/models';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY_INFO = 'https://openrouter.ai/api/v1/key';
const OPENCODE_MODELS = 'https://opencode.ai/inference/v1/models';
const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
export const CONTROL_PLANE_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_SOURCE = 3;
const MAX_OPENROUTER_RETRY_AFTER_MS = 60_000;
const MAX_OPENCODE_RETRY_AFTER_MS = 60_000;
const MAX_PROMPT_CHARS = 120_000;
const MAX_PROMPT_FILE_BYTES = 480 * 1024;
const MAX_OPENCODE_OUTPUT_BYTES = 1024 * 1024;
const MAX_OPENCODE_TIMEOUT_MS = 12 * 60 * 1000;
export const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPLETION_RESPONSE_BYTES = 1024 * 1024;
const MAX_COMPLETION_TOKENS = 65536;
const DEFAULT_MAX_TOKENS = 1200;
const XINGCHEN_XING4_MODEL = 'xingchen-agi/xing4.0-29b-a4b:free';
const HTTP_DATE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HTTP_SHORT_DAY_PATTERN = 'Mon|Tue|Wed|Thu|Fri|Sat|Sun';
const HTTP_LONG_DAY_PATTERN = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const HTTP_MONTH_PATTERN = '(?:' + HTTP_DATE_MONTHS.join('|') + ')';
const HTTP_WEEKDAY_NAMES = [
  ['Sun', 'Sunday'],
  ['Mon', 'Monday'],
  ['Tue', 'Tuesday'],
  ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'],
  ['Fri', 'Friday'],
  ['Sat', 'Saturday'],
];
const IMF_FIXDATE_PATTERN = new RegExp(
  '^(?:' + HTTP_SHORT_DAY_PATTERN + '), (\\d{2}) (' + HTTP_MONTH_PATTERN + ') (\\d{4}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$'
);
const RFC850_DATE_PATTERN = new RegExp(
  '^(?:' + HTTP_LONG_DAY_PATTERN + '), (\\d{2})-(' + HTTP_MONTH_PATTERN + ')-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) GMT$'
);
const ASCTIME_DATE_PATTERN = new RegExp(
  '^(?:' +
    HTTP_SHORT_DAY_PATTERN +
    ') (' +
    HTTP_MONTH_PATTERN +
    ') (?:([0-9]{2})| ([0-9])) (\\d{2}):(\\d{2}):(\\d{2}) (\\d{4})$'
);
const DISABLED_MODEL_PREFIXES = ['poolside/laguna'];
const PREFERRED_KILO_MODELS = [NEMOTRON_3_ULTRA_FREE_MODEL, XINGCHEN_XING4_MODEL];
const PREFERRED_OPENROUTER_MODELS = [NEMOTRON_3_ULTRA_FREE_MODEL, XINGCHEN_XING4_MODEL];
const GROQ_FREE_MODEL = 'openai/gpt-oss-120b';
// These router IDs choose a concrete model only after the request may already be billed.
const UNPINNABLE_ROUTER_MODELS = new Set(['openrouter/free', 'openrouter/free:free']);

// Reject unknown override conditions instead of guessing whether a paid price applies.
const PRICING_OVERRIDE_CONDITIONS = new Set(['min_prompt_tokens', 'utc_days', 'utc_end', 'utc_start']);
const NON_PRICE_PRICING_FIELDS = new Set(['discount']);

const GROQ_KEY_DIR = join(homedir(), '.config', 'groq');
const GROQ_KEY_FILE_PATTERN = /^api_key(_.*)?$/;
export const GROQ_KEY_FILE_MAX_BYTES = 256;
export const MAX_GROQ_KEYS = 8;

const GROQ_KEY_PROBE_CACHE = join(homedir(), '.cache', 'ph', 'groq-key-probe.json');
const GROQ_KEY_PROBE_TTL_MS = 60 * 60 * 1000;

async function loadGroqKeyProbeCache() {
  const { readFile } = await import('node:fs/promises');
  try {
    const content = await readFile(GROQ_KEY_PROBE_CACHE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function saveGroqKeyProbeCache(cache) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(GROQ_KEY_PROBE_CACHE.replace(/\/[^/]+$/, ''), { recursive: true });
  await writeFile(GROQ_KEY_PROBE_CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

export function normalizeGroqKeys(groqApiKey, groqApiKeys) {
  const fromExplicit = Array.isArray(groqApiKeys) ? groqApiKeys.filter(Boolean) : [];
  if (fromExplicit.length > 0) return fromExplicit.slice(0, MAX_GROQ_KEYS);
  if (groqApiKey) return [groqApiKey];
  return [];
}

export async function discoverGroqKeyFiles(dir = GROQ_KEY_DIR) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && GROQ_KEY_FILE_PATTERN.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

export async function loadGroqKeyFromFile(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Groq key path is not a regular file');
    if (metadata.size > GROQ_KEY_FILE_MAX_BYTES) {
      throw new Error(`Groq key file exceeds ${GROQ_KEY_FILE_MAX_BYTES} bytes`);
    }
    const buffer = Buffer.alloc(GROQ_KEY_FILE_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const key = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)).trim();
    if (key.length === 0) throw new Error('Groq key file is empty');
    return key;
  } finally {
    await handle.close();
  }
}

export async function probeGroqKey({ fetchImpl = fetch, groqApiKey, timeoutMs = CONTROL_PLANE_TIMEOUT_MS } = {}) {
  if (!groqApiKey) return { ok: false, reason: 'no_key' };
  let response;
  try {
    response = await fetchImpl(GROQ_MODELS, {
      headers: { Authorization: `Bearer ${groqApiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: 'network_error', detail: error.message };
  }
  if (!response.ok) {
    await discardResponseBody(response);
    return { ok: false, reason: `http_${response.status}` };
  }
  try {
    await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, 'Groq catalog');
  } catch (error) {
    return { ok: false, reason: 'parse_error', detail: error.message };
  }
  return { ok: true, reason: 'ok' };
}

export async function probeGroqKeys({
  fetchImpl = fetch,
  keyDir = GROQ_KEY_DIR,
  timeoutMs = CONTROL_PLANE_TIMEOUT_MS,
} = {}) {
  const files = await discoverGroqKeyFiles(keyDir);
  const cache = await loadGroqKeyProbeCache();
  const results = [];
  for (const file of files) {
    const cached = cache[file];
    if (cached && cached.ok && Date.now() - new Date(cached.probedAt).getTime() < GROQ_KEY_PROBE_TTL_MS) {
      results.push({ keyFile: file, ...cached });
      continue;
    }
    let key;
    try {
      key = await loadGroqKeyFromFile(file);
    } catch (error) {
      results.push({ keyFile: file, ok: false, reason: 'file_error', detail: error.message });
      continue;
    }
    const probe = await probeGroqKey({ fetchImpl, groqApiKey: key, timeoutMs });
    const result = { keyFile: file, ...probe, probedAt: new Date().toISOString() };
    results.push(result);
    cache[file] = result;
  }
  await saveGroqKeyProbeCache(cache);
  return results;
}

async function discardResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The response is being abandoned; cancellation failures do not change the decision.
  }
}

async function readBoundedJson(response, maxBytes, label) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('JSON response byte limit must be positive');
  const declaredLength = response.headers?.get?.('content-length');
  if (/^\d+$/.test(declaredLength ?? '') && Number(declaredLength) > maxBytes) {
    await discardResponseBody(response);
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  if (typeof response.body?.getReader !== 'function') throw new Error(`${label} has no readable response body`);

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value)) throw new Error(`${label} stream must contain byte chunks`);
      const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.byteLength > maxBytes - byteLength) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export function zeroPriced(pricing) {
  if (!isExactZero(pricing?.prompt) || !isExactZero(pricing?.completion)) return false;
  if (
    Object.entries(pricing).some(
      ([field, value]) => field !== 'overrides' && !NON_PRICE_PRICING_FIELDS.has(field) && !isExactZero(value)
    )
  ) {
    return false;
  }
  if (pricing.overrides === undefined) return true;
  if (!Array.isArray(pricing.overrides)) return false;
  return pricing.overrides.every(
    (override) =>
      override &&
      typeof override === 'object' &&
      !Array.isArray(override) &&
      Object.entries(override).every(
        ([field, value]) =>
          PRICING_OVERRIDE_CONDITIONS.has(field) || NON_PRICE_PRICING_FIELDS.has(field) || isExactZero(value)
      )
  );
}

function isExactZero(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0;
  // Decimal strings are accepted only when every digit is zero, without float rounding.
  return typeof value === 'string' && /^0+(?:\.0+)?$/.test(value);
}

export function catalogCandidates(source, data, quarantinedKeys = new Set()) {
  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const candidates = rows
    .filter((row) => {
      if (typeof row?.id !== 'string' || row.id.length === 0) return false;
      if (isDisabledFreeModel(row.id, row.name, source)) return false;
      if (DISABLED_MODEL_PREFIXES.some((prefix) => row.id.toLowerCase().startsWith(prefix))) return false;
      if (quarantinedKeys.has(quarantineKey(source, row.id))) return false;
      if (UNPINNABLE_ROUTER_MODELS.has(row.id)) return false;
      // OpenCode's catalog has no price fields; only provider-owned -free IDs qualify.
      if (source === 'opencode') {
        return row.owned_by === 'opencode' && row.id.endsWith('-free');
      }
      // Groq's model catalog does not expose pricing. Routing is additionally
      // gated by an explicit free-plan opt-in before this catalog is requested.
      if (source === 'groq') return row.id === GROQ_FREE_MODEL;
      if (!zeroPriced(row.pricing)) return false;
      if (source === 'openrouter') return row.id.endsWith(':free');
      return source === 'kilo' && (row.isFree === true || row.id.endsWith(':free'));
    })
    .map((row) => ({ source, model: row.id, name: row.name ?? row.id }));
  if (source !== 'kilo' && source !== 'openrouter') return candidates;
  const preferredModels = source === 'kilo' ? PREFERRED_KILO_MODELS : PREFERRED_OPENROUTER_MODELS;
  const preference = new Map(preferredModels.map((model, index) => [model, index]));
  return candidates.sort(
    (left, right) =>
      (preference.get(left.model) ?? Number.MAX_SAFE_INTEGER) - (preference.get(right.model) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function orderFreeModelRoutes(candidates) {
  const fallback = candidates.filter(
    (candidate) =>
      !isDisabledFreeModel(candidate.model, candidate.name, candidate.source) && candidate.source !== 'kilo'
  );
  return [
    ...fallback.filter((candidate) => candidate.source === 'openrouter'),
    ...fallback.filter((candidate) => candidate.source === 'opencode'),
    ...fallback.filter((candidate) => candidate.source === 'groq'),
  ];
}

export async function loadCatalogs({
  fetchImpl = fetch,
  openRouterKey = process.env.OPENROUTER_API_KEY,
  groqApiKey = process.env.GROQ_API_KEY,
  groqApiKeys = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [],
  includeOpenRouterCatalog = false,
  includeGroq = false,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  initializeLegacyQuarantine = false,
  onCatalogError = () => {},
} = {}) {
  const groqKeys = normalizeGroqKeys(groqApiKey, groqApiKeys);
  const quarantineState = initializeLegacyQuarantine
    ? await loadQuarantineState(quarantineFile)
    : await readQuarantineState(quarantineFile);
  const quarantinedKeys = activeQuarantineKeys(quarantineState);
  const sources = [
    { source: 'opencode', url: OPENCODE_MODELS },
    { source: 'kilo', url: KILO_MODELS },
  ];
  if (openRouterKey || includeOpenRouterCatalog) sources.push({ source: 'openrouter', url: OPENROUTER_MODELS });
  if (groqKeys.length > 0 || includeGroq) sources.push({ source: 'groq', url: GROQ_MODELS, groqKeys });
  const results = await Promise.allSettled(
    sources.map(async ({ source, url, groqKeys: sourceGroqKeys }) => {
      const headers = {};
      if (source === 'openrouter' && openRouterKey) headers.Authorization = `Bearer ${openRouterKey}`;
      if (source === 'groq' && sourceGroqKeys && sourceGroqKeys.length > 0) {
        let groqResponse;
        let lastGroqError = '';
        for (const key of sourceGroqKeys) {
          try {
            const attempt = await fetchImpl(url, {
              headers: { Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
            });
            if (attempt.ok) {
              groqResponse = attempt;
              break;
            }
            await discardResponseBody(attempt);
            lastGroqError = `HTTP ${attempt.status}`;
          } catch (error) {
            lastGroqError = error.message;
          }
        }
        if (!groqResponse) throw new Error(`groq catalog failed for all keys: ${lastGroqError}`);
        return catalogCandidates(
          source,
          await readBoundedJson(groqResponse, MAX_CATALOG_RESPONSE_BYTES, `${source} catalog`),
          quarantinedKeys
        );
      }
      if (source === 'groq' && (!sourceGroqKeys || sourceGroqKeys.length === 0)) {
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS) });
        if (!response.ok) {
          await discardResponseBody(response);
          throw new Error(`${source} catalog returned HTTP ${response.status}`);
        }
        return catalogCandidates(
          source,
          await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, `${source} catalog`),
          quarantinedKeys
        );
      }
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS) });
      if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(`${source} catalog returned HTTP ${response.status}`);
      }
      return catalogCandidates(
        source,
        await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, `${source} catalog`),
        quarantinedKeys
      );
    })
  );
  const candidates = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    onCatalogError(sources[index].source, result.reason);
    return [];
  });
  return candidates;
}

export async function probeOpenRouterQuota({
  fetchImpl = fetch,
  openRouterKey,
  timeoutMs = CONTROL_PLANE_TIMEOUT_MS,
} = {}) {
  if (!openRouterKey) return { remaining: null, limit: null, used: null, reason: 'no_key' };
  let response;
  try {
    response = await fetchImpl(OPENROUTER_KEY_INFO, {
      headers: { Authorization: `Bearer ${openRouterKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { remaining: null, limit: null, used: null, reason: 'network_error', detail: error.message };
  }
  if (!response.ok) {
    await discardResponseBody(response);
    return { remaining: null, limit: null, used: null, reason: `http_${response.status}` };
  }
  let payload;
  try {
    payload = await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, 'OpenRouter key info');
  } catch (error) {
    return { remaining: null, limit: null, used: null, reason: 'parse_error', detail: error.message };
  }
  const info = payload?.data?.free_model_daily_requests;
  if (
    !info ||
    !Number.isSafeInteger(info.remaining) ||
    info.remaining < 0 ||
    !Number.isSafeInteger(info.limit) ||
    info.limit < 1 ||
    !Number.isSafeInteger(info.used) ||
    info.used < 0
  ) {
    return { remaining: null, limit: null, used: null, reason: 'invalid_payload' };
  }
  return { remaining: info.remaining, limit: info.limit, used: info.used, reason: 'ok' };
}

function retryAfterHint(response) {
  return response?.headers
    ?.get?.('retry-after')
    ?.replace(/[\r\n]/g, ' ')
    .slice(0, 100);
}

function utcHttpDateTimestamp(year, monthName, day, hour, minute, second) {
  const month = HTTP_DATE_MONTHS.indexOf(monthName);
  if (month < 0 || second > 60 || (second === 60 && (hour !== 23 || minute !== 59))) return null;

  const normalizedSecond = Math.min(second, 59);
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, normalizedSecond, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== normalizedSecond
  ) {
    return null;
  }
  return date.getTime() + (second === 60 ? 1000 : 0);
}

function httpDateWeekdayMatches(value, timestamp, second) {
  if (!Number.isFinite(timestamp)) return false;
  const commaIndex = value.indexOf(',');
  const spaceIndex = value.indexOf(' ');
  const weekday = value.slice(0, commaIndex >= 0 ? commaIndex : spaceIndex);
  const dateTimestamp = timestamp - (second === 60 ? 1000 : 0);
  return HTTP_WEEKDAY_NAMES[new Date(dateTimestamp).getUTCDay()]?.includes(weekday) ?? false;
}

function parseHttpDateTimestamp(value, now) {
  let match = value.match(IMF_FIXDATE_PATTERN);
  if (match) {
    const timestamp = utcHttpDateTimestamp(
      Number(match[3]),
      match[2],
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    );
    return httpDateWeekdayMatches(match[0], timestamp, Number(match[6])) ? timestamp : null;
  }

  match = value.match(RFC850_DATE_PATTERN);
  if (match) {
    const currentYear = new Date(now).getUTCFullYear();
    const year = Math.floor(currentYear / 100) * 100 + Number(match[3]);
    const dateParts = [match[2], Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])];
    let retryAt = utcHttpDateTimestamp(year, ...dateParts);
    if (!Number.isFinite(retryAt)) return null;

    const fiftyYearsLater = new Date(now);
    fiftyYearsLater.setUTCFullYear(currentYear + 50);
    if (retryAt > fiftyYearsLater.getTime()) retryAt = utcHttpDateTimestamp(year - 100, ...dateParts);
    return httpDateWeekdayMatches(match[0], retryAt, dateParts[4]) ? retryAt : null;
  }

  match = value.match(ASCTIME_DATE_PATTERN);
  if (match) {
    const timestamp = utcHttpDateTimestamp(
      Number(match[7]),
      match[1],
      Number(match[2] ?? match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    );
    return httpDateWeekdayMatches(match[0], timestamp, Number(match[6])) ? timestamp : null;
  }

  return undefined;
}

export function retryAfterDelayMs(response, now = Date.now()) {
  const value = response?.headers?.get?.('retry-after')?.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const delayMs = seconds * 1000;
    return Number.isSafeInteger(delayMs) ? delayMs : Number.MAX_SAFE_INTEGER;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;

  const retryAt = parseHttpDateTimestamp(value, now);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

function failureReason(response, payload) {
  const choiceError = Array.isArray(payload?.choices) ? payload.choices.find((choice) => choice?.error)?.error : null;
  const message = payload?.error?.message ?? choiceError?.message ?? payload?.message ?? '';
  const retryAfter = retryAfterHint(response);
  return `${response.status}${message ? `: ${message}` : ''}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`;
}

function openRouterPlatformRemaining(response) {
  const value = response?.headers?.get?.('x-ratelimit-remaining');
  if (typeof value !== 'string' || value.trim() === '') return null;
  const remaining = Number(value);
  return Number.isFinite(remaining) && remaining >= 0 ? remaining : null;
}

function responseErrorObjects(payload) {
  const choiceErrors = Array.isArray(payload?.choices) ? payload.choices.map((choice) => choice?.error) : [];
  return [payload?.error, ...choiceErrors].filter(
    (error) => error && typeof error === 'object' && !Array.isArray(error)
  );
}

function normalizedOpenRouterErrorTypes(payload) {
  return responseErrorObjects(payload)
    .map((error) => error?.metadata?.error_type)
    .filter((errorType) => typeof errorType === 'string')
    .map((errorType) => errorType.trim().toLowerCase().replaceAll('-', '_'));
}

const OPENROUTER_TRANSIENT_ERROR_TYPES = new Set([
  'rate_limit_exceeded',
  'provider_overloaded',
  'provider_unavailable',
  'timeout',
]);
const OPENROUTER_TYPED_UPSTREAM_ERROR_TYPES = new Set(['provider_overloaded', 'provider_unavailable', 'timeout']);

function hasTransientOpenRouterProviderError(payload) {
  return normalizedOpenRouterErrorTypes(payload).some((errorType) => OPENROUTER_TRANSIENT_ERROR_TYPES.has(errorType));
}

function hasOpenRouterRateLimitError(payload) {
  return normalizedOpenRouterErrorTypes(payload).includes('rate_limit_exceeded');
}

function hasTypedOpenRouterUpstreamError(payload) {
  return normalizedOpenRouterErrorTypes(payload).some((errorType) =>
    OPENROUTER_TYPED_UPSTREAM_ERROR_TYPES.has(errorType)
  );
}

function hasUpstreamProviderMetadata(payload) {
  const metadata = responseErrorObjects(payload).map((error) => error.metadata);
  return metadata.some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      (entry.provider_name || entry.provider || entry.upstream_provider || entry.provider_code)
  );
}

function isOpenRouterDailyQuotaError(payload) {
  const errors = responseErrorObjects(payload);
  const code = errors
    .map((error) => error.code ?? error.type ?? '')
    .join(' ')
    .toLowerCase();
  const message = [...errors.map((error) => error.message), payload?.message].join(' ').toLowerCase();
  return (
    /free[-_ ]models[-_ ]per[-_ ]day|daily[-_ ]quota|daily.*limit/.test(code) ||
    /free model.*daily|daily.*free model|quota.*exhaust|daily.*limit/.test(message)
  );
}

function isModelAttributableOpenRouterFailure(response, payload) {
  const status = response?.status;
  if (isOpenRouterDailyQuotaError(payload)) return false;
  if (status === 200 && hasTransientOpenRouterProviderError(payload)) return true;
  if (!Number.isInteger(status) || status < 400 || status > 599 || status === 401 || status === 402) return false;
  if (status === 429) {
    const remaining = openRouterPlatformRemaining(response);
    if (remaining !== null) return remaining > 0;
    return hasUpstreamProviderMetadata(payload) || hasTransientOpenRouterProviderError(payload);
  }
  return status >= 500 && (hasUpstreamProviderMetadata(payload) || hasTypedOpenRouterUpstreamError(payload));
}

function retryAfterValueDelayMs(value, now = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return retryAfterDelayMs({ headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? value : null) } }, now);
}

function retryAfterMillisecondsValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const milliseconds = Number(value.trim());
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function openCodeHeaderValue(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  const fromGetter = typeof headers.get === 'function' ? headers.get(name) : undefined;
  if (fromGetter !== undefined && fromGetter !== null) return fromGetter;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

function openCodeRetryDelayMs(metadata) {
  const delays = [
    retryAfterMillisecondsValue(metadata.retryAfterMs),
    retryAfterValueDelayMs(metadata.retryAfter),
  ].filter((delay) => delay !== null);
  return delays.length > 0 ? Math.max(...delays) : null;
}

function isExactZeroCost(cost) {
  if (typeof cost === 'number') return Number.isFinite(cost) && cost === 0;
  return typeof cost === 'string' && /^0+(?:\.0+)?$/.test(cost.trim());
}

function openCodeReportedCosts(events) {
  return events.flatMap((event) =>
    [event?.part?.cost, event?.cost, event?.error?.cost].filter((cost) => cost !== undefined && cost !== null)
  );
}

function openCodeErrorMetadata(value) {
  if (!value || typeof value !== 'object') return {};
  const metadata = value.error && typeof value.error === 'object' ? value.error : value;
  const errorTypes = [
    metadata.type,
    metadata.code,
    metadata.errorType,
    value.errorType,
    value.error,
    value.type,
    value.code,
  ].filter((entry) => typeof entry === 'string');
  const errorType = errorTypes[0];
  const rawStatus = metadata.status ?? metadata.statusCode ?? value.status ?? value.statusCode;
  const status =
    Number.isInteger(Number(rawStatus)) && Number(rawStatus) >= 100 && Number(rawStatus) <= 599
      ? Number(rawStatus)
      : null;
  const headerSources = [metadata.responseHeaders, value.responseHeaders, metadata.headers, value.headers];
  const retryAfter =
    metadata.retryAfter ??
    metadata.retry_after ??
    value.retryAfter ??
    value.retry_after ??
    headerSources.map((headers) => openCodeHeaderValue(headers, 'retry-after')).find((entry) => entry != null) ??
    null;
  const retryAfterMsValues = [
    metadata.retryAfterMs,
    metadata.retry_after_ms,
    metadata['retry-after-ms'],
    value.retryAfterMs,
    value.retry_after_ms,
    value['retry-after-ms'],
    ...headerSources.map((headers) => openCodeHeaderValue(headers, 'retry-after-ms')),
  ]
    .map(retryAfterMillisecondsValue)
    .filter((delay) => delay !== null);
  const normalizedRetryAfter = typeof retryAfter === 'string' ? retryAfter : null;
  const retryAfterDelays = [...retryAfterMsValues, retryAfterValueDelayMs(normalizedRetryAfter)].filter(
    (delay) => delay !== null
  );
  const message = String(metadata.message ?? value.message ?? (typeof value.error === 'string' ? value.error : ''));
  const normalizedTypes = errorTypes.map((type) => type.trim().toLowerCase());
  return {
    errorType: errorType ?? null,
    status,
    retryAfter: normalizedRetryAfter,
    retryAfterMs: retryAfterDelays.length > 0 ? Math.max(...retryAfterDelays) : null,
    accountQuota:
      metadata.accountQuota === true ||
      value.accountQuota === true ||
      normalizedTypes.some((type) => type === 'provider.free-limit' || /(?:^|[._])freeusagelimiterror$/.test(type)),
    modelAttributable:
      metadata.modelAttributable === true ||
      value.modelAttributable === true ||
      normalizedTypes.some((type) => /(?:^|[._-])model(?:[._-]|$)/i.test(type)),
    contentPolicyRejected:
      metadata.contentPolicyRejected === true ||
      value.contentPolicyRejected === true ||
      normalizedTypes.some((type) =>
        CONTENT_POLICY_ERROR_CODES.has(type.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
      ) ||
      CONTENT_POLICY_ERROR_PATTERNS.some((pattern) => pattern.test(message)),
  };
}

function openCodeCompletionFailureMetadata(events) {
  const errors = events.filter((event) => event?.type === 'error').map(openCodeErrorMetadata);
  const contentFilterTerminal = events.some(
    (event) =>
      event?.type === 'step_finish' &&
      String(event.part?.reason ?? '')
        .toLowerCase()
        .replaceAll('_', '-') === 'content-filter'
  );
  if (contentFilterTerminal) {
    errors.unshift({
      errorType: 'content_filter',
      status: null,
      retryAfter: null,
      accountQuota: false,
      modelAttributable: false,
      contentPolicyRejected: true,
    });
  }
  if (errors.length === 0) return {};

  // Preserve policy and source-wide stops first, then metadata needed to retry a model-attributable 429.
  const primary =
    errors.find((metadata) => metadata.contentPolicyRejected) ??
    errors.find((metadata) => metadata.accountQuota) ??
    errors.find((metadata) => metadata.modelAttributable && metadata.status === 429) ??
    errors.find((metadata) => metadata.modelAttributable && Number.isInteger(metadata.status)) ??
    errors[0];
  const modelRateLimits = errors.filter(
    (metadata) => metadata.modelAttributable && metadata.status === 429 && !metadata.accountQuota
  );
  const retryDelays = modelRateLimits.map(openCodeRetryDelayMs).filter((delay) => delay !== null);
  return {
    ...primary,
    ...(modelRateLimits.length > 0 && retryDelays.length > 0 ? { retryAfterMs: Math.max(...retryDelays) } : {}),
    accountQuota: errors.some((metadata) => metadata.accountQuota),
    contentPolicyRejected: errors.some((metadata) => metadata.contentPolicyRejected),
  };
}

function isPerKeyFailure(status) {
  return status === 401 || status === 402 || status === 429;
}

const CONTENT_POLICY_ERROR_CODES = new Set([
  'content_filter',
  'content_filter_blocked',
  'content_filter_violation',
  'content_policy_blocked',
  'content_policy_violation',
  'moderation_blocked',
  'moderation_rejected',
  'prompt_injection_detected',
  'refusal',
  'safety_filter',
  'safety_violation',
]);

const CONTENT_POLICY_ERROR_PATTERNS = [
  /flagged as potentially violating/i,
  /(?:content|safety) filter (?:was |has been )?(?:triggered|blocked|rejected|flagged)/i,
  /(?:content|safety|usage) policy (?:violation|blocked|rejected|flagged)/i,
  /prompt (?:injection )?patterns? detected/i,
  /prompt (?:was |is )?(?:flagged|rejected|blocked|not allowed)/i,
  /(?:request|content) (?:was |is )?(?:blocked|rejected) by (?:the )?(?:content|safety|moderation) (?:filter|policy)/i,
  /moderation (?:flagged|blocked|rejected|detected)/i,
  /content failed moderation/i,
  /violates? (?:our |the )?(?:content|safety|usage) policy/i,
];

function hasFilteredContent(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  return Object.values(result).some((category) => category?.filtered === true);
}

export function isContentPolicyError(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.contentPolicyRejected === true) return true;

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  if (
    choices.some(
      (choice) =>
        String(choice?.finish_reason ?? '').toLowerCase() === 'content_filter' ||
        hasFilteredContent(choice?.content_filter_results)
    )
  ) {
    return true;
  }
  if (Array.isArray(payload.prompt_filter_results)) {
    if (payload.prompt_filter_results.some((result) => hasFilteredContent(result?.content_filter_results))) return true;
  }

  const errors = responseErrorObjects(payload);
  const codes = [
    ...errors.flatMap((error) => [error.code, error.type, error.metadata?.error_type]),
    payload.code,
    payload.type,
    payload.errorType,
  ];
  if (
    codes.some(
      (code) =>
        typeof code === 'string' && CONTENT_POLICY_ERROR_CODES.has(code.trim().toLowerCase().replaceAll('-', '_'))
    )
  ) {
    return true;
  }

  const messages = [...errors.map((error) => error.message), payload.message].filter(
    (message) => typeof message === 'string'
  );
  return CONTENT_POLICY_ERROR_PATTERNS.some((pattern) => messages.some((message) => pattern.test(message)));
}

function hasReportedNonZeroCost(usage) {
  if (usage === undefined || usage === null) return false;
  if (typeof usage !== 'object' || Array.isArray(usage)) return true;

  const inspect = (value, key = '', insideCostField = false) => {
    const inCostField = insideCostField || /cost/i.test(key);
    if (value === undefined) return false;
    if (value === null) return false;
    if (typeof value === 'number' || typeof value === 'string') {
      if (!inCostField) return false;
      if (typeof value === 'string' && value.trim() === '') return true;
      const amount = Number(value);
      return !Number.isFinite(amount) || amount !== 0;
    }
    if (typeof value === 'boolean') return inCostField;
    if (Array.isArray(value)) return inCostField || value.some((entry) => inspect(entry, '', false));
    if (typeof value !== 'object') return inCostField;
    return Object.entries(value).some(([childKey, child]) => inspect(child, childKey, inCostField));
  };

  return inspect(usage);
}

async function quarantineReportedCost(source, model, quarantineFile) {
  if (isOperatorOnlyQuarantine(source, model)) return;
  await withQuarantineWriteLock(quarantineFile, async (saveState) => {
    const state = await loadQuarantineStateLocked(quarantineFile);
    upsertQuarantine(state, {
      source,
      model,
      reason: 'non_zero_cost',
      hours: MAX_QUARANTINE_HOURS,
    });
    await saveState(state);
  });
}

export async function readBoundedPrompt(path) {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Prompt must be a regular file');
    if (metadata.size > MAX_PROMPT_FILE_BYTES)
      throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    const buffer = Buffer.alloc(MAX_PROMPT_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PROMPT_FILE_BYTES) throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

const OPENCODE_TOOL_DENY_CONFIG = JSON.stringify({
  // V1 keys remain accepted for users on the current CLI and cover all built-ins.
  tools: {
    read: false,
    edit: false,
    bash: false,
    task: false,
    glob: false,
    grep: false,
    write: false,
    patch: false,
    webfetch: false,
    websearch: false,
    question: false,
    skill: false,
    lsp: false,
  },
  permission: {
    read: 'deny',
    edit: 'deny',
    bash: 'deny',
    task: 'deny',
    glob: 'deny',
    grep: 'deny',
    write: 'deny',
    patch: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    question: 'deny',
    skill: 'deny',
    lsp: 'deny',
  },
  // V2 policies are hard denies and take precedence over saved approvals.
  policies: [{ action: 'tool.use', resource: '*', effect: 'deny' }],
});

export async function runOpenCodeCompletion({
  command = 'opencode',
  model,
  prompt,
  maxTokens = 1200,
  timeoutMs = COMPLETION_TIMEOUT_MS,
}) {
  if (isDisabledFreeModel(model, '', 'opencode')) {
    return { error: 'Nemotron model/provider pair is not approved by free-model policy' };
  }
  if (typeof model !== 'string' || !/^[A-Za-z0-9._/-]+-free$/.test(model)) {
    return { error: 'OpenCode model is not an eligible free catalog ID' };
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_COMPLETION_TOKENS) {
    return { error: 'Invalid token limit' };
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_OPENCODE_TIMEOUT_MS) {
    return { error: 'Invalid OpenCode timeout' };
  }
  const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-'));
  const promptPath = join(directory, 'request.txt');
  try {
    await writeFile(promptPath, prompt, { encoding: 'utf8', mode: 0o600 });
    const env = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: OPENCODE_TOOL_DENY_CONFIG,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_DISABLE_PRUNE: '1',
    };
    const events = await new Promise((resolve, reject) => {
      const args = [
        '--standalone',
        'run',
        '--format',
        'json',
        '--model',
        `opencode/${model}`,
        '--file',
        promptPath,
        `Answer the attached request concisely (about ${maxTokens} tokens or fewer). Do not use tools.`,
      ];
      const commandShim = resolveCommandShim(command, args, { env, cwd: directory });
      const child = spawn(commandShim.command, commandShim.args, {
        cwd: directory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        ...commandShim.spawnOptions,
      });
      const chunks = [];
      let outputBytes = 0;
      let stopping = false;
      let timedOut = false;
      let outputExceeded = false;
      let terminationError = null;
      let killTimer;
      let killPromise = Promise.resolve();
      const stopChild = () => {
        if (stopping) return killPromise;
        stopping = true;
        clearTimeout(timer);
        if (process.platform === 'win32') {
          killPromise = terminateWindowsProcessTree(child.pid).catch((error) => {
            terminationError = error;
            try {
              child.kill('SIGKILL');
            } catch {}
            clearTimeout(timer);
            reject(new Error(`OpenCode process termination failed: ${terminationError.message}`));
          });
          return killPromise;
        }
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch (error) {
          if (error?.code !== 'ESRCH') terminationError = error;
        }
        killPromise = new Promise((resolveKill) => {
          killTimer = setTimeout(() => {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch (error) {
              if (error?.code !== 'ESRCH') terminationError = error;
            }
            resolveKill();
          }, 2_000);
        });
        return killPromise;
      };
      const timer = setTimeout(() => {
        timedOut = true;
        void stopChild();
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        const capturedBytes = Math.max(0, MAX_OPENCODE_OUTPUT_BYTES - outputBytes);
        if (capturedBytes > 0) {
          chunks.push(capturedBytes >= chunk.byteLength ? chunk : Buffer.from(chunk.subarray(0, capturedBytes)));
        }
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OPENCODE_OUTPUT_BYTES && !outputExceeded) {
          outputExceeded = true;
          void stopChild();
        }
      });
      child.stderr.on('data', () => {});
      child.once('error', (error) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        void (async () => {
          if (stopping) await killPromise;
          clearTimeout(killTimer);
          const parsed = [];
          let malformedJsonl = false;
          for (const line of Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean)) {
            try {
              const event = JSON.parse(line);
              if (event && typeof event === 'object' && !Array.isArray(event)) parsed.push(event);
              else malformedJsonl = true;
            } catch {
              malformedJsonl = true;
            }
          }
          const metadata = openCodeCompletionFailureMetadata(parsed);
          const reportedCosts = openCodeReportedCosts(parsed);
          const processFailure = terminationError
            ? `OpenCode process termination failed: ${terminationError.message}`
            : timedOut
              ? `OpenCode timed out after ${timeoutMs}ms`
              : outputExceeded
                ? `OpenCode output exceeded ${MAX_OPENCODE_OUTPUT_BYTES} bytes`
                : malformedJsonl
                  ? 'OpenCode returned malformed JSONL output'
                  : null;
          if ((processFailure || code !== 0) && reportedCosts.some((cost) => !isExactZeroCost(cost))) {
            const error = new Error('OpenCode reported non-zero or invalid cost');
            error.safetyStop = true;
            error.reportedCost = true;
            throw error;
          }
          if (processFailure) {
            if (Object.keys(metadata).length > 0) {
              const error = new Error(processFailure);
              Object.assign(error, metadata);
              throw error;
            }
            throw new Error(processFailure);
          }
          if (code !== 0) {
            const type =
              typeof metadata.errorType === 'string' && /^[a-z0-9._-]+$/i.test(metadata.errorType)
                ? metadata.errorType
                : '';
            const status = metadata.status;
            const statusText = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : '';
            const error = new Error(`OpenCode exited ${code ?? signal}${type ? `: ${type}${statusText}` : ''}`);
            Object.assign(error, metadata);
            throw error;
          }
          return parsed;
        })().then(resolve, reject);
      });
    });
    const reportedCosts = openCodeReportedCosts(events);
    if (reportedCosts.some((cost) => !isExactZeroCost(cost))) {
      return { error: 'OpenCode reported non-zero or invalid cost', safetyStop: true };
    }
    const errorMetadata = openCodeCompletionFailureMetadata(events);
    if (Object.keys(errorMetadata).length > 0) {
      return {
        error: 'OpenCode reported a provider completion error',
        ...errorMetadata,
      };
    }
    if (
      events.some(
        (event) =>
          event.type === 'tool_use' ||
          (event.type === 'done' && Array.isArray(event.rejected) && event.rejected.length > 0)
      )
    ) {
      return { error: 'OpenCode reported an error or attempted a tool call' };
    }
    const explicitTerminal = events.some(
      (event) => event.type === 'done' || (event.type === 'step_finish' && event.part?.reason === 'stop')
    );
    // OpenCode V2 can exit cleanly after final text without emitting its final step_finish event.
    const cleanFreeTextExit =
      model.endsWith('-free') && events.some((event) => event.type === 'text' && event.part?.text?.trim());
    const terminal = explicitTerminal || cleanFreeTextExit;
    const content = events
      .filter((event) => event.type === 'text' && typeof event.part?.text === 'string')
      .map((event) => event.part.text)
      .join('');
    const finishedSteps = events.filter((event) => event.type === 'step_finish');
    if (!terminal || !content.trim()) return { error: 'OpenCode did not return a complete non-empty response' };
    const tokens = finishedSteps.at(-1)?.part?.tokens;
    return {
      model,
      content,
      finishReason: 'stop',
      usage: tokens
        ? {
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            reasoning_tokens: tokens.reasoning,
            ...(reportedCosts.length > 0
              ? { cost: reportedCosts.reduce((total, cost) => total + Number(cost), 0) }
              : {}),
          }
        : null,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function completeWithFreeModel(prompt, options = {}) {
  const {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqApiKeys = process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [],
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    kiloCommand,
    runKilo = runKiloCompletion,
    opencodeCommand = process.env.OPENCODE_CLI ?? 'opencode',
    runOpenCode = runOpenCodeCompletion,
    maxTokens = DEFAULT_MAX_TOKENS,
    waitForRetryAfter = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    quarantineFile = DEFAULT_QUARANTINE_FILE,
    poolStateFile: requestedPoolStateFile,
    initializeLegacyQuarantine = true,
    onCatalogError = () => {},
    onOpenRouterQuota = () => {},
    stderr = { write: () => {} },
  } = options;
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt must contain 1 to ${MAX_PROMPT_CHARS} characters`);
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_COMPLETION_TOKENS) {
    throw new Error(`maxTokens must be an integer from 1 to ${MAX_COMPLETION_TOKENS}`);
  }
  const effectiveKiloCommand = kiloCommand === '' ? '' : (kiloCommand ?? (await resolveKiloCli()));
  const groqKeys = normalizeGroqKeys(groqApiKey, groqApiKeys);
  const available = orderFreeModelRoutes(
    await loadCatalogs({
      fetchImpl,
      openRouterKey,
      groqApiKey: groqFreePlan ? groqKeys[0] : '',
      groqApiKeys: groqFreePlan ? groqKeys : [],
      quarantineFile,
      initializeLegacyQuarantine,
      onCatalogError,
    })
  );
  const poolStateFile =
    requestedPoolStateFile ??
    (quarantineFile === DEFAULT_QUARANTINE_FILE ? DEFAULT_POOL_STATE_FILE : `${quarantineFile}.pool-state.json`);
  const exhausted = new Set();
  const exhaustedGroqKeys = new Set();
  const attempts = new Map();
  const errors = [];

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (available.some((entry) => entry.source === 'kilo') && !effectiveKiloCommand) {
    exhausted.add('kilo');
    errors.push('kilo: Kilo CLI not found; install the Kilo Code extension or set KILO_CLI');
  }
  const kiloCooldownUntil = await getKiloCooldownUntil({ stateFile: poolStateFile });
  if (kiloCooldownUntil !== null && available.some((entry) => entry.source === 'kilo')) {
    exhausted.add('kilo');
    stderr.write(
      `Kilo is cooling down after HTTP 429 until ${new Date(kiloCooldownUntil).toISOString()}; skipping this run.\n`
    );
  }
  const requestCounts = () => {
    const counts = {
      kilo: attempts.get('kilo') ?? 0,
      openrouter: attempts.get('openrouter') ?? 0,
    };
    for (const source of ['opencode', 'groq']) {
      if (attempts.has(source)) counts[source] = attempts.get(source);
    }
    return counts;
  };
  const stopForReportedCost = async (candidate, detail = 'provider reported non-zero or invalid completion cost') => {
    const quarantineNote = isOperatorOnlyQuarantine(candidate.source, candidate.model)
      ? '; quarantine is operator-managed'
      : '';
    const message = `${candidate.source}/${candidate.model}: ${detail}${quarantineNote}; refusing further requests. Requests attempted: ${JSON.stringify(requestCounts())}`;
    try {
      await quarantineReportedCost(candidate.source, candidate.model, quarantineFile);
    } catch (error) {
      const failure = new Error(`${message} Persistent quarantine failed: ${error.message}`, { cause: error });
      failure.safetyStop = true;
      failure.costSafetyStopHandled = true;
      throw failure;
    }
    const error = new Error(message);
    error.safetyStop = true;
    error.costSafetyStopHandled = true;
    throw error;
  };
  const stopForContentPolicy = (candidate) => {
    const error = new Error(
      `${candidate.source}/${candidate.model}: provider content policy rejected or filtered this request. Requests attempted: ${JSON.stringify(requestCounts())}`
    );
    error.contentPolicyRejected = true;
    throw error;
  };
  const recordModelFailureSafely = async (options) => {
    try {
      return await recordModelFailure({ ...options, stateFile: poolStateFile, quarantineFile });
    } catch (error) {
      const failure = new Error(`Could not persist ${options.source} model failure state: ${error.message}`, {
        cause: error,
      });
      failure.safetyStop = true;
      throw failure;
    }
  };
  const recordAttributableFailure = async (candidate, failure, { include429 = false } = {}) => {
    if (
      failure?.modelAttributable !== true ||
      !Number.isInteger(failure.status) ||
      failure.status === 401 ||
      failure.status === 402 ||
      (failure.status === 429 && !include429) ||
      failure.accountQuota === true
    ) {
      return null;
    }
    const recorded = await recordModelFailureSafely({ source: candidate.source, model: candidate.model });
    if (recorded.quarantineHours !== null) {
      stderr.write(
        `${candidate.source} model ${candidate.model} was quarantined for ${recorded.quarantineHours} hours after attributable failures.\n`
      );
    }
    return recorded;
  };
  const persistKiloRateLimit = async () => {
    try {
      await markKiloRateLimited({ stateFile: poolStateFile, quarantineFile });
      exhausted.add('kilo');
    } catch (error) {
      const failure = new Error(`Could not persist Kilo HTTP 429 cooldown: ${error.message}`, { cause: error });
      failure.safetyStop = true;
      throw failure;
    }
  };
  let openRouterQuotaChecked = false;
  let openRouterQuotaKnownPositive = false;
  let openRouterQuotaInitiallyUnknown = false;
  let openRouterRetryUsed = false;
  const ensureOpenRouterAvailable = async () => {
    if (exhausted.has('openrouter')) return false;
    if (!openRouterQuotaChecked) {
      openRouterQuotaChecked = true;
      if (await isOpenRouterQuotaExhaustedToday({ stateFile: poolStateFile })) {
        exhausted.add('openrouter');
        stderr.write('OpenRouter daily free-model quota was exhausted earlier today; skipping this run.\n');
        return false;
      }
      const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
      if (quota.reason === 'ok') {
        onOpenRouterQuota(quota);
        if (quota.remaining <= 0 || quota.used >= quota.limit) {
          await markOpenRouterQuotaExhausted({ stateFile: poolStateFile, quarantineFile });
          exhausted.add('openrouter');
          stderr.write('OpenRouter daily free-model quota is exhausted; skipping this run.\n');
          return false;
        }
        openRouterQuotaKnownPositive = true;
      } else if (quota.reason === 'http_401' || quota.reason === 'http_402') {
        exhausted.add('openrouter');
        stderr.write(`OpenRouter quota endpoint returned ${quota.reason}; skipping OpenRouter for this run.\n`);
        return false;
      } else {
        openRouterQuotaInitiallyUnknown = true;
        stderr.write(
          `OpenRouter quota unknown (${quota.reason}${quota.detail ? `: ${quota.detail}` : ''}); allowing at most one inference attempt.\n`
        );
      }
    }
    return !exhausted.has('openrouter');
  };
  let openRouterQuotaCheckedAfterAttempt = 0;
  const refreshOpenRouterQuotaAfterAttempt = async () => {
    const openRouterAttempts = attempts.get('openrouter') ?? 0;
    if (openRouterAttempts <= openRouterQuotaCheckedAfterAttempt) {
      return openRouterQuotaKnownPositive && !exhausted.has('openrouter');
    }
    openRouterQuotaCheckedAfterAttempt = openRouterAttempts;
    openRouterQuotaKnownPositive = false;
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
    if (quota.reason === 'ok') {
      onOpenRouterQuota(quota);
      if (quota.remaining <= 0 || quota.used >= quota.limit) {
        await markOpenRouterQuotaExhausted({ stateFile: poolStateFile, quarantineFile });
        exhausted.add('openrouter');
        stderr.write('OpenRouter daily free-model quota is exhausted; skipping remaining OpenRouter routes.\n');
      } else {
        openRouterQuotaKnownPositive = true;
      }
    } else if (quota.reason === 'http_401' || quota.reason === 'http_402') {
      exhausted.add('openrouter');
      stderr.write(`OpenRouter quota endpoint returned ${quota.reason} after an attempt; skipping remaining routes.\n`);
    } else {
      const detail = quota.detail ? `: ${sanitizeErrorMessage(quota.detail)}` : '';
      stderr.write(`OpenRouter quota refresh unknown (${quota.reason}${detail}); skipping remaining routes.\n`);
    }
    if (openRouterQuotaInitiallyUnknown || !openRouterQuotaKnownPositive) exhausted.add('openrouter');
    return openRouterQuotaKnownPositive && !exhausted.has('openrouter');
  };
  const handleOpenRouterFailure = async ({ candidate, response, payload, quotaWasPositive, retryAttempt }) => {
    const status = response?.status;
    const transientServerFailure = Number.isInteger(status) && status >= 500 && status <= 599;
    const transientTypedFailure = status === 200 && hasTransientOpenRouterProviderError(payload);
    if (status === 401 || status === 402) {
      exhausted.add('openrouter');
      return { retry: false };
    }
    const attributed = isModelAttributableOpenRouterFailure(response, payload);
    let failureResult = null;
    if (attributed) {
      try {
        failureResult = await recordModelFailureSafely({
          source: 'openrouter',
          model: candidate.model,
          rateLimit: status === 429 || hasOpenRouterRateLimitError(payload),
        });
      } catch (error) {
        throw error;
      }
      if (failureResult.quarantineHours !== null) {
        stderr.write(
          `OpenRouter model ${candidate.model} was quarantined for ${failureResult.quarantineHours} hours after attributable failures.\n`
        );
      }
    }
    if (status === 429 && openRouterPlatformRemaining(response) === 0) {
      exhausted.add('openrouter');
      stderr.write('OpenRouter platform rate limit is exhausted for this run; skipping its remaining routes.\n');
      return { retry: false };
    }
    const retryAfterMs = retryAfterDelayMs(response);
    if (retryAfterMs !== null && retryAfterMs > MAX_OPENROUTER_RETRY_AFTER_MS) {
      exhausted.add('openrouter');
      stderr.write(
        `OpenRouter Retry-After exceeds ${MAX_OPENROUTER_RETRY_AFTER_MS / 1000}s; skipping its remaining routes for this run.\n`
      );
      return { retry: false };
    }
    const clientError = Number.isInteger(status) && status >= 300 && status < 500;
    if (status === 429 || transientTypedFailure || transientServerFailure || response?.ok === true || clientError) {
      await refreshOpenRouterQuotaAfterAttempt();
    }
    if (openRouterQuotaInitiallyUnknown) exhausted.add('openrouter');
    if (!openRouterQuotaKnownPositive) exhausted.add('openrouter');
    if (retryAttempt) {
      // This route's retry is spent; only a fresh positive quota permits the next model below.
      return { retry: false };
    }
    if (
      !quotaWasPositive ||
      !openRouterQuotaKnownPositive ||
      openRouterRetryUsed ||
      (!attributed && !transientServerFailure && !transientTypedFailure)
    ) {
      return { retry: false };
    }
    if (failureResult?.quarantineHours !== null && failureResult?.quarantineHours !== undefined) {
      return { retry: false };
    }
    return {
      retry: true,
      delayMs: retryAfterMs ?? (status === 429 || hasOpenRouterRateLimitError(payload) ? 1000 : 0),
    };
  };
  for (let candidateIndex = 0; candidateIndex < available.length; candidateIndex += 1) {
    const candidate = available[candidateIndex];
    if (exhausted.has(candidate.source)) continue;
    if (candidate.source === 'openrouter' && !(await ensureOpenRouterAvailable())) continue;
    const sourceAttempts = attempts.get(candidate.source) ?? 0;
    if (sourceAttempts >= MAX_ATTEMPTS_PER_SOURCE) continue;
    if (candidate.source === 'openrouter' && !openRouterKey) continue;
    if (candidate.source === 'groq' && (!groqKeys.length || !groqFreePlan)) continue;
    if (candidate.source === 'opencode' && !opencodeCommand) continue;
    attempts.set(candidate.source, sourceAttempts + 1);
    const routeMaxTokens = maxTokens;
    const routeTimeoutMs = COMPLETION_TIMEOUT_MS;
    if (candidate.source === 'kilo') {
      try {
        const result = await runKilo({
          command: effectiveKiloCommand,
          source: 'kilo',
          model: candidate.model,
          prompt,
          maxTokens: routeMaxTokens,
          timeoutMs: routeTimeoutMs,
        });
        if (result?.safetyStop || hasReportedNonZeroCost(result?.usage)) {
          await stopForReportedCost(candidate);
        }
        if (isContentPolicyError(result)) stopForContentPolicy(candidate);
        if (result?.finishReason === 'length') {
          errors.push(`kilo/${candidate.model}: incomplete completion (finish_reason=length)`);
          continue;
        }
        if (result?.status === 429) {
          await persistKiloRateLimit();
        }
        if (result?.content && result.finishReason === 'stop') {
          const resolvedModel = result.model ?? candidate.model;
          if (!available.some((entry) => entry.source === 'kilo' && entry.model === resolvedModel)) {
            errors.push(`kilo/${candidate.model}: response resolved to missing or unverified model ${resolvedModel}`);
            continue;
          }
          return {
            source: candidate.source,
            model: resolvedModel,
            content: result.content,
            finishReason: result.finishReason,
            usage: result.usage ?? null,
            requestCounts: requestCounts(),
          };
        }
        await recordAttributableFailure(candidate, result);
        errors.push(`kilo/${candidate.model}: ${result?.error ?? 'incomplete completion'}`);
        if (result?.exhaustSource) exhausted.add(candidate.source);
      } catch (error) {
        if (error.costSafetyStopHandled) throw error;
        if (error.reportedCost === true || hasReportedNonZeroCost(error.usage)) {
          await stopForReportedCost(candidate);
        }
        if (error.safetyStop) throw error;
        if (error.status === 429) {
          await persistKiloRateLimit();
        }
        if (isContentPolicyError(error)) stopForContentPolicy(candidate);
        await recordAttributableFailure(candidate, error);
        errors.push(`kilo/${candidate.model}: ${sanitizeErrorMessage(error.message)}`);
        if (error.code === 'ENOENT' || error.code === 'KILO_SPAWN') exhausted.add(candidate.source);
      }
      const attemptNumber = attempts.get(candidate.source) ?? 0;
      const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
      await delay(backoffMs);
      continue;
    }
    if (candidate.source === 'groq') {
      const effectiveMaxTokens = Math.max(routeMaxTokens, 1024);
      for (const key of groqKeys) {
        if (exhaustedGroqKeys.has(key)) continue;
        let response;
        try {
          response = await fetchImpl(GROQ_CHAT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
            },
            signal: AbortSignal.timeout(routeTimeoutMs),
            body: JSON.stringify({
              model: candidate.model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: effectiveMaxTokens,
              reasoning_effort: 'low',
            }),
          });
        } catch (error) {
          const retryAfter = retryAfterHint(response);
          errors.push(
            `groq/${candidate.model}: ${sanitizeErrorMessage(error.message)}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
          );
          const attemptNumber = attempts.get(candidate.source) ?? 0;
          const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
          await delay(backoffMs);
          continue;
        }
        let payload;
        try {
          payload = await readBoundedJson(response, MAX_COMPLETION_RESPONSE_BYTES, 'Model response');
        } catch (error) {
          const retryAfter = retryAfterHint(response);
          errors.push(
            `groq/${candidate.model}: ${sanitizeErrorMessage(error.message)}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
          );
          if (isPerKeyFailure(response.status)) exhaustedGroqKeys.add(key);
          const attemptNumber = attempts.get(candidate.source) ?? 0;
          const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
          await delay(backoffMs);
          continue;
        }
        if (hasReportedNonZeroCost(payload?.usage)) {
          const message = `groq/${candidate.model}: provider reported non-zero or invalid usage cost; refusing further requests. Requests attempted: ${JSON.stringify(requestCounts())}`;
          try {
            await quarantineReportedCost('groq', candidate.model, quarantineFile);
          } catch (error) {
            throw new Error(`${message} Persistent quarantine failed: ${error.message}`, { cause: error });
          }
          throw new Error(message);
        }
        if (isContentPolicyError(payload)) stopForContentPolicy(candidate);
        const choice = payload?.choices?.[0];
        const content = choice?.message?.content;
        const finishReason = choice?.finish_reason;
        if (response.ok && typeof content === 'string' && content.trim() && finishReason === 'stop') {
          const resolvedModel = payload.model;
          const stillFree = available.some(
            (entry) => entry.source === candidate.source && entry.model === resolvedModel
          );
          if (!stillFree) {
            errors.push(
              `groq/${candidate.model}: response resolved to missing or unverified model ${resolvedModel ?? '(missing)'}`
            );
            const attemptNumber = attempts.get(candidate.source) ?? 0;
            const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
            await delay(backoffMs);
            continue;
          }
          return {
            source: candidate.source,
            model: resolvedModel,
            content,
            finishReason,
            usage: payload.usage ?? null,
            requestCounts: requestCounts(),
            groqKeysAvailable: groqKeys.length - exhaustedGroqKeys.size,
          };
        }
        if (response.ok && typeof content === 'string' && content.trim() && finishReason !== 'stop') {
          errors.push(`groq/${candidate.model}: incomplete completion (finish_reason=${finishReason ?? 'missing'})`);
          const attemptNumber = attempts.get(candidate.source) ?? 0;
          const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
          await delay(backoffMs);
          continue;
        }
        const reason = response.ok
          ? `empty completion${finishReason ? ` (finish_reason=${finishReason})` : ''}`
          : failureReason(response, payload);
        errors.push(`groq/${candidate.model}: ${reason}`);
        if (response.status >= 500 && hasUpstreamProviderMetadata(payload)) {
          const failure = await recordAttributableFailure(candidate, {
            status: response.status,
            modelAttributable: true,
          });
          if (failure && failure.quarantineHours !== null) {
            exhausted.add('groq');
            break;
          }
        }
        if (isPerKeyFailure(response.status)) exhaustedGroqKeys.add(key);
        const attemptNumber = attempts.get(candidate.source) ?? 0;
        const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
        await delay(backoffMs);
      }
      if (groqKeys.every((key) => exhaustedGroqKeys.has(key))) exhausted.add('groq');
      continue;
    }
    if (candidate.source === 'opencode') {
      try {
        const result = await runOpenCode({
          command: opencodeCommand,
          model: candidate.model,
          prompt,
          maxTokens: routeMaxTokens,
          timeoutMs: routeTimeoutMs,
        });
        if (result?.safetyStop || hasReportedNonZeroCost(result?.usage)) {
          await stopForReportedCost(candidate);
        }
        if (isContentPolicyError(result)) stopForContentPolicy(candidate);
        if (result?.content && result.finishReason === 'stop') {
          const resolvedModel = result.model ?? candidate.model;
          if (!available.some((entry) => entry.source === 'opencode' && entry.model === resolvedModel)) {
            errors.push(
              `opencode/${candidate.model}: response resolved to missing or unverified model ${resolvedModel}`
            );
            continue;
          }
          return {
            source: candidate.source,
            model: resolvedModel,
            content: result.content,
            finishReason: result.finishReason,
            usage: result.usage ?? null,
            requestCounts: requestCounts(),
          };
        }
        errors.push(`opencode/${candidate.model}: ${result?.error ?? 'incomplete completion'}`);
        const metadata = openCodeErrorMetadata(result);
        if (metadata.accountQuota) {
          exhausted.add('opencode');
          stderr.write(
            'OpenCode reported provider.free-limit; skipping OpenCode for this run without a persistent cooldown.\n'
          );
        } else if (metadata.modelAttributable && metadata.status !== null) {
          const failure = await recordAttributableFailure(candidate, metadata, { include429: true });
          if (failure && failure.quarantineHours !== null) continue;
        }
        if (
          metadata.status === 429 &&
          metadata.modelAttributable &&
          !metadata.accountQuota &&
          !candidate.retryAttempt
        ) {
          const retryAfterMs = openCodeRetryDelayMs(metadata);
          if (retryAfterMs === null || retryAfterMs <= MAX_OPENCODE_RETRY_AFTER_MS) {
            await waitForRetryAfter(retryAfterMs ?? 1000);
            available.splice(candidateIndex + 1, 0, { ...candidate, retryAttempt: true });
          }
        }
      } catch (error) {
        if (error.costSafetyStopHandled) throw error;
        if (error.reportedCost === true || hasReportedNonZeroCost(error.usage)) {
          await stopForReportedCost(candidate);
        }
        if (error.safetyStop) throw error;
        if (isContentPolicyError(error)) stopForContentPolicy(candidate);
        errors.push(`opencode/${candidate.model}: ${sanitizeErrorMessage(error.message)}`);
        const metadata = openCodeErrorMetadata(error);
        if (error.code === 'ENOENT') exhausted.add(candidate.source);
        if (metadata.accountQuota) exhausted.add('opencode');
        if (metadata.modelAttributable && metadata.status !== null && !metadata.accountQuota) {
          const failure = await recordAttributableFailure(candidate, metadata, { include429: true });
          if (failure && failure.quarantineHours !== null) continue;
        }
        if (
          metadata.status === 429 &&
          metadata.modelAttributable &&
          !metadata.accountQuota &&
          !candidate.retryAttempt
        ) {
          const retryAfterMs = openCodeRetryDelayMs(metadata);
          if (retryAfterMs === null || retryAfterMs <= MAX_OPENCODE_RETRY_AFTER_MS) {
            await waitForRetryAfter(retryAfterMs ?? 1000);
            available.splice(candidateIndex + 1, 0, { ...candidate, retryAttempt: true });
          }
        }
      }
      const attemptNumber = attempts.get(candidate.source) ?? 0;
      const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
      await delay(backoffMs);
      continue;
    }
    const url = OPENROUTER_CHAT;
    const headers = { 'Content-Type': 'application/json' };
    if (candidate.source === 'openrouter') headers.Authorization = `Bearer ${openRouterKey}`;
    const quotaWasPositive = candidate.source === 'openrouter' && openRouterQuotaKnownPositive;
    const effectiveMaxTokens = routeMaxTokens;
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(routeTimeoutMs),
        body: JSON.stringify({
          model: candidate.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: effectiveMaxTokens,
        }),
      });
    } catch (error) {
      const retryAfter = retryAfterHint(response);
      errors.push(
        `${candidate.source}/${candidate.model}: ${sanitizeErrorMessage(error.message)}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
      );
      if (candidate.source === 'openrouter') await refreshOpenRouterQuotaAfterAttempt();
      if (exhausted.has(candidate.source)) continue;
      const attemptNumber = attempts.get(candidate.source) ?? 0;
      const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
      await delay(backoffMs);
      continue;
    }
    let payload;
    try {
      payload = await readBoundedJson(response, MAX_COMPLETION_RESPONSE_BYTES, 'Model response');
    } catch (error) {
      const retryAfter = retryAfterHint(response);
      errors.push(
        `${candidate.source}/${candidate.model}: ${sanitizeErrorMessage(error.message)}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
      );
      const retryDecision = await handleOpenRouterFailure({
        candidate,
        response,
        payload: null,
        quotaWasPositive,
        retryAttempt: candidate.retryAttempt === true,
      });
      if (retryDecision.retry) {
        openRouterRetryUsed = true;
        if (retryDecision.delayMs > 0) await waitForRetryAfter(retryDecision.delayMs);
        available.splice(candidateIndex + 1, 0, { ...candidate, retryAttempt: true });
        continue;
      }
      const attemptNumber = attempts.get(candidate.source) ?? 0;
      const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
      await delay(backoffMs);
      continue;
    }
    if (hasReportedNonZeroCost(payload?.usage)) {
      const message = `${candidate.source}/${candidate.model}: provider reported non-zero or invalid usage cost; refusing further requests. Requests attempted: ${JSON.stringify(requestCounts())}`;
      try {
        await quarantineReportedCost(candidate.source, candidate.model, quarantineFile);
      } catch (error) {
        throw new Error(`${message} Persistent quarantine failed: ${error.message}`, { cause: error });
      }
      throw new Error(message);
    }
    if (isContentPolicyError(payload)) {
      throw new Error(
        `${candidate.source}/${candidate.model}: provider content policy rejected or filtered this request (HTTP ${response.status}). Requests attempted: ${JSON.stringify(requestCounts())}`
      );
    }
    if (candidate.source === 'openrouter' && response.ok && hasTransientOpenRouterProviderError(payload)) {
      errors.push(`${candidate.source}/${candidate.model}: ${failureReason(response, payload)}`);
      const retryDecision = await handleOpenRouterFailure({
        candidate,
        response,
        payload,
        quotaWasPositive,
        retryAttempt: candidate.retryAttempt === true,
      });
      if (retryDecision.retry) {
        openRouterRetryUsed = true;
        if (retryDecision.delayMs > 0) await waitForRetryAfter(retryDecision.delayMs);
        available.splice(candidateIndex + 1, 0, { ...candidate, retryAttempt: true });
      }
      continue;
    }
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (response.ok && finishReason === 'length' && candidate.source === 'openrouter') {
      await refreshOpenRouterQuotaAfterAttempt();
    }
    if (response.ok && typeof content === 'string' && content.trim() && finishReason === 'stop') {
      const resolvedModel = payload.model;
      const stillFree = available.some((entry) => entry.source === candidate.source && entry.model === resolvedModel);
      if (!stillFree) {
        errors.push(
          `${candidate.source}/${candidate.model}: response resolved to missing or unverified model ${resolvedModel ?? '(missing)'}`
        );
        if (candidate.source === 'openrouter') await refreshOpenRouterQuotaAfterAttempt();
        if (candidate.source === 'openrouter' && !openRouterQuotaKnownPositive) exhausted.add('openrouter');
        if (exhausted.has(candidate.source)) continue;
        const attemptNumber = attempts.get(candidate.source) ?? 0;
        const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
        await delay(backoffMs);
        continue;
      }
      return {
        source: candidate.source,
        model: resolvedModel,
        content,
        finishReason,
        usage: payload.usage ?? null,
        requestCounts: requestCounts(),
      };
    }
    if (response.ok && typeof content === 'string' && content.trim() && finishReason !== 'stop') {
      if (candidate.source === 'openrouter') await refreshOpenRouterQuotaAfterAttempt();
      errors.push(
        `${candidate.source}/${candidate.model}: incomplete completion (finish_reason=${finishReason ?? 'missing'})`
      );
      if (candidate.source === 'openrouter' && !openRouterQuotaKnownPositive) exhausted.add('openrouter');
      if (exhausted.has(candidate.source)) continue;
      const attemptNumber = attempts.get(candidate.source) ?? 0;
      const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
      await delay(backoffMs);
      continue;
    }
    const reason = response.ok
      ? `empty completion${finishReason ? ` (finish_reason=${finishReason})` : ''}`
      : failureReason(response, payload);
    errors.push(`${candidate.source}/${candidate.model}: ${reason}`);
    const retryDecision = await handleOpenRouterFailure({
      candidate,
      response,
      payload,
      quotaWasPositive,
      retryAttempt: candidate.retryAttempt === true,
    });
    if (
      response.status === 401 ||
      (candidate.source === 'groq' && (response.status === 402 || response.status === 429))
    )
      exhausted.add(candidate.source);
    if (retryDecision.retry) {
      openRouterRetryUsed = true;
      if (retryDecision.delayMs > 0) await waitForRetryAfter(retryDecision.delayMs);
      available.splice(candidateIndex + 1, 0, { ...candidate, retryAttempt: true });
      continue;
    }
    const attemptNumber = attempts.get(candidate.source) ?? 0;
    const backoffMs = Math.min(100 * Math.pow(2, attemptNumber - 1), 2000) + Math.random() * 100;
    await delay(backoffMs);
  }
  throw new Error(
    `No free model completed the request. Requests attempted: ${JSON.stringify(requestCounts())}. ${errors.map((e) => sanitizeErrorMessage(e)).join(' | ') || 'No eligible free models were available.'}`
  );
}

function usage() {
  return (
    'Usage: node scripts/free-model-pool.mjs --help\n' +
    'Usage: node scripts/free-model-pool.mjs --list [--limit N]\n' +
    '       node scripts/free-model-pool.mjs --prompt-file PATH [--max-tokens N] [--output-file PATH]\n' +
    '       node scripts/free-model-pool.mjs --openrouter-quota\n' +
    '       node scripts/free-model-pool.mjs --probe-groq [--groq-key-dir DIR] [--groq-key-files PATH1,PATH2]\n' +
    '       node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH [--max-tokens N]\n' +
    '--list fetches public model catalogs; configured=null means local CLI credentials were not checked.\n' +
    'configured=false means provider credentials/opt-in are missing, not that a model is invalid.\n' +
    'Nemotron 3 Ultra is the preferred free route on OpenRouter and Kilo; use exact-zero catalog pricing. Other routes default to 1,200 tokens, while Groq keeps its 1,024-token reasoning floor.\n' +
    'Kilo completions use the authenticated Kilo CLI; set KILO_CLI only when its automatic discovery fails.\n' +
    'Inference uses five minutes by default; catalog and quota checks use 15 seconds.\n' +
    'Groq routing requires GROQ_API_KEY and GROQ_FREE_PLAN=1 because its catalog does not expose free pricing.\n' +
    'OpenCode free models run through the opencode CLI with tool permissions denied.\n' +
    '--openrouter-quota reports the server-side daily free-model request count without sending an inference request.\n' +
    '--probe-groq probes one or more Groq API keys to verify authentication; --groq-key-dir discovers api_key files in a directory (default ~/.config/groq); --groq-key-files is a comma-separated list of explicit key file paths. GROQ_API_KEYS (comma-separated) or GROQ_API_KEY may also supply keys directly. No inference request is sent.\n' +
    'With multiple Groq keys, the pool rotates to the next key on HTTP 401/402/429; a permanently invalid key (401) is retired for the run while a single account is never reused to evade its per-account limits.\n' +
    '--help prints this usage without making a network request.\n'
  );
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqApiKeys = process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [],
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    kiloCommand,
    runKilo = runKiloCompletion,
    opencodeCommand = process.env.OPENCODE_CLI ?? 'opencode',
    runOpenCode = runOpenCodeCompletion,
    quarantineFile = DEFAULT_QUARANTINE_FILE,
    poolStateFile,
    initializeLegacyQuarantine = true,
    stdout = process.stdout,
    stderr = process.stderr,
    groqKeyDir = join(homedir(), '.config', 'groq'),
    groqKeyFilePaths = [],
    probeGroqKeysImpl = probeGroqKeys,
  } = {}
) {
  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  const list = args.includes('--list');
  const promptAt = args.indexOf('--prompt-file');
  const outputFileAt = args.indexOf('--output-file');
  const limitAt = args.indexOf('--limit');
  const tokenAt = args.indexOf('--max-tokens');
  const probeGroq = args.includes('--probe-groq');
  const groqKeyDirAt = args.indexOf('--groq-key-dir');
  const groqKeyFilesAt = args.indexOf('--groq-key-files');
  if (args.includes('--openrouter-quota')) {
    if (args.length !== 1) {
      stderr.write(`${usage()}\n`);
      return 2;
    }
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
    if (quota.reason !== 'ok') {
      stderr.write(
        `Unable to read OpenRouter daily quota (${sanitizeErrorMessage(quota.reason)}${quota.detail ? `: ${sanitizeErrorMessage(quota.detail)}` : ''}); check the API key and network. No inference request was sent.\n`
      );
      return 2;
    }
    const sanitizedQuota = sanitizeForLogging(quota);
    stdout.write(
      `${JSON.stringify({
        provider: 'openrouter',
        counter: 'free_model_daily_requests',
        checkedAt: new Date().toISOString(),
        ...sanitizedQuota,
      })}\n`
    );
    return 0;
  }
  const knownOptions = new Set([
    '--list',
    '--prompt-file',
    '--output-file',
    '--limit',
    '--max-tokens',
    '--probe-groq',
    '--groq-key-dir',
    '--groq-key-files',
  ]);
  const unknownOption = args.find((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknownOption) {
    stderr.write(`Unknown option: ${unknownOption}\n${usage()}\n`);
    return 2;
  }
  const hasValue = (index) => index < 0 || (args[index + 1] && !args[index + 1].startsWith('--'));
  if (
    (!list && promptAt < 0 && !probeGroq) ||
    (list && promptAt >= 0) ||
    (probeGroq && (list || promptAt >= 0)) ||
    (promptAt >= 0 && !hasValue(promptAt)) ||
    (outputFileAt >= 0 && !hasValue(outputFileAt)) ||
    (limitAt >= 0 && !hasValue(limitAt)) ||
    (tokenAt >= 0 && !hasValue(tokenAt)) ||
    (groqKeyDirAt >= 0 && !hasValue(groqKeyDirAt)) ||
    (groqKeyFilesAt >= 0 && !hasValue(groqKeyFilesAt))
  ) {
    stderr.write(`${usage()}\n`);
    return 2;
  }
  if (probeGroq) {
    const effectiveKeyDir = groqKeyDirAt >= 0 ? args[groqKeyDirAt + 1] : groqKeyDir;
    let filePaths = groqKeyFilePaths;
    if (groqKeyFilesAt >= 0) {
      filePaths = args[groqKeyFilesAt + 1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    }
    let results;
    if (filePaths.length > 0) {
      results = [];
      for (const filePath of filePaths) {
        let key;
        try {
          key = await loadGroqKeyFromFile(filePath);
        } catch (error) {
          results.push({
            keyFile: filePath,
            ok: false,
            reason: 'file_error',
            detail: sanitizeErrorMessage(error.message),
          });
          continue;
        }
        const probed = await probeGroqKey({ fetchImpl, groqApiKey: key });
        results.push({ keyFile: filePath, ...probed });
      }
    } else {
      results = await probeGroqKeysImpl({ fetchImpl, keyDir: effectiveKeyDir });
    }
    const sanitizedResults = sanitizeForLogging({ checkedAt: new Date().toISOString(), keys: results });
    stdout.write(`${JSON.stringify(sanitizedResults, null, 2)}\n`);
    return 0;
  }
  const effectiveKiloCommand = kiloCommand === '' ? '' : (kiloCommand ?? (await resolveKiloCli()));
  if (list) {
    const effectiveGroqKeys = groqApiKeys.length > 0 ? groqApiKeys : groqApiKey ? [groqApiKey] : [];
    const groqConfigured = effectiveGroqKeys.length > 0 && groqFreePlan;
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey,
      groqApiKey: effectiveGroqKeys[0] ?? '',
      groqApiKeys: groqFreePlan ? effectiveGroqKeys : [],
      includeGroq: Boolean(effectiveGroqKeys[0]),
      quarantineFile,
      includeOpenRouterCatalog: true,
      initializeLegacyQuarantine,
      onCatalogError: (source, error) =>
        stderr.write(`${source} catalog unavailable: ${sanitizeErrorMessage(error.message)}\n`),
    });
    const limit = limitAt >= 0 ? Math.max(1, Number(args[limitAt + 1]) || 1) : candidates.length;
    const configured = (source) => {
      if (source === 'kilo') return effectiveKiloCommand ? null : false;
      if (source === 'openrouter') return Boolean(openRouterKey);
      if (source === 'opencode') return null;
      return source === 'groq' && groqConfigured;
    };
    const listed = candidates.slice(0, limit).map((entry) => ({ ...entry, configured: configured(entry.source) }));
    stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
    return 0;
  }
  let prompt;
  try {
    prompt = await readBoundedPrompt(args[promptAt + 1]);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 2;
  }
  const maxTokens = tokenAt >= 0 ? Number(args[tokenAt + 1]) : DEFAULT_MAX_TOKENS;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_COMPLETION_TOKENS) {
    stderr.write(`--max-tokens must be an integer from 1 to ${MAX_COMPLETION_TOKENS}.\n`);
    return 2;
  }
  const result = await completeWithFreeModel(prompt, {
    fetchImpl,
    openRouterKey,
    groqApiKey,
    groqApiKeys,
    groqFreePlan,
    kiloCommand: effectiveKiloCommand,
    runKilo,
    opencodeCommand,
    runOpenCode,
    maxTokens,
    quarantineFile,
    poolStateFile,
    initializeLegacyQuarantine,
    onCatalogError: (source, error) =>
      stderr.write(`${source} catalog unavailable: ${sanitizeErrorMessage(error.message)}\n`),
    onOpenRouterQuota: ({ used, limit, remaining }) =>
      stderr.write(
        `OpenRouter free requests: ${used}/${limit} used, ${remaining} remaining at ${new Date().toISOString()} (server snapshot).\n`
      ),
    stderr,
  });
  const output = [
    `[${result.source}/${result.model}]`,
    `Finish reason: ${result.finishReason}`,
    `Usage: ${JSON.stringify(result.usage)}`,
    `Requests attempted (this run): ${JSON.stringify(result.requestCounts)}`,
    ...(result.groqKeysAvailable ? [`Groq keys available: ${result.groqKeysAvailable}`] : []),
    '',
    result.content,
    '',
  ].join('\n');
  if (outputFileAt >= 0) {
    const outPath = args[outputFileAt + 1];
    await writeFile(outPath, output, 'utf8');
    stderr.write(`Result written to ${outPath}\n`);
  } else {
    stdout.write(output);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${sanitizeErrorMessage(error.message)}\n`);
      process.exitCode = 1;
    });
}
