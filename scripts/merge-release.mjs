#!/usr/bin/env node
/**
 * Release claims and locks only for a clean worktree newly merged into the base branch.
 *
 * WHY A MERGE IS THE RIGHT TRIGGER
 * --------------------------------
 * A chat that has merged its branch to main and then stopped leaves its claims and file
 * locks behind, because nothing else ever took them back. They are leases, so they do
 * expire — but the expiry is measured in hours, and in the meantime every other agent is
 * refused the files that work actually finished on. The symptom is a board that reports a
 * file held by a task that no longer exists, and no command that will say so.
 *
 * A merge identifies the work whose claim is now complete, but a later merge must not
 * sweep every older branch already on main. The hook therefore runs only on the base
 * branch and considers branches added since this exact base transition. `ORIG_HEAD` must
 * agree with the base branch reflog; if either is stale or unavailable, the transition is
 * reported as unproven and nothing is released. Each branch is checked against the single
 * base-tip snapshot captured before the sweep, so another landing cannot widen this pass.
 * Board heartbeat age is not used: a quiet editor can be live without running a swarm command.
 *
 * WHY IT NEVER USES `--force`
 * ---------------------------
 * The repo's rule is that a sweep may reclaim what lapsed but may NOT take a file from an
 * agent that is still writing — only the operator stops a chat (the `releaseFiles()` policy,
 * enforced by withholding `force`). This script enumerates only claims and locks owned by
 * the newly merged branch. A different identity's row is refused by the board.
 *
 * So nothing is forced. Each release is made as the MERGED BRANCH'S OWN IDENTITY, which is
 * the same string the board already keys on (identity is the branch,
 * not a session or a pid). Releasing as the owner needs no force at all, and a claim held
 * by a DIFFERENT agent is refused rather than taken (the holder check in `releaseFiles()`).
 *
 * THE LOAD-BEARING PART IS THE ENUMERATION, NOT THE ABSENCE OF `force`, and the difference
 * is worth being exact about because the two are easy to confuse. Adding `force: true` to
 * the two release calls below does NOT make this unsafe: it is never reached, because the
 * work being released is selected by `claimedBy: branch` and `locksHeldBy(branch)`, so a
 * row belonging to another agent is never in the list. Both facts were measured, not
 * assumed — `force: true` leaves every test here green, and only widening the enumeration
 * to `listIssues({})` and `liveLocks()` turns two of them red. That is the mutation to
 * re-run if this is ever refactored, because it is the one that reaches another agent's
 * work.
 *
 * WHAT QUALIFIES
 * --------------
 * A worktree is released only when all of these hold:
 *
 * 1. The hook is running on the base branch. `ORIG_HEAD` must match the prior base tip in
 *    that branch's reflog; otherwise each branch is reported with an unproven transition
 *    and nothing is released. A task checkout that merely fast-forwarded from main cannot
 *    sweep the board.
 * 2. The branch is an ancestor of the captured current base tip but not the previous base.
 *    This limits the sweep to work introduced by this merge and excludes a later concurrent
 *    landing. Duplicate branch checkouts are also refused because the board keys by branch.
 * 3. Its working tree is clean. A branch can be merged and then have uncommitted work
 *    added on top — a follow-up fix on the same branch — and that work is NOT on main.
 * 4. Its directory still exists. A registration whose directory is gone has nothing to
 *    release and is `doctor`'s business, not this script's.
 *
 * Failures are REPORTED AND SWALLOWED. A merge has already happened by the time a post-merge
 * hook runs, so there is no useful way to fail one, and a hook that can block a landing is a
 * hook that will eventually stop someone landing. Every error goes to stderr and the process
 * exits 0.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { Board, resolveBoardDir } from './lib/agent-board/db.mjs';

/**
 * Run git and return trimmed stdout, or null when git could not answer.
 *
 * Null rather than a throw on every failure: a missing worktree directory, a detached HEAD
 * and a repository mid-rebase all make some `git` subcommand fail, and none of them should
 * stop a merge. The caller treats null as "not releasable", which is the safe direction.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Parsed `git worktree list --porcelain` into `{ path, branch }` records. */
