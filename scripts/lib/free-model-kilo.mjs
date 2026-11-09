import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { resolveCommandShim } from './windows-command-shim.mjs';

export const COMPLETION_TIMEOUT_MS = 300_000;
export const MAX_KILO_OUTPUT_BYTES = 1024 * 1024;
const MAX_KILO_STDERR_BYTES = 64 * 1024;

const PROJECT_ROOT = process.cwd();
const KILO_EXTENSION_ROOTS = [
  '.vscode/extensions',
  '.vscode-insiders/extensions',
  '.vscode-oss/extensions',
  '.cursor/extensions',
  '.windsurf/extensions',
];
const KILO_RUNTIME_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'KILO_DB',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
];

function kiloRuntimeEnvironment(environment) {
  return Object.fromEntries(
    KILO_RUNTIME_ENV_KEYS.flatMap((key) => (typeof environment[key] === 'string' ? [[key, environment[key]]] : []))
  );
}

async function isExecutable(path, platform, accessImpl) {
  try {
    await accessImpl(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveKiloCli({
  command = process.env.KILO_CLI,
  pathValue = process.env.PATH ?? '',
  home = homedir(),
  platform = process.platform,
  accessImpl = access,
  readdirImpl = readdir,
} = {}) {
  if (typeof command === 'string' && command.trim()) return command.trim();

  const executableNames = platform === 'win32' ? ['kilo.exe', 'kilo.cmd', 'kilo.bat'] : ['kilo'];
  const searchFlags = platform === 'win32' ? constants.F_OK : constants.X_OK;
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executable of executableNames) {
      const candidate = join(directory, executable);
      try {
        await accessImpl(candidate, searchFlags);
        return candidate;
      } catch {
        // Continue through PATH and then the supported editor extension roots.
      }
    }
  }

  for (const relativeRoot of KILO_EXTENSION_ROOTS) {
    const extensionRoot = join(home, relativeRoot);
    let entries;
    try {
      entries = await readdirImpl(extensionRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const extensions = entries
      .filter((entry) => entry.isDirectory() && /^kilocode\.kilo-code-/i.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
    for (const extension of extensions) {
      for (const executable of executableNames) {
        const candidate = join(extensionRoot, extension.name, 'bin', executable);
        if (await isExecutable(candidate, platform, accessImpl)) return candidate;
      }
    }
  }
  return null;
}

function reportedStatus(events, stderrText = '') {
  const visit = (value) => {
    if (!value || typeof value !== 'object') return null;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:status|statuscode|httpstatus|code)$/i.test(key)) {
        const status = Number(child);
        if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
      }
      const nested = visit(child);
      if (nested !== null) return nested;
    }
    return null;
  };
  for (const event of events) {
    if (event?.type === 'error') {
      const status = visit(event);
      if (status !== null) return status;
      const message = JSON.stringify(event);
      const match = message.match(/\b(?:HTTP\s*)?(401|402|429)\b/i);
      if (match) return Number(match[1]);
    }
  }
  const statusMatch = stderrText.match(/\b(?:HTTP(?:\s+status)?|status(?:\s+code)?)\s*[:=]?\s*(401|402|429)\b/i);
  return statusMatch ? Number(statusMatch[1]) : null;
}

function hasToolActivity(events) {
  return events.some(
    (event) =>
      (typeof event?.type === 'string' && /^(?:tool|function)(?:_|$)/i.test(event.type)) || event?.part?.type === 'tool'
  );
}

function isExactZeroCost(cost) {
  if (typeof cost === 'number') return Number.isFinite(cost) && cost === 0;
  return typeof cost === 'string' && /^0+(?:\.0+)?$/.test(cost.trim());
}

function parseEvents(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').trim())
    .filter((line) => line.startsWith('{'));
  if (lines.length === 0) return [];
  try {
    return lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error('Kilo CLI returned malformed JSONL output');
  }
}

function sanitizedProcessError(events, stderrText, code, signal) {
  const status = reportedStatus(events, stderrText);
  if (status === 401) return { error: 'Kilo authentication was rejected', exhaustSource: true, status };
  if (status === 402 || status === 429) {
    return { error: `Kilo provider quota or rate limit returned HTTP ${status}`, exhaustSource: true, status };
  }
  if (/\bfree model usage limit reached\b/i.test(stderrText)) {
    return { error: 'Kilo provider quota or rate limit was reached', exhaustSource: true };
  }
  const modelAttributable =
    status !== null &&
    events.some((event) => {
      if (event?.type !== 'error') return false;
      const error = event.error && typeof event.error === 'object' ? event.error : event;
      const identity = [error.code, error.type, event.code].filter((value) => typeof value === 'string').join(' ');
      return /(?:^|[._-])(?:model|upstream_model)(?:[._-]|$)/i.test(identity);
    });
  if (events.some((event) => event?.type === 'error')) {
    return {
      error: 'Kilo CLI reported a provider or completion error',
      exhaustSource: false,
      status,
      modelAttributable,
    };
  }
  return {
    error: `Kilo CLI exited ${code ?? signal ?? 'without a status'}`,
    exhaustSource: false,
    status,
    modelAttributable,
  };
}

function contentPolicyRejected(events) {
  return events.some((event) => {
    if (event?.type !== 'error') return false;
    const error = event.error && typeof event.error === 'object' ? event.error : event;
    const code = [error.code, error.type, event.code, event.type]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase()
      .replaceAll('-', '_');
    const message = String(error.message ?? event.message ?? (typeof event.error === 'string' ? event.error : ''));
    return (
      /content_filter|content_policy|moderation|safety_violation|prompt_injection/.test(code) ||
      /content|safety|moderation|prompt injection/i.test(message)
    );
  });
}

export async function runKiloCompletion({
  command,
  source = 'kilo',
  model,
  prompt,
  maxTokens = 1200,
  timeoutMs = COMPLETION_TIMEOUT_MS,
  projectRoot = PROJECT_ROOT,
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  if (source !== 'kilo') return { error: 'Unsupported Kilo CLI provider' };
  if (typeof command !== 'string' || !command.trim())
    return { error: 'Kilo CLI is not configured', exhaustSource: true };
  if (typeof model !== 'string' || !/^[A-Za-z0-9._/-]+(?::[A-Za-z0-9._-]+)?$/.test(model)) {
    return { error: 'Invalid model ID' };
  }
  if (typeof prompt !== 'string' || !prompt) return { error: 'Prompt is empty' };
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 65536) return { error: 'Invalid token limit' };
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return { error: 'Invalid completion timeout' };

  const message = `Answer the provided request directly, in plain text, using at most ${maxTokens} output tokens.\n\n${prompt}`;
  try {
    const args = ['run', '--pure', '--format', 'json', '--model', `kilo/${model}`, '--agent', 'free-completion'];
    if (model === 'nvidia/nemotron-3-ultra-550b-a55b:free') {
      args.push('--variant', 'high');
    }
    const commandShim = resolveCommandShim(command, args);

    const { events, stderrText, code, signal, timedOut, outputOverflow, malformed, inputError } = await new Promise(
      (resolve, reject) => {
        let child;
        try {
          child = spawnImpl(commandShim.command, commandShim.args, {
            cwd: projectRoot,
            env: kiloRuntimeEnvironment(env),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            ...commandShim.spawnOptions,
          });
        } catch {
          reject(Object.assign(new Error('Kilo CLI could not be started'), { code: 'KILO_SPAWN' }));
          return;
        }

        const chunks = [];
        let stderrTail = Buffer.alloc(0);
        let outputBytes = 0;
        let timedOut = false;
        let outputOverflow = false;
        let inputError = false;
        let settled = false;
        let killTimer;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          clearTimeout(killTimer);
        };
        child.stdout.on('data', (chunk) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > MAX_KILO_OUTPUT_BYTES) {
            if (!outputOverflow) {
              outputOverflow = true;
              child.kill('SIGTERM');
              killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
            }
            return;
          }
          chunks.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
          const combined = Buffer.concat([stderrTail, chunk]);
          stderrTail = Buffer.from(combined.subarray(Math.max(0, combined.length - MAX_KILO_STDERR_BYTES)));
        });
        child.stdin.on('error', () => {
          inputError = true;
        });
        child.once('error', () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(Object.assign(new Error('Kilo CLI could not be started'), { code: 'KILO_SPAWN' }));
        });
        child.once('close', (code, signal) => {
          if (settled) return;
          settled = true;
          cleanup();
          let events = [];
          if (!outputOverflow) {
            try {
              events = parseEvents(Buffer.concat(chunks).toString('utf8'));
            } catch {
              resolve({
                events: [],
                stderrText: stderrTail.toString('utf8'),
                code,
                signal,
                timedOut,
                outputOverflow,
                inputError,
                malformed: true,
              });
              return;
            }
          }
          resolve({
            events,
            stderrText: stderrTail.toString('utf8'),
            code,
            signal,
            timedOut,
            outputOverflow,
            inputError,
          });
        });
        child.stdin.end(message);
      }
    );

    if (timedOut) return { error: `Kilo completion exceeded ${timeoutMs} ms` };
    if (outputOverflow) return { error: `Kilo CLI output exceeded ${MAX_KILO_OUTPUT_BYTES} bytes` };
    if (inputError) return { error: 'Kilo CLI did not accept the complete prompt' };
    if (malformed) return { error: 'Kilo CLI returned malformed JSONL output', exhaustSource: true };
    if (hasToolActivity(events))
      return { error: 'Kilo attempted a tool call; the completion was rejected', exhaustSource: true };
    if (events.some((event) => event?.type === 'error')) {
      const failure = sanitizedProcessError(events, stderrText, code, signal);
      if (contentPolicyRejected(events)) failure.contentPolicyRejected = true;
      return failure;
    }
    if (code !== 0) return sanitizedProcessError(events, stderrText, code, signal);

    const terminal = events.filter((event) => event?.type === 'step_finish').at(-1);
    const content = events
      .filter((event) => event?.type === 'text')
      .map((event) => (typeof event?.part?.text === 'string' ? event.part.text : (event.text ?? '')))
      .join('');
    const costs = events
      .map((event) => (event?.part?.cost !== undefined ? event.part.cost : event?.cost))
      .filter((cost) => cost !== undefined);
    if (costs.some((cost) => !isExactZeroCost(cost))) {
      return { error: 'Kilo reported non-zero or invalid completion cost', exhaustSource: true, safetyStop: true };
    }
    if (terminal?.part?.reason !== 'stop' || !content.trim()) {
      return {
        error: 'Kilo did not return a complete non-empty response',
        ...(terminal?.part?.reason === 'length' ? { finishReason: 'length' } : {}),
      };
    }
    const tokens = terminal.part?.tokens;
    return {
      model,
      content,
      finishReason: 'stop',
      usage: tokens
        ? {
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            reasoning_tokens: tokens.reasoning,
            ...(costs.length ? { cost: costs.at(-1) } : {}),
          }
        : costs.length
          ? { cost: costs.at(-1) }
          : null,
    };
  } catch (error) {
    return {
      error: error?.code === 'KILO_SPAWN' ? 'Kilo CLI could not be started' : 'Kilo completion failed locally',
      exhaustSource: error?.code === 'KILO_SPAWN',
    };
  }
}
