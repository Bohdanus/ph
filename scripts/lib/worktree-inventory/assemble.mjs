/**
 * Assembling the document: joining the git facts, the chat audit, the board
 * state and the curated descriptions into the inventory that gets written out.
 *
 * The output is sorted worst-first by risk, not alphabetically, because the
 * question an operator opens this file to answer is "what is about to be lost",
 * and an alphabetical list makes them read all 70 entries to find it.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
import { classify, riskScore, ACTION } from './classify.mjs';
import { summariseChats, isUnfinished, isDead } from './chats.mjs';
import { curatedFor } from './curated.mjs';
import { inferBoardIssues } from './board.mjs';

export const SCHEMA_VERSION = 1;

/**
 * Path relative to the repository root, by path SEGMENT rather than by string
 * prefix. A naive `absolute.slice(root.length + 1)` mangles any path that
 * merely starts with the root's characters, and the output of this file is
 * meant to be joined back onto a checkout.
 */
function relativePathFor(root, absolute) {
  if (absolute === root) return '.';
  const rest = absolute.slice(root.length);
  if (rest.startsWith('/')) return rest.slice(1);
  return absolute;
}

/** Build the inventory object. Pure with respect to every input except `nowMs`. */
export function buildInventory({
  worktrees,
  root,
  base,
  mainHead,
  board,
  chatAudit,
  nowMs,
  chatWindowMs = 24 * 60 * 60 * 1000,
}) {
  // `nowMs` is clamped to the newest thing the data can know about, on BOTH
  // sides. `chats.mjs` clamps internally for its own classification, but
  // `classify` was still handed the raw value, so a `--now` pinned in the past
  // made `nowMs - lastActivity` negative — which passes the liveness test — and
  // flipped a dozen worktrees from `salvage` to `in-use`. A flag whose purpose
  // is reproducibility must not change the answer.
  const newestKnown = chatAudit?.newestSessionAt ?? 0;
  const effectiveNow = Math.max(nowMs, newestKnown);

  const records = worktrees.map((wt) => {
    const curated = curatedFor(wt.name) ?? null;
    const chatSessions = chatAudit.byDirectory.get(wt.path) ?? [];
    const chatSummary = summariseChats(chatSessions);
    // Declared before `classify` reads it: the board's agent record is the
    // only liveness signal for a session opened in the main checkout and then
    // driven into a task worktree.
    const boardAgents = board.agents?.get(wt.path) ?? [];
    const verdict = classify(wt, { chatSummary, chatSessions, curated, nowMs: effectiveNow, boardAgents });

    const claims = board.claims?.get(wt.path) ?? [];
    const fileLocks = board.fileLocks?.get(wt.path) ?? [];
    const inferredBoardIssues = inferBoardIssues(board.issues ?? [], { branch: wt.branch, name: wt.name });

    // Unfinished is a first-class field, not a footnote: an operator reading
    // this file needs to know which entries still have an agent mid-struggle
    // without correlating three other sections to discover it. The predicate is
    // imported, not restated: it used to be written out here, in classify.mjs
    // and as a negation in chats.mjs, and the copies agreed only by hand.
    const unfinished = chatSessions.filter(isUnfinished);
    const dead = chatSessions.filter(isDead);

    return {
      name: wt.name,
      path: relativePathFor(root, wt.path),
      absolutePath: wt.path,
      branch: wt.branch,
      isPrimary: wt.isPrimary,
      head: wt.head,
      detached: Boolean(wt.detached),

      status: verdict.status,
      recommendation: verdict.recommendation,
      action: verdict.action,
      prunable: verdict.prunable,
      mergeConflict: verdict.mergeConflict,
      mergeConflictFiles: verdict.mergeConflictFiles,
      // Disambiguates the two things `mergeConflict: null` can mean: the check
      // was skipped (already on main, or detached), or it was attempted and
      // could not be answered.
      mergeChecked: verdict.mergeChecked,
      riskScore: riskScore(verdict),
      statusReasons: verdict.reasons,

      // The three facts that decide everything else, kept flat so a reader
      // scanning a diff can see a worktree's state change without opening it.
      ahead: wt.ahead,
      behind: wt.behind,
      mergedIntoMain: wt.mergedIntoBase,
      dirty: wt.workingTree.modified,
      untracked: wt.workingTree.untracked,
      dirtyPaths: wt.workingTree.paths,

      lastCommit: wt.tip,
      commitsAhead: wt.commits,
      commitsAheadTruncated: wt.truncated,

      // The curator's claim about this branch, next to git's. A test asserts
      // the two agree, so a stale `landed: true` fails the suite instead of
      // quietly contradicting `mergedIntoMain` in the same record.
      claimedLanded: curated?.landed ?? null,

      summary: curated?.summary ?? null,
      summarySource: curated?.summary ? 'curated' : 'none',
      issues: curated?.issues ?? [],
      inferredBoardIssues,
      note: curated?.note ?? null,
      liveNote: curated?.liveNote ?? null,
      mustNotPrune: Boolean(curated?.mustNotPrune),

      chats: {
        count: chatSummary.count,
        chatIds: chatSummary.chatIds,
        subagentCount: chatSummary.subagentCount,
        byState: chatSummary.byState,
        activeChatIds: chatSummary.activeChatIds,
        unfinishedChatIds: chatSummary.unfinishedChatIds,
        lastActivity: chatSummary.lastActivity,
        unfinished: unfinished.map((s) => ({
          id: s.id,
          title: s.title,
          state: s.state,
          idleMs: s.idleMs,
          reasons: s.reasons,
          toolErrors: s.toolErrors,
          creditsFailures: s.creditsFailures,
          blockedOn: s.blockedOn ?? null,
        })),
        dead: dead.map((s) => ({
          id: s.id,
          title: s.title,
          state: s.state,
          reasons: s.reasons,
          creditsFailures: s.creditsFailures,
        })),
      },

      board: {
        claims,
        fileLocks,
        agents: boardAgents,
        held: claims.length + fileLocks.length > 0,
      },
    };
  });

  records.sort((a, b) => b.riskScore - a.riskScore || a.name.localeCompare(b.name));

  const byStatus = {};
  const byRecommendation = {};
  const byChatState = {};
  const byAction = {};
  for (const r of records) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byRecommendation[r.recommendation] = (byRecommendation[r.recommendation] ?? 0) + 1;
    byAction[r.action] = (byAction[r.action] ?? 0) + 1;
    for (const [state, n] of Object.entries(r.chats.byState)) {
      byChatState[state] = (byChatState[state] ?? 0) + n;
    }
  }

  // The two lists an operator opens this file for, named at the top rather
  // than left for a reader to derive by filtering the whole list. `readyToLand` is
  // the answer to "what is finished and just needs merging" and
  // `disposalCandidates` is the answer to "what can I delete right now".
  //
  // Names only, deliberately: the record itself carries the reason, the
  // branch, the commit count and the conflict answer, and a name duplicated
  // into a second place is a number that goes stale on its own.
  const byActionNames = (action) => records.filter((r) => r.action === action).map((r) => r.name);
  const readyToLand = byActionNames(ACTION.LAND);
  const disposalCandidates = byActionNames(ACTION.DISPOSE);
  const atRisk = byActionNames(ACTION.AT_RISK);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(effectiveNow).toISOString(),
    generator: 'scripts/worktree-inventory.mjs',
    base,
    mainHead,
    chatWindowMs,
    dataSources: {
      git: { ok: worktrees.length > 0, root, base },
      sessions: chatAudit.available
        ? { ok: true, path: chatAudit.dbPath, sessions: chatAudit.total }
        : { ok: false, reason: 'no Kilo session database at the expected path' },
      board: board.available
        ? { ok: true, path: board.dbPath, issues: board.issues.length }
        : { ok: false, reason: 'no agent-board database at the expected path' },
    },
    // Read these first. They are the answers; `worktrees` is the evidence.
    readyToLand,
    disposalCandidates,
    atRisk,

    totals: {
      worktrees: records.length,
      prunable: records.filter((r) => r.prunable).length,
      readyToLand: readyToLand.length,
      disposalCandidates: disposalCandidates.length,
      atRisk: atRisk.length,
      salvage: records.filter((r) => r.recommendation === 'salvage').length,
      inUse: records.filter((r) => r.recommendation === 'in-use').length,
      holdingUncommittedWork: records.filter((r) => r.dirty + r.untracked > 0).length,
      withoutSummary: records.filter((r) => !r.summary).length,
      byStatus,
      byRecommendation,
      byAction,
      byChatState,
    },
    worktrees: records,
  };
}

