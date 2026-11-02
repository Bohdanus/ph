#!/usr/bin/env node
/**
 * free-subagent-retry.mjs — Rate-limit aware retry wrapper for free subagent launches.
 *
 * Handles:
 * - OpenRouter 429 with exponential backoff and quota re-check
 * - Groq 429 with key rotation
 * - Kilo CLI transient failures
 * - Provider catalog refresh on failure
 *
 * Usage:
 *   import { withFreeRetry } from './scripts/free-subagent-retry.mjs';
 *   const result = await withFreeRetry(() => launchSubagent(config), { maxRetries: 3 });
 */

import { probeOpenRouterQuota } from './free-model-pool.mjs';
import { validateFreeModel } from './free-model-validator.mjs';

const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const JITTER_FACTOR = 0.3;

export class FreeModelRetryError extends Error {
  constructor(message, attempts, lastError) {
    super(message);
    this.name = 'FreeModelRetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export async function withFreeRetry(
  fn,
  {
    maxRetries = DEFAULT_MAX_RETRIES,
    baseBackoffMs = BASE_BACKOFF_MS,
    maxBackoffMs = MAX_BACKOFF_MS,
    jitterFactor = JITTER_FACTOR,
    onRetry = () => {},
    shouldRetry = defaultShouldRetry,
  } = {}
) {
  let lastError;
  const attempts = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempts.push({ attempt, error: error.message, timestamp: new Date().toISOString() });

      if (attempt === maxRetries) {
        break;
      }

      if (!shouldRetry(error)) {
        throw new FreeModelRetryError(
          `Non-retryable error after ${attempt + 1} attempt(s): ${error.message}`,
          attempts,
          error
        );
      }

      const backoff = Math.min(
        baseBackoffMs * Math.pow(2, attempt) + Math.random() * baseBackoffMs * jitterFactor,
        maxBackoffMs
      );

      await onRetry({ attempt: attempt + 1, error: error.message, backoffMs: backoff });

      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw new FreeModelRetryError(
    `All ${maxRetries + 1} attempts failed. Last error: ${lastError?.message}`,
    attempts,
    lastError
  );
}

export function defaultShouldRetry(error) {
  const message = error?.message?.toLowerCase() || '';
  const status = error?.status || error?.response?.status;

  if (status === 401 || status === 402 || status === 403) {
    return false;
  }

  if (status === 429) return true;

  const retryablePatterns = [
    'rate limit',
    'rate-limit',
    'quota exceeded',
    'quota_exceeded',
    'too many requests',
    'temporarily unavailable',
    'service unavailable',
    'timeout',
    'network error',
    'connection lost',
    'econnreset',
    'etimedout',
    'socket hang up',
    'eai_again',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

export async function withOpenRouterQuotaCheck(
  fn,
  { openRouterKey = process.env.OPENROUTER_API_KEY, fetchImpl = fetch, minQuotaRemaining = 1 } = {}
) {
  const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });

  if (quota.reason === 'ok' && quota.remaining < minQuotaRemaining) {
    throw new Error(`OpenRouter quota insufficient: ${quota.remaining} remaining, ${minQuotaRemaining} required`);
  }

  return fn();
}

export async function withGroqKeyRotation(
  fn,
  {
    groqKeys = process.env.GROQ_API_KEYS
      ? process.env.GROQ_API_KEYS.split(',')
          .map((k) => k.trim())
          .filter(Boolean)
      : [],
    groqApiKey = process.env.GROQ_API_KEY,
    maxKeyRetries = 3,
  } = {}
) {
  const allKeys = [...new Set([...(groqApiKey ? [groqApiKey] : []), ...groqKeys])];
  let lastError;

  for (let keyAttempt = 0; keyAttempt < Math.min(allKeys.length, maxKeyRetries); keyAttempt++) {
    const key = allKeys[keyAttempt];
    try {
      return await fn(key);
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.response?.status;
      if (status === 401 || status === 402 || status === 429) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`All ${allKeys.length} Groq keys exhausted. Last error: ${lastError?.message}`);
}

export async function withFreeModelValidation(
  fn,
  {
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
  } = {}
) {
  await validateFreeModel({ model, provider, openRouterKey, groqKeys, groqFreePlan, fetchImpl });
  return fn();
}

export async function withRetryAndValidation(
  fn,
  {
    maxRetries = DEFAULT_MAX_RETRIES,
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
  } = {}
) {
  return withFreeRetry(
    () => withFreeModelValidation(fn, { model, provider, openRouterKey, groqKeys, groqFreePlan, fetchImpl }),
    { maxRetries }
  );
}

export function createRetryableLauncher(launchFn, retryOptions = {}) {
  return async (config) => {
    return withFreeRetry(() => launchFn(config), retryOptions);
  };
}
