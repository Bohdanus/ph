#!/usr/bin/env node
/**
 * free-subagent-launcher.mjs — Wrapper for launching subagents with enforced free model constraints.
 *
 * This module replaces direct `agent_manager` / `task` calls with validated free-only routing.
 *
 * Usage:
 *   import { launchFreeSubagent, launchFreeSubagents } from './scripts/free-subagent-launcher.mjs';
 *   await launchFreeSubagent({
 *     prompt: 'Research X',
 *     model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
 *     provider: 'openrouter',
 *   });
 */

import { validateFreeModel, validateSubagentConfig, getFreeModelOptions } from './free-model-validator.mjs';

const DEFAULT_FREE_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const DEFAULT_PROVIDER = 'openrouter';

export async function launchFreeSubagent({
  prompt,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  maxTokens = 1200,
  maxSubagents = 1,
  variant,
  worktreePath,
  agent = 'explore',
  description = 'free-subagent-task',
  agentManager,
} = {}) {
  await validateSubagentConfig({ model, provider, maxSubagents });

  if (!agentManager) {
    throw new Error('agentManager function is required — pass the agent_manager tool');
  }

  const task = {
    prompt,
    model,
    provider,
    variant,
    agent,
    description,
    worktreePath,
  };

  if (worktreePath) {
    task.worktreePath = worktreePath;
  }

  const result = await agentManager({
    mode: 'worktree',
    versions: false,
    tasks: [task],
  });

  return result;
}

export async function launchFreeSubagents({
  tasks,
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  maxSubagents = tasks.length,
  variant,
  agent = 'explore',
  agentManager,
} = {}) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('tasks array is required');
  }

  if (tasks.length > maxSubagents) {
    throw new Error(`Task count (${tasks.length}) exceeds maxSubagents (${maxSubagents})`);
  }

  await validateSubagentConfig({ model, provider, maxSubagents });

  const taskObjects = tasks.map((t, i) => ({
    prompt: typeof t === 'string' ? t : t.prompt,
    model: t.model ?? model,
    provider: t.provider ?? provider,
    variant: t.variant ?? variant,
    agent: t.agent ?? agent,
    description: t.description ?? `free-subagent-${i + 1}`,
    worktreePath: t.worktreePath,
  }));

  if (!agentManager) {
    throw new Error('agentManager function is required — pass the agent_manager tool');
  }

  const result = await agentManager({
    mode: 'worktree',
    versions: false,
    tasks: taskObjects,
  });

  return result;
}

export async function launchFreeResearchSubagents({
  prompts,
  maxSubagents = Math.min(prompts.length, 10),
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  variant,
  worktreePath,
  agentManager,
} = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts array is required');
  }

  return launchFreeSubagents({
    tasks: prompts.map((p, i) => ({
      prompt: p,
      description: `free-research-${i + 1}`,
      worktreePath,
      agent: 'read-only-research',
    })),
    maxSubagents,
    model,
    provider,
    variant,
    agentManager,
  });
}

export async function launchFreeReviewSubagents({
  prompts,
  maxSubagents = Math.min(prompts.length, 5),
  model = DEFAULT_FREE_MODEL,
  provider = DEFAULT_PROVIDER,
  variant = 'high',
  worktreePath,
  agentManager,
} = {}) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts array is required');
  }

  return launchFreeSubagents({
    tasks: prompts.map((p, i) => ({
      prompt: p,
      description: `free-review-${i + 1}`,
      worktreePath,
      agent: 'read-only-research',
    })),
    maxSubagents,
    model,
    provider,
    variant,
    agentManager,
  });
}

export function getDefaultFreeModel() {
  return { model: DEFAULT_FREE_MODEL, provider: DEFAULT_PROVIDER };
}

export { getFreeModelOptions, validateFreeModel } from './free-model-validator.mjs';
