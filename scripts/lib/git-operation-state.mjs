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
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

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

/**
 * The entries under `<common>/worktrees`, or WHY they could not be read.
 *
 * `readError` IS NOT OPTIONAL, and returning a bare `[]` for both "there are none" and
 * "I could not look" is the exact defect this module exists to prevent — one level up
 * from where it was found. Measured: `chmod 000 <gitdir>/worktrees` makes this function
 * return `[]`, the cross-check finds no orphans, and the report says "clean" with exit 0
 * while `MERGE_HEAD` sits in the directory that just became unreadable. `[]` is also
 * what the previous version returned, and its own docstring said so.
 *
 * A SYMLINK to a directory is included. `entry.isDirectory()` is false for one, which
 * silently removed the directory from the cross-check; `statSync` follows the link, and
 * a broken link is an error rather than an absence.
 */
function adminDirs(commonDir) {
  const root = join(commonDir, 'worktrees');
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    // `ENOENT` IS NOT AN ERROR: git creates `<common>/worktrees` only when there is a
    // LINKED worktree, so a repository with none has no such directory and that is the
    // normal case — including every repository in this suite's own fixtures. Treating it
    // as unreadable flagged every clean repository with a synthetic orphan, which is how
    // the first attempt at this fix turned "read nothing" into a permanent false alarm.
    // Only a directory that EXISTS and cannot be read is a finding, and that is
    // `EACCES`, `EPERM`, or a path that is not a directory at all.
    if (error?.code === 'ENOENT') return { dirs: [], readError: null };
    return {
      dirs: [],
      readError: `the administrative directory ${root} exists but could not be read (${error?.code ?? error?.message ?? 'unknown'})`,
    };
  }
  // Each entry is a PATH or `{ path, statError }`, because the reason a directory could
  // not be resolved must survive to the record rather than be re-derived from a later
  // read that may fail for a different reason.
  const dirs = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      dirs.push(path);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    try {
      if (statSync(path).isDirectory()) dirs.push(path);
    } catch (error) {
      // A broken symlink where an admin directory should be. It is pushed so the
      // cross-check sees it, and the ERROR travels with it: the previous version pushed
      // the path and let `adminDirRecords` re-derive the reason from reading `gitdir`,
      // which then reported `ENOENT` and classified the directory as "not a worktree" —
      // so a documented error was unreachable and the case measured clean. An error
      // observed here is an error observed here, not one to re-derive later.
      dirs.push({ path, statError: `it is a symlink that could not be resolved (${error?.code ?? 'unknown'})` });
    }
  }
  return { dirs, readError: null };
}

/**
 * The git directory of a worktree WHOSE OWN DIRECTORY IS GONE, by matching, not by name.
 *
 * WHY NOT `<common>/worktrees/<basename>`. Because git does not name the administrative
 * directory after the worktree. It sanitises: a LEADING `.` becomes `-`, measured on
 * the git here — a worktree at `.hidden` gets the administrative directory `-hidden`, and
 * one at `.a.b` gets `-a.b`, while `a.b.c` keeps its name. So `basename(path)` is wrong
 * for every dot-prefixed worktree, and the derived path does not exist. An earlier
 * version of this function derived that path and its comment claimed it was "the only
 * place it can be"; for those names it silently produced `readError`, which is the same
 * "reported clean without having established it" class this module exists to remove.
 *
 * So the match is made against the CONTENT instead. Every administrative directory
 * holds a `gitdir` file naming the absolute path of that worktree's `.git` file, so
 * `dirname()` of its contents is the worktree path, and comparing that to the path git
 * listed needs no naming rule at all — it cannot be wrong about a sanitisation this
 * function has never heard of.
 *
 * Returns null when no administrative directory claims that path, which is the honest
 * answer: git has dropped it, or it was never a linked worktree.
 */
export function resolveAdminDirFor(commonDir, worktreePath) {
  if (!commonDir) return null;
  const wanted = realpathIfPresent(worktreePath) ?? worktreePath;
  for (const record of adminDirRecords(commonDir).dirs) {
    if (record.owner !== null && (realpathIfPresent(record.owner) ?? record.owner) === wanted) return record.path;
  }
  return null;
}

