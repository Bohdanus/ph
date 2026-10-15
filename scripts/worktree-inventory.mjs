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

import { collectWorktrees, findMissingWorktrees, resolveBaseRef } from './lib/worktree-inventory/git.mjs';
import { auditChats, resolveSessionDb } from './lib/worktree-inventory/chats.mjs';
import { LIVE_WINDOW_MS } from './lib/worktree-inventory/classify.mjs';
import { auditWrites } from './lib/worktree-inventory/writes.mjs';
import {
  MAX_SESSION_DB_WINDOW_HOURS,
  MAX_SESSION_DB_WINDOW_MS,
} from './lib/worktree-inventory/session-audit-limits.mjs';
import { createSessionDbSnapshot } from './lib/worktree-inventory/session-db-snapshot.mjs';
import { readBoard } from './lib/worktree-inventory/board.mjs';
import { loadChatAudit } from './lib/worktree-inventory/chat-audit.mjs';
import { buildInventory, serialise, formatCanonical } from './lib/worktree-inventory/assemble.mjs';

const USAGE = `worktree inventory — regenerate WORKTREES.json

  (no flags)          write WORKTREES.json
  --check             exit 1 if WORKTREES.json is missing or stale, write nothing
  --stdout            print the inventory instead of writing it
  --base <branch>     compare against <branch> (default: main)
  --window-hours <n>  chat window in hours (default: 24, maximum: 72; the session database is never read older than 3 days)
  --now <ms>          pin recency evaluation; must not be in the future; generatedAt stays on the wall clock
  --out <path>        write somewhere other than WORKTREES.json
  --no-live-writers   declare that NO chat is writing to any worktree right now,
                      and record WHY in the file. Overrides the recency
                      heuristics, which keep reporting an owner for half an hour
                      after the process that was writing is gone.
  --release-reads     release every reader whose last read predates now. A
                      WATERMARK, not an event: it is carried forward from the
                      existing file and only ever moves forward, so a released
                      reader is never emitted again. Writers are untouched.
  --release-reads=<iso>
                      the same, with an explicit cut-off.
  --quiet             summary lines only, no per-worktree table
  --help              this message`;

/**
 * Read the value of a flag, which may or may not be followed by its argument.
 *
 * `--no-live-writers` reads naturally both as a bare switch and as
 * `--no-live-writers "the editor restarted"`, and the second form is the one
 * worth having: an override with no stated reason is indistinguishable from a
 * bug in the generator, so the reason is required in substance and defaulted
 * only so the bare switch still works.
 */
function takeValue(argv, i, inline) {
  if (inline !== undefined) return { value: inline, next: i };
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return { value: null, next: i };
  return { value: next, next: i + 1 };
}

export function validatePinnedNow(nowMs, wallNowMs = Date.now()) {
  if (!Number.isFinite(nowMs)) throw new Error('--now must be a finite millisecond timestamp');
  if (nowMs > wallNowMs) throw new Error('--now cannot be in the future');
}

