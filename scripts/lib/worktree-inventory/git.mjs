/**
 * Git-side facts about every worktree: which branch it holds, how far it has
 * drifted from `main`, whether that branch is already on `main`, and what the
 * working tree holds that no commit does.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE INVENTORY
 * ----------------------------------------------
 * Everything here is a fact git can be asked for directly, so it is cheap,
 * exact, and reproducible. The judgement — what those facts MEAN, whether a
 * worktree is safe to delete, what a branch was for — lives in `classify.mjs`
 * and in `curated.mjs`. Keeping the split is what lets the mechanical part be
 * regenerated on every run and the human part be edited by hand without the
 * next run throwing it away.
 *
 * THE FACT THAT MATTERS MOST
 * --------------------------
 * "0 commits ahead of main" is NOT evidence that a worktree is disposable.
 * A branch created from main and never committed to reports 0 ahead and is an
 * ancestor of main, while its working tree can hold hours of unsaved work that
 * exists on no ref at all. This repository has 12 such worktrees. `HANDOFF.md`
 * calls this out under "Worktree hygiene" and it is the single most expensive
 * mistake available here, so `prunable` below is deliberately conservative: it
 * is never derived from ahead/behind alone.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';

/**
 * Run git in `cwd` and return stdout with trailing newlines removed.
 *
 * NOT `.trim()`. `git status --porcelain` pads the status column with a
 * leading space (`" M src/x.ts"`), and `.trim()` strips it from the first
 * line, so the caller's `slice(3)` then drops the first character of the first
 * path. That produced 26 unresolvable paths across 20 worktrees in the first
 * generated file — silently wrong rather than absent, which is the worst
 * failure mode for a list whose purpose is "what would be lost".
 * Leading whitespace is data here; only the trailing newline is not.
 */
function git(cwd, args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\n+$/, '');
  } catch {
    return fallback;
  }
}

/** `git worktree list --porcelain`, parsed into records. */
export function listWorktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']);
  if (out === null) throw new Error('git worktree list failed; is this a git repository?');

  const worktrees = [];
  let current = null;

  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ') && current) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line.startsWith('detached') && current) {
      current.detached = true;
    } else if (line.startsWith('bare') && current) {
      current.bare = true;
    } else if (line.startsWith('locked') && current) {
      current.locked = line.slice('locked'.length).trim() || true;
    } else if (line.startsWith('prunable') && current) {
      current.prunableReason = line.slice('prunable'.length).trim() || true;
    }
  }
  if (current) worktrees.push(current);

  return worktrees.map((w) => ({
    ...w,
    name: basename(w.path),
    branch: w.detached ? '(detached)' : (w.branch ?? '(unknown)'),
  }));
}

/**
 * Ahead/behind of a worktree's HEAD against `base`, as `{ ahead, behind }`.
 *
 * `rev-list --left-right --count base...HEAD` prints "<left> <right>", where
 * left counts commits only the base has. That is BEHIND, and swapping the two
 * produces two plausible-looking numbers that no other gate in this repository
 * would catch. It is exported through `__testables` and pinned by a test that
 * builds a real repository with a known shape and asserts the mapping — the
 * assertion this comment used to claim and did not have.
 */
function aheadBehind(cwd, base) {
  const out = git(cwd, ['rev-list', '--left-right', '--count', `${base}...HEAD`]);
  if (out === null) return { ahead: null, behind: null };

  const [behind, ahead] = out.split(/\s+/).map((n) => Number.parseInt(n, 10));
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return { ahead: null, behind: null };
  return { ahead, behind };
}

/** True when HEAD is reachable from `base`, i.e. the branch is already landed. */
function isMergedInto(cwd, base) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', base], {
      cwd,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything the working tree holds that no commit does.
 *
 * Split into modified vs untracked because they are recovered differently: a
 * modified file is `git diff` away from a commit, an untracked file is on no
 * ref at all and is destroyed by `git worktree remove --force`.
 */
function workingTreeState(cwd) {
  const out = git(cwd, ['status', '--porcelain']);
  if (out === null) return { modified: 0, untracked: 0, paths: [] };

  const paths = [];
  let modified = 0;
  let untracked = 0;

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    paths.push(line.slice(3));
    if (line.startsWith('??')) untracked += 1;
    else modified += 1;
  }

  return { modified, untracked, paths };
}

/** Subject line and dates of the branch's tip commit. */
function tipCommit(cwd) {
  const out = git(cwd, ['log', '-1', '--format=%H%x1f%s%x1f%cI%x1f%an']);
  if (out === null) return null;

  const [sha, subject, date, author] = out.split('\x1f');
  return { sha, subject, date, author };
}

/**
 * Commit subjects on the branch that `base` does not have, newest first.
 *
 * Capped, and the cap is REPORTED. A tool whose job is "what would be lost"
 * must not silently show 20 of 24 commits: `truncated` is derived from the
 * real ahead count, so a reader can tell a complete list from a sample.
 */
