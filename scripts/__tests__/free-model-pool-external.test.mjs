import { describe, expect, it, vi } from 'vitest';
import {
  catalogCandidates,
  completeWithFreeModel,
  loadCatalogs,
  main,
  probeOpenRouterQuota,
  zeroPriced,
} from '../free-model-pool.mjs';

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

  it('excludes the dynamic OpenRouter router from Kilo and OpenRouter catalogs', () => {
    const kiloRows = [kiloRow('poolside/laguna-s-2.1:free'), kiloRow('openrouter/free')];
    const routerRows = [openRouterRow('openrouter/free')];
    expect(catalogCandidates('kilo', kiloRows).map(({ model }) => model)).toEqual(['poolside/laguna-s-2.1:free']);
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
    expect(quota).toEqual({ remaining: 38, limit: 50, used: 12 });
  });

  it('returns null when no OpenRouter key is supplied', async () => {
    const fetchImpl = vi.fn();
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: '' });
    expect(quota).toBe(null);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null on a non-OK response', async () => {
    const fetchImpl = readableFetch(() => ({ ok: false, status: 401 }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toBe(null);
  });

  it('returns null when the quota field is absent from the response', async () => {
    const fetchImpl = readableFetch(() => ({ ok: true, json: async () => ({ data: {} }) }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toBe(null);
  });

  it('returns null on a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network error'));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toBe(null);
  });

  it('returns null when remaining is not a number', async () => {
    const fetchImpl = readableFetch(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { remaining: 'unknown' } } }),
    }));
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' });
    expect(quota).toBe(null);
  });

  it('rejects malformed quota fields instead of treating them as capacity', async () => {
    for (const info of [
      { used: 1, limit: 50, remaining: -1 },
      { used: -1, limit: 50, remaining: 1 },
      { used: 0, limit: 0, remaining: 0 },
      { used: 'unknown', limit: 50, remaining: 50 },
    ]) {
      const fetchImpl = readableFetch(() => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: info } }),
      }));
      await expect(probeOpenRouterQuota({ fetchImpl, openRouterKey: 'rk' })).resolves.toBe(null);
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
      groqKey: '',
      stdout,
      stderr,
    });
    const rows = JSON.parse(stdout.write.mock.calls[0][0]);
    expect(code).toBe(0);
    expect(rows).toEqual([
      { source: 'kilo', model: 'kilo-free', name: 'kilo-free', configured: true },
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
});

describe('OpenRouter pre-routing quota check', () => {
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
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
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
    expect(result.requestCounts).toEqual({ kilo: 1, openrouter: 1, groq: 0 });
    expect(onOpenRouterQuota).toHaveBeenCalledWith({ used: 10, limit: 50, remaining: 40 });
  });

  it('does not probe when OpenRouter is not in the catalog', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'k1', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'rk',
      checkOpenRouterQuota: true,
    });
    expect(result.source).toBe('kilo');
    const keyInfoCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).includes('api/v1/key'));
    expect(keyInfoCalls).toHaveLength(0);
  });

  it('falls through to normal exhaustion when the quota probe itself fails', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
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
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'k1',
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    await completeWithFreeModel('prompt', { fetchImpl });
    const kiloCall = chat.mock.calls.find((call) => String(call[0]).includes('kilo.ai'));
    const body = JSON.parse(kiloCall[1].body);
    expect(body.reasoning).toBeUndefined();
  });
});

describe('provider rate-limit diagnostics', () => {
  it('reports Retry-After and exhausts the source without retrying it', async () => {
    const fetchImpl = catalogFetch({
      kilo: [],
      openrouter: [openRouterRow('r1'), openRouterRow('r2')],
      chat: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        })
      ),
    });
    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /429: rate limited \(Retry-After: 30\)/
    );
    const completionCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('openrouter.ai/api/v1/chat'));
    expect(completionCalls).toHaveLength(1);
  });

  it('preserves Retry-After when a rate-limit response body is malformed', async () => {
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
    await expect(completeWithFreeModel('test', { fetchImpl, openRouterKey: 'rk' })).rejects.toThrow(
      /Model response is not valid JSON \(Retry-After: 45\)/
    );
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
