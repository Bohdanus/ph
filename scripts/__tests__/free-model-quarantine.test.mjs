import { describe, expect, it } from 'vitest';
import {
  activeQuarantineKeys,
  MAX_QUARANTINE_HOURS,
  quarantineKey,
  readQuarantineState,
  releaseQuarantine,
  removeExpiredQuarantines,
  upsertQuarantine,
  validateQuarantineState,
  writeQuarantineState,
} from '../lib/free-model-quarantine.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('free-model quarantine lifecycle', () => {
  it('starts empty only when the state file is missing', async () => {
    const state = await readQuarantineState('/path/that/does/not/exist/quarantine.json');
    expect(state).toEqual({ schemaVersion: 1, entries: {} });
  });

  it('rejects malformed or unsupported quarantine state', () => {
    expect(() => validateQuarantineState({ schemaVersion: 2, entries: {} })).toThrow(/Unsupported/);
    expect(() => validateQuarantineState({ schemaVersion: 1, entries: { invalid: {} } })).toThrow(/Invalid/);
    expect(() =>
      validateQuarantineState({
        schemaVersion: 1,
        entries: {
          'kilo:long:free': {
            source: 'kilo',
            model: 'long:free',
            reason: 'rate_limit',
            quarantinedAt: '2026-10-26T12:00:00.000Z',
            expiresAt: '2026-10-30T12:00:00.000Z',
          },
        },
      })
    ).toThrow(/Invalid/);
  });

  it('sets a six-hour default expiry and refuses a quarantine beyond three days', () => {
    const state = { schemaVersion: 1, entries: {} };
    const now = Date.parse('2026-10-26T12:00:00.000Z');
    const key = upsertQuarantine(state, {
      source: 'openrouter',
      model: 'vendor/model:free',
      reason: 'rate_limit',
      now,
    });
    expect(key).toBe('openrouter:vendor/model:free');
    expect(state.entries[key].expiresAt).toBe('2026-10-26T18:00:00.000Z');
    expect(() =>
      upsertQuarantine(state, {
        source: 'openrouter',
        model: 'vendor/model:free',
        reason: 'rate_limit',
        hours: MAX_QUARANTINE_HOURS + 1,
        now,
      })
    ).toThrow(/no more than 72/);
    expect(() =>
      upsertQuarantine(state, { source: 'openrouter', model: 'x:free', reason: 'context_exhausted', now })
    ).toThrow(/supported quarantine reason/);
  });

  it('makes expired routes eligible and prunes them only on request', () => {
    const state = { schemaVersion: 1, entries: {} };
    const now = Date.parse('2026-10-26T12:00:00.000Z');
    const expiredKey = upsertQuarantine(state, {
      source: 'kilo',
      model: 'old:free',
      reason: 'provider_outage',
      hours: 1,
      now: now - 2 * 60 * 60 * 1000,
    });
    const activeKey = upsertQuarantine(state, {
      source: 'kilo',
      model: 'new:free',
      reason: 'rate_limit',
      now,
    });

    expect(activeQuarantineKeys(state, now)).toEqual(new Set([activeKey]));
    expect(state.entries[expiredKey]).toBeDefined();
    expect(removeExpiredQuarantines(state, now)).toBe(1);
    expect(state.entries[expiredKey]).toBeUndefined();
    expect(releaseQuarantine(state, 'kilo', 'new:free')).toBe(true);
    expect(releaseQuarantine(state, 'kilo', 'new:free')).toBe(false);
  });

  it('writes and rereads the versioned state atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-'));
    const filePath = join(directory, 'state.json');
    const state = { schemaVersion: 1, entries: {} };
    const key = upsertQuarantine(state, {
      source: 'groq',
      model: 'openai/gpt-oss-20b',
      reason: 'model_unavailable',
      now: Date.parse('2026-10-26T12:00:00.000Z'),
    });

    try {
      await writeQuarantineState(state, filePath);
      const reread = await readQuarantineState(filePath);
      expect(reread.entries[key]).toEqual(state.entries[key]);
      expect(await readFile(filePath, 'utf8')).toContain('"schemaVersion": 1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses a source-qualified key so provider routes do not poison each other', () => {
    expect(quarantineKey('kilo', 'vendor/model:free')).not.toBe(quarantineKey('openrouter', 'vendor/model:free'));
  });
});
