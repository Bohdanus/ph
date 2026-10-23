#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeWithFreeModel, loadCatalogs } from './free-model-pool.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_CONTENT_CHARS = 30_000;

const USAGE = `Usage: node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH [options]

  --prompt-file PATH      File with the research request / question (required)
  --url-list  PATH        File with one URL per line (required)
  --output-file PATH      Write condensed summary to this file (required)
  --max-tokens N          Max tokens for the condensing model (default 1200)
  --fetch-timeout MS      Per-URL fetch timeout (default 20000)
  --max-concurrency N     Parallel fetches (default 4)
  --max-content CHARS     Per-URL content cap before truncation (default 30000)
  --no-truncate           Disable content truncation (use with \u201c--output-file\u201d only)

Token-saving pattern: fetches URLs, condenses via a free model, and writes ONLY
the condensed summary to the output file. The caller reads the summary file, not
the raw web content, keeping the conversation context small.

Example:
  node scripts/free-research.mjs \\
    --prompt-file ./research-prompt.txt \\
    --url-list ./urls-to-check.txt \\
    --output-file ./findings-summary.md

`;

function argValue(args, flag) {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

export function stripHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchUrl(
  url,
  { fetchImpl = fetch, maxContent = MAX_CONTENT_CHARS, timeout = FETCH_TIMEOUT_MS, truncate = true } = {}
) {
  const signal = AbortSignal.timeout(timeout);
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    return JSON.stringify(data, null, 2);
  }
  const text = await response.text();
  const stripped = stripHtml(text);
  if (truncate && stripped.length > maxContent) {
    return stripped.slice(0, maxContent) + `... [truncated, full content ${stripped.length} chars]`;
  }
  return stripped;
}

export async function fetchAll(urls, { fetchImpl, maxConcurrency, maxContent, timeout, truncate } = {}) {
  const caps = { fetchImpl, maxContent, timeout, truncate };
  const results = [];
  const inFlight = new Set();
  let i = 0;
  const run = async () => {
    while (i < urls.length) {
      const idx = i++;
      const url = urls[idx];
      if (url) {
        const p = fetchUrl(url, caps).then(
          (content) => ({ url, ok: true, content }),
          (error) => ({ url, ok: false, error: error.message })
        );
        inFlight.add(p);
        if (inFlight.size >= maxConcurrency) {
          await Promise.race(inFlight);
          inFlight.forEach((p) => p.then((r) => inFlight.delete(p)).catch(() => inFlight));
        }
      }
    }
    const settled = await Promise.all(inFlight);
    results.push(...settled);
  };
  await run();
  return results;
}

export function buildResearchPrompt(question, fetched) {
  const context = fetched
    .map((r) =>
      r.ok
        ? `<source url="${r.url}">\n${r.content}\n</source>`
        : `<source url="${r.url}">\n[FETCH_FAILED: ${r.error}]\n</source>`
    )
    .join('\n\n');
  return `Research request: ${question}\n\nEvidence sources below. Extract the key findings into concise, evidence-backed bullet points, citing each source by its URL. Do not cite line numbers from fetched pages. If a source failed to fetch, note it as unverified.\n\n${context}\n\nSummary (bullet points with URL citations):`;
}

export async function main(args = process.argv.slice(2)) {
  const promptFile = argValue(args, '--prompt-file');
  const urlListFile = argValue(args, '--url-list');
  const outputFile = argValue(args, '--output-file');
  const maxTokens = Number(argValue(args, '--max-tokens') || '1200');
  const timeout = Number(argValue(args, '--fetch-timeout') || String(FETCH_TIMEOUT_MS));
  const maxConcurrency = Number(argValue(args, '--max-concurrency') || MAX_CONCURRENCY);
  const maxContent = Number(argValue(args, '--max-content') || MAX_CONTENT_CHARS);
  const truncate = !args.includes('--no-truncate');

  if (!promptFile || !urlListFile || !outputFile) {
    process.stderr.write(USAGE);
    return 2;
  }

  const question = (await readFile(promptFile, 'utf8')).trim();
  const urlList = (await readFile(urlListFile, 'utf8'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (urlList.length === 0) {
    process.stderr.write('No URLs found in url-list file.\n');
    return 3;
  }

  process.stderr.write(`Fetching ${urlList.length} URLs (concurrency=${maxConcurrency})...\n`);
  const fetched = await fetchAll(urlList, { maxConcurrency, maxContent, timeout, truncate });
  const okCount = fetched.filter((r) => r.ok).length;
  process.stderr.write(`Fetched ${okCount}/${urlList.length} OK\n`);

  const researchPrompt = buildResearchPrompt(question, fetched);
  process.stderr.write('Condensing via free model...\n');
  const result = await completeWithFreeModel(researchPrompt, {
    maxTokens,
    onCatalogError: (source, error) =>
      process.stderr.write(`${source} free-model catalog unavailable: ${error.message}\n`),
  });

  const output = result.content + '\n';
  await writeFile(outputFile, output, 'utf8');
  process.stderr.write(`Summary written to ${outputFile} (condensed from ${researchPrompt.length} chars of context)\n`);
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
