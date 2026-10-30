import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyCandidates,
  classifyFailure,
  isPathInside,
  readQuarantineSnapshot,
  runSweep,
  scanCodexFailures,
  scanKiloFailures,
  scanKiloLogFailures,
  summarizeCodexRollout,
  summarizeFailureEvents,
} from '../cron/free-model-sweep.mjs';

describe('free-model-sweep evidence classification', () => {
  it('uses the session-first part index and keeps the exact part-time window', async () => {
    let invocation;
    const result = await scanKiloFailures(1_000_000, 4_600_000, {
      resolveDatabase: async () => '/readonly/kilo.db',
      run: async (...args) => {
        invocation = args;
        return '[]';
      },
    });

    expect(result.rows).toEqual([]);
    expect(invocation[0]).toBe('sqlite3');
    expect(invocation[1].slice(0, 3)).toEqual(['-readonly', '-json', '/readonly/kilo.db']);
    expect(invocation[1].at(-1)).toContain('CROSS JOIN part AS p INDEXED BY part_session_idx');
    expect(invocation[1].at(-1)).toContain('p.time_created >= 1000000');
    expect(invocation[1].at(-1)).toContain('p.time_created < 4600000');
    expect(invocation[1].at(-1)).toContain('s.time_updated >= 1000000');
    expect(invocation[1].at(-1)).not.toContain('JOIN message');
  });

  it('extracts safe provider errors from a bounded Kilo log and excludes own run trees', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-sweep-'));
    const logPath = join(directory, 'opencode.log');
    const now = Date.parse('2026-10-29T12:00:00.000Z');
    const line = (minute, session, run) =>
      `timestamp=2026-10-29T11:${String(minute).padStart(2, '0')}:00.000Z level=ERROR providerID=kilo modelID=poolside/laguna-s-2.1:free session.id=${session} run=${run} error.error="Rate limit exceeded"`;

    try {
      await writeFile(
        logPath,
        [
          'timestamp=2026-10-29T10:59:59.000Z level=INFO providerID=kilo modelID=poolside/laguna-s-2.1:free session.id=before-window run=old-run',
          line(1, 'self', 'own-run'),
          line(2, 'child-session', 'own-run'),
          line(3, 'session-a', 'run-a'),
          line(4, 'session-b', 'run-a'),
          line(5, 'session-c', 'run-b'),
          line(6, 'session-c', 'run-b'),
        ].join('\n'),
        'utf8'
      );

      const result = await scanKiloLogFailures(now - 60 * 60 * 1000, now, {
        logPath,
        sessionId: 'self',
      });

      expect(result.complete).toBe(true);
      expect(result.events).toHaveLength(4);
      expect(result.ignored).toEqual({ selfSession: 1, selfRun: 1 });
      expect(result.events.every((event) => event.model === 'poolside/laguna-s-2.1:free')).toBe(true);
      expect(result.events.every((event) => !('raw' in event) && !('error' in event))).toBe(true);
      expect(classifyCandidates(result.events)[0]).toMatchObject({
        rateLimitEvents: 4,
        sessionCount: 3,
        runCount: 2,
        recommendation: 'manual_review_candidate',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects Codex rollout paths outside the canonical home', () => {
    expect(isPathInside('/Users/example/.codex', '/Users/example/.codex')).toBe(true);
    expect(isPathInside('/Users/example/.codex', '/Users/example/.codex/sessions/a.jsonl')).toBe(true);
    expect(isPathInside('/Users/example/.codex', '/Users/example/.codex-escape/private')).toBe(false);
    expect(isPathInside('/Users/example/.codex', '/etc/passwd')).toBe(false);
  });

  it('treats an absent optional Codex store as a skipped scan', async () => {
    await expect(
      scanCodexFailures(0, 1, {
        resolveDatabase: async () => null,
      })
    ).resolves.toEqual({
      status: 'no Codex state database found; scan skipped',
      complete: true,
      events: [],
    });
  });

  it('rejects a Codex database symlink outside CODEX_HOME before querying it', async () => {
    const commands = [];
    await expect(
      scanCodexFailures(0, 1, {
        codexHome: '/codex',
        resolveDatabase: async () => '/codex/state_1.sqlite',
        realpathPath: async (path) => (path === '/codex/state_1.sqlite' ? '/outside/evil.sqlite' : path),
        run: async (...args) => commands.push(args),
      })
    ).rejects.toThrow(/database path escapes/);
    expect(commands).toEqual([]);
  });

  it('reads missing quarantine state without creating or migrating a file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-sweep-quarantine-'));
    const quarantinePath = join(directory, 'quarantine.json');

    try {
      expect(await readQuarantineSnapshot(quarantinePath)).toEqual([]);
      await expect(readFile(quarantinePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports expired quarantine entries without pruning or rewriting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-sweep-quarantine-'));
    const quarantinePath = join(directory, 'quarantine.json');
    const now = Date.parse('2026-10-29T12:00:00.000Z');
    const entry = {
      source: 'kilo',
      model: 'poolside/laguna-s-2.1:free',
      reason: 'rate_limit',
      quarantinedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(now - 60 * 60 * 1000).toISOString(),
    };

    try {
      await writeFile(
        quarantinePath,
        JSON.stringify({ schemaVersion: 1, entries: { 'kilo:poolside/laguna-s-2.1:free': entry } })
      );

      expect(await readQuarantineSnapshot(quarantinePath, now)).toEqual([
        {
          key: 'kilo:poolside/laguna-s-2.1:free',
          reason: 'rate_limit',
          expiresAt: entry.expiresAt,
          active: false,
        },
      ]);
      expect(JSON.parse(await readFile(quarantinePath, 'utf8')).entries['kilo:poolside/laguna-s-2.1:free']).toEqual(
        entry
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('marks escaped Codex rollout paths incomplete without reading them', async () => {
    const commands = [];
    const result = await scanCodexFailures(0, 1, {
      codexHome: '/codex',
      resolveDatabase: async () => '/codex/state_1.sqlite',
      realpathPath: async (path) => (path === '/codex/sessions/escape.jsonl' ? '/outside/private' : path),
      run: async (_command, args) => {
        commands.push(args);
        const sql = args.at(-1);
        if (sql === 'PRAGMA table_info(threads);') {
          return JSON.stringify([{ name: 'id' }, { name: 'rollout_path' }, { name: 'updated_at' }]);
        }
        if (sql === 'SELECT status FROM backfill_state WHERE id = 1;') {
          return JSON.stringify([{ status: 'complete' }]);
        }
        return JSON.stringify([{ thread_id: 'thread', rollout_path: '/codex/sessions/escape.jsonl' }]);
      },
      statPath: async () => {
        throw new Error('must not stat escaped path');
      },
      readText: async () => {
        throw new Error('must not read escaped path');
      },
    });

    expect(result.complete).toBe(false);
    expect(result.status).toContain('1 path outside Codex home');
    expect(commands).toHaveLength(3);
  });

  it('assembles an incomplete scan report without touching real stores or network', async () => {
    let writtenRun;
    const { run, reportPath } = await runSweep({
      now: Date.parse('2026-10-29T10:00:00.000Z'),
      sessionId: 'current-session',
      scanKilo: async () => ({ rows: [] }),
      scanKiloLog: async () => ({
        status: 'test log complete',
        complete: true,
        events: [],
        ignored: { selfSession: 0, selfRun: 0 },
      }),
      scanCodex: async () => ({ status: 'backfill incomplete', complete: false, events: [] }),
      readQuarantine: async () => [],
      healthSnapshot: async () => ({ quota: { reason: 'no_key' }, catalogs: { models: [] } }),
      write: async (value) => {
        writtenRun = value;
        return '/private/sweep-report.md';
      },
    });

    expect(run).toMatchObject({
      kiloComplete: true,
      kiloLogComplete: true,
      codexComplete: false,
      kiloStatus: 'read-only SQLite scan complete (0 error record(s))',
      kiloLogStatus: 'test log complete',
      codexStatus: 'backfill incomplete',
      events: [],
      candidates: [],
      quarantine: [],
    });
    expect(writtenRun).toBe(run);
    expect(reportPath).toBe('/private/sweep-report.md');
  });

  it('records scan and quarantine-read failures without running live health requests', async () => {
    let healthCalled = false;
    const { run } = await runSweep({
      now: Date.parse('2026-10-29T10:00:00.000Z'),
      sessionId: 'test-session',
      scanKilo: async () => {
        throw new Error('/private/kilo.db permission denied');
      },
      scanKiloLog: async () => ({ status: 'test log complete', complete: true, events: [], ignored: {} }),
      scanCodex: async () => {
        throw new Error('/private/codex path invalid');
      },
      readQuarantine: async () => {
        throw new Error('/private/quarantine read failure');
      },
      healthSnapshot: async () => {
        healthCalled = true;
        return {};
      },
      write: async () => '/private/failure-report.md',
    });

    expect(run).toMatchObject({
      kiloComplete: false,
      codexComplete: false,
      kiloStatus: 'incomplete',
      codexStatus: expect.stringContaining('failed'),
      quarantineReadError: expect.stringContaining('failed'),
    });
    expect(run.error).not.toContain('/private');
    expect(run.quarantineReadError).not.toContain('/private');
    expect(healthCalled).toBe(false);
  });

  it('accepts explicit model rate limits but not a bare 429', () => {
    expect(classifyFailure('[Poolside] Rate limit exceeded')).toBe('explicit_upstream_rate_limit');
    expect(classifyFailure('temporarily rate-limited upstream')).toBe('explicit_upstream_rate_limit');
    expect(classifyFailure('HTTP 429')).toBe('unclassified');
  });

  it('keeps account-wide quota failures separate from model rate limits', () => {
    expect(classifyFailure('OpenRouter daily free-model quota exceeded')).toBe('account_quota');
  });

  it('requires exact free routes and excludes duplicate and own-session records', () => {
    const rows = [
      {
        session_id: 'session-a',
        part_id: 'part-a',
        occurred_at: '2026-10-29 10:00:00Z',
        provider_id: 'kilo',
        model_id: 'poolside/laguna-s-2.1:free',
        error: '[Poolside] Rate limit exceeded',
      },
      {
        session_id: 'session-a',
        part_id: 'part-a',
        occurred_at: '2026-10-29 10:00:00Z',
        provider_id: 'kilo',
        model_id: 'poolside/laguna-s-2.1:free',
        error: '[Poolside] Rate limit exceeded',
      },
      {
        session_id: 'self',
        part_id: 'part-self',
        occurred_at: '2026-10-29 10:01:00Z',
        provider_id: 'kilo',
        model_id: 'poolside/laguna-s-2.1:free',
        error: '[Poolside] Rate limit exceeded',
      },
      {
        session_id: 'session-paid',
        part_id: 'part-paid',
        occurred_at: '2026-10-29 10:02:00Z',
        provider_id: 'openai',
        model_id: 'gpt-6-luna',
        error: '[Poolside] Rate limit exceeded',
      },
      {
        session_id: 'session-paid-route',
        part_id: 'part-paid-route',
        occurred_at: '2026-10-29 10:03:00Z',
        provider_id: 'openrouter',
        model_id: 'openai/gpt-4o',
        error: '[OpenAI] Rate limit exceeded',
      },
    ];

    const summary = summarizeFailureEvents(rows, { ownSessionId: 'self' });
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0]).toMatchObject({
      source: 'kilo',
      model: 'poolside/laguna-s-2.1:free',
      classification: 'explicit_upstream_rate_limit',
      sessionId: 'session-a',
      partId: 'part-a',
      occurredAt: '2026-10-29T10:00:00.000Z',
    });
    expect(summary.ignored).toMatchObject({ duplicate: 1, ownSession: 1, unsupportedSource: 1, nonFreeRoute: 1 });
  });

  it('suggests manual review only after independent repeated model-specific failures', () => {
    const events = [
      {
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's1',
        runId: 'r1',
        partId: 'p1',
        occurredAt: 't1',
      },
      {
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's2',
        runId: 'r2',
        partId: 'p2',
        occurredAt: 't2',
      },
      {
        source: 'openrouter',
        model: 'google/gemma-4-31b-it:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's3',
        partId: 'p3',
        occurredAt: 't3',
      },
      {
        source: 'openrouter',
        model: 'google/gemma-4-31b-it:free',
        classification: 'account_quota',
        sessionId: 's4',
        partId: 'p4',
        occurredAt: 't4',
      },
    ];

    expect(classifyCandidates(events)).toEqual([
      expect.objectContaining({
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        rateLimitEvents: 2,
        sessionCount: 2,
        recommendation: 'manual_review_candidate',
      }),
      expect.objectContaining({
        source: 'openrouter',
        model: 'google/gemma-4-31b-it:free',
        rateLimitEvents: 1,
        quotaEvents: 1,
        recommendation: 'no_quarantine_insufficient_independent_evidence',
      }),
    ]);
  });

  it('requires distinct runs, not just subagent sessions, for quarantine review candidates', () => {
    const candidate = classifyCandidates([
      {
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's1',
        runId: 'same-run',
        eventId: 'e1',
        occurredAt: 't1',
      },
      {
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's2',
        runId: 'same-run',
        eventId: 'e2',
        occurredAt: 't2',
      },
      {
        source: 'kilo',
        model: 'poolside/laguna-s-2.1:free',
        classification: 'explicit_upstream_rate_limit',
        sessionId: 's3',
        runId: 'same-run',
        eventId: 'e3',
        occurredAt: 't3',
      },
    ])[0];

    expect(candidate).toMatchObject({
      rateLimitEvents: 3,
      sessionCount: 3,
      runCount: 1,
      recommendation: 'needs_manual_triage_single_or_unlinked_run',
    });
  });

  it('keeps Codex free-model evidence unattributed unless its event names one exact model', () => {
    const rollout = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-10-29T10:00:00.000Z',
        payload: {
          id: 'record-1',
          type: 'custom_tool_call_output',
          output: '[Poolside] Rate limit exceeded for poolside/laguna-s-2.1:free',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-10-29T10:01:00.000Z',
        payload: {
          id: 'record-2',
          type: 'custom_tool_call_output',
          output: 'Rate limit exceeded while comparing poolside/laguna-s-2.1:free and google/gemma-4-31b-it:free',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { id: 'record-3', type: 'message', content: 'Rate limit exceeded for poolside/laguna-s-2.1:free' },
      }),
    ].join('\n');

    expect(summarizeCodexRollout(rollout, { threadId: 'thread-1' })).toEqual([
      {
        threadId: 'thread-1',
        recordId: 'record-1',
        model: 'poolside/laguna-s-2.1:free',
        source: 'unknown',
        classification: 'explicit_upstream_rate_limit',
        occurredAt: '2026-10-29T10:00:00.000Z',
      },
    ]);
  });

  it('ignores Codex failure records outside the preceding-hour window', () => {
    const rollout = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-10-29T09:59:59.999Z',
        payload: {
          id: 'old-record',
          type: 'custom_tool_call_output',
          output: 'Rate limit exceeded for poolside/laguna-s-2.1:free',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-10-29T10:00:00.000Z',
        payload: {
          id: 'current-record',
          type: 'custom_tool_call_output',
          output: 'Rate limit exceeded for poolside/laguna-s-2.1:free',
        },
      }),
    ].join('\n');

    expect(
      summarizeCodexRollout(rollout, {
        threadId: 'thread-3',
        windowStart: Date.parse('2026-10-29T10:00:00.000Z'),
        windowEnd: Date.parse('2026-10-29T11:00:00.000Z'),
      }).map((event) => event.recordId)
    ).toEqual(['current-record']);
  });

  it('extracts the Kilo internal free route from Codex tool errors', () => {
    const rollout = JSON.stringify({
      type: 'response_item',
      timestamp: '2026-10-29T10:00:00.000Z',
      payload: {
        id: 'record-internal',
        type: 'custom_tool_call_output',
        output: 'temporarily rate-limited upstream: kilo-auto/free',
      },
    });

    expect(summarizeCodexRollout(rollout, { threadId: 'thread-2' })[0]).toMatchObject({
      model: 'kilo-auto/free',
      source: 'unknown',
      classification: 'explicit_upstream_rate_limit',
    });
  });
});
