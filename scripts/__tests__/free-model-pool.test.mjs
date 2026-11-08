import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import {
  catalogCandidates,
  completeWithFreeModel as completeWithFreeModelImplementation,
  CONTROL_PLANE_TIMEOUT_MS,
  discoverGroqKeyFiles,
  isContentPolicyError,
  loadCatalogs,
  main,
  MAX_CATALOG_RESPONSE_BYTES,
  MAX_COMPLETION_RESPONSE_BYTES,
  normalizeGroqKeys,
  orderFreeModelRoutes,
  readBoundedPrompt,
  runOpenCodeCompletion,
  zeroPriced,
} from '../free-model-pool.mjs';
import { COMPLETION_TIMEOUT_MS } from '../lib/free-model-kilo.mjs';
import { readQuarantineState } from '../lib/free-model-quarantine.mjs';

vi.setConfig({ testTimeout: 30_000 });

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

async function writeFakeOpenCode(directory, source) {
  const commandPath = join(directory, 'fake-opencode');
  if (process.platform === 'win32') {
    const scriptPath = `${commandPath}.cjs`;
    const shimPath = `${commandPath}.cmd`;
    await writeFile(scriptPath, `${source}\n`, 'utf8');
    await writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return shimPath;
  }
  await writeFile(commandPath, `#!/usr/bin/env node\n${source}\n`, { encoding: 'utf8', mode: 0o700 });
  return commandPath;
}
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

