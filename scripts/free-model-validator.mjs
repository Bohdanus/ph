#!/usr/bin/env node
/**
 * free-model-validator.mjs — Programmatic enforcement of free model constraints.
 *
 * This module MUST be called before launching any subagent to prevent paid model fallback.
 * It validates:
 * 1. Model + provider pair exists in verified free catalog
 * 2. No ambiguous/unknown pricing
 * 3. OpenRouter quota available
 * 4. Provider credentials present
 *
 * Usage:
 *   import { validateFreeModel, validateSubagentConfig } from './scripts/free-model-validator.mjs';
 *   await validateFreeModel({ model: 'nvidia/nemotron-3-ultra-550b-a55b:free', provider: 'openrouter' });
 *   await validateSubagentConfig({ model, provider, maxSubagents: 5 });
 */

import { loadCatalogs } from './free-model-pool.mjs';
import { probeOpenRouterQuota } from './free-model-pool.mjs';

const KNOWN_PAID_PATTERNS = [
  /gpt-?/i,
  /claude/i,
  /o1/i,
  /o3/i,
  /opus/i,
  /sonnet/i,
  /haiku/i,
  /gemini-?pro/i,
  /llama-?3\.1-?405b/i,
  /mistral-?large/i,
  /cohere-?command/i,
  /command-?r/i,
  /jamba/i,
  /qwen-?max/i,
  /deepseek-?v3/i,
  /deepseek-?r1/i,
];

const VERIFIED_FREE_MODELS = new Set([
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'openai/gpt-oss-120b',
  'poolside/laguna-s-2.1:free',
]);

const ALLOWED_PROVIDERS = new Set(['openrouter', 'kilo', 'groq', 'opencode']);

export function isKnownPaidModel(model) {
  if (!model || typeof model !== 'string') return false;
  return KNOWN_PAID_PATTERNS.some((pattern) => pattern.test(model));
}

export function isVerifiedFreeModel(model) {
  return VERIFIED_FREE_MODELS.has(model);
}

export function isAllowedProvider(provider) {
  return provider && ALLOWED_PROVIDERS.has(provider.toLowerCase());
}

export async function validateFreeModel({
  model,
  provider,
  openRouterKey = process.env.OPENROUTER_API_KEY,
  groqKeys = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [],
  groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
  fetchImpl = fetch,
} = {}) {
  const errors = [];

  if (!model || typeof model !== 'string') {
    errors.push('Model is required');
  }

  if (!provider || typeof provider !== 'string') {
    errors.push('Provider is required');
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }

  const normalizedProvider = provider.toLowerCase();

  if (!isAllowedProvider(normalizedProvider)) {
    throw new Error(`Provider "${provider}" not in allowed free providers: ${[...ALLOWED_PROVIDERS].join(', ')}`);
  }

  if (isKnownPaidModel(model)) {
    throw new Error(`Model "${model}" matches known paid model pattern — reject`);
  }

  if (!isVerifiedFreeModel(model)) {
    const catalog = await loadCatalogs({
      fetchImpl,
      openRouterKey,
      groqApiKey: groqKeys[0],
      groqApiKeys: groqFreePlan ? groqKeys : [],
      includeOpenRouterCatalog: normalizedProvider === 'openrouter',
      includeGroq: normalizedProvider === 'groq' && groqFreePlan,
    });

    const found = catalog.find((c) => c.source === normalizedProvider && c.model === model);

    if (!found) {
      throw new Error(
        `Model "${model}" not found in verified free catalog for provider "${normalizedProvider}". ` +
          `Known free: ${[...VERIFIED_FREE_MODELS].join(', ')}`
      );
    }
  }

  if (normalizedProvider === 'openrouter') {
    if (!openRouterKey) {
      throw new Error('OpenRouter provider requires OPENROUTER_API_KEY');
    }
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
    if (quota.reason === 'ok' && quota.remaining <= 0) {
      throw new Error(`OpenRouter daily free quota exhausted (${quota.used}/${quota.limit})`);
    }
  }

  if (normalizedProvider === 'groq') {
    if (!groqFreePlan) {
      throw new Error('Groq provider requires GROQ_FREE_PLAN=1');
    }
    if (groqKeys.length === 0) {
      throw new Error('Groq provider requires GROQ_API_KEY or GROQ_API_KEYS');
    }
  }

  if (normalizedProvider === 'kilo') {
    // Kilo CLI availability checked at runtime
  }

  if (normalizedProvider === 'opencode') {
    // OpenCode CLI availability checked at runtime
  }

  return { model, provider: normalizedProvider, validated: true };
}

export async function validateSubagentConfig({
  model,
  provider,
  maxSubagents = 1,
  openRouterKey = process.env.OPENROUTER_API_KEY,
  groqKeys = process.env.GROQ_API_KEYS
    ? process.env.GROQ_API_KEYS.split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [],
  groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
  fetchImpl = fetch,
} = {}) {
  if (!Number.isSafeInteger(maxSubagents) || maxSubagents < 1 || maxSubagents > 20) {
    throw new Error('maxSubagents must be 1-20');
  }

  if (maxSubagents > 10) {
    console.warn(`Warning: Launching ${maxSubagents} subagents may exceed rate limits`);
  }

  const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
  if (quota.reason === 'ok' && maxSubagents > quota.remaining) {
    throw new Error(`OpenRouter quota insufficient for ${maxSubagents} subagents (${quota.remaining} remaining)`);
  }

  return validateFreeModel({ model, provider, openRouterKey, groqKeys, groqFreePlan, fetchImpl });
}

export async function getFreeModelOptions() {
  const catalog = await loadCatalogs({
    fetchImpl: fetch,
    openRouterKey: process.env.OPENROUTER_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    groqApiKeys: process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [],
    includeOpenRouterCatalog: true,
    includeGroq: process.env.GROQ_FREE_PLAN === '1',
  });

  return catalog
    .filter((c) => ALLOWED_PROVIDERS.has(c.source))
    .map((c) => ({ model: c.model, provider: c.source, name: c.name }));
}

export function getVerifiedFreeModels() {
  return [...VERIFIED_FREE_MODELS];
}

export function getAllowedProviders() {
  return [...ALLOWED_PROVIDERS];
}

export { loadCatalogs, probeOpenRouterQuota } from './free-model-pool.mjs';
