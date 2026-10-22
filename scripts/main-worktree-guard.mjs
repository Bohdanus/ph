#!/usr/bin/env node
/**
 * Refuses to record a commit in the main worktree.
 * ---------------------------------------------
 * `docs/ORCHESTRATION.md` states the hard rule this program enforces: 100% of
 * work that changes a tracked file happens in its own worktree, and the main
 * worktree is a landing, not an authoring surface. The rule was already true
 * as a paragraph and false as a practice, and the measurement is in
 * HANDOFF.md §100 — of the 60 most recently updated sessions, 59 had the main
 * checkout as their working directory, 1398 `task` subagents in seven days ran
 * there, and 22 Agent Manager `mode: 'local'` sessions were editing it in
 * parallel. `main` was 71 commits ahead of `origin/main` with commits named
 * "fix", "fix provider name" and "cleaned main".
 *
 * WHY A COMMIT HOOK AND NOT A PERMISSION
 * --------------------------------------
 * `kilo.jsonc` cannot express this rule. Tool permissions match a glob against
 * a path or a command and have no term for the working directory, so `src/foo.ts`
 * is the same pattern whether the session is in `main` or in
 * `.kilo/worktrees/task` — and there is no lifecycle hook in Kilo that could
 * veto a write before it happens. The commit is the last moment at which the
 * damage is still free to undo, and it is the one moment git itself guarantees
 * to run code in: `.husky/pre-commit` executes for every session, in every
 * worktree, whether or not the author read a line of documentation.
 *
 * WHAT IT DOES NOT DO, because the limit is load-bearing
 * ------------------------------------------------------
 * It runs AFTER the edit, not before it. A session that writes into the main
 * worktree and never commits is not stopped here; its files are still
 * uncommitted, and they are still in a checkout every other session is reading.
 * This guard makes the main worktree a place where work cannot be _recorded_,
 * which converts "71 rogue commits nobody can attribute" into "a dirty tree the
 * next `git status` names". Closing the write side is a process fix, not a
 * program: see `docs/ORCHESTRATION.md` on creating the worktree before the
 * first edit and naming its path in every subagent brief, since a `task`
 * subagent inherits the caller's directory and cannot create its own.
 *
 * WHAT IS DELIBERATELY ALLOWED
 * ----------------------------
 * - **Landing.** A clean merge is prepared with `--no-commit --no-ff`; its later commit through
 *   `commit-reviewed-landing.mjs` reaches this file with `MERGE_HEAD` set and a private index
 *   snapshot. It is allowed only when HEAD, MERGE_HEAD, the staged tree, and the isolated index
 *   match the reviewed parent and tree pins. A direct clean merge reaches
 *   `pre-merge-commit` without a verifiable MERGE_HEAD and is refused. Fast-forwards run no
 *   blocking hook, which is why the landing procedure requires `--no-ff`.
 *   A conflicted merge in main is not a landing path. If it is resolved there, an ordinary
 *   commit still lacks the required private index snapshot and is refused; abort it and resolve
 *   the conflict in the candidate worktree instead.
 * - **A named operator hotfix.** `ALLOW_MAIN_COMMIT=1`, which is the only way
 *   through and is stated in the refusal rather than left to be discovered.
 * - **A repository it cannot place.** Detection failure allows the commit. This
 *   guard is repo-scoped and every checkout here is one git repository, so a
 *   git that will not answer is a broken environment rather than a policy
 *   decision, and blocking on it would trade a real gate for a phantom one.
 *   Policy fails closed; detection fails open, and the two are different
 *   questions.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The environment variable that lets a commit be recorded in the main worktree.
 *
 * One value, `1`, and nothing else. A truthiness test would accept `0`, `false`
 * and the empty string as permission, which is how an escape hatch becomes
 * invisible: `ALLOW_MAIN_COMMIT=0` reads like a denial and behaves like a
 * bypass. The named exception in `docs/ORCHESTRATION.md` is a decision someone
 * makes out loud, so the spelling has to be unambiguous.
 */
const OVERRIDE_VAR = 'ALLOW_MAIN_COMMIT';

export { OVERRIDE_VAR };

