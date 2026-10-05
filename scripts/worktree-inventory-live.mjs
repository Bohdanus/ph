#!/usr/bin/env node
/**
 * A REPORT about the worktrees on THIS machine, and deliberately not a gate.
 *
 * WHY THIS IS A SEPARATE COMMAND AND NOT A TEST
 * ---------------------------------------------
 * Three of the checks this performs used to live in
 * `scripts/__tests__/worktree-inventory.test.mjs`, which is what the pre-push
 * hook runs. They read git in every worktree of the repository, so their answer
 * was a function of how many worktrees existed, how loaded the machine was, and
 * whether the main checkout happened to hold one modified file at that instant.
 * Three consequences, all of them observed here rather than predicted:
 *
 *   1. The push gate went red for a dirty main checkout. That is what a `--no-verify`
 *      push of 285 commits was spent on.
 *   2. On a `pull_request` CI checkout no `main` ref exists at all, so the
 *      unguarded `rev-parse` threw and took three tests with it — the whole
 *      `pull_request` trigger could never go green.
 *   3. On that same CI checkout the checks were VACUOUS: one worktree, no risk
 *      shapes, every assertion satisfied by an empty set. The guard that exists to
 *      protect uncommitted work was asserting nothing, on the machine where a
 *      green tick is a claim about a merge.
 *
 * None of those three is a statement about the code. A gate answers "is this code
 * correct"; a question about which worktrees exist right now is a report, and
 * conflating the two is how a gate comes to be trusted for a claim it never made.
 * So the same checks live here, the test suite asserts the same RULES over a
 * synthetic fleet (`makeFleet()` in the test file), and this command exists for
 * the operator who wants the answer about their own machine.
 *
 * WHAT IT CHECKS, and what each answer is worth
 * ---------------------------------------------
 *   1. Worktrees that hold uncommitted work on no ref — the shape that is 0 ahead
 *      of the base, already on it, and holds the only copy of the work. Any of
 *      these is a loss waiting for `git worktree remove --force`.
 *   2. Any of those carrying a `mustNotPrune` curated flag, which is a claim that
 *      goes stale the moment the owner commits and that the generator now derives
 *      for itself.
 *   3. Every curated `landed: true` claim that git contradicts.
 *   4. Whether the committed `chat-audit.data.json` names sessions that are real,
 *      top-level, and inside its own declared window — cross-checked against the
 *      session store on this machine.
 *
 * EXIT CODE, and what a zero does NOT mean. Zero means NO RULE WAS VIOLATED. It
 * does not mean the machine is clean: on a normal day this repository has twenty-odd
 * worktrees holding uncommitted work on no ref, and every one of them being
 * reported rather than offered for disposal is the tool working correctly. The exit
 * line says which of those two statements it is making.
 *
 * Non-zero when: a worktree holding the only copy of some work would be reported as
 * disposable; a worktree holds work on no ref and could not be classified at all;
 * git could not be asked in some worktree; a curated claim contradicts git; the
 * session audit could not run, or found a recorded session that is not a real
 * top-level session in its window. The last two are there because "the check did
 * not run" is not "the check found nothing", and a report that printed `OK` over a
 * skipped check would be lying in the way this file exists to stop.
 *
 * A base ref that cannot be resolved — or a checkout too SHALLOW for ancestry to
 * mean anything — is reported and is also non-zero.
 *
 * USAGE
 *   npm run inventory:verify            human-readable report
 *   npm run inventory:verify -- --json  the same findings as JSON
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { classify, ACTION, RECOMMENDATION } from './lib/worktree-inventory/classify.mjs';
import { buildInventory } from './lib/worktree-inventory/assemble.mjs';
import { CURATED } from './lib/worktree-inventory/curated.mjs';
import {
  findMissingWorktrees,
  listWorktrees,
  mergeConflict,
  resolveBaseRef,
  __testables,
} from './lib/worktree-inventory/git.mjs';

const NO_CHATS = { count: 0, lastActivity: null };
const NO_SESSIONS = [];
/**
 * NOT pinned, and that is a correction. This began as the test suite's fixed
 * `NOW` — 2026-09-22, thirteen days before this was written — which is right for
 * a fixture and wrong for a report whose entire subject is the machine as it is
 * now. `buildInventory` takes `max(nowMs, newestKnown)`, so a clock in the past
 * makes every `nowMs - lastActivity` negative, and a negative age is what
 * `hasLiveSession` and `hasRecentIo` read as LIVE. The first person to wire a real
 * session store into this script would have found every worktree reported
 * `in-use` and an empty at-risk set, from a report that had been right the
 * moment before. `auditAgainstSessionStore` below uses real time already, which is
 * the inconsistency this removes.
 *
 * `--now` is not offered here: this is a report, not a fixture, and a reproducible
 * answer to "is my machine safe" is not the question.
 */
