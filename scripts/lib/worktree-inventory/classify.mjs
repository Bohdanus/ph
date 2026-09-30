/**
 * Turning facts into a decision. This module is pure: it takes the mechanical
 * git state and the curated human description and returns the status, the
 * recommendation, and the reasons a reader can check.
 *
 * THE RULE THAT IS WORTH THE MOST
 * --------------------------------
 * A worktree is `prunable` only when three independent things hold at once:
 * its branch is already on `main`, its working tree is clean, AND it has no
 * curated finding attached. The third condition exists because the first two
 * are both true of a branch created from main and never committed to — and such
 * a branch can be holding the only copy of hours of work. Ahead/behind is
 * never on its own sufficient, in either direction.
 *
 * `salvage` is the inverse and is the status an operator should act on first:
 * work that exists in a working tree, or in a branch that is not on main, and
 * that no other worktree holds.
 */

export const STATUS = {
  /** The branch is on main and the tree is clean. Nothing to decide. */
  LANDED: 'landed',
  /** Unmerged commits, no uncommitted work. Ready for a rebase and a merge. */
  READY_TO_LAND: 'ready-to-land',
  /**
   * The branch is an ancestor of main AND the working tree holds changes.
   *
   * There is deliberately only ONE status for this shape rather than a
   * "landed-with-residue" and an "uncommitted-only". Git cannot tell the two
   * apart: both report 0 ahead, both report an ancestor of main, and both hold
   * a dirty tree. The one that landed 3 commits and then got edited and the one
   * that was created from main and never committed to are byte-identical to
   * `git rev-list` — which is exactly why "0 ahead" is not a safety test, and
   * why a second status name would imply a distinction git cannot support.
   * `mergedIntoMain` is reported raw on every record, and `mustNotPrune` in
   * `curated.mjs` carries the human claim.
   */
  UNCOMMITTED_ONLY: 'uncommitted-only',
  /** Commits on main are missing here, with or without uncommitted work. */
  UNMERGED_WORK: 'unmerged-work',
  /** The branch is detached or its head cannot be read. */
  UNREADABLE: 'unreadable',
};

export const RECOMMENDATION = {
  /** Safe to remove now, with or without --force. */
  PRUNE: 'prune',
  /**
   * Clean tree, commits ahead of main, and the merge applies with no
   * conflict. Nothing is at risk and nothing needs rescuing — it is only
   * waiting for a merge.
   */
  READY_TO_LAND: 'ready-to-land',
  /**
   * Work here is not on main AND is not merely waiting: it is uncommitted, or
   * the merge conflicts, so a human must act before anything can be lost.
   */
  SALVAGE: 'salvage',
  /** Landed but still holds something. Remove after taking the remainder. */
  REVIEW_RESIDUE: 'review-residue',
  /** Somebody is working here right now. Leave it alone. */
  IN_USE: 'in-use',
  /** The main checkout. Never a deletion candidate. */
  KEEP: 'keep',
  /** Cannot be classified from what is known. Do not remove. */
  UNKNOWN: 'unknown',
};

/**
 * The single decision an operator opens this file to make, per worktree.
 *
 * `land` and `at-risk` are the two that used to be one bucket called
 * `salvage`, and merging them was the defect: "a clean branch one commit
 * ahead that merges cleanly" and "a branch whose only work sits in a working
 * tree on no ref at all" both reported `salvage`, so a reader could not tell
 * which to go and MERGE from which to go and SAVE. They call for opposite
 * actions, so they are different values and different list entries.
 */
export const ACTION = {
  /** Clean, unmerged, conflict-free: merge it. */
  LAND: 'land',
  /** Nothing here is on any ref, or the merge needs a human: do not remove. */
  AT_RISK: 'at-risk',
  /** Landed and clean: dispose of it. */
  DISPOSE: 'dispose',
  /** Somebody is working here right now. */
  IN_USE: 'in-use',
  /** The main checkout. */
  KEEP: 'keep',
  /** Cannot be decided from what is known. */
  UNDECIDED: 'undecided',
};

/**
 * A session messaged inside this window counts as live.
 *
 * Exported because `chats.mjs` needs the identical number to decide `active`,
 * and two hardcoded literals that happen to agree today desynchronise the
 * first time either is edited — after which `classify` marks a worktree
 * in-use that the audit calls abandoned, which is worse than either answer.
 */
