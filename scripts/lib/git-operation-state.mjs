/**
 * What git is doing RIGHT NOW, in every worktree, as git itself records it.
 * ------------------------------------------------------------------------
 * `MERGE-INTEGRITY-AUDIT.md` §1 calls this "the whole hazard class in one place",
 * and it is right about the hazard and wrong about the containment. A worktree
 * with a merge in progress holds resolution state that no commit records, no
 * branch name carries, and `git status` in the main checkout cannot see. The
 * audit's own remedy was a human command:
 *
 *     find .git/worktrees -maxdepth 2 \( -name MERGE_HEAD -o -name rebase-merge \) -print
 *
 * which is exactly the point. The incident was found by a person running a
 * command no gate runs. `rg 'MERGE_HEAD' scripts .husky` finds two guards, and
 * both read only the worktree whose hook is firing: `merge-takeover-guard.mjs`
 * resolves its OWN incoming ref, and `.husky/pre-commit` gates on its OWN
 * `MERGE_HEAD`. Nothing in this repository ever looked at a second worktree.
 *
 * WHY NOT `git status`
 * --------------------
 * `git status` in a worktree reports its conflicts, and that is the whole of
 * what it is for. The question this module answers is different: of the 155
 * worktrees, which ones are mid-operation, RIGHT NOW, while I am not looking at
 * them. Answering it needs the per-worktree git directory, which is
 * `<common>/.git` for the primary and `<common>/.git/worktrees/<name>` for a
 * linked one, and the state files inside it.
 *
 * WHY `BISECT_LOG` IS IN HERE
 * ---------------------------
 * A bisect rewrites `HEAD` on every step. It is the one operation in this list
 * that can move a worktree off its branch without a commit, and `git status`
 * reports it as nothing at all. It is also the operation most likely to be
 * forgotten, because a bisect that reached its answer leaves no conflict, no
 * dirty file and no branch movement behind — only a detached HEAD somebody has
 * to remember to switch back from.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Where git records each operation, and what to call it.
 *
 * `file` is a marker the mere existence of which means the operation is in
 * progress — that is the whole protocol, and it is why this table is data
 * rather than a chain of `if (existsSync(...))` calls in a caller: the set of
 * files git maintains is the part that grows between versions, and a caller that
 * hard-codes it has to be edited every time.
 *
 * `dir` is different: a rebase's `rebase-merge` and `rebase-apply` are
 * directories, and `rebase-apply` is also what `git am` uses. Both are reported
 * as `rebase` because the remedy is the same (`git rebase --abort` /
 * `git am --abort`) and a caller that has to tell them apart is a caller with a
 * branch nobody asked for.
 */
export const OPERATION_MARKERS = [
  // `value: true` on MERGE_HEAD and NOT a second entry for MERGE_MSG. An earlier
  // version had MERGE_HEAD as a bare existence check and MERGE_MSG as the entry
  // carrying the value, and the dedup filled the gap from whichever came second — so
  // a real merge reported its target as "Merge branch 'theirs'\n\n# Conflicts: …"
  // instead of the sha. The most useful fact in the report has to come from the file
  // that holds it, and a marker table with two rows for one operation is a table that
  // can disagree with itself.
  { operation: 'merge', file: 'MERGE_HEAD', value: true },
  { operation: 'cherry-pick', file: 'CHERRY_PICK_HEAD' },
  { operation: 'revert', file: 'REVERT_HEAD' },
  { operation: 'rebase', dir: 'rebase-merge' },
  { operation: 'rebase', dir: 'rebase-apply' },
  { operation: 'bisect', file: 'BISECT_LOG' },
];

/**
 * What a marker file's contents add to the report.
 *
 * `MERGE_HEAD` holds the sha being merged in, which is the single most useful
 * fact in the report: it names the commit an unattended `git commit` would land
 * alongside this worktree's own. Read, not guessed — the audit had to ask git
 * for this separately.
 *
 * The value is truncated to a length a human reads, and only for shas.
 */
const MAX_VALUE_CHARS = 40;

