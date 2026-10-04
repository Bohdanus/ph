#!/usr/bin/env node
/**
 * Reports the git operations in progress across every worktree in this repository.
 * --------------------------------------------------------------------------------
 * `docs/ORCHESTRATION.md` says a worktree is where work happens and `main` is where
 * a finished branch lands. Nothing in that document, and nothing in this repository
 * before this program, could answer "is any worktree mid-merge right now?"
 *
 * WHY THIS IS A COMMAND AND NOT A HOOK
 * ------------------------------------
 * A hook runs in ONE worktree and cannot see the others, so a hook cannot be the
 * place this lives: `merge-takeover-guard.mjs` reads its own `MERGE_HEAD`, and
 * `.husky/pre-commit` gates on its own. The state that matters is in
 * `.git/worktrees/<name>/`, and every reader of it is scoped to the worktree it
 * is standing in.
 *
 * It is deliberately NOT wired into `gate:push` or `pre-push`. Blocking every
 * push in the repository because SOME OTHER worktree is mid-merge would punish
 * every session for one session's state, and the agent that hits it resolves an
 * obstacle the way this repository's history says it does — by bypassing it.
 * A gate that stops the whole swarm to report one worktree's state gets switched
 * off, and then it protects nothing.
 *
 * So this REPORTS, loudly, on demand, and the two places that can destroy the
 * state act on it: `dispose-worktree.mjs` refuses to remove a worktree holding an
 * operation in progress, and this command is what a session runs before it
 * believes the repository is quiet.
 *
 * WHAT IT COSTS
 * -------------
 * One `git rev-parse --absolute-git-dir` and one `git diff --diff-filter=U` per
 * worktree, so it scales with the fleet: measured at 155 worktrees this is a few
 * seconds. That is the right trade for a command a person runs when they are
 * about to land something, and the wrong trade for a hook — which is the other
 * half of why it is not one.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It reports what git's own state files say. It cannot tell a merge that is being
 * worked on from one that was abandoned an hour ago, because git does not record
 * that either — only the mtimes of the state files and of the index, which move
 * for unrelated reasons. `WORKTREES.json` carries a chat-recency signal for
 * exactly this and it is the only one available. So this report says WHAT is in
 * progress and never says WHOSE it is; a reader who needs to know whether to
 * intervene has to establish that, and the wrong answer there destroys live work.
 * That is why `findings()` carries `destructive` as a warning to read rather than
 * a command to run.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  abortCommand,
  findings,
  readOperations,
  resolveGitDir,
  scanRepository,
  unmergedPaths,
} from './lib/git-operation-state.mjs';

const USAGE = `repo:state — report git operations in progress, in every worktree.

  node scripts/repo-state-gate.mjs            report, exit 1 if any worktree is mid-operation
  node scripts/repo-state-gate.mjs --json     the same findings as JSON on stdout

  Exits 0 when nothing is in progress. Exits 1 and prints the report otherwise.
  Advisory: it never refuses anything on its own, and it is not wired into any hook.
`;

/**
 * One worktree's line in the report.
 *
 * Both signals are printed together and never merged into one word, because they
 * answer different questions and have different remedies. "MERGE_HEAD + 0 unmerged"
 * is the shape `MERGE-INTEGRITY-AUDIT.md` §1 singles out: every conflict resolved,
 * nothing committed. `git commit` there lands an unattended resolution;
 * `git merge --abort` there throws the resolution away. A report that printed
 * "clean" for it, or that printed one merged word for both shapes, would be the
 * same defect the audit found in `workingTreeState`.
 */
function describeWorktree(finding) {
  const lines = [`  ${finding.name}${finding.branch ? `  (${finding.branch})` : ''}`, `    ${finding.path}`];

  if (finding.operations.length > 0) {
    for (const operation of finding.operations) {
      lines.push(`    in progress: ${operation.operation}  [${operation.marker}]`);
      if (operation.value) lines.push(`      ${operation.operation} target: ${operation.value}`);
    }
  }
  if (finding.unmerged.length > 0) {
    lines.push(`    unmerged in the index: ${finding.unmerged.length} path(s)`);
    for (const path of finding.unmerged.slice(0, 10)) lines.push(`      ${path}`);
    if (finding.unmerged.length > 10) lines.push(`      … and ${finding.unmerged.length - 10} more`);
  }
  if (finding.operations.length === 0 && finding.unmerged.length > 0) {
    lines.push('    no operation marker, so `git merge --abort` will NOT clean this up');
  }
  if (finding.destructive) {
    const aborts = finding.operations.filter((o) => o.operation !== 'bisect').map((o) => abortCommand(o.operation));
    lines.push(
      `    CAREFUL: ${aborts.join(' / ')} DISCARDS resolution state no commit records.`,
      '    If the conflicts above are already resolved, committing keeps the resolution',
      '    and aborting throws it away. Read the index before choosing.'
    );
  }
  return lines.join('\n');
}

const REPORT_HEADER = `repo:state — a worktree below is mid-operation.

No commit, branch name, or \`git status\` in the main checkout records this. It lives in
that worktree's git directory, which is why a session that never opens the worktree
cannot see it, and why an unattended \`git commit -a\` there can land a resolution
nobody reviewed.

Decide each worktree ON ITS OWN, and from inside it:

  ${'git -C <worktree> status --short'}
  ${'git -C <worktree> diff --name-only --diff-filter=U'}

Then either finish the operation there, or abandon it deliberately. Do not resolve or
repair any of it from the main checkout. See docs/ORCHESTRATION.md on landing.

`;

/**
 * Runs the report. Given its streams and exit function so a test drives the real
 * surface in-process and asserts on the text a person would read.
 *
 * `json` is a REPORT shape, not a control: with it, the findings go to stdout as
 * JSON and the prose goes nowhere, so a caller parsing this cannot also be reading
 * a warning it did not ask for.
 */
export function run({
  cwd = process.cwd(),
  out = process.stdout,
  err = process.stderr,
  exit = process.exit,
  json = false,
} = {}) {
  const worktrees = scanRepository(cwd);
  const found = findings(worktrees);

  if (json) {
    out.write(`${JSON.stringify({ scanned: worktrees.length, findings: found }, null, 2)}\n`);
  } else if (found.length > 0) {
    err.write(REPORT_HEADER);
    err.write(`${found.map(describeWorktree).join('\n\n')}\n\n`);
    err.write(`${found.length} of ${worktrees.length} worktree(s) are mid-operation.\n`);
  } else {
    out.write(`repo:state — clean. No worktree of ${worktrees.length} holds an operation in progress.\n`);
  }

  if (found.length > 0) {
    exit(1);
    return { findings: found, code: 1 };
  }
  return { findings: found, code: 0 };
}

/**
 * The single-worktree question `dispose-worktree.mjs` asks, exported so the guard
 * and the report cannot disagree about what "mid-operation" means.
 *
 * Separate from `run` because the guard needs the ANSWER for one directory, not a
 * roster and not a report: removing a worktree deletes its git directory, and with
 * it the state files that are the only record of a resolution. That is data loss
 * with no reflog entry and no `git fsck` recovery, which is why this is a
 * precondition rather than a warning.
 */
export function inspectWorktree(path) {
  const gitDir = resolveGitDir(path);
  return { gitDir, operations: readOperations(gitDir), unmerged: unmergedPaths(path) };
}

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
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(USAGE);
  } else {
    run({ json: process.argv.includes('--json') });
  }
}