const NOW = Date.now();

/** The shape: zero ahead, already on the base, and holding work in no commit. */
const holdsWorkGitCannotSee = (r) => r.ahead === 0 && r.mergedIntoMain === true && r.dirty + r.untracked > 0;

function gitFacts(root, base) {
  const missing = new Set(findMissingWorktrees(root).map((w) => w.path));
  const mainPath = listWorktrees(root)[0].path;
  const worktrees = listWorktrees(root)
    .filter((w) => !missing.has(w.path))
    .map((w) => {
      const { ahead, behind } = __testables.aheadBehind(w.path, base);
      return {
        ...w,
        isPrimary: w.path === mainPath,
        tip: __testables.tipCommit(w.path),
        ahead,
        behind,
        mergedIntoBase: __testables.isMergedInto(w.path, base),
        // `base` IS PASSED, and leaving it off was a divergence from the generator:
        // `workingTreeState(cwd)` with no base cannot ask whether the branch is
        // behind, so it counts every modified path again as "behind", roughly
        // fourfold. Nothing here reads that field today, so no number printed was
        // wrong — and that is exactly how a reader ends up trusting a figure this
        // file computes differently from the one that writes `WORKTREES.json`.
        workingTree: __testables.workingTreeState(w.path, base),
        // And the merge answer, for the same reason: the generator reads it, and a
        // report that cannot tell a clean merge from a conflict cannot say whether
        // an unmerged branch is landable.
        merge: typeof ahead === 'number' && ahead > 0 ? mergeConflict(w.path, base) : { conflict: false, files: [] },
        commitsAhead: [],
      };
    });
  return { mainPath, worktrees, base };
}

function inventoryOf({ mainPath, worktrees, base }) {
  return buildInventory({
    worktrees,
    root: mainPath,
    base,
    mainHead: execFileSync('git', ['rev-parse', base], { cwd: mainPath, encoding: 'utf8' }).trim(),
    board: { available: false, dbPath: null, claims: new Map(), fileLocks: new Map(), agents: new Map(), issues: [] },
    chatAudit: { available: false, dbPath: null, byDirectory: new Map(), total: 0, newestSessionAt: 0 },
    nowMs: NOW,
  });
}

/** Curated `landed: true` claims this fleet of worktrees contradicts. */
function landedContradictions(worktrees, base) {
  const out = [];
  for (const [name, entry] of Object.entries(CURATED)) {
    if (entry.landed !== true) continue;
    const w = worktrees.find((x) => x.name === name);
    if (!w) continue; // gone; that is not a contradiction
    if (!__testables.isMergedInto(w.path, base)) {
      out.push(`${name}: curated says landed, git says the branch is not on ${base}`);
    }
    if (w.detached) out.push(`${name}: curated says landed, but the worktree is detached`);
  }
  return out;
}

/**
 * Whether every session id in the committed audit is a real top-level session.
 *
 * `null` when this machine has no session store, which is a fact about the
 * machine and is reported as such rather than as a pass.
 */
