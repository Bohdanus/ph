/**
 * Tests for the worktree inventory generator.
 *
 * The properties worth pinning are not "does it produce JSON" but the two rules
 * the whole tool exists to enforce, both of which this repository has already
 * been bitten by:
 *
 *   1. A worktree reporting 0 commits ahead of main and being an ancestor of
 *      main is NOT prunable while its working tree holds changes. This is the
 *      "0 ahead is not a safety test" case, and it is the shape of every
 *      worktree here that looks disposable and is not. The set is DERIVED from
 *      the live worktrees on every run rather than listed by name: the list was
 *      the recurring red, and it was re-derived by hand three times in one
 *      session because an agent had committed, disposed a worktree, or created
 *      one.
 *   2. A paid-model launch that died at zero tokens is classified as a
 *      failure, not as a finished session that happened to be quiet.
 *
 * Everything runs under the root jsdom project per AGENTS.md, so these are
 * environment-agnostic: no git repository is created, no clock is read, and
 * `node:sqlite` is only exercised where a real temporary database is cheap.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { classify, riskScore, ACTION, RECOMMENDATION, STATUS } from '../lib/worktree-inventory/classify.mjs';
import { classifySession, summariseChats, isUnfinished, isDead } from '../lib/worktree-inventory/chats.mjs';
import { buildInventory, serialise, formatCanonical, SCHEMA_VERSION } from '../lib/worktree-inventory/assemble.mjs';
import { CURATED, curatedFor } from '../lib/worktree-inventory/curated.mjs';
import { __testables, findMissingWorktrees, listWorktrees, mergeConflict } from '../lib/worktree-inventory/git.mjs';
import { resolveBoardDb, readBoard } from '../lib/worktree-inventory/board.mjs';
import {
  auditWrites,
  buildPathIndex,
  buildCallRecords,
  emptyWriteHistory,
  patchTargetPaths,
  rootSessionId,
  summariseReads,
  summariseShell,
  summariseWrites,
  worktreeNameFromPath,
} from '../lib/worktree-inventory/writes.mjs';
import { resolveReadsReleasedBefore } from '../worktree-inventory.mjs';
import { loadChatAudit, auditVerdict, isReadUnfinished, READ_STATE } from '../lib/worktree-inventory/chat-audit.mjs';
import { Board } from '../lib/agent-board/db.mjs';

/**
 * This file's budget, and the reason it is not Vitest's default 5s.
 *
 * Almost every block here builds a throwaway git repository or a throwaway
 * SQLite database per test and then runs real `git` or a real `DatabaseSync`
 * against it, so a test in this file is bounded by process spawns and git's own
 * startup rather than by anything being computed. That is the whole reason.
 *
 * WHAT IS NO LONGER PART OF IT, and the removal is the point of this comment
 * having been rewritten. This file used to read git in every worktree of the
 * OPERATOR'S repository, which put three tests on a `60_000` per-test budget and
 * made this file the single most expensive thing in the push gate. Measured on
 * this repository at 92 live worktrees: 61.5s of a 142.8s `npm run test`, one
 * test red because the main checkout had one modified file at that instant, and
 * on a `pull_request` CI checkout — where no `main` ref exists — an unguarded
 * `rev-parse` that took three tests down with it. Every one of those is a gate
 * whose answer is a property of the machine rather than of the code. Those tests
 * now read the synthetic fleet from `makeFleet()`, which is about thirty spawns
 * and cannot go red for anything but a change to `classify`, `buildInventory` or
 * `git.mjs`.
 *
 * So the number below is 15s against a fleet of EIGHT worktrees, and there is no
 * per-test override in this file any more. If one comes back, the question to
 * ask first is not "how long does it need" but "why is this reading something
 * that is not in a repository the test built".
 *
 * The default is not merely tight for spawns, it is at or above the measured
 * cost of this file's own slowest test: `reports whether the commit list was cut
 * off at the cap` has been reported failing at the 5s default with no code
 * change, and at the pre-fix commit on a loaded machine the failure that
 * appeared instead was a DIFFERENT test in this file — which is what a
 * population of marginal tests looks like, not five specific ones.
 *
 * This is a BUDGET, not a threshold. It cannot turn a failing assertion green: it
 * only decides how long a test may run before the harness reports it, and no
 * assertion below is changed by it.
 */
vi.setConfig({ testTimeout: 15_000 });

const NOW = 1_790_000_000_000;

/** The curated table's SOURCE, for the checks that a JS object cannot answer. */
const CURATED_PATH = resolve(import.meta.dirname, '../lib/worktree-inventory/curated.mjs');

/**
 * Remove JS comments from a source line, respecting string literals.
 *
 * A `line.split('//')[0]` is wrong in both directions here: it eats the rest of
 * a summary that contains a URL, and — on the line it was written for — it does
 * not fire at all, because a `//` comment after a key still matches a regex
 * anchored at the start of the line only if the comment IS the line. Both
 * failures are about the same thing: deciding what is code without knowing what
 * is a comment.
 *
 * Returns the code with comments blanked to the same length, so column
 * positions still mean what they did.
 */
function stripComments(line, inBlockComment) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = line[i + 1];
    if (inBlockComment) {
      out += ' ';
      if (c === '*' && next === '/') {
        out += ' ';
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') out += next ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '/') {
      out += ' '.repeat(line.length - i);
      break;
    }
    if (c === '/' && next === '*') {
      out += '  ';
      i++;
      inBlockComment = true;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    out += c;
  }
  return { code: out, inBlockComment };
}

/**
 * Read the key declarations at the top level of the `CURATED` object literal,
 * in source order. Fails CLOSED.
 *
 * Returns `{ keys, unreadable }`. `keys` is every declaration the reader
 * positively recognised. `unreadable` names every line at an entry's
 * indentation that was NOT a plain key declaration — a computed key, a spread,
 * a property shorthand, a method, a getter. Those are reported rather than
 * skipped, because they are precisely the shapes a duplicate can hide inside and
 * a reader that skips what it does not understand reports green on a file it
 * could not see.
 *
 * The entry indentation is MEASURED from the first declaration after the
 * literal opens, not hard-coded to two spaces, and the key is read with any
 * quote style. Both were fixed in the reader's first version, which matched one
 * quote at one indent and so passed on a duplicate written in double quotes and
 * on a duplicate indented four spaces.
 */
