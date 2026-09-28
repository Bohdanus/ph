#!/usr/bin/env node
/**
 * Generate `WORKTREES.json`: what every worktree in this repository holds, who
 * is working in it, what is finished, what is stuck, and what would be lost if
 * it were deleted.
 *
 * WHY A GENERATOR AND NOT A HAND-MAINTAINED FILE
 * ----------------------------------------------
 * A worktree inventory is a snapshot of a moving system. Written by hand it is
 * wrong within the hour, and worse than useless: a reader cannot tell which
 * parts are stale. So the mechanical half — branch, ahead/behind, merged,
 * dirty, untracked, chat ids, chat states — is read from git and from the Kilo
 * session database on every run and is never transcribed. The judgement half
 * lives in `lib/worktree-inventory/curated.mjs` and survives regeneration.
 *
 * The line between them is drawn on purpose. Anything git can answer is
 * generated; anything a human had to look at and decide is curated.
 *
 * WHAT THE OUTPUT IS FOR
 * ----------------------
 * Two questions, one file. "Which worktrees can I delete" is answered by
 * `prunable`, which is deliberately stricter than any single git fact. "Which
 * agents have work in flight, or died holding it" is answered by `chats`,
 * where `unfinished` and `dead` are separate arrays because they need different
 * responses: one needs a human to go and look, the other needs a fix to the
 * caller's model selection.
 *
 * @example node scripts/worktree-inventory.mjs
 * @example node scripts/worktree-inventory.mjs --check     # fail if the file is stale
 * @example node scripts/worktree-inventory.mjs --base main --window-hours 48
 * @example node scripts/worktree-inventory.mjs --quiet      # summary lines only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { collectWorktrees, findMissingWorktrees } from './lib/worktree-inventory/git.mjs';
import { auditChats } from './lib/worktree-inventory/chats.mjs';
import { readBoard } from './lib/worktree-inventory/board.mjs';
import { buildInventory, serialise, formatCanonical } from './lib/worktree-inventory/assemble.mjs';

const USAGE = `worktree inventory — regenerate WORKTREES.json

  (no flags)          write WORKTREES.json
  --check             exit 1 if WORKTREES.json is missing or stale, write nothing
  --stdout            print the inventory instead of writing it
  --base <branch>     compare against <branch> (default: main)
  --window-hours <n>  chat window in hours (default: 24)
  --now <ms>          pin the clock, for reproducible output
  --out <path>        write somewhere other than WORKTREES.json
  --quiet             summary lines only, no per-worktree table
  --help              this message`;

function parseArgs(argv) {
  const opts = { base: 'main', windowHours: 24, now: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--stdout') opts.stdout = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--base') opts.base = argv[++i];
    else if (arg === '--window-hours') opts.windowHours = Number(argv[++i]);
    else if (arg === '--now') opts.now = Number(argv[++i]);
    else if (arg === '--out') opts.out = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.windowHours) || opts.windowHours <= 0) {
    throw new Error('--window-hours must be a positive number');
  }
  return opts;
}

/**
 * The repository's MAIN checkout, so the script works from any worktree and
 * always inventories the whole repository rather than the one it was run from.
 *
 * `git rev-parse --show-toplevel` is the wrong answer here: inside a worktree
 * it returns that worktree, which would inventory one directory and report the
 * other 76 as missing. The main worktree is the first entry of
 * `git worktree list --porcelain`, and its checkout is where relative paths
 * like `.kilo/worktrees/…` resolve.
 */
function repoRoot(cwd) {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    encoding: 'utf8',
  });
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) throw new Error('git worktree list returned no worktrees');
  return resolve(first.slice('worktree '.length).trim());
}

