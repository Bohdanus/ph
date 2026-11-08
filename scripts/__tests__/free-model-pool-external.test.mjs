import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const completeWithFreeModel = async (prompt, options = {}) => {
  const temporaryDirectory = options.quarantineFile ? null : await mkdtemp(join(tmpdir(), 'free-model-pool-test-'));
  try {
    return await completeWithFreeModelImplementation(prompt, {
      kiloCommand: '',
      openRouterKey: '',
      groqApiKey: '',
      groqApiKeys: [],
      groqFreePlan: false,
      opencodeCommand: '',
      quarantineFile: options.quarantineFile ?? join(temporaryDirectory, 'quarantine.json'),
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

  it('tries Nemotron 3 Ultra first and XingChen second in the OpenRouter catalog', () => {
    const rows = [
      openRouterRow('recursive/flint-v1.0'),
      openRouterRow('nvidia/nemotron-3-ultra-550b-a55b'),
      openRouterRow('xingchen-agi/xing4.0-29b-a4b'),
    ];
    expect(catalogCandidates('openrouter', { data: rows }).map(({ model }) => model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'xingchen-agi/xing4.0-29b-a4b:free',
      'recursive/flint-v1.0:free',
    ]);
  });

  it('tries Nemotron 3 Ultra first and XingChen second in the Kilo catalog', () => {
    const rows = [
      kiloRow('recursive/flint-v1.0:free'),
      kiloRow('xingchen-agi/xing4.0-29b-a4b:free'),
      kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'),
    ];
    expect(catalogCandidates('kilo', rows).map(({ model }) => model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'xingchen-agi/xing4.0-29b-a4b:free',
      'recursive/flint-v1.0:free',
    ]);
  });

  it('excludes disabled model families from Kilo and OpenRouter catalogs', () => {
    const nemotron = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const xingchen = 'xingchen-agi/xing4.0-29b-a4b:free';
    const retired = 'poolside/laguna-s-2.1:free';
    expect(
      catalogCandidates('kilo', [kiloRow(retired), kiloRow(xingchen), kiloRow(nemotron)]).map(({ model }) => model)
    ).toEqual([nemotron, xingchen]);
    expect(
      catalogCandidates('openrouter', {
        data: [
          openRouterRow(retired.slice(0, -':free'.length)),
          openRouterRow(xingchen.slice(0, -':free'.length)),
          openRouterRow(nemotron.slice(0, -':free'.length)),
        ],
      }).map(({ model }) => model)
    ).toEqual([nemotron, xingchen]);
  });

  it('excludes the dynamic OpenRouter router from Kilo and OpenRouter catalogs', () => {
    const kiloRows = [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'), kiloRow('openrouter/free')];
    const routerRows = [openRouterRow('openrouter/free')];
    expect(catalogCandidates('kilo', kiloRows).map(({ model }) => model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
    ]);
    expect(catalogCandidates('openrouter', { data: routerRows })).toEqual([]);
  });
});

async function responseWithReadableBody(response) {
  if (response instanceof Response) return response;
  const payload = typeof response?.json === 'function' ? await response.json() : undefined;
  const status = response?.status ?? (response?.ok === false ? 500 : 200);
  return new Response(payload === undefined ? '' : JSON.stringify(payload), { status });
}

function readableFetch(fetchImpl) {
  return vi.fn(async (...args) => responseWithReadableBody(await fetchImpl(...args)));
}

function catalogFetch({ kilo = [], openrouter = [], keyInfo, chat }) {
  return readableFetch(async (url, options = {}) => {
    if (url.endsWith('/models') && url.includes('openrouter')) {
      return { ok: true, json: async () => ({ data: openrouter }) };
    }
    if (url.endsWith('/models')) return { ok: true, json: async () => kilo };
    if (url.includes('api/v1/key')) return keyInfo();
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
      stdout,
      stderr,
    });
    const rows = JSON.parse(stdout.write.mock.calls[0][0]);
    expect(code).toBe(0);
    expect(rows).toEqual([
      { source: 'kilo', model: 'kilo-free', name: 'kilo-free', configured: null },
      { source: 'openrouter', model: 'router-free:free', name: 'router-free:free', configured: false },
    ]);
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

describe('OpenRouter pre-routing quota check', () => {
  it('does not probe quota unless the caller opts in', async () => {
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
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes('api/v1/key'))).toBe(false);
  });

  it('skips OpenRouter when the daily quota is exhausted and never calls its chat endpoint', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      openrouter: [openRouterRow('o1')],
      keyInfo: () => ({
        ok: true,
        json: async () => ({
          data: { free_model_daily_requests: { used: 1000, limit: 1000, remaining: 0 } },
        }),
      }),
      chat,
    });
    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', checkOpenRouterQuota: true })
    ).rejects.toThrow(/No free model completed/);
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
      checkOpenRouterQuota: true,
      onOpenRouterQuota,
    });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free' });
    expect(result.requestCounts).toEqual({ kilo: 0, openrouter: 1 });
    expect(onOpenRouterQuota).toHaveBeenCalledWith({ used: 10, limit: 50, remaining: 40, reason: 'ok' });
  });

  it('does not probe when OpenRouter is not in the catalog', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      checkOpenRouterQuota: true,
      kiloCommand: '/fake-kilo',
      runKilo: vi.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }),
    });
    expect(result.source).toBe('kilo');
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
      checkOpenRouterQuota: true,
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

    await expect(
      completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', checkOpenRouterQuota: true })
    ).resolves.toMatchObject({ source: 'openrouter', model: 'o1:free' });
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
});

