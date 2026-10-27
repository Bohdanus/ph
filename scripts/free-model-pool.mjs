#!/usr/bin/env node

import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeQuarantineKeys,
  DEFAULT_QUARANTINE_FILE,
  loadQuarantineState,
  quarantineKey,
  readQuarantineState,
} from './lib/free-model-quarantine.mjs';

const KILO_MODELS = 'https://api.kilo.ai/api/gateway/models';
const KILO_CHAT = 'https://api.kilo.ai/api/gateway/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY_INFO = 'https://openrouter.ai/api/v1/key';
const OPENCODE_MODELS = 'https://opencode.ai/inference/v1/models';
const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_SOURCE = 3;
const MAX_PROMPT_CHARS = 120_000;
const MAX_PROMPT_FILE_BYTES = 480 * 1024;
const MAX_OPENCODE_OUTPUT_BYTES = 1024 * 1024;
export const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPLETION_RESPONSE_BYTES = 1024 * 1024;
const PREFERRED_KILO_MODELS = ['poolside/laguna-s-2.1:free'];
const GROQ_FREE_MODEL = 'openai/gpt-oss-120b';
// These router IDs choose a concrete model only after the request may already be billed.
const UNPINNABLE_ROUTER_MODELS = new Set(['openrouter/free', 'openrouter/free:free']);

// Reject unknown override conditions instead of guessing whether a paid price applies.
const PRICING_OVERRIDE_CONDITIONS = new Set(['min_prompt_tokens', 'utc_days', 'utc_end', 'utc_start']);
const NON_PRICE_PRICING_FIELDS = new Set(['discount']);

async function discardResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // The response is being abandoned; cancellation failures do not change the decision.
  }
}

async function readBoundedJson(response, maxBytes, label) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('JSON response byte limit must be positive');
  const declaredLength = response.headers?.get?.('content-length');
  if (/^\d+$/.test(declaredLength ?? '') && Number(declaredLength) > maxBytes) {
    await discardResponseBody(response);
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
  }
  if (typeof response.body?.getReader !== 'function') throw new Error(`${label} has no readable response body`);

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value)) throw new Error(`${label} stream must contain byte chunks`);
      const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (chunk.byteLength > maxBytes - byteLength) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export function zeroPriced(pricing) {
  if (!isExactZero(pricing?.prompt) || !isExactZero(pricing?.completion)) return false;
  if (
    Object.entries(pricing).some(
      ([field, value]) => field !== 'overrides' && !NON_PRICE_PRICING_FIELDS.has(field) && !isExactZero(value)
    )
  ) {
    return false;
  }
  if (pricing.overrides === undefined) return true;
  if (!Array.isArray(pricing.overrides)) return false;
  return pricing.overrides.every(
    (override) =>
      override &&
      typeof override === 'object' &&
      !Array.isArray(override) &&
      Object.entries(override).every(
        ([field, value]) =>
          PRICING_OVERRIDE_CONDITIONS.has(field) || NON_PRICE_PRICING_FIELDS.has(field) || isExactZero(value)
      )
  );
}

function isExactZero(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value === 0;
  // Decimal strings are accepted only when every digit is zero, without float rounding.
  return typeof value === 'string' && /^0+(?:\.0+)?$/.test(value);
}

export function catalogCandidates(source, data, quarantinedKeys = new Set()) {
  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const candidates = rows
    .filter((row) => {
      if (typeof row?.id !== 'string' || row.id.length === 0) return false;
      if (quarantinedKeys.has(quarantineKey(source, row.id))) return false;
      if (UNPINNABLE_ROUTER_MODELS.has(row.id)) return false;
      // OpenCode's public inference catalog has no price fields. Its documented
      // free-model IDs carry the -free suffix; paid IDs are deliberately excluded.
      if (source === 'opencode') return row.owned_by === 'opencode' && row.id.endsWith('-free');
      // Groq's model catalog does not expose pricing. Routing is additionally
      // gated by an explicit free-plan opt-in before this catalog is requested.
      if (source === 'groq') return row.id === GROQ_FREE_MODEL;
      if (!zeroPriced(row.pricing)) return false;
      if (source === 'openrouter') return row.id.endsWith(':free');
      return source === 'kilo' && (row.isFree === true || row.id.endsWith(':free'));
    })
    .map((row) => ({ source, model: row.id, name: row.name ?? row.id }));
  if (source !== 'kilo') return candidates;
  const preference = new Map(PREFERRED_KILO_MODELS.map((model, index) => [model, index]));
  return candidates.sort(
    (left, right) =>
      (preference.get(left.model) ?? Number.MAX_SAFE_INTEGER) - (preference.get(right.model) ?? Number.MAX_SAFE_INTEGER)
  );
}