export function parseArgs(argv) {
  const opts = { base: 'main', windowHours: 24, now: null, out: null, noLiveWriters: null };
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
    else if (arg === '--no-live-writers' || arg.startsWith('--no-live-writers=')) {
      const eq = arg.indexOf('=');
      const { value, next } = takeValue(argv, i, eq === -1 ? undefined : arg.slice(eq + 1));
      i = next;
      opts.noLiveWriters = value ?? 'declared by the operator: no chat is writing to any worktree right now';
    } else if (arg === '--release-reads' || arg.startsWith('--release-reads=')) {
      const eq = arg.indexOf('=');
      const { value, next } = takeValue(argv, i, eq === -1 ? undefined : arg.slice(eq + 1));
      i = next;
      opts.releaseReads = value ?? 'now';
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.windowHours) || opts.windowHours <= 0) {
    throw new Error('--window-hours must be a positive number');
  }
  if (opts.windowHours > MAX_SESSION_DB_WINDOW_HOURS) {
    throw new Error(
      `--window-hours cannot exceed ${MAX_SESSION_DB_WINDOW_HOURS} (the session database safety limit is 3 days)`
    );
  }
  if (opts.now !== null) validatePinnedNow(opts.now);
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
  const byName = new Map(inventory.worktrees.map((w) => [w.name, w]));
  const line = (n) => `  ${n.padEnd(40)} ${byName.get(n)?.branch ?? ''}`;

  process.stdout.write(
    `${inventory.worktrees.length} worktrees · ` +
      `${t.readyToLand} ready to land · ${t.disposalCandidates} to dispose · ` +
      `${t.legacy} legacy · ${t.atRisk} at risk · ${t.inUse} in use · ${t.undecided} undecided · ` +
      `${t.holdingUncommittedWork} holding uncommitted work · ` +
      `${t.withoutSummary} without a summary\n`
  );

  // Ownership, before anything that acts on it. A reader who has just been told
  // "N ready for disposal" needs to know whether N is counting a worktree
  // somebody is standing in.
  const own = inventory.ownership;
  process.stdout.write(
    `OWNERSHIP — ${own.liveWriterCount} live writer chat(s) · ` +
      `${own.derivedLiveWorktrees.length} worktree(s) derived live` +
      (own.suppressed ? ` · SUPPRESSED: ${own.reason}\n` : '\n')
  );
  if (own.suppressed) {
    for (const r of own.derivedLiveWorktrees) {
      const w = byName.get(r);
      process.stdout.write(
        `  ${r} looked live at ${own.asOf} and is now reported as unowned` +
          `${w?.writeHistory?.lastChatId ? ` (last write by ${w.writeHistory.lastChatId})` : ''}\n`
      );
    }
  }
  process.stdout.write(
    `WRITE HISTORY — ${t.withWriteHistory} worktree(s) with writers · ` +
      `${t.writtenRecently} written in the last 30m · ` +
      `${t.goneWorktreesWithWrites} DELETED worktree(s) with writers · ` +
      `${t.totalWriteCalls} file-writing call(s)\n` +
      `READ HISTORY — ${t.withReadHistory} worktree(s) with readers · ` +
      `${t.totalReadCalls} read call(s)` +
      (own.readsReleasedBefore
        ? ` · ${own.readsReleasedChatCount} reader(s) held after the ${own.readsReleasedBefore} release\n`
        : ' · no release has been applied (pass --release-reads to drop stale readers)\n') +
      // Not a write count. The size of what the write count cannot see: any of
      // these commands could have written a file, and the file does not pretend
      // otherwise.
      `SHELL TRAFFIC — ${t.withShellHistory} worktree(s) · ${t.totalShellCalls} command(s) with a workdir here, ` +
      `any of which may have written a file that writeHistory cannot see\n`
  );

  // Deleted worktrees are listed before the actionable lists because they are
  // the entries with no other way to be discovered: `git worktree list` cannot
  // return them, and no per-worktree record survives to carry them.
  if (inventory.goneWorktrees.length > 0) {
    process.stdout.write(
      `\nWORKTREES THAT NO LONGER EXIST, AND WHO WROTE IN THEM ` +
        `(${inventory.goneWorktrees.length}, sorted by write calls):\n`
    );
    for (const g of inventory.goneWorktrees.slice(0, 25)) {
      process.stdout.write(
        `  ${String(g.writeCalls).padStart(4)} calls · ${g.chatCount} chat(s) · ` +
          `${String(g.name).padEnd(38)} last ${g.lastWriteAt ?? 'unknown'}\n`
      );
    }
    if (inventory.goneWorktrees.length > 25) {
      process.stdout.write(`  … and ${inventory.goneWorktrees.length - 25} more\n`);
    }
  }

  // The read audit, before the worktree table. A computed chat state cannot
  // tell you an agent reported "Done" for a branch that was never merged, and
  // that is the question this file is for.
  if (inventory.readUnfinished?.length) {
    const counts = {};
    for (const r of inventory.readUnfinished) counts[r.readState] = (counts[r.readState] ?? 0) + 1;
    const shape = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ');
    process.stdout.write(
      `\nREAD FROM TRANSCRIPTS — ${inventory.readUnfinished.length} sessions not finished: ${shape}\n`
    );
    for (const r of inventory.readUnfinished) {
      // The tag used to read `r.workOnNoRef`, a key the projection never had,
      // so it was always undefined and never printed. It is derived here
      // instead, from the same numbers the top-level list uses.
      const onNoRef = r.modifiedFiles > 0 && r.commitsAheadOfMain === 0;
      const tag = onNoRef ? ' [WORK ON NO REF at asOf]' : r.readRisk === 'high' ? ' [high risk]' : '';
      process.stdout.write(`  ${r.readState.padEnd(11)}${tag}\n      ${r.id}\n`);
      if (r.note) process.stdout.write(`      ${r.note}\n`);
    }
  }
  const stillHeld = (inventory.workOnNoRef ?? []).filter((r) => r.stillOnNoRef === true);
  if ((inventory.workOnNoRef ?? []).length > 0) {
    process.stdout.write(
      `\nWORK THAT WAS ON NO REF at ${inventory.dataSources.readAudit.asOf} ` +
        `(${stillHeld.length} still held, ${inventory.workOnNoRef.length - stillHeld.length} landed since):\n`
    );
    for (const r of inventory.workOnNoRef) {
      const state =
        r.stillOnNoRef === true ? 'STILL ON NO REF' : r.stillOnNoRef === null ? 'DIRECTORY GONE' : 'landed since';
      process.stdout.write(`  ${r.directory.padEnd(42)} ${state}\n`);
    }
  }
  if (inventory.readLostWorktree?.length) {
    process.stdout.write(
      `\nWORK TREES THAT WERE DELETED OUT FROM UNDER AN AGENT ` +
        `(${inventory.readLostWorktreeHighRisk} of ${inventory.readLostWorktree.length} rated high risk):\n`
    );
    for (const r of inventory.readLostWorktree) {
      process.stdout.write(`  ${r.readRisk.padEnd(6)} ${r.readState.padEnd(10)} ${r.directory}\n`);
      if (r.note && r.readRisk !== 'low') process.stdout.write(`          ${r.note}\n`);
    }
  }

  // The two answers the file exists to give, listed before the evidence.
  if (inventory.readyToLand.length > 0) {
    process.stdout.write(`\nREADY TO LAND (clean, unmerged, merges with no conflict):\n`);
    for (const n of inventory.readyToLand) process.stdout.write(`${line(n)}\n`);
  }
  if (inventory.disposalCandidates.length > 0) {
    process.stdout.write(`\nREADY FOR DISPOSAL (on main, clean, nothing protected):\n`);
    for (const n of inventory.disposalCandidates) process.stdout.write(`${line(n)}\n`);
  }
  // Printed beside the disposal list and not inside it, because the two answers
  // are half the same instruction: `npm run dispose -- <name>` on a name from
  // either list removes the worktree, and on one from THIS list it removes the
  // worktree and keeps the branch. A reader who only saw `disposalCandidates`
  // would delete the ref that is the entire point of the status.
  if (inventory.legacy.length > 0) {
    process.stdout.write(`\nLEGACY — worktree disposable, BRANCH KEPT (do not merge it either):\n`);
    for (const n of inventory.legacy) process.stdout.write(`${line(n)}\n`);
  }
  if (quiet) return;

  process.stdout.write('\nALL WORKTREES:\n');
  for (const w of inventory.worktrees) {
    const dirty = w.dirty + w.untracked > 0 ? ` dirty=${w.dirty} untracked=${w.untracked}` : '';
    const chats = w.chats.unfinished.length > 0 ? ` unfinished-chats=${w.chats.unfinished.length}` : '';
    // Printed, because a field nothing prints and nothing reads is a field
    // nothing acts on: this is the one place an agent actually looks before it
    // disposes of something, and the collision count is what stops a reader
    // treating a branch NAME as proof the work is already landed.
    const collided = w.nameCollisions.length > 0 ? ` name-in-${w.nameCollisions.length}-merge(s)` : '';
    process.stdout.write(
      `  ${String(w.riskScore).padStart(2)}  ${w.name.padEnd(38)} ${w.action.padEnd(10)} ` +
        `ahead=${String(w.ahead).padStart(3)} behind=${String(w.behind).padStart(3)}` +
        `${dirty}${chats}${collided}\n`
    );
  }
}