/**
 * One pass over the administrative directories, recording what each one CLAIMS.
 *
 * Built once and shared, because the cross-check and the absent-worktree lookup were
 * each enumerating and each reading every `gitdir` — measured at 95 directories that is
 * two `readFileSync` per directory for one answer, and the two answers could disagree.
 *
 * `owner` is the WORKTREE path, resolved. NOT always the same as `dirname(contents)`:
 * `git worktree add --relative-paths` writes a RELATIVE path into `gitdir`, measured as
 * `../../../rel/.git`, and a relative `gitdir` is relative to the ADMINISTRATIVE
 * DIRECTORY. Taking `dirname()` of it verbatim yields `../../../rel`, which resolves
 * against the caller's cwd rather than the admin directory, never matches a roster
 * entry, and so produced a false orphan on a perfectly healthy repository — the report
 * told the operator a live worktree was gone and unreadable, permanently, on a
 * documented git configuration.
 *
 * `readError` per record is the error that ACTUALLY happened, so a message can never
 * claim a read failed that succeeded. The previous version inferred readability from
 * `readdirSync`, which at mode 0111 throws while the markers read perfectly — so it
 * printed "its git state could not be read" immediately above the `MERGE_HEAD` it had
 * just read.
 */
function adminDirRecords(commonDir) {
  const { dirs, readError } = adminDirs(commonDir);
  return {
    readError,
    dirs: dirs.map((entry) => {
      // `entry` is a path, or `{ path, statError }` from `adminDirs`.
      const dir = typeof entry === 'string' ? entry : entry.path;
      const statError = typeof entry === 'string' ? null : entry.statError;
      let contents;
      try {
        contents = readFileSync(join(dir, 'gitdir'), 'utf8').trim();
      } catch (error) {
        // A MISSING `gitdir` FILE IS NOT ENOUGH TO CALL A DIRECTORY "NOT A WORKTREE".
        //
        // Deciding it from that one absence was a CRITICAL false negative I introduced:
        // a directory holding `MERGE_HEAD`, an `index` and a `HEAD` with only `gitdir`
        // missing is self-evidently a worktree's administrative directory, and the tool
        // discarded it — exit 0, "clean", with the merge on disk. `git worktree prune`
        // then deleted it with no reflog entry and nothing for `git fsck` to recover,
        // which is the exact loss this module exists to prevent. The version before it
        // got this case right and reported the merge.
        //
        // So the absence has to be corroborated. A directory is "not a worktree" only
        // when `gitdir` is missing AND no operation marker is present AND there is no
        // `index` — anything else means there is state here that somebody must decide
        // about.
        if (error?.code === 'ENOENT') {
          if (looksLikeWorktreeState(dir)) {
            return {
              path: dir,
              owner: null,
              readError: `its gitdir file is missing but it holds worktree state, so which worktree it belongs to is unknown (${statError ?? 'gitdir absent'})`,
            };
          }
          return { path: dir, owner: null, readError: null, notAWorktree: true };
        }
        return {
          path: dir,
          owner: null,
          readError: statError ?? `its gitdir file could not be read (${error?.code ?? 'unknown'})`,
        };
      }
      if (contents === '') {
        if (looksLikeWorktreeState(dir)) {
          return {
            path: dir,
            owner: null,
            readError: `its gitdir file is empty but it holds worktree state, so which worktree it belongs to is unknown`,
          };
        }
        return { path: dir, owner: null, readError: null, notAWorktree: true };
      }
      const absolute = isAbsolute(contents) ? contents : resolve(dir, contents);
      return { path: dir, owner: dirname(absolute), readError: null, statError };
    }),
  };
}

/**
 * Does this directory hold worktree state, whatever its `gitdir` file says?
 *
 * The corroboration `notAWorktree` needs. Deliberately generous: a false positive here
 * costs one extra reported directory on a repository that has a stray directory, and a
 * false negative costs a merge that `git worktree prune` then destroys. `index` and
 * `HEAD` count as well as the operation markers, because git writes them for every
 * linked worktree and their presence says the same thing.
 */
