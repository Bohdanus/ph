import { link, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const MAX_QUARANTINE_HOURS = 72;
export const DEFAULT_QUARANTINE_HOURS = 6;
export const QUARANTINE_SOURCES = new Set(['kilo', 'openrouter', 'groq']);
export const QUARANTINE_REASONS = new Set(['rate_limit', 'provider_outage', 'model_unavailable', 'poor_performance']);

const WORKTREE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKTREES_MARKER = `${sep}.kilo${sep}worktrees${sep}`;
const WORKTREES_INDEX = WORKTREE_ROOT.lastIndexOf(WORKTREES_MARKER);
const PROJECT_ROOT = WORKTREES_INDEX < 0 ? WORKTREE_ROOT : WORKTREE_ROOT.slice(0, WORKTREES_INDEX);
const DEFAULT_FILE = resolve(
  process.env.FREE_MODEL_QUARANTINE_FILE || `${PROJECT_ROOT}/.kilo/free-model-quarantine.json`
);
const EMPTY_STATE = () => ({ schemaVersion: 1, entries: {} });
const LEGACY_QUARANTINES = [
  { source: 'kilo', model: 'kilo-auto/free' },
  { source: 'kilo', model: 'nvidia/nemotron-3.5-super-vl:free' },
  { source: 'kilo', model: 'recursive/flint-v1.0:free' },
];

export function quarantineKey(source, model) {
  return `${source}:${model}`;
}

export function validateQuarantineState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.schemaVersion !== 1) {
    throw new Error('Unsupported free-model quarantine file format');
  }
  if (!state.entries || typeof state.entries !== 'object' || Array.isArray(state.entries)) {
    throw new Error('Free-model quarantine entries must be an object');
  }
  for (const [key, entry] of Object.entries(state.entries)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !QUARANTINE_SOURCES.has(entry.source) ||
      typeof entry.model !== 'string' ||
      entry.model.length === 0 ||
      quarantineKey(entry.source, entry.model) !== key ||
      !QUARANTINE_REASONS.has(entry.reason) ||
      !Number.isFinite(Date.parse(entry.quarantinedAt)) ||
      !Number.isFinite(Date.parse(entry.expiresAt)) ||
      Date.parse(entry.expiresAt) <= Date.parse(entry.quarantinedAt) ||
      Date.parse(entry.expiresAt) - Date.parse(entry.quarantinedAt) > MAX_QUARANTINE_HOURS * 60 * 60 * 1000
    ) {
      throw new Error(`Invalid free-model quarantine entry: ${key}`);
    }
  }
  return state;
}

export async function readQuarantineState(filePath = DEFAULT_FILE, readFileImpl = readFile) {
  let text;
  try {
    text = await readFileImpl(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return EMPTY_STATE();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error('Free-model quarantine file is not valid JSON');
  }
  return validateQuarantineState(state);
}

export async function loadQuarantineState(filePath = DEFAULT_FILE, now = Date.now()) {
  try {
    await stat(filePath);
    return await readQuarantineState(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const state = EMPTY_STATE();
  for (const { source, model } of LEGACY_QUARANTINES) {
    upsertQuarantine(state, { source, model, reason: 'poor_performance', hours: MAX_QUARANTINE_HOURS, now });
  }
  await writeQuarantineStateIfAbsent(state, filePath);
  return readQuarantineState(filePath);
}

export function activeQuarantineKeys(state, now = Date.now()) {
  validateQuarantineState(state);
  return new Set(
    Object.entries(state.entries)
      .filter(([, entry]) => Date.parse(entry.expiresAt) > now)
      .map(([key]) => key)
  );
}

export function upsertQuarantine(state, { source, model, reason, hours = DEFAULT_QUARANTINE_HOURS, now = Date.now() }) {
  validateQuarantineState(state);
  if (!QUARANTINE_SOURCES.has(source) || !model || !QUARANTINE_REASONS.has(reason)) {
    throw new Error('A source, model, and supported quarantine reason are required');
  }
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_QUARANTINE_HOURS) {
    throw new Error(`Quarantine hours must be greater than 0 and no more than ${MAX_QUARANTINE_HOURS}`);
  }
  const quarantinedAt = new Date(now).toISOString();
  const key = quarantineKey(source, model);
  state.entries[key] = {
    source,
    model,
    reason,
    quarantinedAt,
    expiresAt: new Date(now + hours * 60 * 60 * 1000).toISOString(),
  };
  return key;
}

export function releaseQuarantine(state, source, model) {
  validateQuarantineState(state);
  const key = quarantineKey(source, model);
  if (!Object.hasOwn(state.entries, key)) return false;
  delete state.entries[key];
  return true;
}

export function removeExpiredQuarantines(state, now = Date.now()) {
  validateQuarantineState(state);
  let removed = 0;
  for (const [key, entry] of Object.entries(state.entries)) {
    if (Date.parse(entry.expiresAt) <= now) {
      delete state.entries[key];
      removed += 1;
    }
  }
  return removed;
}

export async function writeQuarantineState(state, filePath = DEFAULT_FILE) {
  validateQuarantineState(state);
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

export async function withQuarantineWriteLock(filePath, update) {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Quarantine state is locked by another or prior process (${lockPath})`);
    }
    throw error;
  }

  let updateFailed = false;
  try {
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    return await update();
  } catch (error) {
    updateFailed = true;
    throw error;
  } finally {
    await handle.close();
    try {
      await unlink(lockPath);
    } catch (error) {
      if (!updateFailed || error?.code !== 'ENOENT') throw error;
    }
  }
}

async function writeQuarantineStateIfAbsent(state, filePath) {
  validateQuarantineState(state);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    try {
      await link(tempPath, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

export { DEFAULT_FILE as DEFAULT_QUARANTINE_FILE };