export async function loadCatalogs({
  fetchImpl = fetch,
  openRouterKey = process.env.OPENROUTER_API_KEY,
  groqApiKey = process.env.GROQ_API_KEY,
  includeOpenRouterCatalog = false,
  includeGroq = false,
  quarantineFile = DEFAULT_QUARANTINE_FILE,
  initializeLegacyQuarantine = false,
  onCatalogError = () => {},
} = {}) {
  const quarantineState = initializeLegacyQuarantine
    ? await loadQuarantineState(quarantineFile)
    : await readQuarantineState(quarantineFile);
  const quarantinedKeys = activeQuarantineKeys(quarantineState);
  const sources = [{ source: 'kilo', url: KILO_MODELS }];
  if (openRouterKey || includeOpenRouterCatalog) sources.push({ source: 'openrouter', url: OPENROUTER_MODELS });
  sources.push({ source: 'opencode', url: OPENCODE_MODELS });
  if (groqApiKey || includeGroq) sources.push({ source: 'groq', url: GROQ_MODELS });
  const results = await Promise.allSettled(
    sources.map(async ({ source, url }) => {
      const headers = {};
      if (source === 'openrouter' && openRouterKey) headers.Authorization = `Bearer ${openRouterKey}`;
      if (source === 'groq' && groqApiKey) headers.Authorization = `Bearer ${groqApiKey}`;
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(`${source} catalog returned HTTP ${response.status}`);
      }
      return catalogCandidates(
        source,
        await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, `${source} catalog`),
        quarantinedKeys
      );
    })
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    onCatalogError(sources[index].source, result.reason);
    return [];
  });
}