export const LIVE_WINDOW_MS = 30 * 60 * 1000;

function isWorkingTreeHeld(wt) {
  return wt.workingTree.modified + wt.workingTree.untracked > 0;
}

function hasUnmergedCommits(wt) {
  return typeof wt.ahead === 'number' && wt.ahead > 0;
}

/**
 * Does a live session mean "somebody is in there right now"?
 *
 * Deliberately narrow, and deliberately the same threshold `chats.mjs` uses
 * for `active` — see `LIVE_WINDOW_MS`, which both import rather than each
 * hardcoding its own.
 */
export function hasLiveSession(chatSummary, nowMs, liveWindowMs = LIVE_WINDOW_MS) {
  return typeof chatSummary?.lastActivity === 'number' && nowMs - chatSummary.lastActivity < liveWindowMs;
}

/** Do unfinished chats for this worktree exist? Drives the `unfinished` flag. */
export function hasUnfinishedChats(sessions = []) {
  return sessions.filter((s) =>
    ['active', 'abandoned-midflight', 'died-at-birth', 'rejected-credits', 'orphaned', 'blocked'].includes(s.state)
  );
}

/**
 * Normalise the merge answer to exactly one of three values.
 *
 * A MISSING `wt.merge` — the property absent, not present-and-null — used to
 * fall through both the "conflicts" and the "could not be checked" branches
 * and reach "applies with no conflict", because `undefined === null` is false
 * and `undefined === true` is false. So a caller that never ran the check was
 * handed a licence to land. An absent check and a failed check are the same
 * thing for this decision: not verified, so not offered as ready.
 */
function mergeVerdict(wt) {
  const conflict = wt.merge?.conflict;
  if (conflict === true) return 'conflict';
  if (conflict === false) return 'clean';
  return 'unknown';
}

/**
 * Classify one worktree.
 *
 * `curated` is the hand-written record from `curated.mjs` and is optional: a
 * worktree nobody has written about is still inventoried, just with no
 * editorial summary.
 */
