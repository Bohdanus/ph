/**
 * Links the tsc guard into `node_modules/.bin`, so a typecheck that checks
 * nothing cannot report success.
 * -----------------------------------------------------------------------
 * Runs from `npm install` through the `prepare` script, alongside
 * `install-git-hooks.js`. Idempotent, safe to run by hand, and deliberately
 * unable to fail an install — a tarball build outside a git checkout, or a
 * production install with no TypeScript, prints a line and exits 0.
 *
 * WHAT IT DOES
 * ------------
 * `node_modules/.bin/tsc` is npm's symlink to `typescript/bin/tsc`. This
 * replaces it with a symlink to `scripts/tsc-guard.mjs`, which refuses to run
 * without build mode and hands off to the real compiler when build mode is
 * present. Every spelling of `tsc` resolves through that one file.
 *
 * WHY A SYMLINK AND NOT A GENERATED FILE
 * --------------------------------------
 * A generated copy of the decision logic would be a second implementation of
 * the rules, and this repository has already been bitten by exactly that shape
 * (`e2e/global-setup.ts` records a deleted unreachable branch as "a second code
 * path a reader has to verify"). The link points at the real, reviewed file.
 *
 * WHY `prepare` IS NOT ENOUGH ON ITS OWN
 * --------------------------------------
 * npm links bins from inside `reify`, and for a direct dependency it always
 * passes `force: true` to `linkGently`, which `rm`s whatever is sitting at the
 * bin path. So a command that reifies can delete this link, and only `install`
 * and `ci` re-run `prepare` afterwards.
 *
 * `npm rebuild` is the one measured end to end: the link flips back to npm's
 * plain symlink, and `npm install` puts the guard back. `update`, `dedupe`,
 * `prune` and `audit fix` all call the same code path and are expected to behave
 * the same way, but they were NOT each measured — an audit found `dedupe` and
 * `prune` did not actually clobber, so treat the enumeration as the risk surface
 * rather than as a list of observations. It does not matter which of them is
 * right, because the shim cannot be made un-removeable inside `node_modules` and
 * the answer does not depend on the answer.
 *
 * A shim cannot be made un-removeable inside node_modules, so this does not
 * pretend otherwise. The defence is that the absence is LOUD rather than
 * invisible: `scripts/__tests__/tsc-guard.test.mjs` resolves the same link
 * npm would resolve and fails when it is the wrong file, so a worktree whose
 * guard was clobbered reports a red test rather than a false green. That is the
 * same stance `install-git-hooks.js` takes on a missing hook — a gate that
 * cannot run must not let a commit through.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root, from this file's own location — never `process.cwd()`. */
const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/** Where npm puts the executable it links for every bin field. */
const BIN_DIR = path.join(REPO_ROOT, 'node_modules', '.bin');

/** The link this script manages, and the file it must point at. */
const LINK = path.join(BIN_DIR, 'tsc');

/** Built here first, then renamed onto LINK, so LINK is never absent. */
const TEMP_LINK = path.join(BIN_DIR, '.tsc-guard.tmp');
const TARGET = path.join(REPO_ROOT, 'scripts', 'tsc-guard.mjs');

/** The real compiler. Its absence is the "no TypeScript installed" case. */
const REAL_COMPILER = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * Whether the link is already the guard.
 *
 * Compares the link's own target, not its contents, so a stub that merely
 * mentions the guard still counts as wrong. `lstatSync` first because a plain
 * npm symlink and a real file are both valid things to find here, and only the
 * link is a link.
 */
function alreadyGuarded() {
  try {
    if (!lstatSync(LINK).isSymbolicLink()) return false;
    return path.resolve(BIN_DIR, readlinkSync(LINK)) === TARGET;
  } catch {
    return false;
  }
}

/**
 * Whether the link resolves to a FILE, following it.
 *
 * `isFile()` rather than `existsSync`, because a directory called `tsc` also
 * satisfies `existsSync` and would read as installed. The predicate is copied
 * from npm's own: `libnpmexec` decides a bin exists with `stat().isFile()`, so
 * a DANGLING link is invisible to `npx` and it reaches the registry for a
 * package named `tsc` — worse than either a working guard or an honest absence.
 */
function resolvesToAFile() {
  try {
    return statSync(LINK).isFile();
  } catch {
    return false;
  }
}

export function install() {
  if (!existsSync(TARGET)) {
    return { installed: false, reason: 'scripts/tsc-guard.mjs is not in this checkout' };
  }
  if (!existsSync(REAL_COMPILER)) {
    // A production install, or one that has not run yet. There is no `tsc` to
    // guard, and inventing a bin entry for a missing compiler would break it.
    return { installed: false, reason: 'TypeScript is not installed here' };
  }
  if (!existsSync(BIN_DIR)) {
    return { installed: false, reason: 'node_modules/.bin does not exist here' };
  }
  if (alreadyGuarded() && resolvesToAFile()) {
    return { installed: true, changed: false };
  }

  // Built at a temporary name and renamed into place, NOT removed and recreated.
  // An `rm` followed by a `symlink` has a window in which a failure — Windows
  // without symlink privileges raises EPERM — leaves the checkout with no `tsc`
  // at all, which `npx` answers by fetching a package named `tsc` from the
  // registry. A rename cannot lose the old link, so the guard can only ever be
  // replaced by a working one.
  rmSync(TEMP_LINK, { force: true });
  symlinkSync(path.relative(BIN_DIR, TARGET), TEMP_LINK);
  renameSync(TEMP_LINK, LINK);
  chmodSync(TARGET, 0o755);

  if (!resolvesToAFile()) {
    // A link that does not resolve is worse than none: `npx` decides a bin
    // exists with `stat().isFile()`, so it would skip this and reach the
    // registry. Put npm's own link back rather than leaving either hole.
    rmSync(TEMP_LINK, { force: true });
    restoreNpmLink();
    return { installed: false, reason: "the link did not resolve, so npm's own link was restored" };
  }
  return { installed: true, changed: true };
}

/**
 * Puts npm's plain symlink back, for the case where this script cannot install
 * its own and must not leave the bin entry missing.
 */
function restoreNpmLink() {
  const npmTarget = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(npmTarget)) return;
  rmSync(LINK, { force: true });
  symlinkSync(path.relative(BIN_DIR, npmTarget), LINK);
}

/**
 * Prints the outcome instead of asserting success.
 *
 * An install that prints nothing about a guard it could not install reads as an
 * install that had no guard requirement, which is the same silent absence this
 * whole mechanism exists to end.
 */
function main() {
  let result;
  try {
    result = install();
  } catch (error) {
    // Deliberately swallowed. A prepare script that throws fails `npm install`
    // for everyone, including the case where the tree is mid-merge and the guard
    // file is temporarily absent. The test is what makes the absence loud.
    process.stdout.write(`tsc-guard: skipped (${error.message})\n`);
    return;
  }
  if (result.installed) {
    if (result.changed) process.stdout.write('tsc-guard: node_modules/.bin/tsc now refuses non-build-mode tsc\n');
    return;
  }
  process.stdout.write(`tsc-guard: not installed — ${result.reason}\n`);
}

/**
 * Whether this file was executed rather than imported.
 *
 * Realpaths on both sides, because the tests import `install` from a module URL
 * that Vitest rewrites to `http://localhost/…` while `process.argv[1]` is a real
 * path on disk. `scripts/__tests__/e2e-run.test.mjs` records the same trap.
 */
function invokedAsCommand() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsCommand()) {
  main();
}
