import { describe, expect, it } from 'vitest';
import {
  activeQuarantineKeys,
  DEFAULT_QUARANTINE_FILE,
  DEFAULT_QUARANTINE_HOURS,
  MAX_QUARANTINE_HOURS,
  quarantineKey,
  loadQuarantineState,
  readQuarantineState,
  releaseQuarantine,
  removeExpiredQuarantines,
  upsertQuarantine,
  validateQuarantineState,
  withQuarantineWriteLock,
  writeQuarantineState,
} from '../lib/free-model-quarantine.mjs';
import { main as runQuarantineCli } from '../free-model-quarantine.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

describe('free-model quarantine lifecycle', () => {
  it('starts empty only when the state file is missing', async () => {
    const state = await readQuarantineState('/path/that/does/not/exist/quarantine.json');
    expect(state).toEqual({ schemaVersion: 1, entries: {} });
    await expect(loadQuarantineState('/path/that/does/not/exist/quarantine.json', Number.NaN)).rejects.toThrow(
      /finite epoch milliseconds/
    );
  });

  it('shares the default state file across managed worktrees', () => {
    const cwd = resolve(process.cwd());
    const worktreesMarker = `${sep}.kilo${sep}worktrees${sep}`;
    const worktreesIndex = cwd.lastIndexOf(worktreesMarker);
    const projectRoot = worktreesIndex < 0 ? cwd : cwd.slice(0, worktreesIndex);
    expect(DEFAULT_QUARANTINE_FILE).toBe(
      process.env.FREE_MODEL_QUARANTINE_FILE
        ? resolve(process.env.FREE_MODEL_QUARANTINE_FILE)
        : join(projectRoot, '.kilo', 'free-model-quarantine.json')
    );
  });

  it('migrates legacy hard-coded quarantines once with a three-day expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-migration-'));
    const filePath = join(directory, 'state.json');
    const now = Date.parse('2026-10-26T12:00:00.000Z');

    try {
      const [state, concurrentLoad] = await Promise.all([
        loadQuarantineState(filePath, now),
        loadQuarantineState(filePath, now),
      ]);
      expect(concurrentLoad).toEqual(state);
      expect(Object.keys(state.entries)).toEqual([
        'kilo:kilo-auto/free',
        'kilo:nvidia/nemotron-3.5-super-vl:free',
        'kilo:recursive/flint-v1.0:free',
      ]);
      expect(activeQuarantineKeys(state, now).size).toBe(3);
      expect(activeQuarantineKeys(state, now + MAX_QUARANTINE_HOURS * 60 * 60 * 1000).size).toBe(0);
      expect(await readQuarantineState(filePath)).toEqual(state);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not reseed an existing, intentionally empty state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-empty-'));
    const filePath = join(directory, 'state.json');

    try {
      const emptyState = { schemaVersion: 1, entries: {} };
      await writeQuarantineState(emptyState, filePath);
      expect(await loadQuarantineState(filePath)).toEqual(emptyState);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
    expect(() =>
      upsertQuarantine(
        { schemaVersion: 1, entries: {} },
        {
          source: 'kilo',
          model: 12,
          reason: 'rate_limit',
        }
      )
    ).toThrow(/supported quarantine reason/);
    expect(() =>
      upsertQuarantine(
        { schemaVersion: 1, entries: {} },
        {
          source: 'kilo',
          model: 'model:free',
          reason: 'rate_limit',
          now: Number.NaN,
        }
      )
    ).toThrow(/finite epoch milliseconds/);
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
      source: 'openrouter',
      model: 'vendor/model:free',
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

  it('provides help and rejects invalid CLI arguments as usage errors', async () => {
    const output = { stdout: { value: '' }, stderr: { value: '' } };
    output.stdout.write = (text) => {
      output.stdout.value += text;
    };
    output.stderr.write = (text) => {
      output.stderr.value += text;
    };

    expect(await runQuarantineCli(['--help'], output)).toBe(0);
    expect(output.stdout.value).toContain('free-model-quarantine.mjs add');
    expect(await runQuarantineCli(['release', '--source', 'openrouter'], output)).toBe(2);
    expect(output.stderr.value).toContain('Release requires');
    expect(
      await runQuarantineCli(['add', '--source', 'unknown', '--model', 'x:free', '--reason', 'rate_limit'], output)
    ).toBe(2);
  });

  it('supports list, add, release, and prune against an injected state path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-cli-'));
    const filePath = join(directory, 'state.json');
    const emptyState = { schemaVersion: 1, entries: {} };
    await writeQuarantineState(emptyState, filePath);
    const output = { stdout: { value: '' }, stderr: { value: '' } };
    output.stdout.write = (text) => {
      output.stdout.value += text;
    };
    output.stderr.write = (text) => {
      output.stderr.value += text;
    };

    try {
      expect(
        await runQuarantineCli(
          ['add', '--source', 'openrouter', '--model', 'vendor/model:free', '--reason', 'rate_limit'],
          output,
          { quarantineFile: filePath }
        )
      ).toBe(0);
      expect(output.stdout.value).toContain(`openrouter:vendor/model:free`);

      output.stdout.value = '';
      expect(await runQuarantineCli(['list'], output, { quarantineFile: filePath })).toBe(0);
      expect(JSON.parse(output.stdout.value).entries['openrouter:vendor/model:free'].reason).toBe('rate_limit');

      expect(
        await runQuarantineCli(['release', '--source', 'openrouter', '--model', 'vendor/model:free'], output, {
          quarantineFile: filePath,
        })
      ).toBe(0);

      const expiredState = { schemaVersion: 1, entries: {} };
      upsertQuarantine(expiredState, {
        source: 'kilo',
        model: 'expired:free',
        reason: 'provider_outage',
        hours: DEFAULT_QUARANTINE_HOURS,
        now: Date.now() - 7 * 60 * 60 * 1000,
      });
      await writeQuarantineState(expiredState, filePath);
      expect(await runQuarantineCli(['prune'], output, { quarantineFile: filePath })).toBe(0);
      expect((await readQuarantineState(filePath)).entries).toEqual({});
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a concurrent writer instead of allowing a lost quarantine update', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-lock-'));
    const filePath = join(directory, 'state.json');
    let signalAcquired;
    let releaseLock;
    const acquired = new Promise((resolveAcquired) => {
      signalAcquired = resolveAcquired;
    });

    try {
      const firstWriter = withQuarantineWriteLock(
        filePath,
        () =>
          new Promise((resolveRelease) => {
            releaseLock = resolveRelease;
            signalAcquired();
          })
      );
      await acquired;
      await expect(withQuarantineWriteLock(filePath, async () => {})).rejects.toThrow(/is locked/);
      await expect(writeQuarantineState({ schemaVersion: 1, entries: {} }, filePath)).rejects.toThrow(/is locked/);
      releaseLock();
      await expect(firstWriter).resolves.toBeUndefined();
    } finally {
      releaseLock?.();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports that state may have committed when lock cleanup fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-cleanup-'));
    const filePath = join(directory, 'state.json');
    let updateCompleted = false;

    try {
      await expect(
        withQuarantineWriteLock(
          filePath,
          async () => {
            updateCompleted = true;
          },
          {
            unlink: async () => {
              const error = new Error('permission denied');
              error.code = 'EACCES';
              throw error;
            },
          }
        )
      ).rejects.toThrow(/state may be committed/);
      expect(updateCompleted).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves both operation and cleanup errors in a combined failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-aggregate-'));
    const filePath = join(directory, 'state.json');

    try {
      await expect(
        withQuarantineWriteLock(
          filePath,
          async () => {
            throw new Error('update failed');
          },
          {
            unlink: async () => {
              throw new Error('cleanup failed');
            },
          }
        )
      ).rejects.toThrow(/update failed; cleanup failed/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
