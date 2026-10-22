#!/usr/bin/env node
/**
 * Poll GPT for the tokens left in a rolling window, and hold the reading.
 * -----------------------------------------------------------------------
 * This is the standalone entry point for `swarm tokens --poll`. It exists as a
 * script (not only as a `swarm` subcommand) so an operator-owned cadence can
 * record a timestamped reading without spawning a second `swarm` process. This
 * repository does not schedule it automatically.
 *
 * WHAT IT READS
 * -------------
 * The local Kilo session database (`~/.local/share/kilo/kilo.db`, or `KILO_DB`),
 * specifically per-message assistant usage records. Session totals are
 * cumulative and cannot be assigned to a five-hour window. There is no
 * documented provider endpoint that returns account tokens remaining, so this
 * records message-token usage against an operator-configured budget and estimates
 * the next rolling-window expiry from the oldest matching message. Both figures
 * are approximations, not an account balance/reset guarantee. See
 * `lib/agent-board/token-poll.mjs` for the rationale and reading fields.
 *
 * HOW TO READ THE OUTPUT
 * ----------------------
 * `--json` prints one JSON object: the recorded reading plus where it landed.
 * Without it, one human line. Either form is safe to pipe into `swarm watch`,
 * and `detail` is the only field allowed to carry approximation notes.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Board, TOKEN_WINDOW_HOURS, resolveBoardDir } from './lib/agent-board/db.mjs';
import {
  MAX_TOKEN_WINDOW_HOURS,
  formatTokenWindow,
  pollGptTokens,
  resolveBudget,
  subagentTokenPolicy,
} from './lib/agent-board/token-poll.mjs';

const USAGE = `poll-gpt-tokens — record a GPT token-budget reading on the swarm board

  (no flags)          poll the 5-hour window, record, print one line
  --budget <n>        token ceiling for the window (default: KILO_TOKEN_WINDOW_BUDGET)
  --window <hours>    look-back width in hours (default: ${TOKEN_WINDOW_HOURS}, max: ${MAX_TOKEN_WINDOW_HOURS})
  --board-dir <path>  write to another board database
  --now <ms>          pin the poll clock (default: wall clock)
  --json              emit the recorded reading as JSON
  --help              this message`;

function parseArgs(argv) {
  const opts = { budget: null, window: TOKEN_WINDOW_HOURS, boardDir: null, now: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--budget') opts.budget = argv[++i];
    else if (arg === '--window') opts.window = Number(argv[++i]);
    else if (arg === '--board-dir') opts.boardDir = argv[++i];
    else if (arg === '--now') opts.now = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (opts.help) return opts;
  if (!Number.isFinite(opts.window) || opts.window <= 0 || opts.window > MAX_TOKEN_WINDOW_HOURS) {
    throw new Error(`--window needs a positive number of hours no greater than ${MAX_TOKEN_WINDOW_HOURS}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (opts.now !== null && (!Number.isFinite(opts.now) || opts.now > Date.now())) {
    throw new Error('--now must be a finite millisecond timestamp');
  }

  const dir = opts.boardDir ?? resolveBoardDir({ cwd: process.cwd() });
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const board = new Board({ dir, identity: { agentId: 'poll-gpt-tokens' } }).open();

  try {
    const reading = pollGptTokens({
      windowHours: opts.window,
      budgetTokens: resolveBudget(opts.budget),
      nowMs: opts.now === null ? Date.now() : opts.now,
    });
    const routingPolicy = subagentTokenPolicy(reading, opts.now === null ? Date.now() : opts.now);
    board.recordTokenWindow(reading);
    // Only hold the live window so the table does not grow without bound as the
    // operator polls it. Readings older than the window are not "held"
    // data worth keeping.
    board.pruneTokenWindow({ windowHours: opts.window });
    const lastSeq = board.lastSeq();
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ reading, routingPolicy, board: dir, eventSeq: lastSeq }, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${formatTokenWindow(reading)}; subagents ${routingPolicy.recommendation} — recorded on the board at ${dir} (event #${lastSeq})\n`
      );
    }
    return 0;
  } finally {
    board.close();
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await main();
  } catch (err) {
    process.stderr.write(`poll-gpt-tokens: ${err.message}\n`);
    process.exitCode = 1;
  }
}
