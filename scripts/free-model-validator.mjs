#!/usr/bin/env node

import { loadCatalogs, normalizeGroqKeys, probeOpenRouterQuota } from './free-model-pool.mjs';
import { DEFAULT_QUARANTINE_FILE } from './lib/free-model-quarantine.mjs';

const MAX_SUBAGENTS = 15;
const ALLOWED_PROVIDERS = new Set(['openrouter', 'kilo', 'groq', 'opencode']);

function configuredGroqKeys(groqApiKey, groqApiKeys) {
  return normalizeGroqKeys(groqApiKey, groqApiKeys)
    .filter((key) => typeof key === 'string')
    .map((key) => key.trim())
    .filter(Boolean);
}

export function isAllowedProvider(provider) {
  return typeof provider === 'string' && ALLOWED_PROVIDERS.has(provider.trim().toLowerCase());
}

function normalizeConfig(config, index) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Subagent config ${index + 1} must be an object`);
  }
  if (typeof config.model !== 'string' || config.model.trim() === '') {
    throw new Error(`Subagent config ${index + 1} requires a model`);
  }
  if (!isAllowedProvider(config.provider)) {
    throw new Error(`Subagent config ${index + 1} has an unsupported provider`);
  }
  return { model: config.model.trim(), provider: config.provider.trim().toLowerCase() };
}

export async function validateSubagentConfigs(
  configs,
  {
    maxSubagents = Array.isArray(configs) ? configs.length : 0,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqApiKeys = process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(',')
          .map((key) => key.trim())
          .filter(Boolean)
      : [],
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    fetchImpl = fetch,
    quarantineFile = DEFAULT_QUARANTINE_FILE,
  } = {}
) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error('configs must be a non-empty array');
  }
  if (!Number.isSafeInteger(maxSubagents) || maxSubagents < 1 || maxSubagents > MAX_SUBAGENTS) {
    throw new Error(`maxSubagents must be 1-${MAX_SUBAGENTS}`);
  }
  if (configs.length > maxSubagents) {
    throw new Error(`Subagent count (${configs.length}) exceeds maxSubagents (${maxSubagents})`);
  }

  const normalized = configs.map(normalizeConfig);
  const needsOpenRouter = normalized.some(({ provider }) => provider === 'openrouter');
  const openRouterTaskCount = normalized.filter(({ provider }) => provider === 'openrouter').length;
  const needsGroq = normalized.some(({ provider }) => provider === 'groq');
  const groqKeys = configuredGroqKeys(groqApiKey, groqApiKeys);
  const effectiveOpenRouterKey = needsOpenRouter && typeof openRouterKey === 'string' ? openRouterKey.trim() : '';
  const effectiveGroqKey = needsGroq ? (groqKeys[0] ?? '') : '';

  if (needsOpenRouter && !effectiveOpenRouterKey) {
    throw new Error('OpenRouter provider requires OPENROUTER_API_KEY');
  }
  if (needsGroq && groqFreePlan !== true) {
    throw new Error('Groq provider requires GROQ_FREE_PLAN=1');
  }
  if (needsGroq && groqKeys.length === 0) {
    throw new Error('Groq provider requires GROQ_API_KEY or GROQ_API_KEYS');
  }

  const unavailableSources = new Set();
  const catalog = await loadCatalogs({
    fetchImpl,
    openRouterKey: effectiveOpenRouterKey,
    groqApiKey: effectiveGroqKey,
    groqApiKeys: needsGroq && groqFreePlan === true ? [effectiveGroqKey] : [],
    includeOpenRouterCatalog: needsOpenRouter,
    includeGroq: needsGroq && groqFreePlan === true,
    quarantineFile,
    initializeLegacyQuarantine: false,
    onCatalogError: (source) => unavailableSources.add(source),
  });

  for (const { model, provider } of normalized) {
    if (catalog.some((candidate) => candidate.source === provider && candidate.model === model)) {
      continue;
    }
    if (unavailableSources.has(provider)) {
      throw new Error(`Live ${provider} catalog is unavailable; refusing to validate a free model`);
    }
    throw new Error(`Model "${model}" is not currently verified free for provider "${provider}"`);
  }

  if (needsOpenRouter) {
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey: effectiveOpenRouterKey });
    if (quota.reason !== 'ok' || !Number.isSafeInteger(quota.remaining)) {
      throw new Error(`OpenRouter quota is unavailable (${quota.reason}); refusing to launch subagents`);
    }
    if (quota.remaining < openRouterTaskCount) {
      throw new Error(
        `OpenRouter quota insufficient for ${openRouterTaskCount} OpenRouter subagents (${quota.remaining} remaining)`
      );
    }
  }

  return normalized.map((config) => ({ ...config, validated: true }));
}

export async function validateFreeModel({
  model,
  provider,
  maxSubagents = 1,
  openRouterKey,
  groqApiKey,
  groqApiKeys,
  groqFreePlan,
  fetchImpl,
  quarantineFile,
} = {}) {
  const [validated] = await validateSubagentConfigs([{ model, provider }], {
    maxSubagents,
    openRouterKey,
    groqApiKey,
    groqApiKeys,
    groqFreePlan,
    fetchImpl,
    quarantineFile,
  });
  return validated;
}

export async function validateSubagentConfig({
  model,
  provider,
  maxSubagents = 1,
  openRouterKey,
  groqApiKey,
  groqApiKeys,
  groqFreePlan,
  fetchImpl,
  quarantineFile,
} = {}) {
  return validateFreeModel({
    model,
    provider,
    maxSubagents,
    openRouterKey,
    groqApiKey,
    groqApiKeys,
    groqFreePlan,
    fetchImpl,
    quarantineFile,
  });
}

export async function getFreeModelOptions({
  openRouterKey = process.env.OPENROUTER_API_KEY,
  groqApiKey = process.env.GROQ_API_KEY,
  groqApiKeys = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',')
        .map((key) => key.trim())
        .filter(Boolean)
    : [],
  groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
  fetchImpl = fetch,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
} = {}) {
  const groqKeys = configuredGroqKeys(groqApiKey, groqApiKeys);
  const effectiveOpenRouterKey = typeof openRouterKey === 'string' ? openRouterKey.trim() : '';
  const catalog = await loadCatalogs({
    fetchImpl,
    openRouterKey: effectiveOpenRouterKey,
    groqApiKey: groqFreePlan === true ? (groqKeys[0] ?? '') : '',
    groqApiKeys: groqFreePlan === true ? groqKeys.slice(0, 1) : [],
    includeOpenRouterCatalog: true,
    includeGroq: groqFreePlan === true && groqKeys.length > 0,
    quarantineFile,
    initializeLegacyQuarantine: false,
  });
  return catalog
    .filter((candidate) => ALLOWED_PROVIDERS.has(candidate.source))
    .map(({ model, source: provider, name }) => ({ model, provider, name }));
}

export function getAllowedProviders() {
  return [...ALLOWED_PROVIDERS];
}

export { loadCatalogs, probeOpenRouterQuota };
