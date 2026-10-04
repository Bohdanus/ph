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
 * `.git/worktrees/<name>/`, and every reader of it was scoped to the worktree it
 * stands in.
 *
 * It is deliberately NOT wired into `gate:push` or `pre-push`. Blocking every push in
 * the repository because SOME OTHER worktree is mid-merge would punish every session
 * for one session's state, and the agent that hits it resolves an obstacle the way
 * this repository's history says it does — by bypassing it. A gate that stops the
 * whole swarm to report one worktree's state gets switched off, and then it protects
 * nothing.
 *
 * So this REPORTS, loudly, on demand, and the one place that can destroy the state
 * acts on it: `dispose-worktree.mjs` refuses to remove a worktree holding an
 * operation in progress.
 *
 * WHAT IT COSTS
 * -------------
 * Two git spawns per worktree — `rev-parse --absolute-git-dir` and
 * `diff --name-only --diff-filter=U` — plus one `worktree list`, so it scales with
 * the fleet: seconds on a fleet of this repository's size. That is the right trade for
 * a command a person runs when they are about to land something, and the wrong trade
 * for a hook, which is the other half of why it is not one. The worktree count is
 * deliberately NOT written into this file, and an earlier version carried one that was
 * already stale by review time: it is a property of the machine, not of the code, and a
 * number here goes out of date the moment a session creates a worktree.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * It reports what git's own state files say. It cannot tell a merge that is being
 * worked on from one that was abandoned an hour ago, because git does not record
 * that either — only the mtimes of the state files and of the index, which move for
 * unrelated reasons. `WORKTREES.json` carries a chat-recency signal for exactly this
 * and it is the only one available. So this report says WHAT is in progress and
 * never says WHOSE it is; a reader who needs to know whether to intervene has to
 * establish that, and the wrong answer there destroys live work. That is why
 * `findings()` carries `destructive` as a warning to read rather than a command to
 * run.
 *
 * IT FAILS CLOSED ON ITS OWN UNREADABILITY
 * ----------------------------------------
 * If the roster cannot be read, or a worktree cannot be described, the exit code is
 * non-zero and the report says which. `dispose-worktree.mjs` refuses on exactly these
 * inputs, and an earlier version of this program answered both with exit 0 and the
 * word "clean" — so the two surfaces disagreed about the same repository, and the one
 * a person runs by hand was the one that reported health it had not established.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { abortCommand, findings, scanRepository } from './lib/git-operation-state.mjs';

const USAGE = `repo:state — report git operations in progress, in every worktree.

  node scripts/repo-state-gate.mjs            report, exit 1 if any worktree is mid-operation
  node scripts/repo-state-gate.mjs --json     the same findings as JSON on stdout

  Exits 0 only when the roster was read and nothing is in progress. Exits 1 otherwise,
  and says whether that is a worktree mid-operation or a state it could not read.
  Advisory: it never refuses anything on its own, and it is wired into no hook.
`;

/**
 * One worktree's block in the report.
 *
 * All three signals are printed together and never merged into one word, because they
 * answer different questions and have different remedies. "MERGE_HEAD with 0 unmerged"
 * is the shape `MERGE-INTEGRITY-AUDIT.md` §1 singles out: every conflict resolved,
 * nothing committed. `git commit` there lands an unattended resolution;
 * `git merge --abort` there throws the resolution away. A report that printed "clean"
 * for it, or that printed one merged word for both shapes, would be the same defect
 * the audit found in `workingTreeState`.
 */
