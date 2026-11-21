export const NEMOTRON_3_ULTRA_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const XINGCHEN_XING4_FREE_MODEL = 'xingchen-agi/xing4.0-29b-a4b:free';

export const DEFAULT_FREE_COMPLETION_MAX_TOKENS = 1200;
export const MAX_FREE_COMPLETION_MAX_TOKENS = 65536;
export const NEMOTRON_MIN_COMPLETION_MAX_TOKENS = 4096;
export const DEFAULT_FREE_COMPLETION_TIMEOUT_MS = 300_000;
export const NEMOTRON_COMPLETION_TIMEOUT_MS = 12 * 60 * 1000;
export const MAX_FREE_COMPLETION_TIMEOUT_MS = NEMOTRON_COMPLETION_TIMEOUT_MS;

const MODEL_STRENGTH_PRIORITY = new Map([
  [NEMOTRON_3_ULTRA_FREE_MODEL, 0],
  [XINGCHEN_XING4_FREE_MODEL, 1],
]);

const DISABLED_MODEL_PATTERN = /nemotron/i;

export function isDisabledFreeModel(modelId, modelName = '') {
  const isNemotron = [modelId, modelName].some(
    (value) => typeof value === 'string' && DISABLED_MODEL_PATTERN.test(value)
  );
  if (!isNemotron) return false;

  return modelId !== NEMOTRON_3_ULTRA_FREE_MODEL;
}

export function modelStrengthRank(modelId) {
  return MODEL_STRENGTH_PRIORITY.get(modelId) ?? MODEL_STRENGTH_PRIORITY.size;
}

export function freeModelProfile(modelId, requestedMaxTokens) {
  const isNemotron = modelId === NEMOTRON_3_ULTRA_FREE_MODEL;
  const defaultMaxTokens = isNemotron ? NEMOTRON_MIN_COMPLETION_MAX_TOKENS : DEFAULT_FREE_COMPLETION_MAX_TOKENS;
  const maxTokens = requestedMaxTokens ?? defaultMaxTokens;
  return {
    maxTokens: isNemotron ? Math.max(maxTokens, NEMOTRON_MIN_COMPLETION_MAX_TOKENS) : maxTokens,
    timeoutMs: isNemotron ? NEMOTRON_COMPLETION_TIMEOUT_MS : DEFAULT_FREE_COMPLETION_TIMEOUT_MS,
    reasoningEffort: isNemotron ? 'high' : null,
  };
}