/**
 * The refusal. It names the rule, what is at stake, and the two ways forward.
 *
 * A refusal that only says "no" is an obstacle, and the agent that hits it
 * resolves an obstacle the way this repository's history says it does — by
 * committing anyway, from the same checkout, on a branch nobody made. So the
 * recipe is the message: stage only your own paths (the main worktree is not
 * stable while you work), carry them to a worktree as a patch, and commit
 * there. `git stash` is named in the "not this" line because it is the escape
 * every model reaches for and every worktree shares one
 * `refs/stash` in the common git dir.
 */
const REFUSAL = `gate: refusing to record a commit in the MAIN worktree.

  docs/ORCHESTRATION.md: the main worktree is a landing, not an authoring
  surface. Work that changes a tracked file belongs in its own worktree, on
  its own branch, and main is where a finished branch merges.

  What that protects: this checkout is shared. Whatever is in it right now is
  half-written by somebody else, unstaged files belong to no commit and no ref,
  and one git stash stack serves every worktree in the repository.

  Move what you have already written:

    git add <only your paths>                    # never -A: main moves under you
    git diff --cached > /tmp/task.patch
    git worktree add -b fix/task .kilo/worktrees/task
    git -C .kilo/worktrees/task apply --index /tmp/task.patch
    git -C .kilo/worktrees/task commit -m "..."

  Not git stash: one refs/stash is shared by every worktree, so a pop here can
  take another agent's entry, silently.

A main landing must be prepared with \`git merge --no-commit --no-ff <reviewed-sha>\` and recorded
through \`node scripts/commit-reviewed-landing.mjs -m <message>\` with the reviewed parent and
tree pins set. That command commits from a private snapshot of the prepared index; the hook checks
the actual \`MERGE_HEAD\` and staged tree in that snapshot. A direct clean merge, an unpinned
merge, a shared-index commit, and a fast-forward do not meet this gate.
An operator hotfix the operator asked for on main by name is:

    ALLOW_MAIN_COMMIT=1 git commit -m "..."
`;

/**
 * Whether this checkout is the repository's main worktree.
 *
 * `git rev-parse --absolute-git-dir` is the per-worktree git directory and
 * `--git-common-dir` is the one they all share. In the main worktree they are
 * the same directory; in a linked worktree the first is
 * `<common>/worktrees/<name>` and the second is `<common>`. Measured on both
 * shapes in this repository — main answers `/Users/bkalynovskyi/ph/.git` twice,
 * and a linked worktree answers `.../.git/worktrees/<name>` then
 * `.../.git`.
 *
 * The common-dir query intentionally omits `--path-format=absolute`: that flag
 * was added in Git 2.31, while this guard must protect older installations too.
 * Resolve the older command's relative result against the requested checkout
 * before comparing real paths.
 *
 * `realpathSync` on both sides, because the two are equal as strings long before
 * they are equal as paths: git resolves its own directory through the cwd, so a
 * worktree reached through `/tmp` or `/var` — both symlinks on macOS — reports
 * a `/private/...` form on one side and not the other, and a string comparison
 * reports a main worktree where there is none. The same trap is why this
 * repository's `worktree-inventory.mjs` refuses `git rev-parse --show-toplevel`
 * as an answer.
 *
 * Returns `null` when git cannot answer, which `decide` treats as "not the main
 * worktree" — the fail-open arm documented above.
 */
export function resolveWorktree(cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const gitDir = realpathSync(resolve(cwd, git(['rev-parse', '--absolute-git-dir'])));
    const commonDir = realpathSync(resolve(cwd, git(['rev-parse', '--git-common-dir'])));
    return { gitDir, commonDir, isMainWorktree: gitDir === commonDir };
  } catch {
    return null;
  }
}

/**
 * Read every incoming commit Git recorded for the current merge. MERGE_HEAD is
 * a newline-separated list for octopus merges; callers that pin one candidate
 * must reject that shape rather than inspecting only its first parent.
 */
