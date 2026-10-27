#!/usr/bin/env node
/**
 * A merge must not quietly delete the other side's work.
 * --------------------------------------------------
 * `docs/ORCHESTRATION.md` carries one recipe for this, the `comm -13` set difference, and
 * it is the whole of the current protection. Three things are wrong with it, and this
 * program exists because of them.
 *
 * WHERE IT LIVES. It began as prose in a long document, which the agent it was meant to
 * protect was not obliged to read, and that is why it needed code: a rule nobody is told
 * about is a rule nobody runs. `AGENTS.md` now names this guard under **Worktrees and dev
 * servers**, which is where the rule is stated for every session.
 *
 * WHEN IT IS CORRECT. Only AFTER the merge is committed. Before the commit, `HEAD` is
 * still the pre-merge tip, so `main..HEAD` measures the un-merged tree and the recipe
 * reports hundreds of paths that are not reverts at all. Both a subagent and the author
 * hit that false positive during the sweep that motivated this file; a check that cries
 * wolf in its ordinary mode teaches its readers to skip it, which is worse than having
 * none. The fix is to compute against the MERGE RESULT, which is what `git write-tree`
 * gives us, rather than against a moving ref.
 *
 * WHAT IT ACTUALLY DETECTS. The recipe asks "which files differ from `main` that this
 * branch never touched", which is a SUPERSET of the defect and mostly innocent. Measured:
 * merging a stale branch that never touched a file is SAFE — git's three-way merge keeps
 * `main`'s version, because only one side changed it. So the recipe flags the harmless case.
 *
 * The defect is narrower, and it has three shapes, none of which produces a conflict
 * marker. All three are the same thing: git decided a whole file by COPYING one side's
 * content, on a file the other side had a committed change to.
 *
 *   1. The result is the pre-divergence content (`add -A` in a worktree holding another
 *      HEAD's files). This is the recorded 17-file / 1,835-line incident in this repo.
 *   2. The result is the incoming side's file verbatim (`checkout --theirs` on a path).
 *   3. The result is HEAD's side of a path verbatim, having dropped the INCOMING side's
 *      content — `-X ours`, `-s ours`, or `git checkout --ours <path>`. Under `-s ours`
 *      this covers the WHOLE payload, including paths HEAD never touched, because that
 *      strategy applies nothing at all. A first draft of this shape scanned only the paths
 *      HEAD had changed and so reported the contested subset while calling the rest clean.
 *
 * Shape 1 is the one the recipe MISSES and the one that actually happened. An earlier draft
 * of this program required BOTH sides to have changed the path, on the theory that an
 * untouched file has nothing to lose — and that theory is what makes `add -A` invisible:
 * the branch did not change the file, it merely committed it, and committing the old
 * content is itself the change. The condition is therefore "main changed it", never "both
 * changed it" — which is why shape 3 is found by a SECOND scan inside `findTakeovers()`
 * rather than by narrowing this one.
 *
 * SHAPE 3, AND WHY IT NEEDED ITS OWN SCAN. Shapes 1 and 2 are both "the result is not
 * HEAD's file", so the original scan set — paths the merge MOVED relative to HEAD, that
 * HEAD had also changed — finds them by construction. Shape 3 is the one shape whose result
 * IS HEAD's file, so that set is empty and the shape was structurally invisible: measured
 * before this change, `git merge -X ours` on a contested path reported `clean — 0 path(s)
 * moved by the merge` while silently deleting the branch's line. `-s ours` is worse, because
 * it is git's standard idiom for recording a merge without taking its content, and it
 * discards the whole payload.
 *
 * The asymmetry was an accident, not a decision: `docs/ORCHESTRATION.md` documented
 * coverage of `checkout --theirs` and `-X theirs` and never said the inverse is invisible.
 * Both directions now report, and both are measured the same way: by `lostLineCount()`,
 * which asks whether a line the losing side committed is ABSENT from the result rather than
 * counting a diff. The counting measure was itself a false-positive source — `--numstat`
 * bills a moved line as a deletion plus an insertion, so a superset that reorders reported a
 * takeover while the line it claimed was lost sat in the result untouched — so all three
 * shapes use the content measure and `git diff --numstat` is not consulted at all.
 *
 * SYMMETRY. HEAD is the side being merged INTO, whatever repository it is, so this is
 * uniform: it protects a feature branch from losing its own work when it merges `main` in
 * just as it protects `main` from losing work when a branch lands. Both directions have
 * cost time in this repo.
 *
 * FAIL-CLOSED. If the incoming side cannot be identified, this refuses rather than
 * passing. A check that cannot tell reports success, and a false green here is the whole
 * failure mode this program exists to prevent.
 *
 * WHAT IT DOES NOT CATCH, because pretending otherwise would make it worse:
 * - a fast-forward landing: git never runs `pre-merge-commit` for one, so this never
 *   sees it. That path is structurally safe anyway — the branch tip contains main as an
 *   ancestor, so the result IS the branch tree and every difference from main is a change
 *   the branch made on purpose. Verified, not assumed.
 * - `--no-verify`, which bypasses every hook in the repository, this one included.
 * - `-X ours` against a branch that removed only lines still present in HEAD: the incoming
 *   side's remaining content all survives, and line-level deletions cannot be inferred from
 *   a whole-file copy. Those stay silent when HEAD is a superset. Whole-file deletions are
 *   different: an ignored deletion is counted as one lost incoming path, and an incoming
 *   deletion that removes HEAD's distinct committed content is reported unless resolve-undo
 *   proves it was an explicit modify/delete resolution.
 * - a REVERT the branch made deliberately and early, where main never had the change to
 *   lose. That is one of the two sides having `result == branch`, with `main` untouched,
 *   and it is not reported by design: an intentional revert is somebody's decision.
 * - a resolution that is NEITHER side's blob and still drops a line the losing side had.
 *   Measured reachable, and left unreported on purpose. Every shape here is a WHOLE-FILE
 *   one-sided decision — git copied one side's content for the entire path — and that is
 *   class that raises no conflict marker when Git chooses the side automatically. A manual
 *   conflict resolution that stages one whole side verbatim is still detected. A custom
 *   resolution that is neither side's blob is outside this gate: flagging every lossy custom
 *   resolution would also flag ordinary human conflict decisions and teach people to bypass it.
 * - `git merge --squash -X ours`. Not fixable here, and worth stating precisely: it produces
 *   a staged tree identical to HEAD's, so `git commit` answers "nothing to commit, working
 *   tree clean", there is no commit, there is no `MERGE_HEAD`, and neither hook fires. The
 *   branch's payload disappears with no event to hang a check on. `git merge --squash`
 *   WITHOUT a strategy flag is fine and does not need this guard: it stages the real merge
 *   result. The fix belongs in a `pre-push` check, where a branch's own diff against `main`
 *   has two sides to compare, not in a hook that never runs.
 *
 * WHAT AN INDEPENDENT REVIEW FOUND HERE, and what this file now does about it. Seven cases
 * were reproduced against the guard as it stood, each one a merge that destroyed committed
 * work and reported a clean pass — or, in one case, a crash. Five are listed above because
 * they are limits; two were bugs in the DISCERNMENT rather than the coverage, and both are
 * fixed and pinned by tests:
 *   - an add/add conflict resolved by `-X theirs`: no blob at the merge base, and the shape
 *     that names `checkout --theirs` as its producer asked for one before it would look.
 *   - a modify/delete resolution: an uncaught TypeError, because the losing side was HEAD's
 *     side and HEAD had deleted the path. `main()` catches `GuardError` only, so the hook
 *     exited 1 with a stack trace and no verdict.
 *   Also fixed, and each a case where something was destroyed silently: an added EMPTY file
 *   and an added GITLINK swallowed by `-s ours` (both measured zero lost); a commit whose
 *   entire substance is indentation, which trimming lines made invisible — and
 *   `npm run format` produces exactly that commit; a `-s ours` merge whose result then had a
 *   mode bit set, which three successive proxies for "already judged" each failed to exclude;
 *   and suspect blobs past the batch buffer, which answered `clean` because an unread blob
 *   measures as no loss. That last one was fail-OPEN and is now a refusal.
 *
 * The historical replay of the original seven fixes covered 407 merges on `main`: the same
 * 36 merges refused before and after, with the same kinds and paths. That count predates the
 * whole-file deletion checks below and is not a current replay total. A later adversarial
 * pass found that whole-file incoming deletions need both directions checked: an ignored
 * deletion loses incoming work, while an applied deletion can remove distinct HEAD work.
 * The latter is reported unless resolve-undo proves an explicit modify/delete resolution.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  isIsolatedIndex,
  isReviewedLandingSnapshot,
  readMergeHeadRefs,
  resolveWorktree,
} from './main-worktree-guard.mjs';

/**
 * Ceiling on one `cat-file --batch` response. A commit hook has a time budget and a memory
 * budget, and this is the knob that trades one for the other.
 *
 * It was 256 MiB, which six distinct ~61 MiB blobs exceed — and exceeding it used to be
 * silent. 1 GiB is comfortably above any single merge's blob set here while staying inside
 * what a commit hook may allocate. Past it the guard refuses; see `batchBlobs`.
 */
