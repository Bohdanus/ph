#!/usr/bin/env node

import { open, writeFile } from 'node:fs/promises';

const KILO_MODELS = 'https://api.kilo.ai/api/gateway/models';
const KILO_CHAT = 'https://api.kilo.ai/api/gateway/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_SOURCE = 3;
const MAX_PROMPT_CHARS = 120_000;
const MAX_PROMPT_FILE_BYTES = 480 * 1024;
export const MAX_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPLETION_RESPONSE_BYTES = 1024 * 1024;
const PREFERRED_KILO_MODELS = ['poolside/laguna-s-2.1:free'];
const QUARANTINED_MODELS = new Set([
  'kilo:kilo-auto/free',
  'kilo:nvidia/nemotron-3.5-super-vl:free',
  'kilo:recursive/flint-v1.0:free',
]);

const FREE_GROQ_MODEL_IDS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);

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
  return pricing?.prompt === '0' && pricing?.completion === '0';
}

export function catalogCandidates(source, data) {
  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  const candidates = rows
    .filter((row) => {
      if (!row?.id) return false;
      if (QUARANTINED_MODELS.has(`${source}:${row.id}`)) return false;
      if (source === 'groq') {
        return FREE_GROQ_MODEL_IDS.has(row.id);
      }
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
  groqKey = process.env.GROQ_API_KEY,
  groqFreePlanConfirmed = false,
  onCatalogError = () => {},
} = {}) {
  const sources = [{ source: 'kilo', url: KILO_MODELS }];
  if (openRouterKey) sources.push({ source: 'openrouter', url: OPENROUTER_MODELS });
  if (groqKey && groqFreePlanConfirmed) sources.push({ source: 'groq', url: GROQ_MODELS });
  const results = await Promise.allSettled(
    sources.map(async ({ source, url }) => {
      const headers = {};
      if (source === 'openrouter') headers.Authorization = `Bearer ${openRouterKey}`;
      if (source === 'groq') headers.Authorization = `Bearer ${groqKey}`;
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        await discardResponseBody(response);
        throw new Error(`${source} catalog returned HTTP ${response.status}`);
      }
      return catalogCandidates(
        source,
        await readBoundedJson(response, MAX_CATALOG_RESPONSE_BYTES, `${source} catalog`)
      );
    })
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    onCatalogError(sources[index].source, result.reason);
    return [];
  });
}

function failureReason(response, payload) {
  const message = payload?.error?.message ?? payload?.message ?? '';
  return `${response.status}${message ? `: ${message}` : ''}`;
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

export async function completeWithFreeModel(
  prompt,
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqKey = process.env.GROQ_API_KEY,
    groqFreePlanConfirmed = false,
    maxTokens = 1200,
    onCatalogError = () => {},
  } = {}
) {
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt must contain 1 to ${MAX_PROMPT_CHARS} characters`);
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 4000) {
    throw new Error('maxTokens must be an integer from 1 to 4000');
  }
  const available = await loadCatalogs({ fetchImpl, openRouterKey, groqKey, groqFreePlanConfirmed, onCatalogError });
  const exhausted = new Set();
  const attempts = new Map();
  const errors = [];
  for (const candidate of available) {
    if (exhausted.has(candidate.source)) continue;
    const sourceAttempts = attempts.get(candidate.source) ?? 0;
    if (sourceAttempts >= MAX_ATTEMPTS_PER_SOURCE) continue;
    if (candidate.source === 'openrouter' && !openRouterKey) continue;
    if (candidate.source === 'groq' && !groqKey) continue;
    attempts.set(candidate.source, sourceAttempts + 1);
    const url = candidate.source === 'kilo' ? KILO_CHAT : candidate.source === 'groq' ? GROQ_CHAT : OPENROUTER_CHAT;
    const headers = { 'Content-Type': 'application/json' };
    if (candidate.source === 'openrouter') headers.Authorization = `Bearer ${openRouterKey}`;
    if (candidate.source === 'groq') headers.Authorization = `Bearer ${groqKey}`;
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
        }),
      });
    } catch (error) {
      errors.push(`${candidate.source}/${candidate.model}: ${error.message}`);
      continue;
    }
    let payload;
    try {
      payload = await readBoundedJson(response, MAX_COMPLETION_RESPONSE_BYTES, 'Model response');
    } catch (error) {
      errors.push(`${candidate.source}/${candidate.model}: ${error.message}`);
      if (response.status === 402 || response.status === 429) exhausted.add(candidate.source);
      continue;
    }
    if (hasReportedNonZeroCost(payload?.usage)) {
      throw new Error(
        `${candidate.source}/${candidate.model}: provider reported non-zero or invalid usage cost; refusing further requests`
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
    `No free model completed the request. ${errors.join(' | ') || 'No eligible free models were available.'}`
  );
}

function usage() {
  return (
    'Usage: node scripts/free-model-pool.mjs --list [--limit N] [--groq-free-plan-only]\n' +
    '       node scripts/free-model-pool.mjs --prompt-file PATH [--max-tokens N] [--output-file PATH] [--groq-free-plan-only]\n' +
    '       node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH [--max-tokens N]\n' +
    'Groq is disabled unless --groq-free-plan-only is passed. That flag confirms the Groq account is on its $0 Free plan; the runner cannot detect account plan. GPT-OSS IDs are paid on the Developer plan. --output-file avoids sending results to stdout.'
  );
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqKey = process.env.GROQ_API_KEY,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {}
) {
  const list = args.includes('--list');
  const promptAt = args.indexOf('--prompt-file');
  const outputFileAt = args.indexOf('--output-file');
  const limitAt = args.indexOf('--limit');
  const tokenAt = args.indexOf('--max-tokens');
  const groqFreePlanConfirmed = args.includes('--groq-free-plan-only');
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
      groqKey,
      groqFreePlanConfirmed,
      onCatalogError: (source, error) => stderr.write(`${source} catalog unavailable: ${error.message}\n`),
    });
    const limit = limitAt >= 0 ? Math.max(1, Number(args[limitAt + 1]) || 1) : candidates.length;
    stdout.write(`${JSON.stringify(candidates.slice(0, limit), null, 2)}\n`);
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
    groqKey,
    maxTokens,
    groqFreePlanConfirmed,
    onCatalogError: (source, error) => stderr.write(`${source} catalog unavailable: ${error.message}\n`),
  });
  const output = [
    `[${result.source}/${result.model}]`,
    `Finish reason: ${result.finishReason}`,
    `Usage: ${JSON.stringify(result.usage)}`,
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
