import { describe, expect, it, vi } from 'vitest';
import { launchFreeResearchSubagents, launchFreeSubagent, launchFreeSubagents } from '../free-subagent-launcher.mjs';

const NEMOTRON = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const XING = 'xingchen-agi/xing4.0-29b-a4b:free';
const QUARANTINE_FILE = `/tmp/free-subagent-launcher-${process.pid}.json`;
const kiloRow = (id) => ({ id, isFree: true, pricing: { prompt: '0', completion: '0' } });

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload));
}

function kiloFetch(models = [XING]) {
  const calls = [];
  const fetchImpl = vi.fn(async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl === 'https://api.kilo.ai/api/gateway/models') {
      return jsonResponse(models.map(kiloRow));
    }
    if (requestUrl === 'https://opencode.ai/inference/v1/models') return jsonResponse({ data: [] });
    throw new Error(`Unexpected request: ${requestUrl}`);
  });
  return { fetchImpl, calls };
}

const options = (fetchImpl) => ({
  fetchImpl,
  quarantineFile: QUARANTINE_FILE,
  openRouterKey: '',
  groqApiKey: '',
  groqApiKeys: [],
  groqFreePlan: false,
});

describe('free subagent launcher', () => {
  it('requires an explicit model/provider pair instead of selecting a default model', async () => {
    const { fetchImpl } = kiloFetch();
    const agentManager = vi.fn();
    await expect(
      launchFreeSubagents({ tasks: ['Inspect the code'], agentManager, ...options(fetchImpl) })
    ).rejects.toThrow('explicit model and provider');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(agentManager).not.toHaveBeenCalled();
  });

  it('validates each task override before invoking the host tool', async () => {
    const { fetchImpl } = kiloFetch();
    const agentManager = vi.fn();
    await expect(
      launchFreeSubagents({
        tasks: [{ prompt: 'Inspect the code', model: 'gpt-4o', provider: 'kilo' }],
        agentManager,
        ...options(fetchImpl),
      })
    ).rejects.toThrow('not currently verified free');
    expect(agentManager).not.toHaveBeenCalled();
  });

  it('launches only fully validated tasks using the read-only profile', async () => {
    const { fetchImpl } = kiloFetch();
    const agentManager = vi.fn(async (request) => request);
    const result = await launchFreeSubagents({
      tasks: [
        { prompt: 'Inspect routing', model: ` ${XING} `, provider: ' KILO ' },
        { prompt: 'Inspect tests', model: XING, provider: 'kilo' },
      ],
      maxSubagents: 2,
      agentManager,
      ...options(fetchImpl),
    });

    expect(agentManager).toHaveBeenCalledOnce();
    expect(result.tasks).toMatchObject([
      { prompt: 'Inspect routing', model: XING, provider: 'kilo', agent: 'read-only-research' },
      { prompt: 'Inspect tests', model: XING, provider: 'kilo', agent: 'read-only-research' },
    ]);
  });

  it('rejects writable profiles and oversized batches before catalog requests', async () => {
    const { fetchImpl } = kiloFetch();
    const agentManager = vi.fn();

    await expect(
      launchFreeSubagents({
        tasks: ['Do research'],
        agent: 'code-reviewer',
        agentManager,
        ...options(fetchImpl),
      })
    ).rejects.toThrow('must use the "read-only-research"');

    await expect(
      launchFreeSubagents({
        tasks: ['Do research'],
        maxSubagents: 16,
        agentManager,
        ...options(fetchImpl),
      })
    ).rejects.toThrow('maxSubagents must be 1-15');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(agentManager).not.toHaveBeenCalled();
  });

  it('requires a valid prompt, manager, and catalog before launching a single task', async () => {
    const { fetchImpl } = kiloFetch();
    await expect(
      launchFreeSubagent({
        prompt: ' ',
        agentManager: vi.fn(),
        ...options(fetchImpl),
      })
    ).rejects.toThrow('Subagent prompt must be a non-empty string');

    const agentManager = vi.fn(async (request) => request);
    await expect(
      launchFreeSubagent({
        prompt: 'Research one bounded question',
        model: XING,
        provider: 'kilo',
        agentManager,
        ...options(fetchImpl),
      })
    ).resolves.toMatchObject({
      mode: 'worktree',
      versions: false,
      tasks: [{ model: XING, provider: 'kilo', agent: 'read-only-research' }],
    });
  });

  it('does not let extra options replace the research tasks', async () => {
    const { fetchImpl } = kiloFetch([XING]);
    const agentManager = vi.fn(async (request) => request);
    const result = await launchFreeResearchSubagents({
      prompts: ['Do bounded research'],
      model: XING,
      provider: 'kilo',
      tasks: [{ prompt: 'Override paid model', model: 'gpt-4o', provider: 'kilo' }],
      agentManager,
      ...options(fetchImpl),
    });
    expect(result.tasks).toMatchObject([
      { prompt: 'Do bounded research', model: XING, provider: 'kilo', agent: 'read-only-research' },
    ]);
    expect(agentManager).toHaveBeenCalledOnce();
  });

  it('rejects Nemotron from the live free catalog before launching a child', async () => {
    const { fetchImpl } = kiloFetch([NEMOTRON]);
    const agentManager = vi.fn();
    await expect(
      launchFreeSubagent({
        prompt: 'Inspect a failure',
        model: NEMOTRON,
        provider: 'kilo',
        agentManager,
        ...options(fetchImpl),
      })
    ).rejects.toThrow('Nemotron models are disabled by free-model policy');
    expect(agentManager).not.toHaveBeenCalled();
  });
});
