import { describe, expect, it, vi } from 'vitest';
import {
  getFreeModelOptions,
  validateFreeModel,
  validateSubagentConfig,
  validateSubagentConfigs,
} from '../free-model-validator.mjs';

const NEMOTRON = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const XING = 'xingchen-agi/xing4.0-29b-a4b:free';
const QUARANTINE_FILE = `/tmp/free-model-validator-${process.pid}.json`;
const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });
const openRouterRow = (id) => ({ id, pricing: { prompt: '0', completion: '0' } });

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status });
}

function catalogFetch({
  kilo = [kiloRow(XING)],
  openrouter = [openRouterRow(XING)],
  groq = [{ id: 'openai/gpt-oss-120b' }],
  groqStatusByKey = {},
  quota = { data: { free_model_daily_requests: { used: 1, limit: 10, remaining: 9 } } },
} = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, options });
    if (requestUrl === 'https://api.kilo.ai/api/gateway/models') return jsonResponse(kilo);
    if (requestUrl === 'https://openrouter.ai/api/v1/models') return jsonResponse({ data: openrouter });
    if (requestUrl === 'https://openrouter.ai/api/v1/key') return jsonResponse(quota);
    if (requestUrl === 'https://api.groq.com/openai/v1/models') {
      const key = options.headers?.Authorization?.replace(/^Bearer\s+/, '') ?? '';
      const status = groqStatusByKey[key] ?? 200;
      return jsonResponse({ data: groq }, status);
    }
    if (requestUrl === 'https://opencode.ai/inference/v1/models') return jsonResponse({ data: [] });
    throw new Error(`Unexpected catalog request: ${requestUrl}`);
  });
  return { fetchImpl, calls };
}

const validationOptions = (fetchImpl, extra = {}) => ({
  fetchImpl,
  quarantineFile: QUARANTINE_FILE,
  openRouterKey: '',
  groqApiKey: '',
  groqApiKeys: [],
  groqFreePlan: false,
  ...extra,
});