export const MAX_BLOB_BYTES = 1024 * 1024 * 1024;

/**
 * @typedef {{ path: string, reason: string }} Takeover
 */

export class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardError';
  }
}

function git(args, { cwd } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryGit(args, { cwd } = {}) {
  try {
    return git(args, { cwd }).trim();
  } catch {
    return null;
  }
}

function tryGitRaw(args, { cwd } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * The side being merged in.
 *
 * `MERGE_HEAD` is Git's prepared merge state and is available to `pre-commit`, both while a
 * conflicted merge is completed and when a clean merge was prepared with `--no-commit`.
 * The `pre-merge-commit` hook refuses every direct self-committing merge, so this guard does
 * not depend on what that hook can read. A clean merge must be
 * prepared with `--no-commit` and recorded by `git commit`, where the actual `MERGE_HEAD` can
 * be compared to the reviewed candidate SHA.
 *
 * If Git has not recorded a merge side in `MERGE_HEAD`, we REFUSE. A check that cannot tell
 * must not report success, because a false green here is the entire failure this program exists
 * to prevent.
 *
 * @param {string} cwd
 * @returns {string} the incoming commit
 */
export function resolveIncomingRef(cwd) {
  const mergeHeads = readMergeHeadRefs(cwd);
  if (mergeHeads.length > 1) {
    throw new GuardError(
      `refusing an octopus merge with ${mergeHeads.length} incoming commits; this guard verifies one candidate at a time.\n` +
        '       Abort this merge and prepare separate pairwise merges so every incoming commit gets its own review.'
    );
  }
  if (mergeHeads.length === 1) {
    const mergeHead = tryGit(['rev-parse', '--verify', '--quiet', `${mergeHeads[0]}^{commit}`], { cwd });
    if (mergeHead) return mergeHead;
    throw new GuardError('MERGE_HEAD does not identify a valid incoming commit');
  }
  throw new GuardError(
    'cannot identify the incoming commit: Git has not written MERGE_HEAD.\n' +
      '       Prepare clean landing merges with `git merge --no-commit --no-ff <full-reviewed-sha>`, then commit.\n' +
      '       Reflog text is not proof of the merge side; this guard refuses rather than passing blind.'
  );
}

/**
 * Every path whose result blob is exactly the incoming side's blob while both sides had
 * moved it off the merge base.
 *
 * @param {{ cwd?: string, head?: string, incoming?: string, resultTree?: string }} options
 * @returns {{ takeovers: Takeover[], scanned: number, incoming: string, base: string }}
 */
export function findTakeovers({ cwd = process.cwd(), head, incoming, resultTree } = {}) {
  const headRef = head ?? tryGit(['rev-parse', 'HEAD'], { cwd });
  if (!headRef) throw new GuardError('not a git repository, or HEAD does not resolve');

  const incomingRef = incoming ?? resolveIncomingRef(cwd);
  const base = tryGit(['merge-base', headRef, incomingRef], { cwd });
  if (!base) {
    throw new GuardError(`${headRef} and ${incomingRef} share no merge-base; nothing to compare`);
  }

  // The merge result, as git has it staged. This is why this runs in the hook and not
  // after: after the commit, HEAD has already moved and the comparison is unrecoverable.
  const result = resultTree ?? tryGit(['write-tree'], { cwd });
  if (!result) {
    throw new GuardError('git write-tree failed; cannot read the staged merge result');
  }

  // `-m` diffs merge-base against each side, so this is precisely "what each side changed
  // since they diverged" and needs no parent arithmetic.
  const listPaths = (args, side) => {
    // `-z` makes paths NUL-delimited. Do not trim this output: a legal path may begin
    // with spaces or tabs, and trim() would silently change the first path before the
    // tree maps are consulted.
    const output = tryGitRaw(args, { cwd });
    if (output === null) {
      throw new GuardError(`git diff failed while listing ${side} paths; cannot verify the merge result`);
    }
    return splitNulRecords(output, `git diff ${side}`).map((path) => decodeGitPath(path, `git diff ${side}`));
  };
  const toHead = listPaths(['diff', '--name-only', '-z', '-m', base, headRef], 'HEAD-side');
  const toIncoming = listPaths(['diff', '--name-only', '-z', '-m', base, incomingRef], 'incoming-side');
  const resultVsHead = listPaths(['diff', '--name-only', '-z', headRef, result], 'result');

  const changedByHead = new Set(toHead);
  const changedByIncoming = new Set(toIncoming);
  const movedByMerge = resultVsHead;
  const moved = new Set(movedByMerge);

  // Four trees, four subprocesses, whatever the merge size. The per-path `rev-parse` this
  // replaced cost four spawns EACH, which measured 3.6s of a commit hook on a 513-path
  // merge here and grows linearly without bound; a commit hook has a budget.
  const trees = {
    base: readTreeBlobs(base, cwd),
    head: readTreeBlobs(headRef, cwd),
    incoming: readTreeBlobs(incomingRef, cwd),
    result: readTreeBlobs(result, cwd),
  };
  const resolvedModifyDeletePaths = readResolvedModifyDeletePaths(cwd, trees);

  /** @type {{ path: string, kind: string, reason: (n: number) => string }[]} */
  const suspects = [];
  // The paths shapes 1 and 2 reached a verdict on, so shape 3 can skip exactly those rather
  // than a proxy for them. Three proxies were tried and every one of them left a hole:
  // `moved.has(path)` misses a `-s ours` merge whose result then had a mode bit set in the
  // index — moved was empty, the path "moved" by mode alone, shape 3 skipped, shapes 1 and 2
  // found neither the base's entry nor the incoming one, and the branch's committed rewrite
  // went unreported behind a clean pass. `moved && changedByHead` misses the same thing one
  // step later. Only the answer to "did they already rule on this path" is correct.
  const judged = new Set();

  // Shape 1 and shape 2: the merge MOVED the path relative to HEAD, and its result is one
  // whole side's blob. Only a path HEAD itself changed since the two sides diverged can
  // have lost something by moving — a file nobody touched has nothing to lose.
  for (const path of movedByMerge) {
    if (!changedByHead.has(path)) continue;

    const baseBlob = trees.base.get(path);
    const headBlob = trees.head.get(path);
    const incomingBlob = trees.incoming.get(path);
    const resultBlob = trees.result.get(path);
    // `incomingBlob` and `resultBlob` are all BOTH shapes below need, and no more. Asking for
    // a `baseBlob` here too is what silently dropped every add/add conflict: `-X theirs` on
    // one takes the branch's file wholesale, main's committed file is gone, there is no
    // conflict marker anywhere, and the shape that names `checkout --theirs` as its producer
    // never ran because the merge base had no such path. Measured, in a throwaway repo:
    // `scanned=1 takeovers=0`, exit 0, main's content replaced.
    if (!incomingBlob || !resultBlob) continue;
    // The two sides already agree: whatever they did to this file, there is nothing
    // for the merge to lose.
    if (sameEntry(incomingBlob, headBlob)) continue;

    if (baseBlob && sameEntry(resultBlob, baseBlob)) {
      // `git add -A` in a feature worktree while the root checkout sat at another HEAD:
      // the branch committed the pre-divergence content of a file it never worked on,
      // so the merge handed main back its own older version. This is the shape that cost
      // this repository 17 files and 1,835 lines, recorded at docs/ORCHESTRATION.md with
      // no conflict anywhere in it.
      judged.add(path);
      suspects.push({
        path,
        kind: 'restored-pre-divergence-content',
        losing: headBlob ?? absent(),
        reason: (n) =>
          headBlob
            ? `the result is byte-for-byte the pre-divergence content from ${truncate(base)}, so main's committed change to it was undone (${n} line(s) of its own are absent)`
            : `the result is byte-for-byte the pre-divergence content from ${truncate(base)}, undoing the deletion the merged-into side had committed here`,
      });
    } else if (sameEntry(resultBlob, incomingBlob)) {
      // `git checkout --theirs <file>`, or any resolution that keeps one whole side.
      //
      // A path the merged-into side DELETED is not a takeover under this shape: it held no
      // content here to lose, and the branch adding a file is the branch doing its job. It is
      // a takeover under the shape above, which is the one that undoes a deletion — and it is
      // reached there because a deletion is a `headBlob` of `undefined`, so skipping here is
      // what keeps `losing` from being `undefined` for the measure to dereference.
      if (!headBlob) continue;
      judged.add(path);
      suspects.push({
        path,
        kind: 'whole-file-takeover',
        losing: headBlob,
        reason: (n) =>
          `the result is byte-for-byte the incoming side's ${truncate(incomingRef)} and drops ${n} line(s) the merged-into side had, so its committed work is gone`,
      });
    }
  }

  // Shape 3, and the scan the original set could not express. `movedByMerge` is empty for
  // `-X ours` / `-s ours` because the result IS HEAD's tree, so this pass walks the paths
  // the INCOMING side changed instead — all of them, including the ones HEAD never
  // touched, because `-s ours` applies nothing at all and silently discards the whole
  // payload. Iterating HEAD's changes instead, as an earlier draft of this did, found only
  // the contested subset and reported the rest of a dropped commit as clean.
  for (const path of changedByIncoming) {
    // Already ruled on by shapes 1 or 2 above, which ran to completion first. See `judged`
    // for why a proxy for this was a measured miss.
    if (judged.has(path)) continue;

    const incomingBlob = trees.incoming.get(path);
    const headBlob = trees.head.get(path);
    const resultBlob = trees.result.get(path);
    if (!incomingBlob) {
      // Resolve-undo proves a person explicitly chose one side of the modify/delete
      // conflict. Keeping HEAD's file or accepting the incoming deletion is deliberate,
      // so the whole-file path scan must not call either choice silent loss.
      if (resolvedModifyDeletePaths.has(path)) continue;
      // A whole-file deletion is a committed change even though there are no branch bytes
      // to count. If the merge preserved HEAD's file wholesale, that deletion was discarded.
      // A line deletion is different: the remaining incoming content may all survive in a
      // HEAD superset, and the omitted line itself is not represented in the incoming tree.
      if (headBlob && headWon(resultBlob, headBlob)) {
        suspects.push({
          path,
          kind: 'discarded-incoming-change',
          losing: absent(),
          incomingDeletedPath: true,
          reason: () =>
            "the incoming side deleted this path, but the result kept the merged-into side's file, so the committed deletion did not land",
        });
      } else if (trees.base.get(path) && headBlob && !resultBlob && !sameEntry(headBlob, trees.base.get(path))) {
        // The opposite whole-file choice: the incoming deletion landed and removed distinct
        // content HEAD had committed since the base. A deletion has no blob to compare, and
        // an empty HEAD file has no lines to count, so this is one lost path rather than a
        // line count. If HEAD had not changed the path from base, the deletion is the normal
        // incoming change and there is no HEAD-side work to report lost.
        suspects.push({
          path,
          kind: 'discarded-merged-into-change',
          losing: headBlob,
          missingResultPath: true,
          incomingDeletedPath: true,
          reason: () =>
            "the incoming side deleted this path and the result removed it, so this side's committed change to the path did not land",
        });
      }
      continue;
    }
    // A staged modify/delete resolution that chose deletion has no HEAD or result blob.
    // Its resolve-undo stages prove this was an explicit conflict decision; the ours
    // strategy leaves no such record and must still be reported.
    if (!headBlob && !resultBlob && resolvedModifyDeletePaths.has(path)) continue;
    // Survived the merge verbatim. Nothing to measure.
    if (sameEntry(resultBlob, incomingBlob)) continue;
    // HEAD's side did NOT win wholesale, so git actually combined the two or somebody
    // resolved it by hand. See the boundary note in the header.
    if (!headWon(resultBlob, headBlob)) continue;

    suspects.push({
      path,
      kind: 'discarded-incoming-change',
      losing: incomingBlob,
      reason: (n) =>
        headBlob
          ? `the result kept the merged-into side's version of this path and ${n} line(s) the incoming side committed are absent from it, so that part of the commit did not land`
          : // Not "kept the merged-into side's version": HEAD has no version of a path it
            // deleted. Saying so was the wording a measured finding complained about, and it
            // is the sentence a reader uses to decide whether to rebase or re-apply.
            `the merged-into side DELETED this path, the result did not, and ${n} line(s) the incoming side committed are absent from it — so the deletion did not land either`,
    });
  }

  // One batched read for every blob any suspect needs, rather than two `git show` calls per
  // path. `--batch` is the only way to make content comparison flat in the number of paths.
  const wanted = new Set();
  for (const { path, losing, missingResultPath } of suspects) {
    if (missingResultPath) continue;
    if (losing.absent) continue;
    const resultBlob = trees.result.get(path);
    for (const entry of [losing, resultBlob]) {
      if (entry && !entry.gitlink && entry.oid) wanted.add(entry.oid);
    }
  }
  const contents = batchBlobs([...wanted], cwd);

  const takeovers = [];
  for (const suspect of suspects) {
    const path = suspect.path;
    const losing = suspect.losing;
    const resultBlob = trees.result.get(path);

    if (suspect.missingResultPath) {
      if (!resultBlob) {
        takeovers.push({
          path,
          kind: suspect.kind,
          deleted: 1,
          ...(suspect.incomingDeletedPath ? { incomingDeletedPath: true } : {}),
          reason: suspect.reason(1),
        });
      }
      continue;
    }

    // A path the merged-into side deleted and the merge brought back: there is no blob on
    // that side to compare, so the loss is the DELETION rather than any line of it. Counted
    // as one, because `git status` will say one file and not zero.
    if (losing.absent) {
      if (resultBlob) {
        takeovers.push({
          path,
          kind: suspect.kind,
          deleted: 1,
          ...(suspect.incomingDeletedPath ? { incomingDeletedPath: true } : {}),
          reason: suspect.reason(1),
        });
      }
      continue;
    }

    // A gitlink is a submodule pointer, not content: there are no lines to compare, so a
    // changed pointer — or a pointer that is simply gone — is the whole of what was lost.
    // The absent case matters because a branch that ADDS a submodule and is then swallowed
    // by `-s ours` leaves no result entry at all, which read as nothing lost.
    const contentLost =
      losing.gitlink || resultBlob?.gitlink
        ? (resultBlob?.oid ?? null) === losing.oid
          ? 0
          : 1
        : lostLineCount(contents.get(losing.oid), resultBlob ? contents.get(resultBlob.oid) : null);
    const modeLost = resultBlob && losing.mode !== resultBlob.mode ? 1 : 0;
    const lost = Math.max(contentLost, modeLost);

    // Copying one whole side is not by itself a loss, and treating it as one is how a gate
    // gets `--no-verify`'d. Resolving `git merge main` with `--theirs` is ordinary and
    // often CORRECT: main's version is frequently a superset of the branch's, the branch's
    // own lines and all. So the only question that decides it is whether the losing side
    // has a line the result genuinely does not contain.
    if (lost > 0) {
      takeovers.push({
        path,
        kind: suspect.kind,
        deleted: lost,
        ...(suspect.incomingDeletedPath ? { incomingDeletedPath: true } : {}),
        reason: suspect.reason(lost),
      });
    }
  }

  takeovers.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    takeovers,
    // Paths either pass could judge, which is deliberately NOT "paths the merge moved":
    // a `-s ours` merge moves nothing and discards everything, and its clean line used to
    // say so.
    scanned: new Set([...movedByMerge, ...changedByIncoming]).size,
    incoming: incomingRef,
    base,
    head: headRef,
  };
}

/**
 * Whether the result holds HEAD's CONTENT for this path.
 *
 * OID only, and that is the whole distinction with `sameEntry`. This asks "did the
 * merged-into side's version of these bytes win?", which is a question about content;
 * `sameEntry` asks "is this the same file, mode and all?", which is what shapes 1 and 2
 * need in order to recognise one whole side being copied.
 *
 * `undefined` for both sides counts as HEAD's side winning: HEAD deleted the path, or
 * never had it, and the result does not have it either. That is precisely what `-s ours`
 * produces for a path only the incoming side ever touched — the whole-payload case, and the
 * one an earlier draft missed by requiring HEAD to have changed the path.
 *
 * The commit that introduced this called it exactly `!moved.has(path)` and measured the
 * equivalence across five merge shapes. It is false, and the sixth is small: a `-X ours`
 * merge whose result then had `git update-index --chmod=+x` run over it. The OID is still
 * HEAD's, so HEAD's content had won — but the path had "moved" by mode, and shape 3 skipped
 * on `moved`, so the branch's committed content went unreported behind a clean pass.
 */
function headWon(resultBlob, headBlob) {
  return (resultBlob?.oid ?? null) === (headBlob?.oid ?? null);
}

/**
 * Two tree entries are the same side's content only if the blob AND the mode agree.
 *
 * `null`/`undefined` is "this side does not have the path", which compares equal to itself
 * and to nothing else — the case where a deletion is compared against a deletion.
 */
function sameEntry(a, b) {
  if (!a || !b) return (!a?.oid ?? null) === (!b?.oid ?? null);
  return a.oid === b.oid && a.mode === b.mode;
}

/** A tree entry standing for a path the protected side does not have. */
function absent() {
  return { oid: null, mode: null, gitlink: false, absent: true };
}

function splitNulRecords(buffer, source) {
  const records = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end < 0) {
      throw new GuardError(`${source} returned an unterminated path record; refusing to compare partial paths`);
    }
    if (end === start) {
      throw new GuardError(`${source} returned an empty path record; refusing to compare a partial path list`);
    }
    records.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return records;
}

