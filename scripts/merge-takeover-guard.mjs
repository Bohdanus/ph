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
 * - a merge whose result equals HEAD's file where the INCOMING side had nothing of its
 *   own there to lose — `-X ours` against a branch whose only change was a deletion, or
 *   against a file main already holds as a superset. Measured and asserted: those stay
 *   silent, because shape 3 asks whether the incoming side lost a line, not merely whether
 *   the result happened to match HEAD.
 * - a REVERT the branch made deliberately and early, where main never had the change to
 *   lose. That is one of the two sides having `result == branch`, with `main` untouched,
 *   and it is not reported by design: an intentional revert is somebody's decision.
 * - a resolution that is NEITHER side's blob and still drops a line the losing side had, on
 *   a path git REPORTED AS CONFLICTED. Measured reachable, and left unreported on purpose.
 *   Every whole-file shape here is a decision git made by COPYING one side's content for the
 *   entire path, and that is precisely the class that raises no conflict marker. A merge that
 *   DID conflict was visibly unmerged until somebody staged it, so its resolution is a human
 *   decision made in the open. Widening the refusal to lossy hand-resolutions of CONFLICTED
 *   paths would fire on ordinary conflict resolution, and the first agent to meet that would
 *   reach for `--no-verify`, which is how the two original shapes were nearly lost once
 *   already. `findHandResolutions` reports those resolutions and refuses none of them; the one
 *   exception is an ERASED test file, which no conflict record could have shown either way.
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
 * Replayed over EVERY merge on `main` before and after: the same merges refused, the
 * same kinds, the same paths. Every fix above is a shape that was invisible, not a verdict
 * that changed.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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

/**
 * The side being merged in.
 *
 * Two hooks, two difficulties, and the order matters. `MERGE_HEAD` is the honest answer and
 * is what `pre-commit` sees while a resolved conflict is being committed. It is NOT yet
 * written in `pre-merge-commit` — verified: it reads empty there, where
 * `prepare-commit-msg` milliseconds later reads it correctly. So `pre-merge-commit` falls
 * back to `GIT_REFLOG_ACTION`, which git sets to "merge <what-you-typed>".
 *
 * The fallback is the fragile path and it is confined to the hook that has no better
 * option. When neither is available we REFUSE. A check that cannot tell must not report
 * success, because a false green here is the entire failure this program exists to prevent.
 *
 * @param {string} cwd
 * @returns {string} the incoming commit
 */
