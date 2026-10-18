/**
 * Turning facts into a decision. This module is pure: it takes the mechanical
 * git state and the curated human description and returns the status, the
 * recommendation, and the reasons a reader can check.
 *
 * THE RULE THAT IS WORTH THE MOST
 * --------------------------------
 * A worktree is `prunable` only when three independent things hold at once:
 * its branch is already on `main` (or every safe-to-compare patch is absorbed), its working tree is clean, AND it has no
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
  /**
   * Stale on purpose: nobody will work on this again, but the branch ref is
   * worth the one ref it costs. See {@link ACTION.LEGACY}.
   */
  LEGACY: 'legacy',
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
  /**
   * Keep the BRANCH, drop the WORKTREE. A curated `legacy: true`.
   *
   * WHY THIS IS NOT `at-risk`. `at-risk` means a human must act before anything
   * can be lost, and it reads that way in every list an operator opens. A legacy
   * branch is the opposite of a pending problem: nobody is going to act on it,
   * the merge may never be wanted, and the only thing at stake is a ref that
   * costs one entry in `.git/refs`. Filing it as `at-risk` put a permanent entry
   * on the at-risk list, which is the list a sweep reads first, so a branch that
   * was never going to be worked on kept being re-investigated every pass.
   *
   * WHAT IT BUYS. The worktree directory is the expensive thing — a checkout, a
   * `node_modules`, a `dist/` — and git holds a branch without any worktree at
   * all. So `legacy` separates the two: `npm run dispose` removes the directory
   * and skips `git branch -d`, and the branch stays recoverable for the small
   * chance it is ever needed. Keeping the whole worktree instead would cost a
   * filesystem entry per legacy branch forever and buy nothing git does not
   * already do with the ref.
   *
   * IT IS A CURATED CLAIM, LIKE `mustNotPrune`, AND IT IS NOT FREE OF GIT. It
   * says "do not merge this and do not forget it", never "this is safe to
   * delete" — the worktree half is disposable precisely because `legacy` is the
   * reason the directory is safe to remove.
   */
  LEGACY: 'legacy',
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

/**
 * How recently a tool call must have touched a worktree's own directory for that
 * to count as someone being in there.
 *
 * Deliberately WIDER than {@link LIVE_WINDOW_MS}, and it is a separate signal
 * rather than a wider version of the same one. `LIVE_WINDOW_MS` answers "is a
 * chat active", which is a question about `session.time_updated`; it cannot see
 * a main-checkout agent at all, because that agent's `directory` is the main
 * checkout no matter how many commands it runs inside a task worktree. Direct
 * I/O inside the directory is the one piece of evidence that survives that, and
 * it answers a different question: not "is a chat typing" but "did anything
 * demonstrably happen here".
 *
 * The width is the operator's own staleness threshold, and it is a parameter
 * rather than a constant of consequence: a worktree whose last recorded command
 * ran inside this window is not a deletion candidate at any window, because the
 * cost of being wrong is a live agent's work and the cost of being right is one
 * worktree kept a few hours longer.
 */
export const RECENT_IO_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Did a shell command demonstrably run inside this worktree recently?
 *
 * Read history is intentionally excluded: reading a worktree is tracked in its
 * own releasable structure, not treated as proof that somebody still owns it.
 * Otherwise an audit that inspected a stale worktree would block its disposal
 * for the whole four-hour shell window.
 *
 * `derivedChatIds` and not `activeNow` for the same reason `writeLive` reads the
 * former: `activeNow` is the value AFTER the suppression flag has been applied,
 * so consulting it would let an override erase its own evidence.
 */
export function hasRecentIo(histories, nowMs, ioWindowMs = RECENT_IO_WINDOW_MS) {
  return histories.some((h) => typeof h?.lastAtMs === 'number' && nowMs - h.lastAtMs < ioWindowMs);
}

function isWorkingTreeHeld(wt) {
  return wt.workingTree.modified + wt.workingTree.untracked > 0;
}

function hasNetNoopMerge(wt) {
  return wt.merge?.conflict === false && wt.mergeResultMatchesBase === true;
}