/**
 * Where the reader release mark sits, as a WATERMARK that only moves forward.
 *
 * A release cannot be an event, because this document is rebuilt from the
 * database on every run: a flag that dropped readers once would be repopulated by
 * the next run from the very same rows, and the release would silently undo
 * itself. So the mark lives in the file it filters, is read back out on the next
 * run, and is combined with `Math.max` — which makes it permanent without keeping
 * any record of which entries it removed, and makes writers safe by construction
 * because they live in a different structure that nothing here filters.
 *
 * A missing or unreadable previous file is not an error: it means no release has
 * happened yet, which is the correct state for a first run.
 */
export function resolveReadsReleasedBefore(target, requested, nowMs) {
  let previous = 0;
  try {
    const doc = JSON.parse(readFileSync(target, 'utf8'));
    const stamp = doc?.ownership?.readsReleasedBefore;
    if (typeof stamp === 'string') previous = Date.parse(stamp) || 0;
  } catch {
    previous = 0;
  }

  if (!requested) return previous;
  const asked = requested === 'now' ? nowMs : Date.parse(requested);
  if (!Number.isFinite(asked)) {
    throw new Error(`--release-reads needs "now" or an ISO timestamp, not ${JSON.stringify(requested)}`);
  }
  // Monotone. A release asked for with a cut-off in the past cannot un-release
  // readers a later release already removed, because those rows are gone from the
  // document and the mark is the only memory.
  return Math.max(previous, asked);
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

  // Run the async main logic
  runAsyncMain(opts).catch((err) => {
    process.stderr.write(`worktree-inventory: ${err.message}\n`);
    process.exitCode = 1;
  });
}

