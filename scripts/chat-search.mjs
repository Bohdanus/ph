#!/usr/bin/env node

/**
 * CLI entry point for intelligent chat-history search with free-model delegation.
 *
 * Usage:
 *   node scripts/chat-search.mjs --query "your question" [options]
 *   node scripts/chat-search.mjs --prompt-file prompt.txt [options]
 *
 * Options:
 *   --providers      Comma-separated: kilo, codex, copilot, or all (default: all)
 *   --days           Time window in days (default: 30)
 *   --max-results    Max sessions to retrieve per provider (default: 20)
 *   --max-sessions   Max evidence excerpts to synthesize (default: 10)
 *   --max-tokens     Completion token budget (default: 800, max: 4000)
 *   --output-file    Write result to this file instead of stdout
 *   --probe-openrouter-quota  Check OpenRouter free quota before routing
 *   --groq-free-plan          Enable Groq free plan routing
 *   --opencode-command CMD    Override OpenCode CLI command
 *
 * The script searches local Kilo, Codex, and Copilot chat histories for sessions
 * matching the query, extracts bounded transcript excerpts, ranks them by
 * relevance using a free model, then synthesizes a concise answer using a free
 * model. Matching transcript excerpts are sent to the selected free-model
 * provider. Databases are opened read-only.
 */

import { executeChatSearch } from './lib/chat-search.mjs';
import { sanitizeErrorMessage } from './lib/secrets.mjs';

const USAGE = `Usage: node scripts/chat-search.mjs --query "question" [options]
        node scripts/chat-search.mjs --prompt-file PATH [options]

  --query TEXT              Natural-language question (mutually exclusive with --prompt-file)
  --prompt-file PATH        File containing the question (mutually exclusive with --query)
  --providers LIST          Comma-separated providers: kilo, codex, copilot, all (default: all)
  --days N                  Search window in days (default: 30)
  --max-results N           Max sessions per provider (default: 20)
  --max-sessions N          Max evidence excerpts to synthesize (default: 10)
  --max-tokens N            Completion tokens (default: 800, max: 4000)
  --output-file PATH        Write result to file
  --probe-openrouter-quota  Check OpenRouter free quota before routing
  --groq-free-plan          Enable Groq free plan routing
  --opencode-command CMD    Override OpenCode CLI command
  --quiet, -q               Suppress progress output (errors still shown)
  --verbose, -v             Enable verbose debug output
  --help, -h                Show this help

Matching transcript excerpts are sent to the selected free-model provider.
Groq keys must use GROQ_API_KEY or configured key files; command-line keys are unsupported.

Examples:
  node scripts/chat-search.mjs --query "worst damage in kilo chats last month" --providers kilo --days 30
  node scripts/chat-search.mjs --prompt-file ask.txt --providers all --output-file result.txt
`;

const VALUE_FLAGS = new Set([
  '--query',
  '--prompt-file',
  '--providers',
  '--days',
  '--max-results',
  '--max-sessions',
  '--max-tokens',
  '--output-file',
  '--opencode-command',
]);

function parseArgs(args) {
  const values = new Map();
  let probeQuota = false;
  let groqFreePlan = false;
  let quiet = false;
  let verbose = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--probe-openrouter-quota') {
      probeQuota = true;
      continue;
    }
    if (arg === '--groq-free-plan') {
      groqFreePlan = true;
      continue;
    }
    if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      continue;
    }
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }
    if (values.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    values.set(arg, value);
    index += 1;
  }
  return { values, probeQuota, groqFreePlan, quiet, verbose };
}

function integerOption(values, flag, fallback, min, max) {
  const raw = values.get(flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be an integer from ${min} to ${max}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export async function main(
  args = process.argv.slice(2),
  {
    fetchImpl = fetch,
    openRouterKey = process.env.OPENROUTER_API_KEY,
    groqApiKey = process.env.GROQ_API_KEY,
    groqFreePlan = process.env.GROQ_FREE_PLAN === '1',
    opencodeCommand = process.env.OPENCODE_CLI ?? 'opencode',
    stderr = process.stderr,
    stdout = process.stdout,
  } = {}
) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    stderr.write(`${sanitizeErrorMessage(error.message)}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }

  const { values, probeQuota, groqFreePlan: cliGroqFreePlan, quiet, verbose } = parsed;
  const query = values.get('--query') || '';
  const promptFile = values.get('--prompt-file');
  const providers = values.get('--providers') || 'all';

  if (!query && !promptFile) {
    stderr.write(USAGE);
    return 2;
  }
  if (query && promptFile) {
    stderr.write('--query and --prompt-file are mutually exclusive.\n');
    return 2;
  }
  if (quiet && verbose) {
    stderr.write('--quiet and --verbose are mutually exclusive.\n');
    return 2;
  }

  let days, maxResults, maxSessions, maxTokens;
  try {
    days = integerOption(values, '--days', 30, 1, 3650);
    maxResults = integerOption(values, '--max-results', 20, 1, 1000);
    maxSessions = integerOption(values, '--max-sessions', 10, 1, 50);
    maxTokens = integerOption(values, '--max-tokens', 800, 1, 4000);
  } catch (error) {
    stderr.write(`${sanitizeErrorMessage(error.message)}\n`);
    return 2;
  }

  const outputFile = values.get('--output-file');
  const cliOpencodeCommand = values.get('--opencode-command') || opencodeCommand;
  const effectiveGroqFreePlan = cliGroqFreePlan || groqFreePlan;

  const code = await executeChatSearch({
    query,
    promptFile,
    providers,
    days,
    maxResults,
    maxSessions,
    maxTokens,
    outputFile,
    fetchImpl,
    openRouterKey,
    groqApiKey,
    groqFreePlan: effectiveGroqFreePlan,
    opencodeCommand: cliOpencodeCommand,
    probeOpenRouterQuota: probeQuota,
    quiet,
    verbose,
    stderr,
    stdout,
  });

  return code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${sanitizeErrorMessage(error.message)}\n`);
      process.exitCode = 1;
    });
}

export { USAGE, parseArgs, integerOption };