function decodeGitMetadata(bytes, source) {
  if (bytes.some((byte) => byte > 0x7f)) {
    throw new GuardError(`${source} returned non-ASCII metadata; refusing to parse ambiguous fields`);
  }
  return bytes.toString('ascii');
}

function decodeGitPath(bytes, source) {
  const path = decodeUtf8(bytes);
  if (path === null) {
    throw new GuardError(
      `${source} returned a path that is not valid UTF-8; refusing to compare ambiguous path identities`
    );
  }
  return path;
}

function readResolvedModifyDeletePaths(cwd, trees) {
  const raw = tryGitRaw(['ls-files', '--resolve-undo', '-z'], { cwd });
  if (raw === null) {
    throw new GuardError(
      'git ls-files --resolve-undo failed; cannot distinguish a resolved deletion from a silent strategy discard'
    );
  }

  const stagesByPath = new Map();
  for (const entry of splitNulRecords(raw, 'git ls-files --resolve-undo')) {
    const separator = entry.indexOf(0x09);
    if (separator < 0) {
      throw new GuardError('git ls-files --resolve-undo returned an invalid entry; refusing to guess');
    }
    const metadata = decodeGitMetadata(entry.subarray(0, separator), 'git ls-files --resolve-undo');
    const fields = /^(100644|100755|120000|160000) ([0-9a-f]{40}|[0-9a-f]{64}) ([123])$/.exec(metadata);
    if (!fields) {
      throw new GuardError('git ls-files --resolve-undo returned invalid metadata; refusing to guess');
    }
    const mode = fields[1];
    const oid = fields[2];
    const stage = Number(fields[3]);
    const filePath = decodeGitPath(entry.subarray(separator + 1), 'git ls-files --resolve-undo');
    if (!filePath) {
      throw new GuardError('git ls-files --resolve-undo returned an invalid entry; refusing to guess');
    }
    const stages = stagesByPath.get(filePath) ?? new Map();
    if (stages.has(stage)) {
      throw new GuardError(
        'git ls-files --resolve-undo returned a duplicate path/stage record; refusing to infer an explicit resolution'
      );
    }
    stages.set(stage, { mode, oid });
    stagesByPath.set(filePath, stages);
  }

  for (const [filePath, stages] of stagesByPath) {
    for (const [stage, entry] of stages) {
      const tree = stage === 1 ? trees.base : stage === 2 ? trees.head : trees.incoming;
      const expected = tree.get(filePath);
      if (!expected || expected.mode !== entry.mode || expected.oid !== entry.oid) {
        throw new GuardError(
          'git ls-files --resolve-undo returned metadata inconsistent with the merge trees; refusing to infer an explicit resolution'
        );
      }
    }
  }

  // Stage 1 plus exactly one side means a modify/delete conflict resolved by keeping the
  // present side. Track either direction so an explicit deletion is distinguished from a
  // strategy result that silently chose deletion.
  return new Set(
    [...stagesByPath]
      .filter(([, stages]) => stages.has(1) && stages.has(2) !== stages.has(3))
      .map(([filePath]) => filePath)
  );
}

