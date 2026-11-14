import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogCandidates,
  completeWithFreeModel as completeWithFreeModelImplementation,
  loadCatalogs,
  main,
  probeOpenRouterQuota,
  retryAfterDelayMs,
  zeroPriced,
} from '../free-model-pool.mjs';
import { readQuarantineState } from '../lib/free-model-quarantine.mjs';
import { readFreeModelPoolState } from '../lib/free-model-pool-state.mjs';

const completeWithFreeModel = async (prompt, options = {}) => {
  const temporaryDirectory = options.quarantineFile ? null : await mkdtemp(join(tmpdir(), 'free-model-pool-test-'));
  const quarantineFile = options.quarantineFile ?? join(temporaryDirectory, 'quarantine.json');
  try {
    return await completeWithFreeModelImplementation(prompt, {
      kiloCommand: '',
      openRouterKey: '',
      groqApiKey: '',
      groqApiKeys: [],
      groqFreePlan: false,
      opencodeCommand: '',
      quarantineFile,
      poolStateFile: options.poolStateFile ?? `${quarantineFile}.pool-state.json`,
      ...options,
      initializeLegacyQuarantine: false,
    });
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
};
const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });
const openRouterRow = (id) => ({ id: `${id}:free`, pricing: { prompt: '0', completion: '0' } });

describe('free pricing validation', () => {
  it('accepts exact decimal zero representations without rounding positive prices down', () => {
    expect(
      zeroPriced({
        prompt: '0.000000000000',
        completion: '0.000000000000',
        input_cache_read: '0.000000000000',
        discount: 0,
      })
    ).toBe(true);
    expect(zeroPriced({ prompt: '0.000000000001', completion: '0' })).toBe(false);
    expect(zeroPriced({ prompt: 0, completion: 0, request: 0 })).toBe(true);
  });

  it('rejects every documented non-zero price and conditional paid prices', () => {
    const chargeFields = [
      'request',
      'image',
      'web_search',
      'internal_reasoning',
      'input_cache_read',
      'input_cache_write',
      'audio',
      'input_audio_cache',
      'input_cache_write_1h',
    ];
    for (const field of chargeFields) {
      expect(zeroPriced({ prompt: '0', completion: '0', [field]: '0.001' })).toBe(false);
      expect(zeroPriced({ prompt: '0', completion: '0', overrides: [{ [field]: '0.001' }] })).toBe(false);
    }
    expect(zeroPriced({ prompt: '0', completion: '0', overrides: [{ prompt: '0.000001' }] })).toBe(false);
    expect(zeroPriced({ prompt: '0', completion: '0', overrides: [{ completion: '0.000001' }] })).toBe(false);
    expect(zeroPriced({ prompt: '0', completion: '0', overrides: [{ min_completion_tokens: 100, prompt: '0' }] })).toBe(
      false
    );
    expect(zeroPriced({ prompt: '0', completion: '0', audio_output: '0.001' })).toBe(false);
    expect(zeroPriced({ prompt: '0', completion: '0', overrides: [{ audio_output: '0.001' }] })).toBe(false);
    expect(zeroPriced({ prompt: '0', completion: '0', overrides: null })).toBe(false);
  });

  it('accepts exact-zero prices across all conditional pricing overrides', () => {
    expect(
      zeroPriced({
        prompt: '0',
        completion: '0',
        request: '0',
        image: '0',
        web_search: '0',
        internal_reasoning: '0',
        input_cache_read: '0',
        input_cache_write: '0',
        overrides: [
          { min_prompt_tokens: 4096, utc_start: 0, utc_end: 1200 },
          { utc_start: 1200, utc_end: 0, prompt: '0', completion: '0' },
        ],
      })
    ).toBe(true);
  });
});