function hasUnmergedCommits(wt) {
  return typeof wt.ahead === 'number' && wt.ahead > 0 && wt.patchEquivalence !== 'absorbed' && !hasNetNoopMerge(wt);
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
  {
    chatSummary,
    chatSessions,
    curated,
    nowMs,
    boardAgents = [],
    writeHistory = null,
    shellHistory = null,
    readHistory = null,
    liveWritersSuppressed = null,
    base = 'main',
  }
) {
  const reasons = [];
  const uncommitted = isWorkingTreeHeld(wt);
  const unmerged = hasUnmergedCommits(wt);
  const treeUnreadable = Boolean(wt.workingTree.statusError);
  const branchUnreadable = typeof wt.branch !== 'string' || wt.branch.length === 0;
  const gitFactsUnreadable = branchUnreadable || wt.ahead === null || wt.behind === null || wt.mergedIntoBase === null;
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
  // `derivedChatIds`, not `activeNow`: the latter is the signal AFTER a declared
  // hard state has been applied to it, so reading it here would make the
  // override erase its own evidence and `derivedLive` would quietly agree with
  // `live` about a signal nobody ever checked.
  const writeLive = Boolean(writeHistory?.derivedChatIds?.length);
  // Shell I/O inside this directory, on the wider window. Without it the three
  // signals above are all keyed on a chat's own liveness or on the board, and a
  // main-checkout agent that ran `git -C … worktrees/<name> …` minutes ago is in
  // neither: its `directory` is the main checkout, and the board is keyed on the
  // branch. That gap is not theoretical — it is why a worktree with agents
  // editing it an hour ago could carry `action: "dispose"` with `prunable: true`
  // and every one of its git facts correct.
  const ioLive = hasRecentIo([shellHistory], nowMs);
  const derivedLive = chatLive || writeLive || ioLive || Boolean(liveAgent);

  // A declared hard state outranks every heuristic above. Both of them are
  // RECENCY inferences over rows that outlive the process that wrote them, so
  // they keep answering "active" for half an hour after the editor that was
  // running them is gone — which is exactly the moment a reader most needs the
  // file to be true. The override is recorded rather than applied silently: the
  // reasons say it happened, and the evidence it overrode is still on the record
  // in `writeHistory.derivedChatIds`, so the file can be audited rather
  // than believed.
  const live = liveWritersSuppressed ? false : derivedLive;
  if (liveWritersSuppressed) {
    reasons.push(
      `liveness overridden: ${liveWritersSuppressed}` +
        (derivedLive
          ? ` (${chatLive ? 'a session' : writeLive ? 'a write' : ioLive ? 'recent command I/O' : 'a board agent'} looked live at ${new Date(nowMs).toISOString()})`
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
  } else if (treeUnreadable || gitFactsUnreadable) {
    status = STATUS.UNREADABLE;
    reasons.push(
      treeUnreadable
        ? `git could not read the working tree (${wt.workingTree.statusError})`
        : branchUnreadable
          ? 'git could not establish the worktree branch identity'
          : 'git could not establish the branch relationship to the base'
    );
  } else if (uncommitted && wt.ahead === 0) {
    status = STATUS.UNCOMMITTED_ONLY;
    reasons.push('the branch reports 0 commits ahead of main and is an ancestor of it');
    reasons.push('this is the shape that looks disposable and is not: 0 ahead is not a safety test');
    reasons.push(
      wt.mergedIntoBase
        ? 'git cannot distinguish this from a branch that landed and was then edited'
        : 'the branch is not on main either'
    );
  } else if (wt.isPrimary) {
    status = STATUS.LANDED;
    reasons.push('this is the main worktree');
  } else if (uncommitted || unmerged) {
    status = STATUS.UNMERGED_WORK;
    if (unmerged) reasons.push(`${wt.ahead} commit(s) ahead of main`);
    if (uncommitted) reasons.push('the working tree holds uncommitted changes');
  } else if (hasNetNoopMerge(wt)) {
    status = STATUS.LANDED;
    reasons.push('a conflict-free merge produces exactly the current base tree, so there is no net change to land');
  } else if (wt.patchEquivalence === 'absorbed') {
    status = STATUS.LANDED;
    reasons.push(wt.patchEquivalenceReason ?? 'every branch commit has an equivalent patch on the base');
  } else {
    status = STATUS.LANDED;
    reasons.push('the branch is an ancestor of main and the working tree is clean');
  }

  // Recommendation. A curated finding blocks pruning even when git says the
  // branch is landed, because a curated finding is a human claim about work
  // that may only exist in this directory.
  const curatedBlocksPrune = Boolean(curated?.mustNotPrune);
  const curatedLegacy = Boolean(curated?.legacy);
  const legacyUnknown = curatedLegacy
    ? treeUnreadable
      ? 'the working tree could not be read'
      : wt.detached
        ? 'the worktree has no branch to keep'
        : branchUnreadable
          ? 'the worktree branch identity could not be established'
          : gitFactsUnreadable
            ? 'the branch relationship to the base could not be established'
            : null
    : null;
  const mergeState = mergeVerdict(wt);
  let recommendation;
  if ((wt.isPrimary || wt.branch === base) && uncommitted && !live) {
    recommendation = RECOMMENDATION.SALVAGE;
    reasons.push('the base worktree holds uncommitted changes that are in no commit on this branch');
  } else if (wt.isPrimary || wt.branch === base) {
    // The main checkout is never a prune candidate, whatever git says about
    // it. It is the landing site, it is where the operator works, and every
    // other session in the repository resolves paths through it.
    // `live`, not `wt.live`: the flag is a local computed above and is never
    // written back onto the input record, so `wt.live` was always undefined
    // and the main worktree could never report `in-use`.
    recommendation = live ? RECOMMENDATION.IN_USE : RECOMMENDATION.KEEP;
    reasons.push('the base worktree is never a deletion candidate');
  } else if (live) {
    recommendation = RECOMMENDATION.IN_USE;
    reasons.push(
      writeLive
        ? 'a chat wrote a file in this worktree inside the last 30 minutes'
        : chatLive
          ? 'a session messaged inside the last 30 minutes'
          : ioLive
            ? `a command ran inside this worktree at ${new Date(shellHistory?.lastAtMs ?? 0).toISOString()}`
            : `the board saw agent ${liveAgent.agentId} in this worktree inside the last 30 minutes`
    );
  } else if (wt.locked || wt.prunableReason) {
    recommendation = RECOMMENDATION.UNKNOWN;
    reasons.push(
      wt.locked
        ? 'git marks this worktree locked'
        : `git marks this worktree administratively prunable (${wt.prunableReason})`
    );
  } else if (
    curatedLegacy &&
    !curatedBlocksPrune &&
    legacyUnknown === null &&
    !uncommitted &&
    !treeUnreadable &&
    !wt.detached &&
    wt.tip !== null
  ) {
    // CHECKED HERE, NOT AT THE BOTTOM, AND ONLY FOR A CLEAN TREE.
    //
    // `uncommitted` is the load-bearing condition. `legacy` authorises removing
    // the WORKTREE, so it is a licence to delete a directory — and a directory
    // holding uncommitted changes is the only copy of them. A claim that the
    // branch is worth keeping says nothing about files the branch has never
    // seen, so allowing it here would let a prose field authorise the loss the
    // whole program exists to prevent. A dirty legacy worktree therefore stays
    // `at-risk`, which is where a human has to look.
    //
    // `detached` and an unreadable tip are excluded for the same reason
    // `mustNotPrune` cannot rescue them: there is no branch to keep, so
    // "keep the branch" has nothing to act on and would read as a clearance.
    //
    // It sits ABOVE the merge verdicts deliberately. A stale branch that no
    // longer merges is the common case, not an exception — that is what "legacy"
    // means — and leaving it `at-risk` is what put these on the list a sweep
    // reads first, forever, for a branch nobody intends to reconcile.
    recommendation = RECOMMENDATION.LEGACY;
    reasons.push('a curated finding marks this branch legacy: keep the ref, drop the worktree');
    if (wt.ahead > 0)
      reasons.push(`${wt.ahead} commit(s) ahead of main are kept on the branch and not proposed for merge`);
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
    wt.ahead !== null &&
    wt.mergedIntoBase !== null &&
    (wt.mergedIntoBase === true || wt.patchEquivalence === 'absorbed' || hasNetNoopMerge(wt)) &&
    wt.workingTree.modified === 0 &&
    wt.workingTree.untracked === 0 &&
    !wt.locked &&
    !wt.prunableReason &&
    !treeUnreadable;

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
    case RECOMMENDATION.LEGACY:
      // NOT read from `prunable`, unlike `dispose`. The worktree IS a disposal
      // candidate — the tree is clean by the branch that got here — but the
      // branch is not, and `prunable` means both at once. `npm run dispose` reads
      // `action` and the skip is in the disposal program, so this is the one
      // place the two halves can disagree.
      action = ACTION.LEGACY;
      break;
    default:
      action = ACTION.UNDECIDED;
  }

  return {
    status,
    recommendation,
    action,
    mergeConflict: wt.merge?.conflict ?? null,
    mergeResultMatchesBase: wt.merge?.conflict === false ? (wt.mergeResultMatchesBase ?? null) : null,
    // Disambiguates the two things `mergeConflict: null` means: the check was
    // skipped (already on main, or detached), or attempted and unanswerable.
    mergeChecked: mergeState !== 'unknown',
    mergeConflictFiles: wt.merge?.files ?? [],
    prunable,
    patchEquivalence: wt.patchEquivalence ?? 'unknown',
    patchEquivalenceReason: wt.patchEquivalenceReason ?? null,
    reasons,
    live,
    // What the signals said before any declared hard state overrode them. Kept
    // so an override is auditable: `live: false` beside `derivedLive: true` is
    // a record that something was suppressed and what it suppressed.
    derivedLive,
    // Which signal fired, so a reader can tell "a chat is typing here" from
    // "a command ran here 40 minutes ago". Collapsed into `derivedLive` these
    // are indistinguishable, and they are not the same claim: the first is
    // current occupancy, the second is evidence of it that survives the
    // main-checkout-agent blind spot in `chatSummary`.
    liveSignals: {
      chat: chatLive,
      write: writeLive,
      io: ioLive,
      board: Boolean(liveAgent),
    },
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
    case RECOMMENDATION.LEGACY:
      // Below `PRUNE`, which is the surprising half and deliberate: a legacy
      // branch is the LEAST work in the repository. Nothing is at risk, nobody is
      // waiting on it, and the only remaining task is a ref somebody may never
      // touch. It sorts under everything so it is the last thing a reader
      // reaches, and last is where a thing with a 1% chance of mattering belongs
      // — `PRUNE`'s 10 leaves room beneath it.
      return 5;
    case RECOMMENDATION.PRUNE:
      return 10;
    default:
      return 50;
  }
}
