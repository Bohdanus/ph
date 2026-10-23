#!/usr/bin/env node
/**
 * Refuses to record a commit in the primary or designated main worktree.
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
 * This guard makes the primary and designated main worktrees places where work cannot be _recorded_,
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
 *   snapshot and helper-created workflow marker. It is allowed only when HEAD, MERGE_HEAD,
 *   the staged tree, marker, source branch, and chat ID match the reviewed pins. The
 *   `pre-merge-commit` hook refuses every direct clean merge. Fast-forwards run no
 *   blocking hook, which is why the landing procedure requires `--no-ff`.
 *   A conflicted merge in main is not a landing path. If it is resolved there, an ordinary
 *   commit still lacks the required private index snapshot and is refused; abort it and resolve
 *   the conflict in the candidate worktree instead.
 * - **A named operator hotfix on designated main.** `ALLOW_MAIN_COMMIT=1`,
 *   which is the only way through there and is stated in the refusal rather
 *   than left to be discovered. It cannot authorize a commit in the primary
 *   checkout when that checkout has a task branch.
 * - **A repository it cannot place.** Detection failure allows the commit. This
 *   guard is repo-scoped and every checkout here is one git repository, so a
 *   git that will not answer is a broken environment rather than a policy
 *   decision, and blocking on it would trade a real gate for a phantom one.
 *   Policy fails closed; detection fails open, and the two are different
 *   questions.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
const MAIN_WORKTREE_GIT_DIR_KEY = 'ph.mainWorktreeGitDir';
const MAIN_WORKTREE_PATH_KEY = 'ph.mainWorktreePath';
const MAIN_WORKTREE_ID_KEY = 'ph.mainWorktreeIdentity';
const MAIN_WORKTREE_ID_FILENAME = 'kilo-main-worktree-identity';

export { OVERRIDE_VAR };

function readMainWorktreeIdentity(gitDir) {
  try {
    return readFileSync(join(gitDir, MAIN_WORKTREE_ID_FILENAME), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Record the private Git directory for the worktree that currently owns `main`.
 * The local config is shared by every linked worktree and survives detaching HEAD;
 * the matching private marker distinguishes this checkout from a later worktree
 * that Git creates with a recycled path-derived admin directory.
 *
 * @param {string} cwd
 * @param {{ required?: boolean }} options When true, persistence failures are surfaced to hook installation.
 * @returns {boolean}
 */
export function registerMainWorktree(cwd = process.cwd(), { required = false } = {}) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    if (git(['symbolic-ref', '--quiet', 'HEAD']) !== 'refs/heads/main') return false;
    const gitDir = realpathSync(resolve(cwd, git(['rev-parse', '--absolute-git-dir'])));
    const worktreePath = realpathSync(cwd);
    let registeredGitDir = null;
    let registeredPath = null;
    try {
      registeredGitDir = git(['config', '--local', '--get', MAIN_WORKTREE_GIT_DIR_KEY]);
    } catch {
      // The first main-worktree registration has no config value yet.
    }
    try {
      registeredPath = git(['config', '--local', '--get', MAIN_WORKTREE_PATH_KEY]);
    } catch {
      // The first main-worktree registration has no config value yet.
    }
    let registeredIdentity = null;
    try {
      registeredIdentity = git(['config', '--local', '--get', MAIN_WORKTREE_ID_KEY]);
    } catch {
      // The first main-worktree registration has no identity token yet.
    }
    if (registeredGitDir !== gitDir || registeredIdentity !== readMainWorktreeIdentity(gitDir)) {
      registeredIdentity = randomUUID();
      writeFileSync(join(gitDir, MAIN_WORKTREE_ID_FILENAME), `${registeredIdentity}\n`, { mode: 0o600 });
      git(['config', '--local', MAIN_WORKTREE_ID_KEY, registeredIdentity]);
    }
    if (registeredGitDir !== gitDir) git(['config', '--local', MAIN_WORKTREE_GIT_DIR_KEY, gitDir]);
    if (registeredPath !== worktreePath) git(['config', '--local', MAIN_WORKTREE_PATH_KEY, worktreePath]);
    return true;
  } catch (error) {
    if (required) {
      throw new Error(
        `cannot register the designated main worktree in shared Git config${error instanceof Error ? `: ${error.message}` : ''}`,
        { cause: error }
      );
    }
    return false;
  }
}

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
const REFUSAL = `gate: refusing to record a commit in the primary or MAIN worktree.

  docs/ORCHESTRATION.md: the primary checkout and designated main worktree are
  not authoring surfaces. Work that changes a tracked file belongs in its own
  linked worktree under .kilo/worktrees/, on its own branch. Only the designated
  main worktree records a finished, pinned landing.

  What that protects: this checkout is shared. Whatever is in it right now is
  half-written by somebody else, unstaged files belong to no commit and no ref,
  and one git stash stack serves every worktree in the repository.

  Move what you have already written:

    git add <only your paths>                    # never -A: main moves under you
    git diff --cached > /tmp/task.patch
    git worktree add -b fix/task .kilo/worktrees/task
    git -C .kilo/worktrees/task apply --index /tmp/task.patch
    git -C .kilo/worktrees/task commit -m "Fix: <summary>" -m "Chat: <native-session-id>"

  Not git stash: one refs/stash is shared by every worktree, so a pop here can
  take another agent's entry, silently.

A main landing must be prepared with \`git merge --no-commit --no-ff <reviewed-sha>\` and recorded
through \`node scripts/commit-reviewed-landing.mjs -m <message>\` with the reviewed parent and
tree, branch, and chat pins set. That command commits from a private snapshot of the prepared
index and provides a helper-created workflow marker; the hook checks the actual
\`MERGE_HEAD\`, staged tree, and marker. A direct clean merge, an unpinned
merge, a shared-index commit, and a fast-forward do not meet this gate.
An operator hotfix the operator asked for in the designated main worktree by name is:

    ALLOW_MAIN_COMMIT=1 git commit -m "Hotfix: <summary>" -m "Chat: <native-session-id>"
`;