export function readMergeHeadRefs(cwd = process.cwd()) {
  try {
    const mergeHeadPath = execFileSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!mergeHeadPath) return [];
    const absolutePath = resolve(cwd, mergeHeadPath);
    if (!existsSync(absolutePath)) return [];
    return readFileSync(absolutePath, 'utf8')
      .split(/\r?\n/)
      .map((ref) => ref.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The decision. Pure, and exported, so the rules are testable without a
 * repository on disk — a test that had to `git init` to learn whether the guard
 * refuses would be a test about git as much as about the guard.
 */
export function decide({ worktree, override = '', landing } = {}) {
  if (worktree === null || worktree === undefined) return { action: 'allow', reason: 'undetectable' };
  if (!worktree.isMainWorktree) return { action: 'allow', reason: 'linked worktree' };
  if (override === '1') return { action: 'allow', reason: `${OVERRIDE_VAR}=1` };
  if (
    landing?.head &&
    landing?.incoming &&
    landing?.incomingCount === 1 &&
    landing?.tree &&
    landing?.isolatedIndex === true &&
    landing?.expectedMain &&
    landing?.expectedIncoming &&
    landing?.expectedTree &&
    landing.head === landing.expectedMain &&
    landing.incoming === landing.expectedIncoming &&
    landing.tree === landing.expectedTree
  ) {
    return { action: 'allow', reason: 'pinned merge landing' };
  }
  return { action: 'refuse' };
}

/**
 * A main landing must commit from a private snapshot because Git rereads the
 * selected index after `pre-commit` returns. An isolated `GIT_INDEX_FILE`
 * keeps another process staging in the shared main checkout from changing the
 * tree after the guard's last check.
 */
export function isIsolatedIndex(worktree, cwd = process.cwd(), env = process.env) {
  if (!worktree?.isMainWorktree || !worktree.gitDir || !env.GIT_INDEX_FILE) return false;
  try {
    const activeIndex = realpathSync(resolve(cwd, env.GIT_INDEX_FILE));
    const sharedIndex = realpathSync(join(worktree.gitDir, 'index'));
    return activeIndex !== sharedIndex;
  } catch {
    return false;
  }
}

/**
 * How much of the main worktree is dirty, for the refusal's benefit.
 *
 * Advisory only: the count is another session's in-flight work far more often
 * than it is the committer's, which is the point of printing it. A failure to
 * read it degrades to no line rather than to a refused commit.
 */
function dirtSummary(cwd = process.cwd()) {
  try {
    const lines = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\n')
      .filter(Boolean);
    return lines.length === 0 ? null : `${lines.length} path(s) are modified or untracked here right now`;
  } catch {
    return null;
  }
}

/**
 * Runs the guard. Given its streams and its exit function, so the tests drive
 * the real surface in-process and assert on the text an operator would read.
 */
export function run({
  cwd = process.cwd(),
  env = process.env,
  err = process.stderr,
  exit = process.exit,
  worktree = resolveWorktree(cwd),
} = {}) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return null;
    }
  };
  const mergeHeadRefs = readMergeHeadRefs(cwd);
  const decision = decide({
    worktree,
    override: env[OVERRIDE_VAR] ?? '',
    landing: {
      head: git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']),
      incoming:
        mergeHeadRefs.length === 1 ? git(['rev-parse', '--verify', '--quiet', `${mergeHeadRefs[0]}^{commit}`]) : null,
      incomingCount: mergeHeadRefs.length,
      tree: git(['write-tree']),
      isolatedIndex: isIsolatedIndex(worktree, cwd, env),
      expectedMain: env.KILO_EXPECTED_MAIN_SHA ?? '',
      expectedIncoming: env.KILO_EXPECTED_INCOMING_SHA ?? '',
      expectedTree: env.KILO_EXPECTED_TREE_SHA ?? '',
    },
  });
  if (decision.action === 'allow') return { refused: false, reason: decision.reason, code: null };

  const dirt = dirtSummary(cwd);
  if (dirt !== null) err.write(`gate: ${dirt}.\n`);
  err.write(REFUSAL);
  exit(1);
  return { refused: true, code: 1 };
}

/**
 * Whether this file was executed rather than imported.
 *
 * Compared as realpaths, because a bin entry would be a symlink to this file
 * and `process.argv[1]` would be the link.
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
  run();
}
