import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_KILO_OUTPUT_BYTES, resolveKiloCli, runKiloCompletion } from '../lib/free-model-kilo.mjs';

vi.setConfig({ testTimeout: 15_000 });

async function writeExecutable(filePath, source, { windowsShim = process.platform === 'win32' } = {}) {
  await mkdir(join(filePath, '..'), { recursive: true });
  if (windowsShim) {
    const scriptPath = `${filePath}.cjs`;
    const commandPath = `${filePath}.cmd`;
    await writeFile(scriptPath, `${source}\n`, 'utf8');
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return commandPath;
  }
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
      join(directory, 'home', '.vscode', 'extensions', 'kilocode.kilo-code-8.0.0-test', 'bin', 'kilo'),
      'process.exit(0);'
    );
    try {
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: join(directory, 'path'),
          home: join(directory, 'home'),
        })
      ).resolves.toBe(pathKilo);
      await expect(resolveKiloCli({ command: '', pathValue: '', home: join(directory, 'home') })).resolves.toBe(
        extensionKilo
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('authenticated Kilo CLI completion', () => {
  it('uses the logged-in provider, private stdin prompt, no-tools agent, and strict JSON completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const fs = require('node:fs');
const args = process.argv.slice(2);
const message = fs.readFileSync(0, 'utf8');
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes('--pure') || valueAfter('--format') !== 'json') process.exit(4);
if (valueAfter('--model') !== 'kilo/xingchen-agi/xing4.0-29b-a4b:free') process.exit(5);
if (valueAfter('--agent') !== 'free-completion') process.exit(6);
if (args.includes('--variant')) process.exit(7);
if (args.includes('--file')) process.exit(8);
if (!message.startsWith('Answer the provided request directly, in plain text, using at most 65536 output tokens.')) process.exit(9);
if (!message.includes('private prompt')) process.exit(10);
if (args.join(' ').includes('private prompt')) process.exit(11);
if (process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.KILO_CONFIG_CONTENT || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.PWD || process.env.UNRELATED_SECRET) process.exit(12);
if (process.env.HOME !== '/fixture/home' || process.env.XDG_DATA_HOME !== '/fixture/kilo-data' || process.env.KILO_DB !== '/fixture/kilo.db') process.exit(13);
console.log(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'safe response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0, tokens: { input: 10, output: 3, reasoning: 1 } } }));`
    );

    try {
      await expect(
        runKiloCompletion({
          command,
          model: 'xingchen-agi/xing4.0-29b-a4b:free',
          prompt: 'private prompt',
          maxTokens: 65536,
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
        model: 'xingchen-agi/xing4.0-29b-a4b:free',
        content: 'safe response',
        finishReason: 'stop',
        usage: { input_tokens: 10, output_tokens: 3, reasoning_tokens: 1, cost: 0 },
      });

      const agent = await readFile(join(process.cwd(), '.kilo', 'agent', 'free-completion.md'), 'utf8');
      expect(agent).toContain("  '*': deny");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it('refuses OpenRouter so it cannot use Kilo-managed credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), 'process.exit(12);');

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
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
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
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'text', part: { text: 'earlier response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'truncated tail' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'length', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo did not return a complete non-empty response',
        finishReason: 'length',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed JSONL stdout as a contained completion error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log(JSON.stringify({ type: 'text', part: { text: 'partial response' } }));
console.log('{"type":');
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI returned malformed JSONL output',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exhausts a Kilo source after an authentication or quota status and hides provider bodies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log('\u001b[0;91mError: Too Many Requests\u001b[0m');
console.log(JSON.stringify({ type: 'error', error: { status: 429, message: 'private provider details' } }));
process.exit(1);`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider quota or rate limit returned HTTP 429',
        exhaustSource: true,
        status: 429,
      });
      expect(JSON.stringify(result)).not.toContain('private provider details');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects quota errors written only to stderr without exposing the provider message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      "console.error('Free model usage limit reached (HTTP 429): private provider body'); process.exit(1);"
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider quota or rate limit returned HTTP 429',
        exhaustSource: true,
        status: 429,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a Kilo quota response when the child closes stdin', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({ type: 'error', error: { status: 429, message: 'private provider details' } })}\n`
          )
        );
        child.stdin.emit('error', Object.assign(new Error('prompt pipe closed'), { code: 'EPIPE' }));
        child.emit('close', 1, null);
      };
      return child;
    };

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      spawnImpl,
    });

    expect(result).toEqual({
      error: 'Kilo provider quota or rate limit returned HTTP 429',
      exhaustSource: true,
      status: 429,
    });
    expect(JSON.stringify(result)).not.toContain('private provider details');
  });

  it.each([
    ['error.code underscore', { type: 'error', error: { code: 'content_filter_blocked' } }],
    ['error.code hyphen', { type: 'error', error: { code: 'content-filter-blocked' } }],
    ['error.code dotted', { type: 'error', error: { code: 'content.filter.blocked' } }],
    ['error.code uppercase', { type: 'error', error: { code: 'CONTENT_FILTER_BLOCKED' } }],
    ['error.code padded', { type: 'error', error: { code: '  content_filter_blocked  ' } }],
    ['error.code versioned', { type: 'error', error: { code: 'content_filter_blocked_v2' } }],
    ['error.code versioned base', { type: 'error', error: { code: 'content_filter_v1' } }],
    ['error.code content policy', { type: 'error', error: { code: 'content_policy' } }],
    ['error.type', { type: 'error', error: { code: 'request_failed', type: 'content_filter_blocked' } }],
    [
      'error.type uppercase and hyphenated',
      { type: 'error', error: { code: 'request_failed', type: ' CONTENT-FILTER-BLOCKED ' } },
    ],
    [
      'error.type dotted and versioned',
      { type: 'error', error: { code: 'request_failed', type: 'content.policy.violation.v3' } },
    ],
    ['event.code', { type: 'error', code: 'content_filter_blocked', error: { code: 'request_failed' } }],
    [
      'event.code uppercase and hyphenated',
      { type: 'error', code: ' CONTENT-FILTER-BLOCKED ', error: { code: 'request_failed' } },
    ],
    [
      'event.code dotted and versioned',
      { type: 'error', code: 'content.filter.violation.v2', error: { code: 'request_failed' } },
    ],
  ])('stops fallback when Kilo reports an explicit policy code in %s', async (_source, sourceEvent) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = {
      ...sourceEvent,
      error: { ...sourceEvent.error, message: 'private provider body' },
    };
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify(${JSON.stringify(event)}));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops fallback for a policy message in a Kilo stdout error event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', message: 'Prompt was rejected by the content filter: private provider body' } }));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['message', "console.error('Prompt was rejected by the content filter: private provider body');"],
    [
      'structured JSONL error',
      "console.error(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked', message: 'private provider body' } }));",
    ],
    [
      'structured JSONL terminal',
      "console.error(JSON.stringify({ type: 'step_finish', part: { reason: 'content-filter' } }));",
    ],
  ])('stops fallback for an explicit content-policy rejection written only to stderr (%s)', async (_kind, output) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), `${output}\nprocess.exitCode = 1;`);

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('honors a stderr policy rejection alongside valid stdout JSONL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', message: 'provider request failed' } }));
console.error('Prompt was rejected by the content filter: private provider body');
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an explicit stdout policy rejection before a malformed JSONL line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked' } }));
console.log('{malformed json');
process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recognizes an explicit content-policy code delivered as an error string', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(`${JSON.stringify({ type: 'error', error: 'content_filter_blocked' })}\n`)
        );
        setImmediate(() => child.emit('close', 1, null));
      };
      child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
      return child;
    };

    await expect(
      runKiloCompletion({ command: '/unused/kilo', model: 'model:free', prompt: 'prompt', spawnImpl })
    ).resolves.toEqual({
      error: 'Kilo provider content policy rejected or filtered this request',
      contentPolicyRejected: true,
    });
  });

  it.each([
    ['a clean CLI exit', { inputError: false, hang: false }],
    ['a stdin error and timeout after the terminal event', { inputError: true, hang: true }],
    ['output overflow after the terminal event', { inputError: false, hang: false, overflow: true }],
    ['an underscore content-filter terminal', { inputError: false, hang: false, reason: 'content_filter' }],
  ])('fails closed for a Kilo content-filter terminal after %s', async (_scenario, options) => {
    const childPid = 4242;
    const terminateWindowsProcessTreeImpl = vi.fn().mockResolvedValue(undefined);
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.pid = childPid;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        const terminal = Buffer.from(
          `${JSON.stringify({ type: 'step_finish', part: { reason: options.reason ?? 'content-filter' } })}\n`
        );
        const overflow = options.overflow ? Buffer.alloc(MAX_KILO_OUTPUT_BYTES, 'x') : Buffer.alloc(0);
        child.stdout.emit('data', Buffer.concat([terminal, overflow]));
        if (options.inputError) child.stdin.emit('error', new Error('prompt pipe closed'));
        if (!options.hang && !options.overflow) setImmediate(() => child.emit('close', 0, null));
      };
      child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
      return child;
    };

    await expect(
      runKiloCompletion({
        command: '/unused/kilo',
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: options.hang ? 20 : 1000,
        platform: 'win32',
        terminateWindowsProcessTreeImpl,
        spawnImpl,
      })
    ).resolves.toEqual({
      error: 'Kilo provider content policy rejected or filtered this request',
      contentPolicyRejected: true,
    });
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledTimes(options.hang || options.overflow ? 1 : 0);
    if (options.hang || options.overflow) {
      expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(childPid);
    }
  });

  it('prioritizes a policy rejection over a tool-activity error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }));
console.log(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked', message: 'private provider body' } }));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not mistake generic content wording for a Kilo content-policy rejection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const messages = [
      'Could not serialize content field for provider request',
      'Prompt was rejected due to rate limit exceeded',
      'Flagged as potentially violating quota limits',
      'Free model usage limit reached (usage policy)',
      'Content filtering is enabled',
      'Safety filter configuration is unavailable',
    ];
    const events = [
      ...messages.map((message) => ({ type: 'error', error: { code: 'request_failed', message } })),
      { type: 'error', error: { code: 'safety_warning', message: 'Provider emitted an advisory warning' } },
      { type: 'error', error: { code: 'content_filtering', message: 'Filter configuration is unavailable' } },
    ];
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      [
        ...events.map((event) => `console.log(JSON.stringify(${JSON.stringify(event)}));`),
        "console.error('Could not read content metadata from the provider response');",
        'process.exitCode = 1;',
      ].join('\n')
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI reported a provider or completion error',
        exhaustSource: false,
        status: null,
        modelAttributable: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // These cases use real Node child processes; leave startup headroom for a contended Vitest worker.
  it.each([
    [
      'provider error event',
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed' }, cost: 0.001 }));\nprocess.exitCode = 1;`,
    ],
    [
      'malformed JSONL after a cost event',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));\nconsole.log('{malformed json');`,
    ],
    [
      'output overflow after a cost event',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));\nprocess.stdout.write('x'.repeat(2 * 1024 * 1024));`,
    ],
    [
      'conflicting top-level and part costs',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 }, cost: 0.001 }));`,
    ],
    [
      'cost nested in a provider error object',
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', cost: 0.001 } }));`,
    ],
    [
      'cost reported on stderr',
      `console.error(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));`,
    ],
    [
      'buffered invalid cost before timeout',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: false } }));\nsetInterval(() => {}, 1000);`,
      2000,
    ],
  ])(
    'rejects every reported invalid Kilo cost before process failure handling: %s',
    async (_scenario, source, timeoutMs = 5000) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
      const command = await writeExecutable(join(directory, 'fake-kilo'), source);

      try {
        await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs })).resolves.toEqual(
          {
            error: 'Kilo reported non-zero or invalid completion cost',
            exhaustSource: true,
            safetyStop: true,
            reportedCost: true,
          }
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('rejects a buffered invalid cost before returning a timeout error', async () => {
    const terminatedPids = [];
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(`${JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: false } })}\n`)
        );
      };
      return child;
    };

    await expect(
      runKiloCompletion({
        command: process.execPath,
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: 25,
        platform: 'win32',
        spawnImpl,
        terminateWindowsProcessTreeImpl: async (pid) => terminatedPids.push(pid),
      })
    ).resolves.toEqual({
      error: 'Kilo reported non-zero or invalid completion cost',
      exhaustSource: true,
      safetyStop: true,
      reportedCost: true,
    });
    expect(terminatedPids).toEqual([4242]);
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

  async function expectProcessTreeKilled(trigger) {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-process-tree-'));
    const pidFile = join(directory, 'descendant.pid');
    const sentinel = join(directory, 'descendant-survived');
    const descendantScript = `process.on('SIGTERM', () => {}); setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive'); process.exit(0); }, 5000);`;
    const output = trigger === 'output overflow' ? "process.stdout.write('x'.repeat(1024 * 1024 + 1));" : '';
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
${output}
setInterval(() => {}, 1000);`
    );
    try {
      await expect(
        runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs: 2000 })
      ).resolves.toEqual({
        error:
          trigger === 'timeout'
            ? 'Kilo completion exceeded 2000 ms'
            : `Kilo CLI output exceeded ${MAX_KILO_OUTPUT_BYTES} bytes`,
      });
      expect(Number(await readFile(pidFile, 'utf8'))).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('kills the Kilo process tree after a timeout', async () => {
    await expectProcessTreeKilled('timeout');
  }, 15_000);

  it('kills the Kilo process tree when output overflows', async () => {
    await expectProcessTreeKilled('output overflow');
  }, 15_000);
  it('reports Windows tree-termination failure when the child closes before termination finishes', async () => {
    let child;
    const terminateWindowsProcessTreeImpl = vi.fn(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            child.exitCode = null;
            child.signalCode = 'SIGTERM';
            child.emit('close', null, 'SIGTERM');
          }, 0);
          setTimeout(() => reject(new Error('taskkill failed')), 10);
        })
    );
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => setImmediate(() => child.stdout.emit('data', Buffer.alloc(MAX_KILO_OUTPUT_BYTES + 1)));
      child.kill = vi.fn();
      return child;
    };

    await expect(
      runKiloCompletion({
        command: '/unused/kilo',
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: 1000,
        platform: 'win32',
        terminateWindowsProcessTreeImpl,
        spawnImpl,
      })
    ).resolves.toEqual({ error: 'Kilo process-tree termination failed', exhaustSource: true, safetyStop: true });
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    [
      'reported cost',
      { type: 'step_finish', part: { reason: 'stop', cost: 0.01 } },
      { reportedCost: true, safetyStop: true },
    ],
    [
      'content-policy rejection',
      { type: 'error', error: { type: 'content_filter', message: 'Blocked by policy' } },
      { contentPolicyRejected: true },
    ],
  ])('preserves buffered Kilo %s when Windows tree termination times out', async (_label, event, expected) => {
    let child;
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
        child.stdout.emit('data', Buffer.alloc(2 * MAX_KILO_OUTPUT_BYTES));
      };
      child.kill = vi.fn();
      return child;
    };
    const terminateWindowsProcessTreeImpl = vi.fn(() => Promise.reject(new Error('taskkill failed')));

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      timeoutMs: 10_000,
      platform: 'win32',
      terminateWindowsProcessTreeImpl,
      spawnImpl,
    });

    expect(result).toMatchObject({ error: 'Kilo process-tree termination failed', ...expected });
    if (!expected.safetyStop) expect(result.safetyStop).toBeUndefined();
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.skipIf(process.platform !== 'win32')(
    'terminates descendants of a stalled Windows CLI shim',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-process-tree-'));
      const pidPath = join(directory, 'processes.json');
      const command = await writeExecutable(
        join(directory, 'fake-kilo'),
        `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore', windowsHide: true });
writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ parent: process.pid, descendant: child.pid }));
setInterval(() => {}, 1000);`
      );

      let processIds = [];
      try {
        await expect(
          runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs: 2_000 })
        ).resolves.toEqual({ error: 'Kilo completion exceeded 2000 ms' });
        const recordedPids = JSON.parse(await readFile(pidPath, 'utf8'));
        processIds = [Number(recordedPids.parent), Number(recordedPids.descendant)];
        expect(processIds.every((pid) => Number.isSafeInteger(pid) && pid > 0)).toBe(true);

        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const alive = processIds.filter((pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (error) {
              if (error.code === 'ESRCH') return false;
              throw error;
            }
          });
          if (alive.length === 0) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Kilo process-tree PIDs ${processIds.join(', ')} remained alive after timeout`);
      } finally {
        if (processIds.length === 0) {
          try {
            const recordedPids = JSON.parse(await readFile(pidPath, 'utf8'));
            processIds = [Number(recordedPids.descendant), Number(recordedPids.parent)];
          } catch {}
        }
        for (const pid of processIds) {
          if (Number.isSafeInteger(pid) && pid > 0)
            spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        }
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
    30_000
  );

  it('rejects invalid token and timeout values before starting the Kilo CLI', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    for (const maxTokens of [null, '4096', 1.5, 65_537]) {
      const spawnImpl = vi.fn();
      await expect(
        runKiloCompletion({ command: '/fake-kilo', model, prompt: 'prompt', maxTokens, spawnImpl })
      ).resolves.toEqual({ error: 'Invalid token limit' });
      expect(spawnImpl).not.toHaveBeenCalled();
    }

    for (const timeoutMs of [null, '1000', 0, 12 * 60 * 1000 + 1]) {
      const spawnImpl = vi.fn();
      await expect(
        runKiloCompletion({ command: '/fake-kilo', model, prompt: 'prompt', timeoutMs, spawnImpl })
      ).resolves.toEqual({ error: 'Invalid completion timeout' });
      expect(spawnImpl).not.toHaveBeenCalled();
    }
  });

  it('blocks noncanonical Nemotron variants before starting the Kilo CLI', async () => {
    const spawnImpl = vi.fn();
    await expect(
      runKiloCompletion({
        command: '/fake-kilo',
        model: 'nvidia/nemotron-3-ultra-550b-a55b-v2:free',
        prompt: 'private prompt',
        spawnImpl,
      })
    ).resolves.toEqual({ error: 'Nemotron model ID is not approved by free-model policy' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('uses the Nemotron reasoning variant and enforces its minimum output-token instruction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-nemotron-'));
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const fs = require('node:fs');
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const message = fs.readFileSync(0, 'utf8');
if (!args.includes('--pure') || valueAfter('--model') !== 'kilo/${model}') process.exit(4);
if (valueAfter('--agent') !== 'free-completion') process.exit(5);
if (valueAfter('--variant') !== 'high') process.exit(6);
if (!message.startsWith('Answer the provided request directly, in plain text, using at most 4096 output tokens.')) process.exit(7);
console.log(JSON.stringify({ type: 'text', part: { text: 'approved response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0, tokens: { input: 8, output: 2 } } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model, prompt: 'bounded request', maxTokens: 1200 })).resolves.toEqual({
        model,
        content: 'approved response',
        finishReason: 'stop',
        usage: { input_tokens: 8, output_tokens: 2, cost: 0 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