function commitsAhead(cwd, base, ahead, limit = 20) {
  const out = git(cwd, ['log', `${base}..HEAD`, '--format=%h%x1f%s%x1f%cI', `-n${limit}`]);
  const list =
    out === null || !out
      ? []
      : out
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [sha, subject, date] = line.split('\x1f');
            return { sha, subject, date };
          });

  return { commits: list, truncated: typeof ahead === 'number' && ahead > list.length };
}

/**
 * Would merging this worktree's HEAD into `base` conflict?
 *
 * Answers the only question that decides whether a branch is "waiting to be
 * merged" or "genuinely stuck": does the merge apply cleanly right now, against
 * main as it stands today? `git merge-tree --write-tree` does that in a scratch
 * object store and never touches a working tree, an index, or a ref — which is
 * why it is safe to run across every worktree from a generator.
 *
 * It writes unreachable tree objects into the repository's real object store
 * (measured: a full 69-worktree run adds none that `git fsck` can see), so the
 * claim that matters is the one this function makes: it touches no working
 * tree, no index and no ref. That is what lets the generator run it across
 * every worktree safely.
 *
 * Returns `{ conflict }` where `conflict` is `true`, `false`, or `null` when
 * the question could not be answered. `null` is NOT `false`: an unknown answer
 * must not be reported as a clean merge, because "no conflicts" is a licence to
 * land and a wrong licence is how a branch breaks main.
 */
export function mergeConflict(cwd, base) {
  try {
    // On a conflict git writes the conflicted-file list AND the human-readable
    // `CONFLICT (…): Merge conflict in <path>` line to STDOUT (stderr stays
    // empty); on a clean merge stdout is just a tree oid. The exit code is
    // non-zero on conflict, but it is also non-zero for an unresolvable ref, so
    // the marker is checked too and a non-conflict failure degrades to `null`.
    const result = spawnSync('git', ['merge-tree', '--write-tree', base, 'HEAD'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    // A newline between them, so `/^CONFLICT/m` cannot be defeated by a
    // git that omits the trailing newline on stdout.
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (/^CONFLICT/m.test(combined) || /CONFLICT \(/.test(combined)) {
      // Name the files. "This branch conflicts" is a flag somebody has to go
      // and investigate; "it conflicts in agent-board.mjs and db.mjs" is the
      // work. The list is the same information git already printed, and 31 of
      // the 42 clean unmerged branches here conflict, so this is the answer
      // most readers actually came for.
      const files = [...combined.matchAll(/^CONFLICT \([^)]*\): Merge conflict in (.+)$/gm)].map((m) => m[1].trim());
      return { conflict: true, files: [...new Set(files)] };
    }

    if (result.status === 0) return { conflict: false, files: [] };

    // Non-zero without a conflict marker: the merge could not be attempted.
    // `result.error` is where a spawn failure puts the cause; `stderr` is
    // empty in that case, which is how this once reported a bare
    // "merge-tree failed" for a worktree whose directory had been deleted.
    const detail = (result.stderr || '').trim().split('\n')[0] || result.error?.message || 'merge-tree failed';
    return { conflict: null, files: [], reason: detail };
  } catch (err) {
    return { conflict: null, reason: err.message };
  }
}

/**
 * Collect every mechanical fact for every worktree.
 *
 * `base` is the branch the inventory measures against — `main` by default.
 * The main worktree is included and flagged, because "which worktrees exist"
 * is a question about the whole repository and a reader counting the entries
 * against `git worktree list` must not come up one short.
 */
export function collectWorktrees(cwd, { base = 'main' } = {}) {
  const root = resolve(cwd);
  const worktrees = listWorktrees(root);

  return worktrees.map((w) => {
    const { ahead, behind } = aheadBehind(w.path, base);
    const tree = workingTreeState(w.path);
    const unmerged = typeof ahead === 'number' && ahead > 0;

    return {
      ...w,
      isPrimary: w.path === root,
      tip: tipCommit(w.path),
      ahead,
      behind,
      mergedIntoBase: isMergedInto(w.path, base),
      workingTree: tree,
      ...commitsAhead(w.path, base, ahead),
      // Only worth asking when there is something to merge. Asking about a
      // branch that is already on main, or a detached HEAD, produces a
      // meaningless answer that would be read as a real one.
      merge: unmerged ? mergeConflict(w.path, base) : { conflict: null },
    };
  });
}

/**
 * Worktrees that `git worktree list` still reports but whose directory is gone.
 *
 * `git worktree prune` clears these. They are surfaced rather than silently
 * repaired because a stale admin entry is evidence that something removed a
 * directory out from under git, and that is a fact worth seeing.
 */
export function findMissingWorktrees(cwd) {
  return listWorktrees(cwd).filter((w) => !existsSync(w.path));
}

export const __testables = { aheadBehind, workingTreeState, tipCommit, isMergedInto, commitsAhead };
