/**
 * What git is doing RIGHT NOW, in every worktree, as git itself records it.
 * ------------------------------------------------------------------------
 * `MERGE-INTEGRITY-AUDIT.md` §1 calls this "the whole hazard class in one place",
 * and it is right about the hazard. A worktree with a merge in progress holds
 * resolution state that no commit records, no branch name carries, and `git status`
 * in the main checkout cannot see. The audit's own remedy was a human command:
 *
 *     find .git/worktrees -maxdepth 2 \( -name MERGE_HEAD -o -name rebase-merge \) -print
 *
 * which is the point. The incident was found by a person running a command no gate
 * runs. Nothing in `scripts/` or `.husky/` read a second worktree's GIT DIRECTORY:
 * `workingTreeState` runs `git status --porcelain` in every worktree, which answers a
 * different question about the FILES, and `merge-takeover-guard.mjs` reads its own
 * `MERGE_HEAD`. `rg 'MERGE_HEAD' scripts .husky` returning two guard files is therefore
 * not evidence that the state was covered — both read only the worktree they stand in.
 *
 * WHY NOT `git status`
 * --------------------
 * `git status` in a worktree reports its conflicts, and that is the whole of what
 * it is for. The question this module answers is different: of the fleet, which
 * worktrees are mid-operation, RIGHT NOW, while I am not looking at them. Answering
 * it needs the per-worktree git directory, which is `<common>/.git` for the primary
 * and `<common>/.git/worktrees/<name>` for a linked one, and the state files inside.
 *
 * WHY `SQUASH_MSG` IS HERE
 * -----------------------
 * `git merge --squash` writes NO `MERGE_HEAD`, so the marker that names a merge does
 * not exist for it. Measured: after a conflicting `git merge --squash`, resolving the
 * conflict and staging it, the git directory holds `AUTO_MERGE`, `MERGE_MSG` and
 * `SQUASH_MSG`, the porcelain status is a single `M`, and `git diff
 * --name-only --diff-filter=U` is empty. That is byte-for-byte the shape the
 * `MERGE_HEAD` row catches and the most dangerous one there is — a resolution staged,
 * uncommitted, and invisible — reached by a route the marker table did not cover.
 * `git commit` clears `SQUASH_MSG`, so it does not outlive the operation.
 *
 * WHY `BISECT_LOG` IS HERE
 * -----------------------
 * A bisect rewrites `HEAD` on every step. It is the one operation in this list that
 * can move a worktree off its branch without a commit, and `git status --porcelain`
 * reports it as nothing at all. It is also the operation most likely to be forgotten,
 * because a bisect that reached its answer leaves no conflict, no dirty file and no
 * branch movement behind — only a detached HEAD somebody has to remember to switch
 * back from. Measured: `git bisect start` with no good/bad already writes it.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ------------------------------
 * `AUTO_MERGE` — written by merge, cherry-pick AND revert, so it would report the
 * same operation three times under one marker. `MERGE_MSG` — written before the
 * conflict and, on the git measured here, removed with `MERGE_HEAD`; either way a
 * report keyed on it would be reporting a message file rather than an operation.
 * `ORIG_HEAD`, `COMMIT_EDITMSG`, `MERGE_MODE`, `REBASE_HEAD`, `sequencer/` and the
 * rest of the `BISECT_*` family — each is either always accompanied by a row in this
 * table or does not survive the operation it belongs to.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Where git records each operation, and what to call it.
 *
 * `file` is a marker the mere existence of which means the operation is in
 * progress; `dir` is the same for a directory, which `git am` and `git rebase` both
 * use. The table is data rather than a chain of `if (existsSync(...))` calls in a
 * caller because the set of files git maintains is the part that grows between
 * versions, and a caller that hard-codes it has to be edited every time.
 *
 * `value: true` names the one file whose CONTENTS are worth reporting. Only one row
 * carries it, deliberately: an earlier version had `MERGE_HEAD` as a bare existence
 * check and a second `merge` row carrying the value, and the dedup filled the gap
 * from whichever came second — so a real merge reported its target as "Merge branch
 * 'theirs'\n\n# Conflicts: …" instead of the sha. The most useful fact in the report
 * has to come from the file that holds it, and a table with two rows for one
 * operation is a table that can disagree with itself.
 */
