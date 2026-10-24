import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogCandidates,
  completeWithFreeModel,
  loadCatalogs,
  main,
  MAX_CATALOG_RESPONSE_BYTES,
  MAX_COMPLETION_RESPONSE_BYTES,
  readBoundedPrompt,
  zeroPriced,
} from '../free-model-pool.mjs';

const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });
const openRouterRow = (id) => ({ id: `${id}:free`, pricing: { prompt: '0', completion: '0' } });

async function responseWithReadableBody(response) {
  if (response instanceof Response) return response;
  const payload = typeof response?.json === 'function' ? await response.json() : undefined;
  const status = response?.status ?? (response?.ok === false ? 500 : 200);
  return new Response(payload === undefined ? '' : JSON.stringify(payload), { status });
}

function readableFetch(fetchImpl) {
  return vi.fn(async (...args) => responseWithReadableBody(await fetchImpl(...args)));
}

function catalogFetch({ kilo = [], openrouter = [], chat }) {
  return readableFetch(async (url, options = {}) => {
    let response;
    if (url.endsWith('/models') && url.includes('openrouter')) {
      response = { ok: true, json: async () => ({ data: openrouter }) };
    } else if (url.endsWith('/models')) {
      response = { ok: true, json: async () => kilo };
    } else {
      response = await chat(url, options);
    }
    return response;
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

  it('quarantines Kilo models that repeatedly failed while preserving known-good models', () => {
    const data = [
      kiloRow('poolside/laguna-s-2.1:free'),
      kiloRow('kilo-auto/free'),
      kiloRow('nvidia/nemotron-3.5-super-vl:free'),
      kiloRow('recursive/flint-v1.0:free'),
    ];
    expect(catalogCandidates('kilo', data).map((row) => row.model)).toEqual(['poolside/laguna-s-2.1:free']);
  });

  it('tries the observed reliable Kilo model before other eligible candidates', () => {
    const data = [kiloRow('unverified:free'), kiloRow('poolside/laguna-s-2.1:free'), kiloRow('also-unverified')];
    expect(catalogCandidates('kilo', data).map((row) => row.model)).toEqual([
      'poolside/laguna-s-2.1:free',
      'unverified:free',
      'also-unverified',
    ]);
  });

  it('keeps Kilo candidates available when the optional OpenRouter catalog is down', async () => {
    const fetchImpl = readableFetch((url) =>
      url.includes('openrouter')
        ? Promise.resolve({ ok: false, status: 401 })
        : Promise.resolve({ ok: true, json: async () => [kiloRow('poolside/laguna-s-2.1:free')] })
    );
    const errors = [];
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: 'test',
      onCatalogError: (source) => errors.push(source),
    });
    expect(candidates.map((row) => row.model)).toEqual(['poolside/laguna-s-2.1:free']);
    expect(errors).toEqual(['openrouter']);
  });

  it('refuses an oversized catalog body', async () => {
    const fetchImpl = readableFetch(() => new Response(Buffer.alloc(MAX_CATALOG_RESPONSE_BYTES + 1)));
    const errors = [];
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: '',
      groqKey: '',
      onCatalogError: (_source, error) => errors.push(error.message),
    });

    expect(candidates).toEqual([]);
    expect(errors).toEqual([expect.stringContaining(`${MAX_CATALOG_RESPONSE_BYTES}-byte limit`)]);
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
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
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

  it('caps retries to three model requests per source before rotating providers', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('k1'), kiloRow('k2'), kiloRow('k3'), kiloRow('k4')],
      openrouter: [openRouterRow('o1')],
      chat,
    });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat).toHaveBeenCalledTimes(4);
    expect(JSON.parse(chat.mock.calls[2][1].body).model).toBe('k3');
    expect(JSON.parse(chat.mock.calls[3][1].body).model).toBe('o1:free');
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
        json: async () => ({
          model: 'paid-model',
          choices: [{ message: { content: 'unexpected' }, finish_reason: 'stop' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'o1:free',
          choices: [{ message: { content: 'free result' }, finish_reason: 'stop' }],
        }),
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
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('rotates after a successful HTTP response with a truncated completion', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'k1',
          choices: [{ message: { content: 'partial text' }, finish_reason: 'length' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
  });

  it('rotates after a successful HTTP response with no completion text', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'k1', choices: [{ message: { content: null }, finish_reason: 'length' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['numeric zero', { cost: 0 }, true],
    ['string zero', { cost: '0' }, true],
    ['empty cost text', { cost: '' }, false],
    ['null cost', { cost: null }, false],
    ['boolean cost', { cost: false }, false],
    ['malformed nested cost', { cost_details: { upstream_inference_cost: '' } }, false],
    ['additional nested provider cost', { cost_details: { providerCost: '0.02' } }, false],
  ])('accepts only valid zero usage cost: %s', async (_label, usage, shouldAccept) => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'k1',
        usage,
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    const completion = completeWithFreeModel('prompt', { fetchImpl });
    if (shouldAccept) {
      await expect(completion).resolves.toMatchObject({ finishReason: 'stop', content: 'done' });
    } else {
      await expect(completion).rejects.toThrow(/non-zero or invalid usage cost/);
    }
  });

  it('stops before another provider can hide a reported charge on an incomplete response', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'k1',
          usage: { cost: '0.02' },
          choices: [{ message: { content: 'partial result' }, finish_reason: 'length' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'o1:free',
          choices: [{ message: { content: 'apparently free result' }, finish_reason: 'stop' }],
        }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
      /provider reported non-zero or invalid usage cost; refusing further requests/
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops when an error response reports a non-zero cost', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ usage: { total_cost: 0.01 }, error: { message: 'request rejected' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'o1:free',
          choices: [{ message: { content: 'apparently free result' }, finish_reason: 'stop' }],
        }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
      /provider reported non-zero or invalid usage cost; refusing further requests/
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe('free model runner CLI', () => {
  it('writes a bounded completion for a catalog-verified free model when usage is omitted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'result.txt');
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchImpl = readableFetch((url) =>
      url.endsWith('/models')
        ? Promise.resolve({ ok: true, json: async () => [kiloRow('poolside/laguna-s-2.1:free')] })
        : Promise.resolve({
            ok: true,
            json: async () => ({
              model: 'poolside/laguna-s-2.1:free',
              choices: [{ message: { content: 'concise result' }, finish_reason: 'stop' }],
            }),
          })
    );
    try {
      await writeFile(promptPath, 'summarize briefly', 'utf8');
      const code = await main(['--prompt-file', promptPath, '--output-file', outputPath], {
        fetchImpl,
        openRouterKey: '',
        groqKey: '',
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toBe(
        '[kilo/poolside/laguna-s-2.1:free]\nFinish reason: stop\nUsage: null\n\nconcise result\n'
      );
      expect(stdout.write).not.toHaveBeenCalled();
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Result written to'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects missing option values before reading files or making requests', async () => {
    const fetchImpl = vi.fn();
    const stderr = { write: vi.fn() };
    const code = await main(['--prompt-file', 'prompt.txt', '--output-file'], {
      fetchImpl,
      openRouterKey: '',
      groqKey: '',
      stderr,
    });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects prompts above the bounded character budget before catalog requests', async () => {
    const fetchImpl = vi.fn();
    await expect(completeWithFreeModel('x'.repeat(120_001), { fetchImpl })).rejects.toThrow(/120000 characters/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses an oversized completion body', async () => {
    const chat = vi.fn().mockResolvedValue(new Response(Buffer.alloc(MAX_COMPLETION_RESPONSE_BYTES + 1)));
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });

    await expect(completeWithFreeModel('prompt', { fetchImpl })).rejects.toThrow(
      `Model response exceeds the ${MAX_COMPLETION_RESPONSE_BYTES}-byte limit`
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized or invalid UTF-8 prompt file before catalog requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-'));
    const promptPath = join(directory, 'prompt.txt');
    const fetchImpl = vi.fn();
    const stderr = { write: vi.fn() };
    try {
      await writeFile(promptPath, Buffer.alloc(480 * 1024 + 1, 0x61));
      const code = await main(['--prompt-file', promptPath], { fetchImpl, openRouterKey: '', groqKey: '', stderr });
      expect(code).toBe(2);
      expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('at most 491520 bytes'));
      expect(fetchImpl).not.toHaveBeenCalled();

      await writeFile(promptPath, Buffer.from([0xc3, 0x28]));
      await expect(readBoundedPrompt(promptPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