function looksLikeWorktreeState(dir) {
  if (existsSync(join(dir, 'index')) || existsSync(join(dir, 'HEAD'))) return true;
  return OPERATION_MARKERS.some((marker) => existsSync(join(dir, marker.file ?? marker.dir)));
}

/** `realpathSync` when the path exists, and null when it does not — never a throw. */
function realpathIfPresent(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Parse `git worktree list --porcelain -z` into records.
 *
 * `-z` IS NOT OPTIONAL, and the version without it had two defects a review drove out
 * with real repositories:
 *
 * `git worktree list --porcelain` does NOT quote its paths. A worktree at
 * `…/wt\nwith-newline` came back as two lines, so `listing.split('\n')` produced the
 * path `…/wt` — truncated at the newline, naming a directory that does not exist. The
 * live worktree then read as `present: false` with `readError`, the tool stated as fact
 * that git had dropped state still sitting on disk, and the record for the worktree that
 * actually held the merge never existed. This is the same trap `unmergedPaths` documents
 * for `git status --porcelain`, in the same file, a few dozen lines away.
 *
 * With `-z` every record is NUL-terminated and a path round-trips verbatim, newline and
 * all. Verified on the git here for newline, space and non-ASCII paths.
 *
 * `bare` is read because a bare repository is a first-class git layout — what a mirror
 * lives in — and its only roster entry has no working tree, so `git diff
 * --diff-filter=U` answers "fatal: this operation must be run in a work tree" forever.
 * Without this the tool was permanently red in a valid configuration, which is how a
 * report gets bypassed.
 */
export function parseWorktreeListing(listing) {
  const entries = [];
  let current = null;
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const sep = record.indexOf(' ');
    const key = sep === -1 ? record : record.slice(0, sep);
    const value = sep === -1 ? null : record.slice(sep + 1);
    if (key === 'worktree') {
      if (current) entries.push(current);
      current = { path: value };
    } else if (current && key === 'branch') {
      current.branch = value?.replace('refs/heads/', '');
    } else if (current && record === 'detached') {
      current.detached = true;
    } else if (current && record === 'bare') {
      current.bare = true;
    } else if (current && key === 'locked') {
      // `locked` is what stops `git worktree prune` deleting the very resolution state
      // this tool exists to protect, so discarding it discards the answer to "is this
      // state about to be destroyed". `prunable` is the state `dispose-worktree.mjs`
      // refuses on. Both were dropped because this parser only ever handled four keys,
      // and the `-z` rewrite made the omission read as an oversight rather than as the
      // parser it was.
      current.locked = value === null || value === '' ? true : value;
    } else if (current && key === 'prunable') {
      current.prunableReason = value === null || value === '' ? true : value;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * The administrative directories that NO roster entry claims.
 *
 * This is the cross-check that closes the hole a review found by `chmod`. When an admin
 * directory cannot be read, `git worktree list --porcelain` does not report the
 * registration AT ALL — measured: `chmod 000 .git/worktrees/<name>` removes the entry,
 * and the roster shrank from three worktrees to two while `MERGE_HEAD` sat in the
 * directory that had just become unreadable. The report then said "clean" and exited 0,
 * which is the one output this module exists to never produce, and it falsified both its
 * own docstring and the sentence in `docs/ORCHESTRATION.md` that says a worktree it could
 * not describe is reported unreadable rather than clean.
 *
 * So the roster is not trusted on its own. Every entry under `<common>/worktrees` is
 * matched against it by the worktree its own `gitdir` file names, and an admin directory
 * no entry claims becomes a record — read for operations, and carrying a `readError`
 * when nothing can claim it. The count is also returned, so a caller can tell "the roster
 * is shorter than the directories on disk" from "it is not".
 *
 * The primary worktree has no admin directory of its own, so a matching count is
 * `adminDirs.length === roster entries - 1`.
 */
function unclaimedAdminDirs(commonDir, entries) {
  // `commonDir` null means git would not say, which is the same failure as a directory
  // it could not read: reported, not folded into "there were none".
  if (!commonDir)
    return {
      orphans: [],
      readError: 'git rev-parse --git-common-dir failed, so the administrative directories could not be enumerated',
    };

  const scanned = adminDirRecords(commonDir);

  // owner -> every administrative directory claiming it. A MAP, not a Set: two admin
  // directories naming one worktree are indistinguishable to a Set, and the second
  // one's state is then read by nothing at all. Measured: a `gitdir` naming an already
  // claimed worktree produced no finding and its `MERGE_HEAD` was never read — real
  // merge state, in a directory git does not list, invisible.
  const owners = new Map();
  for (const record of scanned.dirs) {
    if (record.owner === null) continue;
    const key = realpathIfPresent(record.owner) ?? record.owner;
    if (!owners.has(key)) owners.set(key, []);
    owners.get(key).push(record.path);
  }

  const claimed = new Set(owners.keys());

  const orphans = [];
  for (const record of scanned.dirs) {
    // A directory with no `gitdir` file, or an empty one, is NOT a worktree git dropped
    // from its roster. It is a directory that is not a worktree: an interrupted
    // `git worktree add`, a temp directory, an editor artefact. Reporting it as a lost
    // registration asserts git's intent that was never measured, and it made a healthy
    // repository permanently red.
    if (record.notAWorktree === true) continue;

    const ownerKey = record.owner === null ? null : (realpathIfPresent(record.owner) ?? record.owner);
    if (ownerKey !== null && claimed.has(ownerKey)) {
      // Claimed by the roster, or by a sibling directory that is itself an orphan. Either
      // way this directory's state is reachable through the roster entry, so it is not an
      // orphan — but TWO directories claiming one worktree is unresolvable state, and it
      // is reported so the operator can decide which is real.
      const siblings = owners.get(ownerKey);
      // Unconditional on whether the roster reports the owner. Measured: a second
      // administrative directory naming a worktree the roster DOES report produced no
      // finding at all, and that directory's `MERGE_HEAD` was read by nothing — real
      // merge state, in a directory git does not list, invisible. The earlier version
      // guarded this on the roster NOT claiming the owner, which made it unreachable in
      // exactly the case it was written for.
      if (siblings.length > 1) {
        orphans.push({
          gitDir: record.path,
          owner: record.owner,
          readError: `${siblings.length} administrative directories claim this worktree (${siblings.join(', ')}), so which one is authoritative is unknown`,
        });
      }
      continue;
    }

    orphans.push({
      gitDir: record.path,
      owner: record.owner,
      // The message names the read that ACTUALLY failed. The previous version inferred
      // readability from `readdirSync`, which throws at mode 0111 while the markers read
      // perfectly — so the report printed "its git state could not be read" directly above
      // the `MERGE_HEAD` it had just read. Never assert a read failed that succeeded.
      readError:
        record.readError ??
        'git worktree list does not report this administrative directory, so the worktree is not in the roster',
    });
  }

  return { orphans, readError: scanned.readError };
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
 * from the git directory git left behind. That is found by {@link resolveAdminDirFor},
 * which matches the administrative directory's own `gitdir` file rather than deriving
 * a name — see there for why a derived name is wrong. It matters because
 * `git worktree prune` deletes those state files with no reflog entry and nothing for
 * `git fsck` to recover, so a merge that is invisible there is a merge that is gone.
 * An earlier version reported such a worktree as `operations: []` on the reasoning that
 * reporting it was better than dropping it — and then dropped it, one line later, in
 * `findings`, so the net behaviour was the thing it argued against.
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
 * Returns `{ ok: false, reason }` when the roster itself could not read, or read as
 * empty, so the caller can refuse rather than report an empty repository as clean. The
 * second condition is not reachable on the git measured — a repository always lists at
 * least its primary — but an empty parse is the same shape as an unreadable one, and
 * this module's whole argument is that it does not report health it has not
 * established.
 */
export function scanRepository(cwd = process.cwd(), { unmergedOf = unmergedPaths } = {}) {
  let listing;
  try {
    listing = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, reason: 'git worktree list failed', detail: error?.message ?? String(error), worktrees: [] };
  }

  const entries = parseWorktreeListing(listing);
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'git worktree list produced no worktree records',
      detail: `\`git worktree list --porcelain -z\` answered with no \`worktree\` record in: ${JSON.stringify(listing)}`,
      worktrees: [],
    };
  }
  const commonDir = resolveCommonDir(cwd);

  // Every admin directory the roster did not account for, read as records below. This
  // is what a `chmod` on an admin directory produces — a registration git can no longer
  // describe, holding state it can no longer be asked about — and it is invisible in the
  // roster itself.
  const cross = unclaimedAdminDirs(commonDir, entries);
  const orphans = cross.orphans.map((orphan) => ({
    name: basename(orphan.gitDir),
    path: orphan.owner ?? `(administrative directory ${orphan.gitDir}, whose gitdir file is unreadable)`,
    branch: null,
    detached: false,
    present: orphan.owner === null ? false : existsSync(orphan.owner),
    gitDir: orphan.gitDir,
    operations: readOperations(orphan.gitDir),
    unmerged: [],
    readError: orphan.readError,
  }));

  return {
    ok: true,
    reason: null,
    worktrees: [
      // One synthetic record when the administrative directories could not be read at
      // all, so the report says so rather than reporting a count it never obtained.
      ...(cross.readError === null
        ? []
        : [
            {
              name: '(administrative directories)',
              path: commonDir,
              branch: null,
              detached: false,
              bare: false,
              present: false,
              gitDir: null,
              operations: [],
              unmerged: [],
              readError: cross.readError,
            },
          ]),
      ...entries.map((entry) => {
        const name = basename(entry.path);
        const present = existsSync(entry.path);

        if (!present) {
          const gitDir = resolveAdminDirFor(commonDir, entry.path);
          return {
            name,
            path: entry.path,
            branch: entry.branch ?? null,
            detached: entry.detached === true,
            bare: entry.bare === true,
            locked: entry.locked ?? false,
            prunableReason: entry.prunableReason ?? null,
            present: false,
            gitDir,
            operations: readOperations(gitDir),
            unmerged: [],
            readError: gitDir
              ? null
              : 'no administrative directory claims this worktree, so its git directory is gone too',
          };
        }

        const gitDir = resolveGitDir(entry.path);
        let unmerged = [];
        let readError = gitDir === null ? 'git rev-parse --absolute-git-dir failed' : null;
        // A bare repository's only entry has no working tree, so the work-tree-only query
        // answers "fatal: this operation must be run in a work tree" every time. Its
        // operation state is still readable from the git directory, so only the probe is
        // skipped.
        const bare = entry.bare === true;
        if (!bare) {
          try {
            unmerged = unmergedOf(entry.path);
          } catch (error) {
            // Recorded, not thrown. The operations are still known, and a report that
            // lost the whole worktree over an unreadable index would hide the merge that
            // matters most.
            readError = readError ?? error?.message ?? String(error);
          }
        }
        return {
          name,
          path: entry.path,
          branch: entry.branch ?? null,
          detached: entry.detached === true,
          bare,
          locked: entry.locked ?? false,
          prunableReason: entry.prunableReason ?? null,
          present: true,
          gitDir,
          operations: readOperations(gitDir),
          unmerged,
          readError,
        };
      }),
      ...orphans,
    ],
    // Reported, not enforced: a roster shorter than the directories on disk is the fact
    // the cross-check exists to surface, and a caller that wants to know whether every
    // admin directory was accounted for reads it here. `null` means "not counted",
    // which is deliberately distinct from `0` — a review found `adminDirs()` returning
    // `[]` for an unreadable `<common>/worktrees` and that `0` being reported as a
    // count, so "read nothing" was being reported as "read zero".
    adminDirs: commonDir && cross.readError === null ? adminDirs(commonDir).dirs.length : null,
    adminDirsReadError: cross.readError,
    roster: entries.length,
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
