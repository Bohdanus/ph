import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const MAX_QUARANTINE_HOURS = 72;
export const DEFAULT_QUARANTINE_HOURS = 6;
export const QUARANTINE_SOURCES = new Set(['kilo', 'openrouter', 'groq']);
export const QUARANTINE_REASONS = new Set(['rate_limit', 'provider_outage', 'model_unavailable']);

const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../.kilo/free-model-quarantine.json');
const EMPTY_STATE = () => ({ schemaVersion: 1, entries: {} });

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

export { DEFAULT_FILE as DEFAULT_QUARANTINE_FILE };
