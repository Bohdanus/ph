#!/usr/bin/env node
/**
 * Release the board claims and file locks of every worktree that is now ON main.
 *
 * WHY A MERGE IS THE RIGHT TRIGGER
 * --------------------------------
 * A chat that has merged its branch to main and then stopped leaves its claims and file
 * locks behind, because nothing else ever took them back. They are leases, so they do
 * expire — but the expiry is measured in hours, and in the meantime every other agent is
 * refused the files that work actually finished on. The symptom is a board that reports a
 * file held by a task that no longer exists, and no command that will say so.
 *
 * A merge is the one event that makes the claim FALSE rather than merely old. That is why
 * the trigger is a git fact and not a timer, and it is the same class of evidence `doctor`
 * already accepts: a claim whose worktree is gone is released on that basis
 * (`db.mjs:1703`), not on a lease countdown.
 *
 * WHY IT NEVER USES `--force`
 * ---------------------------
 * The repo's rule is that a sweep may reclaim what lapsed but may NOT take a file from an
 * agent that is still writing — only the operator stops a chat (`db.mjs:1758`, enforced at
 * `:1761` by withholding `force`). `--force` skips that check on EVERY row for a path
 * (`db.mjs:1284`), so a forced release here would revoke a live agent's lock over files
 * this script never inspected.
 *
 * So nothing is forced. Each release is made as the MERGED BRANCH'S OWN IDENTITY, which is
 * the same string the board already keys on (`identity.mjs:11` — identity is the branch,
 * not a session or a pid). Releasing as the owner needs no force at all, and a claim held
 * by a DIFFERENT agent is refused rather than taken (`db.mjs:1035`). The hook can therefore
 * only ever clean up after the worktree it is looking at, never after somebody else.
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
 * A worktree is released only when all three hold, and each is a fact rather than a guess:
 *
 * 1. Its branch is an ancestor of the base (`git merge-base --is-ancestor`). The work is
 *    on main, which is the claim being made about it.
 * 2. Its working tree is clean. A branch can be merged and then have uncommitted work
 *    added on top — a follow-up fix on the same branch — and that work is NOT on main.
 * 3. Its directory still exists. A registration whose directory is gone has nothing to
 *    release and is `doctor`'s business, not this script's.
 *
 * Failures are REPORTED AND SWALLOWED. A merge has already happened by the time a post-merge
 * hook runs, so there is no useful way to fail one, and a hook that can block a landing is a
 * hook that will eventually stop someone landing. Every error goes to stderr and the process
 * exits 0.
 */

import { execFileSync } from 'node:child_process';
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

/** Why this worktree is or is not releasable. Null means releasable. */
export function releaseBlocker({ worktreePath, branch, base, dirtyOutput, exists = true }) {
  if (!exists) return 'the worktree directory is gone';
  if (!branch) return 'HEAD is detached, so there is no branch to have merged';
  if (branch === base) return 'this is the base branch itself';
  // `git merge-base --is-ancestor` exits 0 for yes and 1 for no, so the boolean is the
  // exit code rather than stdout.
  const merged = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', branch, base], {
        cwd: worktreePath,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  })();
  if (!merged) return `${branch} is not on ${base} yet`;
  if (dirtyOutput) return `${branch} is on ${base} but its working tree is dirty`;
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
export function releaseWorktree(board, { worktreePath, branch, base, dryRun = false }) {
  const dirty = dirtyState(worktreePath);
  const blocker = releaseBlocker({
    worktreePath,
    branch,
    base,
    dirtyOutput: dirty === null ? null : dirty !== '',
  });
  if (blocker) return { worktree: path.basename(worktreePath), branch, skipped: blocker };

  const claims = board.listIssues({ claimedBy: branch });
  const locks = board.locksHeldBy(branch);
  if (claims.length === 0 && locks.length === 0) {
    return { worktree: path.basename(worktreePath), branch, skipped: 'nothing held' };
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
  // The board lives in the COMMON git dir, so every worktree of this repository reads the
  // same one — which is the point: a claim taken in a worktree has to be visible to the
  // merge that happens in another. `create: false` so a repository with no board is
  // reported as "nothing to release" rather than having one conjured for it; the caller
  // wraps this in a try, because a hook must not fail a merge that already happened.
  const owned = board ?? new Board({ dir: resolveBoardDir({ cwd: repoRoot }) }).open({ create: false });
  const results = [];
  for (const worktree of listWorktrees(repoRoot)) {
    // Existence is checked here rather than inside `releaseWorktree` because a missing
    // directory has to be answered before `git status` is run inside it: the whole point
    // of that branch is that there is nothing left to ask.
    if (!existsSync(worktree.path)) {
      results.push({
        worktree: path.basename(worktree.path),
        branch: worktree.branch,
        skipped: 'the worktree directory is gone',
      });
      continue;
    }
    results.push(
      releaseWorktree(owned, {
        worktreePath: worktree.path,
        branch: worktree.branch,
        base,
        dryRun,
      })
    );
  }
  return results;
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
  const released = results.filter((r) => !r.skipped);
  for (const r of results) {
    if (r.skipped) continue;
    const what = [
      r.releasedClaims?.length ? `claims ${r.releasedClaims.join(', ')}` : null,
      r.releasedLocks?.length ? `${r.releasedLocks.length} lock(s)` : null,
    ]
      .filter(Boolean)
      .join(', ');
    console.log(`merge-release: ${r.branch} — ${what}`);
  }
  console.log(
    `merge-release: ${dryRun ? 'would release' : 'released'} ${released.length} of ${results.length} worktree(s)`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