export function resolveIncomingRef(cwd) {
  const mergeHead = tryGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD^{commit}'], { cwd });
  if (mergeHead) return mergeHead;

  const action = process.env.GIT_REFLOG_ACTION ?? '';
  const match = /^merge\s+(.+)$/.exec(action.trim());
  if (!match) {
    throw new GuardError(
      `cannot tell which ref is being merged in: no MERGE_HEAD, and GIT_REFLOG_ACTION=${JSON.stringify(action)}.\n` +
        `       This guard refuses rather than passing blind: a silent pass is the failure it exists to prevent.\n` +
        `       Outside a merge it has nothing to check — run it only from pre-commit or pre-merge-commit.`
    );
  }
  const named = match[1].trim();
  const resolved = tryGit(['rev-parse', '--verify', '--quiet', `${named}^{commit}`], { cwd });
  if (!resolved) {
    throw new GuardError(
      `GIT_REFLOG_ACTION names ${JSON.stringify(named)}, which does not resolve to a commit.\n` +
        `       Refusing rather than passing blind.`
    );
  }
  return resolved;
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
  const toHead = tryGit(['diff', '--name-only', '-z', '-m', base, headRef], { cwd }) ?? '';
  const toIncoming = tryGit(['diff', '--name-only', '-z', '-m', base, incomingRef], { cwd }) ?? '';
  const resultVsHead = tryGit(['diff', '--name-only', '-z', headRef, result], { cwd }) ?? '';

  const changedByHead = new Set(splitZ(toHead));
  const changedByIncoming = new Set(splitZ(toIncoming));
  const movedByMerge = splitZ(resultVsHead);
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
    // The branch deleted this path. Whatever HEAD holds is not the branch's content, so
    // there is nothing of the branch's own here to lose.
    if (!incomingBlob) continue;

    const headBlob = trees.head.get(path);
    const resultBlob = trees.result.get(path);
    // Survived the merge verbatim. Nothing to measure.
    if (resultBlob && resultBlob.oid === incomingBlob.oid) continue;
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
  for (const { path, losing } of suspects) {
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

    // A path the merged-into side deleted and the merge brought back: there is no blob on
    // that side to compare, so the loss is the DELETION rather than any line of it. Counted
    // as one, because `git status` will say one file and not zero.
    if (losing.absent) {
      if (resultBlob) {
        takeovers.push({
          path,
          kind: suspect.kind,
          deleted: 1,
          reason: suspect.reason(1),
        });
      }
      continue;
    }

    // A gitlink is a submodule pointer, not content: there are no lines to compare, so a
    // changed pointer — or a pointer that is simply gone — is the whole of what was lost.
    // The absent case matters because a branch that ADDS a submodule and is then swallowed
    // by `-s ours` leaves no result entry at all, which read as nothing lost.
    const lost =
      losing.gitlink || resultBlob?.gitlink
        ? (resultBlob?.oid ?? null) === losing.oid
          ? 0
          : 1
        : lostLineCount(contents.get(losing.oid), resultBlob ? contents.get(resultBlob.oid) : null);

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
 * THE SHAPE EVERY CONFLICT COUNT MISSES
 * ------------------------------------
 * A merge can be hand-edited in a file git merged CLEANLY, and `git show --remerge-diff`
 * shows that with no conflict marker anywhere. So this is a shape, and it is the reason the
 * three whole-file shapes above cannot see it: each of those asks whether the result IS one
 * side's blob, and a hand edit is by definition neither. The fix is to ask git what IT would
 * have produced and compare.
 *
 * THE MEASUREMENT. At `main` 7c32cd76, over 541 merges, every figure below produced by running
 * THIS function over every merge reachable from that ref — except the two counts it cannot see
 * from the outside, the hand-written resolutions as a whole and the conflicted paths, which need
 * `merge-tree`'s own `--name-only` list. A re-implementation of this measurement produced a
 * different answer three times, so the figures belong to the function and not to a script.
 *
 *   - 122 merges contain a hand-written resolution of some kind.
 *   - 297 paths were CONFLICTED and resolved by a human in the open, which is the boundary the
 *     three whole-file shapes above already draw and this one keeps.
 *   - 141 paths were hand-edited on a merge git had already resolved cleanly, across 39 merges;
 *     41 merges carry some reported finding of any kind. 136 of the 141 drop at least one line
 *     git's own merge had produced.
 *   - 10 paths git's merge produced are absent from their recorded result. EIGHT of the ten are
 *     `erased-after-clean-merge`: nothing but the resolution explains them, because the base did
 *     not have the file and one side ADDED it. Four of the eight are test files —
 *     `src/contexts/__tests__/history-model.rebind.test.ts`,
 *     `src/components/SidebarRight/__tests__/LayersTab.flatten.test.tsx`,
 *     `src/components/ToolbarsRight/PaintBucket/__tests__/PaintBucket.test.tsx` and
 *     `src/tools/__tests__/paint-bucket.test.ts` — and those four are merges that reached `main`.
 *   - The other two are `erased-by-a-side`: a reviewed commit removed the path, which includes
 *     every `modify/delete` conflict and is git's own recommendation there.
 *
 * WHAT IS REPORTED AND WHAT IS REFUSED, and why the line falls there.
 * - Every path a human changed after a CLEAN merge is REPORTED — 39 merges in 544 on this
 *   history — and several of those edits are correct: a hand-tidied import, a comment fixed
 *   during the merge. Refusing them would train every agent to reach for `--no-verify`, which is
 *   how the three shapes above were nearly lost once already.
 * - A path the resolution erased, that no side's commit removed, is REFUSED when it is a test.
 *   No conflict, no marker, no takeover shape, and no commit explains it. Four test files meet
 *   that description on this history and all four reached `main`, which is what makes this a gate
 *   rather than a report.
 * - A path a side's own commit had already deleted is reported and never refused.
 * - A path that was RENAMED is reported as a rename. With rename detection on, the erasure is
 *   invisible; with it off and no rename recognition, a legitimate rename is a false refusal.
 *   Both halves are needed and only both are correct.
 * - A path TRUNCATED rather than deleted is reported, not refused. Measured, refusing that would
 *   fire on 136 paths, and refusing a reworded hunk is how a gate teaches `--no-verify`.
 *
 * WHAT IT STILL CANNOT SEE, stated here so nobody relies on it.
 * - A strategy flag, and it is both undetectable and harmless here. `git merge -X ours` makes
 *   git take this side's hunk on a path it would otherwise have reported as conflicted, and this
 *   census then EXCLUDES that path, so the merge is silent rather than over-reported — measured
 *   with a hook installed, where `GIT_REFLOG_ACTION` for `git merge -X ours feat` is plain
 *   `merge feat`: git records a merge's RESULT, not its invocation, so no hook can read the flag
 *   and there was nothing to skip on. The direction is safe — a strategy option resolves a hunk
 *   and never removes a path, so it cannot cause the refusal — and the cost is silence on a merge
 *   whose whole point was to take no content. `-s ours` is caught by shape 3 instead.
 * - `rerere`. A recorded preimage resolves a conflict without a human, and the path is still in
 *   the CONFLICT set, so the census EXCLUDES it: measured, a rerere replay exits 0 with no output
 *   at all. Under-reporting is the safe direction — a recorded resolution that deleted a test file
 *   would be the dangerous variant, and git 2.50 cannot write one. `rerere.enabled` is unset here.
 */
export function findHandResolutions({ cwd = process.cwd(), head, incoming, resultTree } = {}) {
  const headRef = head ?? tryGit(['rev-parse', 'HEAD'], { cwd });
  if (!headRef) throw new GuardError('not a git repository, or HEAD does not resolve');
  const incomingRef = incoming ?? resolveIncomingRef(cwd);
  const result = resultTree ?? tryGit(['write-tree'], { cwd });
  if (!result) throw new GuardError('git write-tree failed; cannot read the staged merge result');

  const automatic = automaticMergeResult(headRef, incomingRef, cwd);
  if (automatic.skipped) {
    return { edits: [], scanned: 0, skipped: automatic.skipped, incoming: incomingRef, head: headRef };
  }

  // `--no-renames`, and it is not cosmetic. With rename detection on, a resolution that
  // RENAMES a merged test file reports only the destination, so the erasure — which is the
  // removal of coverage this gate exists for — is invisible. A rename is still recognised
  // below, from its own diff, so the honest answer is reported rather than refused.
  const differing = splitZ(
    tryGit(['diff', '--name-only', '-z', '--no-renames', automatic.tree, result], { cwd }) ?? ''
  );
  if (differing.length === 0) {
    return { edits: [], scanned: 0, skipped: null, incoming: incomingRef, head: headRef };
  }

  // A conflicted path was visibly unmerged until somebody staged it, so its resolution is a
  // human decision made in the open — which is the boundary the whole-file shapes above draw,
  // and it is drawn here for the same reason and not as a convenience. An ERASED path is the
  // exception below, and the exception does not ask whether git reported a conflict.
  const reported = differing.filter((path) => !automatic.conflicted.has(path));
  const renamedFrom = renameSources(automatic.tree, result, cwd);
  const autoEntries = readTreeBlobs(automatic.tree, cwd, differing);
  const resultEntries = readTreeBlobs(result, cwd, differing);

  /**
   * Every path git's merge PRODUCED that the result does not contain, whatever git said about
   * it. NOT filtered by `conflicted`, and that is the correction a regex-first version needed:
   * a `modify/delete` conflict's recommended resolution is to remove the path, so filtering it
   * out would miss a decision, and a `content` conflict resolved by deleting the file is the
   * coverage removal this gate exists for. Only ONE span is examined — which side, if any, had
   * already deleted it — and that span is what separates the two.
   */
  // The merge base is the only commit that can have DELETED anything, and it is what
  // tells a side that removed a path apart from a side that never carried one.
  const base = mergeBase(headRef, incomingRef, cwd);
  const erasures = new Map();
  for (const path of differing) {
    if (!autoEntries.get(path) || resultEntries.get(path)) continue;
    erasures.set(path, {
      deletedBy: erasedByAReviewedCommit(path, { base, headRef, incomingRef, cwd }),
      renamedTo: renamedFrom.get(path) ?? null,
      auto: autoEntries.get(path),
    });
  }

  const wanted = new Set();
  for (const { auto } of erasures.values()) {
    if (!auto.gitlink && auto.oid) wanted.add(auto.oid);
  }
  for (const path of reported) {
    for (const entry of [autoEntries.get(path), resultEntries.get(path)]) {
      if (entry && !entry.gitlink && entry.oid) wanted.add(entry.oid);
    }
  }
  const contents = batchBlobs([...wanted], cwd);

  /** @type {{ path: string, kind: string, lost: number, detail: string }[]} */
  const edits = [];

  for (const [path, { deletedBy, renamedTo, auto }] of erasures) {
    if (renamedTo) {
      edits.push({
        path,
        kind: 'renamed-after-clean-merge',
        lost: 0,
        detail: ` — its content moved to ${renamedTo}`,
      });
      continue;
    }
    // A side's own commit removed this file, and that deletion was reviewed where it was
    // written. A `modify/delete` conflict resolves this way by git's own recommendation, so
    // gating it would be refusing git's advice rather than catching a loss.
    edits.push({
      path,
      kind: deletedBy ? 'erased-by-a-side' : 'erased-after-clean-merge',
      lost: lostOrOne(contents.get(auto.oid), auto.gitlink),
      detail: deletedBy ? `the ${deletedBy} side had already deleted it` : '',
    });
  }

  for (const path of reported) {
    const auto = autoEntries.get(path);
    const got = resultEntries.get(path);
    if (!auto || !got) continue;
    if (auto.oid === got.oid && auto.mode === got.mode) continue;

    const lost = lostLineCount(
      auto.gitlink || got.gitlink ? null : contents.get(auto.oid),
      got.gitlink ? null : contents.get(got.oid)
    );
    edits.push({
      path,
      kind: 'edited-after-clean-merge',
      lost: Number.isFinite(lost) ? lost : Number.POSITIVE_INFINITY,
      detail: '',
    });
  }

  // The destination of a rename is not also an addition, and reporting it twice is how a
  // receipt teaches its reader to count paths instead of reading them.
  const renameTargets = new Set([...erasures.values()].map((e) => e.renamedTo).filter(Boolean));
  for (const path of reported) {
    // git's merge had nothing here and the resolution added a file. A hand-written resolution
    // can do that; nothing is lost and nothing is claimed.
    if (autoEntries.get(path) || !resultEntries.get(path)) continue;
    if (renameTargets.has(path)) continue;
    edits.push({ path, kind: 'added-after-clean-merge', lost: 0, detail: '' });
  }

  edits.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { edits, scanned: differing.length, skipped: null, incoming: incomingRef, head: headRef };
}

/**
 * Did a SIDE's own commit remove this path, or did the resolution?
 *
 * The BASE decides, and nothing else can. Asking "which side lacks the path?" cannot tell a side
 * that DELETED it from a side that NEVER HAD it, and every one of the four erased test files on
 * this history is the second case: the base does not have the file, one side ADDED it, and the
 * merge kept the addition until the resolution dropped it. The naive question labelled that "a
 * side had already deleted it", which is false, and would have reported — and never refused —
 * precisely the shape this gate exists for.
 *
 * So: the base HAD the path and exactly one side does not, means that side removed it in a commit
 * somebody reviewed, which includes every `modify/delete` conflict and is git's own
 * recommendation there. The base LACKS it, or both sides still carry it, and nothing explains the
 * erasure except the resolution.
 */
function erasedByAReviewedCommit(path, { base, headRef, incomingRef, cwd }) {
  if (!base || !refHasPath(base, path, cwd)) return null;
  const inHead = refHasPath(headRef, path, cwd);
  const inIncoming = refHasPath(incomingRef, path, cwd);
  if (inHead === inIncoming) return null;
  return inHead ? 'incoming' : 'merged-into';
}

/** The commits both sides share, which is the only commit that can have DELETED anything. */
function mergeBase(headRef, incomingRef, cwd) {
  return tryGit(['merge-base', headRef, incomingRef], { cwd });
}

/**
 * Does this ref carry this path?
 *
 * `ls-tree`, and the answer is its OUTPUT. `cat-file -e <ref>:<path>` answers about the object,
 * prints nothing when the object exists, and fails for a submodule whose commit is not in this
 * store — so it reports every existing path as absent and every erased submodule as a side's
 * own deletion. `ls-tree` lists the ENTRY, which is the question, and `--` before the path
 * keeps a name carrying glob characters a path rather than a pathspec.
 */
function refHasPath(ref, path, cwd) {
  return (tryGit(['ls-tree', '--full-tree', ref, '--', path], { cwd }) ?? '').length > 0;
}

/** A `--name-status` status field: one letter, optionally a similarity score. */
const RENAME_STATUS = /^[RC]\d*$/;

/**
 * Old paths that this result RENAMED, as `old -> new`.
 *
 * Read from `--name-status -M` rather than inferred, because the difference between "a rename"
 * and "a delete plus an unrelated add" is exactly the difference between a report line and a
 * refusal, and the index cannot tell them apart.
 */
function renameSources(autoTree, result, cwd) {
  const raw = tryGit(['diff', '--name-status', '-z', '-M', autoTree, result], { cwd });
  const map = new Map();
  if (!raw) return map;
  const fields = raw.split('\0').filter(Boolean);
  for (let i = 0; i < fields.length - 1; i += 1) {
    // A status, matched AS a status. `startsWith('R')` reads a path called `README.md` as
    // a rename status, swallows the real triple behind it, and turns the rename this function
    // exists to recognise into a false refusal — a resolution that renames a test file AND
    // adds a README is not a merge to block, and it is not an exotic one.
    if (!RENAME_STATUS.test(fields[i])) continue;
    map.set(fields[i + 1], fields[i + 2]);
    i += 2;
  }
  return map;
}

/** The line count of an erasure, or one when there are no lines to count. */
function lostOrOne(buf, gitlink) {
  if (gitlink) return 1;
  if (!buf) return 1;
  if (buf.includes(0)) return Number.POSITIVE_INFINITY;
  return Math.max(nonBlankLines(buf), 1);
}

/**
 * Git's OWN result for this merge: the tree `git merge-tree --write-tree` produces, plus the
 * paths it could not resolve.
 *
 * Same tool `scripts/lib/git-operation-state.mjs` and `scripts/lib/worktree-inventory/git.mjs`
 * use to answer "would merging this branch conflict", so there is one git invocation behind all
 * three answers rather than three implementations that can disagree.
 *
 * `--name-only` for the conflicted paths, and that is the whole reason it is here. Parsing
 * `CONFLICT (...)` lines by regex was the first version and it MISSED git's second phrasing
 * outright: a `modify/delete` conflict prints
 * `CONFLICT (modify/delete): <path> deleted in <branch> and modified in HEAD.  Version HEAD of
 * <path> left in tree.`, which never says "Merge conflict in", so a path git had in fact
 * reported as conflicted reached the census as a clean hand edit and produced a refusal of
 * git's own recommended resolution. Git prints the names; parse the names.
 *
 * FAIL-CLOSED, and in the only direction that is safe here: anything other than a tree is
 * `skipped`, never an empty result. `skipped` means the census did not run, and a census that
 * did not run must not be reported as a merge nobody touched.
 *
 * WHAT IT CANNOT SEE, and it is worth knowing because the reflog looks like it could:
 * `-X` and `-s`. Measured with a real hook installed, `git merge -X ours feat` and
 * `git merge -s ours feat` both set `GIT_REFLOG_ACTION` to plain `merge feat` — git records the
 * RESULT ("Merge made by the 'ort' strategy"), not the invocation, so the flag is not
 * observable at any hook. A `-X ours` merge therefore reports the hunks git took wholesale as
 * hand edits. That costs report lines and nothing else: `-X` resolves a hunk, it never removes
 * a path, so it cannot cause the refusal. An earlier version skipped the census on
 * `GIT_REFLOG_ACTION` and that branch could not be reached from a hook at all.
 */
function automaticMergeResult(headRef, incomingRef, cwd) {
  let out = '';
  try {
    out = execFileSync('git', ['merge-tree', '--write-tree', '--name-only', headRef, incomingRef], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Exit 1 means CONFLICT, and git still prints the tree and the conflicted names on stdout.
    // Anything else, or a stdout with no tree in it, is a real failure and is skipped rather
    // than guessed at — the inventory made the same call for the same tool.
    if (err?.status !== 1 || typeof err?.stdout !== 'string') {
      return { skipped: `git merge-tree could not compute this merge's automatic result (${describeGitFailure(err)})` };
    }
    out = err.stdout;
  }

  const lines = out.split('\n');
  const tree = (lines[0] ?? '').trim();
  if (!/^[0-9a-f]{40,64}$/.test(tree)) {
    return { skipped: `git merge-tree printed no tree for this merge (${tree || 'empty output'})` };
  }
  // The names are the lines between the tree and the first blank line; everything after that
  // is prose. A conflicted name can be a bare path or a quoted one, and git quotes only when
  // the path needs it, so the quotes come off rather than being matched around.
  const conflicted = new Set();
  for (const line of lines.slice(1)) {
    if (line === '') break;
    conflicted.add(line.startsWith('"') && line.endsWith('"') ? JSON.parse(line) : line);
  }
  return { tree, conflicted, skipped: null };
}

function describeGitFailure(err) {
  const detail = (err?.stderr ?? '').toString().trim().split('\n')[0];
  return detail || err?.message || 'git failed';
}

export function isTestPath(path) {
  return /(?:^|\/)__tests__\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
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

function splitZ(text) {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function truncate(sha) {
  return sha.slice(0, 8);
}

/**
 * Every path in a tree with the blob it resolves to. One subprocess for the whole tree.
 *
 * `git rev-parse <tree>:<path>` answers the same question one path at a time, and that is
 * what this replaced: it cost a process spawn per path, which on a large merge is the
 * difference between a hook that runs in tens of milliseconds and one that runs in seconds.
 *
 * `paths` narrows the listing to the paths a caller already knows differ, which keeps the
 * census from re-reading two whole trees to look at the dozen paths that changed. It is one
 * `ls-tree` either way; only the volume it reports differs.
 */
function readTreeBlobs(treeish, cwd, paths = null) {
  const args = ['ls-tree', '-r', '-z', '--full-tree', treeish];
  if (paths) args.push('--', ...paths);
  const raw = tryGit(args, { cwd });
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
  for (const entry of splitZ(raw)) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [mode, , oid] = entry.slice(0, tab).split(' ');
    // `mode` as well as the OID, because an entry is not its blob: a mode bit is a
    // committed change of its own, and comparing OIDs alone cannot see it change or be
    // changed. See `sameEntry`.
    map.set(entry.slice(tab + 1), { oid, mode, gitlink: mode === '160000' });
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
  let offset = 0;
  for (;;) {
    const newline = buf.indexOf(0x0a, offset);
    if (newline < 0) break;
    const [oid, , sizeText] = buf.toString('utf8', offset, newline).split(' ');
    const size = Number(sizeText);
    if (!Number.isFinite(size) || size < 0) break;
    const start = newline + 1;
    out.set(oid, buf.subarray(start, start + size));
    // `--batch` puts a newline after the content, and a blob may itself end in one.
    offset = start + size + 1;
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
  const available = new Map();
  for (const line of resultBuf.toString('utf8').split('\n')) {
    const key = normaliseLine(line);
    if (key.trim() === '') continue;
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  let lost = 0;
  for (const line of losingBuf.toString('utf8').split('\n')) {
    const key = normaliseLine(line);
    if (key.trim() === '') continue;
    const held = available.get(key) ?? 0;
    if (held > 0) available.set(key, held - 1);
    else lost++;
  }
  return lost;
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

function report({ takeovers, scanned, incoming, base, head }) {
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
    lines.push(`  ${path}  [${kind}]`);
    lines.push(`      ${reason}`);
  }
  if (takeovers.length > LISTED) {
    lines.push(`  ... and ${takeovers.length - LISTED} more path(s), all reported and all counted above.`);
    lines.push('      They share a shape: run this again with --manual, or read the paths off');
    lines.push('      `findTakeovers()`, rather than scrolling.');
  }
  lines.push('');
  lines.push("  A merge that reports success while deleting another branch's committed work is the");
  lines.push('  failure this guard exists for. Resolve each path as a UNION of both sides — a file');
  lines.push('  can usually hold both edits — or, if a side is genuinely obsolete here, rebase');
  lines.push('  the incoming branch onto main and let git carry the conflict to you visibly.');
  if (takeovers.some((t) => t.kind === 'discarded-incoming-change')) {
    lines.push('');
    lines.push("  `discarded-incoming-change` means the merge kept this side and dropped the branch's,");
    lines.push('  which is what `git merge -X ours` and `git merge -s ours` do. `-s ours` is the');
    lines.push('  standard git idiom for recording a merge without taking its content; if that is');
    lines.push('  what you meant, `--no-verify` below is the way to say so.');
  }
  lines.push('');
  lines.push("  To see one side's version while deciding:");
  lines.push('      git show :2:' + takeovers[0].path + '   # the side being merged INTO');
  lines.push('      git show :3:' + takeovers[0].path + '   # the incoming side');
  lines.push('');
  lines.push('  Bypass for a merge you have verified by hand: git merge --no-verify <ref>');
  lines.push('  Every gate in this repository is bypassable that way; say so in the commit.');
  return lines.join('\n');
}

/**
 * The receipt for what the guard did NOT refuse: every path a human changed after git had
 * already merged it, and the one refusal the census owns.
 *
 * Printed on a clean merge only when there is something to print. A hook that narrates every
 * clean merge trains the eye to skip it, and the lines that matter are the ones that appear
 * when something happened.
 */
/**
 * One line per finding, in the words that fit the finding.
 *
 * A count of "lines absent" is meaningless for a binary blob and for a submodule pointer, and
 * printing one anyway is how a report teaches its reader to stop reading it.
 */
function editDetail({ kind, lost, detail }) {
  if (kind === 'edited-after-clean-merge') {
    if (lost === Number.POSITIVE_INFINITY) return ' — content differs and is binary, so no line count applies';
    return lost > 0
      ? ` — ${lost} line(s) of git's merged result are absent`
      : " — no line of git's merged result is absent";
  }
  if (kind === 'erased-after-clean-merge') {
    return lost === Number.POSITIVE_INFINITY
      ? ' — the file is gone from the result, and it is binary'
      : ` — the file is gone from the result (${lost} line(s))`;
  }
  if (kind === 'erased-by-a-side') return ` — the file is gone from the result; ${detail}`;
  if (kind === 'renamed-after-clean-merge') return ' — the file moved to a new name';
  return ' — added by the resolution';
}

export function reportResolutions({ edits, skipped }, { refused = false } = {}) {
  const lines = [];
  if (skipped) {
    return [`merge-takeover-guard: hand-resolution census did not run — ${skipped}.`].join('\n');
  }
  if (edits.length === 0) return '';

  const erasedTests = edits.filter((e) => e.kind === 'erased-after-clean-merge' && isTestPath(e.path));
  if (refused) {
    lines.push('');
    lines.push(
      `merge-takeover-guard: REFUSING this merge — ${erasedTests.length} test file(s) that BOTH sides still carry are absent from the result.`
    );
    lines.push('');
    for (const { path, lost, detail } of erasedTests) {
      lines.push(`  ${path}  [erased-after-clean-merge]`);
      lines.push(
        lost === Number.POSITIVE_INFINITY
          ? '      both sides have this file and the staged result does not, and it is binary'
          : `      both sides have this file and the staged result does not, so ${lost} line(s) of it are gone`
      );
      void detail;
    }
    lines.push('');
    lines.push('  Neither side deleted this file, so nothing in the merge explains its absence: no');
    lines.push('  conflict, no marker, no takeover shape. Deleting a test file inside a merge is');
    lines.push('  not reconciling two versions of one thing — it removes coverage.');
    lines.push('');
    lines.push('  If the file really is obsolete, delete it IN THE BRANCH, in a commit that says why,');
    lines.push('  and merge main into that branch first. If you have already verified this deletion by');
    lines.push('  hand and mean it, say so out loud:');
    lines.push('      git merge --no-verify <ref>');
  } else {
    lines.push('');
    lines.push(`merge-takeover-guard: ${edits.length} path(s) were hand-edited after git had already merged them:`);
    for (const edit of edits.slice(0, 20)) {
      lines.push(`  ${edit.path}  [${edit.kind}]${editDetail(edit)}`);
    }
    if (edits.length > 20) lines.push(`  ... and ${edits.length - 20} more, all counted above.`);
  }
  return lines.join('\n');
}

export function main(argv, { cwd = process.cwd() } = {}) {
  const manual = argv.includes('--manual') || argv.includes('-m');
  try {
    const findings = findTakeovers({ cwd });
    if (findings.takeovers.length > 0) {
      process.stderr.write(`${report(findings)}\n`);
      return 1;
    }
    const census = findHandResolutions({ cwd });
    if (census.skipped) {
      // Exit 2, which is what the whole-file layer already returns for "I could not look". A
      // census that could not run and a merge nobody touched would otherwise print one line and
      // exit 0, and the second of those is a lie this repository has already been bitten by.
      process.stderr.write(`merge-takeover-guard: ${census.skipped}.\n`);
      return 2;
    }
    const erasedTests = census.edits.filter((e) => e.kind === 'erased-after-clean-merge' && isTestPath(e.path));
    if (erasedTests.length > 0) {
      process.stderr.write(`${reportResolutions(census, { refused: true })}\n`);
      return 1;
    }
    if (manual) {
      process.stdout.write(`${report(findings)}\n`);
      const receipt = reportResolutions(census);
      if (receipt) process.stdout.write(`${receipt}\n`);
    } else {
      // Not `--manual`: a clean merge with hand edits still prints, because the whole point
      // is that this class had no output at all until now.
      const receipt = reportResolutions(census);
      if (receipt) process.stderr.write(`${receipt}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof GuardError) {
      process.stderr.write(`merge-takeover-guard: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
