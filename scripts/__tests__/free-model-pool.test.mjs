import { describe, expect, it, vi } from 'vitest';
import { catalogCandidates, completeWithFreeModel, loadCatalogs, zeroPriced } from '../free-model-pool.mjs';

const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });
const openRouterRow = (id) => ({ id: `${id}:free`, pricing: { prompt: '0', completion: '0' } });

function catalogFetch({ kilo = [], openrouter = [], chat }) {
  return vi.fn((url, options = {}) => {
    if (url.endsWith('/models') && url.includes('openrouter')) {
      return Promise.resolve({ ok: true, json: async () => ({ data: openrouter }) });
    }
    if (url.endsWith('/models')) return Promise.resolve({ ok: true, json: async () => kilo });
    return chat(url, options);
  });
}

describe('free model catalog filtering', () => {
  it('requires both input and output prices to be exactly zero', () => {
    expect(zeroPriced({ prompt: '0', completion: '0' })).toBe(true);
    expect(zeroPriced({ prompt: '0', completion: '0.000001' })).toBe(false);
    expect(zeroPriced({ prompt: '-1', completion: '-1' })).toBe(false);
  });

  it('keeps only explicit free variants from both catalogs', () => {
    const data = [
      { id: 'a:free', pricing: { prompt: '0', completion: '0' }, isFree: true },
      { id: 'b', pricing: { prompt: '0', completion: '0' }, isFree: true },
      { id: 'c:free', pricing: { prompt: '0', completion: '1' }, isFree: true },
      { id: 'paid', pricing: { prompt: '1', completion: '1' } },
    ];
    expect(catalogCandidates('openrouter', data).map((row) => row.model)).toEqual(['a:free']);
    expect(catalogCandidates('kilo', data).map((row) => row.model)).toEqual(['a:free', 'b']);
  });

  it('keeps Kilo candidates available when the optional OpenRouter catalog is down', async () => {
    const fetchImpl = vi.fn((url) =>
      url.includes('openrouter')
        ? Promise.resolve({ ok: false, status: 401 })
        : Promise.resolve({ ok: true, json: async () => [kiloRow('kilo-auto/free')] })
    );
    const errors = [];
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: 'test',
      onCatalogError: (source) => errors.push(source),
    });
    expect(candidates.map((row) => row.model)).toEqual(['kilo-auto/free']);
    expect(errors).toEqual(['openrouter']);
  });
});

describe('free model rotation', () => {
  it('moves to the next provider after exhaustion and never retries that source', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { message: 'limit' } }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' } }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1'), kiloRow('k2')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('safe prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free', content: 'done' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(JSON.parse(chat.mock.calls[1][1].body).model).toBe('o1:free');
  });

  it('stops with a clear error when every free source is exhausted', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    await expect(completeWithFreeModel('prompt', { fetchImpl })).rejects.toThrow(/No free model completed/);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('ignores caller supplied paid candidates and only uses the live filtered catalog', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      kilo: [{ id: 'paid-model', isFree: false, pricing: { prompt: '1', completion: '1' } }],
      chat,
    });
    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        candidates: [{ source: 'kilo', model: 'paid-model' }],
      })
    ).rejects.toThrow(/No free model completed/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('rejects a response whose resolved model is absent from the verified free catalog', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'paid-model', choices: [{ message: { content: 'unexpected' } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'free result' } }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free', content: 'free result' });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('applies a timeout and rotates after a stalled model request', async () => {
    const chat = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('request timed out', 'TimeoutError'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' } }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('rotates after a successful HTTP response with an empty completion', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: null }, finish_reason: 'length' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' } }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
  });
});