function listWorktrees(repoRoot) {
  const out = git(['worktree', 'list', '--porcelain'], repoRoot);
  if (!out) return [];
  const records = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      records.push(current);
    } else if (line.startsWith('branch ') && current) {
      // `refs/heads/fix/x` -> `fix/x`, which is the form the board stores as an agent id.
      current.branch = line
        .slice('branch '.length)
        .trim()
        .replace(/^refs\/heads\//, '');
    }
  }
  return records;
}

function isAncestor(ancestor, descendant, cwd) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    stdio: 'ignore',
  });
  if (result.error || result.signal || result.status === null) return null;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  return null;
}

function previousBaseForMerge(repoRoot, base, baseTip) {
  const recordedPreviousBase = git(['rev-parse', '--verify', '--end-of-options', 'ORIG_HEAD^{commit}'], repoRoot);
  const reflogPreviousBase = git(['rev-parse', '--verify', '--end-of-options', `${base}@{1}^{commit}`], repoRoot);
  if (
    !recordedPreviousBase ||
    recordedPreviousBase !== reflogPreviousBase ||
    isAncestor(recordedPreviousBase, baseTip, repoRoot) !== true
  ) {
    return null;
  }
  return recordedPreviousBase;
}

/**
 * Why this worktree is or is not releasable. Null means releasable.
 *
 * Returns `{ code, message }` rather than the message alone, because the message is
 * prose with the branch and the base interpolated into it — which is right for a human
 * and useless for counting. A repository with thirty worktrees has a different message
 * for every one of them, so a report that grouped on the string printed thirty lines
 * where four would do. `code` is the stable half, and it is what `formatReport` buckets on.
 */
export function releaseBlocker({
  worktreePath,
  branch,
  base,
  dirtyOutput = null,
  exists = true,
  previousBase = null,
  currentBase = base,
  duplicateBranch = false,
}) {
  if (!exists) return { code: 'directory-gone', message: 'the worktree directory is gone' };
  if (!branch) {
    return { code: 'detached', message: 'HEAD is detached, so there is no branch to have merged' };
  }
  if (branch === base) return { code: 'base-branch', message: 'this is the base branch itself' };
  if (duplicateBranch) {
    return { code: 'duplicate-branch-worktree', message: `${branch} is checked out in multiple worktrees` };
  }
  const merged = isAncestor(branch, currentBase, worktreePath);
  if (merged === null) {
    return { code: 'ancestry-unreadable', message: `Git could not verify whether ${branch} is on ${base}` };
  }
  if (!merged) {
    return { code: 'not-on-base', message: `${branch} is not on ${base} yet` };
  }
  if (typeof dirtyOutput !== 'string') {
    return { code: 'status-unreadable', message: `${branch} working-tree status could not be read` };
  }
  if (dirtyOutput !== '') {
    return { code: 'dirty', message: `${branch} is on ${base} but its working tree is dirty` };
  }
  if (!previousBase) {
    return { code: 'base-transition-unproven', message: `the previous ${base} tip could not be established` };
  }
  const wasOnPreviousBase = isAncestor(branch, previousBase, worktreePath);
  if (wasOnPreviousBase === null) {
    return {
      code: 'previous-ancestry-unreadable',
      message: `Git could not verify whether ${branch} was already on ${base}`,
    };
  }
  if (wasOnPreviousBase)
    return { code: 'already-on-base', message: `${branch} was already on ${base} before this merge` };
  return null;
}

/** `git status --porcelain` for a worktree, or null when git could not answer. */
function dirtyState(worktreePath) {
  return git(['status', '--porcelain'], worktreePath);
}

/**
 * Release one worktree's claims and locks, as that branch.
 *
 * Returns a record of what was released, or `{ skipped }` with the reason it was not
 * eligible. It never throws: a claim held by another agent is left alone by the board's
 * own check, and that is a refusal rather than an error.
 */