function printSummary(inventory, quiet) {
  const t = inventory.totals;
  process.stdout.write(
    `${inventory.worktrees.length} worktrees · ` +
      `${t.prunable} prunable · ${t.salvage} salvage · ${t.inUse} in use · ` +
      `${t.holdingUncommittedWork} holding uncommitted work · ${t.withoutSummary} without a summary\n`
  );
  if (quiet) return;

  for (const w of inventory.worktrees) {
    const dirty = w.dirty + w.untracked > 0 ? ` dirty=${w.dirty} untracked=${w.untracked}` : '';
    const chats = w.chats.unfinished.length > 0 ? ` unfinished-chats=${w.chats.unfinished.length}` : '';
    process.stdout.write(
      `  ${String(w.riskScore).padStart(2)}  ${w.name.padEnd(38)} ${w.status.padEnd(20)} ` +
        `ahead=${String(w.ahead).padStart(3)} behind=${String(w.behind).padStart(3)}` +
        `${dirty}${chats}\n`
    );
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const root = repoRoot(process.cwd());
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windowMs = opts.windowHours * 60 * 60 * 1000;

  const worktrees = collectWorktrees(root, { base: opts.base });
  const missing = findMissingWorktrees(root);
  // Compare PATHS, not records. `collectWorktrees` and `findMissingWorktrees`
  // each build their own objects, so `missing.includes(w)` is reference
  // equality across disjoint sets and matches nothing — deleted worktrees
  // stayed in `existingPaths` and their sessions could never be `orphaned`.
  const missingPaths = new Set(missing.map((w) => w.path));
  const existingPaths = new Set(worktrees.map((w) => w.path).filter((p) => !missingPaths.has(p)));

  const mainHead = execFileSync('git', ['rev-parse', opts.base], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

  const chatAudit = auditChats({ sinceMs: nowMs - windowMs, nowMs, existingPaths });
  const board = readBoard(root, { nowMs });

  const inventory = buildInventory({
    worktrees,
    root,
    base: opts.base,
    mainHead,
    board,
    chatAudit,
    nowMs,
    chatWindowMs: windowMs,
  });

  if (missing.length > 0) {
    inventory.dataSources.git.missingWorktrees = missing.map((w) => w.name);
  }

  // The OUTPUT goes to the worktree the script was invoked from, never to the
  // main checkout. `root` is where worktree paths are resolved from, which is a
  // different question: the main checkout is where `.kilo/worktrees/…` is
  // meaningful, but writing there from a task worktree would land uncommitted
  // work in a shared checkout, which is the one thing AGENTS.md forbids.
  const target = resolve(process.cwd(), opts.out ?? 'WORKTREES.json');
  const next = formatCanonical(serialise(inventory));

  // `--check` is honoured BEFORE `--stdout`. They were ordered the other way,
  // so `--check --stdout` printed the document and exited 0 on a stale file
  // while USAGE described them as independent flags.
  if (opts.check) {
    let current = null;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      process.stderr.write(`worktree-inventory: ${target} does not exist\n`);
      process.exitCode = 1;
      return;
    }
    if (equivalent(current, next)) {
      process.stdout.write(`worktree-inventory: ${target} is up to date\n`);
      return;
    }
    process.stderr.write(
      `worktree-inventory: ${target} is stale\n${describeDrift(current, next)}` +
        '  regenerate with: node scripts/worktree-inventory.mjs\n'
    );
    process.exitCode = 1;
    return;
  }

  if (opts.stdout) {
    process.stdout.write(next);
    return;
  }

  try {
    writeFileSync(target, next);
  } catch (err) {
    process.stderr.write(`worktree-inventory: cannot write ${target}: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`worktree-inventory: wrote ${target}\n`);
  printSummary(inventory, opts.quiet);
}

/**
 * Are two documents the same up to the moment they were generated?
 *
 * `generatedAt` is excluded, and it has to be. This file is a live snapshot of
 * a repository where agents are continuously messaging, so a byte comparison
 * fails on the timestamp alone and `--check` could never pass — a gate that
 * always fails is not a gate, it is noise that trains people to ignore it.
 * Everything else, including every per-worktree field and every chat state, is
 * compared.
 */
export function equivalent(aText, bText) {
  try {
    const strip = (text) => {
      const doc = JSON.parse(text);
      delete doc.generatedAt;
      return JSON.stringify(doc);
    };
    return strip(aText) === strip(bText);
  } catch {
    return false;
  }
}

/**
 * Name what changed between two documents, per worktree.
 *
 * A previous version reported only `mainHead`, the worktree count and the
 * status rollup, and fell back to "content differs" for everything else — so a
 * single worktree silently flipping from `prune` to `salvage` produced the same
 * message as a changed timestamp. This names the fields an operator would act
 * on, so a stale file says which worktree to go and look at.
 */
function describeDrift(currentText, nextText) {
  let a;
  let b;
  try {
    a = JSON.parse(currentText);
    b = JSON.parse(nextText);
  } catch {
    return '  the committed file is not valid JSON\n';
  }

  const lines = [];
  if (a.mainHead !== b.mainHead) lines.push(`  mainHead ${a.mainHead} -> ${b.mainHead}`);

  const before = new Map((a.worktrees ?? []).map((w) => [w.name, w]));
  const watched = ['status', 'recommendation', 'prunable', 'ahead', 'behind', 'mergedIntoMain', 'dirty', 'untracked'];

  for (const w of b.worktrees ?? []) {
    const prev = before.get(w.name);
    if (!prev) {
      lines.push(`  + ${w.name} (${w.branch}) is new`);
      continue;
    }
    const changed = watched.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(w[k]));
    if (changed.length > 0) {
      lines.push(`  ~ ${w.name}: ${changed.map((k) => `${k} ${prev[k]} -> ${w[k]}`).join(', ')}`);
    }
  }
  for (const prev of a.worktrees ?? []) {
    if (!b.worktrees.some((w) => w.name === prev.name)) lines.push(`  - ${prev.name} is gone`);
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : '  (no per-worktree field changed)\n';
}

// Only when invoked as a command, never on import. The suite imports this
// module to test `equivalent`, and an unguarded `main()` made a unit test run
// a full 78-worktree audit against the real session database — 48 seconds of
// the real thing inside a test run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
