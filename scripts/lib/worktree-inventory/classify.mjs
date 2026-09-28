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
  /** Work here is not on main. Do not remove until it is landed or stashed. */
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
 * Classify one worktree.
 *
 * `curated` is the hand-written record from `curated.mjs` and is optional: a
 * worktree nobody has written about is still inventoried, just with no
 * editorial summary.
 */
export function classify(wt, { chatSummary, chatSessions, curated, nowMs }) {
  const reasons = [];
  const uncommitted = isWorkingTreeHeld(wt);
  const unmerged = hasUnmergedCommits(wt);
  const live = hasLiveSession(chatSummary, nowMs);

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
    reasons.push('a session messaged inside the last 30 minutes');
  } else if (status === STATUS.UNCOMMITTED_ONLY) {
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push('work here is not reachable from any commit on this branch');
  } else if (status === STATUS.UNMERGED_WORK) {
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push('commits here are not on main');
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

  return {
    status,
    recommendation,
    prunable,
    reasons,
    live,
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
    case RECOMMENDATION.KEEP:
      return 40;
    case RECOMMENDATION.PRUNE:
      return 10;
    default:
      return 50;
  }
}