/** Trim a marker file's contents to one readable line, or null when unusable. */
function readMarkerValue(file, { value }) {
  if (!value) return null;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS)}…` : trimmed;
}

/**
 * The operations in progress in ONE worktree, given its git directory.
 *
 * PURE WITH RESPECT TO THE FILESYSTEM, and separated from `scanRepository` so a
 * test can build a directory shape on disk and read it without a repository,
 * a git binary, or a network. That matters more here than it looks: the marker
 * set is the part of this module most likely to be wrong, because it is the
 * part that has to track git, and a test that needs `git init` to check a
 * filename cannot check the filename.
 *
 * Deduplicated by operation name, and SORTED, because `rebase-apply` and
 * `rebase-merge` can both be present during `git am` and a report that says
 * "rebase" twice reads as two problems where there is one.
 *
 * Returns `[]` for a directory that is not a git directory at all, which is the
 * fail-open arm: a reader that cannot place a worktree reports nothing rather
 * than throwing, so one unreadable directory cannot hide the other 154.
 */
export function readOperations(gitDir) {
  if (!gitDir) return [];
  const seen = new Map();
  for (const marker of OPERATION_MARKERS) {
    const path = marker.file ? join(gitDir, marker.file) : join(gitDir, marker.dir);
    if (!existsSync(path)) continue;
    if (marker.requires && !existsSync(join(gitDir, marker.requires))) continue;
    const value = readMarkerValue(path, marker);
    if (seen.has(marker.operation)) {
      if (value && !seen.get(marker.operation).value) seen.get(marker.operation).value = value;
      continue;
    }
    seen.set(marker.operation, { operation: marker.operation, marker: marker.file ?? marker.dir, value });
  }
  return [...seen.values()].sort((a, b) => a.operation.localeCompare(b.operation));
}

/**
 * Whether an operation can be abandoned with `git <operation> --abort`.
 *
 * `bisect` is the exception and the reason is not a detail: `git bisect reset`
 * is the command, and a report that told someone to run `git bisect --abort`
 * would send them to a flag that does not exist, at the exact moment they are
 * trying to recover work. A remedy that does not work is worse than none.
 */
export function abortCommand(operation) {
  return operation === 'bisect' ? 'git bisect reset' : `git ${operation} --abort`;
}

/**
 * The paths this worktree's INDEX cannot resolve: `git diff --diff-filter=U`.
 *
 * This is the signal every parser in this repository is missing. `workingTreeState`
 * counts a non-`??` porcelain line as modified, so a `UU` path is an ordinary
 * modification and a conflict is indistinguishable from an edit; and the shape
 * the audit calls most dangerous — conflicts RESOLVED in the working tree but not
 * STAGED — is byte-identical to a staged edit under that parser too. This is the
 * only query that separates them.
 *
 * `-z` because a path may contain a newline and a NUL-separated read is the only
 * one that cannot be wrong about where a path ends.
 */
export function unmergedPaths(cwd) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=U', '-z'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\0').filter(Boolean);
}

/**
 * The absolute git directory of a worktree, or null when git will not say.
 *
 * `--absolute-git-dir` rather than `--git-dir` because the relative form is
 * resolved against the CURRENT directory, so the same call from two worktrees
 * returns two paths into the same directory and a string comparison reports a
 * linked worktree where there is none. `main-worktree-guard.mjs` documents this
 * same trap and reaches for `realpathSync` on both sides for the same reason.
 */
export function resolveGitDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Every registered worktree: its path, its branch, its absolute git directory,
 * its in-progress operations, and its unmerged paths.
 *
 * `git worktree list --porcelain` for the roster rather than walking
 * `.git/worktrees/`, because the directory listing is not the roster: it omits
 * the primary worktree entirely, and a report that cannot see the checkout every
 * other worktree was derived from is not a report about the repository.
 *
 * A registration whose directory is gone is reported with `present: false` and no
 * operations, rather than skipped. Skipping it would make the count disagree with
 * `git worktree list` for a reader who counts, which is the same defect the
 * inventory already has to correct for on `findMissingWorktrees`.
 *
 * ONE SPAWN PER WORKTREE is the price of `resolveGitDir`, and it is paid here
 * rather than in a caller: this is an on-demand command, and correctness of the
 * worktree-name-to-gitdir mapping is not something to re-derive. git names a
 * linked worktree's directory after the worktree, sanitised, and two worktrees
 * whose basenames differ only in characters git replaces would collide.
 */
export function scanRepository(cwd = process.cwd(), { readWorktree = null } = {}) {
  let listing;
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return [];
  }

  const entries = [];
  let current = null;
  for (const line of listing.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'detached' && current) {
      current.detached = true;
    }
  }
  if (current) entries.push(current);

  return entries.map((entry) => {
    const name = basename(entry.path);
    const present = existsSync(entry.path);
    if (!present) {
      return { name, path: entry.path, branch: entry.branch ?? null, present: false, operations: [], unmerged: [] };
    }
    const gitDir = resolveGitDir(entry.path);
    return {
      name,
      path: entry.path,
      branch: entry.branch ?? null,
      detached: entry.detached === true,
      present: true,
      gitDir,
      operations: readOperations(gitDir),
      unmerged: readWorktree ? readWorktree(entry.path) : unmergedPaths(entry.path),
    };
  });
}

/**
 * The worktrees a reader has to act on, and nothing else.
 *
 * A worktree with an operation in progress and a worktree with unmerged index
 * entries are DIFFERENT problems with different remedies, and a single boolean
 * cannot carry both: `git merge --abort` on a worktree whose conflicts are
 * already resolved throws the resolution away, which is the one outcome the
 * operator must be warned about rather than invited into. So the finding keeps
 * both lists, and the report says which remedy applies to which.
 *
 * `unmerged` alone is enough to act on — git itself refuses `git commit` while
 * the index is unresolvable — but a worktree can hold unmerged entries with no
 * operation recorded, which happens when a merge is resolved and `MERGE_HEAD` is
 * removed by hand. That is the audit's "row with 0 unmerged paths still matters"
 * case inverted, and it is why both signals are collected.
 */
export function findings(worktrees) {
  return worktrees
    .filter((w) => w.present && (w.operations.length > 0 || w.unmerged.length > 0))
    .map((w) => ({
      name: w.name,
      path: w.path,
      branch: w.branch,
      operations: w.operations,
      unmerged: w.unmerged,
      // The command that would DISCARD work, named separately so a report can
      // warn about it. `git merge --abort` is safe on an unresolved merge and
      // destructive on a resolved one, and the report cannot tell those apart
      // from the index alone — so it says so in both cases.
      destructive: w.operations.some((o) => o.operation !== 'bisect'),
    }));
}