describe('unverifiable free routers', () => {
  it('keeps exact-zero Kilo entries that use decimal strings and numeric discount metadata', () => {
    const row = {
      id: 'reflection/beam-free',
      isFree: true,
      pricing: { prompt: '0.000000000000', completion: '0.000000000000', discount: 0 },
    };
    expect(catalogCandidates('kilo', [row]).map(({ model }) => model)).toEqual(['reflection/beam-free']);
  });

  it('preserves OpenRouter catalog order before cross-provider route ranking', () => {
    const rows = [
      openRouterRow('recursive/flint-v1.0'),
      openRouterRow('nvidia/nemotron-3-ultra-550b-a55b'),
      openRouterRow('xingchen-agi/xing4.0-29b-a4b'),
    ];
    expect(catalogCandidates('openrouter', { data: rows }).map(({ model }) => model)).toEqual([
      'recursive/flint-v1.0:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'xingchen-agi/xing4.0-29b-a4b:free',
    ]);
  });

  it('preserves Kilo catalog order before cross-provider route ranking', () => {
    const rows = [
      kiloRow('recursive/flint-v1.0:free'),
      kiloRow('xingchen-agi/xing4.0-29b-a4b:free'),
      kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'),
    ];
    expect(catalogCandidates('kilo', rows).map(({ model }) => model)).toEqual([
      'recursive/flint-v1.0:free',
      'xingchen-agi/xing4.0-29b-a4b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
  });

  it('excludes disabled model families from Kilo and OpenRouter catalogs', () => {
    const nemotron = 'nvidia/nemotron-3-ultra-550b-a55b-v2:free';
    const xingchen = 'xingchen-agi/xing4.0-29b-a4b:free';
    const retired = 'poolside/laguna-s-2.1:free';
    expect(
      catalogCandidates('kilo', [kiloRow(retired), kiloRow(xingchen), kiloRow(nemotron)]).map(({ model }) => model)
    ).toEqual([xingchen]);
    expect(
      catalogCandidates('openrouter', {
        data: [
          openRouterRow(retired.slice(0, -':free'.length)),
          openRouterRow(xingchen.slice(0, -':free'.length)),
          openRouterRow(nemotron.slice(0, -':free'.length)),
        ],
      }).map(({ model }) => model)
    ).toEqual([xingchen]);
  });

  it('excludes the dynamic OpenRouter router from Kilo and OpenRouter catalogs', () => {
    const kiloRows = [kiloRow('xingchen-agi/xing4.0-29b-a4b:free'), kiloRow('openrouter/free')];
    const routerRows = [openRouterRow('openrouter/free')];
    expect(catalogCandidates('kilo', kiloRows).map(({ model }) => model)).toEqual([
      'xingchen-agi/xing4.0-29b-a4b:free',
    ]);
    expect(catalogCandidates('openrouter', { data: routerRows })).toEqual([]);
  });
});

async function responseWithReadableBody(response) {
  if (response instanceof Response) {
    if (response.status !== 429 || response.headers.has('x-ratelimit-remaining')) return response;
    const clone = response.clone();
    const headers = new Headers(clone.headers);
    headers.set('x-ratelimit-remaining', '100');
    return new Response(await clone.arrayBuffer(), { status: clone.status, headers });
  }
  const payload = typeof response?.json === 'function' ? await response.json() : undefined;
  const status = response?.status ?? (response?.ok === false ? 500 : 200);
  const headers = new Headers(response?.headers);
  if (status === 429 && !headers.has('x-ratelimit-remaining')) headers.set('x-ratelimit-remaining', '100');
  return new Response(payload === undefined ? '' : JSON.stringify(payload), { status, headers });
}

function readableFetch(fetchImpl) {
  return vi.fn(async (...args) => responseWithReadableBody(await fetchImpl(...args)));
}

function catalogFetch({ kilo = [], openrouter = [], opencode = [], groq = [], keyInfo, chat }) {
  return readableFetch(async (url, options = {}) => {
    if (url.endsWith('/models') && url.includes('openrouter')) {
      return { ok: true, json: async () => ({ data: openrouter }) };
    }
    if (url.endsWith('/models') && url.includes('opencode')) {
      return { ok: true, json: async () => opencode };
    }
    if (url.endsWith('/models') && url.includes('api.groq.com')) {
      return { ok: true, json: async () => ({ data: groq }) };
    }
    if (url.endsWith('/models')) return { ok: true, json: async () => kilo };
    if (url.includes('api/v1/key')) {
      return (
        keyInfo?.() ?? {
          ok: true,
          json: async () => ({ data: { free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 } } }),
        }
      );
    }
    return chat(url, options);
  });
}

function catalogFetchWithoutInjectedRateLimitHeaders({ kilo = [], openrouter = [], opencode = [], keyInfo, chat }) {
  return vi.fn(async (url, options = {}) => {
    if (url.endsWith('/models') && url.includes('openrouter')) {
      return new Response(JSON.stringify({ data: openrouter }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/models') && url.includes('opencode')) {
      return new Response(JSON.stringify(opencode), { headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify(kilo), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api/v1/key')) {
      return new Response(JSON.stringify(keyInfo?.() ?? { data: {} }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return chat(url, options);
  });
}

describe('OpenRouter quota probe', () => {
  it('returns remaining and limit when the key info endpoint is available', async () => {
    const fetchImpl = readableFetch(() => ({
      ok: true,
      json: async () => ({
        data: { free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } },
      }),
    }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({ remaining: 38, limit: 50, used: 12, reason: 'ok' });
  });

  it('returns reason:no_key when no OpenRouter key is supplied', async () => {
    const fetchImpl = vi.fn();
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: '' });
    expect(quota).toEqual({ remaining: null, limit: null, used: null, reason: 'no_key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns reason:http_401 on a non-OK response', async () => {
    const fetchImpl = readableFetch(() => ({ ok: false, status: 401 }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({ remaining: null, limit: null, used: null, reason: 'http_401' });
  });

  it('returns reason:invalid_payload when the quota field is absent from the response', async () => {
    const fetchImpl = readableFetch(() => ({ ok: true, json: async () => ({ data: {} }) }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({ remaining: null, limit: null, used: null, reason: 'invalid_payload' });
  });

  it('returns reason:network_error on a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({
      remaining: null,
      limit: null,
      used: null,
      reason: 'network_error',
      detail: 'network error',
    });
  });

  it('returns reason:invalid_payload when remaining is not a number', async () => {
    const fetchImpl = readableFetch(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { remaining: 'unknown' } } }),
    }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({ remaining: null, limit: null, used: null, reason: 'invalid_payload' });
  });

  it('rejects malformed quota fields instead of treating them as capacity', async () => {
    for (const info of [
      { used: 1, limit: 50, remaining: -1 },
      { used: 10, limit: 50 },
      { used: 10, limit: 50, remaining: null },
      { used: 10, limit: 50, remaining: '40' },
      { used: 10, limit: 50, remaining: true },
      null,
      '5',
      5,
      { used: -1, limit: 50, remaining: 1 },
      { used: 0, limit: 0, remaining: 0 },
      { used: 'unknown', limit: 50, remaining: 50 },
    ]) {
      const fetchImpl = readableFetch(() => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: info } }),
      }));
      await expect(probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' })).resolves.toEqual({
        remaining: null,
        limit: null,
        used: null,
        reason: 'invalid_payload',
      });
    }
  });
});

describe('keyless free-model catalog CLI', () => {
  it('lists public catalogs and marks providers without credentials as unconfigured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-keyless-cli-'));
    const quarantineFile = join(directory, 'quarantine.json');

    try {
      await writeFile(quarantineFile, JSON.stringify({ schemaVersion: 1, entries: {} }), 'utf8');
      const fetchImpl = catalogFetch({
        kilo: [kiloRow('kilo-free')],
        openrouter: [openRouterRow('router-free')],
        chat: vi.fn(),
      });
      const stdout = { write: vi.fn() };
      const stderr = { write: vi.fn() };
      const code = await main(['--list'], {
        fetchImpl,
        openRouterKey: '',
        kiloCommand: 'kilo-test',
        groqApiKey: '',
        groqApiKeys: [],
        groqFreePlan: false,
        initializeLegacyQuarantine: false,
        quarantineFile,
        stdout,
        stderr,
      });
      const rows = JSON.parse(stdout.write.mock.calls[0][0]);
      expect(code).toBe(0);
      expect(rows).toEqual([
        { source: 'kilo', model: 'kilo-free', name: 'kilo-free', priority: 2, configured: null },
        { source: 'openrouter', model: 'router-free:free', name: 'router-free:free', priority: 2, configured: false },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('OpenRouter quota status command', () => {
  it('reports the server-side used/limit/remaining counter without inference', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 307, limit: 1000, remaining: 693 } } }),
      }),
      chat,
    });
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const code = await main(['--openrouter-quota'], { fetchImpl, openRouterKey: 'rk', stdout, stderr });
    expect(code).toBe(0);
    const snapshot = JSON.parse(stdout.write.mock.calls[0][0]);
    expect(snapshot).toMatchObject({
      provider: 'openrouter',
      counter: 'free_model_daily_requests',
      used: 307,
      limit: 1000,
      remaining: 693,
    });
    expect(snapshot.checkedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('requires a key and does not silently start an inference', async () => {
    const fetchImpl = vi.fn();
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const code = await main(['--openrouter-quota'], { fetchImpl, openRouterKey: '', stdout, stderr });
    expect(code).toBe(2);
    expect(stdout.write).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels the response body when quota status returns a non-OK response', async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, body: { cancel } }));

    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toEqual({ remaining: null, limit: null, used: null, reason: 'http_429' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('lazy OpenRouter quota preflight', () => {
  it('probes quota only when the ordered route reaches OpenRouter', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'o1:free',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({
          data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } },
        }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).resolves.toMatchObject({
      source: 'openrouter',
      model: 'o1:free',
    });
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('api/v1/key'))).toBe(true);
  });

  it('skips OpenRouter when the daily quota is exhausted and never calls its chat endpoint', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('xingchen-agi/xing4.0-29b-a4b:free')],
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({
          data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } },
        }),
      }),
      chat,
    });
    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );
    const openRouterChatCalls = chat.mock.calls.filter((call) => String(call[0]).includes('openrouter.ai/api/v1/chat'));
    expect(openRouterChatCalls).toHaveLength(0);
  });

  it('does not skip OpenRouter when the daily quota still has capacity', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'o1:free',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({
          data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } },
        }),
      }),
      chat,
    });
    const onOpenRouterQuota = vi.fn();
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      onOpenRouterQuota,
    });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free' });
    expect(result.requestCounts).toEqual({ kilo: 0, openrouter: 1 });
    expect(onOpenRouterQuota).toHaveBeenCalledWith({ used: 10, limit: 50, remaining: 40, reason: 'ok' });
  });

  it('uses a verified Nemotron Kilo route before probing lower-priority routes', async () => {
    const chat = vi.fn();
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const fetchImpl = catalogFetch({ kilo: [kiloRow(model)], chat });
    const runKilo = vi.fn().mockResolvedValue({
      model,
      content: 'Kilo Nemotron result',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      kiloCommand: '/fake-kilo',
      runKilo,
    });
    expect(result).toMatchObject({ source: 'kilo', model, content: 'Kilo Nemotron result', finishReason: 'stop' });
    expect(result.requestCounts).toEqual({ kilo: 1, openrouter: 0 });
    expect(runKilo).toHaveBeenCalledWith(
      expect.objectContaining({ model, maxTokens: 4096, timeoutMs: 12 * 60 * 1000 })
    );
    expect(chat).not.toHaveBeenCalled();
    const keyInfoCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes('api/v1/key'));
    expect(keyInfoCalls).toHaveLength(0);
  });

  it('falls through to normal exhaustion when the quota probe itself fails', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({ ok: false, status: 500 }),
      chat,
    });
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
    });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free' });
  });

  it('fails open when the quota endpoint returns HTTP 429', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'o1:free',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({ ok: false, status: 429 }),
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).resolves.toMatchObject({
      source: 'openrouter',
      model: 'o1:free',
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops routing after a content-policy rejection without pretending to persist a quarantine', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'free-model-policy-test-'));
    const quarantineFile = join(temporaryDirectory, 'quarantine.json');
    const chat = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'content_policy_violation', message: 'content was rejected by policy' },
      }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('o1')], chat });

    try {
      await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', quarantineFile })).rejects.toThrow(
        /content policy rejected or filtered this request/
      );
      expect(chat).toHaveBeenCalledTimes(1);
      await expect(readQuarantineState(quarantineFile)).resolves.toMatchObject({ entries: {} });
      await expect(readFile(quarantineFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ['content_policy_violation', { error_type: 'content_policy_violation' }],
    ['refusal', { error_type: 'refusal' }],
  ])('stops all provider fallback for OpenRouter typed %s metadata', async (_type, metadata) => {
    const runOpenCode = vi.fn().mockResolvedValue({
      model: 'beam-free',
      content: 'fallback should not run',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const chat = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 403, message: 'Request blocked', metadata } }),
    });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('o1'), openRouterRow('o2')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: 'rk',
        opencodeCommand: 'opencode',
        runOpenCode,
      })
    ).rejects.toThrow(/content policy rejected or filtered this request/);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(runOpenCode).not.toHaveBeenCalled();
  });

  it('stops provider fallback for a typed policy error embedded in an HTTP 200 choice', async () => {
    const runOpenCode = vi.fn().mockResolvedValue({
      model: 'beam-free',
      content: 'fallback should not run',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: 'partial response' },
            finish_reason: 'error',
            error: { code: 403, message: 'Request blocked', metadata: { error_type: 'content_policy_violation' } },
          },
        ],
      }),
    });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('o1'), openRouterRow('o2')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: 'rk',
        opencodeCommand: 'opencode',
        runOpenCode,
      })
    ).rejects.toThrow(/content policy rejected or filtered this request/);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(runOpenCode).not.toHaveBeenCalled();
  });
});