export async function probeOpenRouterQuota({ fetchImpl = fetch, openRouterKey, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!openRouterKey) return null;
  let response;
  try {
    response = await fetchImpl(OPENROUTER_KEY_INFO, {
      headers: { Authorization: `Bearer ${openRouterKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    await discardResponseBody(response);
    return null;
  }
  let payload;
  try {
    payload = await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, 'OpenRouter key info');
  } catch {
    return null;
  }
  const info = payload?.data?.free_model_daily_requests;
  if (
    !info ||
    !Number.isSafeInteger(info.remaining) ||
    info.remaining < 0 ||
    !Number.isSafeInteger(info.limit) ||
    info.limit < 1 ||
    !Number.isSafeInteger(info.used) ||
    info.used < 0
  ) {
    return null;
  }
  return { remaining: info.remaining, limit: info.limit, used: info.used };
}

function retryAfterHint(response) {
  return response?.headers
    ?.get?.('retry-after')
    ?.replace(/[\r\n]/g, ' ')
    .slice(0, 100);
}

function failureReason(response, payload) {
  const message = payload?.error?.message ?? payload?.message ?? '';
  const retryAfter = retryAfterHint(response);
  return `${response.status}${message ? `: ${message}` : ''}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`;
}

function hasReportedNonZeroCost(usage) {
  if (usage === undefined || usage === null) return false;
  if (typeof usage !== 'object' || Array.isArray(usage)) return true;

  const inspect = (value, key = '', insideCostField = false) => {
    const inCostField = insideCostField || /cost/i.test(key);
    if (value === undefined) return false;
    if (value === null) return inCostField;
    if (typeof value === 'number' || typeof value === 'string') {
      if (!inCostField) return false;
      if (typeof value === 'string' && value.trim() === '') return true;
      const amount = Number(value);
      return !Number.isFinite(amount) || amount !== 0;
    }
    if (typeof value === 'boolean') return inCostField;
    if (Array.isArray(value)) return inCostField || value.some((entry) => inspect(entry, '', false));
    if (typeof value !== 'object') return inCostField;
    return Object.entries(value).some(([childKey, child]) => inspect(child, childKey, inCostField));
  };

  return inspect(usage);
}

export async function readBoundedPrompt(path) {
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Prompt must be a regular file');
    if (metadata.size > MAX_PROMPT_FILE_BYTES)
      throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    const buffer = Buffer.alloc(MAX_PROMPT_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_PROMPT_FILE_BYTES) throw new Error(`Prompt file must be at most ${MAX_PROMPT_FILE_BYTES} bytes`);
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}

const OPENCODE_TOOL_DENY_CONFIG = JSON.stringify({
  // V1 keys remain accepted for users on the current CLI and cover all built-ins.
  tools: {
    read: false,
    edit: false,
    bash: false,
    task: false,
    glob: false,
    grep: false,
    write: false,
    patch: false,
    webfetch: false,
    websearch: false,
    question: false,
    skill: false,
    lsp: false,
  },
  permission: {
    read: 'deny',
    edit: 'deny',
    bash: 'deny',
    task: 'deny',
    glob: 'deny',
    grep: 'deny',
    write: 'deny',
    patch: 'deny',
    webfetch: 'deny',
    websearch: 'deny',
    question: 'deny',
    skill: 'deny',
    lsp: 'deny',
  },
  // V2 policies are hard denies and take precedence over saved approvals.
  policies: [{ action: 'tool.use', resource: '*', effect: 'deny' }],
});

export async function runOpenCodeCompletion({ command = 'opencode', model, prompt, maxTokens = 1200 }) {
  if (typeof model !== 'string' || !model.endsWith('-free')) {
    return { error: 'OpenCode model is not an eligible free catalog ID' };
  }
  const directory = await mkdtemp(join(tmpdir(), 'free-model-opencode-'));
  const promptPath = join(directory, 'request.txt');
  try {
    await writeFile(promptPath, prompt, { encoding: 'utf8', mode: 0o600 });
    const env = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: OPENCODE_TOOL_DENY_CONFIG,
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
      OPENCODE_DISABLE_PRUNE: '1',
    };
    const events = await new Promise((resolve, reject) => {
      const child = spawn(
        command,
        [
          '--standalone',
          'run',
          '--format',
          'json',
          '--model',
          `opencode/${model}`,
          '--file',
          promptPath,
          `Answer the attached request concisely (about ${maxTokens} tokens or fewer). Do not use tools.`,
        ],
        { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false }
      );
      const chunks = [];
      let outputBytes = 0;
      let killTimer;
      const stopChild = () => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      };
      const timer = setTimeout(stopChild, 90_000);
      child.stdout.on('data', (chunk) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_OPENCODE_OUTPUT_BYTES) stopChild();
        else chunks.push(chunk);
      });
      child.stderr.on('data', () => {});
      child.once('error', (error) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        if (outputBytes > MAX_OPENCODE_OUTPUT_BYTES) {
          reject(new Error(`OpenCode output exceeded ${MAX_OPENCODE_OUTPUT_BYTES} bytes`));
          return;
        }
        let parsed;
        try {
          parsed = Buffer.concat(chunks)
            .toString('utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
        } catch {
          reject(new Error('OpenCode returned malformed JSONL output'));
          return;
        }
        if (code !== 0) {
          const providerError = parsed.find((event) => event.type === 'error')?.error;
          const type =
            typeof providerError?.type === 'string' && /^[a-z0-9._-]+$/i.test(providerError.type)
              ? providerError.type
              : '';
          const status = Number(providerError?.status);
          const statusText = Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : '';
          reject(new Error(`OpenCode exited ${code ?? signal}${type ? `: ${type}${statusText}` : ''}`));
          return;
        }
        resolve(parsed);
      });
    });
    if (
      events.some(
        (event) =>
          event.type === 'error' ||
          event.type === 'tool_use' ||
          (event.type === 'done' && Array.isArray(event.rejected) && event.rejected.length > 0)
      )
    ) {
      return { error: 'OpenCode reported an error or attempted a tool call' };
    }
    const explicitTerminal = events.some(
      (event) => event.type === 'done' || (event.type === 'step_finish' && event.part?.reason === 'stop')
    );
    // OpenCode V2 can exit cleanly after final text without emitting its final step_finish event.
    const cleanFreeTextExit =
      model.endsWith('-free') && events.some((event) => event.type === 'text' && event.part?.text?.trim());
    const terminal = explicitTerminal || cleanFreeTextExit;
    const content = events
      .filter((event) => event.type === 'text' && typeof event.part?.text === 'string')
      .map((event) => event.part.text)
      .join('');
    const finishedSteps = events.filter((event) => event.type === 'step_finish');
    const reportedCosts = events
      .filter((event) => event.part?.cost !== undefined && event.part?.cost !== null)
      .map((event) => Number(event.part.cost));
    if (reportedCosts.some((cost) => !Number.isFinite(cost) || cost !== 0)) {
      return { error: 'OpenCode reported non-zero or invalid cost' };
    }
    if (!terminal || !content.trim()) return { error: 'OpenCode did not return a complete non-empty response' };
    const tokens = finishedSteps.at(-1)?.part?.tokens;
    return {
      model,
      content,
      finishReason: 'stop',
      usage: tokens
        ? {
            input_tokens: tokens.input,
            output_tokens: tokens.output,
            reasoning_tokens: tokens.reasoning,
            ...(reportedCosts.length > 0 ? { cost: reportedCosts.reduce((total, cost) => total + cost, 0) } : {}),
          }
        : null,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function completeWithFreeModel(
  prompt,
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    opencodeCommand = process.env.OPENCODE_CLI ?? 'opencode',
    runOpenCode = runOpenCodeCompletion,
    checkOpenRouterQuota = false,
    maxTokens = 1200,
    quarantineFile = DEFAULT_QUARANTINE_FILE,
    initializeLegacyQuarantine = true,
    onCatalogError = () => {},
    onOpenRouterQuota = () => {},
  } = {}
) {
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt must contain 1 to ${MAX_PROMPT_CHARS} characters`);
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4000) {
    throw new Error('maxTokens must be an integer from 1 to 4000');
  }
  const available = await loadCatalogs({
    fetchImpl,
    openRouterKey,
    groqApiKey: groqFreePlan ? groqApiKey : '',
    quarantineFile,
    initializeLegacyQuarantine,
    onCatalogError,
  });
  const exhausted = new Set();
  const attempts = new Map();
  const errors = [];
  const requestCounts = () => {
    const counts = {
      kilo: attempts.get('kilo') ?? 0,
      openrouter: attempts.get('openrouter') ?? 0,
    };
    for (const source of ['opencode', 'groq']) {
      if (attempts.has(source)) counts[source] = attempts.get(source);
    }
    return counts;
  };
  if (checkOpenRouterQuota && openRouterKey && available.some((entry) => entry.source === 'openrouter')) {
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
    if (quota) {
      onOpenRouterQuota(quota);
      if (quota.remaining <= 0) exhausted.add('openrouter');
    }
  }
  for (const candidate of available) {
    if (exhausted.has(candidate.source)) continue;
    const sourceAttempts = attempts.get(candidate.source) ?? 0;
    if (sourceAttempts >= MAX_ATTEMPTS_PER_SOURCE) continue;
    if (candidate.source === 'openrouter' && !openRouterKey) continue;
    if (candidate.source === 'groq' && (!groqApiKey || !groqFreePlan)) continue;
    if (candidate.source === 'opencode' && !opencodeCommand) continue;
    attempts.set(candidate.source, sourceAttempts + 1);
    if (candidate.source === 'opencode') {
      try {
        const result = await runOpenCode({ command: opencodeCommand, model: candidate.model, prompt, maxTokens });
        if (result?.content && result.finishReason === 'stop') {
          return {
            source: candidate.source,
            model: result.model ?? candidate.model,
            content: result.content,
            finishReason: result.finishReason,
            usage: result.usage ?? null,
            requestCounts: requestCounts(),
          };
        }
        errors.push(`opencode/${candidate.model}: ${result?.error ?? 'incomplete completion'}`);
      } catch (error) {
        errors.push(`opencode/${candidate.model}: ${error.message}`);
        if (error.code === 'ENOENT') exhausted.add(candidate.source);
      }
      continue;
    }
    const url = candidate.source === 'kilo' ? KILO_CHAT : candidate.source === 'groq' ? GROQ_CHAT : OPENROUTER_CHAT;
    const headers = { 'Content-Type': 'application/json' };
    if (candidate.source === 'openrouter') headers.Authorization = `Bearer ${openRouterKey}`;
    if (candidate.source === 'groq') headers.Authorization = `Bearer ${groqApiKey}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model: candidate.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          ...(candidate.source === 'groq' ? { reasoning_effort: 'low' } : {}),
        }),
      });
    } catch (error) {
      const retryAfter = retryAfterHint(response);
      errors.push(
        `${candidate.source}/${candidate.model}: ${error.message}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
      );
      continue;
    }
    let payload;
    try {
      payload = await readBoundedJson(response, MAX_COMPLETION_RESPONSE_BYTES, 'Model response');
    } catch (error) {
      const retryAfter = retryAfterHint(response);
      errors.push(
        `${candidate.source}/${candidate.model}: ${error.message}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`
      );
      if (response.status === 402 || response.status === 429) exhausted.add(candidate.source);
      continue;
    }
    if (hasReportedNonZeroCost(payload?.usage)) {
      throw new Error(
        `${candidate.source}/${candidate.model}: provider reported non-zero or invalid usage cost; refusing further requests. Requests attempted: ${JSON.stringify(requestCounts())}`
      );
    }
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (response.ok && typeof content === 'string' && content.trim() && finishReason === 'stop') {
      const resolvedModel = payload.model;
      const stillFree = available.some((entry) => entry.source === candidate.source && entry.model === resolvedModel);
      if (!stillFree) {
        errors.push(
          `${candidate.source}/${candidate.model}: response resolved to missing or unverified model ${resolvedModel ?? '(missing)'}`
        );
        continue;
      }
      return {
        source: candidate.source,
        model: resolvedModel,
        content,
        finishReason,
        usage: payload.usage ?? null,
        requestCounts: requestCounts(),
      };
    }
    if (response.ok && typeof content === 'string' && content.trim() && finishReason !== 'stop') {
      errors.push(
        `${candidate.source}/${candidate.model}: incomplete completion (finish_reason=${finishReason ?? 'missing'})`
      );
      continue;
    }
    const reason = response.ok
      ? `empty completion${finishReason ? ` (finish_reason=${finishReason})` : ''}`
      : failureReason(response, payload);
    errors.push(`${candidate.source}/${candidate.model}: ${reason}`);
    if (response.status === 402 || response.status === 429) exhausted.add(candidate.source);
  }
  throw new Error(
    `No free model completed the request. Requests attempted: ${JSON.stringify(requestCounts())}. ${errors.join(' | ') || 'No eligible free models were available.'}`
  );
}

