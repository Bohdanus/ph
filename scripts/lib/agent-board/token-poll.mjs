/**
 * Poll GPT for the tokens left in a rolling window.
 *
 * WHAT "POLL GPT" MEANS HERE
 * ---------------------------
 * The Kilo gateway proxies every request through OpenAI (paid GPT models Luna,
 * Terra, Sol) and free partner models. There is NO public endpoint on the
 * gateway that hands back "tokens remaining": the gateway checks balance
 * server-side and returns HTTP 402 on zero, and OpenAI's remaining-token signal
 * lives only in per-request rate-limit headers that reset in minutes.
 *
 * The local Kilo session database has a per-message `message.data` usage record:
 * model ID, provider ID, token total, role and creation time. We sum completed
 * assistant-message token totals in the look-back window, not the cumulative
 * `session.tokens_*` counters. The latter cannot be apportioned to a 5-hour
 * window and would count a whole long-lived session when only its last message
 * was recent. The result is still local usage, not an account balance.
 *
 * A live provider balance probe is intentionally NOT in this module: there is no
 * documented, no-secret endpoint to call for it, and a guess at one would commit
 * credentials that cannot be exercised under review. When one exists upstream,
 * it should slot in here as another `source` value rather than replace this.
 *
 * RESET TIMING IS AN ESTIMATE
 * ---------------------------
 * No documented provider endpoint supplies the account's 5-hour reset boundary.
 * `resetAt` is therefore estimated as the oldest counted message timestamp plus
 * the look-back width: when that usage ages out, some allowance may return. This
 * is a rough rolling-window signal, not an account reset guarantee. A low
 * allowance with a missing/estimated-distant reset fails closed to free models.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { MAX_TOKEN_WINDOW_HOURS, TOKEN_WINDOW_HOURS } from './db.mjs';
import { MAX_SESSION_DB_WINDOW_HOURS, boundSessionSinceMs } from '../worktree-inventory/session-audit-limits.mjs';

export { MAX_TOKEN_WINDOW_HOURS, TOKEN_WINDOW_HOURS };
if (MAX_TOKEN_WINDOW_HOURS !== MAX_SESSION_DB_WINDOW_HOURS) {
  throw new Error('token and session database window safety bounds must match');
}
export const TOKEN_READING_STALE_AFTER_MS = 90 * 60 * 1000;
export const LOW_TOKEN_BUDGET_RATIO = 0.2;
export const RESET_NEAR_MS = 60 * 60 * 1000;

/** Env var that sets the per-window token budget ceiling. */
export const BUDGET_ENV = 'KILO_TOKEN_WINDOW_BUDGET';

/**
 * The session database this poll reads. Mirrors `resolveSessionDb` in
 * `chats.mjs` without importing that module, so the poll stays in the
 * `agent-board` lib and does not pull in the inventory's chat heuristics.
 */
export const defaultSessionDbPath = () => process.env.KILO_DB || `${homedir()}/.local/share/kilo/kilo.db`;

/**
 * Which per-message usage records count as GPT-provider usage.
 *
 * Only OpenAI-provider GPT model IDs belong to this window budget. Other
 * providers, including Kilo's separately-billed gateway and OpenRouter, have
 * different allowances. The provider and model ID are recorded per message;
 * session.model is only the session's current model and is not suitable for
 * historical attribution.
 */