export const OPERATION_MARKERS = [
  { operation: 'merge', file: 'MERGE_HEAD', value: true },
  { operation: 'squash', file: 'SQUASH_MSG' },
  { operation: 'cherry-pick', file: 'CHERRY_PICK_HEAD' },
  { operation: 'revert', file: 'REVERT_HEAD' },
  { operation: 'rebase', dir: 'rebase-merge' },
  { operation: 'rebase', dir: 'rebase-apply' },
  { operation: 'bisect', file: 'BISECT_LOG' },
];

/**
 * What a marker file's contents add to the report.
 *
 * `MERGE_HEAD` holds the sha being merged in, which is the single most useful fact
 * in the report: it names the commit an unattended `git commit` would land alongside
 * this worktree's own.
 *
 * Only for a `file` marker, and the `statSync` guard is why. A row carrying both
 * `dir` and `value` would make `readFileSync` throw `EISDIR`, the catch swallow it,
 * and the value silently become `null` — the exact bug the `MERGE_HEAD` note above
 * describes having been fixed.
 */
const MAX_VALUE_CHARS = 40;

/** Trim a marker file's contents to one readable line, or null when unusable. */
function readMarkerValue(gitDir, marker) {
  if (!marker.value || marker.dir) return null;
  try {
    if (!statSync(join(gitDir, marker.file)).isFile()) return null;
    const trimmed = readFileSync(join(gitDir, marker.file), 'utf8').trim();
    if (trimmed === '') return null;
    return trimmed.length > MAX_VALUE_CHARS ? `${trimmed.slice(0, MAX_VALUE_CHARS)}…` : trimmed;
  } catch {
    // Fail-OPEN for the value and fail-CLOSED for the operation: the row is still
    // reported, so a reader is still told something is in progress, and only the
    // target line is missing. Losing the target is recoverable; losing the warning is
    // the failure this module exists to prevent.
    return null;
  }
}

/**
 * The operations in progress in ONE worktree, given its git directory.
 *
 * PURE WITH RESPECT TO THE FILESYSTEM, and separated from `scanRepository` so a
 * test can build a directory shape on disk and read it without a repository, a git
 * binary, or a network. That matters more here than it looks: the marker set is the
 * part of this module most likely to be wrong, because it is the part that has to
 * track git, and a test that needs `git init` to check a filename cannot check the
 * filename.
 *
 * Deduplicated by operation name, and SORTED, because `rebase-apply` and
 * `rebase-merge` can both be present and a report that says "rebase" twice reads as
 * two problems where there is one. The FIRST row wins, which keeps the marker named
 * in the report stable for a given operation.
 *
 * Returns `[]` for a directory that is not a git directory at all, which is the
 * fail-open arm: a reader that cannot place a worktree reports nothing rather than
 * throwing, so one unreadable directory cannot hide the others. That is a statement
 * about `readOperations` alone — `scanRepository` does NOT fail open, and must not,
 * because a report that cannot say "I could not look" says "clean" instead.
 */
export function readOperations(gitDir) {
  if (!gitDir) return [];
  const seen = new Set();
  const found = [];
  for (const marker of OPERATION_MARKERS) {
    const path = join(gitDir, marker.file ?? marker.dir);
    if (!existsSync(path)) continue;
    if (seen.has(marker.operation)) continue;
    seen.add(marker.operation);
    found.push({
      operation: marker.operation,
      marker: marker.file ?? marker.dir,
      value: readMarkerValue(gitDir, marker),
    });
  }
  return found.sort((a, b) => a.operation.localeCompare(b.operation));
}

