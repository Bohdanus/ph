import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_QUARANTINE_FILE,
  isOperatorOnlyQuarantine,
  loadQuarantineStateLocked,
  quarantineKey,
  QUARANTINE_SOURCES,
  upsertQuarantine,
  withQuarantineWriteLock,
} from './free-model-quarantine.mjs';

export const KILO_COOLDOWN_MS = 60 * 60 * 1000;
export const OPENROUTER_RATE_LIMIT_WINDOW_MS = 3 * 60 * 60 * 1000;
export const MODEL_FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const OPENROUTER_RATE_LIMIT_QUARANTINE_HOURS = 2;
export const MODEL_FAILURE_QUARANTINE_HOURS = 168;
export const OPENROUTER_RATE_LIMIT_FAILURE_THRESHOLD = 3;
export const MODEL_FAILURE_THRESHOLD = 250;
const MAX_TRACKED_MODELS = 512;

const WORKTREE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKTREES_MARKER = `${sep}.kilo${sep}worktrees${sep}`;
const WORKTREES_INDEX = WORKTREE_ROOT.lastIndexOf(WORKTREES_MARKER);
const PROJECT_ROOT = WORKTREES_INDEX < 0 ? WORKTREE_ROOT : WORKTREE_ROOT.slice(0, WORKTREES_INDEX);
export const DEFAULT_POOL_STATE_FILE = resolve(
  process.env.FREE_MODEL_POOL_STATE_FILE || `${PROJECT_ROOT}/.kilo/free-model-pool-state.json`
);

const emptyState = () => ({
  schemaVersion: 1,
  kiloCooldownUntil: null,
  openRouterExhaustedUtcDate: null,
  modelFailures: {},
});

function validateNow(now) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Free-model pool time must be a non-negative epoch value');
}

function validUtcDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateFreeModelPoolState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.schemaVersion !== 1) {
    throw new Error('Unsupported free-model pool state format');
  }
  if (
    state.kiloCooldownUntil !== null &&
    (typeof state.kiloCooldownUntil !== 'string' || !Number.isFinite(Date.parse(state.kiloCooldownUntil)))
  ) {
    throw new Error('Invalid Kilo cooldown in free-model pool state');
  }
  if (state.openRouterExhaustedUtcDate !== null && !validUtcDate(state.openRouterExhaustedUtcDate)) {
    throw new Error('Invalid OpenRouter quota date in free-model pool state');
  }
  if (
    !state.modelFailures ||
    typeof state.modelFailures !== 'object' ||
    Array.isArray(state.modelFailures) ||
    Object.keys(state.modelFailures).length > MAX_TRACKED_MODELS
  ) {
    throw new Error('Invalid model failure map in free-model pool state');
  }
  for (const [key, entry] of Object.entries(state.modelFailures)) {
    const separator = key.indexOf(':');
    const source = key.slice(0, separator);
    const model = key.slice(separator + 1);
    if (
      separator <= 0 ||
      !QUARANTINE_SOURCES.has(source) ||
      !model ||
      quarantineKey(source, model) !== key ||
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      !Array.isArray(entry.failures) ||
      !Array.isArray(entry.rateLimits) ||
      entry.failures.length > MODEL_FAILURE_THRESHOLD ||
      entry.rateLimits.length > MODEL_FAILURE_THRESHOLD ||
      entry.failures.some((timestamp) => !Number.isSafeInteger(timestamp) || timestamp < 0) ||
      entry.rateLimits.some((timestamp) => !Number.isSafeInteger(timestamp) || timestamp < 0)
    ) {
      throw new Error(`Invalid model failure entry: ${key}`);
    }
  }
  return state;
}

