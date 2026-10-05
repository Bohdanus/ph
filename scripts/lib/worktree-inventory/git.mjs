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

/**
 * `git worktree list --porcelain -z`, parsed into records.
 *
 * `-z` IS NOT OPTIONAL HERE EITHER, and the reason is the drift this file's own consumers
 * were warned about. `scripts/lib/git-operation-state.mjs` reads the same git format and
 * moved to `-z` because `--porcelain` does NOT quote its paths: a worktree at
 * `…/wt\nwith-newline` came back as two records and the path was truncated at the
 * newline. With this parser left on `\n`, `npm run repo:state` and `npm run dispose`
 * named DIFFERENT worktrees in the same repository — `dispose` reported
 * `unknown-worktree` for a worktree the report could see. Two parsers of one format
 * drifting is the documented risk; this is that risk, realised.
 *
 * The RECORD SHAPE is unchanged, deliberately: every caller and every test reads these
 * objects, and the defect was in how the bytes were split, not in what came out.
 */
export function listWorktrees(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain', '-z']);
  if (out === null) throw new Error('git worktree list failed; is this a git repository?');

  const worktrees = [];
  let current = null;

  for (const line of out.split('\0')) {
    if (line === '') continue;
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
 * The ref this checkout should be compared against, or `null` if there is none.
 *
 * THE LITERAL `main` IS NOT AVAILABLE EVERYWHERE, and assuming it is was a real
 * outage. `git rev-list main...HEAD` and `git merge-base --is-ancestor HEAD main`
 * both need a ref NAMED `main` to exist. They do not resolve `origin/main`, and
 * they do not resolve a remote-tracking ref spelled differently. A checkout made
 * by `actions/checkout` with the default `fetch-depth: 1` on a `pull_request`
 * event contains `refs/remotes/pull/N/merge` and `refs/remotes/origin/main` and
 * NO `refs/heads/main` at all, so on that shape every ahead/behind answer this
 * module produced was `{ ahead: null, behind: null }` and every "already landed"
 * answer was `false` — the two values that make a guard read as a machine with
 * nothing at risk on it.
 *
 * So the base is ASKED FOR rather than assumed, in the order that prefers the
 * most local answer and falls back to the one a shallow clone still has. The
 * candidates are probed with `rev-parse --verify --quiet <name>^{commit}`, which
 * asks "does this name resolve to exactly one COMMIT" and is false for a missing
 * ref, for a name that is ambiguous only in the sense of not existing, for a
 * tree, and for a blob.
 *
 * IT IS NOT false for an ambiguous NAME, and this sentence is here because an
 * earlier draft of this comment said it was and was wrong. A name that resolves
 * to more than one thing resolves, and git says which on stderr where nothing
 * reads it. The two paragraphs below measure that and the shallow case; this one
 * is only the probe.
 *
 * `null` is a real answer and not an error to be papered over: it means this
 * checkout has no base that can be trusted, which is a fact about the checkout
 * rather than about any worktree in it. Every caller must pass it through rather
 * than substitute a default, because substituting one is what produced the
 * outage.
 *
 * TWO WAYS A REF CAN RESOLVE AND STILL BE THE WRONG ANSWER, both found by
 * building the shapes rather than reasoning about them, and both of which return
 * a number rather than admitting ignorance.
 *
 * A SHALLOW REPOSITORY. `rev-parse --verify` asks "does this name name one
 * commit", and in a `--depth 1` clone `origin/main` names exactly one commit —
 * the tip, with its ancestry cut off. So the probe passes and every answer built
 * on it is confidently wrong. Measured on a depth-1 fetch of a real ancestor of
 * `origin/main`: `merge-base --is-ancestor HEAD origin/main` exits 1, and
 * `rev-list --left-right --count origin/main...HEAD` prints `1 1`, for a branch
 * that IS on the base. Before the shallow check this function returned
 * `origin/main` there, which converts "I know nothing" into "I am certain and
 * wrong" — strictly worse than the null it replaced, because a wrong number is
 * read and a null is checked. `--is-shallow-repository` is the question, and the
 * answer is that ancestry is not available in such a checkout at any depth, so
 * there is no ref worth certifying.
 *
 * A TAG NAMED `main`. `rev-parse --verify` does NOT reject an ambiguous name. With
 * a branch `main` and a lightweight tag `main` both present it exits 0, resolves
 * the TAG, and prints `warning: refname 'main' is ambiguous` to stderr where
 * nothing reads it. An earlier draft of this comment claimed the probe "is false
 * for both a missing ref and an ambiguous one"; measured, it is false only for the
 * missing one. What actually saves the answer is the first candidate being FULLY
 * QUALIFIED, and `^{commit}` is here to reject a tree and a blob, which it does.
 * `is-ancestor` against that tag exits 1 where it exits 0 against the branch. The
 * first candidate is therefore FULLY QUALIFIED. It was `main`, which is the bug
 * this function's own existence is about.
 *
 * ON THE ORDER OF THE REST, which is a deliberate choice and not an oversight: a
 * stale local base is preferred over a fresh remote one. Comparing against a
 * `main` that is behind makes a landed branch read as NOT landed, and every
 * downstream verdict on that branch then protects it — which is the direction
 * this tool must fail in. Preferring the fresher ref would make more worktrees
 * read as disposable. Every consumer prints the ref it resolved, so a stale base
 * is visible rather than silent.
 */
export function resolveBaseRef(cwd, candidates = ['refs/heads/main', 'origin/main', 'refs/remotes/origin/main']) {
  if (isShallow(cwd)) return null;
  for (const candidate of candidates) {
    const out = git(cwd, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (out !== null && out !== '') return candidate;
  }
  return null;
}

/** Whether this checkout's history is truncated, so ancestry means nothing here. */
function isShallow(cwd) {
  return git(cwd, ['rev-parse', '--is-shallow-repository']) === 'true';
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
 * Of the paths a worktree reports as modified, how many the base branch does
 * NOT already hold byte-for-byte.
 *
 * WHY THIS IS A SEPARATE NUMBER, NOT A REPLACEMENT
 * -------------------------------------------------
 * `git status` compares the working tree against the worktree's own HEAD. On a
 * branch 100 commits behind `main` that reports every file `main` has since
 * rewritten as "modified", so a worktree holding nothing of its own can report
 * a dirty count in the dozens. A sweep that reads `modified` as "uncommitted
 * work at risk" then overstates the risk roughly fourfold: on 2026-10-02,
 * `history/migration-finalisation` reported 70 modified and 35 of them were
 * byte-identical to `main`, and `fix/header-menu-structure` reported 13 with 7
 * already on `main`. The work was already on `main`; only the branch tip was
 * behind.
 *
 * So `modified` stays exactly as it was — it is what the strict disposal test
 * needs, and making that test more permissive is the wrong direction — and this
 * answers the question a reader actually has: of the paths that differ from the
 * tip, how many differ from the BASE too, and are therefore content no commit
 * on the base holds?
 *
 * An untracked path counts here on its own: the base branch cannot hold a file
 * the branch never tracked, so every untracked path is content only this
 * directory has. That is the shape `git worktree remove --force` destroys.
 *
 * Failure is counted as `notOnBase`. A path whose blob cannot be hashed — a
 * filename `git status` quoted because it contains a space or a newline, a file
 * deleted mid-scan — cannot be proven to be on the base either, and the safe
 * direction to be wrong in is the one that keeps the work.
 */
function notOnBase(cwd, base, { modifiedPaths, untracked }) {
  const onBase = new Set();

  if (modifiedPaths.length > 0) {
    // Two batched calls rather than two per path: a worktree can report
    // hundreds of modified paths and this runs for every worktree in the
    // repository.
    //
    // `hash-object` prints one hash per argument, in order, which pairs with
    // `modifiedPaths` positionally. `ls-tree` prints only the paths that DO
    // exist on the base, so a missing path is absent from the set below and
    // counts as not-on-base, which is the correct reading: the base has no such
    // path at all.
    const hashes = git(cwd, ['hash-object', '--', ...modifiedPaths]);
    const tree = git(cwd, ['ls-tree', base, '--', ...modifiedPaths]);

    if (hashes !== null && tree !== null) {
      const worktreeHashes = hashes.split('\n').filter(Boolean);
      const baseBlobs = new Map();
      for (const line of tree.split('\n')) {
        if (!line.trim()) continue;
        const tab = line.indexOf('\t');
        if (tab === -1) continue;
        const [meta] = [line.slice(0, tab)];
        const path = line.slice(tab + 1);
        const blob = meta.split(/\s+/)[2];
        if (blob) baseBlobs.set(path, blob);
      }
      modifiedPaths.forEach((path, i) => {
        const mine = worktreeHashes[i];
        const theirs = baseBlobs.get(path);
        if (mine && theirs && mine === theirs) onBase.add(path);
      });
    }
  }

  return modifiedPaths.filter((p) => !onBase.has(p)).length + untracked;
}

/**
 * Everything the working tree holds that no commit does.
 *
 * Split into modified vs untracked because they are recovered differently: a
 * modified file is `git diff` away from a commit, an untracked file is on no
 * ref at all and is destroyed by `git worktree remove --force`.
 *
 * `notOnBase` is the subset of `modified` whose content the base branch does
 * not already hold, plus every untracked path — see `notOnBase` above for why
 * it is reported next to the count rather than instead of it.
 */
function workingTreeState(cwd, base) {
  const out = git(cwd, ['status', '--porcelain']);
  if (out === null) return { modified: 0, untracked: 0, notOnBase: 0, paths: [] };

  const paths = [];
  const modifiedPaths = [];
  let modified = 0;
  let untracked = 0;

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    paths.push(line.slice(3));
    if (line.startsWith('??')) untracked += 1;
    else {
      modified += 1;
      modifiedPaths.push(line.slice(3));
    }
  }

  const offBase = base ? notOnBase(cwd, base, { modifiedPaths, untracked }) : modified + untracked;

  return { modified, untracked, notOnBase: offBase, paths };
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
export function collectWorktrees(cwd, { base } = {}) {
  // NO DEFAULT, and the absence is the point: a defaulted `base` is a literal
  // `main` waiting for a checkout that has none, and the caller above is the only
  // thing that can notice. `resolveBaseRef` is where the question belongs.
  // `== null` and NOT `=== undefined`, which is the check that was there and the
  // reason this bug survived: the generator's own default for `base` is `null`,
  // so an `undefined` check let the one caller that matters through with no base
  // at all, and every ahead/behind it reported was null.
  if (base === undefined || base === null) {
    throw new Error(
      'collectWorktrees needs a base that resolveBaseRef has already resolved, and null is not one: ' +
        'every ahead/behind and merged-into-base answer would be null'
    );
  }
  const root = resolve(cwd);
  const worktrees = listWorktrees(root);
  const nameCollisions = historicalNameCollisions(root, base);

  return worktrees.map((w) => {
    const { ahead, behind } = aheadBehind(w.path, base);
    const tree = workingTreeState(w.path, base);
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
      // Advisory, and deliberately not part of any verdict — see the note on
      // `historicalNameCollisions` for the inference it exists to block.
      nameCollisions: nameCollisions.get(w.branch) ?? [],
    };
  });
}

/**
 * Branches whose NAME already appears in a merge subject on `base`.
 *
 * WHY THIS IS A FIELD AND NOT A STATUS
 * ------------------------------------
 * On 2026-10-01 a sweep read `git log --grep=fix/stale-citations`, found
 * `merge(fix/stale-citations): two TEST-FLAKES citations no longer point at what
 * they claim`, and concluded the branch was already landed — so it deleted a
 * worktree a live chat was using. That merge was fourteen hours old and of an
 * unrelated dead branch; the live branch's tip was not an ancestor of `main`, and
 * `action` had already said so. The name was the only thing that misled.
 *
 * So this is advisory. It changes no status, no recommendation and no
 * `action`, because a branch whose name was used before is neither safer nor more
 * dangerous than one whose name was not — `mergedIntoBase` is the fact, and it is
 * already computed. What the flag buys is that a reader who was about to make the
 * name-shaped inference sees, in the same record, that the inference is available
 * to make and does not hold.
 *
 * ONE SCAN FOR ALL WORKTREES
 * --------------------------
 * Scoped to `base` rather than `--all`, and run once per collection rather than
 * once per worktree: at 99 worktrees the per-worktree form is 99 `git log`
 * invocations over the whole history.
 *
 * EVERY BRANCH NAME THE SUBJECT MENTIONS, NOT THE FIRST ONE
 * -------------------------------------------------------
 * Two shapes exist and the naive reading of each is wrong. `merge(<name>):` names
 * the merged branch. `Merge branch '<a>' into <b>` names TWO branches, and the
 * first quoted one is the branch merged *in* — so matching only the leading
 * quote credited `main` with every "Merge branch 'main' into <feature>" on a
 * feature branch, 126 collisions on this repository, while a branch whose name
 * only ever appears in the `into` position got an empty list. Both names are
 * recorded. `base` is skipped entirely: every fast-forward into it says
 * "Merge branch 'main'", so listing it would be the base branch claiming a
 * hundred merges of itself.
 *
 * A base ref that does not resolve — `--base trunk` on a clone whose default is
 * `main` — yields an empty map. `git()` returns its fallback and never throws,
 * which is the contract `aheadBehind` and `isMergedInto` already rely on to
 * degrade rather than fail; re-wrapping it in a `try` that expected a throw and
 * then reading the result outside it turned that degradation into a
 * `TypeError` that killed the whole generator.
 */
export function historicalNameCollisions(cwd, base = 'main') {
  const out = git(cwd, ['log', base, '--format=%H%x09%cI%x09%s']);
  const found = new Map();
  if (!out) return found;
  for (const line of out.split('\n')) {
    const [sha, date, subject] = line.split('\t');
    if (!sha || !subject) continue;
    const names = new Set([...branchNamesInSubject(subject)].filter((n) => n && n !== base));
    if (names.size === 0) continue;
    for (const name of names) {
      const list = found.get(name) ?? [];
      // Newest first, because `git log` is newest first and a reader wants the
      // most recent merge that carries this name, not the first one ever written.
      list.push({ sha, subject, date });
      found.set(name, list);
    }
  }
  return found;
}

/**
 * Every branch name a merge subject mentions.
 *
 * Exported for its own test rather than inlined, because the two shapes are
 * easy to get wrong in the direction that matters: attributing a collision to
 * the wrong branch is worse than reporting none, since the field exists to stop
 * a reader trusting a name.
 */
export function branchNamesInSubject(subject) {
  const names = [];
  const paren = /^merge\(([^)]+)\)/.exec(subject);
  if (paren) names.push(paren[1]);
  const into = /^Merge branch '([^']+)' into (.+)$/.exec(subject);
  if (into) names.push(into[1], into[2]);
  // A bare `Merge branch '<name>'` is the fast-forward wording, where the merged
  // branch is the only name present.
  const plain = /^Merge branch '([^']+)'/.exec(subject);
  if (plain && !into) names.push(plain[1]);
  return names;
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

export const __testables = {
  aheadBehind,
  workingTreeState,
  tipCommit,
  isMergedInto,
  commitsAhead,
  resolveBaseRef,
  isShallow,
};