/**
 * The command that abandons an operation, or `null` when git has none.
 *
 * Takes an OPERATION OBJECT — one entry of what `readOperations` returns — and never
 * a bare name, because the two rebase rows do not share a remedy and the squash row has
 * none. An earlier version accepted both and took the name when given one, so
 * `rebase-apply` — which `git am` writes — was told to run `git rebase --abort`.
 * Measured on `git am`: that exits 128 with "It looks like 'git am' is in progress.
 * Cannot rebase." A report built on the operation name alone handed out a command that
 * fatals, on the same table row whose special case for `bisect` existed precisely
 * because a remedy that does not work is worse than none.
 *
 * `null` is the general form of that principle, not a special case for one row:
 *
 * - `bisect` has no `--abort` at all; its command is `git bisect reset`, verified
 *   against the binary.
 * - `squash` has NO abandon command. `git merge --squash` writes no `MERGE_HEAD`, so
 *   `git merge --abort` answers "fatal: There is no merge to abort (MERGE_HEAD
 *   missing)", and `git squash` is not a command. The only thing that discards the
 *   staged resolution is `git reset --hard`, which is not something to hand an
 *   operator as a remedy. So this returns `null` and the caller says there is no
 *   command, which is the truth and is actionable — commit it or reset by hand.
 */
export function abortCommand(operation) {
  if (operation.operation === 'bisect') return 'git bisect reset';
  // `rebase-apply` is `git am`, whose abandon is `git am --abort`.
  if (operation.operation === 'rebase')
    return operation.marker === 'rebase-apply' ? 'git am --abort' : 'git rebase --abort';
  // Measured: neither `git merge --abort` nor `git squash --abort` works here.
  if (operation.operation === 'squash') return null;
  return `git ${operation.operation} --abort`;
}

/**
 * The paths this worktree's INDEX cannot resolve: `git diff --name-only --diff-filter=U`.
 *
 * This is the signal every parser in this repository is missing. `workingTreeState`
 * counts a non-`??` porcelain line as modified, so a `UU` path is an ordinary
 * modification and a conflict is indistinguishable from an edit; and the shape the
 * audit calls most dangerous — conflicts RESOLVED in the working tree but not STAGED
 * — is byte-identical to a staged edit under that parser too. Compared against
 * `git ls-files -u` on every conflicted shape built for this module, the path sets
 * are identical, including `UD` and a path unmerged in the index whose file is gone
 * from the working tree.
 *
 * `-z` because a path may contain a newline and a NUL-separated read is the only one
 * of the two in play that cannot be wrong about where a path ends. Verified on a path
 * containing one: this returns it verbatim where `git status --porcelain` returns the
 * quoted form.
 *
 * NOT CLAIMED AS THE ONLY SUCH QUERY. `git ls-files -u` also separates an unmerged
 * index entry from an ordinary edit, and on every conflicted shape built for this
 * module the two return the same paths. An earlier version of this comment and of the
 * documentation said "only", which is false; the choice between them is the shape of
 * their output, not a capability one has and the other lacks.
 *
 * THROWS on a non-zero exit, deliberately. The caller decides whether that is fatal
 * — `scanRepository` records it and carries on, `readOperationState` records it as a
 * refusal — and a reader that swallowed it here would make those two callers agree
 * by being unable to tell.
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
 * `--absolute-git-dir` rather than `--git-dir` because the relative form is resolved
 * against the CURRENT directory, so the same call from two worktrees returns two
 * paths into the same directory and a string comparison reports a linked worktree
 * where there is none. `main-worktree-guard.mjs` documents this same trap and
 * reaches for `realpathSync` on both sides for the same reason.
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

/** The shared `.git` directory every worktree's own directory hangs off. */
export function resolveCommonDir(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** Parse `git worktree list --porcelain` into records. */
function parseWorktreeListing(listing) {
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
  return entries;
}

/**
 * Every registered worktree, and what git is doing in each.
 *
 * `git worktree list --porcelain` for the roster rather than walking
 * `.git/worktrees/`, because the directory listing is not the roster: it omits the
 * primary worktree entirely, and a report that cannot see the checkout every other
 * worktree was derived from is not a report about the repository.
 *
 * A registration whose directory is gone is still reported, WITH its operations read
 * from the git directory git left behind — `<common>/worktrees/<name>`, which is
 * where git puts a linked worktree's state and the only place it can be. That path
 * is derived rather than asked for, because there is no directory left to ask in,
 * and it is derived for exactly the case that needs it: `git worktree prune` deletes
 * those state files with no reflog entry and nothing for `git fsck` to recover, so a
 * merge that is invisible there is a merge that is gone. An earlier version reported
 * such a worktree as `operations: []` on the reasoning that reporting it was
 * better than dropping it — and then dropped it, one line later, in `findings`.
 *
 * `readError` is a FIELD on every record, and it is populated rather than thrown,
 * because the two failure modes are different: a worktree git will not describe is
 * a fact about the repository, and a reader that aborted on it would suppress the
 * other 157. A non-null `readError` is itself a finding, so "I could not look here"
 * can never be reported as "clean here".
 *
 * ONE SPAWN PER WORKTREE is the price of `resolveGitDir`, and it is paid here rather
 * than in a caller: this is an on-demand command, and correctness of the
 * worktree-name-to-gitdir mapping is not something to re-derive.
 *
 * Returns `{ ok: false, reason }` when the roster itself could not be read, so the
 * caller can refuse rather than report an empty repository as clean.
 */
export function scanRepository(cwd = process.cwd()) {
  let listing;
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, reason: 'git worktree list failed', detail: error?.message ?? String(error), worktrees: [] };
  }

  const entries = parseWorktreeListing(listing);
  const commonDir = resolveCommonDir(cwd);

  return {
    ok: true,
    reason: null,
    worktrees: entries.map((entry) => {
      const name = basename(entry.path);
      const present = existsSync(entry.path);

      if (!present) {
        // The path git itself would use. Null when git did not answer, in which case
        // there is nothing left to read and the record says so rather than claiming
        // an empty operation set.
        const derived = commonDir ? join(commonDir, 'worktrees', name) : null;
        const gitDir = derived && existsSync(derived) ? derived : null;
        return {
          name,
          path: entry.path,
          branch: entry.branch ?? null,
          present: false,
          gitDir,
          operations: readOperations(gitDir),
          unmerged: [],
          readError: gitDir ? null : 'the worktree directory and its git directory are both gone',
        };
      }

      const gitDir = resolveGitDir(entry.path);
      let unmerged = [];
      let readError = gitDir === null ? 'git rev-parse --absolute-git-dir failed' : null;
      try {
        unmerged = unmergedPaths(entry.path);
      } catch (error) {
        // Recorded, not thrown. The operations are still known, and a report that
        // lost the whole worktree over an unreadable index would hide the merge that
        // matters most.
        readError = readError ?? error?.message ?? String(error);
      }
      return {
        name,
        path: entry.path,
        branch: entry.branch ?? null,
        detached: entry.detached === true,
        present: true,
        gitDir,
        operations: readOperations(gitDir),
        unmerged,
        readError,
      };
    }),
  };
}

