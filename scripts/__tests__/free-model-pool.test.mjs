import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogCandidates,
  completeWithFreeModel as completeWithFreeModelImplementation,
  loadCatalogs,
  main,
  MAX_CATALOG_RESPONSE_BYTES,
  MAX_COMPLETION_RESPONSE_BYTES,
  readBoundedPrompt,
  runOpenCodeCompletion,
  zeroPriced,
} from '../free-model-pool.mjs';

const completeWithFreeModel = (prompt, options = {}) =>
  completeWithFreeModelImplementation(prompt, { ...options, initializeLegacyQuarantine: false });
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

function catalogFetch({ kilo = [], openrouter = [], opencode = [], groq = [], chat }) {
  return readableFetch(async (url, options = {}) => {
    let response;
    if (url.endsWith('/models') && url.includes('openrouter')) {
      response = { ok: true, json: async () => ({ data: openrouter }) };
    } else if (url.includes('opencode.ai')) {
      response = { ok: true, json: async () => ({ data: opencode }) };
    } else if (url.includes('api.groq.com') && url.endsWith('/models')) {
      response = { ok: true, json: async () => ({ data: groq }) };
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

  it('selects only documented OpenCode free IDs and the explicitly supported Groq model', () => {
    expect(
      catalogCandidates('opencode', [
        { id: 'beam-free', owned_by: 'opencode' },
        { id: 'beam', owned_by: 'opencode' },
        { id: 'other-free', owned_by: 'other' },
      ]).map((row) => row.model)
    ).toEqual(['beam-free']);
    expect(
      catalogCandidates('groq', [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }]).map((row) => row.model)
    ).toEqual(['openai/gpt-oss-120b']);
  });

  it('filters only currently quarantined source/model pairs', () => {
    const data = [
      kiloRow('poolside/laguna-s-2.1:free'),
      kiloRow('kilo-auto/free'),
      kiloRow('nvidia/nemotron-3.5-super-vl:free'),
      kiloRow('recursive/flint-v1.0:free'),
    ];
    const quarantined = new Set([
      'kilo:kilo-auto/free',
      'kilo:nvidia/nemotron-3.5-super-vl:free',
      'kilo:recursive/flint-v1.0:free',
    ]);
    expect(catalogCandidates('kilo', data, quarantined).map((row) => row.model)).toEqual([
      'poolside/laguna-s-2.1:free',
    ]);
  });

  it('skips catalog rows whose model IDs are not strings', () => {
    const candidates = catalogCandidates('kilo', [
      { id: 42, isFree: true, pricing: { prompt: '0', completion: '0' } },
      { id: { toString: () => 'invalid:free' }, isFree: true, pricing: { prompt: '0', completion: '0' } },
      kiloRow('valid:free'),
    ]);

    expect(candidates.map((candidate) => candidate.model)).toEqual(['valid:free']);
  });

  it('loads active quarantines and ignores expired entries during catalog selection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const activeExpiry = new Date(Date.now() + 60_000).toISOString();
    const expiredTime = new Date(Date.now() - 60_000).toISOString();
    await writeFile(
      quarantineFile,
      JSON.stringify({
        schemaVersion: 1,
        entries: {
          'kilo:blocked:free': {
            source: 'kilo',
            model: 'blocked:free',
            reason: 'rate_limit',
            quarantinedAt: new Date(Date.now() - 60_000).toISOString(),
            expiresAt: activeExpiry,
          },
          'kilo:recovered:free': {
            source: 'kilo',
            model: 'recovered:free',
            reason: 'provider_outage',
            quarantinedAt: new Date(Date.now() - 120_000).toISOString(),
            expiresAt: expiredTime,
          },
        },
      }),
      'utf8'
    );
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('blocked:free'), kiloRow('recovered:free')],
      chat: vi.fn(),
    });

    try {
      const candidates = await loadCatalogs({ fetchImpl, openRouterKey: '', quarantineFile });
      expect(candidates.map((candidate) => candidate.model)).toEqual(['recovered:free']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed before requesting catalogs when quarantine state is corrupt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-quarantine-corrupt-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const fetchImpl = vi.fn();
    await writeFile(quarantineFile, '{broken', 'utf8');

    try {
      await expect(loadCatalogs({ fetchImpl, openRouterKey: '', quarantineFile })).rejects.toThrow(/not valid JSON/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
      onCatalogError: (_source, error) => errors.push(error.message),
    });

    expect(candidates).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${MAX_CATALOG_RESPONSE_BYTES}-byte limit`),
        expect.stringContaining('opencode catalog exceeds'),
      ])
    );
  });
});

describe('free model rotation', () => {
  it('falls through to OpenCode using its tool-disabled completion adapter', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('kilo:free')],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      chat,
    });
    const runOpenCode = vi.fn().mockResolvedValue({ content: 'OpenCode result', finishReason: 'stop' });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      opencodeCommand: '/opt/opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'OpenCode result' });
    expect(runOpenCode).toHaveBeenCalledWith({
      command: '/opt/opencode',
      model: 'beam-free',
      prompt: 'safe prompt',
      maxTokens: 1200,
    });
  });

  it('routes to Groq only with an explicit free-plan opt-in', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: 'Groq result' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKey: 'groq-test',
      groqFreePlan: true,
      opencodeCommand: '',
    });

    expect(result).toMatchObject({ source: 'groq', model: 'openai/gpt-oss-120b', content: 'Groq result' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(chat.mock.calls[0][1].headers.Authorization).toBe('Bearer groq-test');
    expect(JSON.parse(chat.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'low', max_tokens: 1200 });
  });

  it('does not query or route to Groq without the free-plan opt-in', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('unexpected inference request'));
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: '',
        groqApiKey: 'groq-test',
        groqFreePlan: false,
        opencodeCommand: '',
      })
    ).rejects.toThrow(/No free model completed/);
    expect(fetchImpl).not.toHaveBeenCalledWith('https://api.groq.com/openai/v1/models', expect.anything());
    expect(chat).not.toHaveBeenCalled();
  });

  it('runs OpenCode with every tool denied and accepts only terminal text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const command = join(directory, 'fake-opencode');
    await writeFile(
      command,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (!process.env.OPENCODE_CONFIG_CONTENT.includes('tool.use')) process.exit(9);\nif (!fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8').includes('private prompt')) process.exit(8);\nconsole.log(JSON.stringify({ type: 'text', part: { text: 'complete answer' } }));\nconsole.log(JSON.stringify({ type: 'done', rejected: [] }));\n`,
      { encoding: 'utf8', mode: 0o700 }
    );

    try {
      await expect(
        runOpenCodeCompletion({ command, model: 'beam-free', prompt: 'private prompt', maxTokens: 64 })
      ).resolves.toMatchObject({ content: 'complete answer', finishReason: 'stop', model: 'beam-free' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

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
        initializeLegacyQuarantine: false,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toBe(
        '[kilo/poolside/laguna-s-2.1:free]\nFinish reason: stop\nUsage: null\n' +
          'Requests attempted (this run): {"kilo":1,"openrouter":0}\n\nconcise result\n'
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
      stderr,
    });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects unsupported options before making requests', async () => {
    const fetchImpl = vi.fn();
    const stderr = { write: vi.fn() };
    const code = await main(['--unsupported-option', '--list'], { fetchImpl, stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Unknown option: --unsupported-option'));
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
      const code = await main(['--prompt-file', promptPath], { fetchImpl, openRouterKey: '', stderr });
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
