#!/usr/bin/env node
/**
 * A merge must not quietly delete the other side's work.
 * --------------------------------------------------
 * `docs/ORCHESTRATION.md` carries one recipe for this, the `comm -13` set difference, and
 * it is the whole of the current protection. Three things are wrong with it, and this
 * program exists because of them.
 *
 * WHERE IT LIVES. Prose in a long document, which the agent it is meant to protect is
 * not obliged to read. `AGENTS.md` — the one file every session is forced to read — says
 * nothing about it: the recipe appears zero times there. A gate nobody is told about is
 * a gate nobody runs.
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
 * - a resolution that is NEITHER side's blob and still drops a line the losing side had.
 *   Measured reachable, and left unreported on purpose. Every shape here is a WHOLE-FILE
 *   one-sided decision — git copied one side's content for the entire path — and that is
 *   precisely the class that raises no conflict marker. A merge that DID conflict was
 *   visibly unmerged until somebody staged it, so its resolution is a human decision made
 *   in the open. Widening the gate to lossy hand-resolutions would fire on ordinary conflict
 *   resolution, and the first agent to meet that would reach for `--no-verify`, which is
 *   how the two original shapes were nearly lost once already.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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

  // Shape 1 and shape 2: the merge MOVED the path relative to HEAD, and its result is one
  // whole side's blob. Only a path HEAD itself changed since the two sides diverged can
  // have lost something by moving — a file nobody touched has nothing to lose.
  for (const path of movedByMerge) {
    if (!changedByHead.has(path)) continue;

    const baseBlob = trees.base.get(path);
    const headBlob = trees.head.get(path);
    const incomingBlob = trees.incoming.get(path);
    const resultBlob = trees.result.get(path);
    if (!baseBlob || !incomingBlob || !resultBlob) continue;
    // The two sides already agree: whatever they did to this file, there is nothing
    // for the merge to lose.
    if (incomingBlob.oid === headBlob?.oid) continue;

    if (resultBlob.oid === baseBlob.oid) {
      // `git add -A` in a feature worktree while the root checkout sat at another HEAD:
      // the branch committed the pre-divergence content of a file it never worked on,
      // so the merge handed main back its own older version. This is the shape that cost
      // this repository 17 files and 1,835 lines, recorded at docs/ORCHESTRATION.md with
      // no conflict anywhere in it.
      suspects.push({
        path,
        kind: 'restored-pre-divergence-content',
        losing: headBlob,
        reason: (n) =>
          `the result is byte-for-byte the pre-divergence content from ${truncate(base)}, so main's committed change to it was undone (${n} line(s) of its own are absent)`,
      });
    } else if (resultBlob.oid === incomingBlob.oid) {
      // `git checkout --theirs <file>`, or any resolution that keeps one whole side.
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
    // Already judged above whenever the merge moved it at all: shape 3 requires the result
    // to be HEAD's side verbatim, and a moved path cannot be that.
    if (moved.has(path)) continue;

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
        `the result kept the merged-into side's version of this path and ${n} line(s) the incoming side committed are absent from it, ` +
        'so that part of the commit did not land',
    });
  }

  // One batched read for every blob any suspect needs, rather than two `git show` calls per
  // path. `--batch` is the only way to make content comparison flat in the number of paths.
  const wanted = new Set();
  for (const { path, losing } of suspects) {
    const resultBlob = trees.result.get(path);
    for (const entry of [losing, resultBlob]) {
      if (entry && !entry.gitlink) wanted.add(entry.oid);
    }
  }
  const contents = batchBlobs([...wanted], cwd);

  const takeovers = [];
  for (const suspect of suspects) {
    const path = suspect.path;
    const losing = suspect.losing;
    const resultBlob = trees.result.get(path);

    // A gitlink is a submodule pointer, not content: there are no lines to compare, so a
    // changed pointer is the whole of what was kept or lost.
    const lost =
      losing.gitlink || resultBlob?.gitlink
        ? losing.gitlink && resultBlob && losing.oid !== resultBlob.oid
          ? 1
          : 0
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
 * Whether the result holds HEAD's side of this path verbatim.
 *
 * `undefined` for both sides counts as HEAD's side winning: HEAD deleted the path, or
 * never had it, and the result does not have it either. That is precisely what `-s ours`
 * produces for a path only the incoming side ever touched — the whole-payload case, and the
 * one an earlier draft missed by requiring HEAD to have changed the path.
 */
function headWon(resultBlob, headBlob) {
  return (resultBlob?.oid ?? null) === (headBlob?.oid ?? null);
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
 */
function readTreeBlobs(treeish, cwd) {
  const raw = tryGit(['ls-tree', '-r', '-z', '--full-tree', treeish], { cwd });
  const map = new Map();
  if (raw === null) return map;
  for (const entry of splitZ(raw)) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const [mode, , oid] = entry.slice(0, tab).split(' ');
    map.set(entry.slice(tab + 1), { oid, gitlink: mode === '160000' });
  }
  return map;
}

/**
 * Read many blobs in one process, via `git cat-file --batch`.
 *
 * @param {string[]} oids
 * @param {string} cwd
 * @returns {Map<string, Buffer>} absent where the object could not be read
 */
function batchBlobs(oids, cwd) {
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
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return out;
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
 * A multiset, not a set, so a file that repeats a line keeps its multiplicity. Whitespace
 * is trimmed so reindentation does not read as a change; a genuinely rewritten line is
 * absent from the result and correctly counts as lost. An empty result means everything
 * the losing side had is gone.
 */
function lostLineCount(losingBuf, resultBuf) {
  if (!losingBuf) return 0;
  if (!resultBuf) return nonBlankLines(losingBuf);
  // A NUL byte means the content is binary and lines mean nothing. Fall back to identity,
  // which is what `--numstat` does when it prints `-`.
  if (losingBuf.includes(0) || resultBuf.includes(0)) {
    return losingBuf.equals(resultBuf) ? 0 : Number.POSITIVE_INFINITY;
  }
  const available = new Map();
  for (const line of resultBuf.toString('utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    available.set(trimmed, (available.get(trimmed) ?? 0) + 1);
  }
  let lost = 0;
  for (const line of losingBuf.toString('utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const held = available.get(trimmed) ?? 0;
    if (held > 0) available.set(trimmed, held - 1);
    else lost++;
  }
  return lost;
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

export function main(argv, { cwd = process.cwd() } = {}) {
  const manual = argv.includes('--manual') || argv.includes('-m');
  try {
    const findings = findTakeovers({ cwd });
    if (findings.takeovers.length > 0) {
      process.stderr.write(`${report(findings)}\n`);
      return 1;
    }
    if (manual) process.stdout.write(`${report(findings)}\n`);
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