export function isPaidGpt(modelID, providerID) {
  if (typeof modelID !== 'string') return false;
  if (providerID === 'openai') return /^gpt-[a-z0-9][a-z0-9._-]*$/i.test(modelID);
  if (providerID === 'kilo') return /^~?openai\/gpt-[a-z0-9][a-z0-9._-]*$/i.test(modelID);
  return false;
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTokenCount = (value) => Number.isSafeInteger(value) && value >= 0;

function tokenUsage(tokens) {
  if (!isRecord(tokens)) return null;
  if (isTokenCount(tokens.total)) return tokens.total;
  const fields = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write];
  if (!fields.every(isTokenCount)) return null;
  const total = fields.reduce((sum, count) => sum + count, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function completedAt(data) {
  const value = data?.time?.completed;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * A reading the board stores. Every field the `token_window` row needs, plus a
 * `detail` bag that is the one honest place for approximation notes.
 */
function reading({
  provider,
  model,
  polledAt,
  windowHours,
  budgetTokens,
  consumedTokens,
  remainingTokens,
  source,
  status,
  resetAt,
  detail,
}) {
  return {
    provider,
    model,
    polledAt,
    windowHours,
    budgetTokens,
    consumedTokens,
    remainingTokens,
    resetAt,
    source,
    status,
    detail,
  };
}

/**
 * Poll GPT token consumption for the last `windowHours`, and derive the tokens
 * left against `budgetTokens`.
 *
 * Usage is attributed to the model/provider on each assistant message and the
 * message's own timestamp. Sessions are selected first to use the indexed
 * (session_id, time_created, id) lookup rather than scanning the whole message
 * table. The function never throws: missing/unsupported data and invalid
 * windows return explicit statuses, and no local source invents a provider reset
 * time.
 */
export function pollGptTokens({
  dbPath,
  windowHours = TOKEN_WINDOW_HOURS,
  budgetTokens = null,
  nowMs = Date.now(),
  modelFilter = isPaidGpt,
} = {}) {
  const sourcePath = dbPath ?? defaultSessionDbPath();
  const validNow = Number.isSafeInteger(nowMs) && Number.isFinite(new Date(nowMs).getTime());
  const polledAt = validNow ? new Date(nowMs).toISOString() : new Date().toISOString();
  const base = {
    provider: 'gpt',
    model: 'any',
    polledAt,
    windowHours,
    budgetTokens,
    consumedTokens: null,
    remainingTokens: null,
    resetAt: null,
    source: 'session-db',
    detail: { dbPath: sourcePath },
  };

  if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > MAX_TOKEN_WINDOW_HOURS) {
    return reading({
      ...base,
      status: 'invalid-window',
      detail: { dbPath: sourcePath, requestedWindowHours: windowHours, maxWindowHours: MAX_TOKEN_WINDOW_HOURS },
    });
  }

  if (!validNow) {
    return reading({ ...base, status: 'invalid-time', detail: { dbPath: sourcePath, requestedNowMs: nowMs } });
  }

  if (budgetTokens != null && !isTokenCount(budgetTokens)) {
    return reading({
      ...base,
      status: 'invalid-budget',
      detail: { dbPath: sourcePath, reason: 'budget must be a non-negative safe integer' },
    });
  }

  if (!existsSync(sourcePath)) {
    return reading({ ...base, status: 'no-session-db' });
  }

  const sinceMs = boundSessionSinceMs(nowMs - windowHours * 3_600_000, nowMs);
  let db;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
    db.exec('PRAGMA query_only = 1;');
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch {
        // Preserve the open failure as the useful poll result.
      }
    }
    return reading({
      ...base,
      status: 'no-session-db',
      detail: { dbPath: sourcePath, error: error?.message ?? String(error) },
    });
  }

  try {
    // The session table is small. Query every session ID instead of prefiltering
    // by session.time_updated: Kilo can insert a message just before it updates
    // its parent session row. Per-message rows are still narrowed by the covering
    // (session_id, time_created, id) index. Parent and subagent sessions count.
    const sessions = db
      .prepare('SELECT id FROM session')
      .all()
      .map((row) => row.id);
    const rows = [];
    const batchSize = 500;
    for (let start = 0; start < sessions.length; start += batchSize) {
      const batch = sessions.slice(start, start + batchSize);
      const placeholders = batch.map(() => '?').join(', ');
      rows.push(
        ...db
          .prepare(
            `SELECT time_created, data
               FROM message
              WHERE session_id IN (${placeholders})
                AND time_created >= ? AND time_created <= ?`
          )
          .all(...batch, sinceMs, nowMs)
      );
    }

    let consumed = 0;
    let matched = 0;
    let missingUsage = 0;
    let fallbackUsage = 0;
    let unclassified = 0;
    let assistantMessages = 0;
    let oldestMatchedAt = null;
    for (const row of rows) {
      let data;
      try {
        data = JSON.parse(row.data);
      } catch {
        // A malformed message may be a paid assistant row. Keep the reading
        // incomplete instead of letting SQL JSON extraction discard it.
        missingUsage += 1;
        unclassified += 1;
        continue;
      }
      if (!isRecord(data) || typeof data.role !== 'string') {
        missingUsage += 1;
        unclassified += 1;
        continue;
      }
      if (data.role !== 'assistant') continue;
      assistantMessages += 1;
      if (
        typeof data.providerID !== 'string' ||
        !data.providerID ||
        typeof data.modelID !== 'string' ||
        !data.modelID
      ) {
        missingUsage += 1;
        unclassified += 1;
        continue;
      }
      if (!modelFilter(data.modelID, data.providerID)) continue;
      matched += 1;
      oldestMatchedAt = oldestMatchedAt == null ? row.time_created : Math.min(oldestMatchedAt, row.time_created);
      const completion = completedAt(data);
      if (completion == null || completion < row.time_created || completion > nowMs) {
        missingUsage += 1;
        continue;
      }
      const usage = tokenUsage(data.tokens);
      if (usage == null || !Number.isSafeInteger(consumed + usage)) {
        missingUsage += 1;
        continue;
      }
      consumed += usage;
      if (!isTokenCount(data.tokens?.total)) {
        fallbackUsage += 1;
      }
    }
    const resetAt = oldestMatchedAt == null ? null : new Date(oldestMatchedAt + windowHours * 3_600_000).toISOString();
    const detail = {
      dbPath: sourcePath,
      resetTiming: resetAt == null ? 'unknown-no-matching-messages' : 'estimated-oldest-message-expiry',
      resetAtEstimated: resetAt !== null,
      scope: 'assistant-message-token-total',
      breakdown: {
        sessionsScanned: sessions.length,
        candidateMessages: rows.length,
        assistantMessages,
        matched,
        fallbackUsage,
        missingUsage,
        unclassified,
        consumed,
      },
    };
    const status = missingUsage > 0 ? 'incomplete' : budgetTokens == null ? 'no-budget' : 'ok';
    const remaining = status === 'ok' ? Math.max(0, budgetTokens - consumed) : null;
    if (missingUsage > 0) detail.breakdown.partialConsumedTokens = consumed;
    return reading({
      ...base,
      consumedTokens: missingUsage > 0 ? null : consumed,
      remainingTokens: remaining,
      resetAt,
      status,
      detail,
    });
  } catch (error) {
    return reading({
      ...base,
      status: 'error',
      detail: { dbPath: sourcePath, error: error?.message ?? String(error) },
    });
  } finally {
    db.close();
  }
}