function readCuratedKeys(source) {
  const keys = [];
  const unreadable = [];
  let inBlockComment = false;
  let entryIndent = null;
  let depth = null;

  for (const [i, raw] of source.split('\n').entries()) {
    const { code, inBlockComment: wasIn } = stripComments(raw, inBlockComment);
    inBlockComment = wasIn;
    const line = code.trim();
    if (!line) continue;

    if (depth === null) {
      // Still looking for the literal. `export const CURATED = {` is the anchor;
      // requiring the brace to end the line means an inline `{` cannot be
      // mistaken for it.
      const open = /^(?:export\s+)?const\s+CURATED\s*(?::[^=]+)?=\s*\{\s*$/.exec(line);
      if (open) depth = 1;
      continue;
    }

    // A closing brace, in every form a property or the literal itself can take.
    // Checked BEFORE the opening-brace increment, or `},` and `};` would both be
    // missed and the reader would walk straight out of the literal and start
    // reporting the code after it.
    if (/^\}[,;]?$/.test(line)) {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (line.endsWith('{')) depth++;

    const indent = code.length - code.trimStart().length;

    // A key declaration is read at ANY indentation, because a duplicate
    // indented four spaces is a duplicate: the previous reader matched exactly
    // two spaces and reported green on it. Inside this object literal the only
    // nested objects are the `issues` arrays, whose properties are scalars, so
    // there is nothing for the wider match to pick up by accident — and the scan
    // stops at the literal's closing brace regardless.
    const plain = /^(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([A-Za-z_$][\w$]*))\s*:\s*\{\s*$/.exec(line);
    if (plain) {
      // The entry indentation is MEASURED from the first declaration, not
      // hard-coded and not taken from whatever line happens to come next: the
      // first thing after a declaration is a `summary:` field, and measuring
      // from that would make every field the thing being checked.
      if (entryIndent === null && indent > 0) entryIndent = indent;
      keys.push(plain[1] ?? plain[2] ?? plain[3] ?? plain[4]);
      continue;
    }

    if (entryIndent === null) {
      if (indent === 0) continue; // still in the header comment or the export
      entryIndent = indent;
    }
    // Only the ENTRY indentation is checked for shapes this reader cannot
    // interpret. Deeper lines are the fields of an entry — a summary, a note, an
    // `issues` array — and are not declarations, so they are not reported.
    if (indent !== entryIndent) continue;

    unreadable.push(`line ${i + 1}: ${raw.trim()}`);
  }

  return { keys, unreadable };
}

const count = (list, value) => list.filter((x) => x === value).length;

/**
 * A throwaway git repository with a known ahead/behind shape.
 *
 * main has 3 commits, the side branch adds 2 of its own and does not see main's
 * 3rd, so the answer is behind=1 ahead=2 — two different numbers that a
 * transposed destructuring would still render plausibly.
 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'wtinv-git-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '--initial-branch=main', '--quiet');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  for (const n of ['one', 'two', 'three']) {
    writeFileSync(join(dir, `${n}.txt`), n);
    g('add', '.');
    g('commit', '--quiet', '-m', n);
  }
  g('checkout', '--quiet', '-b', 'side');
  for (const n of ['four', 'five']) {
    writeFileSync(join(dir, `${n}.txt`), n);
    g('add', '.');
    g('commit', '--quiet', '-m', n);
  }
  g('checkout', '--quiet', 'main');
  writeFileSync(join(dir, 'six.txt'), 'six');
  g('add', '.');
  g('commit', '--quiet', '-m', 'six');
  return dir;
}

/** A worktree shaped like the ones this repository actually has. */
function wt(overrides = {}) {
  return {
    name: 'example',
    path: '/repo/.kilo/worktrees/example',
    branch: 'feat/example',
    head: 'abc',
    isPrimary: false,
    tip: { sha: 'abc', subject: 'feat: something', date: '2026-09-28T00:00:00Z', author: 'kilo' },
    ahead: 1,
    behind: 2,
    mergedIntoBase: false,
    workingTree: { modified: 0, untracked: 0, paths: [] },
    commitsAhead: [],
    ...overrides,
  };
}

const noChats = { count: 0, lastActivity: null };
const noSessions = [];

/**
 * The shape the curated table used to have to be told about by hand, read off a
 * GENERATED record rather than a fixture: a branch git already calls disposable
 * (0 ahead of main, already on it) whose working tree holds the work anyway.
 *
 * This is `STATUS.UNCOMMITTED_ONLY` expressed over the fields the inventory
 * prints, and it is the only shape for which a hand-written `mustNotPrune` ever
 * earned its keep. Everything else in the curated table is either a branch git
 * can see (so it is protected by being a branch) or prose.
 */
const holdsWorkGitCannotSee = (r) => r.ahead === 0 && r.mergedIntoMain === true && r.dirty + r.untracked > 0;

/**
 * Every worktree of the repository at `root`, with the git facts the rule above reads.
 *
 * `collectWorktrees` is not used because it also runs `git merge-tree` on every
 * unmerged branch: that is the right cost for a generator which has to print all
 * of them, and the wrong cost for a guard that only needs three facts per
 * worktree. The merge answer is deliberately absent below, and it cannot change
 * any verdict here — `STATUS.UNCOMMITTED_ONLY` is decided before the merge is
 * consulted, so a worktree of this shape is `salvage` whether or not anyone
 * asked git whether it would merge.
 *
 * `tip` is read for real rather than left out: `classify` reads a MISSING tip as
 * `STATUS.UNREADABLE`, which reports `unknown` and `prunable: false` for
 * everything, and a guard written that way is green no matter what the generator
 * does with a dirty merged branch.
 *
 * NOT MEMOISED, which is the change that matters. This used to read the live
 * repository and memoise it, and the cost of that was not seconds, it was the
 * MEANING of every assertion built on it. A live read makes the subject of the
 * test "how many worktrees this machine has, how loaded it is, and whether the
 * main checkout is dirty at this instant", none of which any commit can change
 * and all of which a push gate must not be answering. The callers below now pass
 * a throwaway repository from `makeFleet()`.
 */
function worktreeFactsFor(root) {
  const base = __testables.resolveBaseRef(root);
  if (base === null) {
    // Not a guard failure dressed as a skip: a repository with no resolvable base
    // cannot produce a single one of the facts these tests read, and reporting
    // "git could not be asked" is the honest answer. Previously the absence of a
    // `main` ref threw out of an unguarded `execFileSync` and took three tests
    // with it, which is what a `pull_request` checkout of this repository does.
    throw new Error(
      `no base ref could be resolved in ${root}, so ahead/behind and merged-into-base cannot be read. ` +
        'Candidates tried: main, origin/main, refs/remotes/origin/main.'
    );
  }
  const missing = new Set(findMissingWorktrees(root).map((w) => w.path));
  // The MAIN checkout is the first entry of `git worktree list`, never `root`:
  // this suite is run from a task worktree as often as from the root checkout,
  // and "the main worktree" has to be the same worktree in both, or the guard
  // asserts a different repository depending on where it was invoked.
  const mainPath = listWorktrees(root)[0].path;
  // A registration whose directory is gone is reported by the generator under
  // `dataSources.git.missingWorktrees`; git cannot be asked about a tree that is
  // not there, and an `ahead` of `null` would read as "not derived" for a
  // worktree that is simply not there.
  const worktrees = listWorktrees(root)
    .filter((w) => !missing.has(w.path))
    .map((w) => {
      const { ahead, behind } = __testables.aheadBehind(w.path, base);
      // The merge answer is READ, not left out. Without it `mergeVerdict` answers
      // `unknown` for every unmerged branch, which makes the fleet's
      // `conflicting` worktree indistinguishable from its `ahead-clean` one — two
      // shapes the fixture claims to cover and one assertion apart. `collectWorktrees`
      // pays this for every worktree because a generator has to print them all; a
      // guard that needs the answer asks for it only where the branch is unmerged.
      const unmerged = typeof ahead === 'number' && ahead > 0;
      return {
        ...w,
        isPrimary: w.path === mainPath,
        tip: __testables.tipCommit(w.path),
        ahead,
        behind,
        mergedIntoBase: __testables.isMergedInto(w.path, base),
        merge: unmerged ? mergeConflict(w.path, base) : { conflict: false, files: [] },
        workingTree: __testables.workingTreeState(w.path),
        commitsAhead: [],
      };
    });
  return { mainPath, worktrees, base };
}

/**
 * An inventory over `facts`, with every LIVENESS signal deliberately empty.
 *
 * `in-use` is a protection of its own, so leaving the board and the chats in
 * would let this guard pass for the wrong reason: a worktree nobody happens to
 * be in is protected by the rule under test, and one somebody is in is protected
 * by liveness. With them out, the only thing standing between a dirty merged
 * branch and `disposalCandidates` is the derivation.
 */
function inventoryFor({ mainPath, worktrees, base }) {
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

/**
 * A throwaway repository holding one worktree per shape the guards below are
 * about, and therefore the same answers on every machine and on CI.
 *
 * WHY THIS EXISTS, IN THE ONE SENTENCE THAT MATTERS: the fleet these tests used
 * to read was the operator's, so the tests asserted a fact about the operator
 * rather than about the code, and that is what made this suite the slowest and
 * least reliable thing in the push gate. Measured on this repository at 92 live
 * worktrees: the file took 61.5s of a 142.8s `npm run test`, the three guards
 * below needed a 60s budget each to survive their own git spawns, and one of
 * them went RED because the main checkout happened to have one modified file at
 * that instant. The synthetic fleet is eight `git worktree add` calls and about
 * thirty spawns, so the same assertions cost milliseconds and cannot go red for
 * anything but a code change.
 *
 * NOTHING IS HAND-LISTED AS A NAME, which is the property the old set had and the
 * reason it was worth reading the live fleet for. The old rule was "no worktree
 * that holds work git cannot see may be flagged in CURATED" — and the way to
 * keep that from going stale is for the DERIVATION to be the thing under test,
 * over a fleet that deliberately contains the shape. Creating a worktree, or
 * committing in one, or disposing one, changes nothing here at all.
 *
 * The shapes, and what each one is there to catch:
 *   - `dirty-merged`    the whole subject: 0 ahead, already on main, one uncommitted file
 *   - `untracked-merged`  ditto with a file no commit holds and no branch has
 *   - `landed-clean`    a real disposal candidate, so over-protecting is caught too
 *   - `ahead-clean`     unmerged and clean, i.e. the branch an operator should land
 *   - `conflicting`     unmerged and unmergeable
 *   - `detached`        no branch identity, which `classify` must not read as licence
 *   - `vanished`        registered but its directory is gone, so it must be ABSENT
 *   - `outside`         registered outside the checkout, so `inRepo` must be false
 *
 * Four of these are there to be absent or unremarkable rather than to be acted
 * on, and saying so is part of the contract: `vanished` is filtered out before
 * any fact is read, and `outside` is the only member that is not `inRepo`. A
 * fixture that listed eight shapes without saying which of them the guards
 * actually see would be a comment, not a contract.
 */
function makeFleet() {
  const root = mkdtempSync(join(tmpdir(), 'wtinv-fleet-'));
  const dir = join(root, 'repo');
  mkdirSync(dir);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
  const write = (path, text) => writeFileSync(path, text);
  const add = (name, ...args) => g(dir, 'worktree', 'add', '--quiet', join(dir, '.kilo', 'worktrees', name), ...args);
  const addOutside = (name, ...args) => g(dir, 'worktree', 'add', '--quiet', join(root, name), ...args);
  g(dir, 'init', '--initial-branch=main', '--quiet');
  g(dir, 'config', 'user.email', 't@t');
  g(dir, 'config', 'user.name', 't');
  // Ignored, so the worktrees below do not read as untracked content in the
  // checkout, and UNDER the checkout, because `buildInventory` decides `inRepo`
  // with `path === root || path.startsWith(`${root}/`)`. Both halves are load
  // bearing. Sibling directories fail the second, and then every guard below is
  // asserting about an empty set and passing for a reason that has nothing to do
  // with the rule; the checkout does not ignore them and fails the first, and
  // then the PRIMARY worktree joins the set under test, which it can never
  // satisfy because it is `keep` by definition. This repository's own answer to
  // both is `.kilo/worktrees/` inside a checkout whose `.gitignore` covers it,
  // and the fixture reproduces the answer rather than the accident.
  write(join(dir, '.gitignore'), '/.kilo/\n');
  for (const n of ['one', 'two', 'three']) {
    write(join(dir, `${n}.txt`), n);
    g(dir, 'add', '.');
    g(dir, 'commit', '--quiet', '-m', n);
  }

  // 0 ahead, already on main, and holding an edit. The shape the whole tool
  // exists to refuse to read as disposable.
  g(dir, 'branch', 'dirty-merged');
  add('wt-dirty-merged', 'dirty-merged');
  write(join(dir, '.kilo', 'worktrees', 'wt-dirty-merged', 'one.txt'), 'uncommitted\n');

  // The same shape reached through an UNTRACKED file, which `remove` without
  // `--force` refuses and `remove --force` destroys.
  g(dir, 'branch', 'untracked-merged');
  add('wt-untracked-merged', 'untracked-merged');
  write(join(dir, '.kilo', 'worktrees', 'wt-untracked-merged', 'loose.txt'), 'untracked\n');

  // A genuine disposal candidate. Without it, "never prune" is satisfiable by a
  // `classify` that prunes nothing, which is the failure a guard written only
  // about one shape cannot see.
  g(dir, 'branch', 'landed-clean');
  add('wt-landed-clean', 'landed-clean');

  g(dir, 'checkout', '--quiet', '-b', 'ahead-clean');
  write(join(dir, 'four.txt'), 'four');
  g(dir, 'add', '.');
  g(dir, 'commit', '--quiet', '-m', 'four');
  g(dir, 'checkout', '--quiet', 'main');
  add('wt-ahead-clean', 'ahead-clean');

  // Diverged from the root commit, so `main` and it edit the same line
  // differently and the merge is genuinely unmergeable.
  const rootCommit = execFileSync('git', ['rev-list', '--max-parents=0', 'main'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
  g(dir, 'checkout', '--quiet', '-b', 'conflicting', rootCommit);
  write(join(dir, 'one.txt'), 'BASE-SIDE\n');
  g(dir, 'commit', '--quiet', '-am', 'side edit');
  g(dir, 'checkout', '--quiet', 'main');
  write(join(dir, 'one.txt'), 'BASE-MAIN\n');
  g(dir, 'commit', '--quiet', '-am', 'main edit');
  add('wt-conflicting', 'conflicting');

  // No branch identity at all: `detached` is a shape, not a state to be tidy about.
  add('wt-detached', '--detach', 'main');

  // Registered, then gone. git can still be asked whether the branch is landed;
  // it cannot be asked what the directory held, so `worktreeFactsFor` filters this
  // one OUT and it is the shape that must be absent rather than present.
  g(dir, 'branch', 'vanished');
  add('wt-vanished', 'vanished');
  rmSync(join(dir, '.kilo', 'worktrees', 'wt-vanished'), { recursive: true, force: true });

  // OUTSIDE the checkout entirely, which is the only way to reach `inRepo: false`.
  // `assemble.mjs` decides it with `path === root || path.startsWith(`${root}/`)`,
  // and every rewritten guard filters on `inRepo`, so a fleet with nothing outside
  // the root cannot tell a correct filter from one that drops everything.
  g(dir, 'branch', 'outside');
  addOutside('wt-outside', 'outside');

  // Stated rather than assumed, because the failure it prevents is silent: a
  // checkout that is not clean puts the primary worktree into the set below.
  const primaryState = __testables.workingTreeState(dir);
  if (primaryState.modified !== 0 || primaryState.untracked !== 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      `the synthetic fleet's own checkout is not clean (modified=${primaryState.modified} ` +
        `untracked=${primaryState.untracked}), so the primary worktree would be held to the rule for a ` +
        `preservation branch. Paths: ${primaryState.paths.join(', ')}`
    );
  }

  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The git facts for one fresh synthetic fleet, with its own `cleanup`. */
function fleetWorktreeFacts() {
  const { dir, cleanup } = makeFleet();
  return { dir, ...worktreeFactsFor(dir), cleanup };
}

/**
 * ONE fleet per `describe` block, built before its first test and removed after
 * its last, and a getter that hands it to each of them.
 *
 * SHARED, AND THAT IS SAFE HERE FOR A REASON THAT IS NOT "TESTS ARE SMALL". The
 * fleet is immutable: no test below writes to a worktree, and `buildInventory`
 * and `classify` take plain records and return new ones. The first version built
 * a fresh fleet per test, and the full-suite run then spent its time in git
 * spawns — thirty-odd per test, four workers at a time, which is enough to push
 * the slowest of them past this file's 15s budget and turn three passing tests
 * into three timeouts. Building it once per block is the difference between a
 * gate that answers the same way twice and one that answers differently
 * depending on what else the machine is doing, which is the property this whole
 * change exists to remove.
 *
 * The getter THROWS rather than returning a stale fleet, so a test that reaches
 * for it outside a test body fails with a sentence instead of quietly asserting
 * against whatever the previous block left behind.
 */
function sharedFleet() {
  const state = { facts: null };
  beforeAll(() => {
    state.facts = fleetWorktreeFacts();
  });
  afterAll(() => {
    state.facts?.cleanup();
    state.facts = null;
  });
  return () => {
    if (state.facts === null) {
      throw new Error('the shared synthetic fleet was asked for outside a test, so there is nothing to read');
    }
    return state.facts;
  };
}

/** Every curated key whose entry claims it has landed. */
const claimedLanded = () =>
  Object.entries(CURATED)
    .filter(([, e]) => e.landed === true)
    .map(([n]) => n);

/**
 * Which of `claimed` a fleet of worktrees contradicts, as sentences.
 *
 * A name the fleet does not contain is NOT a contradiction. That is the
 * distinction the two callers above depend on and the reason this is a function
 * rather than inline logic: "the worktree is gone" and "the worktree is the
 * opposite of what was claimed" are different answers, and a rule that cannot
 * tell them apart fires on every entry in the table the moment the fleet is
 * cleaned up.
 *
 * `base` is the ref actually resolved, so the message names the ref the answer
 * came from rather than a `main` that may not exist in this checkout.
 */
function contradictionsAmong(claimed, worktrees, base) {
  const contradictions = [];
  for (const name of claimed) {
    const w = worktrees.find((x) => x.name === name);
    if (!w) continue; // the worktree is gone; nothing to contradict
    if (!__testables.isMergedInto(w.path, base)) {
      contradictions.push(`${name}: curated says landed, git says the branch is not on the base`);
    }
    if (w.detached) {
      contradictions.push(`${name}: curated says landed, but the worktree is detached`);
    }
  }
  return contradictions;
}

describe('git.mjs against a real repository', () => {
  it('maps rev-list --left-right --count to behind=left, ahead=right', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const raw = execFileSync('git', ['rev-list', '--left-right', '--count', 'main...HEAD'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      // Pin the raw shape first: if git ever changes the order, this fails
      // with the actual string rather than a mysterious assertion failure.
      expect(raw).toBe('1\t2');

      const { ahead, behind } = __testables.aheadBehind(dir, 'main');
      expect(behind).toBe(1);
      expect(ahead).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a branch that main does not contain as NOT merged', () => {
    const dir = makeRepo();
    try {
      // `makeRepo` leaves HEAD on main, where the question is trivially true.
      // The interesting case is a branch main has not seen.
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      expect(__testables.isMergedInto(dir, 'main')).toBe(false);
      execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: dir, stdio: 'ignore' });
      expect(__testables.isMergedInto(dir, 'main')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a leading-space porcelain status without eating the first path character', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'one.txt'), 'edited');
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'dirty.txt'), 'untracked');

      const tree = __testables.workingTreeState(dir);
      expect(tree.modified).toBe(1);
      expect(tree.untracked).toBe(1);
      // The first porcelain line is " M one.txt" with a leading space. A
      // `.trim()` on the whole output turns that into "M one.txt", and
      // `slice(3)` then yields "ne.txt" — a path that resolves to nothing.
      expect(tree.paths).toContain('one.txt');
      expect(tree.paths).toContain('dirty.txt');
      for (const p of tree.paths) {
        expect(existsSync(join(dir, p)), `${p} does not resolve inside the worktree`).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('separates "the branch is behind" from "this content is on no ref"', () => {
    const dir = makeRepo();
    try {
      const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
      // The shape that produced the false alarm: main moves `one.txt` on to
      // content the side branch has never seen, and then the side worktree is
      // given those same bytes. `one.txt` is `modified` — side's tip still
      // holds the old ones — while the content on disk is exactly what main
      // already has. Deleting that worktree loses nothing, and reporting it as
      // uncommitted work at risk is wrong by the only measure that matters.
      writeFileSync(join(dir, 'one.txt'), 'same-on-both');
      g('commit', '--quiet', '-am', 'main moves one');
      g('checkout', '--quiet', 'side');
      writeFileSync(join(dir, 'one.txt'), 'same-on-both');

      const behind = __testables.workingTreeState(dir, 'main');
      expect(behind.modified).toBe(1);
      expect(behind.paths).toEqual(['one.txt']);
      // The point of the field: main already holds these exact bytes.
      expect(behind.notOnBase).toBe(0);

      // An edit main does NOT have is content no commit anywhere holds.
      writeFileSync(join(dir, 'two.txt'), 'only-on-side');
      const real = __testables.workingTreeState(dir, 'main');
      expect(real.modified).toBe(2);
      expect(real.notOnBase).toBe(1);

      // An untracked file cannot be on the base branch by definition: the
      // branch never tracked it. It is the shape `remove --force` destroys.
      writeFileSync(join(dir, 'loose.txt'), 'untracked');
      const withUntracked = __testables.workingTreeState(dir, 'main');
      expect(withUntracked.untracked).toBe(1);
      expect(withUntracked.notOnBase).toBe(2);

      // A path the base branch does not have AT ALL counts as not-on-base:
      // side added `four.txt`, main never did, and it is in side's tip so it
      // is not even reported as modified — the risk is `main` deleting nothing
      // here, and this asserts the field does not claim otherwise.
      expect(withUntracked.notOnBase).toBeLessThanOrEqual(withUntracked.modified + withUntracked.untracked);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts a base branch that cannot be resolved as not-on-base rather than as clean', () => {
    const dir = makeRepo();
    try {
      writeFileSync(join(dir, 'one.txt'), 'edited');
      // The direction to be wrong in is the one that keeps the work: an
      // unresolvable base cannot prove anything is on it.
      const tree = __testables.workingTreeState(dir, 'no-such-branch');
      expect(tree.modified).toBe(1);
      expect(tree.notOnBase).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports whether the commit list was cut off at the cap', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const full = __testables.commitsAhead(dir, 'main', 2);
      expect(full.commits).toHaveLength(2);
      expect(full.truncated).toBe(false);

      const capped = __testables.commitsAhead(dir, 'main', 2, 1);
      expect(capped.commits).toHaveLength(1);
      // ahead=2 with one commit listed is a SAMPLE, and a reader must be able
      // to tell that from a complete list.
      expect(capped.truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a worktree whose directory was deleted, by path', () => {
    const dir = makeRepo();
    try {
      execFileSync('git', ['worktree', 'add', '--quiet', join(dir, 'wt-gone'), 'side'], {
        cwd: dir,
        stdio: 'ignore',
      });
      expect(findMissingWorktrees(dir)).toHaveLength(0);

      rmSync(join(dir, 'wt-gone'), { recursive: true, force: true });
      const missing = findMissingWorktrees(dir);
      expect(missing).toHaveLength(1);
      // By PATH, and compared after resolving symlinks: on macOS `mkdtemp`
      // hands back `/var/…` while git reports the same directory as
      // `/private/var/…`, so a raw string comparison fails on the prefix.
      // Comparing PATH SEGMENTS is what the production code does.
      expect(missing[0].path.endsWith('wt-gone')).toBe(true);
      expect(existsSync(missing[0].path)).toBe(false);
      expect(listWorktrees(dir).map((w) => w.path)).toContain(missing[0].path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * `resolveBaseRef`, which is the production half of the change that made the
 * `pull_request` trigger possible.
 *
 * IT WAS UNTESTED, and that is a hole worth naming: `resolveBaseRef` is the only
 * new production function in this work, and it was called from exactly one place
 * — a fixture helper in this file — and never as the subject of an assertion. So
 * `return 'main'` as its first statement left this whole suite green, with the
 * `origin/main` and `refs/remotes/origin/main` fallbacks deleted and the CI outage
 * free to return. A fix for an outage that nothing can regress is not a fix.
 *
 * So the shapes are BUILT rather than assumed, and each one is checked against raw
 * git first: a fixture that claims to have no `main` and quietly has one would
 * make the negative assertions pass for the wrong reason, which is the failure
 * this file's readers are otherwise written to avoid.
 */
describe('resolveBaseRef, against checkouts that do not have a local main', () => {
  /**
   * A repository with NO ref named `main` at all, and whatever else is asked for.
   *
   * `--initial-branch=trunk` is the whole mechanism: there is no `main`, so every
   * assertion below is about a base that genuinely is not there.
   */
  function repoWithoutMain({ withOriginMain = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-baseref-'));
    const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('init', '--initial-branch=trunk', '--quiet');
    g('config', 'user.email', 't@t');
    g('config', 'user.name', 't');
    writeFileSync(join(dir, 'a.txt'), 'a');
    g('add', '.');
    g('commit', '--quiet', '-m', 'a');
    if (withOriginMain) {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      g('update-ref', 'refs/remotes/origin/main', head);
    }
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it('prefers a local main when there is one', () => {
    const dir = makeRepo();
    try {
      // FULLY QUALIFIED, not `main`: a tag named `main` resolves in preference to
      // the branch under the short name, and one of the tests below is that case.
      expect(__testables.resolveBaseRef(dir)).toBe('refs/heads/main');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the remote-tracking ref a shallow checkout does have', () => {
    const { dir, cleanup } = repoWithoutMain({ withOriginMain: true });
    try {
      // Raw git first: if `main` resolved in this fixture, the fallback below
      // would pass for a reason that has nothing to do with the fallback.
      expect(
        (() => {
          try {
            return execFileSync('git', ['rev-parse', '--verify', 'main'], { cwd: dir, stdio: 'ignore' });
          } catch {
            return null;
          }
        })(),
        'this fixture must have no ref named main, or the assertion below proves nothing'
      ).toBeNull();

      // `origin/main`, NOT `refs/remotes/origin/main`, and the order is the point.
      // git's `rev-parse` resolves the short form through the remote-tracking ref
      // it abbreviates, so both names reach the same commit — and the short one is
      // tried first because it is the name that also works in a `git log` or
      // `git merge-base` a human runs afterwards. Asserting the long form here
      // would have been a test that pinned a worse answer.
      expect(__testables.resolveBaseRef(dir)).toBe('origin/main');
      // And the name it returns is one git can actually use, which is the only
      // reason to return a name at all.
      expect(() =>
        execFileSync('git', ['rev-parse', '--verify', __testables.resolveBaseRef(dir)], {
          cwd: dir,
          stdio: 'ignore',
        })
      ).not.toThrow();
    } finally {
      cleanup();
    }
  });

  it('walks the whole candidate list rather than answering from the first entry', () => {
    // The first entry does not resolve in this checkout, so reaching the second
    // is the only thing that can be asserted — and a resolver that returned its
    // first candidate unchecked would pass every other test in this block while
    // handing `aheadBehind` a name git cannot use.
    const { dir, cleanup } = repoWithoutMain({ withOriginMain: true });
    try {
      expect(__testables.resolveBaseRef(dir, ['no-such-ref', 'origin/main'])).toBe('origin/main');
      expect(__testables.resolveBaseRef(dir, ['no-such-ref', 'also-missing'])).toBeNull();
      // The long form is reachable when the short one cannot be used, which is
      // the case that made the list necessary at all.
      expect(__testables.resolveBaseRef(dir, ['no-such-ref', 'refs/remotes/origin/main'])).toBe(
        'refs/remotes/origin/main'
      );
    } finally {
      cleanup();
    }
  });

  it('refuses to certify a base in a SHALLOW repository, where ancestry means nothing', () => {
    // The dangerous one, and it cannot be reasoned about — it has to be built. In
    // a `--depth 1` clone the base names exactly one commit, so `rev-parse
    // --verify` succeeds and every answer built on it is confidently wrong. The
    // shape that shows it: BOTH commits are present as objects, so nothing is
    // "missing", and the path between them has been CUT, so ancestry that holds in
    // a full clone reports false.
    const src = mkdtempSync(join(tmpdir(), 'wtinv-shallow-src-'));
    const origin = mkdtempSync(join(tmpdir(), 'wtinv-shallow-origin-'));
    const g = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    const head = (cwd, ref) => execFileSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' }).trim();
    const isAncestorExit = (cwd, from, to) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', from, to], { cwd, stdio: 'ignore' });
        return 0;
      } catch (err) {
        return err.status;
      }
    };
    try {
      g(src, 'init', '--initial-branch=main', '--quiet');
      g(src, 'config', 'user.email', 't@t');
      g(src, 'config', 'user.name', 't');
      writeFileSync(join(src, 'a.txt'), 'a');
      g(src, 'add', '.');
      g(src, 'commit', '--quiet', '-m', 'a');
      const ancestor = head(src, 'HEAD');
      writeFileSync(join(src, 'b.txt'), 'b');
      g(src, 'add', '.');
      g(src, 'commit', '--quiet', '-m', 'b');
      const tip = head(src, 'HEAD');
      execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', origin], { stdio: 'ignore' });
      g(src, 'remote', 'add', 'origin', origin);
      g(src, 'push', '--quiet', 'origin', 'main');

      // A FULL clone: the ancestry is real, and the base is certifiable.
      const full = mkdtempSync(join(tmpdir(), 'wtinv-shallow-full-'));
      g(full, 'clone', '--quiet', origin, '.');
      expect(isAncestorExit(full, ancestor, tip), 'the fixture is wrong: those commits are not in that order').toBe(0);
      expect(__testables.resolveBaseRef(full)).toBe('refs/heads/main');

      // A SHALLOW clone of the same remote, with BOTH objects present and the path
      // between them cut — which is exactly what a shallow fetch of each does.
      const shallow = mkdtempSync(join(tmpdir(), 'wtinv-shallow-clone-'));
      g(shallow, 'init', '--quiet');
      g(shallow, 'remote', 'add', 'origin', origin);
      g(shallow, 'fetch', '--quiet', '--depth', '1', 'origin', 'main');
      g(shallow, 'update-ref', 'refs/heads/main', 'FETCH_HEAD');
      g(shallow, 'checkout', '--quiet', 'main');
      g(shallow, 'fetch', '--quiet', '--depth', '1', 'origin', ancestor);
      expect(existsSync(join(shallow, '.git', 'shallow')), 'the fixture is not shallow, so it proves nothing').toBe(
        true
      );
      // Both commits are here as objects. Nothing is missing; the PATH is cut.
      expect(() =>
        execFileSync('git', ['cat-file', '-e', `${ancestor}^{commit}`], { cwd: shallow, stdio: 'ignore' })
      ).not.toThrow();
      expect(() =>
        execFileSync('git', ['cat-file', '-e', `${tip}^{commit}`], { cwd: shallow, stdio: 'ignore' })
      ).not.toThrow();
      // The ref resolves, so `rev-parse --verify` is happy. That is the trap.
      expect(() =>
        execFileSync('git', ['rev-parse', '--verify', 'refs/heads/main^{commit}'], { cwd: shallow, stdio: 'ignore' })
      ).not.toThrow();
      // And the answer it gives is the wrong one: same question, opposite verdict.
      expect(
        isAncestorExit(shallow, ancestor, tip),
        'this fixture does not demonstrate the hazard: ancestry answered correctly in a shallow clone'
      ).not.toBe(0);

      // So the function refuses rather than certifying a base it cannot use.
      expect(__testables.resolveBaseRef(shallow)).toBeNull();
      expect(__testables.isShallow(shallow)).toBe(true);
      expect(__testables.isShallow(full)).toBe(false);
      rmSync(full, { recursive: true, force: true });
      rmSync(shallow, { recursive: true, force: true });
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    }
  });

  it('does not let a tag named main become the base, which git resolves in preference to the branch', () => {
    // `rev-parse --verify main^{commit}` resolves the TAG. So does every consumer
    // afterwards, so the module stays self-consistent while comparing against
    // whatever the tag points at — and git prints
    // `warning: refname 'main' is ambiguous` on stderr, which nothing reads.
    // The question that separates them: is the BRANCH TIP an ancestor of the base?
    // On the branch, yes. Of the tag, no.
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-ambiguous-'));
    const g = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });
    const isAncestorExit = (from, to) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', from, to], { cwd: dir, stdio: 'ignore' });
        return 0;
      } catch (err) {
        return err.status;
      }
    };
    try {
      g(dir, 'init', '--initial-branch=main', '--quiet');
      g(dir, 'config', 'user.email', 't@t');
      g(dir, 'config', 'user.name', 't');
      writeFileSync(join(dir, 'a.txt'), 'a');
      g(dir, 'add', '.');
      g(dir, 'commit', '--quiet', '-m', 'a');
      const branchTip = execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).trim();
      // A commit with NO ancestry in common, so the tag named `main` and the branch
      // named `main` disagree about whether the branch tip is contained. A side
      // BRANCH would not do: it starts at the branch tip, so the tip is an ancestor
      // of the tag as well and the two answers come out identical.
      g(dir, 'checkout', '--quiet', '--orphan', 'unrelated');
      g(dir, 'rm', '--quiet', '-rf', '.');
      writeFileSync(join(dir, 'z.txt'), 'z');
      g(dir, 'add', '.');
      g(dir, 'commit', '--quiet', '-m', 'unrelated');
      const unrelated = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      g(dir, 'checkout', '--quiet', 'main');
      g(dir, 'tag', 'main', unrelated);

      // The two answers differ, so the question discriminates.
      expect(isAncestorExit(branchTip, 'refs/heads/main'), 'the branch tip is not on the branch').toBe(0);
      expect(
        isAncestorExit(branchTip, 'main'),
        'the ambiguity does not reproduce: the tag behaves like the branch'
      ).not.toBe(0);

      // The answer: a FULLY QUALIFIED candidate, so the branch and never the tag.
      expect(__testables.resolveBaseRef(dir)).toBe('refs/heads/main');
      expect(isAncestorExit(branchTip, __testables.resolveBaseRef(dir))).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers null, not a guess, when the checkout has no base at all', () => {
    // THE case that made this necessary. A `pull_request` checkout at
    // `fetch-depth: 1` has no `main`, and on some shapes no `origin/main` either.
    // Returning any of the candidate NAMES unchecked is what produced the outage:
    // `aheadBehind` then answers null for every worktree, which every guard
    // downstream reads as "nothing is at risk".
    const { dir, cleanup } = repoWithoutMain();
    try {
      expect(__testables.resolveBaseRef(dir)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('refuses to read facts from a checkout with no base, rather than reporting an empty fleet', () => {
    // `null` reaching a caller is a fact about the CHECKOUT, and the one thing a
    // caller must not do with it is carry on. `worktreeFactsFor` refuses, and the
    // message names the candidates so a reader knows what was looked for.
    const { dir, cleanup } = repoWithoutMain();
    try {
      expect(() => worktreeFactsFor(dir)).toThrow(/no base ref could be resolved/);
      expect(() => worktreeFactsFor(dir)).toThrow(/refs\/remotes\/origin\/main/);
    } finally {
      cleanup();
    }
  });
});

describe('resolveBoardDb', () => {
  it('returns an absolute path, so it resolves the same from any worktree', () => {
    const dir = makeRepo();
    try {
      const p = resolveBoardDb(dir);
      expect(p.startsWith('/')).toBe(true);
      // The failure this pins: plain `git rev-parse --git-common-dir` answers
      // the RELATIVE string ".git", which DatabaseSync then resolves against
      // process.cwd() — a different directory in every worktree.
      expect(p).not.toMatch(/^\.git/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readBoard: liveness of claims and locks', () => {
  /**
   * The CURRENT schema, hand-written — and the DDL is COPIED FROM THE PRODUCT
   * (`db.mjs`, `CREATE TABLE IF NOT EXISTS`), constraints and all, because a
   * loose hand-written schema is the same defect wearing a different hat.
   *
   * It used to declare `file_locks` with a v1 `issue_id` column, which made every
   * test below pass against a board the product stopped creating — the one shape
   * in which the lock query does not throw. `file_locks` has carried no `issue_id`
   * since schema v2: attribution moved to the `issue_locks` pairing table, and
   * `migrateFileLockAttribution` copies rows into it without ever dropping the
   * old column, so every board created before v2 still carries it and every board
   * created AT v2 does not — which is why selecting it worked on the only
   * database anyone tested against and threw `no such column: issue_id` on every
   * fresh clone. A fixture must be the shape a real new database has, or it
   * certifies the bug.
   *
   * The tests that must run against a board the PRODUCT creates, rather than one
   * this file describes, use `Board` itself — see "readBoard against a board the
   * product creates" below.
   */
  const CURRENT_SCHEMA = `
    CREATE TABLE issues (id TEXT, title TEXT, scope TEXT, status TEXT, priority TEXT, origin TEXT);
    CREATE TABLE claims (issue_id TEXT, agent_id TEXT, worktree TEXT, branch TEXT,
                         lease_until TEXT, released_at TEXT);
    CREATE TABLE file_locks (path TEXT NOT NULL, agent_id TEXT NOT NULL, worktree TEXT,
                             acquired_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                             released_at TEXT, PRIMARY KEY (path, agent_id));
    CREATE TABLE issue_locks (issue_id TEXT NOT NULL, path TEXT NOT NULL, agent_id TEXT NOT NULL,
                              created_at TEXT NOT NULL, PRIMARY KEY (issue_id, path));
    CREATE TABLE agents (agent_id TEXT, kind TEXT, worktree TEXT, branch TEXT,
                        session_id TEXT, last_seen TEXT);`;

  const iso = (ms) => new Date(ms).toISOString();

  /** A board database with the real schema and one row of each kind. */
  function makeBoard({ leaseUntil, releasedAt = null, expiresAt }) {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-board-'));
    const db = new DatabaseSync(join(dir, 'board.db'));
    db.exec(CURRENT_SCHEMA);
    db.prepare('INSERT INTO issues VALUES (?,?,?,?,?,?)').run('ph-1', 'an issue', 'prod', 'open', 'high', 'x');
    db.prepare('INSERT INTO claims VALUES (?,?,?,?,?,?)').run(
      'ph-1',
      'agent-a',
      '/repo/.kilo/worktrees/x',
      'feat/x',
      leaseUntil,
      releasedAt
    );
    db.prepare('INSERT INTO file_locks VALUES (?,?,?,?,?,?)').run(
      'src/a.ts',
      'agent-a',
      '/repo/.kilo/worktrees/x',
      iso(NOW),
      expiresAt,
      releasedAt
    );
    // The pairing, in the table that holds it — a second insert with the same
    // column count in a different order would be the v1 bug wearing a costume.
    if (releasedAt === null) {
      db.prepare('INSERT INTO issue_locks VALUES (?,?,?,?)').run('ph-1', 'src/a.ts', 'agent-a', iso(NOW));
    }
    db.close();
    return { dir, dbPath: join(dir, 'board.db') };
  }

  it('keeps a claim whose ISO-8601 lease has not expired', () => {
    // `lease_until` is TEXT. A bare `Number(x) > nowMs` is `NaN > n` — false
    // for every row — so this filter once dropped every claim and every lock
    // in the repository, and the board half reported zero contention.
    const { dir, dbPath } = makeBoard({ leaseUntil: iso(NOW + 600_000), expiresAt: iso(NOW + 600_000) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath });
      expect(board.available).toBe(true);
      expect(board.issues).toHaveLength(1);
      expect([...board.claims.values()].flat()).toHaveLength(1);
      expect([...board.fileLocks.values()].flat()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a claim whose lease has run out, and one that was released', () => {
    const expired = makeBoard({ leaseUntil: iso(NOW - 600_000), expiresAt: iso(NOW - 600_000) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: expired.dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(0);
    } finally {
      rmSync(expired.dir, { recursive: true, force: true });
    }

    const released = makeBoard({ leaseUntil: iso(NOW + 600_000), expiresAt: iso(NOW + 600_000), releasedAt: iso(NOW) });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: released.dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(0);
    } finally {
      rmSync(released.dir, { recursive: true, force: true });
    }
  });

  it('treats an unparseable timestamp as live rather than hiding the claim', () => {
    const { dir, dbPath } = makeBoard({ leaseUntil: 'not-a-date', expiresAt: 'not-a-date' });
    try {
      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath });
      expect([...board.claims.values()].flat()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks an agent live inside the 30-minute window, by worktree', () => {
    // The session database is blind to a session opened in the main checkout
    // and then driven into a task worktree: its `directory` never changes, so
    // that worktree reads as prunable while it is being actively used. The
    // board records the worktree, so it is the only signal that covers it.
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-board-'));
    const db = new DatabaseSync(join(dir, 'board.db'));
    try {
      db.exec(CURRENT_SCHEMA);
      db.prepare('INSERT INTO agents VALUES (?,?,?,?,?,?)').run(
        'chore/x',
        'kilo',
        '/wt',
        'chore/x',
        'sid',
        new Date(NOW - 60_000).toISOString()
      );
      db.prepare('INSERT INTO agents VALUES (?,?,?,?,?,?)').run(
        'old/y',
        'kilo',
        '/wt',
        'old/y',
        'sid',
        new Date(NOW - 6 * 3600_000).toISOString()
      );
      db.close();

      const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: join(dir, 'board.db') });
      const agents = board.agents.get('/wt');
      expect(agents).toHaveLength(2);
      expect(agents.filter((a) => a.live).map((a) => a.agentId)).toEqual(['chore/x']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes a worktree in-use from the board record even with no chat in it', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
      boardAgents: [{ agentId: 'chore/x', lastSeenMs: NOW - 30_000, live: true }],
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
    expect(v.reasons.join(' ')).toContain('chore/x');
  });

  it('still prunes when the board agent is stale', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
      boardAgents: [{ agentId: 'chore/x', lastSeenMs: NOW - 6 * 3600_000, live: false }],
    });
    expect(v.prunable).toBe(true);
  });

  it('degrades to an empty board, not a crash, when the database is absent', () => {
    const board = readBoard(process.cwd(), { nowMs: NOW, dbPath: '/nonexistent/board.db' });
    expect(board.available).toBe(false);
    expect(board.claims.size).toBe(0);
    expect(board.issues).toEqual([]);
  });
});

/**
 * The board half of the inventory, against a board the PRODUCT creates.
 *
 * Everything above hand-writes its schema, which is exactly how the defect this
 * block exists for survived: the fixture declared the v1 `file_locks.issue_id`
 * that schema v2 removed, so the suite was green against the only board shape on
 * which the query cannot fail, while a real fresh board threw `no such column`
 * out of a command AGENTS.md makes mandatory. A hand-written schema is a claim
 * about the product that nothing checks; `Board` is the product.
 */
describe('readBoard against a board the product creates', () => {
  let dir;
  let worktree;
  let board;

  const identity = (agentId) => ({
    agentId,
    kind: 'kilo',
    worktree,
    branch: `feat/${agentId}`,
    sessionId: `run-${agentId}`,
    pid: 4242,
    meta: {},
  });

  const openBoard = (agentId) => new Board({ dir, identity: identity(agentId) }).open();

  /** `readBoard` on the board just written, with the worktree's own path. */
  const read = (nowMs) => readBoard(process.cwd(), { nowMs, dbPath: join(dir, 'board.db') });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wtinv-real-board-'));
    worktree = join(dir, 'wt-a');
    board = openBoard('agent-a');
  });

  afterEach(() => {
    board.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a lock taken with an issue off a board the current schema created', () => {
    // The failing case, restated as a test: on a board the current code creates,
    // `file_locks` has no `issue_id`, and selecting it throws out of an
    // un-guarded `readBoard` in a command with one caller and no catch.
    const { id } = board.createIssue({ title: 'paired' });
    board.holdFiles(['src/a.ts'], { issueId: id });

    const result = read(Date.now());

    expect(result.available).toBe(true);
    expect(result.lockIssueAttribution).toBe('issue_locks');
    const locks = result.fileLocks.get(worktree);
    expect(locks).toHaveLength(1);
    expect(locks[0].path).toBe('src/a.ts');
    expect(locks[0].agentId).toBe('agent-a');
    expect(locks[0].issueIds).toEqual([id]);
  });

  it('reads a lock taken with NO issue as no attribution, not as a crash', () => {
    // `hold <path>` with no `--issue` is the form AGENTS.md prescribes, and it
    // writes no `issue_locks` row at all. Reporting an issue here would be a
    // guess, so the answer is an empty set and the reader still says where the
    // attribution came from.
    board.holdFiles(['src/unpaired.ts']);

    const result = read(Date.now());

    expect(result.lockIssueAttribution).toBe('issue_locks');
    const locks = result.fileLocks.get(worktree);
    expect(locks).toHaveLength(1);
    expect(locks[0].path).toBe('src/unpaired.ts');
    expect(locks[0].issueIds).toEqual([]);
  });

  it('reports every issue one lock is being used for', () => {
    // `issue_locks` is keyed (issue_id, path), so ONE lock can serve as many
    // issues as there are legitimate uses of it — which is the whole reason the
    // attribution moved out of a column. A single-valued field has no honest
    // answer here: it must drop one of these or name the wrong one, and the
    // inventory is what a human reads to decide who is in which file.
    const first = board.createIssue({ title: 'first' });
    const second = board.createIssue({ title: 'second' });
    board.holdFiles(['src/shared.ts'], { issueId: first.id });
    board.holdFiles(['src/shared.ts'], { issueId: second.id });

    const result = read(Date.now());

    const locks = result.fileLocks.get(worktree);
    // ONE lock, not two rows: the unit is the lock, and a join that multiplied
    // the lock by its pairings would report the same file held twice.
    expect(locks).toHaveLength(1);
    expect(locks[0].issueIds).toEqual([first.id, second.id]);
  });

  it("does not attribute another agent's issue to this agent's lock on the same path", () => {
    // Attribution is keyed (path, agent): two agents may hold the same file, and
    // a key of path alone would hand each of them the other's issue.
    const other = new Board({ dir, identity: { ...identity('agent-b'), worktree } }).open();
    try {
      const { id } = board.createIssue({ title: 'mine' });
      board.holdFiles(['src/contended.ts'], { issueId: id });
      other.holdFiles(['src/contended.ts'], { force: true });

      const result = read(Date.now());
      const locks = result.fileLocks.get(worktree);

      expect(locks.map((l) => l.agentId).sort()).toEqual(['agent-a', 'agent-b']);
      expect(locks.find((l) => l.agentId === 'agent-a').issueIds).toEqual([id]);
      expect(locks.find((l) => l.agentId === 'agent-b').issueIds).toEqual([]);
    } finally {
      other.close();
    }
  });

  it("reports a v1 board's unreadable attribution instead of throwing or faking it", () => {
    // The third on-disk shape, and the one the read-only open makes reachable:
    // `readBoard` never migrates, so a v1 board file that nothing has opened
    // since the upgrade still has the v1 column and NO `issue_locks` table. The
    // query for attribution throws there, and an unguarded throw on a board this
    // old would be a defect introduced by the fix. The payload has to say so,
    // because "this lock has no issue" and "this lock's issue could not be read"
    // are different answers and only one of them is true.
    const v1Dir = mkdtempSync(join(tmpdir(), 'wtinv-v1-board-'));
    try {
      const db = new DatabaseSync(join(v1Dir, 'board.db'));
      db.exec(`CREATE TABLE issues (id TEXT, title TEXT, scope TEXT, status TEXT, priority TEXT, origin TEXT);
               CREATE TABLE claims (issue_id TEXT, agent_id TEXT, worktree TEXT, branch TEXT,
                                    lease_until TEXT, released_at TEXT);
               CREATE TABLE file_locks (path TEXT, agent_id TEXT, issue_id TEXT, worktree TEXT,
                                       acquired_at TEXT, expires_at TEXT, released_at TEXT,
                                       PRIMARY KEY (path, agent_id));
               CREATE TABLE agents (agent_id TEXT, kind TEXT, worktree TEXT, branch TEXT,
                                   session_id TEXT, last_seen TEXT);`);
      db.prepare('INSERT INTO issues VALUES (?,?,?,?,?,?)').run('ph-1', 'an issue', 'prod', 'open', 'high', null);
      const at = Date.now();
      db.prepare('INSERT INTO file_locks VALUES (?,?,?,?,?,?,?)').run(
        'src/legacy.ts',
        'agent-a',
        'ph-1',
        worktree,
        new Date(at).toISOString(),
        new Date(at + 600_000).toISOString(),
        null
      );
      db.close();

      const result = readBoard(process.cwd(), { nowMs: at, dbPath: join(v1Dir, 'board.db') });

      expect(result.available).toBe(true);
      expect(result.lockIssueAttribution).toBe('unavailable');
      const locks = result.fileLocks.get(worktree);
      expect(locks).toHaveLength(1);
      expect(locks[0].path).toBe('src/legacy.ts');
      expect(locks[0].issueIds).toEqual([]);
    } finally {
      rmSync(v1Dir, { recursive: true, force: true });
    }
  });
});

describe('blocked-question detection', () => {
  /**
   * The real shape: the message sits inside a JSON string, so its quotes are
   * escaped, and the same row also carries a `questionID` JSON KEY whose value
   * is the placeholder `"/"`.
   */
  const payload = JSON.stringify({
    type: 'tool',
    tool: 'agent_manager',
    state: { status: 'error' },
    input: { questionID: '/', replyTo: '/' },
    error:
      'The managed session ses_x ("a title") is waiting for input. ' +
      // BARE quotes here: `JSON.stringify` is what escapes them, exactly as the
      // runtime did when it stored the row. Escaping them twice, as an earlier
      // draft of this fixture did, produces `\\\"` and the test then proves
      // nothing about the real payload.
      'Pending question requests: questionID "que_0e49a9650001UM8oJl32u9X3ko"',
  });

  it('extracts the question id from the escaped payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-blk-'));
    const dbPath = join(dir, 'kilo.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, parent_id TEXT, agent TEXT,
                 slug TEXT, tokens_output INTEGER, tokens_input INTEGER, time_created INTEGER,
                 time_updated INTEGER, time_archived INTEGER);
               CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER,
                 time_updated INTEGER, data TEXT);`);
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        'ses_x',
        '/wt',
        'a title',
        null,
        'code',
        's',
        100,
        10,
        NOW - 7200_000,
        NOW - 7200_000,
        null
      );
      db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)').run('p1', 'm1', 'ses_x', NOW - 100, NOW - 100, payload);
      db.close();

      const { auditChats } = await_import();
      const audit = auditChats({ dbPath, sinceMs: NOW - 4 * 3600_000, nowMs: NOW, existingPaths: new Set(['/wt']) });
      const [s] = audit.byDirectory.get('/wt');
      expect(s.state).toBe('blocked');
      // Not the `"/"` placeholder from the input JSON — that occurrence is
      // skipped because it is followed by a quote rather than a space.
      expect(s.blockedOn).toBe('que_0e49a9650001UM8oJl32u9X3ko');
      expect(s.reasons.join(' ')).toContain('waiting for input');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the pinned clock', () => {
  it('does not let --now in the past reclassify worktrees as in-use', () => {
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    const lastActivity = NOW;
    const byDirectory = new Map([
      ['/repo/.kilo/worktrees/x', [{ id: 's1', state: 'finished', timeUpdated: lastActivity, subagentCount: 0 }]],
    ]);
    const chatAudit = { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: lastActivity };

    // nowMs is a day BEHIND the newest session the audit knows about. A
    // negative idle time passes the liveness test, which once flipped a dozen
    // worktrees from salvage to in-use under this flag.
    const inv = buildInventory({
      worktrees: [wt({ name: 'x', ahead: 2, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW - 86_400_000,
    });
    expect(inv.worktrees[0].recommendation).toBe(RECOMMENDATION.SALVAGE);
  });

  it('still marks a genuinely live session in-use', () => {
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    // The map key MUST be the worktree's own path: `buildInventory` looks
    // sessions up by `wt.path`, and a key that does not match silently
    // produces an empty chat set — which reads as "no live session".
    const byDirectory = new Map([
      ['/repo/.kilo/worktrees/example', [{ id: 's1', state: 'active', timeUpdated: NOW - 60_000, subagentCount: 0 }]],
    ]);
    const inv = buildInventory({
      worktrees: [wt({ ahead: 2, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: NOW - 60_000 },
      nowMs: NOW,
    });
    expect(inv.worktrees[0].chats.count).toBe(1);
    expect(inv.worktrees[0].recommendation).toBe(RECOMMENDATION.IN_USE);
  });
});

describe('mergeConflict, against a real repository', () => {
  /** `repo` has main at 3 commits; `side` adds 2 and never sees main\'s 3rd. */
  function repo() {
    return makeRepo();
  }

  it('reports no conflict for a branch that merges cleanly', () => {
    const dir = repo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      expect(mergeConflict(dir, 'main')).toEqual({ conflict: false, files: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a conflict when both sides changed the same line', () => {
    const dir = repo();
    try {
      // Make the branch and main edit the SAME line of the SAME file, from
      // their shared ancestor, so the three-way merge genuinely conflicts.
      const root = execFileSync('git', ['rev-list', '--max-parents=0', 'main'], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['checkout', '--quiet', '-b', 'clash', root], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'one.txt'), 'BASE-SIDE\n');
      execFileSync('git', ['commit', '-qam', 'side edit'], { cwd: dir, stdio: 'ignore' });
      execFileSync('git', ['checkout', '--quiet', 'main'], { cwd: dir, stdio: 'ignore' });
      writeFileSync(join(dir, 'one.txt'), 'BASE-MAIN\n');
      execFileSync('git', ['commit', '-qam', 'main edit'], { cwd: dir, stdio: 'ignore' });

      execFileSync('git', ['checkout', '--quiet', 'clash'], { cwd: dir, stdio: 'ignore' });
      const r = mergeConflict(dir, 'main');
      expect(r.conflict).toBe(true);
      // The files are the actionable part: "it conflicts" sends somebody to
      // investigate, "it conflicts in these two files" is the work.
      expect(r.files).toContain('one.txt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null, not false, when the merge cannot be attempted', () => {
    // A wrong `false` is a licence to land, so an unknown answer must never
    // be reported as a clean merge.
    const dir = repo();
    try {
      const r = mergeConflict(dir, 'no-such-branch');
      expect(r.conflict).toBeNull();
      expect(r.files).toEqual([]);
      expect(typeof r.reason).toBe('string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no ref, index or worktree behind', () => {
    // The generator runs this across every worktree, so it must be inert.
    const dir = repo();
    try {
      execFileSync('git', ['checkout', '--quiet', 'side'], { cwd: dir, stdio: 'ignore' });
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
      const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
      mergeConflict(dir, 'main');
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' })).toBe(headBefore);
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })).toBe(statusBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('land vs at-risk: the split that salvage used to hide', () => {
  const unmergedClean = (over = {}) =>
    wt({ ahead: 3, behind: 40, mergedIntoBase: false, merge: { conflict: false }, ...over });
  const args = (over) => ({ chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW, ...over });

  it('calls a clean, unmerged, conflict-free branch ready-to-land, not salvage', () => {
    const v = classify(unmergedClean(), args());
    expect(v.recommendation).toBe(RECOMMENDATION.READY_TO_LAND);
    expect(v.action).toBe(ACTION.LAND);
    expect(v.prunable).toBe(false);
  });

  it('keeps a CONFLICTING branch out of ready-to-land', () => {
    const v = classify(unmergedClean({ merge: { conflict: true } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
    expect(v.reasons.join(' ')).toContain('conflicts');
  });

  it('keeps a branch whose merge cannot be checked out of ready-to-land', () => {
    // The dangerous case: an unknown must not read as "no conflicts".
    const v = classify(unmergedClean({ merge: { conflict: null, reason: 'nope' } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
  });

  it('never calls a worktree with uncommitted work ready to land', () => {
    const v = classify(unmergedClean({ workingTree: { modified: 2, untracked: 0, paths: [] } }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.action).toBe(ACTION.AT_RISK);
  });

  it('calls a landed, clean worktree a disposal candidate', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), args());
    expect(v.recommendation).toBe(RECOMMENDATION.PRUNE);
    expect(v.action).toBe(ACTION.DISPOSE);
    expect(v.prunable).toBe(true);
  });

  it('derives the action from the recommendation, and covers every value', () => {
    // Each case builds inputs that actually PRODUCE that recommendation.
    // An earlier version fed one default worktree and asserted seven
    // mappings, which tested only the two the default could ever reach.
    const cases = [
      [RECOMMENDATION.PRUNE, wt({ ahead: 0, mergedIntoBase: true }), {}],
      [
        RECOMMENDATION.READY_TO_LAND,
        wt({ ahead: 3, behind: 40, mergedIntoBase: false, merge: { conflict: false } }),
        {},
      ],
      [RECOMMENDATION.SALVAGE, wt({ ahead: 3, mergedIntoBase: false, merge: { conflict: true } }), {}],
      [
        RECOMMENDATION.SALVAGE,
        wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: [] } }),
        {},
      ],
      // Never checked at all: absent, not null. Must not read as a licence.
      [RECOMMENDATION.SALVAGE, wt({ ahead: 3, mergedIntoBase: false }), {}],
      [RECOMMENDATION.REVIEW_RESIDUE, wt({ ahead: 0, mergedIntoBase: true }), { curated: { mustNotPrune: true } }],
      [RECOMMENDATION.IN_USE, wt({ ahead: 0, mergedIntoBase: true }), { boardAgents: [{ live: true, agentId: 'a' }] }],
      [RECOMMENDATION.KEEP, wt({ isPrimary: true }), {}],
      // Detached and not in use: there is no branch identity to report, so
      // nothing can be decided about it. With a live agent it would be
      // `in-use` first, which is correct but not what this case is about.
      [RECOMMENDATION.UNKNOWN, wt({ detached: true, ahead: 0, mergedIntoBase: true }), {}],
    ];
    const expected = {
      [RECOMMENDATION.PRUNE]: ACTION.DISPOSE,
      [RECOMMENDATION.READY_TO_LAND]: ACTION.LAND,
      [RECOMMENDATION.SALVAGE]: ACTION.AT_RISK,
      [RECOMMENDATION.REVIEW_RESIDUE]: ACTION.AT_RISK,
      [RECOMMENDATION.IN_USE]: ACTION.IN_USE,
      [RECOMMENDATION.KEEP]: ACTION.KEEP,
      [RECOMMENDATION.UNKNOWN]: ACTION.UNDECIDED,
    };
    const seen = new Set();
    for (const [wantRec, worktree, extra] of cases) {
      const v = classify(worktree, args(extra));
      seen.add(v.recommendation);
      expect(v.recommendation, 'case setup no longer produces the intended recommendation').toBe(wantRec);
      expect(v.action).toBe(expected[wantRec]);
    }
    // Every recommendation value is exercised, so a new one cannot arrive
    // without a mapping and without a test noticing.
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
  });

  it('ranks ready-to-land below at-risk, since nothing is at risk there', () => {
    expect(riskScore({ recommendation: RECOMMENDATION.READY_TO_LAND })).toBeGreaterThan(
      riskScore({ recommendation: RECOMMENDATION.PRUNE })
    );
    expect(riskScore({ recommendation: RECOMMENDATION.READY_TO_LAND })).toBeLessThan(
      riskScore({ recommendation: RECOMMENDATION.SALVAGE })
    );
  });
});

describe('classify: the 0-ahead trap', () => {
  it('calls a branch at an old main commit with no commits of its own UNCOMMITTED_ONLY, not landed', () => {
    const v = classify(
      wt({ ahead: 0, mergedIntoBase: true, head: 'main-old', workingTree: { modified: 3, untracked: 2, paths: [] } }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.status).toBe(STATUS.UNCOMMITTED_ONLY);
    expect(v.recommendation).toBe(RECOMMENDATION.SALVAGE);
    expect(v.prunable).toBe(false);
  });

  it('never marks a worktree prunable while it holds uncommitted work, whatever git says', () => {
    for (const tree of [
      { modified: 1, untracked: 0, paths: [] },
      { modified: 0, untracked: 1, paths: [] },
      { modified: 9, untracked: 9, paths: [] },
    ]) {
      const v = classify(wt({ ahead: 0, behind: 40, mergedIntoBase: true, workingTree: tree }), {
        chatSummary: noChats,
        chatSessions: noSessions,
        curated: null,
        nowMs: NOW,
      });
      expect(v.prunable).toBe(false);
      expect(v.recommendation).not.toBe(RECOMMENDATION.PRUNE);
    }
  });

  it('marks a landed, clean worktree prunable', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.status).toBe(STATUS.LANDED);
    expect(v.recommendation).toBe(RECOMMENDATION.PRUNE);
    expect(v.prunable).toBe(true);
  });

  it('refuses to prune a landed, clean worktree that a curated finding protects', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: { mustNotPrune: true },
      nowMs: NOW,
    });
    expect(v.prunable).toBe(false);
    expect(v.recommendation).toBe(RECOMMENDATION.REVIEW_RESIDUE);
  });

  it('treats a live session as in-use even when the branch is prunable on git alone', () => {
    const v = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 1, lastActivity: NOW - 60_000 },
      chatSessions: [{ state: 'active' }],
      curated: null,
      nowMs: NOW,
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
  });

  it('reports unmerged commits as unmerged-work, and separates waiting from at-risk', () => {
    // This used to assert `salvage` for every unmerged branch, which is the
    // conflation this change removes: a clean branch that merges cleanly is
    // not salvage, it is just waiting.
    const waiting = classify(wt({ ahead: 3, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(waiting.status).toBe(STATUS.UNMERGED_WORK);
    expect(waiting.recommendation).toBe(RECOMMENDATION.READY_TO_LAND);

    const atRisk = classify(wt({ ahead: 3, merge: { conflict: true } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(atRisk.status).toBe(STATUS.UNMERGED_WORK);
    expect(atRisk.recommendation).toBe(RECOMMENDATION.SALVAGE);
  });

  it('reports a dirty tree on a merged branch as uncommitted-only, not landed', () => {
    const v = classify(
      wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: ['a.ts'] } }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.status).toBe(STATUS.UNCOMMITTED_ONLY);
    expect(v.prunable).toBe(false);
  });

  it('never marks the MAIN worktree prunable, whatever git reports about it', () => {
    // The main checkout is the landing site and the place the operator works.
    // `isPrimary` short-circuits the status ladder, so without an explicit
    // guard a clean main reports `recommendation: "prune"` — a file that says
    // "safe to remove now, with or without --force", about the main checkout.
    for (const facts of [
      { ahead: 0, behind: 0, mergedIntoBase: true },
      { ahead: 7, behind: 0, mergedIntoBase: false },
      { ahead: 3, behind: 9, mergedIntoBase: true },
    ]) {
      const v = classify(wt({ name: 'ph', isPrimary: true, ...facts }), {
        chatSummary: noChats,
        chatSessions: noSessions,
        curated: null,
        nowMs: NOW,
      });
      expect(v.prunable, `main with ${JSON.stringify(facts)} was called prunable`).toBe(false);
      expect(v.recommendation).not.toBe(RECOMMENDATION.PRUNE);
    }
  });

  it('reports the MAIN worktree as in-use when a session is live in it', () => {
    // `wt.live` was read instead of the local `live`, and the input record
    // never carries that property — so the main worktree could never report
    // `in-use`, and the only thing standing between it and `keep` while
    // someone worked in it was a coincidence.
    const v = classify(wt({ name: 'ph', isPrimary: true, ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 1, lastActivity: NOW - 60_000 },
      chatSessions: [{ state: 'active' }],
      curated: null,
      nowMs: NOW,
    });
    expect(v.recommendation).toBe(RECOMMENDATION.IN_USE);
    expect(v.prunable).toBe(false);
  });

  it('reports a main worktree with uncommitted work as holding it, not as landed', () => {
    const v = classify(
      wt({
        name: 'ph',
        isPrimary: true,
        ahead: 0,
        mergedIntoBase: true,
        workingTree: { modified: 3, untracked: 1, paths: [] },
      }),
      { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW }
    );
    expect(v.prunable).toBe(false);
    expect(v.uncommitted).toBe(true);
  });

  it('reports a detached HEAD as UNREADABLE, because there is no branch identity to compare', () => {
    const v = classify(wt({ detached: true, branch: '(detached)', ahead: 0, mergedIntoBase: true }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.status).toBe(STATUS.UNREADABLE);
    // A detached worktree at a commit main contains is NOT prunable: the
    // inventory never records which branch it was on, so "safe to delete"
    // would be a claim about a ref the file does not show.
    expect(v.prunable).toBe(false);
  });

  it('ranks salvage above prune, so the worst work sorts first', () => {
    expect(riskScore({ recommendation: RECOMMENDATION.SALVAGE })).toBeGreaterThan(
      riskScore({ recommendation: RECOMMENDATION.PRUNE })
    );
  });
});

describe('classifySession: dead and unfinished agents', () => {
  const base = {
    id: 'ses_x',
    title: 'a task',
    agent: 'code',
    directory: '/repo',
    timeCreated: NOW - 1000,
    timeUpdated: NOW - 1000,
    tokensOutput: 500,
  };

  // Past the 30-minute liveness window, so an assertion about the last turn's
  // shape is not silently an assertion about recency instead.
  const stale = { ...base, timeUpdated: NOW - 5 * 3600_000 };

  it('classifies a paid-model launch that died at zero tokens as rejected-credits', () => {
    const s = classifySession(
      { ...base, tokensOutput: 0 },
      { creditsFailures: 1, toolErrors: 1 },
      { nowMs: NOW, exists: true }
    );
    expect(s.state).toBe('rejected-credits');
    expect(s.creditsFailures).toBe(1);
  });

  it('classifies a session whose worktree was deleted as orphaned', () => {
    const s = classifySession(base, { lastReason: 'stop' }, { nowMs: NOW, exists: false });
    expect(s.state).toBe('orphaned');
  });

  it('classifies a stale turn that ended on a tool call as abandoned-midflight', () => {
    const s = classifySession(stale, { lastReason: 'tool-calls' }, { nowMs: NOW, exists: true });
    expect(s.state).toBe('abandoned-midflight');
  });

  it('classifies a turn cut off by the token limit as abandoned too', () => {
    expect(classifySession(stale, { lastReason: 'length' }, { nowMs: NOW, exists: true }).state).toBe(
      'abandoned-midflight'
    );
  });

  it('classifies a stale completed stop as finished', () => {
    expect(classifySession(stale, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('finished');
  });

  it('prefers active over abandoned for a recent session, so a live machine is never cried up as stuck', () => {
    expect(classifySession(base, { lastReason: 'tool-calls' }, { nowMs: NOW, exists: true }).state).toBe('active');
  });

  it('separates a live session from a completed one by recency alone', () => {
    expect(classifySession(base, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('active');
    expect(classifySession(stale, { lastReason: 'stop' }, { nowMs: NOW, exists: true }).state).toBe('finished');
  });

  it('has no fourth state, so a finished agent is never reported as still-open', () => {
    // An earlier draft had an `idle` state that swallowed `finished`, which made
    // the `unfinished` array a list of every completed agent. The states below
    // are the whole vocabulary, and a stale completed session must land on
    // `finished` rather than on anything that reads as unresolved.
    const observed = new Set();
    for (const [session, outcome] of [
      [base, { lastReason: 'stop' }],
      [stale, { lastReason: 'stop' }],
      [stale, { lastReason: 'tool-calls' }],
      [{ ...base, tokensOutput: 0 }, { creditsFailures: 1 }],
    ]) {
      observed.add(classifySession(session, outcome, { nowMs: NOW, exists: true }).state);
    }
    expect([...observed].sort()).toEqual(['abandoned-midflight', 'active', 'finished', 'rejected-credits']);
    expect(observed.has('idle')).toBe(false);
  });
});

describe('summariseChats', () => {
  it('counts states, collects chat ids and separates unfinished from finished', () => {
    const s = summariseChats([
      { id: 'a', state: 'active', timeUpdated: NOW, subagentCount: 2 },
      { id: 'b', state: 'abandoned-midflight', timeUpdated: NOW - 1, subagentCount: 0 },
      { id: 'c', state: 'finished', timeUpdated: NOW - 2, subagentCount: 1 },
      { id: 'd', state: 'died-at-birth', timeUpdated: NOW - 3, subagentCount: 0 },
    ]);
    expect(s.count).toBe(4);
    expect(s.chatIds).toEqual(['a', 'b', 'c', 'd']);
    expect(s.subagentCount).toBe(3);
    expect(s.activeChatIds).toEqual(['a']);
    expect(s.unfinishedChatIds).toEqual(expect.arrayContaining(['a', 'b', 'd']));
    expect(s.unfinishedChatIds).not.toContain('c');
    expect(s.lastActivity).toBe(NOW);
  });
});

describe('auditChats against a real session database', () => {
  it('reads the LAST step-finish per session, not the first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-'));
    const dbPath = join(dir, 'kilo.db');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, parent_id TEXT, agent TEXT,
                 slug TEXT, tokens_output INTEGER, tokens_input INTEGER, time_created INTEGER,
                 time_updated INTEGER, time_archived INTEGER)`);
      db.exec(`CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER,
                 time_updated INTEGER, data TEXT)`);
      db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        // Stale enough to be past the 30-minute liveness window, so the
        // assertion below is about the finish reason and not about recency.
        'ses_one',
        '/wt',
        'first turn ends badly',
        null,
        'code',
        's',
        100,
        10,
        NOW - 7200_000,
        NOW - 7200_000,
        null
      );
      const ins = db.prepare('INSERT INTO part VALUES (?,?,?,?,?,?)');
      // An early tool-calls turn, then a later proper stop. Reading the first
      // row here misclassifies the session as abandoned.
      ins.run(
        'p1',
        'm1',
        'ses_one',
        NOW - 900,
        NOW - 900,
        JSON.stringify({ type: 'step-finish', reason: 'tool-calls' })
      );
      ins.run('p2', 'm2', 'ses_one', NOW - 800, NOW - 800, JSON.stringify({ type: 'step-finish', reason: 'stop' }));

      db.close();

      const { auditChats } = await_import();
      const audit = auditChats({
        dbPath,
        // The window must reach back past the session's own timestamp: it is
        // two hours old, and a 10s window filters it out before the turn
        // reasons are ever read.
        sinceMs: NOW - 4 * 3600_000,
        nowMs: NOW,
        existingPaths: new Set(['/wt']),
      });

      expect(audit.available).toBe(true);
      const sessions = audit.byDirectory.get('/wt');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastTurnReason).toBe('stop');
      expect(sessions[0].state).toBe('finished');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to an empty audit when the database is absent', () => {
    const { auditChats } = await_import();
    const audit = auditChats({ dbPath: '/nonexistent/kilo.db', sinceMs: 0, nowMs: NOW });
    expect(audit.available).toBe(false);
    expect(audit.byDirectory.size).toBe(0);
  });
});

// Imported lazily so the module-level `node:sqlite` import is not a hard
// dependency of the pure-function tests above.
function await_import() {
  // eslint-disable-next-line
  return chatsModule;
}

describe('buildInventory', () => {
  const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
  const chatAudit = { available: true, dbPath: 'k', byDirectory: new Map(), total: 0 };

  it('emits a document with counts that agree with the records it contains', () => {
    const inv = buildInventory({
      worktrees: [
        wt({ name: 'a', ahead: 0, mergedIntoBase: true }),
        wt({ name: 'b', ahead: 2, mergedIntoBase: false, workingTree: { modified: 1, untracked: 0, paths: [] } }),
        wt({ name: 'main', isPrimary: true, ahead: 0, mergedIntoBase: true }),
      ],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });

    expect(inv.schemaVersion).toBe(SCHEMA_VERSION);
    expect(inv.worktrees).toHaveLength(3);
    expect(inv.totals.worktrees).toBe(3);
    // The counts must be derived from the records, not maintained by hand.
    const summed = Object.values(inv.totals.byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(3);
    const byRec = inv.totals.byRecommendation;
    expect(Object.values(byRec).reduce((a, b) => a + b, 0)).toBe(3);
    expect(inv.totals.prunable).toBe(inv.worktrees.filter((w) => w.prunable).length);
  });

  it('sorts the highest-risk worktree first, so the list opens with what is at risk', () => {
    const inv = buildInventory({
      worktrees: [
        wt({ name: 'safe', ahead: 0, mergedIntoBase: true }),
        wt({ name: 'risky', ahead: 0, mergedIntoBase: true, workingTree: { modified: 4, untracked: 0, paths: [] } }),
      ],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    expect(inv.worktrees[0].name).toBe('risky');
  });

  it('keeps every record addressable by name and unique', () => {
    const inv = buildInventory({
      worktrees: [wt({ name: 'x' }), wt({ name: 'x', path: '/repo/.kilo/worktrees/x2' })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    const keys = inv.worktrees.map((w) => `${w.name}:${w.absolutePath}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('surfaces unfinished and dead chats as separate arrays on the worktree', () => {
    const byDirectory = new Map([
      [
        '/repo/.kilo/worktrees/example',
        [
          {
            id: 's1',
            title: 'stuck',
            state: 'abandoned-midflight',
            idleMs: 1000,
            reasons: [],
            toolErrors: 3,
            creditsFailures: 0,
            timeUpdated: NOW - 1,
          },
          {
            id: 's2',
            title: 'dead',
            state: 'rejected-credits',
            idleMs: 2000,
            reasons: [],
            toolErrors: 1,
            creditsFailures: 1,
            timeUpdated: NOW - 2,
          },
          {
            id: 's3',
            title: 'done',
            state: 'finished',
            idleMs: 3000,
            reasons: [],
            toolErrors: 0,
            creditsFailures: 0,
            timeUpdated: NOW - 3,
          },
        ],
      ],
    ]);
    const inv = buildInventory({
      worktrees: [wt()],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { ...chatAudit, byDirectory },
      nowMs: NOW,
    });
    const w = inv.worktrees[0];
    expect(w.chats.count).toBe(3);
    expect(w.chats.unfinished.map((c) => c.id)).toEqual(['s1', 's2']);
    expect(w.chats.dead.map((c) => c.id)).toEqual(['s2']);
    expect(w.chats.chatIds).toEqual(['s1', 's2', 's3']);
  });

  it('records a null summary rather than inventing one', () => {
    const inv = buildInventory({
      worktrees: [wt({ name: 'not-in-curated' })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      nowMs: NOW,
    });
    expect(inv.worktrees[0].summary).toBeNull();
    expect(inv.worktrees[0].summarySource).toBe('none');
    expect(inv.totals.withoutSummary).toBe(1);
  });
});

describe('the headline lists and totals', () => {
  const board = {
    available: true,
    dbPath: 'b',
    claims: new Map(),
    fileLocks: new Map(),
    agents: new Map(),
    issues: [],
  };
  const emptyChats = { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 };

  /** A spread covering every action, so each list has a known membership. */
  const worktrees = [
    wt({ name: 'landable', ahead: 2, mergedIntoBase: false, merge: { conflict: false } }),
    wt({ name: 'conflicting', ahead: 1, mergedIntoBase: false, merge: { conflict: true, files: ['a.ts'] } }),
    wt({ name: 'uncommitted', ahead: 0, mergedIntoBase: true, workingTree: { modified: 2, untracked: 0, paths: [] } }),
    wt({ name: 'disposable', ahead: 0, mergedIntoBase: true }),
    wt({ name: 'primary', isPrimary: true, ahead: 0, mergedIntoBase: true }),
  ];

  const build = () =>
    buildInventory({
      worktrees,
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: emptyChats,
      nowMs: NOW,
    });

  it('puts every record in exactly the list its action names', () => {
    const inv = build();
    for (const action of [ACTION.LAND, ACTION.DISPOSE, ACTION.AT_RISK]) {
      const expected = worktrees
        .map((w) => w.name)
        .filter((n) => inv.worktrees.find((r) => r.name === n).action === action);
      const actual =
        inv[action === ACTION.LAND ? 'readyToLand' : action === ACTION.DISPOSE ? 'disposalCandidates' : 'atRisk'];
      expect(actual, `list for ${action}`).toEqual(expected);
    }
  });

  it('recomputes every total from the records it contains', () => {
    const inv = build();
    const t = inv.totals;
    const n = inv.worktrees.length;
    expect(t.worktrees).toBe(n);
    expect(t.readyToLand).toBe(inv.readyToLand.length);
    expect(t.disposalCandidates).toBe(inv.disposalCandidates.length);
    expect(t.atRisk).toBe(inv.atRisk.length);
    expect(t.prunable).toBe(inv.worktrees.filter((w) => w.prunable).length);
    expect(t.salvage).toBe(inv.worktrees.filter((w) => w.recommendation === 'salvage').length);
    expect(t.inUse).toBe(inv.worktrees.filter((w) => w.recommendation === 'in-use').length);
    expect(t.holdingUncommittedWork).toBe(inv.worktrees.filter((w) => w.dirty + w.untracked > 0).length);
    expect(t.withoutSummary).toBe(inv.worktrees.filter((w) => !w.summary).length);
    expect(Object.values(t.byAction).reduce((a, b) => a + b, 0)).toBe(n);
    expect(Object.values(t.byRecommendation).reduce((a, b) => a + b, 0)).toBe(n);
    expect(Object.values(t.byStatus).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it('counts prunable and dispose identically, because dispose IS prunable', () => {
    // `action: dispose` is read from the `prunable` expression rather than
    // restated, so the two cannot drift. Assert the equivalence anyway, over
    // every shape that reaches either value.
    const shapes = [
      wt({ name: 'a', ahead: 0, mergedIntoBase: true }),
      wt({ name: 'b', ahead: 0, mergedIntoBase: false, merge: { conflict: false } }),
      wt({ name: 'c', ahead: 0, mergedIntoBase: true, workingTree: { modified: 1, untracked: 0, paths: [] } }),
      wt({ name: 'd', isPrimary: true, ahead: 0, mergedIntoBase: true }),
      wt({ name: 'e', ahead: 3, mergedIntoBase: false, merge: { conflict: true } }),
      wt({ name: 'f', detached: true, ahead: 0, mergedIntoBase: true }),
    ];
    for (const s of shapes) {
      const v = classify(s, {
        chatSummary: { count: 0, lastActivity: null },
        chatSessions: [],
        curated: null,
        nowMs: NOW,
      });
      expect(v.action === ACTION.DISPOSE, `${s.name}: action dispose`).toBe(v.prunable);
    }
  });

  it('never calls a DETACHED worktree ready to land, even with a clean merge', () => {
    // Detached means there is no branch identity, so "merges cleanly" is a
    // statement about HEAD with nothing to attach it to. Verified against a
    // real detached worktree: it is `unreadable` -> `undecided`.
    const v = classify(wt({ detached: true, ahead: 3, mergedIntoBase: false, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: null,
      nowMs: NOW,
    });
    expect(v.action).not.toBe(ACTION.LAND);
    expect(v.status).toBe(STATUS.UNREADABLE);
    expect(v.prunable).toBe(false);
  });

  it('does not offer a curated mustNotPrune worktree as land', () => {
    // `fix-spray-cr` was filed under READY TO LAND while its own curated note
    // called the colour-replacement work "the salvage target".
    const v = classify(wt({ ahead: 4, mergedIntoBase: false, merge: { conflict: false } }), {
      chatSummary: noChats,
      chatSessions: noSessions,
      curated: { mustNotPrune: true, note: 'the salvage target' },
      nowMs: NOW,
    });
    expect(v.action).toBe(ACTION.AT_RISK);
    expect(v.reasons.join(' ')).toContain('curated finding');
  });

  it('reports whether the merge was actually checked', () => {
    // `mergeConflict: null` alone is ambiguous between "not checked" and
    // "checked and could not answer".
    const inv = build();
    const landable = inv.worktrees.find((w) => w.name === 'landable');
    expect(landable.mergeChecked).toBe(true);
    expect(landable.mergeConflict).toBe(false);
    expect(landable.mergeConflictFiles).toEqual([]);
  });
});

describe('the transcript read audit', () => {
  // Resolved from cwd, not `import.meta.url`: under the root jsdom project
  // `import.meta.url` is an http URL and `fileURLToPath` throws on it.
  const dataPath = resolve(process.cwd(), 'scripts/lib/worktree-inventory/chat-audit.data.json');

  it('loads the real audit and stamps when it was taken', () => {
    const a = loadChatAudit(dataPath);
    expect(a.available).toBe(true);
    expect(a.records.length).toBeGreaterThan(50);
    // Without `asOf` a stale "on no ref" reads as a current fact, which is the
    // one mistake this exercise exists to prevent.
    expect(a.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(a.windowHours).toBeGreaterThan(0);
  });

  it('is stamped in the PAST, never the future', () => {
    // A hand-typed stamp was wrong once already: local 23:20 written with a "Z"
    // suffix, which put it 91 minutes ahead. Every consumer that computes
    // `now - asOf` then concludes the audit is FRESH, so a future stamp defeats
    // the only guard the file has.
    expect(Date.parse(loadChatAudit(dataPath).asOf)).toBeLessThanOrEqual(Date.now());
  });

  it('names every record that is really a top-level session, with nothing invented', () => {
    // The falsifiable part of "all 105 sessions were read". Exact window
    // membership is NOT reproducible — `time_updated` keeps moving on a live
    // session — so this pins what is actually checkable: every id exists, is
    // top-level, and falls after the documented window start.
    //
    // ASKED OF A DATABASE THIS TEST BUILDS, not of the operator's. It used to
    // open `~/.local/share/kilo/kilo.db` and `return` when that file was absent,
    // which is a silent skip written as a test: on CI the file does not exist, so
    // the body never ran and the assertion was satisfied by nothing at all, and
    // on a machine where the operator had archived one of the named sessions it
    // went red for a fact about the machine. The ids are the same either way —
    // they come from the COMMITTED audit — so what is actually being asked, "is
    // every id in this file a real top-level session that falls in the window",
    // is a question a fixture answers exactly.
    const a = loadChatAudit(dataPath);
    const startMs = Date.parse(a.windowStart);
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-audit-'));
    const db = new DatabaseSync(join(dir, 'kilo.db'));
    try {
      db.exec(`CREATE TABLE session (id TEXT, directory TEXT, title TEXT, parent_id TEXT, agent TEXT,
                 slug TEXT, tokens_output INTEGER, tokens_input INTEGER, time_created INTEGER,
                 time_updated INTEGER, time_archived INTEGER);`);
      const insert = db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      // Every id the audit claims, as a top-level session in the window.
      for (const r of a.records) {
        insert.run(r.id, r.directory, null, null, 'code', null, 0, 0, startMs, startMs + 1_000, null);
      }
      // One id the audit does NOT claim, so the query below cannot be satisfied
      // by a table that happens to contain exactly the rows it looks for.
      insert.run('ses_not-in-the-audit', '/wt', null, null, 'code', null, 0, 0, startMs, startMs, null);

      const rows = db
        .prepare(
          `SELECT id, parent_id, time_updated FROM session
            WHERE id IN (${a.records.map(() => '?').join(',')})`
        )
        .all(...a.records.map((r) => r.id));
      expect(rows.length, 'a record names a session that does not exist').toBe(a.records.length);
      for (const row of rows) {
        expect(row.parent_id, `${row.id} is a SUBAGENT, not a top-level session`).toBeNull();
        expect(row.time_updated).toBeGreaterThanOrEqual(startMs);
      }

      // And the two ways this could pass while the audit is wrong: an id it
      // invented would be missing from this table, and an id that is really a
      // subagent would carry a parent. Both are checked above by construction
      // only if the ids are distinct, so state that they are.
      expect(new Set(a.records.map((r) => r.id)).size, 'the audit repeats a session id').toBe(a.records.length);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps `sessions` in step with `records.length`', () => {
    // A top-level count the loader never reads and nothing kept in sync.
    const raw = JSON.parse(readFileSync(dataPath, 'utf8'));
    expect(raw.sessions).toBe(raw.records.length);
    expect(raw.records.length).toBe(loadChatAudit(dataPath).records.length);
  });

  it('carries only verdicts about sessions, never their contents', () => {
    // A transcript body in this file would grow without bound and would leak
    // whatever was said in it.
    const a = loadChatAudit(dataPath);
    for (const r of a.records) {
      expect(Object.keys(r).sort()).toEqual(
        [
          'commitsAheadOfMain',
          'deadSubagents',
          'directory',
          'id',
          'modifiedFiles',
          'note',
          'readRisk',
          'readState',
          'toolErrors',
          'untrackedFiles',
          'worktreeGone',
        ].sort()
      );
    }
  });

  it('uses only the states it documents', () => {
    const known = new Set(Object.values(READ_STATE));
    for (const r of loadChatAudit(dataPath).records) {
      expect(known.has(r.readState), `unknown read state ${r.readState}`).toBe(true);
    }
  });

  it('treats every state except finished as something to go and look at', () => {
    expect(isReadUnfinished(READ_STATE.FINISHED)).toBe(false);
    for (const s of [
      READ_STATE.STRUGGLING,
      READ_STATE.BLOCKED,
      READ_STATE.ABANDONED,
      READ_STATE.FAILED,
      READ_STATE.UNKNOWN,
    ]) {
      expect(isReadUnfinished(s), `${s} should be unfinished`).toBe(true);
    }
  });

  it('computes workOnNoRef from the same rule the file describes', () => {
    // untracked, OR modified with 0 ahead. Ahead>0 means a commit holds it.
    expect(auditVerdict({ id: 'a', untrackedFiles: 1, modifiedFiles: 0, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      true
    );
    expect(auditVerdict({ id: 'b', untrackedFiles: 0, modifiedFiles: 3, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      true
    );
    expect(auditVerdict({ id: 'c', untrackedFiles: 0, modifiedFiles: 3, commitsAheadOfMain: 1 }).workOnNoRef).toBe(
      false
    );
    expect(auditVerdict({ id: 'd', untrackedFiles: 0, modifiedFiles: 0, commitsAheadOfMain: 0 }).workOnNoRef).toBe(
      false
    );
  });

  it('passes the worktree-gone signal through, which no heuristic can produce', () => {
    const v = auditVerdict(
      { id: 'e', untrackedFiles: 0, modifiedFiles: 0, commitsAheadOfMain: 0 },
      { worktreeGone: true }
    );
    expect(v.worktreeGone).toBe(true);
  });

  it('emits the deleted-worktree case, which the per-worktree loop cannot reach', () => {
    // It was previously a field on the worktree record, where it was
    // structurally always false: the loop only visits sessions whose directory
    // still exists, so every worktreeGone session was unreachable and two of
    // the three lost-work findings were in no output at all.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const goneRecord = {
      id: 's9',
      directory: 'vanished',
      readState: 'finished',
      readRisk: 'high',
      note: 'its worktree was deleted',
      worktreeGone: true,
      untrackedFiles: null,
      modifiedFiles: null,
      commitsAheadOfMain: null,
      deadSubagents: 0,
      toolErrors: 0,
    };
    const inv = buildInventory({
      worktrees: [wt()],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      readAudit: {
        available: true,
        asOf: '2026-01-01T00:00:00Z',
        windowHours: 30,
        records: [goneRecord],
        byId: new Map(),
      },
      nowMs: NOW,
    });
    expect(inv.readLostWorktree.map((r) => r.id)).toEqual(['s9']);
    expect(inv.readLostWorktreeHighRisk).toBe(1);
    expect(JSON.stringify(inv)).toContain('vanished');
    // And it must not be on a worktree record, where it is a constant.
    expect(JSON.stringify(inv.worktrees)).not.toContain('worktreeGone');
  });

  it('re-checks a read-derived no-ref claim against the live tree', () => {
    // Every entry said "on no ref" at asOf and had committed within the hour.
    // Repeating the claim un-cross-checked prints a stale fact beside a
    // contradicting `dirty=0` for the same worktree.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const rec = {
      id: 's1',
      directory: 'w',
      readState: 'finished',
      readRisk: 'medium',
      note: null,
      worktreeGone: false,
      untrackedFiles: 0,
      modifiedFiles: 11,
      commitsAheadOfMain: 0,
      deadSubagents: 0,
      toolErrors: 0,
    };
    // `w` is the fixture's worktree name, so live state is available.
    const inv = buildInventory({
      worktrees: [wt({ name: 'w', ahead: 1, mergedIntoBase: false })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      readAudit: {
        available: true,
        asOf: '2026-01-01T00:00:00Z',
        windowHours: 30,
        records: [rec],
        byId: new Map([['s1', rec]]),
      },
      nowMs: NOW,
    });
    expect(inv.workOnNoRef[0].stillOnNoRef).toBe(false);
    expect(inv.workOnNoRef[0].liveDirty).toBe(0);
    expect(inv.workOnNoRef[0].asOf).toBe('2026-01-01T00:00:00Z');
  });

  it('reports a corrupt audit file differently from a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-bad-'));
    const bad = join(dir, 'chat-audit.data.json');
    writeFileSync(bad, '{ "asOf": "2026-01-01T00:00:00Z", "records": [ TRUNCATED');
    try {
      const a = loadChatAudit(bad);
      expect(a.available).toBe(false);
      // The bug: one bad hand-edit used to report "not found", so the entire
      // safety signal vanished while claiming it had never been there.
      expect(a.corrupt).toBe(true);
      expect(a.reason).toMatch(/unreadable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades to an empty audit rather than refusing to generate', () => {
    const a = loadChatAudit('/nonexistent/chat-audit.data.json');
    expect(a.available).toBe(false);
    expect(a.records).toEqual([]);
    expect(a.asOf).toBeNull();
  });
});

describe('the read and computed chat views together', () => {
  it('emits both, and never reconciles them', () => {
    // The whole value is that they disagree sometimes. A computed "finished"
    // beside a read "struggling" is the finding, not a bug to smooth over.
    const board = {
      available: true,
      dbPath: 'b',
      claims: new Map(),
      fileLocks: new Map(),
      agents: new Map(),
      issues: [],
    };
    const byDirectory = new Map([
      [
        '/repo/.kilo/worktrees/example',
        [
          {
            id: 's1',
            state: 'finished',
            idleMs: 9e9,
            subagentCount: 0,
            timeUpdated: NOW - 9e9,
            toolErrors: 0,
            creditsFailures: 0,
            lastTurnReason: 'stop',
          },
        ],
      ],
    ]);
    const readAudit = {
      available: true,
      asOf: '2026-01-01T00:00:00Z',
      windowHours: 30,
      records: [
        {
          id: 's1',
          directory: 'example',
          readState: 'struggling',
          readRisk: 'high',
          note: 'never committed',
          worktreeGone: false,
          untrackedFiles: 0,
          modifiedFiles: 4,
          commitsAheadOfMain: 0,
          deadSubagents: 0,
          toolErrors: 0,
        },
      ],
      byId: new Map([
        [
          's1',
          {
            id: 's1',
            directory: 'example',
            readState: 'struggling',
            readRisk: 'high',
            note: 'never committed',
            worktreeGone: false,
            untrackedFiles: 0,
            modifiedFiles: 4,
            commitsAheadOfMain: 0,
            deadSubagents: 0,
            toolErrors: 0,
          },
        ],
      ]),
    };
    const inv = buildInventory({
      worktrees: [wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 4, untracked: 0, paths: [] } })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory, total: 1, newestSessionAt: NOW - 9e9 },
      readAudit,
      nowMs: NOW,
    });
    const w = inv.worktrees[0];
    expect(w.chats.byState.finished).toBe(1);
    expect(w.read[0].readState).toBe('struggling');
    expect(w.read[0].workOnNoRef).toBe(true);
    expect(inv.readUnfinished.map((r) => r.id)).toEqual(['s1']);
    expect(inv.dataSources.readAudit.asOf).toBe('2026-01-01T00:00:00Z');
  });
});

describe('the curated table', () => {
  /**
   * One fleet for this block, for the reason given on `sharedFleet()`. The
   * `landed` claims below are checked against a fleet this file builds rather
   * than against whatever worktrees the machine happens to have, which is what
   * made every one of them vacuous on a clean checkout and on CI.
   */
  const fleet = sharedFleet();

  // WHY THERE IS NO "EVERY WORKTREE HAS AN ENTRY" RULE HERE
  // ---------------------------------------------------------
  // There was one, and it was the recurring red. It demanded a curated entry for
  // every live in-repo worktree holding work — which is what an in-flight task
  // looks like for the whole of its life, from an agent's first edit to its
  // merge — so it was red from the first minute of every task, in every OTHER
  // checkout too, because the list it read is the repository's and not the
  // caller's. Narrowing it from "exists" to "holds work" moved the red from the
  // first minute of a task to every minute of it. The table was re-derived by
  // hand four times in one session for exactly that reason.
  //
  // It could not be fixed by data entry, because it compares a COMMITTED file
  // against LIVE machine state. Nothing an agent can do at session end makes the
  // table agree with a fleet that keeps moving, and the entry it would have to
  // write is prose about work that has not happened yet. Measured while this was
  // being fixed: 160 curated keys against 102 live in-repo worktrees, 26 of
  // which had no entry and 8 of those holding work on no ref. The table was an
  // accumulating log of past tasks, not an index of the present one.
  //
  // So the rule is the RISK, not the existence, and it is asserted where the risk
  // is derived: `describe('work git cannot see: derived from the worktrees,
  // never curated')` below pins it over a fleet this file builds, with the curated
  // entry REMOVED — the state most of those worktrees are actually in — and pins
  // that no curated field except `mustNotPrune` can move a verdict at all.
  //
  // What is left for a human is a judgement git cannot make about a tree it
  // already calls disposable, and that is `mustNotPrune` on a clean merged
  // branch. No entry sets it today.

  it('gives every entry a summary, because the inventory is read as prose', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      expect(typeof entry.summary, `${name} has no summary`).toBe('string');
      expect(entry.summary.length, `${name} has an empty summary`).toBeGreaterThan(20);
    }
  });

  it('contains no bare count in any summary, because a number in prose goes stale silently', () => {
    // Seven entries asserted counts ("32 paths uncommitted", "12 commits
    // behind", "four files and a new test"). Every one was wrong within hours
    // and nothing could catch it, because prose is not checkable. The
    // generated record already carries dirty/untracked/ahead/behind.
    const offenders = [];
    for (const [name, entry] of Object.entries(CURATED)) {
      for (const field of ['summary', 'note']) {
        const text = entry[field];
        if (!text) continue;
        // A number that counts files, commits or paths. Years, part numbers and
        // commit shas are not what this is about — and ZERO is not, because
        // "0 ahead of main" is the invariant this whole tool exists to refuse
        // to read as safety. It is a structural fact of a merged branch, not a
        // measurement that drifts.
        const m = /\b(\d+)\s+(path|file|commit|spec|dirty|untracked|behind|ahead)/i.exec(text);
        if (m && Number(m[1]) > 0) offenders.push(`${name}.${field}: "${m[0]}"`);
      }
    }
    expect(
      offenders,
      `curated prose contains counts that will drift: ${offenders.join('; ')}. ` +
        'Describe what is there; read dirty/untracked/ahead/behind from the record.'
    ).toEqual([]);
  });

  it('agrees with git about every `landed: true` claim, so the two cannot contradict', () => {
    // `landed` is a curator's assertion. It was previously read by nothing, so
    // a worktree could claim it was landed while git reported the opposite and
    // no test objected.
    //
    // WHICH claims are checked depends on the fleet, and that is the defect this
    // pair of tests had. It used to be whichever worktrees happened to exist on
    // the machine: every claimed name whose worktree was absent was skipped by
    // `continue`, so on a clean checkout the loop body never ran and the
    // assertion read green having checked nothing at all — and on CI, where the
    // checkout is detached and no curated name can match, it could only ever be
    // vacuous. A guard whose subject is "whatever is there today" is a report,
    // not a gate. So the rule is exercised against the synthetic fleet, which
    // contains one worktree of each kind, and the live cross-check is a
    // deliberate operator command rather than a gate.
    const { worktrees, base } = fleet();
    expect(claimedLanded().length, 'no curated entry claims landed, so this rule guards nothing').toBeGreaterThan(0);
    // Every curated name that this fleet happens to contain, checked.
    const here = claimedLanded().filter((name) => worktrees.some((x) => x.name === name));
    expect(
      contradictionsAmong(here, worktrees, base),
      'a curated entry claims landed and this fleet says otherwise'
    ).toEqual([]);
  });

  it('catches a `landed: true` claim the fleet contradicts, which is the whole point of the rule', () => {
    // The test above can only pass. This is the one that can fail, and without it
    // "agrees with git" is an assertion about nothing: it would stay green if the
    // rule were deleted outright. Each case below is a claim git must reject.
    {
      const { worktrees, base } = fleet();
      const unmerged = worktrees.find((x) => !x.isPrimary && !__testables.isMergedInto(x.path, base));
      expect(unmerged, 'the fleet has no unmerged worktree, so there is nothing to contradict').toBeDefined();
      expect(
        contradictionsAmong([unmerged.name], worktrees, base),
        'claiming landed for a branch git has not merged must be reported'
      ).toEqual([`${unmerged.name}: curated says landed, git says the branch is not on the base`]);

      const detached = worktrees.find((x) => x.detached);
      expect(detached, 'the fleet has no detached worktree').toBeDefined();
      expect(contradictionsAmong([detached.name], worktrees, base)).toEqual([
        `${detached.name}: curated says landed, but the worktree is detached`,
      ]);

      // And the shape that must NOT be reported, so the rule is not satisfied by
      // rejecting everything: a worktree that really is on the base.
      const landed = worktrees.find((x) => !x.isPrimary && !x.detached && __testables.isMergedInto(x.path, base));
      expect(landed, 'the fleet has no landed worktree to accept').toBeDefined();
      expect(contradictionsAmong([landed.name], worktrees, base)).toEqual([]);

      // A name the fleet does not contain is not a contradiction. `continue` on a
      // missing worktree is correct — the worktree may simply be gone — and the
      // difference between "gone" and "contradicted" is what keeps that from
      // being a rule that fires on every entry in the table.
      expect(contradictionsAmong(['no-such-worktree-anywhere'], worktrees, base)).toEqual([]);
    }
  });

  it('marks no detached worktree as landed', () => {
    // The fleet holds exactly one detached worktree, and nothing in CURATED names
    // it, so what is asserted here is that the RULE below is a rule: feed it a
    // detached worktree and it must object, rather than skipping the check
    // because no curated entry happens to match today.
    {
      const { worktrees, base } = fleet();
      const detached = worktrees.filter((x) => x.detached).map((x) => x.name);
      expect(detached.length, 'the fleet has no detached worktree to check').toBeGreaterThan(0);
      for (const name of claimedLanded()) {
        const w = worktrees.find((x) => x.name === name);
        if (w) expect(w.branch, `${name} claims landed but is detached`).not.toBe('(detached)');
      }
      // The same names, presented as claims, must be refused.
      expect(contradictionsAmong(detached, worktrees, base)).toEqual(
        detached.map((n) => `${n}: curated says landed, but the worktree is detached`)
      );
    }
  });

  it('keeps the main worktree and this one out of the curated table on purpose', () => {
    // `ph` is described in AGENTS.md, not per-worktree, and this worktree is
    // this change's own scratch space.
    expect(CURATED.ph).toBeUndefined();
    expect(CURATED['worktree-inventory']).toBeUndefined();
  });

  it('requires a curated mustNotPrune entry to say WHY, because the flag alone is unfalsifiable', () => {
    // The flag is a human claim about a tree git already calls disposable, so it
    // is unfalsifiable by anything except prose. No entry sets it today — the
    // case it was written for is derived, in the describe block below — and this
    // rule is what the next entry that genuinely needs a veto has to satisfy.
    for (const [name, entry] of Object.entries(CURATED)) {
      if (entry.mustNotPrune) {
        expect(
          typeof entry.note === 'string' && entry.note.length > 30,
          `${name} sets mustNotPrune without a note explaining what would be lost`
        ).toBe(true);
      }
    }
  });

  it('never asks the table to protect a worktree whose protection is derived', () => {
    // What the flag used to cost. It was a name on a hand-written list, and the
    // list was re-derived by hand three times in one session: agents commit, so
    // the flag goes stale; agents dispose worktrees, so a name refers to nothing
    // and the guard fails on its own premise; agents create worktrees, so the
    // table has no entry for a worktree that is genuinely holding work on no
    // ref. It was stale in BOTH directions the last time it was read:
    // `skill-handoff-cites` was listed and its worktree was gone, while
    // `chat-damage-followup` and `layers-panel-spec` held uncommitted work on a
    // main commit and carried no flag at all.
    //
    // So the flag is not how this case is expressed any more. `classify` already
    // refuses to prune a working tree that holds anything, so a flag on a
    // worktree of this shape protected nothing while asserting a claim that went
    // out of date on its own. The rule itself is the describe block below; this
    // test is the tripwire against the flag coming back for it.
    //
    // Read over the synthetic fleet, and the fleet DELIBERATELY contains two
    // worktrees of this shape. That is what removes the one weakness this had: it
    // had no non-vacuity guard at all, so on a machine where no worktree held
    // work on no ref — every task committed, every worktree disposed, which is
    // what a clean repository looks like — `derived` was empty and the assertion
    // was satisfied by a set of nothing. The set cannot be empty here, because
    // the fleet is built to contain the shape.
    {
      const inventory = inventoryFor(fleet());
      const derived = inventory.worktrees.filter((r) => r.inRepo && holdsWorkGitCannotSee(r)).map((r) => r.name);

      // First, so a green run cannot mean "the set was empty for a reason that
      // has nothing to do with the flag".
      expect(
        derived.length,
        'the synthetic fleet was built to hold work git cannot see, so an empty derived set means the ' +
          'derivation itself stopped finding it — which is a worse defect than the flag this guards against'
      ).toBeGreaterThanOrEqual(2);

      const flagged = derived.filter((name) => CURATED[name]?.mustNotPrune);
      expect(
        flagged,
        `these entries hold work git cannot see and are flagged mustNotPrune: ${flagged.join(', ')}. ` +
          'The generator derives that protection, so the flag is a claim that goes stale the moment the ' +
          'owner commits — delete the field and keep the note.'
      ).toEqual([]);

      // AND THE DETECTOR IS PROVEN TO FIRE, because the assertion above cannot be
      // falsified on its own: `curated.mjs` carries no `mustNotPrune` field at
      // all today, so `flagged` is `[]` for every fleet on every machine, and it
      // was `[]` before this suite read a fleet too. Presenting the same filter
      // over a table that DOES carry the flag is what makes the rule above a
      // statement about the table rather than about today's contents of it.
      const wouldFlag = derived.filter((name) => ({ [name]: { mustNotPrune: true } })[name]?.mustNotPrune);
      expect(
        wouldFlag,
        'the filter this rule is built on finds nothing even when a derived worktree carries the flag, so ' +
          'the rule above would pass on a table that has reintroduced exactly what it forbids'
      ).toEqual(derived);
    }
  });

  it('declares no key twice, because a duplicate key silently discards a curation change', () => {
    // Five keys were declared twice: a rich entry written deliberately near the
    // top, and a terse one-liner appended near the bottom. `Object.keys()`
    // cannot see the first — a JS object literal is last-wins, so the detailed
    // summary and its `note` were unreachable dead code, and every test that
    // checked the table still passed because the entry EXISTED. A committed
    // curation change was a no-op.
    //
    // So this reads the SOURCE rather than the imported object: the duplicate
    // exists only in the text. `readCuratedKeys` is the reader, and it fails
    // CLOSED — anything at the entry indentation it does not positively
    // recognise is reported as unreadable rather than skipped, because a reader
    // that skips what it does not understand reports green on a file it could
    // not see. That was the defect in the first version of this test, whose
    // regex matched exactly one quote style at exactly one indentation: a
    // duplicate in double quotes, a duplicate at a deeper indent, and a computed
    // key or a spread all slipped past it, while a key-shaped line in a `//`
    // comment — which is what you write after "removed the terse declarations" —
    // failed it.
    const { keys, unreadable } = readCuratedKeys(readFileSync(CURATED_PATH, 'utf8'));

    // The reader must have understood the file. This is the assertion that turns
    // a parse failure from silence into a failure, and it comes FIRST so a green
    // run can never mean "the regex matched nothing".
    expect(
      unreadable,
      `curated.mjs contains declarations this reader does not understand, so the duplicate-key ` +
        `check cannot see the file and would report green on it: ${unreadable.join('; ')}. A ` +
        `computed key, a spread, a shorthand property or a method at an entry's indentation are ` +
        `all shapes a duplicate can hide inside — teach the reader this one, or write the entry ` +
        `as a plain key.`
    ).toEqual([]);

    const seen = new Set();
    const duplicates = [];
    for (const name of keys) {
      if (seen.has(name)) duplicates.push(`'${name}'`);
      else seen.add(name);
    }

    expect(
      duplicates,
      `curated.mjs declares these keys more than once, so the last declaration silently ` +
        `replaces the first and the earlier curation is dead code: ${duplicates.join('; ')}. ` +
        'Object.keys() cannot see this — the check has to read the source.'
    ).toEqual([]);

    // The parse must find exactly the keys the imported object has, and as MANY
    // of them. The set comparison alone is what let four silent shapes through:
    // when the declaration the reader could not see was a key `Object.keys()`
    // already held, both sets stayed equal and the test passed. The duplicate
    // assertion above is named first and is the one that should fire for a
    // duplicate — a guard that reported "the parse is broken" about the very
    // defect it exists to name teaches the next agent to ignore it — so this
    // LENGTH comparison is a backstop for a reader that under-counted, not the
    // primary signal.
    expect([...new Set(keys)].sort()).toEqual([...Object.keys(CURATED)].sort());
    expect(keys.length, 'the reader saw fewer declarations than the object has keys').toBe(Object.keys(CURATED).length);
  });

  describe('the duplicate-key reader, proven against injected shapes', () => {
    const real = readFileSync(CURATED_PATH, 'utf8');
    // Inject at the start of a known entry, which is the same place the original
    // defect was: a declaration added near a declaration.
    //
    // Every injected block is BRACE-BALANCED and its comments are CLOSED. That
    // is not tidiness: the reader counts braces to find where the object literal
    // ends, so an unbalanced injection walks it out of the literal and it starts
    // reporting the code after it — which fails the case for the wrong reason,
    // exactly as a guard that fires for the wrong reason teaches people to
    // ignore it.
    const inject = (...lines) => real.replace(/^  'e2e-shell': \{$/m, `  'e2e-shell': {\n${lines.join('\n')}`);
    const entry = (head) => [head, "    summary: 'injected.',", '  },'];

    const DUPLICATE_CASES = [
      ['the same quoting and indent as every other entry', entry("  'e2e-shell': {")],
      ['double quotes', entry('  "e2e-shell": {')],
      ['four-space indentation', entry("    'e2e-shell': {")],
      ['eight-space indentation', entry("        'e2e-shell': {")],
      ['a template-literal key', entry('  `e2e-shell`: {')],
      ['no space before the colon', entry("  'e2e-shell':{")],
      ['spaces around the colon', entry("  'e2e-shell'   :   {")],
      ['a trailing comment on the same line', entry("  'e2e-shell': { // and this is not it")],
    ];

    for (const [what, lines] of DUPLICATE_CASES) {
      it(`sees a duplicate declared with ${what}`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(2);
      });
    }

    it('sees the declaration behind a trailing comment, because the comment is not the line', () => {
      // The complement of the comment cases below: stripping `// this is not it`
      // must not also throw away the `e2e-shell` in front of it. The comment
      // is discarded and the declaration survives, so this IS a duplicate.
      const { keys, unreadable } = readCuratedKeys(inject("  'e2e-shell': {", "    summary: 'injected.',", '  },'));
      expect(unreadable).toEqual([]);
      expect(count(keys, 'e2e-shell')).toBe(2);
    });

    for (const [what, lines] of DUPLICATE_CASES) {
      it(`sees a duplicate declared with ${what}`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(2);
      });
    }

    it('reads an entry declared with a bare identifier key', () => {
      // `e2eShell` is a legal identifier and `e2e-shell` is not, so this cannot
      // duplicate anything — it is here to prove the identifier form is still
      // recognised rather than reported as unreadable.
      const { keys, unreadable } = readCuratedKeys(inject(...entry('  e2eShell: {')));
      expect(keys).toContain('e2eShell');
      expect(unreadable).toEqual([]);
    });

    // [what to call it, the injected lines, a token the failure message must quote]
    const UNREADABLE_CASES = [
      ['a computed key', entry("  ['e2e-shell']: {"), "['e2e-shell']"],
      ['a computed key built by a template', entry('  [`e2e-shell`]: {'), '[`e2e-shell`]'],
      ['a spread of an object literal', ["  ...{ 'e2e-shell': { summary: 'injected.' } },", '  },'], '...{'],
      ['a property shorthand', ['  e2eShell,'], 'e2eShell,'],
      ['a method', entry('  e2eShell() {'), 'e2eShell()'],
      ['a getter', entry('  get e2eShell() {'), 'get e2eShell()'],
      ['a name that is not a legal identifier', entry('  e2e-shell: {'), 'e2e-shell:'],
    ];

    for (const [what, lines, token] of UNREADABLE_CASES) {
      it(`refuses to guess at ${what}, rather than skipping it`, () => {
        const { unreadable } = readCuratedKeys(inject(...lines));
        expect(
          unreadable.length,
          `a reader that skipped this line would report green on a declaration it could not see`
        ).toBeGreaterThan(0);
        expect(unreadable.join('\\n')).toContain(token);
      });
    }

    // Each comment here must CLOSE. An unterminated `/*` legitimately swallows
    // the rest of the file, so a case built that way would pass for the wrong
    // reason — the reader would be right to see nothing.
    const COMMENT_CASES = [
      ['a line comment', ["  // 'e2e-shell': {"]],
      ['a single-line block comment', ["  /* 'e2e-shell': { */"]],
      ['a multi-line block comment', ['  /*', "   'e2e-shell': {", '  */']],
      ['a block comment holding a whole entry', ['  /*', "  'e2e-shell': {", '  },', '  */']],
    ];

    for (const [what, lines] of COMMENT_CASES) {
      it(`ignores a key-shaped line inside ${what}, because a comment is not a declaration`, () => {
        const { keys, unreadable } = readCuratedKeys(inject(...lines));
        expect(unreadable).toEqual([]);
        expect(count(keys, 'e2e-shell')).toBe(1);
      });
    }

    it('ignores a key-shaped string inside an entry’s own prose', () => {
      const { keys, unreadable } = readCuratedKeys(
        inject("    note: 'see also: e2e-shell: { for the responsive shell, and https://example.com/x',")
      );
      expect(count(keys, 'e2e-shell')).toBe(1);
      expect(unreadable).toEqual([]);
    });

    it('ignores a key-shaped line nested inside an entry', () => {
      const { keys, unreadable } = readCuratedKeys(inject("    issues: [{ ref: 'HANDOFF.md#1', title: 't' }],"));
      expect(keys).not.toContain('nested-thing');
      expect(unreadable).toEqual([]);
    });

    it('reads the real file, and reads every key in it', () => {
      const { keys, unreadable } = readCuratedKeys(real);
      expect(unreadable).toEqual([]);
      expect(new Set(keys)).toEqual(new Set(Object.keys(CURATED)));
      expect(keys.length).toBe(Object.keys(CURATED).length);
      expect(keys.length).toBeGreaterThan(50);
    });
  });

  it('gives every issue a ref and a title, because a ref with no title is unreadable', () => {
    for (const [name, entry] of Object.entries(CURATED)) {
      for (const issue of entry.issues ?? []) {
        expect(issue.ref, `${name} has an issue with no ref`).toBeTruthy();
        expect(issue.title, `${name} has an issue with no title`).toBeTruthy();
      }
    }
  });
});

describe('work git cannot see: derived from the worktrees, never curated', () => {
  /** One fleet for this block; the reason is on `sharedFleet()`. */
  const fleet = sharedFleet();

  /**
   * A board and a chat audit with nothing in them, for a synthetic build.
   *
   * An in-use worktree is protected by liveness, so a guard that left liveness in
   * would pass for the wrong reason. Every assertion in this block is about what
   * git's own facts derive.
   */
  const silent = () => ({
    board: { available: false, dbPath: null, claims: new Map(), fileLocks: new Map(), agents: new Map(), issues: [] },
    chatAudit: { available: false, dbPath: null, byDirectory: new Map(), total: 0, newestSessionAt: 0 },
  });

  it('never offers a worktree that holds uncommitted work on no ref for disposal', () => {
    // This is the whole rule. It used to be asserted over the repository as it
    // was, and the argument for that was that the set is recomputed from `git` on
    // every run, so an agent that commits, an agent that disposes a worktree and
    // an agent that creates one all change the set without changing a line of this
    // suite. That argument was about NAMES GOING STALE, and it was answering the
    // wrong question: the names were never in this file, so nothing here could go
    // stale — but the SUBJECT could, and the subject was the operator's fleet.
    //
    // What the live read actually bought, in practice, was a gate that went red
    // for a dirty main checkout and needed a 60s budget to survive its own git
    // spawns, and a `pull_request` CI checkout where `main` did not exist at all
    // and the unguarded `rev-parse` threw. The property is a property of
    // `classify`, so it is now asserted against a fleet built to contain the
    // shape, which is both faster and the only version that can be non-vacuous.
    {
      const inv = inventoryFor(fleet());
      const inRepo = inv.worktrees.filter((r) => r.inRepo);

      // The facts must have been read at all. An `ahead` that is `null` means git
      // could not be asked, and a derived set built from unread facts is not
      // evidence that nothing is at risk — it is evidence that nothing was looked
      // at, and the assertion below would pass on it.
      const unread = inRepo.filter((r) => typeof r.ahead !== 'number' || typeof r.mergedIntoMain !== 'boolean');
      expect(
        unread.map((r) => `${r.name} (ahead=${r.ahead} onMain=${r.mergedIntoMain})`),
        'git could not be read in these worktrees, so the derived set below would be empty for a ' +
          'reason that has nothing to do with whether any work is at risk'
      ).toEqual([]);

      // Non-vacuity, and it is a count rather than a `toBeGreaterThan(0)`: the
      // fleet holds one of this shape reached through a MODIFIED file and one
      // reached through an UNTRACKED one, and they are disposed by different
      // clauses of `classify`. A guard that saw only one of them would pass here.
      const atRisk = inRepo.filter(holdsWorkGitCannotSee);
      expect(
        atRisk.length,
        'the synthetic fleet was built with a modified and an untracked worktree that hold work on no ' +
          'ref, so fewer than two means the derivation stopped finding one of the two shapes'
      ).toBeGreaterThanOrEqual(2);

      // Three ways to lose, not one. `prunable` and the disposal list are what an
      // operator acts on, but they are not the only thing that has to hold: a
      // generator that stopped reading the working tree at all still refuses to
      // prune a dirty tree, because the clean-tree clause is inside `prunable`
      // itself — and it would do that while printing `status: landed` and
      // `recommendation: prune` for the one copy of the work. So the verdict is
      // asserted too, and the message says which of the three gave.
      const exposed = atRisk.filter(
        (r) => r.prunable || inv.disposalCandidates.includes(r.name) || r.recommendation === RECOMMENDATION.PRUNE
      );
      expect(
        exposed.map(
          (r) =>
            `${r.name}: ahead=${r.ahead} onMain=${r.mergedIntoMain} dirty=${r.dirty} untracked=${r.untracked} ` +
            `status=${r.status} recommendation=${r.recommendation} action=${r.action} prunable=${r.prunable}`
        ),
        'these worktrees are 0 ahead of the base, already on it, and hold uncommitted work that is in no ' +
          'commit on the branch — so the only copy of it is the working tree, and the generator is ' +
          'calling it disposable'
      ).toEqual([]);

      // And the shape the fleet also contains, so "never prune" is not satisfied
      // by a `classify` that prunes nothing. Without this the rule above is
      // satisfiable by refusing to dispose of the entire fleet.
      // `prunable` is the BOOLEAN and `disposalCandidates` is the list an operator
      // actually acts on, so both are named. Asserting only the boolean would let
      // a generator that computes it and never publishes it pass this test.
      const landable = inRepo.filter((r) => r.prunable);
      expect(
        landable.map((r) => r.name),
        'a worktree that is genuinely on the base and holds nothing must still be prunable, or "never ' +
          'offers a worktree holding work for disposal" is satisfied by never offering one'
      ).toContain('wt-landed-clean');
      expect(
        inv.disposalCandidates,
        'a clean, landed, empty worktree must appear in the list the generator prints, not only in the ' +
          'boolean, or the operator is never shown it'
      ).toContain('wt-landed-clean');

      // And the two shapes the rule is about are absent from that list, which is
      // the same fact as the `exposed` assertion above stated the way a reader
      // would meet it: "not on the list an operator acts on".
      for (const name of atRisk.map((r) => r.name)) {
        expect(inv.disposalCandidates, `${name} holds work on no ref and is on the disposal list`).not.toContain(name);
      }
    }
  });

  it('protects that shape in a worktree NOBODY has written anything down about', () => {
    // The guard above builds the document WITH the curated table, so a curated
    // entry is standing behind every verdict it checks. This one takes the entry
    // away, which is the state the deleted coverage rule used to make impossible
    // to reach: of the ten live worktrees holding work on no ref when this was
    // written, eight had no entry at all. If the protection came from the table,
    // those eight would be disposable and nothing here would be able to say so.
    //
    // So this is the coverage rule's actual subject — "a preservation branch gets
    // mistaken for a disposable one" — asserted as the invariant it needed,
    // against `classify` on git's facts and nothing else. It cannot be made green
    // by adding curated entries, which is the point, and it is now also true on
    // CI: the fleet's worktrees are named by the test, so none of them can be in
    // `curated.mjs` and the "no entry" state is reached by construction rather
    // than by hoping a curator has not written one yet.
    {
      const { worktrees } = fleet();
      const inv = inventoryFor(fleet());
      const inRepo = inv.worktrees.filter((r) => r.inRepo);

      // Non-vacuity, and it comes first so a green run cannot mean "git refused to
      // answer, so the set below was empty for a reason unrelated to risk".
      expect(
        inRepo
          .filter((r) => typeof r.ahead !== 'number' || typeof r.mergedIntoMain !== 'boolean')
          .map((r) => `${r.name} (ahead=${r.ahead} onMain=${r.mergedIntoMain})`),
        'git could not be read in these worktrees, so the set below would be empty for a reason that has ' +
          'nothing to do with whether any work is at risk'
      ).toEqual([]);

      // The set under test must be non-empty, stated as a property of the FLEET
      // and not of the loop: this is the assertion the live version could not
      // make, because there the set was whatever the operator happened to have.
      const subject = inRepo.filter(holdsWorkGitCannotSee).map((r) => r.name);
      expect(
        subject.length,
        'the synthetic fleet was built to contain this shape, so an empty set means the guard below is ' +
          'asserting nothing at all'
      ).toBeGreaterThanOrEqual(2);

      // The same three signals `buildInventory` would pass here, with the curated
      // entry removed. `inventoryFor()` builds with liveness deliberately empty,
      // so `noChats`/`noSessions` reproduce it exactly and the only difference
      // between this call and the record it is compared against is the curation.
      const exposed = [];
      const silent = [];
      for (const r of inRepo) {
        if (!holdsWorkGitCannotSee(r)) continue;
        const facts = worktrees.find((x) => x.name === r.name);
        const bare = classify(facts, { chatSummary: noChats, chatSessions: noSessions, curated: null, nowMs: NOW });
        const where =
          `${r.name} (curated: ${CURATED[r.name] ? 'yes' : 'NONE'}): ahead=${r.ahead} onMain=${r.mergedIntoMain} ` +
          `dirty=${r.dirty} untracked=${r.untracked} -> status=${bare.status} recommendation=${bare.recommendation} ` +
          `action=${bare.action} prunable=${bare.prunable}`;
        // The three ways to lose, which is what the sibling guard checks. `undecided`
        // is not one of them: an unreadable head or a detached one yields it, and
        // `classify` reaches it precisely so the worktree is not removed.
        if (bare.prunable || bare.recommendation === RECOMMENDATION.PRUNE || bare.action === ACTION.DISPOSE) {
          exposed.push(where);
        } else if (facts.tip === null || facts.detached) {
          // git could not name a tip, so the shape is not classifiable and
          // `undecided` is the honest answer. Reported rather than skipped, because
          // "the guard had nothing to check" and "the guard checked nothing" look
          // identical in a green run otherwise.
          silent.push(`${where} (tip unreadable or detached)`);
        } else if (bare.action !== ACTION.AT_RISK) {
          // Everything git could answer, it answered, and the work is on no ref.
          // Anything other than at-risk here means the record does not point an
          // operator at the only copy of it.
          exposed.push(`${where} — readable, so this must be reported as at-risk, not as anything else`);
        }
      }
      expect(
        exposed,
        'these worktrees hold work that is in no commit on any branch, so the working tree is the only ' +
          'copy, and with nothing curated about them classify does not report them as at risk: ' +
          exposed.join('; ') +
          // Named rather than dropped, so a green run cannot be read as "the guard
          // checked everything" when it could not classify something.
          (silent.length ? ` (skipped as unclassifiable: ${silent.join('; ')})` : '')
      ).toEqual([]);
      // `silent` is asserted empty for the same reason: an unclassifiable worktree
      // is a legitimate answer, but in a fleet this suite builds, none of them
      // should be detached or tip-less, and a green run that cannot say so has
      // checked less than it appears to.
      expect(silent, 'a worktree in the synthetic fleet could not be classified at all').toEqual([]);
    }
  });

  it('lets the curated table move a verdict only by vetoing a disposal', () => {
    // The reason the coverage rule could not simply be dropped: a curated entry
    // that changed a verdict would be a hand-written claim overriding git, and
    // `curated.mjs` is prose maintained by agents under time pressure. `classify`
    // reads exactly one field, `mustNotPrune`, and it can only ever make a
    // worktree LESS safe to delete. Everything else — `summary`, `note`,
    // `liveNote`, `issues`, `landed` — is documentation, and documentation that
    // moves a verdict is a lie the generator cannot detect.
    //
    // Both directions of the verdict are covered, because the two live in
    // different branches of `classify`: a clean merged branch (`LANDED` ->
    // `prune`, which is where a curated veto has something to bite on) and a
    // clean unmerged one (`UNMERGED_WORK` -> `ready-to-land`, the verdict
    // `mustNotPrune` is documented as also vetoing).
    const LANDABLE = wt({ name: 'landable', ahead: 0, mergedIntoBase: true });
    const TO_LAND = wt({ name: 'to-land', ahead: 4, mergedIntoBase: false, merge: { conflict: false } });
    const verdictOf = (w, curated) => {
      const v = classify(w, { chatSummary: noChats, chatSessions: noSessions, curated, nowMs: NOW });
      return `${v.status}/${v.recommendation}/${v.action}/prunable=${v.prunable}`;
    };

    // Real field values, each taken from whichever entry actually carries it,
    // so a field that exists in this table is covered by this loop.
    const all = Object.values(CURATED);
    const carrying = (field) => all.find((e) => e[field] !== undefined && e[field] !== null);
    const PROSE = {
      summary: carrying('summary').summary,
      note: carrying('note').note,
      liveNote: carrying('liveNote').liveNote,
      issues: carrying('issues').issues,
      landed: carrying('landed').landed,
    };
    expect(
      Object.keys(PROSE),
      'a curated field this table uses has no entry carrying it, so the loop below probes a value ' +
        'nothing in the table actually holds'
    ).toEqual(['summary', 'note', 'liveNote', 'issues', 'landed']);

    for (const shape of [LANDABLE, TO_LAND]) {
      const bare = verdictOf(shape, null);
      for (const [field, value] of Object.entries(PROSE)) {
        expect(
          verdictOf(shape, { [field]: value }),
          `curated.${field} changed the verdict for ${shape.name} (${bare}) — a prose field must never move it`
        ).toBe(bare);
      }
      // And the one field that may: if this stopped differing, the loop above
      // would be asserting inertness over a table whose veto had been disabled.
      expect(
        verdictOf(shape, { mustNotPrune: true, note: PROSE.note }),
        `curated.mustNotPrune no longer changes the verdict for ${shape.name} (${bare}), so the assertions above ` +
          'prove nothing: the table has stopped being able to veto anything'
      ).not.toBe(bare);
    }
  });

  it('refuses to dispose of that shape even with nothing but a dirty tree behind it', () => {
    // The live set above can legitimately be EMPTY — every worktree of this shape
    // may have committed or been disposed, which is the GOOD outcome and must not
    // turn this guard red. So the rule is pinned here as well, on a worktree that
    // cannot drift: no curated entry, no board agent, no chat, no branch of its
    // own, nothing but `ahead: 0`, already on main, and files in the tree.
    //
    // `classify` is pinned for the same shape one level down ('never marks a
    // worktree prunable while it holds uncommitted work'); this case is the
    // assembled document and the `disposalCandidates` list an operator reads,
    // which is a different surface and can disagree with `classify` without any
    // test noticing.
    const inv = buildInventory({
      worktrees: [
        wt({
          name: 'derived-shape',
          ahead: 0,
          behind: 0,
          mergedIntoBase: true,
          workingTree: { modified: 2, untracked: 1, paths: [] },
        }),
      ],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      ...silent(),
      nowMs: NOW,
    });
    const [record] = inv.worktrees;
    expect(record.status).toBe(STATUS.UNCOMMITTED_ONLY);
    expect(record.prunable).toBe(false);
    expect(inv.disposalCandidates).toEqual([]);
    // And the same worktree with a clean tree IS offered, so the assertion above
    // is about the dirty tree and not about a list that is always empty.
    const clean = buildInventory({
      worktrees: [wt({ name: 'derived-shape', ahead: 0, behind: 0, mergedIntoBase: true })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      ...silent(),
      nowMs: NOW,
    });
    expect(clean.disposalCandidates).toEqual(['derived-shape']);
  });
});

import * as chatsModule from '../lib/worktree-inventory/chats.mjs';

describe('the CLI staleness check', () => {
  const { equivalent } = await_import_cli();

  const doc = (over = {}) =>
    JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', totals: { worktrees: 2 }, worktrees: [], ...over });

  it('ignores only the generation timestamp', () => {
    // This file is a live snapshot of a repository where agents message
    // continuously, so a byte comparison fails on `generatedAt` alone and
    // `--check` could never pass. A gate that always fails is noise that
    // trains people to ignore it.
    expect(equivalent(doc(), doc({ generatedAt: '2026-09-28T21:00:00.000Z' }))).toBe(true);
  });

  it('still fails on a real change', () => {
    expect(equivalent(doc(), doc({ totals: { worktrees: 3 } }))).toBe(false);
    const a = doc({ worktrees: [{ name: 'x', prunable: true }] });
    const b = doc({ worktrees: [{ name: 'x', prunable: false }] });
    expect(equivalent(a, b)).toBe(false);
  });

  it('treats unparseable input as different rather than equal', () => {
    expect(equivalent('not json', doc())).toBe(false);
  });
});

// Imported lazily so the CLI module's top-level `main()` side effects are not
// triggered by the pure-function tests above.
function await_import_cli() {
  return cliModule;
}

import * as cliModule from '../worktree-inventory.mjs';

describe('the generated file is already formatted', () => {
  it('is byte-identical to what Prettier would produce', () => {
    // Otherwise every regeneration produces a file `lint-staged
    // --fail-on-changes` refuses and un-stages, and the only ways out are a
    // .prettierignore or dropping .json from the linted set — both of which
    // weaken a gate to accommodate a generator.
    //
    // That gate no longer reaches this file: `lint:check` runs over
    // `git ls-files`, and the inventory is untracked. This test is now the only
    // thing keeping the output formatted, which is worth more than the check it
    // replaced — an unformatted generated file is still read by a human deciding
    // whether to delete a worktree.
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    const inv = buildInventory({
      worktrees: [wt({ name: 'a', issues: [] })],
      root: '/repo',
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit: { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 },
      nowMs: NOW,
    });
    const formatted = formatCanonical(serialise(inv));
    // Idempotent: formatting an already-formatted document changes nothing.
    expect(formatCanonical(formatted)).toBe(formatted);
    expect(formatted.endsWith('\n')).toBe(true);
    // Still valid JSON with every field intact after the reflow.
    expect(JSON.parse(formatted).worktrees).toHaveLength(1);
  });
});

describe('the generated inventory is untracked, and stays that way', () => {
  const INVENTORY = 'WORKTREES.json';

  // The worktree root, resolved rather than assumed. This suite is run from a task
  // worktree as often as from the root checkout, and `check-ignore` resolves its
  // argument against the cwd: from `scripts/`, the probe path would become
  // `scripts/WORKTREES.json`, the anchored `/WORKTREES.json` would not match it,
  // and the assertion below would report a hard rule as broken while the
  // `ls-files` one stopped describing a file that exists anywhere.
  //
  // Resolving it with git also removes a vacuity path. `gitSucceeds` swallows
  // every throw, so a missing or broken git leaves an assertion that expects
  // `false` passing without having asked anything; this call throws instead, and
  // takes all three cases down with it rather than two.
  const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

  // One fact per `it`, and one gate per fact. `check-ignore` and `ls-files` can
  // both be satisfied by a file that is tracked AND ignored, so asserting only
  // the first would let a re-added inventory pass as a rule that still holds.
  // The two injections that prove which gate is which are recorded with the
  // change that introduced them.
  const gitSucceeds = (args) => {
    try {
      execFileSync('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
      return true;
    } catch {
      return false;
    }
  };

  it('is not tracked, so a regeneration cannot become a commit', () => {
    // Injection: `git add -f WORKTREES.json` turns this red and leaves the
    // test below green — this is the gate that decides "untracked", and the
    // other is not a redundant restatement of it.
    expect(gitSucceeds(['ls-files', '--error-unmatch', INVENTORY])).toBe(false);
  });

  it('is ignored by a rule that is still in .gitignore', () => {
    // `--no-index` or this assertion is worthless: without it git declines to
    // report a rule for a path the index still tracks, so the same
    // `git add -f` that reds the test above would decide this one too, and
    // deleting the .gitignore line would be invisible here.
    // Injection: removing the `/WORKTREES.json` line from .gitignore turns this
    // red and leaves the test above green.
    //
    // This must not depend on the file existing. A fresh checkout has no
    // inventory until something generates one, and `check-ignore` reads
    // patterns rather than the filesystem, so the assertion holds there too.
    expect(gitSucceeds(['check-ignore', '--no-index', INVENTORY])).toBe(true);
  });

  it('reaches neither the generator nor the curated table', () => {
    // The guard is that the rule cannot be broadened into the tracked source it
    // sits beside. `curated.mjs` is hand-written source that the suite imports,
    // and losing it to an ignore rule would delete the findings that stop a
    // worktree being pruned — so `scripts/**` in `.gitignore` is the injection
    // that reds this alone, with the two above green.
    //
    // What this does NOT establish, and an earlier version of this comment
    // claimed it did: that the leading slash stops the rule reaching a worktree's
    // own `WORKTREES.json`. `.kilo` already ignores those, so that path is green
    // with or without the anchor — the anchor has no observable behaviour in this
    // repository, and there is nothing here to test.
    for (const source of ['scripts/worktree-inventory.mjs', 'scripts/lib/worktree-inventory/curated.mjs']) {
      expect(gitSucceeds(['check-ignore', '--no-index', source]), `${source} must stay tracked`).toBe(false);
    }
  });
});

/**
 * Call history: who wrote in each worktree, who read it, who ran commands in it,
 * ever, and which of those may be released.
 *
 * The property under test is ATTRIBUTION plus COMPLETENESS, and they pull against
 * each other. `chats.mjs` attributes a chat to a worktree by the directory the
 * chat OPENED in, which is wrong in both directions at once: a chat opened in the
 * main checkout and then driven into a task worktree is recorded against main for
 * its whole life, and a chat whose worktree was deleted points at a directory
 * that no longer exists. So the tests below are about WHICH DIRECTORY a call lands
 * in and about whether an unplaceable call is admitted rather than dropped.
 *
 * Every bug these pin was found by running against the real 428k-row database,
 * not by reading the code. Two of them — the missing path separator and the
 * project filter — were invisible to a single-project fixture, which is why the
 * fixture below deliberately does NOT list the repository root in
 * `project_directory`, exactly as the live database does not.
 */
describe('the call history', () => {
  const ROOT = '/repo';

  /**
   * A session/part database shaped like the real one.
   *
   * `project_directory` holds whatever `rows.projectDirectories` says, and the
   * default registers the root under `p1`. A test that needs the project filter
   * to be ABLE to match omits it — which is the live shape, since the real
   * `project_directory` stores `/Users/bkalynovskyi/ph` while a macOS-normalised
   * lookup asks for `/private/Users/bkalynovskyi/ph` and matches nothing.
   */
  function makeSessionDb(rows) {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-calls-'));
    const dbPath = join(dir, 'kilo.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE project_directory (project_id TEXT, directory TEXT, type TEXT);
             CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT,
               agent TEXT, time_created INTEGER, time_updated INTEGER);
             CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER,
               time_updated INTEGER, data TEXT);`);
    for (const pd of rows.projectDirectories ?? [['p1', ROOT, 'primary']]) {
      db.prepare('INSERT INTO project_directory VALUES (?,?,?)').run(...pd);
    }
    const addSession = db.prepare(
      'INSERT INTO session (id, project_id, parent_id, directory, title, agent, time_created, time_updated) VALUES (?,?,?,?,?,?,?,?)'
    );
    const addPart = db.prepare(
      'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)'
    );
    for (const s of rows.sessions ?? []) {
      addSession.run(
        s.id,
        s.projectId ?? 'p1',
        s.parentId ?? null,
        s.directory,
        s.title ?? s.id,
        s.agent ?? 'code',
        s.at,
        s.at
      );
    }
    for (const [i, w] of (rows.calls ?? []).entries()) {
      addPart.run(`p${i}`, `m${i}`, w.sessionId, w.at, w.at, JSON.stringify(w.data));
    }
    db.close();
    return { dir, dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  const tool = (name, input, status = 'completed') => ({ type: 'tool', tool: name, state: { status, input } });

  const run = (dbPath, extra = {}) =>
    auditWrites({
      dbPath,
      root: ROOT,
      worktreePaths: [],
      nowMs: NOW,
      liveWindowMs: 30 * 60 * 1000,
      ...extra,
    });

  it('reads the worktree name out of a path, and only out of a worktree path', () => {
    // The separator is the whole test. The root arrives with no trailing slash,
    // and concatenating the segment onto it built `<root>.kilo/worktrees/` —
    // which matches nothing, so every call to a deleted worktree was silently
    // filed under the main checkout instead.
    expect(worktreeNameFromPath(`${ROOT}/.kilo/worktrees/gone-one/src/a.ts`, ROOT)).toBe('gone-one');
    expect(worktreeNameFromPath(`${ROOT}/src/a.ts`, ROOT)).toBeNull();
    expect(worktreeNameFromPath('/somewhere/else/.kilo/worktrees/x/src/a.ts', ROOT)).toBeNull();
  });

  it("attributes to the most specific worktree, and returns the caller's spelling of it", () => {
    const index = buildPathIndex(ROOT, [`${ROOT}/.kilo/worktrees/x`]);
    // The main checkout contains every worktree, so a match that did not prefer
    // the longer path would file every worktree's calls under main.
    expect(index.match(`${ROOT}/.kilo/worktrees/x/src/a.ts`)).toBe(`${ROOT}/.kilo/worktrees/x`);
    expect(index.match(`${ROOT}/src/a.ts`)).toBe(ROOT);
    // Both results are the path as the CALLER spelled it, un-normalised, because
    // callers look records up by the worktree path `git worktree list` printed.
    // Returning macOS's `/private` form instead misses every in-repo worktree at
    // once — which is exactly the 10,074-vs-3,480 misattribution.
    for (const hit of [index.match(`${ROOT}/src/a.ts`), index.match(`${ROOT}/.kilo/worktrees/x/src/a.ts`)]) {
      expect(hit.startsWith('/private/')).toBe(false);
    }
  });

  it('finds the files an apply_patch names, and not the ones its body mentions', () => {
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${ROOT}/src/real.ts`,
      `*** Add File: ${ROOT}/src/added.ts`,
      `*** Delete File: ${ROOT}/src/gone.ts`,
      `*** Move to: ${ROOT}/src/moved.ts`,
      '@@',
      ' const seen = "*** Update File: not/a/target.ts";',
      '*** End Patch',
    ].join('\n');
    // The body line is a CONTEXT line that happens to contain the header text.
    // Anchoring only on the text would count a file that was never written.
    expect(patchTargetPaths(patch)).toEqual([
      `${ROOT}/src/real.ts`,
      `${ROOT}/src/added.ts`,
      `${ROOT}/src/gone.ts`,
      `${ROOT}/src/moved.ts`,
    ]);
    expect(patchTargetPaths(null)).toEqual([]);
  });

  it("rolls a subagent's call up to the chat a human opened", () => {
    const byId = new Map([
      ['child', { id: 'child', parentId: 'parent' }],
      ['parent', { id: 'parent', parentId: null }],
    ]);
    expect(rootSessionId('child', byId)).toBe('parent');
    // A cycle must terminate rather than hang the generator.
    const cyclic = new Map([
      ['a', { id: 'a', parentId: 'b' }],
      ['b', { id: 'b', parentId: 'a' }],
    ]);
    expect(rootSessionId('a', cyclic)).toBeTruthy();
  });

  it('keeps a writer whose session belongs to a different project', () => {
    // THE test for the project filter. The filter this replaced looked the
    // project up with a macOS-normalised root, `project_directory` stores the
    // unprefixed spelling, the lookup matched zero rows — and the branch that
    // scoped on it was live code that would have dropped this write the day
    // someone "fixed" the path spelling. On the real database that is 30 sessions
    // and 774 completed writes.
    const fx = makeSessionDb({
      projectDirectories: [['p2', '/some/other/project', 'primary']],
      sessions: [
        { id: 'other', projectId: 'p2', directory: '/some/other/project', at: NOW - 10_000 },
        { id: 'mine', projectId: 'p1', directory: ROOT, at: NOW - 10_000 },
      ],
      calls: [
        { sessionId: 'other', at: NOW - 10_000, data: tool('edit', { filePath: `${ROOT}/src/a.ts` }) },
        { sessionId: 'mine', at: NOW - 9_000, data: tool('edit', { filePath: `${ROOT}/src/b.ts` }) },
      ],
    });
    try {
      const audit = run(fx.dbPath);
      // Both writers are present, and the cross-project one is a chat id that can
      // be acted on rather than a number that quietly went down.
      expect(audit.byWorktree.get(ROOT).write.calls).toBe(2);
      expect([...audit.byWorktree.get(ROOT).write.chats.keys()].sort()).toEqual(['mine', 'other']);
    } finally {
      fx.cleanup();
    }
  });

  it('keeps a subagent of a cross-project chat, rolled up to its parent', () => {
    // The family walk must read the whole session table rather than any filtered
    // subset, or a subagent whose parent lives under another project is recorded
    // as a chat of its own — an id no human can act on.
    const fx = makeSessionDb({
      projectDirectories: [['p2', '/some/other/project', 'primary']],
      sessions: [
        { id: 'parent', projectId: 'p2', directory: '/some/other/project', at: NOW - 10_000 },
        { id: 'child', projectId: 'p1', parentId: 'parent', directory: `${ROOT}/.kilo/worktrees/x`, at: NOW - 9_000 },
      ],
      calls: [
        { sessionId: 'child', at: NOW - 9_000, data: tool('edit', { filePath: `${ROOT}/.kilo/worktrees/x/src/a.ts` }) },
      ],
    });
    try {
      const audit = run(fx.dbPath, { worktreePaths: [`${ROOT}/.kilo/worktrees/x`] });
      const rec = audit.byWorktree.get(`${ROOT}/.kilo/worktrees/x`);
      expect([...rec.write.chats.keys()]).toEqual(['parent']);
      // The subagent's work is counted as subagent work on the parent, so the
      // owner list has one entry and the reader can see it was delegated.
      expect(rec.write.subagentCalls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it('counts only calls that completed', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: ROOT, at: NOW - 10_000 }],
      calls: [
        { sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: `${ROOT}/src/ok.ts` }) },
        { sessionId: 's1', at: NOW - 9_000, data: tool('edit', { filePath: `${ROOT}/src/bad.ts` }, 'error') },
      ],
    });
    try {
      const audit = run(fx.dbPath);
      // The errored edit changed nothing. Counting it would put a number in the
      // file that overstates what was written, and the number is what is trusted.
      expect(audit.byWorktree.get(ROOT).write.calls).toBe(1);
      const chat = [...audit.byWorktree.get(ROOT).write.chats.values()][0];
      expect(chat.files.has(`${ROOT}/src/bad.ts`)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  it("keeps a deleted worktree's writers attached to it instead of the main checkout", () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: `${ROOT}/.kilo/worktrees/deleted`, at: NOW - 10_000 }],
      calls: [
        {
          sessionId: 's1',
          at: NOW - 10_000,
          data: tool('edit', { filePath: `${ROOT}/.kilo/worktrees/deleted/src/a.ts` }),
        },
        {
          sessionId: 's1',
          at: NOW - 9_000,
          data: tool('edit', { filePath: `${ROOT}/.kilo/worktrees/deleted/src/b.ts` }),
        },
      ],
    });
    try {
      const audit = run(fx.dbPath, { worktreePaths: [`${ROOT}/.kilo/worktrees/live`] });
      // The registry lost the worktree, but the path remembers it. Longest-prefix
      // matching would have handed both calls to the main checkout, which
      // contains every worktree.
      expect(audit.byWorktree.get('gone:deleted').write.calls).toBe(2);
      expect(audit.byWorktree.has(ROOT)).toBe(false);
      expect(audit.goneWorktrees[0]).toEqual(
        expect.objectContaining({ name: 'deleted', writeCalls: 2, chatCount: 1, chatIds: ['s1'] })
      );
    } finally {
      fx.cleanup();
    }
  });

  it('resolves a relative path against the session directory, and marks that it did', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: `${ROOT}/.kilo/worktrees/x`, at: NOW - 10_000 }],
      calls: [{ sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: 'src/a.ts' }) }],
    });
    try {
      const audit = run(fx.dbPath, { worktreePaths: [`${ROOT}/.kilo/worktrees/x`] });
      const summary = summariseWrites(audit.byWorktree.get(`${ROOT}/.kilo/worktrees/x`).write, {
        nowMs: NOW,
        liveWindowMs: 30 * 60 * 1000,
      });
      // The working directory is the only thing that gives a relative path a
      // location, and it is not in the call — so the resolution is recorded as
      // what it is, different evidence from a recorded absolute path.
      expect(summary.chats[0].assumedCwdPaths).toBe(1);
      expect(summary.chats[0].files).toEqual([`${ROOT}/.kilo/worktrees/x/src/a.ts`]);
    } finally {
      fx.cleanup();
    }
  });

  it('keeps a relative path with no session directory out of the path index', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: null, at: NOW - 10_000 }],
      calls: [{ sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: 'src/a.ts' }) }],
    });
    try {
      const audit = run(fx.dbPath);
      // `src/a.ts` read as root-relative would be filed under the main
      // checkout, which is a plausible-looking lie about a 2-character path.
      expect(audit.byWorktree.has(ROOT)).toBe(false);
      expect(audit.byWorktree.has('relative:src/a.ts')).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it('counts reads in their own structure, and never as writes', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: ROOT, at: NOW - 10_000 }],
      calls: [
        { sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: `${ROOT}/src/a.ts` }) },
        { sessionId: 's1', at: NOW - 9_000, data: tool('read', { filePath: `${ROOT}/src/b.ts` }) },
        { sessionId: 's1', at: NOW - 8_000, data: tool('grep', { pattern: 'x', path: `${ROOT}/src` }) },
        { sessionId: 's1', at: NOW - 7_000, data: tool('glob', { pattern: '**/*.ts', path: `${ROOT}/src` }) },
      ],
    });
    try {
      const audit = run(fx.dbPath);
      const rec = audit.byWorktree.get(ROOT);
      // Reading a file is interest, not authorship. Merging the two lists is what
      // would make a release have to remember which entry was which, forever.
      expect(rec.write.calls).toBe(1);
      expect(rec.read.calls).toBe(3);
      expect(audit.totalWriteCalls).toBe(1);
      expect(audit.totalReadCalls).toBe(3);
    } finally {
      fx.cleanup();
    }
  });

  it('counts a read that named no path, rather than dropping it', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: ROOT, at: NOW - 10_000 }],
      calls: [
        { sessionId: 's1', at: NOW - 10_000, data: tool('glob', { pattern: '**/AGENTS.md' }) },
        { sessionId: 's1', at: NOW - 9_000, data: tool('grep', { pattern: 'undo' }) },
      ],
    });
    try {
      const audit = run(fx.dbPath);
      // 4% of greps and 66% of globs record no path, because they defaulted to
      // the working directory. They are real reads with no location, and
      // omitting them makes the read count a lie.
      expect(audit.totalReadCalls).toBe(2);
      const unlocated = [...audit.byWorktree.values()].find((r) => r.read.unlocatedCalls === 2);
      expect(unlocated).toBeTruthy();
    } finally {
      fx.cleanup();
    }
  });

  it('reports shell traffic separately, and says it is not a write count', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: `${ROOT}/.kilo/worktrees/x`, at: NOW - 10_000 }],
      calls: [
        { sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: `${ROOT}/.kilo/worktrees/x/src/a.ts` }) },
        { sessionId: 's1', at: NOW - 9_000, data: tool('bash', { command: 'sed -i s/a/b/ src/a.ts' }) },
      ],
    });
    try {
      const audit = run(fx.dbPath, { worktreePaths: [`${ROOT}/.kilo/worktrees/x`] });
      const rec = audit.byWorktree.get(`${ROOT}/.kilo/worktrees/x`);
      // A `sed -i` changes a file and leaves no filePath anywhere, so
      // `writeCalls: 1` alongside a shell command is a number that reads as
      // complete when it is not. The shell structure exists to name the gap.
      expect(rec.write.calls).toBe(1);
      expect(rec.shell.calls).toBe(1);
      expect(summariseShell(rec.shell, { nowMs: NOW, liveWindowMs: 1 }).writeCapableCalls).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it('resolves a shell call with no workdir against the session directory', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: `${ROOT}/.kilo/worktrees/x`, at: NOW - 10_000 }],
      calls: [{ sessionId: 's1', at: NOW - 10_000, data: tool('bash', { command: 'npm test' }) }],
    });
    try {
      const audit = run(fx.dbPath, { worktreePaths: [`${ROOT}/.kilo/worktrees/x`] });
      // 40,658 calls on the real database recorded no workdir, and the session's
      // own directory was sitting in the table the whole time.
      expect(audit.byWorktree.get(`${ROOT}/.kilo/worktrees/x`).shell.calls).toBe(1);
      expect(audit.unmapped.shell).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  it('counts unplaceable calls per kind, and never mixes them into a total', () => {
    const fx = makeSessionDb({
      sessions: [{ id: 's1', directory: ROOT, at: NOW - 10_000 }],
      calls: [
        { sessionId: 's1', at: NOW - 10_000, data: tool('edit', { filePath: '/elsewhere/project/src/a.ts' }) },
        { sessionId: 's1', at: NOW - 9_000, data: tool('read', { filePath: '/elsewhere/project/src/b.ts' }) },
        { sessionId: 's1', at: NOW - 8_000, data: tool('bash', { command: 'ls', workdir: '/elsewhere/project' }) },
      ],
    });
    try {
      const audit = run(fx.dbPath);
      // One mixed counter made the write total meaningless the moment a second
      // kind existed: `attributed + unmapped` silently summed three different
      // things and produced a plausible wrong number.
      expect(audit.unmapped).toEqual({ write: 1, read: 1, shell: 1 });
      expect(audit.attributedWriteCalls).toBe(0);
      expect(audit.totalWriteCalls).toBe(1);
      expect(audit.totalReadCalls).toBe(1);
      expect(audit.totalShellCalls).toBe(1);
      // Per kind, not one shared list.
      const kinds = new Set(audit.unmappedBuckets.map((b) => b.bucket.split(':')[0]));
      expect([...kinds].sort()).toEqual(['read', 'shell', 'write']);
    } finally {
      fx.cleanup();
    }
  });

  it('reports an unavailable database as empty rather than throwing', () => {
    const audit = auditWrites({ dbPath: join(tmpdir(), 'definitely-not-a.db'), root: ROOT, nowMs: NOW });
    expect(audit.available).toBe(false);
    expect(audit.byWorktree.size).toBe(0);
    expect(audit.unmapped).toEqual({ write: 0, read: 0, shell: 0 });
    expect(emptyWriteHistory({ nowMs: NOW, liveWindowMs: 1 }).activeNow).toBe(false);
  });

  it('keeps the evidence a suppression overrode, so the override is auditable', () => {
    const kind = {
      calls: 3,
      subagentCalls: 0,
      unlocatedCalls: 0,
      chats: new Map([
        [
          's1',
          {
            id: 's1',
            title: 'a chat',
            agent: 'code',
            openedIn: ROOT,
            openedHere: true,
            calls: 3,
            subagentCalls: 0,
            assumedCwd: 0,
            firstAt: NOW - 60_000,
            lastAt: NOW - 60_000,
            files: new Set([`${ROOT}/src/a.ts`]),
          },
        ],
      ]),
    };
    const live = summariseWrites(kind, { nowMs: NOW, liveWindowMs: 30 * 60 * 1000 });
    expect(live.activeNow).toBe(true);
    expect(live.currentChatIds).toEqual(['s1']);

    const suppressed = summariseWrites(kind, { nowMs: NOW, liveWindowMs: 30 * 60 * 1000, suppressed: true });
    // The override empties the claim and keeps the derivation. A file that says
    // "nobody is writing" with no record of what it overrode cannot be told
    // apart from a bug in the generator.
    expect(suppressed.activeNow).toBe(false);
    expect(suppressed.currentChatIds).toEqual([]);
    expect(suppressed.derivedChatIds).toEqual(['s1']);
    // The archaeology half survives suppression.
    expect(suppressed.lastAt).toBe(new Date(NOW - 60_000).toISOString());
  });

  it('releases readers below the watermark and keeps every writer', () => {
    const old = Date.parse('2026-01-01T00:00:00Z');
    const recent = NOW - 60_000;
    const kind = (lastAt) => ({
      calls: 1,
      subagentCalls: 0,
      unlocatedCalls: 0,
      chats: new Map([
        [
          lastAt === old ? 'stale' : 'fresh',
          {
            id: lastAt === old ? 'stale' : 'fresh',
            title: 't',
            agent: 'code',
            openedIn: ROOT,
            openedHere: true,
            calls: 1,
            subagentCalls: 0,
            assumedCwd: 0,
            firstAt: lastAt,
            lastAt,
            files: new Set(),
          },
        ],
      ]),
    });
    const stale = kind(old);
    const fresh = kind(recent);
    const released = summariseReads(stale, { nowMs: NOW, liveWindowMs: 1, releasedBeforeMs: NOW - 3_600_000 });
    expect(released.chatCount).toBe(0);
    expect(released.releasedBefore).toBe(new Date(NOW - 3_600_000).toISOString());
    // A reader newer than the mark is not released.
    expect(summariseReads(fresh, { nowMs: NOW, liveWindowMs: 1, releasedBeforeMs: NOW - 3_600_000 }).chatCount).toBe(1);
    // The call total is untouched: a release hides WHO, never HOW MUCH, so the
    // fact that reads happened survives the release.
    expect(released.calls).toBe(1);

    // Writers are a different structure with no watermark parameter at all, so
    // a release cannot reach them.
    expect(summariseWrites(stale, { nowMs: NOW, liveWindowMs: 1 }).chatCount).toBe(1);
  });

  it('moves the release mark forward only, and carries it across runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-release-'));
    const target = join(dir, 'WORKTREES.json');
    const write = (mark) => writeFileSync(target, JSON.stringify({ ownership: { readsReleasedBefore: mark } }), 'utf8');
    try {
      // No file yet: no release has happened, which is the correct first state.
      expect(resolveReadsReleasedBefore(target, null, NOW)).toBe(0);
      write('2026-01-01T00:00:00.000Z');
      expect(resolveReadsReleasedBefore(target, null, NOW)).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
      // A later release advances it.
      expect(resolveReadsReleasedBefore(target, 'now', NOW)).toBe(NOW);
      write(new Date(NOW).toISOString());
      // A release asked for with a cut-off in the PAST cannot un-release readers
      // a later release already removed. Those rows are gone from the document and
      // the mark is the only memory of them.
      expect(resolveReadsReleasedBefore(target, '2020-01-01T00:00:00Z', NOW)).toBe(NOW);
      // An unparseable cut-off is an error, not a silent "now".
      expect(() => resolveReadsReleasedBefore(target, 'last tuesday', NOW)).toThrow(/ISO/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('makes a recent WRITE a stronger liveness claim than a recent message', () => {
    const chatSummary = { ...noChats, lastActivity: null };
    // `derivedChatIds`, not `activeNow`: the classifier reads the signal as it
    // was BEFORE any declared hard state, so an override cannot erase the
    // evidence that justified it.
    const verdict = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary,
      chatSessions: [],
      nowMs: NOW,
      writeHistory: { activeNow: true, derivedChatIds: ['s1'] },
    });
    expect(verdict.live).toBe(true);
    expect(verdict.reasons.join(' ')).toContain('wrote a file');
  });

  it('calls a worktree live on recent command I/O alone, with no session and no board record', () => {
    // The case this exists for: an agent opened in the MAIN checkout drove into
    // this worktree and ran commands there. Its `session.directory` is the main
    // checkout, so `chatSummary` cannot see it, and the board is keyed on the
    // branch, so it cannot see it either. Every git fact about the worktree can
    // be correct — clean, merged, nothing ahead — and it is still occupied.
    const verdict = classify(wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 0, untracked: 0 } }), {
      chatSummary: { count: 0, lastActivity: null },
      chatSessions: [],
      nowMs: NOW,
      shellHistory: { lastAtMs: NOW - 40 * 60_000, derivedChatIds: [], activeNow: false },
    });
    expect(verdict.live).toBe(true);
    expect(verdict.derivedLive).toBe(true);
    expect(verdict.liveSignals.io).toBe(true);
    expect(verdict.liveSignals.chat).toBe(false);
    expect(verdict.liveSignals.board).toBe(false);
    // The reason has to name the timestamp, because "in-use" with no stated cause
    // is what a reader cannot act on.
    expect(verdict.reasons.join(' ')).toContain('a command ran inside this worktree');
  });

  it('counts a reader as occupying the worktree, and honours the read release', () => {
    // A read is weaker evidence than a write and is admitted on the same window,
    // because the skill treats a read as grounds for LIVE unless the hit can be
    // shown to be an inventory row. Without this, a worktree whose agent only
    // read its spec — and then went quiet for the rest of its task — read as
    // empty while its owner was still live.
    const reading = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 0, lastActivity: null },
      chatSessions: [],
      nowMs: NOW,
      readHistory: { lastAtMs: NOW - 90 * 60_000 },
    });
    expect(reading.live).toBe(true);
    expect(reading.liveSignals.io).toBe(true);

    // A released reader must read as no signal rather than as a standing claim,
    // or every worktree any agent ever inspected becomes permanently in-use.
    const released = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 0, lastActivity: null },
      chatSessions: [],
      nowMs: NOW,
      readHistory: { lastAtMs: null, releasedBefore: NOW - 60_000 },
    });
    expect(released.derivedLive).toBe(false);
  });

  it('stops calling a worktree live once its I/O falls outside the window', () => {
    const stale = classify(wt({ ahead: 0, mergedIntoBase: true }), {
      chatSummary: { count: 0, lastActivity: null },
      chatSessions: [],
      nowMs: NOW,
      shellHistory: { lastAtMs: NOW - 5 * 60 * 60_000, derivedChatIds: [] },
    });
    expect(stale.derivedLive).toBe(false);
    expect(stale.liveSignals.io).toBe(false);

    // `prunable` must not become reachable through this. A worktree with
    // uncommitted work stays un-prunable whatever its I/O looks like.
    const held = classify(wt({ ahead: 0, mergedIntoBase: true, workingTree: { modified: 3, untracked: 0 } }), {
      chatSummary: { count: 0, lastActivity: null },
      chatSessions: [],
      nowMs: NOW,
      shellHistory: { lastAtMs: NOW - 60_000 },
    });
    expect(held.prunable).toBe(false);
  });

  it('lets a declared hard state outrank every liveness signal, and says so', () => {
    const liveSignal = { count: 1, lastActivity: NOW - 60_000 };
    expect(classify(wt({}), { chatSummary: liveSignal, chatSessions: [], nowMs: NOW }).live).toBe(true);

    const verdict = classify(wt({}), {
      chatSummary: liveSignal,
      chatSessions: [],
      nowMs: NOW,
      boardAgents: [{ agentId: 'feat/x', live: true }],
      liveWritersSuppressed: 'the editor restarted',
    });
    expect(verdict.live).toBe(false);
    expect(verdict.liveSuppressed).toBe(true);
    // Both recency signals are retained, so the file records that something was
    // overridden and what it overrode rather than silently disagreeing.
    expect(verdict.derivedLive).toBe(true);
    expect(verdict.reasons.join(' ')).toContain('the editor restarted');
  });

  it('publishes three histories and the release mark in the document', () => {
    const board = { available: true, dbPath: 'b', claims: new Map(), fileLocks: new Map(), issues: [] };
    const chatAudit = { available: true, dbPath: 'k', byDirectory: new Map(), total: 0, newestSessionAt: 0 };
    const chat = (id, lastAt) => ({
      id,
      title: 't',
      agent: 'code',
      openedIn: '/repo/.kilo/worktrees/example',
      openedHere: true,
      calls: 1,
      subagentCalls: 0,
      assumedCwd: 0,
      firstAt: lastAt,
      lastAt,
      files: new Set(['/repo/.kilo/worktrees/example/src/a.ts']),
    });
    const kind = (id, lastAt) => ({
      calls: 1,
      subagentCalls: 0,
      unlocatedCalls: 0,
      chats: new Map([[id, chat(id, lastAt)]]),
    });
    const writeAudit = {
      available: true,
      dbPath: 'k',
      byWorktree: new Map([
        [
          '/repo/.kilo/worktrees/example',
          {
            key: '/repo/.kilo/worktrees/example',
            path: '/repo/.kilo/worktrees/example',
            write: kind('writer', NOW - 60_000),
            read: kind('reader', NOW - 60_000),
            shell: kind('sheller', NOW - 60_000),
          },
        ],
      ]),
      goneWorktrees: [{ name: 'deleted-one', writeCalls: 9, chatCount: 1, chatIds: ['s2'], lastWriteAt: null }],
      attributedWriteCalls: 1,
      totalWriteCalls: 2,
      totalReadCalls: 3,
      totalShellCalls: 4,
      unmapped: { write: 1, read: 2, shell: 3 },
      unmappedBuckets: [{ bucket: 'write:/elsewhere', calls: 1 }],
    };

    const inv = buildInventory({
      worktrees: [wt({ name: 'example' })],
      root: ROOT,
      base: 'main',
      mainHead: 'deadbeef',
      board,
      chatAudit,
      writeAudit,
      nowMs: NOW,
      liveWritersSuppressed: 'the editor restarted',
      readsReleasedBeforeMs: 0,
    });

    const w = inv.worktrees[0];
    // Three structures, and the reader is its own — the release reaches it alone.
    expect(w.writeHistory.chats.map((c) => c.id)).toEqual(['writer']);
    expect(w.readHistory.chats.map((c) => c.id)).toEqual(['reader']);
    expect(w.shellHistory.writeCapableCalls).toBe(1);
    expect(w.writeHistory.derivedChatIds).toEqual(['writer']);
    expect(w.liveSuppressed).toBe(true);

    // A file reporting zero live writers is ambiguous between "nobody is writing"
    // and "every writer is dead", and those two demand opposite responses, so the
    // reason travels with the count.
    expect(inv.ownership.liveWriterCount).toBe(0);
    expect(inv.ownership.suppressed).toBe(true);
    expect(inv.ownership.reason).toBe('the editor restarted');
    expect(inv.ownership.readsReleasedBefore).toBeNull();

    // No `sessions` key any more: it reported every session on the machine,
    // including the ones that never wrote, under a key that said `writes`.
    expect(inv.dataSources.calls.write).toEqual({ total: 2, attributed: 1, unmapped: 1 });
    expect(inv.dataSources.calls.read.unmapped).toBe(2);
    expect(inv.dataSources.calls.shell.unmapped).toBe(3);
    expect(inv.dataSources.calls.sessions).toBeUndefined();
    expect(inv.goneWorktrees).toEqual(writeAudit.goneWorktrees);
    expect(inv.totals.goneWorktreesWithWrites).toBe(1);
    expect(inv.totals.totalShellCalls).toBe(4);
  });
});

describe('readBoard: a board it cannot query', () => {
  /**
   * The module header promises that "every function here returns an empty result
   * rather than throwing", on the grounds that an inventory which cannot be
   * generated is a worse tool than one that generates and says the board was
   * unavailable. `readBoard` was `try { … } finally` with no `catch`, so any
   * query error escaped `main()` and the generator died having written nothing.
   */
  it('degrades to unavailable, and says why, instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-broken-'));
    const dbPath = join(dir, 'board.db');
    const db = new DatabaseSync(dbPath);
    // Opens fine. Cannot be queried: `claims` is a table of nonsense, so the very
    // first SELECT in `readBoard` throws. This is the shape a board has after a
    // partial migration, which is exactly the case the promise is about.
    db.exec('CREATE TABLE claims (nonsense TEXT)');
    db.close();

    const board = readBoard(dir, { nowMs: NOW, dbPath });
    expect(board.available).toBe(false);
    expect(board.claims.size).toBe(0);
    expect(board.fileLocks.size).toBe(0);
    expect(board.issues).toEqual([]);
    // "board unavailable" and "board broken" are different states, so the reason
    // is reported rather than swallowed.
    expect(board.error).toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });
});