function auditAgainstSessionStore(dataPath) {
  const dbPath = join(homedir(), '.local/share/kilo/kilo.db');
  if (!existsSync(dbPath)) return { checked: false, reason: `no session store at ${dbPath}`, problems: [] };

  const audit = JSON.parse(readFileSync(dataPath, 'utf8'));
  const startMs = Date.parse(audit.windowStart);
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    return { checked: false, reason: `could not open ${dbPath}: ${err.message}`, problems: [] };
  }
  try {
    const rows = db
      .prepare(
        `SELECT id, parent_id, time_updated FROM session WHERE id IN (${audit.records.map(() => '?').join(',')})`
      )
      .all(...audit.records.map((r) => r.id));
    const problems = [];
    if (rows.length !== audit.records.length) {
      problems.push(`${audit.records.length - rows.length} recorded session(s) are not in ${dbPath} any more`);
    }
    for (const row of rows) {
      if (row.parent_id !== null) problems.push(`${row.id} is a subagent, not a top-level session`);
      if (row.time_updated < startMs) problems.push(`${row.id} was last updated before the audit's window start`);
    }
    return { checked: true, problems };
  } finally {
    db.close();
  }
}

function report(root) {
  const findings = {
    atRisk: [],
    flagged: [],
    unread: [],
    unclassifiable: [],
    landedContradictions: [],
    audit: { checked: false, problems: [] },
  };
  const base = resolveBaseRef(root);
  if (base === null) {
    return {
      base: null,
      findings,
      ok: false,
      fatal:
        `no base ref could be resolved in ${root}. Tried main, origin/main, refs/remotes/origin/main. ` +
        'Every ahead/behind and merged-into-base answer would be null, so nothing below is evidence of safety.',
    };
  }

  const facts = gitFacts(root, base);
  const inventory = inventoryOf(facts);
  const factsFor = (name) => facts.worktrees.find((x) => x.name === name);
  const inRepo = inventory.worktrees.filter((r) => r.inRepo);

  findings.unread = inRepo
    .filter((r) => typeof r.ahead !== 'number' || typeof r.mergedIntoMain !== 'boolean')
    .map((r) => `${r.name} (ahead=${r.ahead} onBase=${r.mergedIntoMain})`);

  for (const r of inRepo) {
    if (!holdsWorkGitCannotSee(r)) continue;
    findings.atRisk.push(
      `${r.name}: ahead=${r.ahead} onBase=${r.mergedIntoMain} dirty=${r.dirty} untracked=${r.untracked}`
    );
    if (CURATED[r.name]?.mustNotPrune) findings.flagged.push(r.name);
    if (r.isPrimary) continue; // the checkout itself is `keep` and always will be
    const bare = classify(
      facts.worktrees.find((x) => x.name === r.name),
      { chatSummary: NO_CHATS, chatSessions: NO_SESSIONS, curated: null, nowMs: NOW }
    );
    if (factsFor(r.name).tip === null || factsFor(r.name).detached) {
      // NAMED, not counted. The test suite asserts this list is EMPTY over the
      // fleet it builds, so a worktree that cannot be classified is a state the
      // fleet cannot reach and this report must not hide: without a name it
      // contributes a number to the summary and nothing else, and "held work on no
      // ref: 3" with no sign that one of the three was never examined is how a
      // risk disappears quietly.
      findings.unclassifiable.push(
        `${r.name}: holds work on no ref and could NOT be classified - ` +
          (factsFor(r.name).tip === null ? 'git named no tip' : 'detached, so there is no branch')
      );
    }
    // UNREACHABLE TODAY, AND THAT IS THE POINT OF IT. For exactly this shape
    // `classify` takes the `UNCOMMITTED_ONLY` branch before any prune is
    // considered, and `prunable` additionally requires an empty working tree, so
    // no worktree holding work on no ref can reach here. It is left in as the
    // regression watch: if a change to `classify` ever let one through, this is the
    // line that says so, and the exit code follows it.
    if (bare.prunable || bare.recommendation === RECOMMENDATION.PRUNE || bare.action === ACTION.DISPOSE) {
      findings.atRisk.push(
        `${r.name}: REPORTED AS DISPOSABLE despite holding the only copy — status=${bare.status} ` +
          `recommendation=${bare.recommendation} action=${bare.action}`
      );
    }
  }

  findings.landedContradictions = landedContradictions(facts.worktrees, base);
  findings.audit = auditAgainstSessionStore(
    resolve(import.meta.dirname, 'lib/worktree-inventory/chat-audit.data.json')
  );

  // WHAT `ok` IS ALLOWED TO MEAN: the absence of a FINDING. A check that did not
  // run is not the absence of a finding, so both of these make it false and the
  // exit line says which one it was rather than printing a bare `OK` over a
  // report that examined nothing - an unclassifiable worktree holding work on no
  // ref, and a session audit that could not run.
  const ok =
    findings.unread.length === 0 &&
    findings.unclassifiable.length === 0 &&
    findings.flagged.length === 0 &&
    findings.landedContradictions.length === 0 &&
    findings.audit.checked &&
    findings.audit.problems.length === 0 &&
    !findings.atRisk.some((line) => line.includes('REPORTED AS DISPOSABLE'));
  return { base, findings, ok, fatal: null, worktreeCount: inRepo.length, derivedNonEmpty: atRiskCount(inRepo) };
}

