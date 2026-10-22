/**
 * Tests for `pollGptTokens`, which sums GPT token consumption out of a local Kilo
 * session database rather than a provider, so the arithmetic is checked against
 * a database this repo builds, not a credential we don't have.
 */
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_TOKEN_WINDOW_HOURS,
  pollGptTokens,
  resolveBudget,
  isPaidGpt,
  subagentTokenPolicy,
  TOKEN_READING_STALE_AFTER_MS,
} from '../lib/agent-board/token-poll.mjs';

const NOW = 1_700_000_000_000; // pinned; window = 5h = 18_000_000ms
const IN_WINDOW = NOW;
const OUT_OF_WINDOW = NOW - 20_000_000; // older than the 5h window

function sessionRow(id, { created = NOW, updated = NOW, parent = null, input = 0, output = 0 } = {}) {
  return {
    id,
    parent_id: parent,
    tokens_input: input,
    tokens_output: output,
    time_created: created,
    time_updated: updated,
  };
}

function messageRow(
  id,
  sessionId,
  modelID,
  providerID,
  {
    total,
    input = 0,
    output = 0,
    reasoning = 0,
    cacheRead = 0,
    cacheWrite = 0,
    created = NOW,
    completed = created,
    role = 'assistant',
  } = {}
) {
  const tokens = { input, output, reasoning, cache: { read: cacheRead, write: cacheWrite } };
  if (total !== undefined) tokens.total = total;
  const data = { role, modelID, providerID, tokens, time: { created } };
  if (completed !== null) data.time.completed = completed;
  return { id, sessionId, timeCreated: created, data: JSON.stringify(data) };
}