export function classify(
  wt,
  { chatSummary, chatSessions, curated, nowMs, boardAgents = [], writeHistory = null, liveWritersSuppressed = null }
) {
  const reasons = [];
  const uncommitted = isWorkingTreeHeld(wt);
  const unmerged = hasUnmergedCommits(wt);
  const liveAgent = boardAgents.find((a) => a.live);
  // EITHER source makes a worktree in-use. The session database is blind to a
  // session that was opened in the main checkout and then driven into a task
  // worktree — its `directory` never changes — so the board's own agent record
  // is the only signal that covers that case.
  const chatLive = hasLiveSession(chatSummary, nowMs);
  // A WRITE is a stronger claim on a worktree than a message. A chat that
  // edited files here twenty minutes ago and has been quiet since still owns
  // the directory; one that merely said something here does not. This is the
  // signal the session-directory audit structurally cannot produce, because the
  // chat that wrote may never have had this worktree as its `directory` at all.
  //
  // `derivedWriterChatIds`, not `writingNow`: the latter is the signal AFTER a
  // declared hard state has been applied to it, so reading it here would make
  // the override erase its own evidence and `derivedLive` would quietly agree
  // with `live` about a signal nobody ever checked.
  const writeLive = Boolean(writeHistory?.derivedWriterChatIds?.length);
  const derivedLive = chatLive || writeLive || Boolean(liveAgent);

  // A declared hard state outranks every heuristic above. Both of them are
  // RECENCY inferences over rows that outlive the process that wrote them, so
  // they keep answering "active" for half an hour after the editor that was
  // running them is gone — which is exactly the moment a reader most needs the
  // file to be true. The override is recorded rather than applied silently: the
  // reasons say it happened, and the evidence it overrode is still on the record
  // in `writeHistory.derivedWriterChatIds`, so the file can be audited rather
  // than believed.
  const live = liveWritersSuppressed ? false : derivedLive;
  if (liveWritersSuppressed) {
    reasons.push(
      `liveness overridden: ${liveWritersSuppressed}` +
        (derivedLive
          ? ` (${chatLive ? 'a session' : 'a board agent'} looked live at ${new Date(nowMs).toISOString()})`
          : '')
    );
  }

  let status;
  if (wt.detached) {
    // A detached HEAD is named here because the inventory cannot record WHICH
    // branch such a worktree holds, so "prunable" would be a claim about a ref
    // the file never shows. Unmerged commits on a detached head are ordinary
    // and are classified normally.
    status = STATUS.UNREADABLE;
    reasons.push('HEAD is detached, so there is no branch identity to report or to compare');
  } else if (wt.tip === null) {
    status = STATUS.UNREADABLE;
    reasons.push('git could not read a tip commit for this worktree');
  } else if (wt.isPrimary) {
    status = STATUS.LANDED;
    reasons.push('this is the main worktree');
  } else if (uncommitted && wt.ahead === 0) {
    status = STATUS.UNCOMMITTED_ONLY;
    reasons.push('the branch reports 0 commits ahead of main and is an ancestor of it');
    reasons.push('this is the shape that looks disposable and is not: 0 ahead is not a safety test');
    reasons.push(
      wt.mergedIntoBase
        ? 'git cannot distinguish this from a branch that landed and was then edited'
        : 'the branch is not on main either'
    );
  } else if (uncommitted || unmerged) {
    status = STATUS.UNMERGED_WORK;
    if (unmerged) reasons.push(`${wt.ahead} commit(s) ahead of main`);
    if (uncommitted) reasons.push('the working tree holds uncommitted changes');
  } else {
    status = STATUS.LANDED;
    reasons.push('the branch is an ancestor of main and the working tree is clean');
  }

  // Recommendation. A curated finding blocks pruning even when git says the
  // branch is landed, because a curated finding is a human claim about work
  // that may only exist in this directory.
  const curatedBlocksPrune = Boolean(curated?.mustNotPrune);
  const mergeState = mergeVerdict(wt);
  let recommendation;
  if (wt.isPrimary) {
    // The main checkout is never a prune candidate, whatever git says about
    // it. It is the landing site, it is where the operator works, and every
    // other session in the repository resolves paths through it.
    // `live`, not `wt.live`: the flag is a local computed above and is never
    // written back onto the input record, so `wt.live` was always undefined
    // and the main worktree could never report `in-use`.
    recommendation = live ? RECOMMENDATION.IN_USE : RECOMMENDATION.KEEP;
    reasons.push('the main worktree is never a deletion candidate');
  } else if (live) {
    recommendation = RECOMMENDATION.IN_USE;
    reasons.push(
      writeLive
        ? 'a chat wrote a file in this worktree inside the last 30 minutes'
        : chatLive
          ? 'a session messaged inside the last 30 minutes'
          : `the board saw agent ${liveAgent.agentId} in this worktree inside the last 30 minutes`
    );
  } else if (status === STATUS.UNCOMMITTED_ONLY) {
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push('work here is not reachable from any commit on this branch');
  } else if (status === STATUS.UNMERGED_WORK && mergeState === 'conflict') {
    // A conflicting merge is NOT "waiting to be merged" — somebody has to
    // resolve it by hand. It stays at-risk so it is not filed under the
    // branches that need nothing but a fast-forward.
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push(
      wt.merge?.files?.length
        ? `merging into the base branch conflicts in ${wt.merge.files.join(', ')}, so it needs a rebase first`
        : 'merging into the base branch conflicts, so it needs a rebase first'
    );
  } else if (status === STATUS.UNMERGED_WORK && mergeState === 'unknown') {
    // The merge could not be attempted, or was never checked. That is not
    // evidence of a clean merge, so this is not offered as ready — an unknown
    // must never read as a licence to land.
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push(`the merge could not be verified (${wt.merge?.reason ?? 'not checked'})`);
  } else if (status === STATUS.UNMERGED_WORK && mergeState === 'clean' && !uncommitted) {
    // The distinction this whole split exists for: nothing is at risk, nothing
    // needs saving, and the merge applies cleanly today. It only needs merging.
    if (curatedBlocksPrune) {
      // A curated `mustNotPrune` is a human claim that something here is not
      // accounted for, and it has to veto a MERGE recommendation too, not only
      // a prune one. Otherwise `fix-spray-cr` — whose own note calls the
      // colour-replacement work "the salvage target" — is filed under "READY
      // TO LAND" beside a summary saying the opposite, and nothing marks the
      // contradiction.
      recommendation = RECOMMENDATION.SALVAGE;
      reasons.push(
        'the tree and the merge are both clean, but a curated finding protects this worktree, so read its note before merging'
      );
    } else {
      recommendation = RECOMMENDATION.READY_TO_LAND;
      reasons.push('the working tree is clean and the merge into the base branch applies with no conflict');
    }
  } else if (status === STATUS.UNMERGED_WORK) {
    // The last branch is "unmerged, tree holds changes": a clean merge says
    // nothing about the uncommitted work, which is not on any ref and is the
    // part that can actually be lost.
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push('the working tree holds changes that are in no commit on this branch');
  } else if (status === STATUS.LANDED && curatedBlocksPrune) {
    recommendation = RECOMMENDATION.REVIEW_RESIDUE;
    reasons.push('git says this is disposable, but a curated finding says otherwise');
  } else if (status === STATUS.LANDED) {
    recommendation = RECOMMENDATION.PRUNE;
  } else {
    recommendation = RECOMMENDATION.UNKNOWN;
  }

  const prunable =
    wt.isPrimary !== true &&
    recommendation === RECOMMENDATION.PRUNE &&
    wt.mergedIntoBase === true &&
    wt.workingTree.modified === 0 &&
    wt.workingTree.untracked === 0;

  // The one decision. Derived from the recommendation rather than restated, so
  // the two cannot disagree.
  let action;
  switch (recommendation) {
    case RECOMMENDATION.PRUNE:
      // Read from `prunable`, the single expression that already encodes
      // "not the main checkout, the branch is on main, the tree is clean, and
      // nothing protects it" — not restated here as a second condition a later
      // edit could quietly widen.
      action = prunable ? ACTION.DISPOSE : ACTION.UNDECIDED;
      break;
    case RECOMMENDATION.READY_TO_LAND:
      action = ACTION.LAND;
      break;
    case RECOMMENDATION.SALVAGE:
    case RECOMMENDATION.REVIEW_RESIDUE:
      action = ACTION.AT_RISK;
      break;
    case RECOMMENDATION.IN_USE:
      action = ACTION.IN_USE;
      break;
    case RECOMMENDATION.KEEP:
      action = ACTION.KEEP;
      break;
    default:
      action = ACTION.UNDECIDED;
  }

  return {
    status,
    recommendation,
    action,
    mergeConflict: wt.merge?.conflict ?? null,
    // Disambiguates the two things `mergeConflict: null` means: the check was
    // skipped (already on main, or detached), or attempted and unanswerable.
    mergeChecked: mergeState !== 'unknown',
    mergeConflictFiles: wt.merge?.files ?? [],
    prunable,
    reasons,
    live,
    // What the signals said before any declared hard state overrode them. Kept
    // so an override is auditable: `live: false` beside `derivedLive: true` is
    // a record that something was suppressed and what it suppressed.
    derivedLive,
    liveSuppressed: Boolean(liveWritersSuppressed),
    uncommitted,
    unmerged,
  };
}

/**
 * A single number an operator can sort by, worst first.
 *
 * Deliberately not a priority: it answers "how much trouble is this", which
 * is a different question from "how important is the work", and conflating the
 * two is how a preservation branch gets pruned.
 */
export function riskScore(verdict) {
  switch (verdict.recommendation) {
    case RECOMMENDATION.SALVAGE:
      return 90;
    case RECOMMENDATION.REVIEW_RESIDUE:
      return 80;
    case RECOMMENDATION.IN_USE:
      return 70;
    case RECOMMENDATION.UNKNOWN:
      return 60;
    // Ready-to-land sorts below the things that need rescuing: nothing is at
    // risk, it is only waiting, so it is not where a reader should start.
    case RECOMMENDATION.READY_TO_LAND:
      return 30;
    case RECOMMENDATION.KEEP:
      return 40;
    case RECOMMENDATION.PRUNE:
      return 10;
    default:
      return 50;
  }
}
