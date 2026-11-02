#!/usr/bin/env node

import { getFreeModelOptions, validateSubagentConfig, validateSubagentConfigs } from './free-model-validator.mjs';

const DEFAULT_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const DEFAULT_PROVIDER = 'kilo';
const DEFAULT_READ_ONLY_AGENT = 'read-only-research';
const MAX_SUBAGENTS = 15;

function assertAgentManager(agentManager) {
  if (typeof agentManager !== 'function') {
    throw new Error('agentManager function is required — pass the read-only agent_manager tool');
  }
}

function assertReadOnlyAgent(agent) {
  if (agent !== DEFAULT_READ_ONLY_AGENT) {
    throw new Error(`Free subagents must use the "${DEFAULT_READ_ONLY_AGENT}" agent profile`);
  }
}

function assertPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('Subagent prompt must be a non-empty string');
  }
}

function defaultVariant(model, provider) {
  return model === DEFAULT_FREE_MODEL && provider === DEFAULT_PROVIDER ? 'high' : undefined;
}

function validationOptions(options) {
  return {
    openRouterKey: options.openRouterKey,
    groqApiKey: options.groqApiKey,
    groqApiKeys: options.groqApiKeys,
    groqFreePlan: options.groqFreePlan,
    fetchImpl: options.fetchImpl,
    quarantineFile: options.quarantineFile,
  };
}

export async function launchFreeSubagent({
  prompt,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  maxSubagents = 1,
  variant,
  worktreePath,
  description = 'free-subagent-task',
  agentManager,
  ...options
} = {}) {
  assertPrompt(prompt);
  assertAgentManager(agentManager);

  const validated = await validateSubagentConfig({ model, provider, maxSubagents, ...validationOptions(options) });
  const task = {
    prompt,
    model: validated.model,
    provider: validated.provider,
    agent: DEFAULT_READ_ONLY_AGENT,
    description,
  };
  if (variant ?? defaultVariant(validated.model, validated.provider)) {
    task.variant = variant ?? defaultVariant(validated.model, validated.provider);
  }
  if (worktreePath !== undefined) task.worktreePath = worktreePath;

  return agentManager({ mode: 'worktree', versions: false, tasks: [task] });
}

function normalizeTask(task, index, defaults) {
  if (typeof task === 'string') task = { prompt: task };
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error(`Task ${index + 1} must be a prompt string or object`);
  }
  assertPrompt(task.prompt);
  const agent = task.agent ?? defaults.agent;
  assertReadOnlyAgent(agent);
  const model = task.model ?? defaults.model;
  const provider = task.provider ?? defaults.provider;
  const normalizedModel = typeof model === 'string' ? model.trim() : model;
  const normalizedProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : provider;
  const variant = task.variant ?? defaults.variant ?? defaultVariant(normalizedModel, normalizedProvider);
  const normalized = {
    prompt: task.prompt,
    model: normalizedModel,
    provider: normalizedProvider,
    agent,
    description: task.description ?? `free-research-${index + 1}`,
  };
  if (variant !== undefined) normalized.variant = variant;
  const worktreePath = task.worktreePath ?? defaults.worktreePath;
  if (worktreePath !== undefined) normalized.worktreePath = worktreePath;
  return normalized;
}

export async function launchFreeSubagents({
  tasks,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  maxSubagents,
  variant,
  worktreePath,
  agent = DEFAULT_READ_ONLY_AGENT,
  agentManager,
  ...options
} = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('tasks must be a non-empty array');
  }
  assertAgentManager(agentManager);
  assertReadOnlyAgent(agent);

  const effectiveMaxSubagents = maxSubagents ?? tasks.length;
  if (
    !Number.isSafeInteger(effectiveMaxSubagents) ||
    effectiveMaxSubagents < 1 ||
    effectiveMaxSubagents > MAX_SUBAGENTS
  ) {
    throw new Error(`maxSubagents must be 1-${MAX_SUBAGENTS}`);
  }
  if (tasks.length > effectiveMaxSubagents) {
    throw new Error(`Task count (${tasks.length}) exceeds maxSubagents (${effectiveMaxSubagents})`);
  }

  const defaults = { model, provider, variant, worktreePath, agent };
  const taskObjects = tasks.map((task, index) => normalizeTask(task, index, defaults));
  await validateSubagentConfigs(
    taskObjects.map(({ model: taskModel, provider: taskProvider }) => ({ model: taskModel, provider: taskProvider })),
    { maxSubagents: effectiveMaxSubagents, ...validationOptions(options) }
  );
  return agentManager({ mode: 'worktree', versions: false, tasks: taskObjects });
}

export async function launchFreeResearchSubagents({
  prompts,
  maxSubagents,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  variant,
  worktreePath,
  agentManager,
  openRouterKey,
  groqApiKey,
  groqApiKeys,
  groqFreePlan,
  fetchImpl,
  quarantineFile,
} = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts must be a non-empty array');
  }
  return launchFreeSubagents({
    tasks: prompts.map((prompt, index) => ({
      prompt,
      description: `free-research-${index + 1}`,
      worktreePath,
    })),
    maxSubagents: maxSubagents ?? Math.min(prompts.length, 10),
    model,
    provider,
    variant,
    agent: DEFAULT_READ_ONLY_AGENT,
    agentManager,
    openRouterKey,
    groqApiKey,
    groqApiKeys,
    groqFreePlan,
    fetchImpl,
    quarantineFile,
  });
}

export async function launchFreeReviewSubagents({
  prompts,
  maxSubagents,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  variant,
  worktreePath,
  agentManager,
  openRouterKey,
  groqApiKey,
  groqApiKeys,
  groqFreePlan,
  fetchImpl,
  quarantineFile,
} = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts must be a non-empty array');
  }
  return launchFreeSubagents({
    tasks: prompts.map((prompt, index) => ({
      prompt,
      description: `free-review-${index + 1}`,
      worktreePath,
    })),
    maxSubagents: maxSubagents ?? Math.min(prompts.length, 5),
    model,
    provider,
    variant,
    agent: DEFAULT_READ_ONLY_AGENT,
    agentManager,
    openRouterKey,
    groqApiKey,
    groqApiKeys,
    groqFreePlan,
    fetchImpl,
    quarantineFile,
  });
}

export function getDefaultFreeModel() {
  return { model: DEFAULT_FREE_MODEL, provider: DEFAULT_PROVIDER, variant: 'high' };
}

export { getFreeModelOptions, validateSubagentConfig };