function buildSessionDb(sessions, messages) {
  const dir = mkdtempSync(join(tmpdir(), 'gpt-token-poll-'));
  const dbPath = join(dir, 'kilo.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session (
    id TEXT PRIMARY KEY, parent_id TEXT, tokens_input INTEGER, tokens_output INTEGER,
    time_created INTEGER, time_updated INTEGER
  );
  CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, data TEXT NOT NULL);
  CREATE INDEX message_session_time_created_id_idx ON message (session_id, time_created, id)`);
  const insertSession = db.prepare(
    'INSERT INTO session (id, parent_id, tokens_input, tokens_output, time_created, time_updated) VALUES (?,?,?,?,?,?)'
  );
  for (const row of sessions) {
    insertSession.run(row.id, row.parent_id, row.tokens_input, row.tokens_output, row.time_created, row.time_updated);
  }
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)');
  for (const row of messages) insertMessage.run(row.id, row.sessionId, row.timeCreated, row.data);
  db.close();
  return { dir, dbPath };
}

let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('isPaidGpt', () => {
  it('accepts exact OpenAI GPT model IDs and rejects other providers and families', () => {
    expect(isPaidGpt('gpt-6-astra-fast', 'openai')).toBe(true);
    expect(isPaidGpt('gpt-5.6-terra', 'openai')).toBe(true);
    expect(isPaidGpt('openai/gpt-6-sol', 'kilo')).toBe(true);
    expect(isPaidGpt('~openai/gpt-6-sol', 'kilo')).toBe(true);
    expect(isPaidGpt('gpt-6-sol:free', 'openai')).toBe(false);
    expect(isPaidGpt('openai/gpt-6-sol', 'kilo')).toBe(true);
    expect(isPaidGpt('gpt-6-luna', 'openrouter')).toBe(false);
    expect(isPaidGpt('poolside/laguna-s-2.1', 'kilo')).toBe(false);
    expect(isPaidGpt('gpt-6-sol', null)).toBe(false);
  });

  it('rejects non-GPT model IDs even on the OpenAI provider', () => {
    expect(isPaidGpt('text-embedding-3-large', 'openai')).toBe(false);
    expect(isPaidGpt('claude-sonnet-4.5', 'kilo')).toBe(false);
    expect(isPaidGpt(null, 'openai')).toBe(false);
  });
});

describe('resolveBudget', () => {
  const REAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...REAL_ENV };
  });

  it('takes an explicit value over env, and drops non-numeric env', () => {
    process.env.KILO_TOKEN_WINDOW_BUDGET = '750';
    expect(resolveBudget('1000')).toBe(1000);
    expect(resolveBudget(null)).toBe(750);
    delete process.env.KILO_TOKEN_WINDOW_BUDGET;
    expect(resolveBudget(null)).toBe(null);
    process.env.KILO_TOKEN_WINDOW_BUDGET = 'not-a-number';
    expect(() => resolveBudget(null)).toThrow(/KILO_TOKEN_WINDOW_BUDGET/);
    expect(() => resolveBudget('1.5')).toThrow(/safe integer/);
  });
});

describe('pollGptTokens', () => {
  it('sums per-message GPT tokens in the window, not cumulative session totals', () => {
    const { dir: d, dbPath } = buildSessionDb(
      [
        // A 100-hour session has huge cumulative totals, but only its two recent
        // message rows count toward this rolling window.
        sessionRow('root', { created: NOW - 100 * 3_600_000, updated: NOW, input: 90_000_000, output: 4_000_000 }),
        sessionRow('free', { created: NOW, updated: NOW }),
        sessionRow('other', { created: NOW, updated: NOW }),
        sessionRow('child', { created: IN_WINDOW, updated: NOW, parent: 'root' }),
        // Simulates the short insert-before-session-update race: the message is
        // current even though both session timestamps still look old.
        sessionRow('racing', { created: OUT_OF_WINDOW, updated: OUT_OF_WINDOW }),
      ],
      [
        messageRow('m1', 'root', 'gpt-6-luna', 'openai', { input: 100, output: 40, reasoning: 10, total: 150 }),
        messageRow('m2', 'root', 'gpt-6-luna', 'openai', {
          input: 300,
          output: 40,
          reasoning: 10,
          total: 350,
          created: NOW - 1000,
        }),
        messageRow('m-free', 'free', 'poolside/laguna-s-2.1', 'kilo', { total: 1800 }),
        messageRow('m-other', 'other', 'claude-sonnet-4.5', 'kilo', { total: 900 }),
        messageRow('m-old', 'root', 'gpt-6-luna', 'openai', { total: 500, created: OUT_OF_WINDOW }),
        messageRow('m-child', 'child', 'gpt-5.6-terra', 'openai', { total: 200 }),
        messageRow('m-race', 'racing', 'gpt-6-luna', 'openai', { total: 50 }),
        messageRow('m-router', 'other', 'gpt-6-luna', 'openrouter', { total: 99 }),
        messageRow('m-user', 'root', 'gpt-6-luna', 'openai', { total: 999, role: 'user' }),
      ]
    );
    dir = d;

    const reading = pollGptTokens({ dbPath, windowHours: 5, budgetTokens: 1000, nowMs: NOW });
    expect(reading.consumedTokens).toBe(750);
    expect(reading.remainingTokens).toBe(250);
    expect(reading.status).toBe('ok');
    expect(reading.source).toBe('session-db');
    expect(reading.resetAt).toBe(new Date(NOW - 1000 + 5 * 3_600_000).toISOString());
    expect(reading.detail.scope).toBe('assistant-message-token-total');
    expect(reading.detail.resetTiming).toBe('estimated-oldest-message-expiry');
    expect(reading.detail.breakdown).toEqual({
      sessionsScanned: 5,
      candidateMessages: 8,
      assistantMessages: 7,
      matched: 4,
      fallbackUsage: 0,
      missingUsage: 0,
      unclassified: 0,
      consumed: 750,
    });
  });

  it('uses all completed-message components, including cache, when total is absent', () => {
    const { dir: d, dbPath } = buildSessionDb(
      [sessionRow('s1')],
      [
        messageRow('fallback', 's1', 'gpt-6-luna', 'openai', {
          input: 100,
          output: 20,
          reasoning: 30,
          cacheRead: 40,
          cacheWrite: 10,
          completed: NOW,
        }),
        messageRow('partial', 's1', 'gpt-6-luna', 'openai', {
          input: 500,
          total: 500,
          completed: null,
          created: NOW - 1000,
        }),
      ]
    );
    dir = d;
    const reading = pollGptTokens({ dbPath, budgetTokens: 1000, nowMs: NOW });
    expect(reading.status).toBe('incomplete');
    expect(reading.consumedTokens).toBeNull();
    expect(reading.remainingTokens).toBeNull();
    expect(reading.detail.breakdown).toMatchObject({ fallbackUsage: 1, missingUsage: 1, partialConsumedTokens: 200 });
  });

  it('fails closed on malformed or unclassifiable recent messages and unsafe counts', () => {
    const { dir: d, dbPath } = buildSessionDb(
      [sessionRow('s1')],
      [
        messageRow('bad-json', 's1', 'gpt-6-luna', 'openai', { total: 100 }),
        messageRow('bad-count', 's1', 'gpt-6-luna', 'openai', { total: -1 }),
        messageRow('unknown', 's1', 'gpt-6-luna', 'openai', { total: 10, created: NOW - 10 }),
      ]
    );
    dir = d;
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE message SET data = ? WHERE id = ?').run('{broken', 'bad-json');
    db.prepare('UPDATE message SET data = ? WHERE id = ?').run(
      JSON.stringify({
        role: 'assistant',
        time: { created: NOW, completed: NOW },
        tokens: { total: Number.MAX_SAFE_INTEGER + 1 },
      }),
      'bad-count'
    );
    db.prepare('UPDATE message SET data = ? WHERE id = ?').run(
      JSON.stringify({
        role: 'assistant',
        providerID: 'openai',
        time: { created: NOW - 10, completed: NOW },
        tokens: { total: 10 },
      }),
      'unknown'
    );
    db.close();
    const reading = pollGptTokens({ dbPath, budgetTokens: 1000, nowMs: NOW });
    expect(reading.status).toBe('incomplete');
    expect(reading.consumedTokens).toBeNull();
    expect(reading.remainingTokens).toBeNull();
    expect(reading.detail.breakdown).toMatchObject({ missingUsage: 3, unclassified: 3 });
  });

  it('reports no-budget and keeps provider reset timing explicitly unknown', () => {
    const { dir: d, dbPath } = buildSessionDb(
      [sessionRow('s1')],
      [messageRow('m1', 's1', 'gpt-6-sol', 'openai', { total: 1000 })]
    );
    dir = d;
    const reading = pollGptTokens({ dbPath, budgetTokens: null, nowMs: NOW });
    expect(reading.status).toBe('no-budget');
    expect(reading.consumedTokens).toBe(1000);
    expect(reading.remainingTokens).toBeNull();
    expect(reading.resetAt).toBe(new Date(NOW + 5 * 3_600_000).toISOString());
  });

  it('reports missing DB without claiming a remaining balance', () => {
    const reading = pollGptTokens({ dbPath: join(tmpdir(), 'does-not-exist.db'), nowMs: NOW });
    expect(reading.status).toBe('no-session-db');
    expect(reading.remainingTokens).toBeNull();
    expect(reading.resetAt).toBeNull();
  });

  it('rejects look-backs beyond the session-database safety bound', () => {
    const reading = pollGptTokens({
      dbPath: join(tmpdir(), 'does-not-exist.db'),
      windowHours: MAX_TOKEN_WINDOW_HOURS + 1,
      nowMs: NOW,
    });
    expect(reading.status).toBe('invalid-window');
    expect(reading.detail.maxWindowHours).toBe(MAX_TOKEN_WINDOW_HOURS);
  });

  it('rejects invalid budgets and pinned timestamps as unknown readings', () => {
    const noDb = join(tmpdir(), 'does-not-exist.db');
    expect(pollGptTokens({ dbPath: noDb, budgetTokens: 1.5, nowMs: NOW }).status).toBe('invalid-budget');
    expect(pollGptTokens({ dbPath: noDb, budgetTokens: 100, nowMs: Number.NaN }).status).toBe('invalid-time');
  });
});

describe('subagentTokenPolicy', () => {
  const reading = (overrides = {}) => ({
    polledAt: new Date(NOW).toISOString(),
    windowHours: 5,
    budgetTokens: 1000,
    consumedTokens: 850,
    remainingTokens: 150,
    resetAt: null,
    status: 'ok',
    ...overrides,
  });

  it('prefers free models with low allowance and unknown reset while blocking Terra/Sol', () => {
    const policy = subagentTokenPolicy(reading(), NOW);
    expect(policy).toMatchObject({ state: 'low', recommendation: 'free-preferred', terraSol: 'blocked' });
  });

  it('still prefers free when the reset is near, but the Terra/Sol block is conditional', () => {
    const policy = subagentTokenPolicy(reading({ resetAt: new Date(NOW + 30 * 60_000).toISOString() }), NOW);
    expect(policy).toMatchObject({ state: 'low', recommendation: 'free-preferred', terraSol: 'normal-policy' });
  });

  it('marks fresh healthy allowance free-preferred', () => {
    const policy = subagentTokenPolicy(reading({ remainingTokens: 500 }), NOW);
    expect(policy).toMatchObject({ state: 'healthy', recommendation: 'free-preferred', terraSol: 'normal-policy' });
  });

  it('fails closed for missing, incomplete, or stale readings', () => {
    expect(subagentTokenPolicy(null, NOW).recommendation).toBe('free-preferred');
    expect(subagentTokenPolicy(reading({ status: 'incomplete' }), NOW)).toMatchObject({
      recommendation: 'free-preferred',
      terraSol: 'normal-policy',
    });
    expect(
      subagentTokenPolicy(reading({ polledAt: new Date(NOW - TOKEN_READING_STALE_AFTER_MS - 1).toISOString() }), NOW)
    ).toMatchObject({ state: 'unknown', recommendation: 'free-preferred', stale: true });
  });

  it('does not use a shorter-than-five-hour reading to permit paid routing', () => {
    expect(subagentTokenPolicy(reading({ windowHours: 2, remainingTokens: 900 }), NOW)).toMatchObject({
      state: 'unknown',
      recommendation: 'free-preferred',
    });
  });
});