/** Serialise with the key order the schema documents, and a trailing newline. */
export function serialise(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

/**
 * Format the document the way Prettier formats JSON, so a regenerated file is
 * already canonical and the commit gate is a no-op.
 *
 * Without this the two formatters disagree — Prettier collapses short arrays
 * onto one line, `JSON.stringify(_, null, 2)` does not — so every regeneration
 * produced a file `lint-staged --fail-on-changes` refused and un-staged, and
 * the fix would have been either a `.prettierignore` (which this repository
 * deliberately does not have, per AGENTS.md) or dropping `.json` from the
 * linted set. Both weaken a gate to accommodate a generator; this removes the
 * disagreement instead.
 *
 * Resolved with `require.resolve` rather than a hardcoded `node_modules/.bin`
 * path, because most worktrees have no local `node_modules` — Node walks up to
 * the ancestor checkout, and a relative path would silently miss it and fall
 * back to the unformatted output on exactly the checkouts that run the gates.
 * Run through `process.execPath` so the exec bit is never a factor.
 *
 * Falls back to plain two-space JSON when Prettier is not installed anywhere.
 * That is still correct and still valid; it will simply be reflowed on first
 * commit.
 */
export function formatCanonical(json) {
  try {
    const pkgPath = require.resolve('prettier/package.json');
    const bin = join(dirname(pkgPath), 'bin', 'prettier.cjs');
    return execFileSync(process.execPath, [bin, '--parser', 'json'], {
      input: json,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return json;
  }
}