describe('reasoning options follow the selected model route', () => {
  it('does not send reasoning for OpenRouter requests (avoids breaking mandatory-reasoning models)', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'o1:free',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      openrouter: [openRouterRow('o1')],
      chat,
    });
    await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' });
    const openRouterCall = chat.mock.calls.find((call) => String(call[0]).includes('openrouter.ai/api/v1/chat'));
    const body = JSON.parse(openRouterCall[1].body);
    expect(body.reasoning).toBeUndefined();
  });

  it('uses an eligible XingChen Kilo route when it is the available fallback', async () => {
    const chat = vi.fn();
    const model = 'xingchen-agi/xing4.0-29b-a4b:free';
    const fetchImpl = catalogFetch({ kilo: [kiloRow(model)], chat });
    const runKilo = vi.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' });
    const result = await completeWithFreeModel('prompt', { fetchImpl, kiloCommand: '/fake-kilo', runKilo });
    expect(result).toMatchObject({ source: 'kilo', model, content: 'done', finishReason: 'stop' });
    expect(runKilo).toHaveBeenCalledWith(expect.objectContaining({ model, maxTokens: 1200, timeoutMs: 300_000 }));
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('disabled Nemotron routes', () => {
  it('blocks noncanonical Nemotron variants before inference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-kilo-cost-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const poolStateFile = join(directory, 'pool-state.json');
    const model = 'nvidia/nemotron-3-ultra-550b-a55b-v2:free';
    const chat = vi.fn();
    const fetchImpl = catalogFetch({ kilo: [kiloRow(model)], chat });
    const runKilo = vi.fn();
    const runOpenCode = vi.fn();

    try {
      await expect(
        completeWithFreeModel('test', {
          fetchImpl,
          kiloCommand: '/fake-kilo',
          opencodeCommand: '/fake-opencode',
          openRouterKey: '',
          quarantineFile,
          poolStateFile,
          runKilo,
          runOpenCode,
        })
      ).rejects.toThrow(/No free model completed/);

      expect(runKilo).not.toHaveBeenCalled();
      expect(runOpenCode).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect((await readQuarantineState(quarantineFile)).entries[`kilo:${model}`]).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('recommended Nemotron OpenRouter route', () => {
  it('selects the exact free model and enforces its minimum reasoning token budget', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 2, limit: 1000, remaining: 998 } } }),
    }));
    const chat = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: request.model,
          choices: [{ message: { content: 'Nemotron response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 3, cost: 0 },
        }),
      };
    });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('vendor/fallback'), openRouterRow('nvidia/nemotron-3-ultra-550b-a55b')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('bounded smoke request', {
      fetchImpl,
      openRouterKey: 'test-key',
      maxTokens: 4000,
    });

    expect(result).toMatchObject({
      source: 'openrouter',
      model,
      content: 'Nemotron response',
      finishReason: 'stop',
    });
    expect(JSON.parse(chat.mock.calls[0][1].body)).toMatchObject({
      model,
      max_tokens: 4096,
      reasoning: { effort: 'high' },
    });
    expect(keyInfo).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledOnce();
  });
});