function catalogFetch({ kilo = [], openrouter = [], opencode = [], groq = [], keyInfo, chat }) {
  return readableFetch(async (url, options = {}) => {
    let response;
    if (url.endsWith('/models') && url.includes('openrouter')) {
      response = { ok: true, json: async () => ({ data: openrouter }) };
    } else if (url.includes('opencode.ai')) {
      response = { ok: true, json: async () => ({ data: opencode }) };
    } else if (url.includes('api.groq.com') && url.endsWith('/models')) {
      response = { ok: true, json: async () => ({ data: groq }) };
    } else if (url.includes('/api/v1/key')) {
      response = keyInfo?.() ?? {
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 } } }),
      };
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
      kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'),
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
      'nvidia/nemotron-3-ultra-550b-a55b:free',
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
    const data = [
      kiloRow('unverified:free'),
      kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'),
      kiloRow('also-unverified'),
    ];
    expect(catalogCandidates('kilo', data).map((row) => row.model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'unverified:free',
      'also-unverified',
    ]);
  });

  it('tries OpenRouter Nemotron 3 Ultra first and preserves catalog order for remaining free models', () => {
    const data = [
      openRouterRow('vendor/first'),
      openRouterRow('nvidia/nemotron-3-ultra-550b-a55b'),
      openRouterRow('vendor/last'),
    ];
    expect(catalogCandidates('openrouter', data).map((row) => row.model)).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'vendor/first:free',
      'vendor/last:free',
    ]);
  });

  it('keeps all exact Nemotron routes ahead of the OpenRouter, OpenCode, and Groq fallback tiers', () => {
    const nemotron = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const routes = orderFreeModelRoutes([
      { source: 'groq', model: 'openai/gpt-oss-120b' },
      { source: 'kilo', model: 'kilo-lower:free' },
      { source: 'opencode', model: 'beam-free' },
      { source: 'openrouter', model: 'vendor/first:free' },
      { source: 'opencode', model: nemotron },
      { source: 'openrouter', model: nemotron },
      { source: 'kilo', model: nemotron },
    ]);

    expect(routes.map(({ source, model }) => `${source}:${model}`)).toEqual([
      `kilo:${nemotron}`,
      `openrouter:${nemotron}`,
      `opencode:${nemotron}`,
      'openrouter:vendor/first:free',
      'opencode:beam-free',
      'groq:openai/gpt-oss-120b',
    ]);
  });

  it('does not infer the Nemotron route from an OpenCode display name or fuzzy ID', () => {
    const openCode = catalogCandidates('opencode', [
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b-free',
        name: 'NVIDIA Nemotron 3 Ultra',
        owned_by: 'opencode',
      },
    ]);
    const openRouter = { source: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' };

    expect(orderFreeModelRoutes([...openCode, openRouter]).map(({ source }) => source)).toEqual([
      'openrouter',
      'opencode',
    ]);
  });

  it('accepts an exact canonical Nemotron ID from the provider-owned OpenCode catalog', () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const candidates = catalogCandidates('opencode', [{ id: model, owned_by: 'opencode' }]);

    expect(candidates).toEqual([{ source: 'opencode', model, name: model }]);
    expect(orderFreeModelRoutes(candidates)[0].model).toBe(model);
  });

  it('sends a catalog-verified OpenCode Nemotron route its profile and identity proof', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const fetchImpl = catalogFetch({ opencode: [{ id: model, owned_by: 'opencode' }], chat: vi.fn() });
    const runOpenCode = vi.fn().mockResolvedValue({ content: 'done', finishReason: 'stop', model });

    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      opencodeCommand: '/fake-opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({ source: 'opencode', model, content: 'done' });
    expect(runOpenCode).toHaveBeenCalledWith({
      command: '/fake-opencode',
      model,
      prompt: 'prompt',
      maxTokens: 4000,
      timeoutMs: 12 * 60 * 1000,
      verifiedNemotron: true,
    });
  });

  it('keeps Kilo candidates available when the optional OpenRouter catalog is down', async () => {
    const fetchImpl = readableFetch((url) =>
      url.includes('openrouter')
        ? Promise.resolve({ ok: false, status: 401 })
        : Promise.resolve({ ok: true, json: async () => [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free')] })
    );
    const errors = [];
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey: 'test',
      onCatalogError: (source) => errors.push(source),
    });
    expect(candidates.map((row) => row.model)).toEqual(['nvidia/nemotron-3-ultra-550b-a55b:free']);
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
  it('preserves an explicit token cap for preferred OpenRouter Nemotron 3 Ultra', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        choices: [{ message: { content: 'Nemotron result' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('nvidia/nemotron-3-ultra-550b-a55b')], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: 'test',
      maxTokens: 20,
    });

    expect(result).toMatchObject({
      source: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      content: 'Nemotron result',
    });
    expect(JSON.parse(chat.mock.calls[0][1].body)).toMatchObject({ max_tokens: 20 });
  });

  it('uses 4,000 output tokens and a twelve-minute timeout for Nemotron only when the cap is omitted', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model, choices: [{ message: { content: 'Nemotron result' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('nvidia/nemotron-3-ultra-550b-a55b')], chat });
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);

    try {
      await completeWithFreeModel('safe prompt', { fetchImpl, openRouterKey: 'test' });
      expect(JSON.parse(chat.mock.calls[0][1].body)).toMatchObject({ max_tokens: 4000 });
      expect(timeoutSpy).toHaveBeenCalledWith(12 * 60 * 1000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

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
      timeoutMs: COMPLETION_TIMEOUT_MS,
      verifiedNemotron: false,
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

  it('tries OpenCode before Groq after Nemotron routes are exhausted', async () => {
    const chat = vi.fn(async (url) => {
      if (url.includes('openrouter')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'upstream unavailable', metadata: { provider_name: 'router' } } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'Groq result' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free')],
      openrouter: [openRouterRow('nvidia/nemotron-3-ultra-550b-a55b')],
      groq: [{ id: 'openai/gpt-oss-120b' }],
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      keyInfo: () => ({
        ok: true,
        json: async () => ({ data: { free_model_daily_requests: { used: 10, limit: 1000, remaining: 990 } } }),
      }),
      chat,
    });
    const runKilo = vi.fn().mockResolvedValue({ error: 'Kilo quota', exhaustSource: true });
    const runOpenCode = vi.fn().mockResolvedValue({ content: 'OpenCode result', finishReason: 'stop' });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: 'openrouter-test',
      groqApiKey: 'groq-test',
      groqFreePlan: true,
      kiloCommand: '/fake-kilo',
      runKilo,
      opencodeCommand: '/opt/opencode',
      runOpenCode,
    });

    expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'OpenCode result' });
    expect(runKilo).toHaveBeenCalledTimes(1);
    expect(runOpenCode).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/chat/completions',
      'https://openrouter.ai/api/v1/chat/completions',
    ]);
    expect(result.requestCounts).toMatchObject({ kilo: 1, openrouter: 2, opencode: 1 });
  });

  it('rotates to the next Groq key on HTTP 429 from the first key', async () => {
    const chat = vi.fn(async (url, options) => {
      const auth = options.headers.Authorization;
      if (auth === 'Bearer groq-key1') return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'Groq result from key2' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['groq-key1', 'groq-key2'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    expect(result).toMatchObject({
      source: 'groq',
      model: 'openai/gpt-oss-120b',
      content: 'Groq result from key2',
      groqKeysAvailable: 1,
    });
    const auths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(auths).toEqual(['Bearer groq-key1', 'Bearer groq-key2']);
    expect(auths).not.toContain('Bearer groq-key1' + ' ' + 'groq-key1');
  });

  it('rotates to the next Groq key on HTTP 401 from an invalid first key', async () => {
    const chat = vi.fn(async (url, options) => {
      const auth = options.headers.Authorization;
      if (auth === 'Bearer invalid-key') return { ok: false, status: 401, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'Groq result from valid key' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['invalid-key', 'valid-key'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    expect(result).toMatchObject({
      source: 'groq',
      model: 'openai/gpt-oss-120b',
      content: 'Groq result from valid key',
    });
    const auths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(auths).toEqual(['Bearer invalid-key', 'Bearer valid-key']);
  });

  it('does not retry a Groq key that returned 401 within the same run', async () => {
    const chat = vi.fn(async (url, options) => {
      const auth = options.headers.Authorization;
      if (auth === 'Bearer dead-key') return { ok: false, status: 401, json: async () => ({}) };
      return { ok: false, status: 429, json: async () => ({}) };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    await expect(
      completeWithFreeModel('safe prompt', {
        fetchImpl,
        openRouterKey: '',
        groqApiKeys: ['dead-key', 'other-key'],
        groqFreePlan: true,
        opencodeCommand: '',
      })
    ).rejects.toThrow(/No free model completed/);
    const auths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(auths).toEqual(['Bearer dead-key', 'Bearer other-key']);
  });

  it('rotates to the next Groq key on HTTP 402', async () => {
    const chat = vi.fn(async (url, options) => {
      if (options.headers.Authorization === 'Bearer groq-key1')
        return { ok: false, status: 402, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'success' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['groq-key1', 'groq-key2'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    expect(result).toMatchObject({ source: 'groq', content: 'success' });
  });

  it('skips multiple invalid Groq keys and uses a valid one further down the list', async () => {
    const chat = vi.fn(async (url, options) => {
      const auth = options.headers.Authorization;
      if (auth === 'Bearer bad1' || auth === 'Bearer bad2') return { ok: false, status: 401, json: async () => ({}) };
      if (auth === 'Bearer bad3') return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['bad1', 'bad2', 'bad3', 'good-key'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    expect(result).toMatchObject({ source: 'groq', content: 'recovered' });
    const auths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(auths).toEqual(['Bearer bad1', 'Bearer bad2', 'Bearer bad3', 'Bearer good-key']);
  });

  it('marks the Groq source exhausted when all keys return per-key failures', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: '',
        groqApiKeys: ['k1', 'k2', 'k3'],
        groqFreePlan: true,
        opencodeCommand: '',
      })
    ).rejects.toThrow(/No free model completed/);
    const auths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(auths).toEqual(['Bearer k1', 'Bearer k2', 'Bearer k3']);
    expect(auths).toHaveLength(3);
  });

  it('reports groqKeysAvailable as remaining non-exhausted keys after rotation', async () => {
    const chat = vi.fn(async (url, options) => {
      const auth = options.headers.Authorization;
      if (auth === 'Bearer bad-key1') return { ok: false, status: 401, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openai/gpt-oss-120b',
          choices: [{ message: { content: 'success' }, finish_reason: 'stop' }],
        }),
      };
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['bad-key1', 'good-key', 'good-key2'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    expect(result.groqKeysAvailable).toBe(2);
  });

  it('uses the first Groq key for catalog loading and rotates on failures', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ groq: [{ id: 'openai/gpt-oss-120b' }], chat });
    await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: '',
      groqApiKeys: ['k1', 'k2'],
      groqFreePlan: true,
      opencodeCommand: '',
    });
    const groqUrl = 'https://api.groq.com/openai/v1/models';
    const catalogCalls = fetchImpl.mock.calls.filter((call) => call[0] === groqUrl);
    expect(catalogCalls[0][1].headers.Authorization).toBe('Bearer k1');
    const chatAuths = chat.mock.calls.map((call) => call[1].headers.Authorization);
    expect(chatAuths).toEqual(['Bearer k1']);
  });

  it('loads Groq key files from a directory in sorted order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'groq-keys-test-'));
    try {
      await writeFile(join(dir, 'api_key'), 'key-z', { mode: 0o600 });
      await writeFile(join(dir, 'api_key_account3'), 'key-3', { mode: 0o600 });
      await writeFile(join(dir, 'api_key_account2'), 'key-2', { mode: 0o600 });
      await writeFile(join(dir, 'not_a_key.txt'), 'ignore-me', { mode: 0o600 });
      await writeFile(join(dir, 'api_key_account5'), 'key-5', { mode: 0o600 });
      const { discoverGroqKeyFiles } = await import('../free-model-pool.mjs');
      const files = await discoverGroqKeyFiles(dir);
      expect(files.length).toBe(4);
      expect(files.map((file) => basename(file))).toEqual([
        'api_key',
        'api_key_account2',
        'api_key_account3',
        'api_key_account5',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalizes empty or missing Groq keys to an empty array', () => {
    expect(normalizeGroqKeys(undefined, [])).toEqual([]);
    expect(normalizeGroqKeys(null, undefined)).toEqual([]);
    expect(normalizeGroqKeys('', [null, '', undefined, 'real-key'])).toEqual(['real-key']);
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

  it('runs OpenCode with every tool denied and accepts clean-exit V2 text without a final event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const command = await writeFakeOpenCode(
      directory,
      `const fs = require('node:fs');
const args = process.argv.slice(2);
if (!process.env.OPENCODE_CONFIG_CONTENT.includes('tool.use')) process.exit(9);
if (!fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8').includes('private prompt')) process.exit(8);
console.log(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'complete answer' } }));`
    );

    try {
      await expect(
        runOpenCodeCompletion({ command, model: 'beam-free', prompt: 'private prompt', maxTokens: 64 })
      ).resolves.toMatchObject({ content: 'complete answer', finishReason: 'stop', model: 'beam-free', usage: null });
      await expect(
        runOpenCodeCompletion({
          command,
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          prompt: 'private prompt',
          maxTokens: 4000,
          timeoutMs: 12 * 60 * 1000,
          verifiedNemotron: true,
        })
      ).resolves.toMatchObject({
        content: 'complete answer',
        finishReason: 'stop',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')('launches a bare OpenCode command from PATH on Windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const commandPath = await writeFakeOpenCode(
      directory,
      "console.log(JSON.stringify({ type: 'text', part: { text: 'complete answer' } }));"
    );
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${directory}${delimiter}${previousPath ?? ''}`;
      await expect(
        runOpenCodeCompletion({
          command: basename(commandPath, '.cmd'),
          model: 'beam-free',
          prompt: 'prompt',
          maxTokens: 64,
        })
      ).resolves.toMatchObject({ content: 'complete answer', finishReason: 'stop', model: 'beam-free' });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('surfaces OpenCode provider errors and status without exposing response bodies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const command = await writeFakeOpenCode(
      directory,
      `console.log(JSON.stringify({ type: 'error', error: { type: 'provider.free-limit', status: 429, message: 'Free usage limit reached' } }));
process.exit(1);`
    );

    try {
      await expect(
        runOpenCodeCompletion({ command, model: 'beam-free', prompt: 'prompt', maxTokens: 8 })
      ).rejects.toThrow('OpenCode exited 1: provider.free-limit (HTTP 429)');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects non-free OpenCode IDs before starting the CLI', async () => {
    await expect(
      runOpenCodeCompletion({ command: '/missing-opencode', model: 'beam', prompt: 'prompt', maxTokens: 8 })
    ).resolves.toMatchObject({ error: 'OpenCode model is not an eligible free catalog ID' });
  });

  it('allows the canonical Nemotron ID only after catalog verification', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    await expect(
      runOpenCodeCompletion({ command: '/missing-opencode', model, prompt: 'prompt', verifiedNemotron: true })
    ).rejects.toThrow();
    await expect(
      runOpenCodeCompletion({ command: '/missing-opencode', model, prompt: 'prompt' })
    ).resolves.toMatchObject({ error: 'OpenCode model is not an eligible free catalog ID' });
  });

  it('rejects invalid OpenCode timeouts before starting the CLI', async () => {
    await expect(
      runOpenCodeCompletion({ command: '/missing-opencode', model: 'beam-free', prompt: 'prompt', timeoutMs: 0 })
    ).resolves.toMatchObject({ error: 'Invalid OpenCode timeout' });
    await expect(
      runOpenCodeCompletion({
        command: '/missing-opencode',
        model: 'beam-free',
        prompt: 'prompt',
        timeoutMs: 12 * 60 * 1000 + 1,
      })
    ).resolves.toMatchObject({ error: 'Invalid OpenCode timeout' });
  });

  it('kills the OpenCode process tree after a timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const pidFile = join(directory, 'descendant.pid');
    const sentinel = join(directory, 'descendant-survived');
    const descendantScript = `process.on('SIGTERM', () => {}); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive'), 4000); setInterval(() => {}, 1000);`;
    const command = await writeFakeOpenCode(
      directory,
      `const { spawn } = require('node:child_process');\nconst fs = require('node:fs');\nconst descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));\nsetInterval(() => {}, 1000);\n`
    );
    let descendantPid;

    try {
      await expect(
        runOpenCodeCompletion({
          command,
          model: 'beam-free',
          prompt: 'prompt',
          maxTokens: 8,
          timeoutMs: 1000,
        })
      ).rejects.toThrow('OpenCode timed out after 1000ms');
      descendantPid = Number(await readFile(pidFile, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 4500));
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      if (Number.isSafeInteger(descendantPid) && descendantPid > 0) {
        try {
          process.kill(descendantPid);
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it('rejects an explicit non-zero OpenCode cost even for a free catalog ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-test-'));
    const command = await writeFakeOpenCode(
      directory,
      `console.log(JSON.stringify({ type: 'text', part: { text: 'answer' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));`
    );

    try {
      await expect(
        runOpenCodeCompletion({ command, model: 'beam-free', prompt: 'prompt', maxTokens: 8 })
      ).resolves.toMatchObject({ error: 'OpenCode reported non-zero or invalid cost' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('moves to the next provider after exhaustion and never retries that source', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'), kiloRow('k2')],
      openrouter: [openRouterRow('o1')],
      chat,
    });
    const runKilo = vi.fn().mockResolvedValue({ error: 'provider quota', exhaustSource: true });
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: 'test',
      kiloCommand: '/fake-kilo',
      runKilo,
    });
    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free', content: 'done' });
    expect(runKilo).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.parse(chat.mock.calls[0][1].body).model).toBe('o1:free');
  });

  it('exhausts Kilo after its resolved CLI cannot start instead of retrying every model', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'), kiloRow('k2')],
      openrouter: [openRouterRow('o1')],
      chat,
    });
    const spawnError = Object.assign(new Error('Kilo CLI could not be started'), { code: 'KILO_SPAWN' });
    const runKilo = vi.fn().mockRejectedValue(spawnError);
    const result = await completeWithFreeModel('safe prompt', {
      fetchImpl,
      openRouterKey: 'test',
      kiloCommand: '/invalid-kilo-cli',
      runKilo,
    });

    expect(result).toMatchObject({ source: 'openrouter', model: 'o1:free', content: 'done' });
    expect(runKilo).toHaveBeenCalledTimes(1);
    expect(result.requestCounts).toMatchObject({ kilo: 1, openrouter: 1 });
  });

  it('stops with a clear error when every free source is exhausted', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], chat });
    await expect(completeWithFreeModel('prompt', { fetchImpl })).rejects.toThrow(/No free model completed/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('exhausts a single-key provider on HTTP 401 to avoid retrying an invalid key', async () => {
    const chat = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const fetchImpl = catalogFetch({
      openrouter: [openRouterRow('o1'), openRouterRow('o2')],
      chat,
    });
    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'expired-key' })).rejects.toThrow(
      /No free model completed/
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][1].headers.Authorization).toBe('Bearer expired-key');
  });

  it('does not use lower-priority Kilo models after its Nemotron route fails', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const runKilo = vi.fn().mockResolvedValue({ error: 'model unavailable' });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free'), kiloRow('k2'), kiloRow('k3'), kiloRow('k4')],
      openrouter: [openRouterRow('o1')],
      chat,
    });
    const result = await completeWithFreeModel('prompt', {
      fetchImpl,
      openRouterKey: 'test',
      kiloCommand: '/fake-kilo',
      runKilo,
    });
    expect(result.source).toBe('openrouter');
    expect(runKilo).toHaveBeenCalledTimes(1);
    expect(runKilo.mock.calls.map(([options]) => options.model)).toEqual(['nvidia/nemotron-3-ultra-550b-a55b:free']);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.parse(chat.mock.calls[0][1].body).model).toBe('o1:free');
  });

  it('persists Kilo HTTP 429 for one hour and skips the source on the next invocation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-kilo-cooldown-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const poolStateFile = join(directory, 'pool-state.json');
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model, choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({
      kilo: [kiloRow(model)],
      openrouter: [openRouterRow('nvidia/nemotron-3-ultra-550b-a55b')],
      chat,
    });
    const runKilo = vi.fn().mockResolvedValue({ error: 'rate limited', status: 429, exhaustSource: true });

    try {
      const first = await completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: 'rk',
        kiloCommand: '/fake-kilo',
        runKilo,
        quarantineFile,
        poolStateFile,
      });
      const second = await completeWithFreeModel('prompt', {
        fetchImpl,
        openRouterKey: 'rk',
        kiloCommand: '/fake-kilo',
        runKilo,
        quarantineFile,
        poolStateFile,
      });

      expect(first.source).toBe('openrouter');
      expect(second.requestCounts).toMatchObject({ kilo: 0, openrouter: 1 });
      expect(runKilo).toHaveBeenCalledTimes(1);
      expect(Date.parse(JSON.parse(await readFile(poolStateFile, 'utf8')).kiloCooldownUntil)).toBeGreaterThan(
        Date.now()
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists exhausted OpenRouter quota for the UTC date and skips its next preflight', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-openrouter-quota-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const poolStateFile = join(directory, 'pool-state.json');
    const chat = vi.fn();
    const keyInfo = vi.fn(() => ({
      ok: true,
      json: async () => ({ data: { free_model_daily_requests: { used: 17, limit: 17, remaining: 0 } } }),
    }));
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('vendor/model')], keyInfo, chat });

    try {
      await expect(
        completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', quarantineFile, poolStateFile })
      ).rejects.toThrow(/No free model completed/);
      await expect(
        completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'rk', quarantineFile, poolStateFile })
      ).rejects.toThrow(/No free model completed/);

      const state = JSON.parse(await readFile(poolStateFile, 'utf8'));
      expect(state.openRouterExhaustedUtcDate).toBe(new Date().toISOString().slice(0, 10));
      expect(keyInfo).toHaveBeenCalledTimes(1);
      expect(chat).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not retry or quarantine OpenCode provider.free-limit account quota errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-opencode-limit-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const poolStateFile = join(directory, 'pool-state.json');
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-120b',
        choices: [{ message: { content: 'Groq fallback' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      groq: [{ id: 'openai/gpt-oss-120b' }],
      chat,
    });
    const runOpenCode = vi.fn().mockResolvedValue({
      error: 'OpenCode free account limit',
      errorType: 'provider.free-limit',
      status: 429,
      accountQuota: true,
    });

    try {
      const result = await completeWithFreeModel('prompt', {
        fetchImpl,
        opencodeCommand: '/fake-opencode',
        runOpenCode,
        groqApiKey: 'gk',
        groqFreePlan: true,
        quarantineFile,
        poolStateFile,
      });

      expect(result.source).toBe('groq');
      expect(runOpenCode).toHaveBeenCalledTimes(1);
      expect((await readQuarantineState(quarantineFile)).entries['opencode:beam-free']).toBeUndefined();
      await expect(readFile(poolStateFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retries a non-account OpenCode 429 once after a bounded Retry-After', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-opencode-retry-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const poolStateFile = join(directory, 'pool-state.json');
    const waitForRetryAfter = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = catalogFetch({ opencode: [{ id: 'beam-free', owned_by: 'opencode' }], chat: vi.fn() });
    const runOpenCode = vi
      .fn()
      .mockResolvedValueOnce({
        error: 'model rate limited',
        errorType: 'model.rate_limit',
        status: 429,
        retryAfter: '2',
        modelAttributable: true,
      })
      .mockResolvedValueOnce({ content: 'recovered', finishReason: 'stop', model: 'beam-free' });

    try {
      const result = await completeWithFreeModel('prompt', {
        fetchImpl,
        opencodeCommand: '/fake-opencode',
        runOpenCode,
        waitForRetryAfter,
        quarantineFile,
        poolStateFile,
      });

      expect(result).toMatchObject({ source: 'opencode', model: 'beam-free', content: 'recovered' });
      expect(runOpenCode).toHaveBeenCalledTimes(2);
      expect(waitForRetryAfter).toHaveBeenCalledWith(2000);
      expect(
        JSON.parse(await readFile(poolStateFile, 'utf8')).modelFailures['opencode:beam-free'].failures
      ).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on OpenCode content-policy rejection without falling back to Groq', async () => {
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      groq: [{ id: 'openai/gpt-oss-120b' }],
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        opencodeCommand: '/fake-opencode',
        runOpenCode: vi.fn().mockResolvedValue({
          error: 'blocked by provider moderation',
          errorType: 'content_policy_violation',
          contentPolicyRejected: true,
        }),
        groqApiKey: 'gk',
        groqFreePlan: true,
      })
    ).rejects.toThrow(/content policy rejected/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('fails closed and quarantines OpenCode non-zero cost before Groq fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-opencode-cost-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      opencode: [{ id: 'beam-free', owned_by: 'opencode' }],
      groq: [{ id: 'openai/gpt-oss-120b' }],
      chat,
    });

    try {
      await expect(
        completeWithFreeModel('prompt', {
          fetchImpl,
          opencodeCommand: '/fake-opencode',
          runOpenCode: vi.fn().mockResolvedValue({ error: 'reported cost', safetyStop: true }),
          groqApiKey: 'gk',
          groqFreePlan: true,
          quarantineFile,
        })
      ).rejects.toThrow(/refusing further requests/);
      expect(chat).not.toHaveBeenCalled();
      expect((await readQuarantineState(quarantineFile)).entries['opencode:beam-free']).toMatchObject({
        reason: 'non_zero_cost',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on Kilo content-policy rejection without trying OpenRouter', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const chat = vi.fn();
    const fetchImpl = catalogFetch({
      kilo: [kiloRow(model)],
      openrouter: [openRouterRow(model.slice(0, -5))],
      chat,
    });

    await expect(
      completeWithFreeModel('prompt', {
        fetchImpl,
        kiloCommand: '/fake-kilo',
        runKilo: vi.fn().mockResolvedValue({ error: 'provider content filter', contentPolicyRejected: true }),
      })
    ).rejects.toThrow(/content policy rejected/);
    expect(chat).not.toHaveBeenCalled();
  });

  it('fails closed on Kilo non-zero cost without trying a later provider', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-kilo-cost-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const chat = vi.fn();
    const fetchImpl = catalogFetch({ kilo: [kiloRow(model)], openrouter: [openRouterRow(model.slice(0, -5))], chat });

    try {
      await expect(
        completeWithFreeModel('prompt', {
          fetchImpl,
          kiloCommand: '/fake-kilo',
          runKilo: vi.fn().mockResolvedValue({ error: 'paid response', safetyStop: true }),
          quarantineFile,
        })
      ).rejects.toThrow(/refusing further requests/);
      expect(chat).not.toHaveBeenCalled();
      expect((await readQuarantineState(quarantineFile)).entries[`kilo:${model}`]).toMatchObject({
        reason: 'non_zero_cost',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1'), openRouterRow('o1')], chat });
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
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('o1'), openRouterRow('o2')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('uses short control-plane timeouts and a five-minute inference timeout', async () => {
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutDurations = [];
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((duration) => {
      timeoutDurations.push(duration);
      return originalTimeout(duration);
    });
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('o1')], chat });

    try {
      await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
      expect(timeoutDurations).toContain(CONTROL_PLANE_TIMEOUT_MS);
      expect(timeoutDurations).toContain(COMPLETION_TIMEOUT_MS);
      expect(COMPLETION_TIMEOUT_MS).toBe(300_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('rotates after a successful HTTP response with a truncated completion', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'r1:free',
          choices: [{ message: { content: 'partial text' }, finish_reason: 'length' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('r1'), openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
  });

  it('rotates after a successful HTTP response with no completion text', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'r1:free', choices: [{ message: { content: null }, finish_reason: 'length' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'o1:free', choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
      });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('r1'), openRouterRow('o1')], chat });
    const result = await completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
    expect(result.source).toBe('openrouter');
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['numeric zero', { cost: 0 }, true],
    ['string zero', { cost: '0' }, true],
    ['empty cost text', { cost: '' }, false],
    ['null cost', { cost: null }, true],
    ['boolean cost', { cost: false }, false],
    ['malformed nested cost', { cost_details: { upstream_inference_cost: '' } }, false],
    ['additional nested provider cost', { cost_details: { providerCost: '0.02' } }, false],
  ])('accepts only valid zero usage cost: %s', async (_label, usage, shouldAccept) => {
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'k1:free',
        usage,
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1')], chat });
    const completion = completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' });
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
          model: 'k1:free',
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
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1'), openRouterRow('o1')], chat });

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
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1'), openRouterRow('o1')], chat });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
      /provider reported non-zero or invalid usage cost; refusing further requests/
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('persists a quarantine when a provider reports a non-zero cost', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-cost-quarantine-'));
    const quarantineFile = join(directory, 'quarantine.json');
    const chat = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: 'k1:free',
        usage: { cost: 0.02 },
        choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      }),
    });
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1')], chat });

    try {
      await expect(
        completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test', quarantineFile })
      ).rejects.toThrow(/provider reported non-zero or invalid usage cost/);
      const state = JSON.parse(await readFile(quarantineFile, 'utf8'));
      expect(state.entries['openrouter:k1:free']).toMatchObject({
        source: 'openrouter',
        model: 'k1:free',
        reason: 'non_zero_cost',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('provider content policy handling', () => {
  it.each([
    ['content-filter error code', { error: { code: 'content_filter' } }],
    ['content policy message', { error: { message: 'This prompt violates our usage policy.' } }],
    [
      'OpenRouter prompt-injection guardrail',
      { error: { message: 'Request blocked: prompt injection patterns detected' } },
    ],
    ['prompt rejection message', { error: { message: 'Prompt was rejected by the model.' } }],
    ['filtered completion finish reason', { choices: [{ finish_reason: 'content_filter' }] }],
    ['filtered completion result', { choices: [{ content_filter_results: { violence: { filtered: true } } }] }],
    ['filtered prompt result', { prompt_filter_results: [{ content_filter_results: { hate: { filtered: true } } }] }],
  ])('detects an explicit content-policy signal: %s', (_label, payload) => {
    expect(isContentPolicyError(payload)).toBe(true);
  });

  it.each([
    ['organization model policy', { error: { message: 'Model not allowed by organization policy.' } }],
    [
      'moderation system unavailable',
      { error: { code: 'content_filter_error', message: 'Content filter unavailable.' } },
    ],
    ['ordinary rate limit', { error: { code: 429, message: 'Rate limited.' } }],
    ['generic bad request', { error: { message: 'Bad request.' } }],
    ['empty payload', null],
  ])('does not confuse a non-rejection with a content-policy block: %s', (_label, payload) => {
    expect(isContentPolicyError(payload)).toBe(false);
  });

  it('stops provider fallback after an explicit HTTP content-policy rejection', async () => {
    const chat = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 403, message: 'Request blocked by content filter.' } }),
    });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });

    await expect(completeWithFreeModel('blocked prompt', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
      /provider content policy rejected or filtered this request/
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('stops provider fallback when a successful response has finish_reason content_filter', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ model: 'k1', choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          model: 'o1:free',
          choices: [{ message: { content: 'should not be used' }, finish_reason: 'stop' }],
        }),
      });
    const fetchImpl = catalogFetch({ kilo: [kiloRow('k1')], openrouter: [openRouterRow('o1')], chat });

    await expect(completeWithFreeModel('filtered response', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
      /provider content policy rejected or filtered this request/
    );
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe('free model runner CLI', () => {
  it('prints help without making network requests', async () => {
    const fetchImpl = vi.fn();
    const stdout = { write: vi.fn() };

    const code = await main(['--help'], { fetchImpl, stdout });

    expect(code).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Usage: node scripts/free-model-pool.mjs'));
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('--help prints this usage'));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('writes a bounded completion for a catalog-verified free model when usage is omitted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'free-model-pool-'));
    const promptPath = join(directory, 'prompt.txt');
    const outputPath = join(directory, 'result.txt');
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchImpl = readableFetch((url) =>
      url.endsWith('/models')
        ? Promise.resolve({ ok: true, json: async () => [kiloRow('nvidia/nemotron-3-ultra-550b-a55b:free')] })
        : Promise.resolve({
            ok: true,
            json: async () => ({
              model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
              choices: [{ message: { content: 'concise result' }, finish_reason: 'stop' }],
            }),
          })
    );
    try {
      await writeFile(promptPath, 'summarize briefly', 'utf8');
      const code = await main(['--prompt-file', promptPath, '--output-file', outputPath], {
        fetchImpl,
        openRouterKey: '',
        kiloCommand: '/fake-kilo',
        runKilo: vi.fn().mockResolvedValue({ content: 'concise result', finishReason: 'stop' }),
        initializeLegacyQuarantine: false,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toBe(
        '[kilo/nvidia/nemotron-3-ultra-550b-a55b:free]\nFinish reason: stop\nUsage: null\n' +
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
    const fetchImpl = catalogFetch({ openrouter: [openRouterRow('k1')], chat });

    await expect(completeWithFreeModel('prompt', { fetchImpl, openRouterKey: 'test' })).rejects.toThrow(
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