function truncate(sha) {
  return sha.slice(0, 8);
}

function displayPath(path) {
  return JSON.stringify(path).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
    const codePoint = character.codePointAt(0);
    return `\\u{${codePoint.toString(16)}}`;
  });
}

/**
 * Every path in a tree with the blob it resolves to. One subprocess for the whole tree.
 *
 * `git rev-parse <tree>:<path>` answers the same question one path at a time, and that is
 * what this replaced: it cost a process spawn per path, which on a large merge is the
 * difference between a hook that runs in tens of milliseconds and one that runs in seconds.
 */
function readTreeBlobs(treeish, cwd) {
  const raw = tryGitRaw(['ls-tree', '-r', '-z', '--full-tree', treeish], { cwd });
  const map = new Map();
  // Same reasoning as `batchBlobs`, and worse here: an empty map from ONE of the four
  // trees makes every path look absent from it, which silently empties all four scans at
  // once. `ls-tree` overflows its buffer on a tree large enough to do that, so this is a
  // size failure wearing a "no such ref" costume.
  if (raw === null) {
    throw new GuardError(
      `could not list the tree of ${truncate(treeish)}. Refusing rather than comparing against an empty one: ` +
        'a path missing from a tree reads as a path that side never had.'
    );
  }
  for (const entry of splitNulRecords(raw, `git ls-tree ${truncate(treeish)}`)) {
    const tab = entry.indexOf(0x09);
    if (tab < 0) {
      throw new GuardError(`git ls-tree ${truncate(treeish)} returned an invalid entry; refusing to guess`);
    }
    const metadata = decodeGitMetadata(entry.subarray(0, tab), `git ls-tree ${truncate(treeish)}`);
    const fields = /^(100644|100755|120000|160000) (blob|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(metadata);
    if (!fields || (fields[1] === '160000' ? fields[2] !== 'commit' : fields[2] !== 'blob')) {
      throw new GuardError(`git ls-tree ${truncate(treeish)} returned invalid entry metadata; refusing to guess`);
    }
    const [, mode, , oid] = fields;
    // `mode` as well as the OID, because an entry is not its blob: a mode bit is a
    // committed change of its own, and comparing OIDs alone cannot see it change or be
    // changed. See `sameEntry`.
    const filePath = decodeGitPath(entry.subarray(tab + 1), `git ls-tree ${truncate(treeish)}`);
    if (!filePath || map.has(filePath)) {
      throw new GuardError(`git ls-tree ${truncate(treeish)} returned an empty or duplicate path; refusing to guess`);
    }
    map.set(filePath, { oid, mode, gitlink: mode === '160000' });
  }
  return map;
}

/**
 * Read many blobs in one process, via `git cat-file --batch`.
 *
 * @param {string[]} oids
 * @param {string} cwd
 * @param {{ maxBytes?: number }} [options]
 * @returns {Map<string, Buffer>} absent where the object could not be read
 * @throws {GuardError} when the batch cannot be read. It does NOT return an empty map:
 * an empty map reads as "this blob has no lines", every measure returns 0, and a merge
 * that dropped six large assets reports a clean pass. That is fail-OPEN on the one path
 * where the loss is largest, and it is reachable: `maxBuffer` was 256 MiB while six
 * distinct ~61 MiB assets exceed it, `execFileSync` throws `ENOBUFS`, and the `catch` ate
 * it. A photo editor is plausibly the project most likely to merge large binaries. The
 * cap is now 1 GiB, and past it the guard refuses rather than passes — refusing is a
 * nuisance and passing is the failure this program exists to prevent.
 */
export function batchBlobs(oids, cwd, { maxBytes = MAX_BLOB_BYTES } = {}) {
  const out = new Map();
  if (oids.length === 0) return out;
  let buf;
  try {
    // No `encoding`: omitting it is what makes execFileSync return a Buffer. `encoding:
    // 'buffer'` is NOT valid — Node throws ERR_UNKNOWN_ENCODING — and because this function
    // swallows its own errors, that mistake returns an empty map and silently disables
    // every content comparison rather than failing. The suite's shape-3 tests are what
    // catch it; a helper that fails quietly is the reason they exist.
    buf = execFileSync('git', ['cat-file', '--batch'], {
      cwd,
      input: `${oids.join('\n')}\n`,
      maxBuffer: maxBytes,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new GuardError(
      `could not read ${oids.length} blob(s) in one batch (${error?.code ?? error?.message ?? 'unknown error'}). ` +
        'Refusing rather than comparing nothing: an unread blob measures as no loss at all, which is the one answer that must not be guessed.'
    );
  }
  const remaining = new Map();
  for (const oid of oids) remaining.set(oid, (remaining.get(oid) ?? 0) + 1);

  let offset = 0;
  while (offset < buf.length) {
    const newline = buf.indexOf(0x0a, offset);
    if (newline < 0)
      throw new GuardError(
        'git cat-file --batch returned an incomplete response header; refusing to compare partial content'
      );
    const header = buf.toString('utf8', offset, newline);
    const fields = header.split(' ');
    const [oid, type, sizeText] = fields;
    const requested = remaining.get(oid) ?? 0;
    if (fields.length === 2 && fields[1] === 'missing') {
      throw new GuardError(
        `git cat-file --batch could not read requested blob ${oid}; refusing to compare partial content`
      );
    }
    if (fields.length !== 3 || requested === 0 || type !== 'blob' || !/^(0|[1-9]\d*)$/.test(sizeText ?? '')) {
      throw new GuardError(
        'git cat-file --batch returned an unexpected object header; refusing to compare partial content'
      );
    }
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new GuardError('git cat-file --batch returned an invalid object size; refusing to compare partial content');
    }
    const start = newline + 1;
    const end = start + size;
    if (end >= buf.length || buf[end] !== 0x0a) {
      throw new GuardError(
        `git cat-file --batch returned truncated content for ${oid}; refusing to compare partial content`
      );
    }
    out.set(oid, buf.subarray(start, end));
    if (requested === 1) remaining.delete(oid);
    else remaining.set(oid, requested - 1);
    // `--batch` puts a newline after the content, and a blob may itself end in one.
    offset = end + 1;
  }
  if (remaining.size > 0) {
    throw new GuardError(
      'git cat-file --batch omitted one or more requested blobs; refusing to compare partial content'
    );
  }
  return out;
}

/**
 * How many non-blank lines the losing side had that `result` does not contain.
 *
 * NOT a line count from `git diff --numstat`, and that is the whole point. `--numstat`
 * reports a MOVED line as one deletion plus one insertion, so a result that is a superset
 * in content but not in line order reads as a loss: with a branch line and a main line
 * swapping places, the guard reported a takeover while the branch's line sat in the result
 * untouched. Measured, and the reason string it produced — that the commit "landed as a
 * no-op" — was false at the same time.
 *
 * A multiset, not a set, so a file that repeats a line keeps its multiplicity. An empty
 * result means everything the losing side had is gone.
 *
 * Lines are keyed VERBATIM, with only the line ending normalised. Trimming them was wrong,
 * and measurably so: a branch whose entire commit is reindentation, or a change of line
 * ending, measured zero lost under `-X ours` and vanished behind a clean pass.
 * `npm run format` produces exactly that shape, so the blindness sat on this repository's
 * most common commit. Keying verbatim is sound in all three shapes precisely because the
 * result is byte-identical to one whole side, so there is no merge-computed whitespace to
 * excuse a difference: a line of the losing side that is not present verbatim is gone.
 */
function lostLineCount(losingBuf, resultBuf) {
  if (!losingBuf) return 0;
  // A path with no entry in the result at all. A `.gitkeep`, or a file the branch
  // created holding nothing but newlines, measures zero non-blank lines and read as
  // nothing lost — so a whole file could vanish behind a clean pass. One, because
  // `git status` will report one file and not zero.
  if (!resultBuf) return Math.max(nonBlankLines(losingBuf), isBlank(losingBuf) ? 1 : 0);
  // A NUL byte means the content is binary and lines mean nothing. Fall back to identity,
  // which is what `--numstat` does when it prints `-`.
  if (losingBuf.includes(0) || resultBuf.includes(0)) {
    return losingBuf.equals(resultBuf) ? 0 : Number.POSITIVE_INFINITY;
  }
  const losingText = decodeUtf8(losingBuf);
  const resultText = decodeUtf8(resultBuf);
  if (losingText === null || resultText === null) {
    return losingBuf.equals(resultBuf) ? 0 : Number.POSITIVE_INFINITY;
  }
  const available = new Map();
  for (const line of comparisonLines(resultText)) {
    const key = normaliseLine(line);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  let lost = 0;
  for (const line of comparisonLines(losingText)) {
    const key = normaliseLine(line);
    const held = available.get(key) ?? 0;
    if (held > 0) available.set(key, held - 1);
    else lost++;
  }
  return lost;
}

function decodeUtf8(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    return null;
  }
}

function comparisonLines(text) {
  const lines = text.split('\n');
  // One final newline terminates the last line; it is not an extra blank line. Any
  // additional terminal separator represents a blank record and remains content.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * A line with its line ending normalised and nothing else touched.
 *
 * CRLF is an artefact of a checkout rather than committed content, so it must not decide
 * whether a line survived. Indentation IS committed content, and normalising it away is
 * what let a commit whose entire substance is whitespace measure zero lost.
 */
function normaliseLine(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function isBlank(buf) {
  for (const line of buf.toString('utf8').split('\n')) {
    if (normaliseLine(line).trim() !== '') return false;
  }
  return true;
}

function nonBlankLines(buf) {
  let n = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (line.trim() !== '') n++;
  }
  return n;
}

function report({ takeovers, scanned, incoming, base, head, preparedMerge }) {
  const lines = [];
  if (takeovers.length === 0) {
    // "examined", not "moved by the merge": a `-s ours` merge moves NOTHING and discards
    // everything, and calling that 0 paths moved is how the original hole stayed invisible.
    lines.push(`merge-takeover-guard: clean — ${scanned} path(s) examined, none taken over wholesale.`);
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`merge-takeover-guard: REFUSING this merge — ${takeovers.length} path(s) would drop committed work.`);
  lines.push('');
  lines.push(`  merged into ${truncate(head)}   incoming ${truncate(incoming)}   merge-base ${truncate(base)}`);
  lines.push('');
  // The listing is bounded and the COUNT is not. A `-s ours` merge of a branch with hundreds
  // of changed paths is one refusal, and printing two lines per path buried the advice that
  // tells the operator what to do about it — which is how a gate gets `--no-verify`'d. The
  // headline count, the exit status and `findTakeovers().takeovers` are all unchanged, so
  // nothing here weakens the gate; it bounds prose only.
  const LISTED = 20;
  for (const { path, kind, reason } of takeovers.slice(0, LISTED)) {
    // The kind on every finding, not only where advice hangs off it: the three shapes are
    // three different bugs with three different fixes, and an operator reading a refusal
    // should not have to open this file to learn which one they are looking at.
    lines.push(`  ${displayPath(path)}  [${kind}]`);
    lines.push(`      ${reason}`);
  }
  if (takeovers.length > LISTED) {
    lines.push(`  ... and ${takeovers.length - LISTED} more path(s), all reported and all counted above.`);
    lines.push('      They share a shape: run this again with --manual, or read the paths off');
    lines.push('      `findTakeovers()`, rather than scrolling.');
  }
  lines.push('');
  lines.push('  A merge that reports success while deleting committed work is the failure this guard');
  lines.push('  exists for. Combine edits when both sides have content; make an explicit choice for');
  lines.push('  whole-file deletions. If one side is obsolete here, rebase the incoming branch onto');
  lines.push('  main and let git carry the conflict to you visibly.');
  if (takeovers.some((t) => t.kind === 'discarded-incoming-change')) {
    lines.push('');
    lines.push("  `discarded-incoming-change` means the merge kept this side and dropped the branch's,");
    lines.push('  which is what `git merge -X ours` and `git merge -s ours` do. `-s ours` is the');
    lines.push('  standard git idiom for recording a merge without taking its content; if that is');
    lines.push('  what you meant, `--no-verify` below is the way to say so.');
  }
  if (takeovers.some((t) => t.kind === 'discarded-merged-into-change')) {
    lines.push('  `discarded-merged-into-change` means the incoming side deleted a path that this');
    lines.push('  side had changed since the merge base, and that committed change was removed.');
  }
  lines.push('');
  lines.push('  Listed paths are JSON-escaped. Decode each string, then shell-quote the complete');
  lines.push('  revision:path argument; the JSON quotes are for display, not shell quoting.');
  lines.push('  To inspect a path present in both commits (replace <path> with its decoded path):');
  lines.push(`      git show ${head}:<path>   # the side being merged INTO`);
  lines.push(`      git show ${incoming}:<path>   # the incoming side`);
  lines.push('  These use the pinned commits above and work after Git has staged a resolution.');
  if (takeovers.some((t) => t.incomingDeletedPath)) {
    lines.push('  For an incoming whole-file deletion, the incoming commit has no blob at that path;');
    lines.push('  `git show <incoming-sha>:<path>` fails by design. Inspect the merged-into version;');
    lines.push('  that absence is the incoming change.');
  }
  lines.push('');
  lines.push(
    preparedMerge
      ? '  Bypass for a prepared merge you have verified by hand: git commit --no-verify'
      : '  Bypass for a merge you have verified by hand: git merge --no-verify <ref>'
  );
  lines.push('  Every gate in this repository is bypassable that way; say so in the commit.');
  return lines.join('\n');
}

export function main(argv, { cwd = process.cwd() } = {}) {
  const manual = argv.includes('--manual') || argv.includes('-m');
  try {
    const head = tryGit(['rev-parse', 'HEAD'], { cwd });
    if (!head) throw new GuardError('not a git repository, or HEAD does not resolve');
    const incoming = resolveIncomingRef(cwd);
    const resultTree = tryGit(['write-tree'], { cwd });
    if (!resultTree) throw new GuardError('git write-tree failed; cannot verify the prepared merge result');
    const required = isProjectMainWorktree(cwd);
    const worktree = resolveWorktree(cwd);
    const isolatedIndex = !required || isIsolatedIndex(worktree, cwd, process.env);
    const reviewedSnapshot = !required || isReviewedLandingSnapshot(worktree, cwd, process.env);
    assertExpectedLandingHeads({ head, incoming, resultTree }, process.env, {
      required,
      isolatedIndex,
      reviewedSnapshot,
      cwd,
    });
    const findings = findTakeovers({ cwd, head, incoming });
    if (findings.takeovers.length > 0) {
      process.stderr.write(`${report({ ...findings, preparedMerge: readMergeHeadRefs(cwd).length > 0 })}\n`);
      return 1;
    }
    if (manual) process.stdout.write(`${report({ ...findings, preparedMerge: readMergeHeadRefs(cwd).length > 0 })}\n`);
    return 0;
  } catch (error) {
    if (error instanceof GuardError) {
      process.stderr.write(`merge-takeover-guard: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/**
 * Bind a documented harvest landing to the exact main SHA, candidate SHA, and result tree that
 * were reviewed.
 *
 * In the project main worktree all three pins and a private index snapshot are required. On
 * feature worktrees pins are opt-in, but clean merges there must still use `--no-commit` so
 * `pre-commit` can read the actual MERGE_HEAD. The `pre-commit` hook checks main pins against
 * the isolated index after the merge is prepared and before the merge commit moves `main`;
 * refusing here prevents a stale-base or changed-tree composition from being recorded. If Git
 * leaves this caller's merge in progress after a
 * refusal, the caller may abort only that exact unresumed operation; it must never resolve it.
 *
 * @param {{ head:string, incoming:string, resultTree:string }} findings
 * @param {NodeJS.ProcessEnv} env
 * @param {{ required?:boolean, isolatedIndex?:boolean, reviewedSnapshot?:boolean, cwd?:string }} options
 */
export function assertExpectedLandingHeads(
  findings,
  env = process.env,
  { required = false, isolatedIndex = false, reviewedSnapshot = false, cwd = process.cwd() } = {}
) {
  const expectedMain = env.KILO_EXPECTED_MAIN_SHA;
  const expectedIncoming = env.KILO_EXPECTED_INCOMING_SHA;
  const expectedTree = env.KILO_EXPECTED_TREE_SHA;
  const expectedBranch = env.KILO_EXPECTED_BRANCH;
  const expectedChat = env.KILO_EXPECTED_CHAT_ID;
  if (!expectedMain && !expectedIncoming && !expectedTree && !expectedBranch && !expectedChat && !required) return;
  if (!expectedMain || !expectedIncoming || !expectedTree || !expectedBranch || !expectedChat) {
    throw new GuardError(
      'expected landing requires KILO_EXPECTED_MAIN_SHA, KILO_EXPECTED_INCOMING_SHA, KILO_EXPECTED_TREE_SHA, KILO_EXPECTED_BRANCH, and KILO_EXPECTED_CHAT_ID; refusing an incomplete pin set'
    );
  }
  if (findings.incomingCount !== undefined && findings.incomingCount !== 1) {
    throw new GuardError('expected landing requires exactly one incoming commit; octopus merges are refused');
  }
  if (findings.head !== expectedMain) {
    throw new GuardError(
      `main moved since the candidate was reviewed: expected ${truncate(expectedMain)}, prepared ${truncate(findings.head)}. ` +
        'Abort this landing attempt and sync, review, and gate the new composition in the candidate worktree.'
    );
  }
  if (findings.incoming !== expectedIncoming) {
    throw new GuardError(
      `incoming candidate changed since review: expected ${truncate(expectedIncoming)}, prepared ${truncate(findings.incoming)}. ` +
        'Abort this landing attempt and review and gate the actual candidate SHA in its worktree.'
    );
  }
  if (findings.resultTree !== expectedTree) {
    throw new GuardError(
      `prepared merge tree changed since review: expected ${truncate(expectedTree)}, prepared ${truncate(findings.resultTree)}. ` +
        'Abort this landing attempt and review and gate the actual result tree in the candidate worktree.'
    );
  }
  if (required && !isolatedIndex) {
    throw new GuardError(
      'main landing requires a private index snapshot so the tree cannot change after the final hook check. ' +
        'Use `node scripts/commit-reviewed-landing.mjs -m <message>` after preparing the merge.'
    );
  }
  if (required && !reviewedSnapshot) {
    throw new GuardError(
      'main landing requires a helper-created private index snapshot with a matching workflow marker and reviewed pins. ' +
        'Use `node scripts/commit-reviewed-landing.mjs -m <message>` after preparing the merge.'
    );
  }
  if (required) {
    const validBranch = tryGit(['check-ref-format', '--branch', expectedBranch], { cwd });
    const branchTip = validBranch
      ? tryGit(['rev-parse', '--verify', `refs/heads/${expectedBranch}^{commit}`], { cwd })
      : null;
    if (branchTip !== expectedIncoming) {
      throw new GuardError('expected source branch does not point to the reviewed incoming candidate');
    }
  }
}

/**
 * Main merges in this project occur in the checkout rooted beside the shared `.git`, with
 * `AGENTS.md` and `.kilo` present. Temporary repositories used by the test suite lack those
 * policy markers and retain the ordinary merge guard behavior.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function isProjectMainWorktree(cwd) {
  const worktree = resolveWorktree(cwd);
  if (!worktree?.isDesignatedMainWorktree) return false;
  const projectRoot = dirname(resolve(worktree.commonDir));
  return existsSync(join(projectRoot, 'AGENTS.md')) && existsSync(join(projectRoot, '.kilo'));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