/**
 * The worktrees a reader has to act on, and nothing else.
 *
 * A worktree with an operation in progress and a worktree with unmerged index
 * entries are DIFFERENT problems with different remedies, and a single boolean
 * cannot carry both: `git merge --abort` on a worktree whose conflicts are already
 * resolved throws the resolution away, which is the one outcome the operator must be
 * warned about rather than invited into. So the finding keeps both lists, and the
 * report says which remedy applies to which.
 *
 * A `readError` is a finding with nothing else set, because that is the only shape
 * in which "no operation in progress" would be an answer nobody established.
 */
export function findings(worktrees) {
  return worktrees
    .filter((w) => (w.operations?.length ?? 0) > 0 || (w.unmerged?.length ?? 0) > 0 || Boolean(w.readError))
    .map((w) => ({
      name: w.name,
      path: w.path,
      branch: w.branch,
      present: w.present,
      operations: w.operations ?? [],
      unmerged: w.unmerged ?? [],
      readError: w.readError ?? null,
      // Whether an abandon command would DISCARD work, named separately so a report
      // can warn about it. Derived from `abortCommand` rather than from the
      // operation's name, because an operation with no abandon command has nothing to
      // warn about and an operation whose command is `git bisect reset` discards
      // nothing — both of which a name-based test would get backwards.
      destructive: (w.operations ?? []).some((o) => abortCommand(o) !== null && o.operation !== 'bisect'),
    }));
}