export async function readFreeModelPoolState(filePath = DEFAULT_POOL_STATE_FILE, readFileImpl = readFile) {
  let contents;
  try {
    contents = await readFileImpl(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyState();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(contents);
  } catch {
    throw new Error('Free-model pool state file is not valid JSON');
  }
  return validateFreeModelPoolState(state);
}

function pruneFailureTimes(state, now) {
  const failureCutoff = now - MODEL_FAILURE_WINDOW_MS;
  const rateLimitCutoff = now - OPENROUTER_RATE_LIMIT_WINDOW_MS;
  for (const [key, entry] of Object.entries(state.modelFailures)) {
    entry.failures = entry.failures.filter((timestamp) => timestamp >= failureCutoff && timestamp <= now);
    entry.rateLimits = entry.rateLimits.filter((timestamp) => timestamp >= rateLimitCutoff && timestamp <= now);
    if (entry.failures.length === 0 && entry.rateLimits.length === 0) delete state.modelFailures[key];
  }
}

function boundTrackedModels(state) {
  const entries = Object.entries(state.modelFailures);
  if (entries.length <= MAX_TRACKED_MODELS) return;
  entries.sort((left, right) => {
    const lastSeen = (entry) => Math.max(entry.failures.at(-1) ?? 0, entry.rateLimits.at(-1) ?? 0);
    return lastSeen(left[1]) - lastSeen(right[1]);
  });
  for (const [key] of entries.slice(0, entries.length - MAX_TRACKED_MODELS)) delete state.modelFailures[key];
}

async function writeStateAtomically(state, filePath) {
  validateFreeModelPoolState(state);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function updateState({ stateFile, quarantineFile }, update) {
  return withQuarantineWriteLock(quarantineFile, async () => {
    const state = await readFreeModelPoolState(stateFile);
    const result = await update(state);
    validateFreeModelPoolState(state);
    await writeStateAtomically(state, stateFile);
    return result;
  });
}

export function utcDate(now = Date.now()) {
  validateNow(now);
  return new Date(now).toISOString().slice(0, 10);
}

export async function isOpenRouterQuotaExhaustedToday({ stateFile = DEFAULT_POOL_STATE_FILE, now = Date.now() } = {}) {
  const state = await readFreeModelPoolState(stateFile);
  return state.openRouterExhaustedUtcDate === utcDate(now);
}

export async function markOpenRouterQuotaExhausted({
  stateFile = DEFAULT_POOL_STATE_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  now = Date.now(),
} = {}) {
  const date = utcDate(now);
  await updateState({ stateFile, quarantineFile }, (state) => {
    state.openRouterExhaustedUtcDate = date;
  });
  return date;
}

export async function getKiloCooldownUntil({ stateFile = DEFAULT_POOL_STATE_FILE, now = Date.now() } = {}) {
  validateNow(now);
  const state = await readFreeModelPoolState(stateFile);
  const until = state.kiloCooldownUntil === null ? 0 : Date.parse(state.kiloCooldownUntil);
  return until > now ? until : null;
}

export async function markKiloRateLimited({
  stateFile = DEFAULT_POOL_STATE_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  now = Date.now(),
} = {}) {
  validateNow(now);
  const until = new Date(now + KILO_COOLDOWN_MS).toISOString();
  await updateState({ stateFile, quarantineFile }, (state) => {
    state.kiloCooldownUntil = until;
  });
  return until;
}

export async function clearExpiredOpenRouterQuota({
  stateFile = DEFAULT_POOL_STATE_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  now = Date.now(),
} = {}) {
  const today = utcDate(now);
  return updateState({ stateFile, quarantineFile }, (state) => {
    if (state.openRouterExhaustedUtcDate === null || state.openRouterExhaustedUtcDate === today) return false;
    state.openRouterExhaustedUtcDate = null;
    return true;
  });
}

export async function recordModelFailure({
  source,
  model,
  rateLimit = false,
  stateFile = DEFAULT_POOL_STATE_FILE,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  now = Date.now(),
}) {
  validateNow(now);
  if (!QUARANTINE_SOURCES.has(source) || typeof model !== 'string' || !model.trim()) {
    throw new Error('A supported source and non-empty model are required to record a failure');
  }
  if (rateLimit && source !== 'openrouter')
    throw new Error('Rate-limit windows are tracked only for OpenRouter models');
  const operatorManaged = isOperatorOnlyQuarantine(source, model);

  return withQuarantineWriteLock(quarantineFile, async (saveQuarantineState) => {
    const state = await readFreeModelPoolState(stateFile);
    pruneFailureTimes(state, now);
    const key = quarantineKey(source, model);
    const entry = (state.modelFailures[key] ??= { failures: [], rateLimits: [] });
    if (operatorManaged && entry.failures.length >= MODEL_FAILURE_THRESHOLD) entry.failures.shift();
    entry.failures.push(now);
    if (rateLimit) entry.rateLimits.push(now);
    const failureCount = entry.failures.length;
    const rateLimitCount = entry.rateLimits.length;
    let quarantineHours = null;
    let reason = null;
    if (failureCount >= MODEL_FAILURE_THRESHOLD) {
      quarantineHours = MODEL_FAILURE_QUARANTINE_HOURS;
      reason = 'poor_performance';
    } else if (rateLimitCount >= OPENROUTER_RATE_LIMIT_FAILURE_THRESHOLD) {
      quarantineHours = OPENROUTER_RATE_LIMIT_QUARANTINE_HOURS;
      reason = 'rate_limit';
    }
    if (operatorManaged) quarantineHours = null;
    if (quarantineHours !== null) {
      const quarantineState = await loadQuarantineStateLocked(quarantineFile, now);
      upsertQuarantine(quarantineState, { source, model, reason, hours: quarantineHours, now });
      await saveQuarantineState(quarantineState);
      delete state.modelFailures[key];
    }
    pruneFailureTimes(state, now);
    boundTrackedModels(state);
    await writeStateAtomically(state, stateFile);
    return {
      failureCount,
      rateLimitCount,
      quarantineHours,
      ...(operatorManaged ? { operatorManaged: true } : {}),
    };
  });
}
