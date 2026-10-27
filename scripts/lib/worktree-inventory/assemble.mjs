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
import { summariseWrites, summariseReads, summariseShell } from './writes.mjs';
import { curatedFor } from './curated.mjs';
import { inferBoardIssues } from './board.mjs';
import { auditVerdict, unread, isReadUnfinished } from './chat-audit.mjs';

export const SCHEMA_VERSION = 7;

const RISK_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Path relative to the repository root, by path SEGMENT rather than by string
 * prefix. A naive `absolute.slice(root.length + 1)` mangles any path that
 * merely starts with the root's characters, and the output of this file is
 * meant to be joined back onto a checkout.
 */
function relativePathFor(root, absolute) {
  if (absolute === root) return '.';
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1);
  // Outside the repository. Slice(3) here produced a path fragment that looked
  // relative but resolved to nothing, which is the worst of both.
  return absolute;
}

/** Build the inventory object from an evaluation clock and a generation clock. */
export function buildInventory({
  worktrees,
  branchOnlyRefs = [],
  root,
  base,
  mainHead,
  board,
  chatAudit,
  writeAudit = null,
  readAudit = { available: false, byId: new Map(), records: [] },
  nowMs,
  generatedAtMs = Date.now(),
  chatWindowMs = 24 * 60 * 60 * 1000,
  liveWindowMs = 30 * 60 * 1000,
  /**
   * Readers whose last read predates this are not emitted.
   *
   * A release has to be a WATERMARK rather than an event, because the document is
   * regenerated from the database on every run: a flag that dropped readers once
   * would simply be repopulated by the next run from the same rows. Moving the
   * mark forward is permanent, needs no record of which entries it removed, and
   * touches only the reader list — writers are never filtered by it.
   */
  readsReleasedBeforeMs = 0,
  // A DECLARED hard state, or null. Set when the operator knows something the
  // database cannot: that the editor restarted and took every chat with it. The
  // recency heuristics all keep answering "active" for half an hour afterwards,
  // and a file that says a dead chat owns a worktree is worse than one that says
  // nothing — so the override wins, and everything it overrode is kept beside it.
  liveWritersSuppressed = null,
  // The curated table is a MODULE, not a parameter, so an injected reader is the
  // only way a test can place an entry against a worktree that does not exist in
  // the real table. Without it, `legacy` — a hand-written flag — could only be
  // exercised by editing `curated.mjs`, and the assertions about the `legacy`
  // list would be unreachable for any branch this repository has not got.
  // Every other source above is injected for the same reason.
  curatedOf = curatedFor,
}) {
  // Keep the evaluation clock separate from the wall-clock generation time.
  // `--now` may deliberately reproduce recency decisions at another time, but
  // it must never make a fresh inventory appear future-dated to `dispose`.
  const newestKnown = chatAudit?.newestSessionAt ?? 0;
  const effectiveNow = Math.max(nowMs, newestKnown);

  // Live state per worktree, so a read-derived claim can be re-checked rather
  // than merely repeated.
  const liveStateByDirectory = new Map(
    worktrees.map((w) => [
      w.name,
      { dirty: w.workingTree.modified, untracked: w.workingTree.untracked, ahead: w.ahead },
    ])
  );

  const records = worktrees.map((wt) => {
    const curated = curatedOf(wt.name) ?? null;
    const chatSessions = chatAudit.byDirectory.get(wt.path) ?? [];
    const chatSummary = summariseChats(chatSessions);
    // Declared before `classify` reads it: the board's agent record is the
    // only liveness signal for a session opened in the main checkout and then
    // driven into a task worktree.
    const boardAgents = board.agents?.get(wt.path) ?? [];
    // All three histories are looked up by the worktree's ABSOLUTE path, because
    // that is how `writes.mjs` attributed every call. A worktree living outside
    // the repository — several agents keep scratch ones in /tmp — has no recorded
    // history until somebody works in it, so the empty shape is the default
    // rather than a missing field.
    const raw = writeAudit?.available ? writeAudit.byWorktree.get(wt.path) : null;
    const suppressed = Boolean(liveWritersSuppressed);
    const writeHistory = summariseWrites(raw?.write ?? null, { nowMs: effectiveNow, liveWindowMs, suppressed });
    const readHistory = summariseReads(raw?.read ?? null, {
      nowMs: effectiveNow,
      liveWindowMs,
      releasedBeforeMs: readsReleasedBeforeMs,
    });
    const shellHistory = summariseShell(raw?.shell ?? null, { nowMs: effectiveNow, liveWindowMs });

    const verdict = classify(wt, {
      chatSummary,
      chatSessions,
      curated,
      nowMs: effectiveNow,
      base,
      boardAgents,
      writeHistory,
      shellHistory,
      readHistory,
      liveWritersSuppressed,
    });

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

    // The READ verdict, attached to each session. Both are emitted and neither
    // is reconciled: where a computed "finished" sits next to a read
    // "struggling", that disagreement is the finding, and collapsing it would
    // hide the exact case this audit was run to find.
    const withRead = chatSessions.map((c) => {
      const record = readAudit.byId.get(c.id);
      return record
        ? { ...c, read: auditVerdict(record, { risk: record.readRisk, worktreeGone: record.worktreeGone }) }
        : { ...c, read: null };
    });

    return {
      name: wt.name,
      // A worktree can live anywhere — several agents run scratch worktrees
      // in /tmp. `inRepo` separates the ones this repository's curated table is
      // about from transients, because "every worktree needs a curated entry"
      // is only a sensible rule for the first kind.
      inRepo: wt.path === root || wt.path.startsWith(`${root}/`),
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
      mergeResultMatchesBase: verdict.mergeResultMatchesBase,
      // "We have an answer", not "the check ran". It does NOT disambiguate the
      // two things `mergeConflict: null` can mean: `mergeVerdict` returns
      // 'unknown' for a skipped check (already on main, or detached) and for a
      // check that ran and could not be answered, and both land here as false.
      // Callers must treat false as *no answer*, never as "skipped".
      mergeChecked: verdict.mergeChecked,
      riskScore: riskScore(verdict),
      statusReasons: verdict.reasons,
      patchEquivalence: verdict.patchEquivalence,
      patchEquivalenceReason: verdict.patchEquivalenceReason,

      // The three facts that decide everything else, kept flat so a reader
      // scanning a diff can see a worktree's state change without opening it.
      ahead: wt.ahead,
      behind: wt.behind,
      mergedIntoMain: wt.mergedIntoBase,
      dirty: wt.workingTree.modified,
      untracked: wt.workingTree.untracked,
      statusError: wt.workingTree.statusError ?? null,
      locked: Boolean(wt.locked),
      prunableReason: wt.prunableReason ?? null,
      // The subset of `dirty` whose content main does NOT already hold, plus
      // every untracked path. Reported beside `dirty` and never instead of it:
      // `dirty` counts what differs from this worktree's own HEAD, so on a
      // branch behind main it is mostly "main moved on", and a reader who
      // treats it as the size of the salvage gets an answer several times too
      // large. `dirty` stays the number the disposal test uses.
      notOnMain: wt.workingTree.notOnBase,
      dirtyPaths: wt.workingTree.paths,

      lastCommit: wt.tip,
      commitsAhead: wt.commits,
      commitsAheadTruncated: wt.truncated,

      // The curator's claim about this branch, next to git's. A test asserts
      // the two agree, so a stale `landed: true` fails the suite instead of
      // quietly contradicting `mergedIntoMain` in the same record.
      claimedLanded: curated?.landed ?? null,
      legacy: Boolean(curated?.legacy),

      summary: curated?.summary ?? null,
      summarySource: curated?.summary ? 'curated' : 'none',
      issues: curated?.issues ?? [],
      inferredBoardIssues,
      note: curated?.note ?? null,
      liveNote: curated?.liveNote ?? null,
      mustNotPrune: Boolean(curated?.mustNotPrune),
      // Merges on `main` whose subject already carried this branch's name.
      // Advisory and verdict-free — it exists so a reader about to read a name as
      // proof of landing sees, in the same record, that the name proves nothing.
      // `git.mjs` carries the reasoning and the 2026-10-01 sweep it replaces.
      nameCollisions: wt.nameCollisions ?? [],

      chats: {
        count: chatSummary.count,
        chatIds: chatSummary.chatIds,
        subagentCount: chatSummary.subagentCount,
        byState: chatSummary.byState,
        activeChatIds: chatSummary.activeChatIds,
        unfinishedChatIds: chatSummary.unfinishedChatIds,
        lastActivity: chatSummary.lastActivity,
        readUnfinished: withRead
          .filter((c) => c.read && isReadUnfinished(c.read.readState))
          .map((c) => ({
            id: c.id,
            readState: c.read.readState,
            readRisk: c.read.readRisk,
            workOnNoRef: c.read.workOnNoRef,
            note: c.read.note,
          })),
        read: withRead.map((c) => c.read),
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

      // THREE histories, not one, because they have three different lifetimes.
      //
      // `writeHistory` — who WROTE here, over all of history, and who is writing
      // right now. Separate from `chats` above, which is windowed and
      // directory-keyed: that one answers "who is here at the moment", this one
      // answers "whose work is this", and for a worktree built and abandoned last
      // week only the second has an answer at all. PERMANENT.
      writeHistory,

      // `readHistory` — who READ here. RELEASABLE via `readsReleasedBefore` at the
      // top of the document. Reading a worktree is interest, not authorship, and
      // a reader list that only grows stops answering "who is looking at this"
      // while still claiming to.
      readHistory,

      // `shellHistory` — commands run with a `workdir` inside this worktree.
      // `writeCapableCalls` is the honest headline: a shell can write a file and
      // this structure cannot see that it did, so the number is the size of the
      // gap in `writeHistory`, not a count of writes.
      shellHistory,

      // `live` and the raw signals behind it, so a reader can see whether
      // "nobody is working here" was derived or declared.
      live: verdict.live,
      derivedLive: verdict.derivedLive,
      liveSignals: verdict.liveSignals,
      liveSuppressed: verdict.liveSuppressed,

      board: {
        claims,
        fileLocks,
        agents: boardAgents,
        held: claims.length + fileLocks.length > 0,
      },

      // What the transcript says about the agents that worked here, beside
      // what their turn-shape says. Both, deliberately.
      read: withRead
        .filter((c) => c.read)
        .map((c) => ({
          id: c.id,
          readState: c.read.readState,
          readRisk: c.read.readRisk,
          workOnNoRef: c.read.workOnNoRef,
          // `directoryExists` rather than `worktreeGone`: this loop only
          // reaches sessions whose directory still exists, so a worktreeGone
          // field here is a constant. The real signal is `readLostWorktree`.
          directoryExists: true,
          deadSubagents: c.read.deadSubagents,
          note: c.read.note,
        })),
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
  // Named because it is the list that answers "what may I remove without losing
  // anything", and it is a list of its own precisely because a legacy worktree
  // also appears under no other action: it is disposable AND worth keeping, and
  // one `action` field can only say one of those at a time. See `ACTION.LEGACY`.
  const legacy = byActionNames(ACTION.LEGACY);
  const inUse = byActionNames(ACTION.IN_USE);
  const undecided = byActionNames(ACTION.UNDECIDED);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(generatedAtMs).toISOString(),
    generator: 'scripts/worktree-inventory.mjs',
    base,
    mainHead,
    chatWindowMs,
    liveWindowMs,

    /**
     * The ownership answer, at the top of the document.
     *
     * `liveWriterChatIds` is every chat that wrote in any worktree inside the
     * liveness window, and `suppressed` says whether that list is what the
     * database said or what the operator declared. A file that reports zero live
     * writers is ambiguous — nobody is writing, or every writer is dead — and
     * those two demand opposite responses, so the reason is carried with it
     * rather than left to the reader to guess from an empty array.
     */
    ownership: {
      asOf: new Date(effectiveNow).toISOString(),
      liveWriterChatIds: [...new Set(records.flatMap((r) => r.writeHistory.currentChatIds))].sort(),
      liveWriterCount: new Set(records.flatMap((r) => r.writeHistory.currentChatIds)).size,
      // Shell traffic is reported beside the writers because it is the part of
      // "is anybody in there" that the writer list cannot see: a session that
      // only ever ran commands in a worktree wrote no file and so names no
      // writer, while being plainly present.
      liveShellChatIds: [...new Set(records.flatMap((r) => r.shellHistory.currentChatIds))].sort(),
      liveShellCount: new Set(records.flatMap((r) => r.shellHistory.currentChatIds)).size,
      derivedLiveWorktrees: records
        .filter((r) => r.derivedLive)
        .map((r) => r.name)
        .sort(),
      suppressed: Boolean(liveWritersSuppressed),
      suppressedAt: liveWritersSuppressed ? new Date(effectiveNow).toISOString() : null,
      reason: liveWritersSuppressed,
      worktreesWithWriteHistory: records.filter((r) => r.writeHistory.chatCount > 0).length,
      worktreesWithReadHistory: records.filter((r) => r.readHistory.chatCount > 0).length,
      /**
       * The reader release mark, published here so it is visible without walking
       * to a worktree. It is a WATERMARK, not an event, and it only moves
       * forward: readers below it have been released and are never emitted again,
       * while `writeHistory` is untouched by it.
       */
      readsReleasedBefore: readsReleasedBeforeMs > 0 ? new Date(readsReleasedBeforeMs).toISOString() : null,
      readsReleasedChatCount: records.reduce((n, r) => n + r.readHistory.chatCount, 0),
    },
    dataSources: {
      git: { ok: worktrees.length > 0, root, base },
      sessions: chatAudit.available
        ? {
            ok: true,
            path: chatAudit.dbPath,
            sessions: chatAudit.total,
            ...(chatAudit.snapshot ? { snapshot: true } : {}),
          }
        : { ok: false, reason: chatAudit.reason ?? 'no Kilo session database at the expected path' },
      board: board.available
        ? { ok: true, path: board.dbPath, issues: board.issues.length }
        : { ok: false, reason: 'no agent-board database at the expected path' },
      // The read audit is the one data source that goes stale on its own: it
      // records what transcripts said at a moment in time, and agents commit
      // and get deleted afterwards. The `asOf` stamp is therefore part of the
      // source description, not an optional extra.
      readAudit: readAudit.available
        ? {
            ok: true,
            path: readAudit.path,
            sessions: readAudit.records.length,
            asOf: readAudit.asOf,
            windowHours: readAudit.windowHours,
          }
        : {
            ok: false,
            reason: readAudit.reason ?? 'no transcript read audit at the expected path',
            corrupt: readAudit.corrupt ?? false,
          },
      /**
       * The call history, as three separate totals.
       *
       * `attributed` and `total` are both published for writes because the
       * difference is the honest part: `total` counts every completed write call
       * this machine made against a path under any of these worktrees, and
       * `attributed` counts the ones that resolved to a worktree this document
       * knows about. They are PER KIND and must not be summed together — a
       * single mixed counter made the write total meaningless the moment a second
       * kind existed.
       *
       * There is deliberately no `sessions` field. An earlier version reported
       * the count of sessions in the database, which is every session on the
       * machine including the ones that never wrote, under a key that said
       * `writes`.
       */
      calls: writeAudit?.available
        ? {
            ok: true,
            path: writeAudit.dbPath,
            ...(writeAudit.snapshot ? { snapshot: true } : {}),
            write: {
              total: writeAudit.totalWriteCalls,
              attributed: writeAudit.attributedWriteCalls,
              unmapped: writeAudit.unmapped.write,
            },
            read: { total: writeAudit.totalReadCalls, unmapped: writeAudit.unmapped.read },
            shell: { total: writeAudit.totalShellCalls, unmapped: writeAudit.unmapped.shell },
            unmappedBuckets: writeAudit.unmappedBuckets,
          }
        : { ok: false, reason: writeAudit?.reason ?? 'no Kilo session database at the expected path' },
    },
    // Read these first. They are the answers; `worktrees` is the evidence.
    readyToLand,
    disposalCandidates,
    atRisk,
    legacy,

    /**
     * Local branches that no worktree holds — invisible to `git worktree list`.
     * Git-derived categories describe ancestry and `git cherry` observations;
     * they do not establish ownership, provenance, tree equivalence, or intent.
     * Keep this separate from `worktrees`: there is no checkout to inspect.
     */
    branchOnlyRefs: branchOnlyRefs.map((r) => ({
      name: r.name,
      category: r.category,
      isAncestor: r.isAncestor,
      cherryPlusCount: r.cherryPlusCount,
      ahead: r.ahead,
      behind: r.behind,
      tip: r.tip,
      reason: r.reason,
    })),

    /**
     * Worktrees that were deleted, and who had written in them.
     *
     * It MUST be a top-level list for the same reason `readLostWorktree` is: the
     * per-worktree loop only visits worktrees that still exist, so a deleted one
     * has no record to hang this on. It is the half of the ownership history
     * that `git worktree list` cannot produce at all, and it is where the
     * uncommitted work tends to be — a worktree that was removed while a chat
     * was mid-flight leaves exactly this trace and nothing else.
     */
    goneWorktrees: writeAudit?.available ? writeAudit.goneWorktrees : [],

    // Every session a reader of the transcript says is unfinished, and the
    // ones where the work exists on no ref at all. These are the answers to
    // "which agents have work in flight, or died holding it".
    readUnfinished: unread(
      readAudit.records.map((r) => ({
        id: r.id,
        readState: r.readState,
        readRisk: r.readRisk,
        note: r.note ?? null,
        modifiedFiles: r.modifiedFiles,
        commitsAheadOfMain: r.commitsAheadOfMain,
      }))
    ),
    // Cross-checked against the tree as it is NOW, because a read-derived
    // count is a claim about a moment and the operator reads it later. Every
    // entry below said "on no ref" at `asOf`; without this they would still say
    // so, printed beside a `dirty=0` record for the same worktree.
    workOnNoRef: readAudit.records
      .filter((r) => r.untrackedFiles > 0 || (r.modifiedFiles > 0 && r.commitsAheadOfMain === 0))
      .map((r) => {
        const live = liveStateByDirectory.get(r.directory) ?? null;
        const landedSince = live !== null && live.dirty + live.untracked === 0 && live.ahead > 0;
        return {
          id: r.id,
          directory: r.directory,
          modifiedFiles: r.modifiedFiles,
          untrackedFiles: r.untrackedFiles,
          asOf: readAudit.asOf,
          // false  = the work landed after the audit was taken
          // null  = the directory is gone, so it cannot be checked at all
          // true   = still uncommitted on no ref, as far as the tree can tell
          stillOnNoRef: live === null ? null : !landedSince,
          liveDirty: live ? live.dirty + live.untracked : null,
          liveAhead: live ? live.ahead : null,
          note: r.note ?? null,
        };
      }),

    // The finding no computed signal can produce: a session produced work and
    // the directory holding it no longer exists. It MUST be a top-level list —
    // every such session ran in a directory that is gone, so the per-worktree
    // loop, which only visits worktrees that exist, can never reach it. It was
    // previously emitted on the worktree record, where it was structurally
    // always false, which is the same as not emitting it.
    readLostWorktree: readAudit.records
      .filter((r) => r.worktreeGone)
      .map((r) => ({
        id: r.id,
        directory: r.directory,
        readState: r.readState,
        readRisk: r.readRisk,
        note: r.note ?? null,
      }))
      .sort((a, b) => RISK_ORDER[a.readRisk] - RISK_ORDER[b.readRisk] || a.id.localeCompare(b.id)),
    readLostWorktreeHighRisk: readAudit.records.filter((r) => r.worktreeGone && r.readRisk === 'high').length,
    inUse,
    undecided,

    totals: {
      worktrees: records.length,
      branchOnlyRefs: branchOnlyRefs.length,
      branchOnlyAncestor: branchOnlyRefs.filter((r) => r.category === 'ancestor').length,
      branchOnlyUnmatchedPatches: branchOnlyRefs.filter((r) => r.category === 'unmatched-patches').length,
      branchOnlyZeroCherryPatches: branchOnlyRefs.filter((r) => r.category === 'zero-cherry-patches').length,
      branchOnlyUnknown: branchOnlyRefs.filter((r) => r.category === 'unknown').length,
      prunable: records.filter((r) => r.prunable).length,
      readyToLand: readyToLand.length,
      disposalCandidates: disposalCandidates.length,
      atRisk: atRisk.length,
      legacy: legacy.length,
      inUse: inUse.length,
      undecided: undecided.length,
      salvage: records.filter((r) => r.recommendation === 'salvage').length,
      inUse: records.filter((r) => r.recommendation === 'in-use').length,
      holdingUncommittedWork: records.filter((r) => r.dirty + r.untracked > 0).length,
      withoutSummary: records.filter((r) => !r.summary).length,
      withWriteHistory: records.filter((r) => r.writeHistory.chatCount > 0).length,
      withReadHistory: records.filter((r) => r.readHistory.chatCount > 0).length,
      withShellHistory: records.filter((r) => r.shellHistory.chatCount > 0).length,
      writtenRecently: records.filter(
        (r) => r.writeHistory.calls > 0 && r.writeHistory.lastAtMs > effectiveNow - liveWindowMs
      ).length,
      goneWorktreesWithWrites: writeAudit?.available ? writeAudit.goneWorktrees.length : 0,
      totalWriteCalls: writeAudit?.available ? writeAudit.totalWriteCalls : 0,
      totalReadCalls: writeAudit?.available ? writeAudit.totalReadCalls : 0,
      // The size of the gap `writeHistory` cannot close: shell calls that ran
      // with a workdir inside a worktree, any of which may have written a file.
      totalShellCalls: writeAudit?.available ? writeAudit.totalShellCalls : 0,
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
