import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearExpiredOpenRouterQuota,
  getKiloCooldownUntil,
  isOpenRouterQuotaExhaustedToday,
  KILO_COOLDOWN_MS,
  markKiloRateLimited,
  markOpenRouterQuotaExhausted,
  MODEL_FAILURE_QUARANTINE_HOURS,
  OPENROUTER_RATE_LIMIT_QUARANTINE_HOURS,
  readFreeModelPoolState,
  recordModelFailure,
} from '../lib/free-model-pool-state.mjs';
import { readQuarantineState } from '../lib/free-model-quarantine.mjs';

async function withStateFiles(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-state-'));
  try {
    await callback({
      directory,
      quarantineFile: join(directory, 'quarantine.json'),
      stateFile: join(directory, 'pool-state.json'),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('free-model pool persistent state', () => {
  it('persists the Kilo one-hour cooldown and makes it inactive after expiry', async () => {
    await withStateFiles(async ({ quarantineFile, stateFile }) => {
      const now = Date.parse('2026-10-26T12:00:00.000Z');
      const until = await markKiloRateLimited({ quarantineFile, stateFile, now });
      expect(until).toBe(new Date(now + KILO_COOLDOWN_MS).toISOString());
      expect(await getKiloCooldownUntil({ stateFile, now: now + KILO_COOLDOWN_MS - 1 })).toBe(now + KILO_COOLDOWN_MS);
      expect(await getKiloCooldownUntil({ stateFile, now: now + KILO_COOLDOWN_MS })).toBeNull();
      expect(await readFreeModelPoolState(stateFile)).toMatchObject({ kiloCooldownUntil: until });
    });
  });

  it('stores OpenRouter exhaustion as a UTC date that expires without a scheduled reset', async () => {
    await withStateFiles(async ({ quarantineFile, stateFile }) => {
      const exhaustedAt = Date.parse('2026-10-26T23:59:00.000Z');
      expect(await markOpenRouterQuotaExhausted({ quarantineFile, stateFile, now: exhaustedAt })).toBe('2026-10-26');
      expect(await isOpenRouterQuotaExhaustedToday({ stateFile, now: exhaustedAt })).toBe(true);
      expect(await isOpenRouterQuotaExhaustedToday({ stateFile, now: Date.parse('2026-10-27T00:00:00.000Z') })).toBe(
        false
      );
      expect(
        await clearExpiredOpenRouterQuota({
          quarantineFile,
          stateFile,
          now: Date.parse('2026-10-27T00:00:00.000Z'),
        })
      ).toBe(true);
      expect((await readFreeModelPoolState(stateFile)).openRouterExhaustedUtcDate).toBeNull();
    });
  });

  it('quarantines an OpenRouter model after three attributable rate-limit failures in a rolling three-hour window', async () => {
    await withStateFiles(async ({ quarantineFile, stateFile }) => {
      const now = Date.parse('2026-10-26T12:00:00.000Z');
      await recordModelFailure({
        source: 'openrouter',
        model: 'vendor/model:free',
        rateLimit: true,
        quarantineFile,
        stateFile,
        now: now - 4 * 60 * 60 * 1000,
      });
      await recordModelFailure({
        source: 'openrouter',
        model: 'vendor/model:free',
        rateLimit: true,
        quarantineFile,
        stateFile,
        now: now - 4 * 60 * 60 * 1000 + 1,
      });
      const recentOne = await recordModelFailure({
        source: 'openrouter',
        model: 'vendor/model:free',
        rateLimit: true,
        quarantineFile,
        stateFile,
        now,
      });
      expect(recentOne).toMatchObject({ failureCount: 3, rateLimitCount: 1, quarantineHours: null });

      await recordModelFailure({
        source: 'openrouter',
        model: 'vendor/model:free',
        rateLimit: true,
        quarantineFile,
        stateFile,
        now: now + 1,
      });
      const quarantined = await recordModelFailure({
        source: 'openrouter',
        model: 'vendor/model:free',
        rateLimit: true,
        quarantineFile,
        stateFile,
        now: now + 2,
      });
      expect(quarantined).toMatchObject({ rateLimitCount: 3, quarantineHours: OPENROUTER_RATE_LIMIT_QUARANTINE_HOURS });
      const quarantine = await readQuarantineState(quarantineFile);
      expect(quarantine.entries['openrouter:vendor/model:free'].expiresAt).toBe(
        new Date(now + 2 + OPENROUTER_RATE_LIMIT_QUARANTINE_HOURS * 60 * 60 * 1000).toISOString()
      );
      expect((await readFreeModelPoolState(stateFile)).modelFailures['openrouter:vendor/model:free']).toBeUndefined();
    });
  });

  it('quarantines a model for seven days after 250 attributable failures in seven days', async () => {
    await withStateFiles(async ({ quarantineFile, stateFile }) => {
      const now = Date.parse('2026-10-26T12:00:00.000Z');
      let outcome;
      for (let index = 0; index < 250; index += 1) {
        outcome = await recordModelFailure({
          source: 'opencode',
          model: 'opencode/model-free',
          quarantineFile,
          stateFile,
          now: now + index,
        });
      }
      expect(outcome).toMatchObject({ failureCount: 250, quarantineHours: MODEL_FAILURE_QUARANTINE_HOURS });
      const quarantine = await readQuarantineState(quarantineFile);
      expect(quarantine.entries['opencode:opencode/model-free'].expiresAt).toBe(
        new Date(now + 249 + MODEL_FAILURE_QUARANTINE_HOURS * 60 * 60 * 1000).toISOString()
      );
    });
  });

  it('leaves Kilo Nemotron 3 Ultra quarantine decisions to the operator', async () => {
    await withStateFiles(async ({ quarantineFile, stateFile }) => {
      const now = Date.parse('2026-10-26T12:00:00.000Z');
      let outcome;
      for (let index = 0; index < 251; index += 1) {
        outcome = await recordModelFailure({
          source: 'kilo',
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          quarantineFile,
          stateFile,
          now: now + index,
        });
      }

      expect(outcome).toMatchObject({
        failureCount: 250,
        rateLimitCount: 0,
        quarantineHours: null,
        operatorManaged: true,
      });
      expect(
        (await readFreeModelPoolState(stateFile)).modelFailures['kilo:nvidia/nemotron-3-ultra-550b-a55b:free'].failures
      ).toHaveLength(250);
      expect(
        (await readQuarantineState(quarantineFile)).entries['kilo:nvidia/nemotron-3-ultra-550b-a55b:free']
      ).toBeUndefined();
    });
  });
});
