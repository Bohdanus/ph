import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveKiloCli, runKiloCompletion } from '../lib/free-model-kilo.mjs';

async function writeExecutable(filePath, source) {
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, `#!/usr/bin/env node\n${source}\n`, { encoding: 'utf8', mode: 0o700 });
  return filePath;
}

describe('Kilo CLI discovery', () => {
  it('uses an explicit KILO_CLI override before searching local installations', async () => {
    await expect(resolveKiloCli({ command: '/custom/bin/kilo', pathValue: '', home: '/missing' })).resolves.toBe(
      '/custom/bin/kilo'
    );
  });

  it('finds Kilo Code in PATH before editor extension directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-discovery-'));
    const pathKilo = await writeExecutable(join(directory, 'path', 'kilo'), 'process.exit(0);');
    const extensionKilo = await writeExecutable(
      join(directory, 'home', '.vscode', 'extensions', 'kilocode.kilo-code-8.0.0-darwin-arm64', 'bin', 'kilo'),
      'process.exit(0);'
    );
    try {
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: join(directory, 'path'),
          home: join(directory, 'home'),
          platform: 'darwin',
        })
      ).resolves.toBe(pathKilo);
      await expect(
        resolveKiloCli({ command: '', pathValue: '', home: join(directory, 'home'), platform: 'darwin' })
      ).resolves.toBe(extensionKilo);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('authenticated Kilo CLI completion', () => {
  it('uses the logged-in provider, private prompt file, no-tools agent, and strict JSON completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `const fs = require('node:fs');
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes('--pure') || valueAfter('--format') !== 'json') process.exit(4);
if (valueAfter('--model') !== 'kilo/poolside/laguna-s-2.1:free') process.exit(5);
if (valueAfter('--agent') !== 'free-completion') process.exit(6);
if (!args.includes('--variant') || valueAfter('--variant') !== 'thinking') process.exit(7);
if (!fs.readFileSync(valueAfter('--file'), 'utf8').includes('private prompt')) process.exit(8);
if (args.join(' ').includes('private prompt')) process.exit(9);
if (process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.KILO_CONFIG_CONTENT || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.PWD || process.env.UNRELATED_SECRET) process.exit(10);
if (process.env.HOME !== '/fixture/home' || process.env.XDG_DATA_HOME !== '/fixture/kilo-data' || process.env.KILO_DB !== '/fixture/kilo.db') process.exit(11);
console.log(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'safe response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0, tokens: { input: 10, output: 3, reasoning: 1 } } }));`
    );

    try {
      await expect(
        runKiloCompletion({
          command,
          model: 'poolside/laguna-s-2.1:free',
          prompt: 'private prompt',
          maxTokens: 40,
          env: {
            PATH: process.env.PATH,
            HOME: '/fixture/home',
            XDG_DATA_HOME: '/fixture/kilo-data',
            KILO_DB: '/fixture/kilo.db',
            OPENROUTER_API_KEY: 'test-openrouter-key',
            GROQ_API_KEY: 'test-groq-key',
            GROQ_API_KEYS: 'test-groq-key-list',
            KILO_CONFIG_CONTENT: '{"agent":{"free-completion":{"permission":{"bash":"allow"}}}}',
            NODE_OPTIONS: '--require /tmp/untrusted-preload.cjs',
            NODE_PATH: '/tmp/untrusted-modules',
            PWD: '/unexpected/worktree',
            UNRELATED_SECRET: 'do-not-forward',
          },
        })
      ).resolves.toEqual({
        model: 'poolside/laguna-s-2.1:free',
        content: 'safe response',
        finishReason: 'stop',
        usage: { input_tokens: 10, output_tokens: 3, reasoning_tokens: 1, cost: 0 },
      });

      const agent = await readFile(join(process.cwd(), '.kilo', 'agent', 'free-completion.md'), 'utf8');
      expect(agent).toContain("  '*': deny");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses OpenRouter so it cannot use Kilo-managed credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(command, 'process.exit(12);');

    try {
      await expect(
        runKiloCompletion({ command, source: 'openrouter', model: 'vendor/model:free', prompt: 'prompt' })
      ).resolves.toEqual({ error: 'Unsupported Kilo CLI provider' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects any attempted tool call even when the model later emits final text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log(JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'not accepted' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo attempted a tool call; the completion was rejected',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not accept an earlier stopped step when the last step was truncated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log(JSON.stringify({ type: 'text', part: { text: 'earlier response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'truncated tail' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'length', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo did not return a complete non-empty response',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exhausts a Kilo source after an authentication or quota status and hides provider bodies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log('\u001b[0;91mError: Too Many Requests\u001b[0m');
console.log(JSON.stringify({ type: 'error', error: { status: 429, message: 'private provider details' } }));
process.exit(1);`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({ error: 'Kilo provider quota or rate limit returned HTTP 429', exhaustSource: true });
      expect(JSON.stringify(result)).not.toContain('private provider details');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects quota errors written only to stderr without exposing the provider message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      "console.error('Free model usage limit reached (HTTP 429): private provider body'); process.exit(1);"
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({ error: 'Kilo provider quota or rate limit returned HTTP 429', exhaustSource: true });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a reported non-zero cost and stops that provider for the run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log(JSON.stringify({ type: 'text', part: { text: 'answer' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo reported non-zero or invalid completion cost',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('aborts a stalled request at its configured inference timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), 'setInterval(() => {}, 1000);');

    try {
      await expect(
        runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs: 20 })
      ).resolves.toEqual({ error: 'Kilo completion exceeded 20 ms' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