export function releaseWorktree(
  board,
  { worktreePath, branch, base, currentBase = base, dryRun = false, previousBase = null, duplicateBranch = false }
) {
  const dirty = dirtyState(worktreePath);
  const blocker = releaseBlocker({
    worktreePath,
    branch,
    base,
    currentBase,
    dirtyOutput: dirty,
    previousBase,
    duplicateBranch,
  });

  // Queried even when a blocker stopped the release, because "was NOT released" is only
  // actionable when the reader can see what is still being held. Without it the skip was
  // bare, and the case that matters most was indistinguishable from the case that does
  // not: a branch landed by SQUASH merge can never satisfy `--is-ancestor`, so it reports
  // `not on main yet` forever while its locks go on blocking other agents — and the
  // output said nothing at all about it.
  //
  // Guarded on `branch`, not just on the blocker: `listIssues` treats a falsy `claimedBy`
  // as "no filter" (its own parameter default), so asking for a detached HEAD's holdings would name
  // every claim on the board as that worktree's.
  const claims = branch ? board.listIssues({ claimedBy: branch }) : [];
  const locks = branch ? board.locksHeldBy(branch) : [];
  if (blocker) {
    return {
      worktree: path.basename(worktreePath),
      branch,
      skipped: blocker.message,
      skipCode: blocker.code,
      held: { claims: claims.map((c) => c.id), locks: locks.map((l) => l.path) },
    };
  }

  if (claims.length === 0 && locks.length === 0) {
    return {
      worktree: path.basename(worktreePath),
      branch,
      skipped: 'nothing held',
      skipCode: 'nothing-held',
    };
  }
  if (dryRun) {
    return {
      worktree: path.basename(worktreePath),
      branch,
      wouldRelease: { claims: claims.map((c) => c.id), locks: locks.map((l) => l.path) },
    };
  }

  const releasedClaims = [];
  for (const claim of claims) {
    const result = board.releaseClaim(claim.id, { agent: branch, reason: `merged into ${base}` });
    if (result.released) releasedClaims.push(claim.id);
  }
  // Released by path, as the owner, so a path another agent also holds is left with that
  // agent's row intact — `releaseFiles` skips a foreign row without force.
  const releasedLocks = [];
  for (const lock of locks) {
    const result = board.releaseFiles([lock.path], { agent: branch });
    for (const p of result.released) if (!releasedLocks.includes(p)) releasedLocks.push(p);
  }
  return { worktree: path.basename(worktreePath), branch, releasedClaims, releasedLocks };
}

/**
 * Release every eligible worktree under `repoRoot`.
 *
 * Exported separately from the CLI so a test can drive it against a temp repository with a
 * real board, rather than asserting against a hand-built stub of one.
 */
export function releaseMerged({ repoRoot = process.cwd(), base = 'main', dryRun = false, board = null } = {}) {
  const currentBranch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
  if (currentBranch !== base) {
    return [
      {
        worktree: path.basename(repoRoot),
        branch: currentBranch ?? '(detached)',
        skipped: `post-merge ran outside the ${base} branch`,
        skipCode: 'outside-base-branch',
      },
    ];
  }

  const baseTip = git(['rev-parse', `${base}^{commit}`], repoRoot);
  if (!baseTip) {
    return [
      {
        worktree: path.basename(repoRoot),
        branch: currentBranch,
        skipped: `the ${base} tip could not be read`,
        skipCode: 'base-unreadable',
      },
    ];
  }
  const previousBase = previousBaseForMerge(repoRoot, base, baseTip);

  // The board lives in the COMMON git dir, so every worktree of this repository reads the
  // same one — which is the point: a claim taken in a worktree has to be visible to the
  // merge that happens in another. `create: false` so a repository with no board is
  // reported as "nothing to release" rather than having one conjured for it; the caller
  // wraps this in a try, because a hook must not fail a merge that already happened.
  const owned = board ?? new Board({ dir: resolveBoardDir({ cwd: repoRoot }) }).open({ create: false });
  const results = [];
  const worktrees = listWorktrees(repoRoot);
  const branchCounts = new Map();
  for (const worktree of worktrees) {
    if (worktree.branch) branchCounts.set(worktree.branch, (branchCounts.get(worktree.branch) ?? 0) + 1);
  }
  for (const worktree of worktrees) {
    // Existence is checked here rather than inside `releaseWorktree` because a missing
    // directory has to be answered before `git status` is run inside it: the whole point
    // of that branch is that there is nothing left to ask.
    if (!existsSync(worktree.path)) {
      results.push({
        worktree: path.basename(worktree.path),
        branch: worktree.branch,
        skipped: 'the worktree directory is gone',
        skipCode: 'directory-gone',
      });
      continue;
    }
    results.push(
      releaseWorktree(owned, {
        worktreePath: worktree.path,
        branch: worktree.branch,
        base,
        currentBase: baseTip,
        dryRun,
        previousBase,
        duplicateBranch: Boolean(worktree.branch && branchCounts.get(worktree.branch) > 1),
      })
    );
  }
  return results;
}

