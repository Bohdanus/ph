const DISABLED_MODEL_PATTERN = /nemotron/i;

export function isDisabledFreeModel(modelId, modelName = '') {
  return [modelId, modelName].some((value) => typeof value === 'string' && DISABLED_MODEL_PATTERN.test(value));
}
