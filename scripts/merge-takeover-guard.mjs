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
 * The defect is narrower, and it has two shapes, neither of which produces a conflict
 * marker. Both are the same thing: git decided a whole file by COPYING one side's content,
 * on a file `main` had a committed change to.
 *
 *   1. The result is the pre-divergence content (`add -A` in a worktree holding another
 *      HEAD's files). This is the recorded 17-file / 1,835-line incident in this repo.
 *   2. The result is the incoming side's file verbatim (`checkout --theirs` on a path).
 *
 * Shape 1 is the one the recipe MISSES and the one that actually happened. An earlier draft
 * of this program required BOTH sides to have changed the path, on the theory that an
 * untouched file has nothing to lose — and that theory is what makes `add -A` invisible:
 * the branch did not change the file, it merely committed it, and committing the old
 * content is itself the change. The condition is therefore "main changed it", never "both
 * changed it".
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
 * - a takeover that happens to produce a file identical to main's, which discarded
 *   nothing.
 * - a REVERT the branch made deliberately and early, where main never had the change to
 *   lose. That is one of the two sides having `result == branch`, with `main` untouched,
 *   and it is not reported by design: an intentional revert is somebody's decision.
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
  const resultVsHead = tryGit(['diff', '--name-only', '-z', headRef, result], { cwd }) ?? '';

  const changedByHead = new Set(splitZ(toHead));
  const movedByMerge = splitZ(resultVsHead);

  const takeovers = [];
  for (const path of movedByMerge) {
    // Only a path main itself changed since the two sides diverged can have lost
    // something here. A file nobody touched has nothing to lose.
    if (!changedByHead.has(path)) continue;

    const baseBlob = blobAt(base, path, cwd);
    const headBlob = blobAt(headRef, path, cwd);
    const incomingBlob = blobAt(incomingRef, path, cwd);
    const resultBlob = blobAt(result, path, cwd);

    if (!baseBlob || !incomingBlob || !resultBlob) continue;
    // The two sides already agree: whatever they did to this file, there is nothing
    // for the merge to lose.
    if (incomingBlob === headBlob) continue;

    // The two abnormal shapes, and they are the whole defect. In both, git decided a
    // whole file by COPYING one side's content when main had a committed change to it,
    // and neither produces a conflict marker.
    //
    // Copying one whole side is not by itself a loss, though, and treating it as one is how
    // a gate gets `--no-verify`'d. Resolving `git merge main` with `--theirs` is ordinary
    // and often CORRECT: main's version is frequently a strict superset of the branch's,
    // the branch's own lines and all. So before reporting, ask the only question that
    // decides it — does the result DELETE anything the protected side had? A pure addition
    // keeps every line the protected side introduced and lost nothing.
    const deleted = countDeleted(headRef, result, path, cwd);

    if (resultBlob === baseBlob && deleted > 0) {
      // `git add -A` in a feature worktree while the root checkout sat at another HEAD:
      // the branch committed the pre-divergence content of a file it never worked on,
      // so the merge handed main back its own older version. This is the shape that cost
      // this repository 17 files and 1,835 lines, recorded at
      // docs/ORCHESTRATION.md with no conflict anywhere in it.
      takeovers.push({
        path,
        kind: 'restored-pre-divergence-content',
        deleted,
        reason: `the result is byte-for-byte the pre-divergence content from ${truncate(base)}, so main's committed change to it was undone`,
      });
    } else if (resultBlob === incomingBlob && deleted > 0) {
      // `git checkout --theirs <file>`, or any resolution that keeps one whole side — and
      // here the result actually drops lines the protected side had.
      takeovers.push({
        path,
        kind: 'whole-file-takeover',
        deleted,
        reason: `the result is byte-for-byte the incoming side's ${truncate(incomingRef)} and drops ${deleted} line(s) the merged-into side had, so its committed work is gone`,
      });
    }
  }

  takeovers.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { takeovers, scanned: movedByMerge.length, incoming: incomingRef, base, head: headRef };
}

function splitZ(text) {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function truncate(sha) {
  return sha.slice(0, 8);
}

function blobAt(treeish, path, cwd) {
  return tryGit(['rev-parse', '--verify', '--quiet', `${treeish}:${path}`], { cwd });
}

/**
 * How many lines the result REMOVES relative to the protected side.
 *
 * This is the discriminator between a real loss and a whole-file copy that lost nothing.
 * `--numstat` reports added and deleted counts, and a result that only ever adds is a
 * superset: every line the protected side had is still present, whatever the file's overall
 * shape. `git diff` alone cannot be read this way — a two-line file rewritten as one
 * different line shows as one change, and a file reformatted wholesale shows as hundreds
 * of deletions that are really just reflowed text.
 */
function countDeleted(fromTree, toTree, path, cwd) {
  const line = tryGit(['diff', '--numstat', fromTree, toTree, '--', path], { cwd });
  if (!line) return 0;
  const [added, deleted] = line.split('\t');
  if (deleted === '-') return Number.POSITIVE_INFINITY; // binary: not a text superset
  return Number.parseInt(deleted, 10) || 0;
}

function report({ takeovers, scanned, incoming, base, head }) {
  const lines = [];
  if (takeovers.length === 0) {
    lines.push(`merge-takeover-guard: clean — ${scanned} path(s) moved by the merge, none taken over wholesale.`);
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`merge-takeover-guard: REFUSING this merge — ${takeovers.length} path(s) would drop committed work.`);
  lines.push('');
  lines.push(`  merged into ${truncate(head)}   incoming ${truncate(incoming)}   merge-base ${truncate(base)}`);
  lines.push('');
  for (const { path, reason } of takeovers) {
    lines.push(`  ${path}`);
    lines.push(`      ${reason}`);
  }
  lines.push('');
  lines.push("  A merge that reports success while deleting another branch's committed work is the");
  lines.push('  failure this guard exists for. Resolve each path as a UNION of both sides — a file');
  lines.push('  can usually hold both edits — or, if a side is genuinely obsolete here, rebase');
  lines.push('  the incoming branch onto main and let git carry the conflict to you visibly.');
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