describe('OpenCode model-specific rate-limit retry', () => {
  const model = 'vendor/model-free';

  it('retries one model-attributable 429 before rotating to the fallback provider', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const runOpenCode = vi
      .fn()
      .mockResolvedValueOnce({
        error: 'model rate limited',
        errorType: 'model.rate_limit',
        status: 429,
        retryAfter: '2',
        modelAttributable: true,
      })
      .mockResolvedValueOnce({
        error: 'model rate limited again',
        errorType: 'model.rate_limit',
        status: 429,
        modelAttributable: true,
      });
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: 'fallback result' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      groq: [{ id: 'openai/gpt-oss-120b' }],
      opencode: [{ id: model, owned_by: 'opencode' }],
      chat,
    });

    const result = await completeWithFreeModel('test', {
      fetchImpl,
      groqApiKey: 'groq-test',
      groqFreePlan: true,
      kiloCommand: '',
      opencodeCommand: '/fake-opencode',
      runOpenCode,
      waitForRetryAfter,
    });

    expect(result).toMatchObject({ source: 'groq', model: 'openai/gpt-oss-120b', content: 'fallback result' });
    expect(runOpenCode).toHaveBeenCalledTimes(2);
    expect(runOpenCode.mock.calls.map(([options]) => options.model)).toEqual([model, model]);
    expect(waitForRetryAfter).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).toHaveBeenCalledWith(2000);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unattributed OpenCode 429', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const runOpenCode = vi.fn().mockResolvedValue({
      error: 'provider rate limited',
      errorType: 'provider.rate_limit',
      status: 429,
      retryAfter: '2',
      modelAttributable: false,
    });
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: 'fallback result' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      groq: [{ id: 'openai/gpt-oss-120b' }],
      opencode: [{ id: model, owned_by: 'opencode' }],
      chat,
    });

    const result = await completeWithFreeModel('test', {
      fetchImpl,
      groqApiKey: 'groq-test',
      groqFreePlan: true,
      kiloCommand: '',
      opencodeCommand: '/fake-opencode',
      runOpenCode,
      waitForRetryAfter,
    });

    expect(result).toMatchObject({ source: 'groq', model: 'openai/gpt-oss-120b' });
    expect(runOpenCode).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe('provider rate-limit diagnostics', () => {
  it('retries the same OpenRouter route once after an attributable 429', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'rotated' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });
    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });
    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'rotated' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
    const completionCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('openrouter.ai/api/v1/chat'));
    expect(completionCalls).toHaveLength(2);
    expect(JSON.parse(completionCalls[0][1].body).model).toBe('r1:free');
    expect(JSON.parse(completionCalls[1][1].body).model).toBe('r1:free');
  });

  it('skips a model when its same-route retry gets a long Retry-After', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '61', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'next model completed' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2'), openRouterRow('r3')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'next model completed' });
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual([
      'r1:free',
      'r1:free',
      'r2:free',
    ]);
    expect(chat).toHaveBeenCalledTimes(3);
    expect(waitForRetryAfter.mock.calls).toEqual([[30_000]]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(3);
  });

  it('uses at most one OpenRouter retry even when more catalog candidates remain', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const response = () =>
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'retry-after': '30', 'content-type': 'application/json' },
      });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2'), openRouterRow('r3')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(3);
    expect(waitForRetryAfter.mock.calls).toEqual([[30_000]]);
    const completionCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('openrouter.ai/api/v1/chat'));
    expect(completionCalls.map(([, options]) => JSON.parse(options.body).model)).toEqual([
      'r1:free',
      'r1:free',
      'r2:free',
    ]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(4);
  });

  it('reports malformed completion JSON after rotating to another OpenRouter model', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(3);
  });

  it('continues to another OpenRouter model after malformed completion JSON on a non-final candidate', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r3:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2'), openRouterRow('r3')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r3:free', content: 'recovered' });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(waitForRetryAfter.mock.calls).toEqual([[30_000]]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(3);
  });

  it('does not retry a rate-limited route when the daily quota remains unknown', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({ ok: false, status: 429 }),
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('limits an initially unknown preflight to one attempt even if the post-failure probe succeeds', async () => {
    const chat = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'upstream rate limited' } }), { status: 429 })
      );
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({ ok: false, status: 503 })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1, limit: 100, remaining: 99 } } }),
      });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      chat,
      keyInfo,
    });
    const waitForRetryAfter = vi.fn();

    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })
    ).rejects.toThrow(/No free model completed/);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it.each([
    ['missing quota object', () => ({ ok: true, json: async () => ({ data: {} }) })],
    [
      'missing remaining',
      () => ({ ok: true, json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50 } } }) }),
    ],
    [
      'null remaining',
      () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: null } } }),
      }),
    ],
    [
      'quota JSON rejects',
      () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('invalid quota JSON');
        },
      }),
    ],
  ])('allows only one inference request when quota is unknown (%s)', async (_label, keyInfo) => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('stops after one inference when OpenRouter platform rate-limit headers report zero remaining', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'platform rate limited',
            metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
          },
        }),
        {
          status: 429,
          headers: {
            'retry-after': '30',
            'x-ratelimit-remaining': '0',
            'content-type': 'application/json',
          },
        }
      )
    );
    const fetchImpl = catalogFetch({ kilo: [], openrouter: [openRouterRow('r1'), openRouterRow('r2')], chat });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it('honors a 60-second Retry-After on OpenRouter 503 after the lazy quota probe', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
          status: 503,
          headers: { 'retry-after': '60', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(60_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('honors Retry-After for a malformed OpenRouter 503 response before rotating', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('not-json', {
          status: 503,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After for a malformed OpenRouter 429 response before rotating', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('not-json', {
          status: 429,
          headers: { 'retry-after': '45', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(45_000);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('honors an HTTP-date Retry-After while routing to the next OpenRouter model', async () => {
    const now = Date.parse('2026-11-07T00:00:00.000Z');
    const retryAt = new Date(now + 30_000).toUTCString();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream rate limited' } }), {
          status: 429,
          headers: { 'retry-after': retryAt, 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    try {
      const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });
      expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
      expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('retries without waiting when the HTTP-date Retry-After is in the past', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const retryAfter = new Date(Date.now() - 60_000).toUTCString();
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': retryAfter, 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it.each([
    ['without Retry-After', undefined],
    ['with zero Retry-After', '0'],
  ])('rotates after OpenRouter 503 %s when quota remains', async (_label, retryAfter) => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const headers = { 'content-type': 'application/json' };
    if (retryAfter !== undefined) headers['retry-after'] = retryAfter;
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
          status: 503,
          headers,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it.each([429, 503])('allows one same-route retry after HTTP %i without another catalog candidate', async (status) => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status,
        headers: { 'retry-after': '30', 'content-type': 'application/json' },
      })
    );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(3);
  });

  it('does not rotate after an OpenRouter 503 when the daily quota is exhausted', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status: 503,
        headers: { 'retry-after': '30', 'content-type': 'application/json' },
      })
    );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(0);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it('does not wait or rotate after an OpenRouter 429 when the daily quota is exhausted', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'retry-after': '30', 'content-type': 'application/json' },
      })
    );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(0);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it.each([429, 503])(
    'skips OpenRouter for the run when HTTP %i Retry-After exceeds its bounded wait',
    async (status) => {
      const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
      const chat = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error:
              status === 429
                ? {
                    message: 'Rate limit exceeded: free-models-per-minute',
                    metadata: { limit_source: 'openrouter_free_tier_per_minute' },
                  }
                : { message: 'rate limited' },
          }),
          {
            status,
            headers: {
              'retry-after': '61',
              ...(status === 429 ? { 'x-ratelimit-remaining': '0' } : {}),
              'content-type': 'application/json',
            },
          }
        )
      );
      const fetchImpl = catalogFetch({
        kilo: [],
        openrouter: [openRouterRow('r1'), openRouterRow('r2')],
        keyInfo: () => ({
          ok: true,
          json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
        }),
        chat,
      });

      await expect(
        completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })
      ).rejects.toThrow(/No free model completed/);

      expect(chat).toHaveBeenCalledTimes(1);
      expect(waitForRetryAfter).not.toHaveBeenCalled();
      expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
    }
  );

  it('skips only an upstream 429 model with a long Retry-After when daily quota remains', async () => {
    const providerError = {
      error: {
        code: 429,
        message: 'upstream provider rate limited this model',
        metadata: {
          error_type: 'rate_limit_exceeded',
          limit_source: 'upstream_provider_shared_pool',
          provider_name: 'example-provider',
        },
      },
    };
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(providerError), {
          status: 429,
          headers: { 'retry-after': '61', 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'second model completed' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      waitForRetryAfter,
    });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'second model completed' });
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r2:free']);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it('stops OpenRouter on its shared free-tier per-minute 429 even when daily quota remains', async () => {
    const chat = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Rate limit exceeded: free-models-per-minute',
            metadata: { limit_source: 'openrouter_free_tier_per_minute' },
          },
        }),
        {
          status: 429,
          headers: {
            'retry-after': '2',
            'x-ratelimit-limit': '20',
            'x-ratelimit-remaining': '5',
            'content-type': 'application/json',
          },
        }
      )
    );
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })
    ).rejects.toThrow(/No free model completed/);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(keyInfo).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it('stops after an upstream model 429 when the refreshed daily quota is exhausted', async () => {
    const chat = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'upstream provider rate limited this model',
            metadata: { limit_source: 'upstream_provider_shared_pool', provider_code: '429' },
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      )
    );
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } }),
      });
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(keyInfo).toHaveBeenCalledTimes(2);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-07T00:00:00.000Z');
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '30' } }), now)).toBe(30_000);
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sat, 07 Nov 2026 00:00:30 GMT' } }), now)
    ).toBe(30_000);
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sunday, 07-Nov-27 00:00:30 GMT' } }), now)
    ).toBe(31_536_030_000);
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Tuesday, 07-Nov-51 00:00:30 GMT' } }), now)
    ).toBe(Date.UTC(2051, 10, 7, 0, 0, 30) - now);
    expect(
      retryAfterDelayMs(
        new Response(null, { headers: { 'retry-after': 'Sunday, 07-Nov-76 00:00:30 GMT' } }),
        Date.UTC(2026, 0, 1)
      )
    ).toBe(0);
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sat Nov  7 00:00:30 2026' } }), now)).toBe(
      30_000
    );
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '0' } }), now)).toBe(0);
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '9007199254741' } }), now)).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '9999999999999999999999999999' } }), now)
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '-1' } }), now)).toBeNull();
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '1.5' } }), now)).toBeNull();
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': '2026-11-07T00:00:30Z' } }), now)
    ).toBeNull();
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Fri, 06 Nov 2026 23:59:59 GMT' } }), now)
    ).toBe(0);
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sat, 32 Nov 2026 00:00:30 GMT' } }), now)
    ).toBeNull();
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sat, 07 Nov 2026 24:00:30 GMT' } }), now)
    ).toBeNull();
    expect(
      retryAfterDelayMs(new Response(null, { headers: { 'retry-after': 'Sat, 07 Nov 2026 23:59:60 GMT' } }), now)
    ).toBe(Date.UTC(2026, 10, 8, 0, 0, 0) - now);
    expect(retryAfterDelayMs(new Response(null), now)).toBeNull();
  });

  it.each([
    ['midday', 'Sat, 07 Nov 2026 12:34:60 GMT'],
    ['before the final minute', 'Sat, 07 Nov 2026 23:58:60 GMT'],
  ])('rejects a leap second %s of the day', (_label, retryAfter) => {
    const now = Date.parse('2026-11-07T00:00:00.000Z');
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': retryAfter } }), now)).toBeNull();
  });

  it.each([
    ['IMF-fixdate', 'Fri, 07 Nov 2026 00:00:30 GMT'],
    ['RFC 850 date', 'Friday, 07-Nov-26 00:00:30 GMT'],
    ['asctime date', 'Fri Nov  7 00:00:30 2026'],
  ])('rejects a %s with a weekday that disagrees with its date', (_format, retryAfter) => {
    const now = Date.parse('2026-11-07T00:00:00.000Z');
    expect(retryAfterDelayMs(new Response(null, { headers: { 'retry-after': retryAfter } }), now)).toBeNull();
  });

  it('rechecks daily capacity after a model 429 before rotating', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream model quota' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({
          data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } },
        }),
      }),
      chat,
    });
    const onOpenRouterQuota = vi.fn();
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      onOpenRouterQuota,
    });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(result.requestCounts.openrouter).toBe(2);
    expect(onOpenRouterQuota).toHaveBeenCalledWith({ used: 999, limit: 1000, remaining: 1, reason: 'ok' });
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('does not treat generic top-level metadata as upstream evidence for a 429', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 429, message: 'Rate limit exceeded' },
            metadata: { provider_name: 'unverified provider' },
          }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'second model completed' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const keyInfo = vi.fn(() => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }));
    const onOpenRouterQuota = vi.fn();
    const fetchImpl = catalogFetchWithoutInjectedRateLimitHeaders({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      waitForRetryAfter,
      onOpenRouterQuota,
    });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'second model completed' });
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r2:free']);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(onOpenRouterQuota).toHaveBeenNthCalledWith(1, { used: 10, limit: 50, remaining: 40, reason: 'ok' });
    expect(onOpenRouterQuota).toHaveBeenNthCalledWith(2, { used: 10, limit: 50, remaining: 40, reason: 'ok' });
  });

  it('retries the same OpenRouter model for an upstream provider_code 429 without platform headers', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Rate limit exceeded',
              metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const keyInfo = vi.fn(() => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }));
    const fetchImpl = catalogFetchWithoutInjectedRateLimitHeaders({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r1:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(2_000);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r1:free']);
    expect(chat.mock.calls[0][0]).toMatch(/\/api\/v1\/chat\/completions$/);
    expect(keyInfo).toHaveBeenCalledTimes(2);
  });

  it('uses typed rate-limit metadata to recognize an upstream 429 without provider_code or platform headers', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Rate limit exceeded',
              metadata: { error_type: 'rate_limit_exceeded' },
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const keyInfo = vi.fn(() => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }));
    const fetchImpl = catalogFetchWithoutInjectedRateLimitHeaders({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r1:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(2_000);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r1:free']);
    expect(keyInfo).toHaveBeenCalledTimes(2);
  });

  it('skips OpenRouter retry when the daily quota is exhausted after an upstream provider 429', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } })
      .mockReturnValueOnce({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } });
    const chat = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Rate limit exceeded',
            metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
          },
        }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '2' } }
      )
    );
    const fetchImpl = catalogFetchWithoutInjectedRateLimitHeaders({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })
    ).rejects.toThrow(/No free model completed/);

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it.each([
    ['rate_limit_exceeded', 'top-level error', 429],
    ['rate_limit_exceeded', 'choices[].error', 429],
    ['provider_overloaded', 'top-level error', 503],
    ['provider_overloaded', 'choices[].error', 503],
    ['provider_unavailable', 'top-level error', 502],
    ['provider_unavailable', 'choices[].error', 502],
    ['timeout', 'top-level error', 504],
    ['timeout', 'choices[].error', 504],
  ])('retries an HTTP 200 OpenRouter typed %s error reported in %s', async (errorType, location, code) => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const providerError = {
      code,
      message: errorType === 'rate_limit_exceeded' ? 'Rate limit exceeded' : 'Provider failed',
      metadata: { error_type: errorType },
    };
    const errorBody =
      location === 'top-level error'
        ? { error: providerError }
        : {
            choices: [
              {
                message: { content: 'partial response' },
                finish_reason: 'error',
                error: providerError,
              },
            ],
          };
    const headers = new Headers({ 'content-type': 'application/json' });
    if (errorType === 'rate_limit_exceeded') headers.set('retry-after', '2');
    const chat = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(errorBody), { status: 200, headers }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const fetchImpl = catalogFetch({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r1:free', content: 'recovered' });
    expect(result.requestCounts.openrouter).toBe(2);
    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter.mock.calls).toEqual(errorType === 'rate_limit_exceeded' ? [[2_000]] : []);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r1:free']);
  });

  it.each([
    ['provider_unavailable', 502, true],
    ['provider_overloaded', 503, true],
    ['timeout', 504, true],
    ['server', 500, false],
  ])(
    'attributes typed OpenRouter %s errors at HTTP %i without provider_code: %s',
    async (errorType, status, attributed) => {
      const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-typed-5xx-'));
      const quarantineFile = join(directory, 'quarantine.json');
      const poolStateFile = join(directory, 'pool-state.json');
      const chat = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { code: status, message: 'Provider failure', metadata: { error_type: errorType } },
            }),
            { status, headers: { 'content-type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              model: 'r1:free',
              choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      const keyInfo = vi.fn(() => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      }));
      const fetchImpl = catalogFetch({ openrouter: [openRouterRow('r1')], keyInfo, chat });

      try {
        await expect(
          completeWithFreeModel('prompt', {
            fetchImpl,
            openRouterKey: 'rk',
            poolStateFile,
            quarantineFile,
          })
        ).resolves.toMatchObject({ source: 'openrouter', model: 'r1:free', content: 'recovered' });

        const state = await readFreeModelPoolState(poolStateFile);
        const failure = state.modelFailures['openrouter:r1:free'];
        if (attributed) {
          expect(failure).toMatchObject({ failures: expect.any(Array), rateLimits: [] });
          expect(failure.failures).toHaveLength(1);
        } else {
          expect(failure).toBeUndefined();
        }
        expect(chat).toHaveBeenCalledTimes(2);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('tries an eligible OpenCode route while rotating OpenRouter models after same-route retry', async () => {
    const attempts = [];
    const providerError = {
      error: {
        code: 503,
        message: 'Provider overloaded',
        metadata: { error_type: 'provider_overloaded' },
      },
    };
    const chat = vi.fn(async (_url, options) => {
      const model = JSON.parse(options.body).model;
      attempts.push(`openrouter/${model}`);
      if (model === 'r2:free') {
        return new Response(
          JSON.stringify({
            model,
            choices: [{ message: { content: 'second model completed' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify(providerError), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    });
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const runOpenCode = vi.fn(async ({ model }) => {
      attempts.push(`opencode/${model}`);
      return undefined;
    });
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      opencodeCommand: 'opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({
      source: 'openrouter',
      model: 'r2:free',
      content: 'second model completed',
    });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual([
      'r1:free',
      'r1:free',
      'r2:free',
    ]);
    expect(result.requestCounts.openrouter).toBe(3);
    expect(keyInfo).toHaveBeenCalledTimes(3);
    expect(attempts).toEqual(['openrouter/r1:free', 'openrouter/r1:free', 'opencode/beam-free', 'openrouter/r2:free']);
    expect(runOpenCode).toHaveBeenCalledOnce();
    expect(runOpenCode).toHaveBeenCalledWith({
      command: 'opencode',
      maxTokens: 1200,
      model: 'beam-free',
      prompt: 'prompt',
      timeoutMs: 300_000,
    });
  });

  it('stops OpenRouter rotation when quota reaches zero after its same-route retry', async () => {
    const providerError = {
      error: {
        code: 503,
        message: 'Provider overloaded',
        metadata: { error_type: 'provider_overloaded' },
      },
    };
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerError), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })
    );
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 998, limit: 1000, remaining: 2 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } }),
      });
    const runOpenCode = vi.fn().mockResolvedValue({
      model: 'beam-free',
      content: 'fallback completed',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      opencodeCommand: 'opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'fallback completed' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls.map(([, options]) => JSON.parse(options.body).model)).toEqual(['r1:free', 'r1:free']);
    expect(result.requestCounts.openrouter).toBe(2);
    expect(keyInfo).toHaveBeenCalledTimes(3);
    expect(runOpenCode).toHaveBeenCalledTimes(1);
  });

  it('falls back to OpenCode after the bounded OpenRouter retry also receives a typed transient error', async () => {
    const providerError = {
      choices: [
        {
          message: { content: '' },
          finish_reason: 'error',
          error: {
            code: 503,
            message: 'Provider overloaded',
            metadata: { error_type: 'provider_overloaded' },
          },
        },
      ],
    };
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(providerError), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(providerError), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const runOpenCode = vi.fn().mockResolvedValue({
      model: 'beam-free',
      content: 'fallback completed',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      opencodeCommand: 'opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'fallback completed' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(keyInfo).toHaveBeenCalledTimes(3);
    expect(runOpenCode).toHaveBeenCalledTimes(1);
  });

  it('does not retry an HTTP 200 provider error after the daily quota reaches zero', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } })
      .mockReturnValueOnce({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Rate limit exceeded',
              metadata: { error_type: 'rate_limit_exceeded', provider_code: 'rate_limited' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json', 'retry-after': '2' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      opencode: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })
    ).rejects.toThrow(/No free model completed/);

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
  });

  it('skips the OpenRouter source when an HTTP 200 typed error asks for more than the bounded wait', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Rate limit exceeded',
            metadata: { error_type: 'rate_limit_exceeded' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'retry-after': '61' } }
      )
    );
    const keyInfo = vi.fn(() => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }));
    const runOpenCode = vi.fn().mockResolvedValue({
      model: 'beam-free',
      content: 'fallback completed',
      finishReason: 'stop',
      usage: { cost: 0 },
    });
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      opencodeCommand: 'opencode',
      runOpenCode,
      waitForRetryAfter,
    });

    expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'fallback completed' });
    expect(keyInfo).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(runOpenCode).toHaveBeenCalledTimes(1);
  });

  it('does not rotate to another OpenRouter model after an incomplete response consumes the final daily slot', async () => {
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } }),
      });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            usage: { cost: 0 },
            choices: [{ message: { content: 'partial response' }, finish_reason: 'length' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('continues to another OpenRouter model when quota remains positive after an incomplete response', async () => {
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
    }));
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            usage: { cost: 0 },
            choices: [{ message: { content: 'partial response' }, finish_reason: 'length' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('stops OpenRouter rotation when the post-attempt daily quota cannot be verified', async () => {
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      })
      .mockReturnValueOnce({ ok: true, json: async () => ({ data: {} }) });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            choices: [{ message: { content: 'partial response' }, finish_reason: 'length' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it.each([401, 402])('stops OpenRouter rotation when the refreshed quota endpoint returns HTTP %i', async (status) => {
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 50, remaining: 40 } } }),
      })
      .mockReturnValueOnce({ ok: false, status });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r1:free',
            choices: [{ message: { content: 'partial response' }, finish_reason: 'length' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('does not request Nemotron inference or quota checks after an unapproved variant is filtered', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b-v2:free';
    const keyInfo = vi.fn().mockReturnValue({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } }),
    });
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow(model.replace(/:free$/, ''))],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', maxTokens: 4096 })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('rechecks quota after an OpenRouter network failure before trying another model', async () => {
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } }),
      });
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('rechecks quota after malformed OpenRouter JSON before trying another model', async () => {
    const keyInfo = vi
      .fn()
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 999, limit: 1000, remaining: 1 } } }),
      })
      .mockReturnValueOnce({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } }),
      });
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('not valid json {', { status: 200, headers: { 'content-type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'must not run' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo,
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );

    expect(keyInfo).toHaveBeenCalledTimes(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops rotating OpenRouter models when a model 429 exhausts the daily quota', async () => {
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'daily quota exhausted' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } } }),
      }),
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/chat/completions'))).toHaveLength(0);
  });

  it('does not retry a model 429 when the daily quota probe returns an unknown result', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'upstream model rate limited',
              metadata: { limit_source: 'upstream_provider_shared_pool', provider_code: '429' },
            },
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'r2:free',
            choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      keyInfo: () => ({ ok: false, status: 429 }),
      chat,
    });
    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /No free model completed/
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('allows at most one OpenRouter inference attempt when quota remains unknown', async () => {
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
    );
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2'), openRouterRow('r3'), openRouterRow('r4')],
      keyInfo: () => ({ ok: false, status: 500 }),
      chat,
    });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /Requests attempted: \{"kilo":0,"openrouter":1\}/
    );
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/chat/completions'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
  });

  it('preserves Retry-After when a rate-limit response body is malformed', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1')],
      chat: vi.fn().mockResolvedValue(
        new Response('not-json', {
          status: 429,
          headers: { 'retry-after': '45', 'content-type': 'application/json' },
        })
      ),
    });
    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /Model response is not valid JSON \(Retry-After: 45\)/
    );
    expect(waitForRetryAfter).toHaveBeenCalledWith(45_000);
  });

  it('handles transport failures without a response or Retry-After header', async () => {
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1')],
      chat: vi.fn().mockRejectedValue(new Error('socket reset')),
    });
    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /openrouter\/r1:free: socket reset/
    );
  });
});