describe('Reasoning parameter is not sent to any provider', () => {
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

  it('does not send reasoning for Kilo requests', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    const runKilo = vi.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' });
    await completeWithFreeModel('prompt', { fetchImpl, kiloCommand: '/fake-kilo', runKilo });
    expect(runKilo).toHaveBeenCalledWith({
      command: '/fake-kilo',
      source: 'kilo',
      model: 'k1',
      prompt: 'prompt',
      maxTokens: 1200,
    });
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('provider rate-limit diagnostics', () => {
  it('honors Retry-After before rotating to another OpenRouter model on 429', async () => {
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
    const completionCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('openrouter.ai/api/v1/chat'));
    expect(completionCalls).toHaveLength(2);
    expect(JSON.parse(completionCalls[0][1].body).model).toBe('r1:free');
    expect(JSON.parse(completionCalls[1][1].body).model).toBe('r2:free');
  });

  it('skips OpenRouter for the run when a subsequent Retry-After exceeds the bounded wait', async () => {
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

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter.mock.calls).toEqual([[30_000]]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it('honors Retry-After only while another OpenRouter candidate remains', async () => {
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
    expect(waitForRetryAfter.mock.calls).toEqual([[30_000], [30_000]]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(2);
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
      .mockResolvedValueOnce(
        new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } })
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

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /Model response is not valid JSON/
    );

    expect(chat).toHaveBeenCalledTimes(2);
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it('honors Retry-After when the daily quota counter is unavailable', async () => {
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

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
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
  ])('honors Retry-After when quota is unknown (%s)', async (_label, keyInfo) => {
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

    const result = await completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(waitForRetryAfter).toHaveBeenCalledWith(30_000);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it('does not retry OpenRouter when platform rate-limit headers report zero remaining', async () => {
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'platform rate limited' } }), {
        status: 429,
        headers: {
          'retry-after': '30',
          'x-ratelimit-remaining': '0',
          'content-type': 'application/json',
        },
      })
    );
    const fetchImpl = catalogFetch({ kilo: [], openrouter: [openRouterRow('r1'), openRouterRow('r2')], chat });

    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk', waitForRetryAfter })).rejects.toThrow(
      /No free model completed/
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(0);
  });

  it('rechecks daily quota and honors a 60-second Retry-After on OpenRouter 503', async () => {
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
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

  it('rotates without an extra Retry-After wait when the HTTP date is in the past', async () => {
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it.each([429, 503])('does not query quota or wait when HTTP %i has no next OpenRouter candidate', async (status) => {
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

    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(0);
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

    expect(chat).toHaveBeenCalledTimes(1);
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

    expect(chat).toHaveBeenCalledTimes(1);
    expect(waitForRetryAfter).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it.each([429, 503])(
    'skips OpenRouter for the run when HTTP %i Retry-After exceeds its bounded wait',
    async (status) => {
      const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
      const chat = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status,
          headers: { 'retry-after': '61', 'content-type': 'application/json' },
        })
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
      expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(0);
    }
  );

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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
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
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/chat/completions'))).toHaveLength(1);
  });

  it('rotates after a model 429 when the daily quota probe returns an unknown result', async () => {
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
      keyInfo: () => ({ ok: false, status: 429 }),
      chat,
    });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk' });

    expect(result).toMatchObject({ source: 'openrouter', model: 'r2:free', content: 'recovered' });
    expect(result.requestCounts.openrouter).toBe(2);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/v1/key'))).toHaveLength(1);
  });

  it('caps model rotation at three attempts when the daily quota remains unknown', async () => {
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
      /Requests attempted: \{"kilo":0,"openrouter":3\}/
    );
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/chat/completions'))).toHaveLength(3);
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
    expect(waitForRetryAfter).not.toHaveBeenCalled();
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
