#!/usr/bin/env node

const KILO_MODELS = 'https://api.kilo.ai/api/gateway/models';
const KILO_CHAT = 'https://api.kilo.ai/api/gateway/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS_PER_SOURCE = 3;
const QUARANTINED_MODELS = new Set([
  'kilo:kilo-auto/free',
  'kilo:nvidia/nemotron-3.5-super-vl:free',
  'kilo:recursive/flint-v1.0:free',
]);

export function zeroPriced(pricing) {
  return pricing?.prompt === '0' && pricing?.completion === '0';
}

export function catalogCandidates(source, data) {
  const rows = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((row) => {
      if (!row?.id || !zeroPriced(row.pricing)) return false;
      if (QUARANTINED_MODELS.has(`${source}:${row.id}`)) return false;
      if (source === 'openrouter') return row.id.endsWith(':free');
      return source === 'kilo' && (row.isFree === true || row.id.endsWith(':free'));
    })
    .map((row) => ({ source, model: row.id, name: row.name ?? row.id }));
}

export async function loadCatalogs({
  fetchImpl = fetch,
  openRouterKey = process.env.OPENROUTER_API_KEY,
  onCatalogError = () => {},
} = {}) {
  const sources = [{ source: 'kilo', url: KILO_MODELS }];
  if (openRouterKey) sources.push({ source: 'openrouter', url: OPENROUTER_MODELS });
  const results = await Promise.allSettled(
    sources.map(async ({ source, url }) => {
      const headers = source === 'openrouter' ? { Authorization: `Bearer ${openRouterKey}` } : {};
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
    maxTokens = 1200,
    onCatalogError = () => {},
  } = {}
) {
  const available = await loadCatalogs({ fetchImpl, openRouterKey, onCatalogError });
  const exhausted = new Set();
  const attempts = new Map();
  const errors = [];
  for (const candidate of available) {
    if (exhausted.has(candidate.source)) continue;
    const sourceAttempts = attempts.get(candidate.source) ?? 0;
    if (sourceAttempts >= MAX_ATTEMPTS_PER_SOURCE) continue;
    if (candidate.source === 'openrouter' && !openRouterKey) continue;
    attempts.set(candidate.source, sourceAttempts + 1);
    const url = candidate.source === 'kilo' ? KILO_CHAT : OPENROUTER_CHAT;
    const headers = { 'Content-Type': 'application/json' };
    if (candidate.source === 'openrouter') headers.Authorization = `Bearer ${openRouterKey}`;
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
    'Usage: node scripts/free-model-pool.mjs --list [--limit N]\n' +
    '       node scripts/free-model-pool.mjs --prompt-file PATH [--max-tokens N]\n' +
    'Uses Kilo anonymous free models and, when OPENROUTER_API_KEY is set, OpenRouter :free models. Never selects paid catalog entries.'
  );
}

export async function main(args = process.argv.slice(2)) {
  const list = args.includes('--list');
  const promptAt = args.indexOf('--prompt-file');
  const limitAt = args.indexOf('--limit');
  const tokenAt = args.indexOf('--max-tokens');
  if ((!list && promptAt < 0) || (list && promptAt >= 0)) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (list) {
    const candidates = await loadCatalogs({
      onCatalogError: (source, error) => process.stderr.write(`${source} catalog unavailable: ${error.message}\n`),
    });
    const limit = limitAt >= 0 ? Math.max(1, Number(args[limitAt + 1]) || 1) : candidates.length;
    process.stdout.write(`${JSON.stringify(candidates.slice(0, limit), null, 2)}\n`);
    return 0;
  }
  const { readFile } = await import('node:fs/promises');
  const prompt = await readFile(args[promptAt + 1], 'utf8');
  const maxTokens = tokenAt >= 0 ? Math.max(1, Number(args[tokenAt + 1]) || 1200) : 1200;
  const result = await completeWithFreeModel(prompt, {
    maxTokens,
    onCatalogError: (source, error) => process.stderr.write(`${source} catalog unavailable: ${error.message}\n`),
  });
  process.stdout.write(`[${result.source}/${result.model}]\n${result.content}\n`);
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