function usage() {
  return (
    'Usage: node scripts/free-model-pool.mjs --list [--limit N]\n' +
    '       node scripts/free-model-pool.mjs --prompt-file PATH [--max-tokens N] [--output-file PATH] [--probe-openrouter-quota]\n' +
    '       node scripts/free-model-pool.mjs --openrouter-quota\n' +
    '       node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH [--max-tokens N]\n' +
    '--list fetches public model catalogs; configured=null means the OpenCode CLI was not probed.\n' +
    'configured=false means provider credentials/opt-in are missing, not that a model is invalid.\n' +
    'Groq routing requires GROQ_API_KEY and GROQ_FREE_PLAN=1 because its catalog does not expose free pricing.\n' +
    'OpenCode free models run through the opencode CLI with tool permissions denied.\n' +
    '--openrouter-quota reports the server-side daily free-model request count without sending an inference request.\n' +
    '--probe-openrouter-quota reports the daily counter before routing and skips OpenRouter when exhausted; --output-file keeps results out of stdout.'
  );
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    opencodeCommand = process.env.OPENCODE_CLI ?? 'opencode',
    runOpenCode = runOpenCodeCompletion,
    quarantineFile = DEFAULT_QUARANTINE_FILE,
    initializeLegacyQuarantine = true,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {}
) {
  const list = args.includes('--list');
  const promptAt = args.indexOf('--prompt-file');
  const outputFileAt = args.indexOf('--output-file');
  const limitAt = args.indexOf('--limit');
  const tokenAt = args.indexOf('--max-tokens');
  const checkOpenRouterQuota = args.includes('--probe-openrouter-quota');
  if (args.includes('--openrouter-quota')) {
    if (args.length !== 1) {
      stderr.write(`${usage()}\n`);
      return 2;
    }
    const quota = await probeOpenRouterQuota({ fetchImpl, openRouterKey });
    if (!quota) {
      stderr.write(
        'Unable to read OpenRouter daily quota; check the API key and network. No inference request was sent.\n'
      );
      return 2;
    }
    stdout.write(
      `${JSON.stringify({
        provider: 'openrouter',
        counter: 'free_model_daily_requests',
        checkedAt: new Date().toISOString(),
        ...quota,
      })}\n`
    );
    return 0;
  }
  const knownOptions = new Set([
    '--list',
    '--prompt-file',
    '--output-file',
    '--limit',
    '--max-tokens',
    '--probe-openrouter-quota',
  ]);
  const unknownOption = args.find((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknownOption) {
    stderr.write(`Unknown option: ${unknownOption}\n${usage()}\n`);
    return 2;
  }
  const hasValue = (index) => index < 0 || (args[index + 1] && !args[index + 1].startsWith('--'));
  if (
    (!list && promptAt < 0) ||
    (list && promptAt >= 0) ||
    (promptAt >= 0 && !hasValue(promptAt)) ||
    (outputFileAt >= 0 && !hasValue(outputFileAt)) ||
    (limitAt >= 0 && !hasValue(limitAt)) ||
    (tokenAt >= 0 && !hasValue(tokenAt))
  ) {
    stderr.write(`${usage()}\n`);
    return 2;
  }
  if (list) {
    const candidates = await loadCatalogs({
      fetchImpl,
      openRouterKey,
      groqApiKey,
      includeGroq: Boolean(groqApiKey),
      quarantineFile,
      includeOpenRouterCatalog: true,
      initializeLegacyQuarantine,
      onCatalogError: (source, error) => stderr.write(`${source} catalog unavailable: ${error.message}\n`),
    });
    const limit = limitAt >= 0 ? Math.max(1, Number(args[limitAt + 1]) || 1) : candidates.length;
    const configured = (source) => {
      if (source === 'kilo') return true;
      if (source === 'openrouter') return Boolean(openRouterKey);
      if (source === 'opencode') return null;
      return source === 'groq' && Boolean(groqApiKey) && groqFreePlan;
    };
    const listed = candidates.slice(0, limit).map((entry) => ({ ...entry, configured: configured(entry.source) }));
    stdout.write(`${JSON.stringify(listed, null, 2)}\n`);
    return 0;
  }
  let prompt;
  try {
    prompt = await readBoundedPrompt(args[promptAt + 1]);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 2;
  }
  const maxTokens = tokenAt >= 0 ? Number(args[tokenAt + 1]) : 1200;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4000) {
    stderr.write('--max-tokens must be an integer from 1 to 4000.\n');
    return 2;
  }
  const result = await completeWithFreeModel(prompt, {
    fetchImpl,
    openRouterKey,
    groqApiKey,
    groqFreePlan,
    opencodeCommand,
    runOpenCode,
    maxTokens,
    quarantineFile,
    initializeLegacyQuarantine,
    checkOpenRouterQuota,
    onCatalogError: (source, error) => stderr.write(`${source} catalog unavailable: ${error.message}\n`),
    onOpenRouterQuota: ({ used, limit, remaining }) =>
      stderr.write(
        `OpenRouter free requests: ${used}/${limit} used, ${remaining} remaining at ${new Date().toISOString()} (server snapshot).\n`
      ),
  });
  const output = [
    `[${result.source}/${result.model}]`,
    `Finish reason: ${result.finishReason}`,
    `Usage: ${JSON.stringify(result.usage)}`,
    `Requests attempted (this run): ${JSON.stringify(result.requestCounts)}`,
    '',
    result.content,
    '',
  ].join('\n');
  if (outputFileAt >= 0) {
    const outPath = args[outputFileAt + 1];
    await writeFile(outPath, output, 'utf8');
    stderr.write(`Result written to ${outPath}\n`);
  } else {
    stdout.write(output);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