/** How many worktrees in the record hold work on no ref. */
const atRiskCount = (inRepo) => inRepo.filter(holdsWorkGitCannotSee).length;

function render({ base, findings, ok, fatal, worktreeCount, derivedNonEmpty }) {
  const out = [];
  out.push('worktree-inventory live report — a REPORT about this machine, not a gate.');
  out.push('The gates in `npm run test` assert the same rules over a synthetic fleet, so they are not here.');
  out.push('');
  if (fatal !== null) {
    out.push(`UNREADABLE: ${fatal}`);
    return out.join('\n');
  }
  out.push(`base ref:      ${base}`);
  out.push(`worktrees:     ${worktreeCount}`);
  out.push(`holds work on no ref: ${derivedNonEmpty}`);
  out.push(`could not be classified: ${findings.unclassifiable.length}`);
  out.push(`unreadable facts:     ${findings.unread.length}`);
  out.push(`flagged mustNotPrune: ${findings.flagged.length}`);
  out.push(`landed contradictions: ${findings.landedContradictions.length}`);
  out.push('');
  if (findings.unclassifiable.length)
    out.push('NOT CLASSIFIED (held work, never examined):', ...findings.unclassifiable.map((l) => `  ${l}`), '');
  if (findings.unread.length)
    out.push('UNREADABLE (git could not be asked):', ...findings.unread.map((l) => `  ${l}`), '');
  if (findings.atRisk.length) out.push('HOLDS WORK ON NO REF:', ...findings.atRisk.map((l) => `  ${l}`), '');
  if (findings.flagged.length)
    out.push(
      'FLAGGED mustNotPrune (the generator derives this; delete the flag):',
      ...findings.flagged.map((l) => `  ${l}`),
      ''
    );
  if (findings.landedContradictions.length)
    out.push('CURATED CONTRADICTS GIT:', ...findings.landedContradictions.map((l) => `  ${l}`), '');
  if (findings.audit.checked) {
    out.push(
      findings.audit.problems.length
        ? 'SESSION AUDIT MISMATCH:'
        : 'session audit: every recorded id is a real top-level session in its window',
      ...findings.audit.problems.map((l) => `  ${l}`),
      ''
    );
  } else {
    out.push(`session audit: not checked — ${findings.audit.reason}`, '');
  }
  out.push(
    ok
      ? `OK - no rule violated. ${derivedNonEmpty} worktree(s) hold work on no ref and every one is protected; ` +
          'that is the tool working, not a clean bill of health for the machine.'
      : findings.audit.checked
        ? 'FINDINGS - see above.'
        : 'INCOMPLETE - no finding, but the session audit could not run, so this is not a clean report.'
  );
  return out.join('\n');
}

function main() {
  const asJson = process.argv.includes('--json');
  const root = resolve(process.cwd());
  const result = report(root);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(result)}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
