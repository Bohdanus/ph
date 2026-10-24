import { describe, expect, it, vi } from 'vitest';
import { catalogCandidates, completeWithFreeModel, loadCatalogs, zeroPriced } from '../free-model-pool.mjs';

const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });
const openRouterRow = (id) => ({ id: `${id}:free`, pricing: { prompt: '0', completion: '0' } });
const groqRow = (id) => ({ id, owned_by: 'system', context_window: 8192 });

async function responseWithReadableBody(response) {
  if (response instanceof Response) return response;
  const payload = typeof response?.json === 'function' ? await response.json() : undefined;
  const status = response?.status ?? (response?.ok === false ? 500 : 200);
  return new Response(payload === undefined ? '' : JSON.stringify(payload), { status });
}

function readableFetch(fetchImpl) {
  return vi.fn(async (...args) => responseWithReadableBody(await fetchImpl(...args)));
}

function catalogFetch({ kilo = [], openrouter = [], groq = [], chat }) {
  return readableFetch(async (url, options = {}) => {
    if (url.includes('openrouter')) {
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: openrouter }) };
      return chat(url, options);
    }
    if (url.includes('groq')) {
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: groq }) };
      return chat(url, options);
    }
    if (url.endsWith('/models')) return { ok: true, json: async () => kilo };
    return chat(url, options);
  });
}

describe('groq catalog filtering', () => {
  it('keeps only known free Groq model IDs (no pricing field needed)', () => {
    const data = {
      data: [
        groqRow('openai/gpt-oss-20b'),
        groqRow('openai/gpt-oss-120b'),
        groqRow('llama-3-70b'),
        groqRow('some-paid-model'),
      ],
    };
    expect(catalogCandidates('groq', data).map((row) => row.model)).toEqual([
      'openai/gpt-oss-20b',
      'openai/gpt-oss-120b',
    ]);
  });

  it('returns empty for groq when no free models match', () => {
    const data = { data: [groqRow('llama-3-70b')] };
    expect(catalogCandidates('groq', data).map((row) => row.model)).toEqual([]);
  });
});

describe('loadCatalogs with groq', () => {
  it('includes groq source when GROQ_API_KEY is set', async () => {
    const fetchImpl = readableFetch((url) => {
      if (url.includes('groq')) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [groqRow('openai/gpt-oss-20b')] }) });
      }
      if (url.includes('openrouter')) return Promise.resolve({ ok: false, status: 401 });
      return Promise.resolve({ ok: true, json: async () => [kiloRow('poolside/laguna-s-2.1:free')] });
    });
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: undefined,
      groqKey: 'test-key',
      groqFreePlanConfirmed: true,
      onCatalogError: () => {},
    });
    expect(candidates.some((c) => c.source === 'groq' && c.model === 'openai/gpt-oss-20b')).toBe(true);
  });

  it('does not probe Groq when a key is present but its free plan is not explicitly confirmed', async () => {
    const fetchImpl = readableFetch((url) => {
      if (url.includes('groq'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [groqRow('openai/gpt-oss-20b')] }) });
      return Promise.resolve({ ok: true, json: async () => [kiloRow('poolside/laguna-s-2.1:free')] });
    });
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: undefined,
      groqKey: 'test-key',
      onCatalogError: () => {},
    });
    expect(candidates.some((c) => c.source === 'groq')).toBe(false);
    expect(candidates.some((c) => c.source === 'kilo')).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('groq'), expect.anything());
  });
});

describe('completeWithFreeModel with groq', () => {
  it('sends groq requests with the bearer key header', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'k1',
          choices: [{ message: { content: 'kilo result' }, finish_reason: 'stop' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-20b',
          choices: [{ message: { content: 'groq result' }, finish_reason: 'stop' }],
        }),
      });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      groq: [groqRow('openai/gpt-oss-20b')],
      chat,
    });
    const result = await completeWithFreeModel('test prompt', {
      fetchImpl,
      openRouterKey: undefined,
      groqKey: 'secret-key',
      groqFreePlanConfirmed: true,
    });
    expect(result).toMatchObject({ source: 'kilo', model: 'k1', content: 'kilo result' });
    expect(chat.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(chat.mock.calls[0][1].body).model).toBe('k1');
  });

  it('uses groq bearer header when groq is the selected source', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-20b',
        choices: [{ message: { content: 'groq result' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      kilo: [],
      groq: [groqRow('openai/gpt-oss-20b')],
      chat,
    });
    const result = await completeWithFreeModel('test prompt', {
      fetchImpl,
      openRouterKey: undefined,
      groqKey: 'secret-key',
      groqFreePlanConfirmed: true,
    });
    expect(result).toMatchObject({ source: 'groq', model: 'openai/gpt-oss-20b', content: 'groq result' });
    expect(chat.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-key');
    expect(JSON.parse(chat.mock.calls[0][1].body).model).toBe('openai/gpt-oss-20b');
  });

  it('does not use groq models when groqKey is absent', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'limit' } }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1')],
      groq: [groqRow('openai/gpt-oss-20b')],
      chat,
    });
    await expect(
      completeWithFreeModel('test prompt', {
        fetchImpl,
        openRouterKey: undefined,
        groqKey: undefined,
      })
    ).rejects.toThrow(/No free model completed/);
    const groqCalls = chat.mock.calls.filter((call) => JSON.parse(call[1].body).model === 'openai/gpt-oss-20b');
    expect(groqCalls.length).toBe(0);
  });
});

describe('zeroPriced', () => {
  it('requires both fields to be exactly "0"', () => {
    expect(zeroPriced({ prompt: '0', completion: '0' })).toBe(true);
    expect(zeroPriced({ prompt: '0', completion: '0.0001' })).toBe(false);
    expect(zeroPriced({ prompt: '0.0001', completion: '0' })).toBe(false);
    expect(zeroPriced({})).toBe(false);
    expect(zeroPriced(null)).toBe(false);
  });
});
