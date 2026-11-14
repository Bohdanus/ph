export const NEMOTRON_3_ULTRA_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const DISABLED_MODEL_PATTERN = /nemotron/i;
const APPROVED_NEMOTRON_PROVIDERS = new Set(['kilo', 'openrouter']);

export function isDisabledFreeModel(modelId, modelName = '', provider = '') {
  const isNemotron = [modelId, modelName].some(
    (value) => typeof value === 'string' && DISABLED_MODEL_PATTERN.test(value)
  );
  if (!isNemotron) return false;

  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return modelId !== NEMOTRON_3_ULTRA_FREE_MODEL || !APPROVED_NEMOTRON_PROVIDERS.has(normalizedProvider);
}