/**
 * Resolve and validate the window budget. Invalid values are errors rather
 * than silently turning an intended budget into a consumed-only reading.
 */
export function resolveBudget(explicit) {
  if (explicit != null) {
    const rawValue = String(explicit).trim();
    if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(Number(rawValue))) {
      throw new RangeError('budget must be a non-negative safe integer');
    }
    return Number(rawValue);
  }
  const raw = process.env[BUDGET_ENV];
  if (raw === undefined || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw.trim()) || !Number.isSafeInteger(Number(raw))) {
    throw new RangeError(`${BUDGET_ENV} must be a non-negative safe integer`);
  }
  return Number(raw);
}

/**
 * Decide the conservative subagent tier from a held reading. Missing, stale,
 * incomplete or unbudgeted readings are fail-closed. Reset timing is NULL for
 * the local session source, so a low-budget reading is treated as not near reset.
 */
export function subagentTokenPolicy(readingValue, nowMs = Date.now()) {
  const read = readingValue ?? {};
  const polledAt = read.polledAt ?? read.polled_at;
  const ageMs = nowMs - Date.parse(polledAt ?? '');
  const stale = !Number.isFinite(ageMs) || ageMs < 0 || ageMs > TOKEN_READING_STALE_AFTER_MS;
  const budget = read.budgetTokens ?? read.budget_tokens;
  const remaining = read.remainingTokens ?? read.remaining_tokens;
  const resetAt = read.resetAt ?? read.reset_at ?? read.detail?.resetAt ?? null;
  const resetMs = resetAt == null ? Number.NaN : Date.parse(resetAt);
  const resetEtaMs = Number.isFinite(resetMs) && resetMs >= nowMs ? resetMs - nowMs : null;
  const windowHours = read.windowHours ?? read.window_hours;
  const knownAllowance =
    read.status === 'ok' &&
    windowHours === TOKEN_WINDOW_HOURS &&
    Number.isSafeInteger(budget) &&
    budget > 0 &&
    Number.isSafeInteger(remaining) &&
    remaining >= 0 &&
    remaining <= budget;

  if (stale || !knownAllowance) {
    return {
      state: 'unknown',
      recommendation: 'free-preferred',
      terraSol: 'normal-policy',
      stale,
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      resetAt,
      reason: stale
        ? 'reading missing, invalid, future-dated, or older than 90 minutes'
        : `reading status is ${read.status ?? 'missing'} or has no usable budget`,
    };
  }

  const remainingRatio = remaining / budget;
  const low = remainingRatio <= LOW_TOKEN_BUDGET_RATIO;
  const resetFar = resetEtaMs == null || resetEtaMs > RESET_NEAR_MS;
  const restricted = low && resetFar;
  return {
    state: low ? 'low' : 'healthy',
    recommendation: 'free-preferred',
    terraSol: restricted ? 'blocked' : 'normal-policy',
    stale: false,
    ageMs,
    remainingRatio,
    resetAt,
    resetEtaMs,
    reason: restricted
      ? 'remaining allowance is at or below 20% and reset is more than 60 minutes away or unknown'
      : low
        ? 'reset is within 60 minutes; free models are still preferred'
        : 'allowance is above the 20% low-water mark; free models remain preferred',
  };
}

/**
 * One human-readable line and one JSON payload, so both `swarm tokens` and the
 * standalone poll script can share a single formatter.
 */
export function formatTokenWindow(reading) {
  const { provider, model, polledAt, windowHours, budgetTokens, consumedTokens, remainingTokens, source, status } =
    reading;
  const reset = reading.resetAt == null ? 'reset unknown' : `reset ~${reading.resetAt}`;
  const parts = [`${provider}/${model}`, `lookback ${windowHours}h`, `polled ${polledAt}`, source, reset];
  if (budgetTokens != null) parts.push(`${budgetTokens} budget`);
  if (consumedTokens == null) parts.push(status === 'incomplete' ? 'consumption incomplete' : 'consumption unknown');
  else parts.push(`${consumedTokens} consumed`);
  if (remainingTokens != null) parts.push(`${remainingTokens} left`);
  else if (budgetTokens == null) parts.push('remaining n/a (no budget)');
  return `${status}: ` + parts.join(' · ');
}
