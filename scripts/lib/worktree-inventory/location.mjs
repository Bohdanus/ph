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
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { samePath } from '../path-identity.mjs';

const MAIN_WORKTREE_GIT_DIR_KEY = 'ph.mainWorktreeGitDir';
const MAIN_WORKTREE_PATH_KEY = 'ph.mainWorktreePath';
const MAIN_WORKTREE_ID_KEY = 'ph.mainWorktreeIdentity';
const MAIN_WORKTREE_ID_FILENAME = 'kilo-main-worktree-identity';

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
      } else if (line.startsWith('prunable') && record.path) {
        record.prunableReason = line.slice('prunable'.length).trim() || true;
      }
    }
    if (record.path) records.push(record);
  }
  return records;
}

/**
 * Resolve the designated main checkout, including a forced recovery replacement.
 *
 * A registered main-worktree identity selects one checkout when recovery leaves
 * the damaged `main` checkout in place. Without registration, only one
 * non-bare `refs/heads/main` worktree can be selected safely. Return its
 * realpath, or `null` when:
 * - git cannot be run (not a repository, git missing),
 * - there is no verifiable designated main checkout,
 * - multiple main worktrees exist without a valid registered identity,
 * - the main worktree is bare,
 * - its entry is prunable, its path does not exist, or the path now belongs to a
 *   different repository or branch.
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

function resolveRegisteredMain(
  cwd,
  worktrees,
  { run = defaultRun, realpath = realpathSync, readFile = readFileSync } = {}
) {
  const configValue = (key) => {
    try {
      return { present: true, value: run(cwd, ['config', '--local', '--get', key]).stdout.trim() };
    } catch (error) {
      // Git config --get uses status 1 for a missing key. Other failures mean
      // registration could not be read, not that no registration exists.
      if (error?.status !== 1) return { present: true, value: null };
      return { present: false, value: null };
    }
  };
  const registeredGitDirConfig = configValue(MAIN_WORKTREE_GIT_DIR_KEY);
  const registeredPathConfig = configValue(MAIN_WORKTREE_PATH_KEY);
  const registeredIdentityConfig = configValue(MAIN_WORKTREE_ID_KEY);
  const registeredGitDirValue = registeredGitDirConfig.value;
  const registeredPathValue = registeredPathConfig.value;
  const registeredIdentity = registeredIdentityConfig.value;
  const hasRegistration =
    registeredGitDirConfig.present || registeredPathConfig.present || registeredIdentityConfig.present;
  if (!hasRegistration) return { registered: false, root: null };
  // A partial saved identity can be the residue of interrupted recovery. Do not
  // choose a different branch checkout until the designated path is repaired.
  if (
    !registeredGitDirConfig.present ||
    !registeredPathConfig.present ||
    !registeredIdentityConfig.present ||
    !registeredGitDirValue ||
    !registeredPathValue ||
    !registeredIdentity
  ) {
    return { registered: true, root: null };
  }

  try {
    if (!isAbsolute(registeredGitDirValue) || !isAbsolute(registeredPathValue)) {
      return { registered: true, root: null };
    }
    const registeredGitDir = realpath(resolve(cwd, registeredGitDirValue));
    const registeredPath = realpath(resolve(cwd, registeredPathValue));
    const matching = worktrees.filter((worktree) => {
      if (worktree.bare || worktree.prunableReason) return false;
      try {
        return samePath(realpath(worktree.path), registeredPath);
      } catch {
        return false;
      }
    });
    if (matching.length !== 1) return { registered: true, root: null };

    const root = realpath(matching[0].path);
    const repositoryCommonDir = realpath(
      run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    const mainCommonDir = realpath(
      run(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    const mainGitDir = realpath(run(root, ['rev-parse', '--absolute-git-dir']).stdout.trim());
    let mainBranch = null;
    try {
      mainBranch = run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim();
    } catch (error) {
      // A detached designated main checkout remains identifiable by its private marker.
      if (error?.status !== 1) return { registered: true, root: null };
    }
    if (
      !samePath(mainCommonDir, repositoryCommonDir) ||
      !samePath(mainGitDir, registeredGitDir) ||
      !['main', null].includes(mainBranch)
    ) {
      return { registered: true, root: null };
    }
    const identity = readFile(join(mainGitDir, MAIN_WORKTREE_ID_FILENAME), 'utf8').trim();
    if (identity !== registeredIdentity) return { registered: true, root: null };
    return { registered: true, root };
  } catch {
    return { registered: true, root: null };
  }
}

function resolveMainFromWorktrees(cwd, worktrees, options = {}) {
  const designated = resolveRegisteredMain(cwd, worktrees, options);
  if (designated.registered) return designated;

  const { run = defaultRun, realpath = realpathSync } = options;
  const registeredMains = worktrees.filter((w) => !w.bare && w.branch === 'main');
  const mains = registeredMains.filter((w) => !w.prunableReason);

  if (registeredMains.length === 0 || mains.length !== 1) {
    return { registered: registeredMains.length > 0, root: null };
  }

  try {
    const root = realpath(mains[0].path);
    const repositoryCommonDir = realpath(
      run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    const mainCommonDir = realpath(
      run(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    const mainBranch = run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim();
    if (mainBranch !== 'main' || !samePath(mainCommonDir, repositoryCommonDir)) {
      return { registered: true, root: null };
    }
    return { registered: true, root };
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
  return { ...roster, ...resolveMainFromWorktrees(cwd, roster.worktrees, options) };
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
 * registered main checkout is missing, ambiguous, or no longer belongs to this
 * repository, resolution fails closed; it must not fall back to a possibly stale
 * copy in another checkout.
 *
 * Returns `null` only when no repository can be identified at all (the caller is
 * outside any git repository). Even when the file does not yet exist at the
 * canonical path, the path itself is returned so that `readInventory` can refuse
 * with "missing" rather than silently falling back to a stale task-local copy.
 */
export function resolveInventoryPath(cwd, options = {}) {
  const roster = readWorktreeRoster(cwd, options);
  if (!roster.listingAvailable) return null;

  const main = resolveMainFromWorktrees(cwd, roster.worktrees, options);
  if (main.root) return join(main.root, 'WORKTREES.json');
  if (main.registered) return null;

  const root = resolvePrimaryFromWorktrees(roster.worktrees, options.realpath ?? realpathSync);
  if (!root) return null;
  return join(root, 'WORKTREES.json');
}
