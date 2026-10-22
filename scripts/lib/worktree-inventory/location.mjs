/**
 * The single canonical resolver for where `WORKTREES.json` lives and what the
 * repository root is for worktree containment. Shared by the inventory
 * generator, the disposer, and orphan-directory resolution so that every
 * reader and writer of the inventory agree on the same path.
 *
 * WHY THIS IS A SEPARATE MODULE
 * ------------------------------
 * The generator's `repoRoot()` and the disposer's `locateInventory()`
 * previously each parsed `git worktree list --porcelain` with their own logic.
 * The generator took the FIRST entry; the disposer searched for the entry whose
 * branch was `refs/heads/main`. When the primary (first-listed) checkout is on
 * a branch other than `main` and `main` is a linked worktree, the two
 * resolutions disagree: the generator writes `<primary>/WORKTREES.json` while
 * the disposer reads `<linked-main>/WORKTREES.json`, and a stale or absent copy
 * can silently authorize a disposal.
 *
 * This module makes the resolver a single function called by all three call
 * sites, so disagreement is impossible by construction.
 *
 * THE TWO ROOTS, AND WHY THEY DIFFER
 * ----------------------------------
 * `inventoryRoot` — where `WORKTREES.json` lives and is written. When `main`
 * is registered as a linked worktree, this is that worktree's checkout path;
 * when `main` is the primary checkout, it is that checkout's path. The
 * generator and disposer both use this.
 *
 * `repositoryRoot` — the primary checkout path from Git's worktree roster (or
 * the bare repository path when the primary entry is bare). This anchors
 * repository-owned paths such as `.kilo/worktrees/`.
 * It is deliberately distinct from `inventoryRoot`: when `main` is linked
 * under `.kilo/worktrees/main`, using that linked checkout as the storage root
 * would incorrectly look for nested worktrees inside it.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

/** Default git runner: `execFileSync('git', args, { cwd })` returning `{ stdout }`. */
export function defaultRun(cwd, args) {
  return {
    stdout: execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  };
}

/**
 * Parse `git worktree list --porcelain` output into records.
 *
 * Each record carries:
 * - `path` — the checkout directory.
 * - `branch` — the short branch name (e.g. `"main"`), or `"(detached)"` when the
 *   worktree has no branch, or `"(unknown)"` when the listing is incomplete.
 * - `bare` — true for a bare repository entry.
 *
 * Splitting on blank-line boundaries (not newlines) is deliberate: the porcelain
 * format separates each worktree with a blank line, and entries can contain
 * trailing fields or continuation lines that a naive newline split would
 * fragment incorrectly.
 */
export function parseWorktreeListing(porcelain) {
  const records = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const record = { path: null, branch: '(unknown)', bare: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        record.path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ') && record.path) {
        record.branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line.startsWith('detached') && record.path) {
        record.branch = '(detached)';
      } else if (line.startsWith('bare') && record.path) {
        record.bare = true;
      }
    }
    if (record.path) records.push(record);
  }
  return records;
}

/**
 * Resolve the path of the single non-bare `refs/heads/main` worktree.
 *
 * Returns the realpath of that worktree's checkout directory, or `null` when:
 * - git cannot be run (not a repository, git missing),
 * - there is no `main` worktree,
 * - there is more than one `main` worktree (ambiguous),
 * - the main worktree is bare,
 * - its path does not exist on disk.
 *
 * `null` is a fail-closed refusal, not a guess: a caller that cannot name the
 * main checkout must not pick an arbitrary worktree and pretend it is canonical.
 */
function readWorktreeRoster(cwd, { run = defaultRun, parse = parseWorktreeListing } = {}) {
  let porcelain;
  try {
    porcelain = run(cwd, ['worktree', 'list', '--porcelain']).stdout;
  } catch {
    return { listingAvailable: false, worktrees: [] };
  }
  return { listingAvailable: true, worktrees: parse(porcelain) };
}

function resolveMainFromWorktrees(worktrees, realpath = realpathSync) {
  const mains = worktrees.filter((w) => !w.bare && w.branch === 'main');

  if (mains.length !== 1) return { registered: mains.length > 0, root: null };

  try {
    return { registered: true, root: realpath(mains[0].path) };
  } catch {
    return { registered: true, root: null };
  }
}

function resolvePrimaryFromWorktrees(worktrees, realpath = realpathSync) {
  const primary = worktrees[0];
  if (!primary?.path) return null;
  try {
    return realpath(primary.path);
  } catch {
    return null;
  }
}

function inspectMainWorktree(cwd, options = {}) {
  const roster = readWorktreeRoster(cwd, options);
  if (!roster.listingAvailable) return { ...roster, registered: false, root: null };
  return { ...roster, ...resolveMainFromWorktrees(roster.worktrees, options.realpath ?? realpathSync) };
}

export function resolveMainWorktreeRoot(cwd, options = {}) {
  return inspectMainWorktree(cwd, options).root;
}

/**
 * Resolve the primary checkout path from Git's worktree roster.
 *
 * Common-directory names do not distinguish checkout roots from metadata
 * directories: `--separate-git-dir` and submodules can put the common directory
 * anywhere. Git lists the primary worktree first, including for linked
 * worktrees. A bare repository's sole primary entry is itself the root.
 *
 * Returns `null` when Git cannot provide a usable roster or the primary path
 * cannot be resolved.
 */
function inspectPrimaryWorktree(cwd, options = {}) {
  const roster = readWorktreeRoster(cwd, options);
  if (!roster.listingAvailable) return null;
  return resolvePrimaryFromWorktrees(roster.worktrees, options.realpath ?? realpathSync);
}

/**
 * Resolve the canonical repository root, accepting injectable `run`, `parse`,
 * and `realpath` functions so tests can use a synthetic roster without touching
 * Git or the filesystem.
 */
export function resolveRepositoryRoot(cwd, options = {}) {
  // Git's roster names the primary checkout directly, even when its metadata
  // directory is external or belongs to a submodule. The main checkout path is
  // for the inventory only.
  return inspectPrimaryWorktree(cwd, options);
}

/**
 * Resolve where `WORKTREES.json` should be read from / written to.
 *
 * This is `join(inventoryRoot, 'WORKTREES.json')` where `inventoryRoot` is the
 * main worktree's checkout. The repository root is used only when the worktree
 * roster was read successfully and confirms there is no registered `main`
 * worktree (for example, a bare repository). If the roster is unreadable, or a
 * registered main checkout is missing or ambiguous, resolution fails closed;
 * it must not fall back to a possibly stale copy in another checkout.
 *
 * Returns `null` only when no repository can be identified at all (the caller is
 * outside any git repository). Even when the file does not yet exist at the
 * canonical path, the path itself is returned so that `readInventory` can refuse
 * with "missing" rather than silently falling back to a stale task-local copy.
 */
export function resolveInventoryPath(cwd, options = {}) {
  const roster = readWorktreeRoster(cwd, options);
  if (!roster.listingAvailable) return null;

  const main = resolveMainFromWorktrees(roster.worktrees, options.realpath ?? realpathSync);
  if (main.root) return join(main.root, 'WORKTREES.json');
  if (main.registered) return null;

  const root = resolvePrimaryFromWorktrees(roster.worktrees, options.realpath ?? realpathSync);
  if (!root) return null;
  return join(root, 'WORKTREES.json');
}