/**
 * Whether this checkout is the primary Git checkout or the designated `main` branch
 * worktree. Repository policy permits commits only in linked task worktrees; the primary
 * checkout remains protected even when it happens to have a task branch checked out.
 *
 * The primary Git checkout is not necessarily the project main worktree. This
 * repository keeps `refs/heads/main` in a linked worktree, while the primary
 * checkout can be on a task branch. Protect both locations from ordinary
 * commits, and recognize the designated main branch separately because only it
 * may record a pinned landing. The hook installer records the designated main
 * checkout's private gitdir and path in shared local Git config, preserving its
 * protection if HEAD becomes detached or that path is recreated as a detached
 * checkout. A marker inside the private gitdir distinguishes that worktree from a
 * feature worktree Git later creates at the same path; Git can reuse a path-derived
 * admin directory after removal. Any detached checkout at the remembered main path
 * stays protected because, without a branch ref or matching identity marker, it
 * cannot be distinguished from the original main checkout. A branched feature
 * worktree at that path does not inherit protection. Git prevents the same local
 * branch from being checked out in two worktrees at once.
 *
 * Returns `null` when git cannot answer, which `decide` treats as "not the main
 * worktree" — the fail-open arm documented above.
 */
export function resolveWorktree(cwd = process.cwd()) {
  const git = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const gitDir = realpathSync(resolve(cwd, git(['rev-parse', '--absolute-git-dir'])));
    const commonDir = realpathSync(resolve(cwd, git(['rev-parse', '--git-common-dir'])));
    let branchRef = null;
    try {
      branchRef = git(['symbolic-ref', '--quiet', 'HEAD']);
    } catch {
      // Detached and unborn worktrees have no current branch identity.
    }
    const isPrimaryWorktree = gitDir === commonDir;
    const isMainWorktree = branchRef === 'refs/heads/main';
    let registeredMainGitDir = null;
    try {
      registeredMainGitDir = git(['config', '--local', '--get', MAIN_WORKTREE_GIT_DIR_KEY]);
    } catch {
      // A repository that has not run the hook installer has no registered path yet.
    }
    let registeredMainPath = null;
    try {
      registeredMainPath = git(['config', '--local', '--get', MAIN_WORKTREE_PATH_KEY]);
    } catch {
      // A repository that has not run the hook installer has no registered path yet.
    }
    let registeredMainIdentity = null;
    try {
      registeredMainIdentity = git(['config', '--local', '--get', MAIN_WORKTREE_ID_KEY]);
    } catch {
      // A repository that has not registered main has no saved identity token yet.
    }
    const worktreePath = realpathSync(cwd);
    if (isMainWorktree && (registeredMainGitDir !== gitDir || registeredMainPath !== worktreePath)) {
      registerMainWorktree(cwd);
    }
    const hasRegisteredMainIdentity =
      registeredMainGitDir === gitDir &&
      Boolean(registeredMainIdentity) &&
      registeredMainIdentity === readMainWorktreeIdentity(gitDir);
    const isDesignatedMainWorktree =
      isMainWorktree || hasRegisteredMainIdentity || (branchRef === null && registeredMainPath === worktreePath);
    return {
      gitDir,
      commonDir,
      branchRef,
      isPrimaryWorktree,
      isMainWorktree,
      isDesignatedMainWorktree,
      isProtectedWorktree: isPrimaryWorktree || isDesignatedMainWorktree,
    };
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
  const isProtectedWorktree = worktree.isProtectedWorktree ?? worktree.isMainWorktree;
  if (!isProtectedWorktree) return { action: 'allow', reason: 'linked worktree' };
  if (override === '1' && worktree.isMainWorktree) return { action: 'allow', reason: `${OVERRIDE_VAR}=1` };
  if (
    worktree.isMainWorktree &&
    landing?.head &&
    landing?.incoming &&
    landing?.incomingCount === 1 &&
    landing?.tree &&
    landing?.isolatedIndex === true &&
    landing?.reviewedSnapshot === true &&
    landing?.expectedMain &&
    landing?.expectedIncoming &&
    landing?.expectedTree &&
    landing?.expectedBranch &&
    landing?.expectedChat &&
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
 * A private path by itself is not evidence that the landing helper copied the prepared
 * index. Require its short-lived, mode-restricted workflow marker to bind that copy to the
 * reviewed parent, incoming commit, tree, source branch, and chat attribution. This helps
 * catch accidental alternate-index use; a same-user caller that deliberately constructs
 * the environment and marker can bypass that distinction, so it is not an authentication
 * boundary.
 */
export function isReviewedLandingSnapshot(worktree, cwd = process.cwd(), env = process.env) {
  if (!isIsolatedIndex(worktree, cwd, env)) return false;
  const markerPath = env.KILO_REVIEWED_LANDING_MARKER;
  const token = env.KILO_REVIEWED_LANDING_TOKEN;
  const expected = {
    expectedMain: env.KILO_EXPECTED_MAIN_SHA,
    expectedIncoming: env.KILO_EXPECTED_INCOMING_SHA,
    expectedTree: env.KILO_EXPECTED_TREE_SHA,
    expectedBranch: env.KILO_EXPECTED_BRANCH,
    expectedChat: env.KILO_EXPECTED_CHAT_ID,
  };
  if (!markerPath || !/^[a-f0-9]{64}$/.test(token ?? '') || Object.values(expected).some((value) => !value)) {
    return false;
  }

  try {
    const resolvedMarker = realpathSync(resolve(cwd, markerPath));
    const markerStat = lstatSync(resolve(cwd, markerPath));
    const markerDir = dirname(resolvedMarker);
    const dirStat = lstatSync(markerDir);
    if (
      markerStat.isSymbolicLink() ||
      !markerStat.isFile() ||
      !dirStat.isDirectory() ||
      (process.platform !== 'win32' && (markerStat.mode & 0o077) !== 0) ||
      (process.platform !== 'win32' && (dirStat.mode & 0o077) !== 0) ||
      basename(markerDir).startsWith('ph-reviewed-landing-') === false ||
      basename(resolvedMarker) !== 'reviewed-snapshot.json'
    ) {
      return false;
    }

    const activeIndex = realpathSync(resolve(cwd, env.GIT_INDEX_FILE));
    const sharedIndex = realpathSync(join(worktree.gitDir, 'index'));
    const record = JSON.parse(readFileSync(resolvedMarker, 'utf8'));
    const recordToken = Buffer.from(record.token ?? '', 'hex');
    const activeToken = Buffer.from(token, 'hex');
    return (
      activeIndex !== sharedIndex &&
      recordToken.length === activeToken.length &&
      timingSafeEqual(recordToken, activeToken) &&
      record.indexPath === activeIndex &&
      Object.entries(expected).every(([key, value]) => record[key] === value)
    );
  } catch {
    return false;
  }
}

/**
 * How much of the protected checkout is dirty, for the refusal's benefit.
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
      reviewedSnapshot: isReviewedLandingSnapshot(worktree, cwd, env),
      expectedMain: env.KILO_EXPECTED_MAIN_SHA ?? '',
      expectedIncoming: env.KILO_EXPECTED_INCOMING_SHA ?? '',
      expectedTree: env.KILO_EXPECTED_TREE_SHA ?? '',
      expectedBranch: env.KILO_EXPECTED_BRANCH ?? '',
      expectedChat: env.KILO_EXPECTED_CHAT_ID ?? '',
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