async function runAsyncMain(opts) {
  const root = repoRoot(process.cwd());
  const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windowMs = opts.windowHours * 60 * 60 * 1000;

  // Resolve base ref before collecting worktrees
  const base = opts.base ?? resolveBaseRef(root);
  if (base === null) {
    throw new Error(
      `no base ref could be resolved in ${root}, so every ahead/behind and merged-into-base answer ` +
        'would be null and the inventory would read as "nothing is at risk" for a reason that has nothing ' +
        `to do with risk. Tried main, origin/main, refs/remotes/origin/main. Pass --base <ref> to name one.`
    );
  }
  opts.base = base;

  // Use async collectWorktrees for parallel execution
  const worktrees = await collectWorktrees(root, { base: opts.base });
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

  // Never run the expensive JSON audits against the live Kilo database. The
  // snapshot helper copies only the bounded recent session/part projection and
  // yields between source batches, so a huge historical database is not copied
  // before the inventory can produce a result.
  // If the backup cannot be made, pass a null path so both audits fail closed;
  // falling back to the live path would recreate the outage this guard prevents.
  const liveSessionDbPath = resolveSessionDb();
  const sessionDbSnapshot = await createSessionDbSnapshot(liveSessionDbPath, {
    sinceMs: nowMs - MAX_SESSION_DB_WINDOW_MS,
    nowMs,
  });
  const sessionDbPath = sessionDbSnapshot?.dbPath ?? null;
  let chatAudit;
  let writeAudit;
  try {
    chatAudit = auditChats({ dbPath: sessionDbPath, sinceMs: nowMs - windowMs, nowMs, existingPaths });
    // The write audit is a SECOND pass over the same snapshot. It is deliberately
    // bounded to the same three-day safety window: no worktree can be live beyond
    // that window, and scanning older calls only creates I/O pressure without
    // changing a disposal decision.
    writeAudit = auditWrites({
      dbPath: sessionDbPath,
      root,
      worktreePaths: worktrees.map((w) => w.path),
      nowMs,
      liveWindowMs: LIVE_WINDOW_MS,
      sinceMs: nowMs - MAX_SESSION_DB_WINDOW_MS,
    });
  } finally {
    await sessionDbSnapshot?.cleanup();
  }
  if (sessionDbSnapshot) {
    // Keep the source path in the generated report; the temporary snapshot path
    // is intentionally gone by the time the inventory is written.
    chatAudit.dbPath = sessionDbSnapshot.sourcePath;
    chatAudit.snapshot = true;
    writeAudit.dbPath = sessionDbSnapshot.sourcePath;
    writeAudit.snapshot = true;
  } else {
    const reason = 'session database snapshot unavailable; the live database was not queried';
    chatAudit.reason = reason;
    writeAudit.reason = reason;
  }
  const board = readBoard(root, { nowMs });
  // The read audit is a human pass over transcripts, so it is NOT filtered by
  // the window: it is a fixed record of what those sessions were found to be
  // doing. Sessions in it that fall outside the current window simply have no
  // computed counterpart, and the two views are expected to disagree.
  const readAudit = loadChatAudit();

  // Resolved BEFORE the inventory is built, because the reader watermark is an
  // INPUT to it, not a post-hoc edit of the output.
  const target = resolve(process.cwd(), opts.out ?? 'WORKTREES.json');
  let readsReleasedBeforeMs;
  try {
    readsReleasedBeforeMs = resolveReadsReleasedBefore(target, opts.releaseReads, nowMs);
  } catch (err) {
    process.stderr.write(`worktree-inventory: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const generatedAtMs = Date.now();
  const inventory = buildInventory({
    worktrees,
    root,
    base: opts.base,
    mainHead,
    board,
    chatAudit,
    writeAudit,
    readAudit,
    nowMs,
    generatedAtMs,
    chatWindowMs: windowMs,
    liveWindowMs: LIVE_WINDOW_MS,
    liveWritersSuppressed: opts.noLiveWriters,
    readsReleasedBeforeMs,
  });

  if (missing.length > 0) {
    inventory.dataSources.git.missingWorktrees = missing.map((w) => w.name);
  }

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
 * Are two documents the same apart from their generation and evaluation times?
 *
 * Both timestamps move on every ordinary run. The evaluation time is metadata
 * for the recency decisions, while `generatedAt` is the freshness clock used by
 * disposal. Every verdict and per-worktree field remains part of the comparison.
 */
export function equivalent(aText, bText) {
  try {
    const strip = (text) => {
      const doc = JSON.parse(text);
      delete doc.generatedAt;
      if (doc.ownership && typeof doc.ownership === 'object') delete doc.ownership.asOf;
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
  // The merge verdict is the fastest-decaying field in the file: main moves,
  // and a branch that merged cleanly yesterday stops doing so today. Without it
  // here, a worktree flipping from `land` to `at-risk` reported "no
  // per-worktree field changed" — the reporter failing at its one job.
  const watched = [
    'status',
    'recommendation',
    'action',
    'prunable',
    'ahead',
    'behind',
    'mergedIntoMain',
    'dirty',
    'untracked',
    'mergeConflict',
    'mergeConflictFiles',
    'mergeChecked',
    'patchEquivalence',
    'patchEquivalenceReason',
    'statusError',
    'locked',
    'prunableReason',
    'legacy',
    'writeHistory',
    // Ownership is watched because a suppressed-liveness file drifts on a
    // timer, not on a commit: the derived signals keep ageing and the operator
    // has to be told when the file stopped being true.
    'live',
    'derivedLive',
    'liveSuppressed',
  ];

  // The ownership fields are objects, so a plain `a -> b` renders `[object
  // Object]` on both sides and names no difference at all. The two that an
  // operator acts on are scalars and get the readable form; the rest report as
  // changed, which is the honest amount of detail for a nested record.
  const scalar = (v) => (v === null || typeof v !== 'object' ? v : '…');
  const describeField = (name, key, prev, next) => {
    if (name === 'writeHistory') return `writeHistory.lastAt ${prev?.lastAt} -> ${next?.lastAt}`;
    return `${key} ${scalar(prev)} -> ${scalar(next)}`;
  };

  for (const w of b.worktrees ?? []) {
    const prev = before.get(w.name);
    if (!prev) {
      lines.push(`  + ${w.name} (${w.branch}) is new`);
      continue;
    }
    const changed = watched.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(w[k]));
    if (changed.length > 0) {
      lines.push(`  ~ ${w.name}: ${changed.map((k) => describeField(w.name, k, prev[k], w[k])).join(', ')}`);
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