describe('free model validation', () => {
  it('requires both an exact model ID and its provider in the live free catalog', async () => {
    const { fetchImpl } = catalogFetch();
    await expect(
      validateFreeModel({
        model: XING,
        provider: 'KILO',
        ...validationOptions(fetchImpl),
      })
    ).resolves.toEqual({ model: XING, provider: 'kilo', validated: true });

    await expect(
      validateFreeModel({
        model: 'gpt-4o',
        provider: 'kilo',
        ...validationOptions(fetchImpl),
      })
    ).rejects.toThrow('not currently verified free');
  });

  it('allows the exact free route on Kilo and OpenRouter while blocking aliases and unapproved providers', async () => {
    const kilo = catalogFetch({ kilo: [kiloRow(NEMOTRON)] });
    await expect(
      validateFreeModel({ model: NEMOTRON, provider: 'kilo', ...validationOptions(kilo.fetchImpl) })
    ).resolves.toEqual({ model: NEMOTRON, provider: 'kilo', validated: true });

    const openrouter = catalogFetch({ openrouter: [openRouterRow(NEMOTRON)] });
    await expect(
      validateFreeModel({
        model: NEMOTRON,
        provider: 'openrouter',
        ...validationOptions(openrouter.fetchImpl, { openRouterKey: 'test-key' }),
      })
    ).resolves.toEqual({ model: NEMOTRON, provider: 'openrouter', validated: true });

    for (const model of ['nvidia/nemotron-3-ultra-550b-a55b-v2:free', 'vendor/renamed-free Nemotron alias']) {
      for (const provider of ['kilo', 'openrouter', 'opencode', 'groq']) {
        const { fetchImpl } = catalogFetch();
        await expect(
          validateFreeModel({
            model,
            provider,
            ...validationOptions(fetchImpl, {
              openRouterKey: 'test-key',
              groqApiKey: 'test-key',
              groqFreePlan: true,
            }),
          })
        ).rejects.toThrow('Nemotron model/provider pair is not approved by free-model policy');
        expect(fetchImpl).not.toHaveBeenCalled();
      }
    }

    for (const provider of ['opencode', 'groq']) {
      const { fetchImpl } = catalogFetch();
      await expect(validateFreeModel({ model: NEMOTRON, provider, ...validationOptions(fetchImpl) })).rejects.toThrow(
        'Nemotron model/provider pair is not approved by free-model policy'
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('does not trust stale hard-coded models or retired catalog entries', async () => {
    const retired = 'poolside/laguna-s-2.1:free';
    const { fetchImpl } = catalogFetch({ kilo: [kiloRow(retired)] });
    await expect(
      validateFreeModel({
        model: retired,
        provider: 'kilo',
        ...validationOptions(fetchImpl),
      })
    ).rejects.toThrow('not currently verified free');
  });

  it('fails closed when the selected provider catalog is unavailable', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url) === 'https://api.kilo.ai/api/gateway/models') throw new Error('offline');
      if (String(url) === 'https://opencode.ai/inference/v1/models') return jsonResponse({ data: [] });
      throw new Error(`Unexpected catalog request: ${String(url)}`);
    });
    await expect(
      validateFreeModel({
        model: XING,
        provider: 'kilo',
        ...validationOptions(fetchImpl),
      })
    ).rejects.toThrow('Live kilo catalog is unavailable');
  });

  it('checks OpenRouter credentials and quota only for OpenRouter tasks', async () => {
    const noKey = catalogFetch();
    await expect(
      validateSubagentConfig({
        model: XING,
        provider: 'openrouter',
        ...validationOptions(noKey.fetchImpl),
      })
    ).rejects.toThrow('requires OPENROUTER_API_KEY');
    expect(noKey.fetchImpl).not.toHaveBeenCalled();

    const blankKey = catalogFetch();
    await expect(
      validateSubagentConfig({
        model: XING,
        provider: 'openrouter',
        ...validationOptions(blankKey.fetchImpl, { openRouterKey: '   ' }),
      })
    ).rejects.toThrow('requires OPENROUTER_API_KEY');
    expect(blankKey.fetchImpl).not.toHaveBeenCalled();

    const exhausted = catalogFetch({
      quota: { data: { free_model_daily_requests: { used: 10, limit: 10, remaining: 0 } } },
    });
    await expect(
      validateSubagentConfig({
        model: XING,
        provider: 'openrouter',
        ...validationOptions(exhausted.fetchImpl, { openRouterKey: 'test-key' }),
      })
    ).rejects.toThrow('quota insufficient');
    expect(exhausted.calls.filter(({ url }) => url.endsWith('/key'))).toHaveLength(1);

    const kilo = catalogFetch();
    await expect(
      validateSubagentConfig({
        model: XING,
        provider: 'kilo',
        maxSubagents: 15,
        ...validationOptions(kilo.fetchImpl),
      })
    ).resolves.toMatchObject({ provider: 'kilo', validated: true });
    expect(kilo.calls.some(({ url }) => url.endsWith('/key'))).toBe(false);
  });

  it('fails closed when the OpenRouter quota counter cannot be verified', async () => {
    const { fetchImpl } = catalogFetch({ quota: { data: {} } });
    await expect(
      validateSubagentConfig({
        model: XING,
        provider: 'openrouter',
        ...validationOptions(fetchImpl, { openRouterKey: 'test-key' }),
      })
    ).rejects.toThrow('quota is unavailable');
  });

  it('requires Groq Free-plan opt-in and a selected API key for GPT-OSS', async () => {
    const withoutPlan = catalogFetch();
    await expect(
      validateFreeModel({
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        ...validationOptions(withoutPlan.fetchImpl, { groqApiKey: 'test-key' }),
      })
    ).rejects.toThrow('GROQ_FREE_PLAN=1');
    expect(withoutPlan.fetchImpl).not.toHaveBeenCalled();

    const invalidOptIn = catalogFetch();
    await expect(
      validateFreeModel({
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        ...validationOptions(invalidOptIn.fetchImpl, {
          groqApiKey: 'test-key',
          groqFreePlan: 'false',
        }),
      })
    ).rejects.toThrow('GROQ_FREE_PLAN=1');
    expect(invalidOptIn.fetchImpl).not.toHaveBeenCalled();

    const blankKey = catalogFetch();
    await expect(
      validateFreeModel({
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        ...validationOptions(blankKey.fetchImpl, { groqApiKey: '   ', groqFreePlan: true }),
      })
    ).rejects.toThrow('requires GROQ_API_KEY or GROQ_API_KEYS');
    expect(blankKey.fetchImpl).not.toHaveBeenCalled();

    const freePlan = catalogFetch();
    await expect(
      validateFreeModel({
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        ...validationOptions(freePlan.fetchImpl, { groqApiKey: 'test-key', groqFreePlan: true }),
      })
    ).resolves.toMatchObject({ model: 'openai/gpt-oss-120b', provider: 'groq', validated: true });
  });

  it('tries every explicitly configured Groq key when validating a model', async () => {
    const { fetchImpl, calls } = catalogFetch({ groqStatusByKey: { rejected: 401 } });
    await expect(
      validateFreeModel({
        model: 'openai/gpt-oss-120b',
        provider: 'groq',
        ...validationOptions(fetchImpl, {
          groqApiKeys: ['rejected', 'accepted'],
          groqFreePlan: true,
        }),
      })
    ).resolves.toMatchObject({ model: 'openai/gpt-oss-120b', provider: 'groq', validated: true });

    expect(
      calls
        .filter(({ url }) => url === 'https://api.groq.com/openai/v1/models')
        .map(({ options }) => options.headers.Authorization)
    ).toEqual(['Bearer rejected', 'Bearer accepted']);
  });

  it('validates every provider/model pair in one bounded batch', async () => {
    const secondary = 'recursive/flint-v1.0:free';
    const { fetchImpl, calls } = catalogFetch({
      kilo: [kiloRow(XING), kiloRow(secondary)],
      openrouter: [openRouterRow(secondary)],
      quota: { data: { free_model_daily_requests: { used: 1, limit: 10, remaining: 1 } } },
    });
    await expect(
      validateSubagentConfigs(
        [
          { model: XING, provider: 'kilo' },
          { model: secondary, provider: 'kilo' },
          { model: secondary, provider: 'openrouter' },
        ],
        {
          ...validationOptions(fetchImpl, { openRouterKey: 'test-key' }),
          maxSubagents: 3,
        }
      )
    ).resolves.toEqual([
      { model: XING, provider: 'kilo', validated: true },
      { model: secondary, provider: 'kilo', validated: true },
      { model: secondary, provider: 'openrouter', validated: true },
    ]);
    expect(calls.filter(({ url }) => url.endsWith('/models'))).toHaveLength(3);
    expect(calls.filter(({ url }) => url.endsWith('/key'))).toHaveLength(1);
  });

  it('caps fan-out at 15 before making network requests', async () => {
    const { fetchImpl } = catalogFetch();
    await expect(
      validateSubagentConfigs([{ model: XING, provider: 'kilo' }], {
        ...validationOptions(fetchImpl),
        maxSubagents: 16,
      })
    ).rejects.toThrow('maxSubagents must be 1-15');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lists Groq models only after explicit free-plan opt-in', async () => {
    const { fetchImpl } = catalogFetch();
    const options = await getFreeModelOptions(
      validationOptions(fetchImpl, { groqApiKey: 'test-key', groqFreePlan: '1' })
    );
    expect(options.some(({ provider }) => provider === 'groq')).toBe(false);

    const optedIn = catalogFetch();
    const freeOptions = await getFreeModelOptions(
      validationOptions(optedIn.fetchImpl, { groqApiKey: 'test-key', groqFreePlan: true })
    );
    expect(freeOptions).toContainEqual({
      model: 'openai/gpt-oss-120b',
      provider: 'groq',
      name: 'openai/gpt-oss-120b',
    });
  });

  it('tries every explicitly configured Groq key when listing model options', async () => {
    const { fetchImpl, calls } = catalogFetch({ groqStatusByKey: { rejected: 401 } });
    const options = await getFreeModelOptions(
      validationOptions(fetchImpl, {
        groqApiKeys: ['rejected', 'accepted'],
        groqFreePlan: true,
      })
    );

    expect(options).toContainEqual({
      model: 'openai/gpt-oss-120b',
      provider: 'groq',
      name: 'openai/gpt-oss-120b',
    });
    expect(
      calls
        .filter(({ url }) => url === 'https://api.groq.com/openai/v1/models')
        .map(({ options: requestOptions }) => requestOptions.headers.Authorization)
    ).toEqual(['Bearer rejected', 'Bearer accepted']);
  });
});