/**
 * The human-readable report, as an array of lines.
 *
 * Split in two on purpose. A repository with thirty-odd worktrees produces a `skipped`
 * for nearly all of them, and `nothing held` is the normal answer rather than news — so
 * printing one line each buried the two outcomes that need a human. This names every
 * worktree that HOLDS something and was not released, with the reason, and reduces the
 * rest to counts by reason.
 *
 * Exported separately from the CLI so a test can drive it over hand-built results, which
 * is the part with the arithmetic in it.
 */
export function formatReport(results, { dryRun = false } = {}) {
  const lines = [];
  const released = results.filter((r) => !r.skipped);
  for (const r of released) {
    const what = [
      r.releasedClaims?.length ? `claims ${r.releasedClaims.join(', ')}` : null,
      r.releasedLocks?.length ? `${r.releasedLocks.length} lock(s)` : null,
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(`merge-release: ${r.branch} — ${what}`);
  }

  const skipped = results.filter((r) => r.skipped);
  const heldBack = skipped.filter((r) => (r.held?.claims.length ?? 0) + (r.held?.locks.length ?? 0) > 0);
  if (heldBack.length > 0) {
    lines.push(`merge-release: ${heldBack.length} worktree(s) still HOLD something and were NOT released:`);
    for (const r of heldBack) {
      const what = [
        r.held.claims.length ? `${r.held.claims.length} claim(s)` : null,
        r.held.locks.length ? `${r.held.locks.length} lock(s)` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`merge-release:   ${r.branch} (${r.worktree}) — ${r.skipped}; still holds ${what}`);
    }
  }

  const quiet = skipped.filter((r) => !heldBack.includes(r));
  if (quiet.length > 0) {
    // Bucketed on `skipCode`, never on `skipped`: the message interpolates the branch, so
    // every unmerged worktree carries a different one and grouping on it prints a line each.
    // `skipCode` is absent only on a row this module did not build, and those fall together.
    const byReason = new Map();
    for (const r of quiet) {
      const key = r.skipCode ?? r.skipped;
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    const summary = [...byReason].map(([reason, n]) => `${n} ${reason}`).join(', ');
    lines.push(`merge-release: ${quiet.length} skipped — ${summary}`);
  }

  lines.push(
    `merge-release: ${dryRun ? 'would release' : 'released'} ${released.length} of ${results.length} worktree(s)`
  );
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const baseArg = args.indexOf('--base');
  const base = baseArg >= 0 && args[baseArg + 1] ? args[baseArg + 1] : 'main';
  const dryRun = flag('dry-run');
  const json = flag('json');

  let results;
  try {
    results = releaseMerged({ repoRoot: process.cwd(), base, dryRun });
  } catch (err) {
    // Reported, not thrown. The merge is already recorded; refusing to finish over a
    // bookkeeping failure would be a much worse outcome than a stale lock.
    console.error(`merge-release: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return 0;
  }
  for (const line of formatReport(results, { dryRun })) console.log(line);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
