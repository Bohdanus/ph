#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const KILO_MODELS = 'https://api.kilo.ai/api/gateway/models';
const KILO_CHAT = 'https://api.kilo.ai/api/gateway/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_MODELS = 'https://api.groq.com/openai/v1/models';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_SOURCE = 3;
const PREFERRED_KILO_MODELS = ['poolside/laguna-s-2.1:free'];
const QUARANTINED_MODELS = new Set([
  'kilo:kilo-auto/free',
  'kilo:nvidia/nemotron-3.5-super-vl:free',
  'kilo:recursive/flint-v1.0:free',
]);

const FREE_GROQ_MODEL_IDS = new Set(['openai/gpt-oss-20b', 'openai/gpt-oss-120b']);

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
      if (!response.ok) throw new Error(`${source} catalog returned HTTP ${response.status}`);
      return catalogCandidates(source, await response.json());
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
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.choices?.[0]?.message?.content) {
      const resolvedModel = payload.model ?? candidate.model;
      const stillFree = available.some((entry) => entry.source === candidate.source && entry.model === resolvedModel);
      if (stillFree)
        return { source: candidate.source, model: resolvedModel, content: payload.choices[0].message.content };
      errors.push(`${candidate.source}/${candidate.model}: response resolved to unverified model ${resolvedModel}`);
      continue;
    }
    const reason = response.ok
      ? `empty completion${payload?.choices?.[0]?.finish_reason ? ` (finish_reason=${payload.choices[0].finish_reason})` : ''}`
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
  const prompt = await readFile(args[promptAt + 1], 'utf8');
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
  const output = `[${result.source}/${result.model}]\n${result.content}\n`;
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