function describeWorktree(finding) {
  const lines = [`  ${finding.name}${finding.branch ? `  (${finding.branch})` : ''}`, `    ${finding.path}`];

  if (finding.readError)
    lines.push(`    NOT READ: ${finding.readError}. This is not a statement that nothing is happening here.`);

  for (const operation of finding.operations) {
    lines.push(`    in progress: ${operation.operation}  [${operation.marker}]`);
    if (operation.value) lines.push(`      ${operation.operation} target: ${operation.value}`);
  }

  if (finding.unmerged.length > 0) {
    lines.push(`    unmerged in the index: ${finding.unmerged.length} path(s)`);
    for (const path of finding.unmerged.slice(0, 10)) lines.push(`      ${path}`);
    if (finding.unmerged.length > 10) lines.push(`      … and ${finding.unmerged.length - 10} more`);
  }

  if (finding.operations.length === 0 && finding.unmerged.length > 0) {
    lines.push('    no operation marker, so no `git merge --abort` will clean this up — see the index yourself');
  }

  if (finding.destructive) {
    // Filtered on `destructive`, which the finding already computed, rather than on a
    // second test of the same thing: `git bisect reset` returns a non-null command and
    // would otherwise be printed under a heading saying it DISCARDS resolution state,
    // which this file says two dozen lines earlier that it does not.
    const discards = finding.operations
      .filter((o) => o.operation !== 'bisect')
      .map(abortCommand)
      .filter(Boolean);
    lines.push(
      `    CAREFUL: ${discards.join(' / ')} DISCARDS resolution state no commit records.`,
      '    If the conflicts above are already resolved, committing keeps the resolution',
      '    and aborting throws it away. Read the index before choosing.'
    );
  } else if (finding.operations.length > 0) {
    // Reached when nothing here has a destructive abandon command: a squash, which git
    // cannot abandon at all, and a bisect, which `git bisect reset` leaves intact. An
    // earlier version branched on `every(op => abortCommand(op) === null)`, which a
    // squash beside a bisect fails — bisect returns a string — so that shape got no
    // advice at all. Branching on `!destructive` covers every combination.
    lines.push(
      '    None of these has a command that would discard the state, so decide by hand: finish or commit the work, or reset the worktree yourself.'
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

  git -C <worktree> status --short
  git -C <worktree> diff --name-only --diff-filter=U

Then either finish the operation there, or abandon it deliberately. Do not resolve or
repair any of it from the main checkout. See docs/ORCHESTRATION.md on landing.

`;

const UNREADABLE = `repo:state — the roster could not be read, so nothing here is a statement about the repository.

  ${'git worktree list --porcelain'}

Run it inside a checkout of this repository. This program reports what git's state files
say, and it will not report a repository it could not look at as clean.

`;

/**
 * Runs the report. Given its streams and exit function so a test drives the real
 * surface in-process and asserts on the text a person would read.
 *
 * `json` is a REPORT shape, not a control: with it, the findings go to stdout as JSON
 * and the prose goes nowhere, so a caller parsing this cannot also be reading a
 * warning it did not ask for.
 *
 * `scan` is a seam, and it exists because of what could not otherwise be tested. Several
 * shapes that matter here — a `gitdir` that will not resolve, a squash beside a bisect,
 * a roster git will not print — are either unreachable on a healthy repository or need a
 * hand-built filesystem to reach at all, and a report whose branches are exercised only
 * against real repositories is a report whose branches are untested. The reader this
 * replaced had no seam either, so both of its fail-open arms were unpinnable; that was
 * a review finding against this file.
 */
export function run({
  cwd = process.cwd(),
  out = process.stdout,
  err = process.stderr,
  exit = process.exit,
  json = false,
  scan = scanRepository,
} = {}) {
  const scanned = scan(cwd);

  if (!scanned.ok) {
    if (json)
      out.write(
        `${JSON.stringify({ scanned: 0, ok: false, reason: scanned.reason, detail: scanned.detail, findings: [] }, null, 2)}\n`
      );
    else err.write(`${UNREADABLE}  ${scanned.reason}: ${scanned.detail}\n`);
    exit(1);
    return { findings: [], code: 1, ok: false };
  }

  const found = findings(scanned.worktrees);

  if (json) {
    out.write(`${JSON.stringify({ scanned: scanned.worktrees.length, ok: true, findings: found }, null, 2)}\n`);
  } else if (found.length > 0) {
    err.write(REPORT_HEADER);
    err.write(`${found.map(describeWorktree).join('\n\n')}\n\n`);
    const unreadable = found.filter((f) => f.readError).length;
    err.write(
      `${found.length} of ${scanned.worktrees.length} worktree(s) need${found.length === 1 ? 's' : ''} attention` +
        `${unreadable > 0 ? `, ${unreadable} of them because they could not be read` : ''}.\n`
    );
  } else {
    out.write(`repo:state — clean. No worktree of ${scanned.worktrees.length} holds an operation in progress.\n`);
  }

  if (found.length > 0) {
    exit(1);
    return { findings: found, code: 1, ok: true };
  }
  return { findings: found, code: 0, ok: true };
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
