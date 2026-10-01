/**
 * `dispose-worktree.mjs` — the rule set, tested without a repository.
 *
 * WHY NO REPOSITORY, A BOOTSTRAP, OR A SESSION DATABASE
 * -----------------------------------------------------
 * Every effect in `dispose-worktree.mjs` is injected: the command runner, the
 * filesystem, the inventory document, the board rows and the session rows. So
 * the whole decision surface — which is where the incident lived — is testable
 * in-process, and this suite never spawns `git`.
 *
 * That is not a stylistic preference. `scripts/__tests__/suite-budgets.test.mjs`
 * derives its list of process-spawning suites from a scan of this directory and
 * requires each one to be declared with a wall-clock budget, so a suite that
 * needed a real `git init` would add ~2s to every full-suite run to learn
 * something a table can say exactly.
 *
 * WHAT IS ASSERTED
 * ----------------
 * That each signal refuses ON ITS OWN. A test which passes all the signals at
 * once and asserts a single refusal proves only that the conjunction refuses;
 * the incident was a conjunction with one arm missing, so each arm gets its own
 * case with every other arm green.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KEEP_REF_PREFIX,
  MAX_INVENTORY_AGE_MS,
  PLACEHOLDER_BRANCHES,
  dispose,
  isRegenerableIgnored,
  preflight,
  readGitState,
  rebuildCommand,
  resolveAvailability,
} from '../dispose-worktree.mjs';
// Imported from its own module, not re-exported: the test asserts against the
// same constant objects the generator writes into WORKTREES.json, so a rename of
// an action value breaks these cases rather than silently agreeing with them.
import { ACTION } from '../lib/worktree-inventory/classify.mjs';

const NOW = 1_800_000_000_000;

// Real files for the availability rule, which is about whether a path EXISTS —
// something no injected stub can express. Under the OS temp dir, never the repo.
const TMP = join(tmpdir(), 'dispose-worktree-availability');
mkdirSync(TMP, { recursive: true });
const writeFixture = (name, body) => {
  const p = join(TMP, name);
  writeFileSync(p, body);
  return p;
};

/** A target that every gate is happy about. One gate is broken per test. */
function greenState(overrides = {}) {
  return {
    found: true,
    name: 'task',
    path: '/repo/.kilo/worktrees/task',
    absolutePath: '/repo/.kilo/worktrees/task',
    branch: 'fix/task',
    detached: false,
    locked: false,
    prunableReason: null,
    tip: 'abc1234',
    isPrimary: false,
    commonDir: '/repo/.git',
    modified: 0,
    untracked: 0,
    dirtyPaths: [],
    statusError: null,
    ignoredPaths: [],
    ignoredWork: [],
    ...overrides,
  };
}

function greenInventory(overrides = {}) {
  return {
    ok: true,
    reason: null,
    generatedAt: new Date(NOW - 60_000).toISOString(),
    generatedAtMs: NOW - 60_000,
    record: { action: ACTION.DISPOSE, mustNotPrune: false, derivedLive: false, writeHistory: { derivedChatIds: [] } },
    ...overrides,
  };
}

const greenBoard = {
  available: true,
  dbPath: '/repo/.git/agent-board/board.db',
  error: null,
  claims: [],
  fileLocks: [],
  liveAgents: [],
};
const greenSessions = { available: true, dbPath: '/home/x/kilo.db', error: null, live: [] };

function green(overrides = {}) {
  return preflight({
    target: 'task',
    nowMs: NOW,
    gitState: greenState(),
    inventory: greenInventory(),
    board: greenBoard,
    sessions: greenSessions,
    ...overrides,
  });
}

/** The codes a verdict refused on, for concise assertions. */
const codes = (v) => v.failures.map((f) => f.code).sort();

describe('dispose preflight', () => {
  it('permits a worktree the inventory calls dispose and nobody is using', () => {
    const verdict = green();
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  describe('each signal refuses on its own, with every other signal green', () => {
    const cases = [
      ['the target is not a worktree at all', { gitState: { found: false } }, 'unknown-worktree'],
      ['it is the main checkout', { gitState: greenState({ isPrimary: true }) }, 'main-worktree'],
      ['HEAD is detached', { gitState: greenState({ detached: true, branch: '(detached)' }) }, 'detached'],
      ['there is no branch to delete', { gitState: greenState({ branch: '(unknown)' }) }, 'no-branch'],
      ['the inventory is absent', { inventory: { ok: false, reason: 'missing' } }, 'inventory-missing'],
      ['the inventory has no entry for it', { inventory: greenInventory({ record: null }) }, 'not-in-inventory'],
      [
        'the inventory is older than the limit',
        { inventory: greenInventory({ generatedAtMs: NOW - MAX_INVENTORY_AGE_MS - 1 }) },
        'inventory-stale',
      ],
      [
        'the inventory calls it in-use, which is what it was',
        {
          inventory: greenInventory({
            record: { action: ACTION.IN_USE, mustNotPrune: false, derivedLive: false, writeHistory: {} },
          }),
        },
        'action-not-dispose',
      ],
      [
        'the inventory calls it land, not dispose',
        {
          inventory: greenInventory({
            record: { action: ACTION.LAND, mustNotPrune: false, derivedLive: false, writeHistory: {} },
          }),
        },
        'action-not-dispose',
      ],
      [
        'the inventory calls it at-risk, which needs a human',
        {
          inventory: greenInventory({
            record: { action: ACTION.AT_RISK, mustNotPrune: false, derivedLive: false, writeHistory: {} },
          }),
        },
        'action-not-dispose',
      ],
      [
        'the inventory cannot tell, so it must not be removed',
        {
          inventory: greenInventory({
            record: { action: ACTION.UNDECIDED, mustNotPrune: false, derivedLive: false, writeHistory: {} },
          }),
        },
        'action-not-dispose',
      ],
      [
        'a curated finding protects it',
        {
          inventory: greenInventory({
            record: { action: ACTION.DISPOSE, mustNotPrune: true, derivedLive: false, writeHistory: {} },
          }),
        },
        'must-not-prune',
      ],
      [
        'the inventory says derived-live, which under --no-live-writers means a suppression rather than a clearance',
        {
          inventory: greenInventory({
            record: {
              action: ACTION.DISPOSE,
              mustNotPrune: false,
              derivedLive: true,
              writeHistory: { derivedChatIds: ['ses_abc'] },
            },
          }),
        },
        'derived-live-writer',
      ],
      [
        'the record carries a write history even where derivedLive was suppressed',
        {
          inventory: greenInventory({
            record: {
              action: ACTION.DISPOSE,
              mustNotPrune: false,
              derivedLive: false,
              writeHistory: { derivedChatIds: ['ses_abc'] },
            },
          }),
        },
        'derived-live-writer',
      ],
      [
        'it is git-locked, so somebody marked it not-to-be-touched',
        { gitState: greenState({ locked: 'reason: in use' }) },
        'locked',
      ],
      [
        'its directory is gone but git still lists it',
        { gitState: greenState({ prunableReason: 'gitdir file points to non-existent location' }) },
        'prunable',
      ],
      [
        'git cannot read a tip for it, so there is nothing to anchor',
        { gitState: greenState({ tip: null }) },
        'no-tip',
      ],
      ['a live session is in it', { sessions: { available: true, live: [{ id: 's1' }] } }, 'live-session'],
      [
        'a board agent was seen in it',
        { board: { ...greenBoard, liveAgents: [{ agentId: 'a1' }] } },
        'board-agent-live',
      ],
      ['a board claim names it', { board: { ...greenBoard, claims: [{ agentId: 'a1' }] } }, 'board-claim'],
      ['a board file lock names it', { board: { ...greenBoard, fileLocks: [{ path: 'a.ts' }] } }, 'board-lock'],
      [
        'it went dirty after the inventory was written',
        { gitState: greenState({ modified: 1, untracked: 0, dirtyPaths: ['.skills/hard-merge.md'] }) },
        'dirty-tree',
      ],
      [
        'it gained an untracked file after the inventory was written',
        { gitState: greenState({ modified: 0, untracked: 1, dirtyPaths: ['notes.md'] }) },
        'dirty-tree',
      ],
    ];

    for (const [when, overrides, expected] of cases) {
      it(`refuses when ${when}`, () => {
        const verdict = green(overrides);
        expect(codes(verdict)).toContain(expected);
        expect(verdict.ok).toBe(false);
      });
    }
  });

  it('refuses the exact shape that destroyed the worktree: a clean tree, a live session, and a branch nobody read', () => {
    // `.kilo/worktrees/stale-citations` on `fix/stale-citations`, 30 minutes old,
    // `git status --porcelain` empty, and two unreleased file locks. Every signal
    // a cleanliness probe cannot produce.
    const verdict = preflight({
      target: 'stale-citations',
      nowMs: NOW,
      gitState: greenState({
        name: 'stale-citations',
        branch: 'fix/stale-citations',
        absolutePath: '/repo/.kilo/worktrees/stale-citations',
        tip: '201e985b',
        modified: 0,
        untracked: 0,
      }),
      inventory: greenInventory({ record: { action: ACTION.DISPOSE, mustNotPrune: false } }),
      board: {
        available: true,
        claims: [],
        liveAgents: [{ agentId: 'fix/stale-citations', live: true }],
        fileLocks: [
          { path: '.skills/hard-merge.md', agentId: 'fix/stale-citations' },
          { path: '.skills/photoshop-tool-creation.md', agentId: 'fix/stale-citations' },
        ],
      },
      sessions: { available: true, live: [{ id: 'ses_f0bd', title: 'Worktree Skills Review' }] },
    });

    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(['board-agent-live', 'board-lock', 'live-session']);
    // The messages have to name the evidence, or an operator cannot act on them.
    const locks = verdict.failures.find((f) => f.code === 'board-lock');
    expect(locks.message).toContain('2 live file lock(s)');
    expect(locks.message).toContain('released by the agent that took them');
  });

  it('reports every failing gate, not just the first', () => {
    const verdict = preflight({
      target: 'task',
      nowMs: NOW,
      gitState: greenState({ isPrimary: true, modified: 2, dirtyPaths: ['a', 'b'] }),
      inventory: { ok: false, reason: 'missing' },
      board: { ...greenBoard, claims: [{ agentId: 'x' }] },
      sessions: { available: true, live: [{ id: 's' }] },
    });
    expect(codes(verdict)).toEqual(['board-claim', 'dirty-tree', 'inventory-missing', 'live-session', 'main-worktree']);
  });

  it('gives every refusal a non-empty message', () => {
    const verdict = green({
      inventory: { ok: false, reason: 'missing' },
      sessions: { available: true, live: [{ id: 's' }] },
    });
    for (const failure of verdict.failures) {
      expect(failure.message.length).toBeGreaterThan(20);
      expect(failure.message).not.toMatch(/undefined|\[object Object\]/);
    }
  });

  it('refuses when the board is unreadable, because zero rows is not an unowned worktree', () => {
    // The regression test for the fail-open this change originally shipped.
    // `readBoard` degrades to empty rather than throwing — correct for the
    // generator — so a missing `board.db` produced zero rows, and zero rows was
    // indistinguishable from "nobody owns this". Verified before the fix: with
    // both databases absent and a valid `dispose` record present, the guard
    // printed "is clear to dispose", exited 0, and would have removed it.
    const verdict = green({
      board: {
        available: false,
        dbPath: '/repo/.git/agent-board/board.db',
        error: null,
        claims: [],
        fileLocks: [],
        liveAgents: [],
      },
    });
    expect(codes(verdict)).toEqual(['board-unavailable']);
    expect(verdict.failures[0].message).toContain('board.db');
    expect(verdict.failures[0].message).toContain('not an unowned worktree');
  });

  it('refuses when the session database is unreadable, and names THAT database', () => {
    const verdict = green({ sessions: { available: false, dbPath: '/home/x/kilo.db', error: null, live: [] } });
    expect(codes(verdict)).toEqual(['sessions-unavailable']);
    expect(verdict.failures[0].message).toContain('/home/x/kilo.db');
  });

  it('reports a dirty tree as well when both sources are unreadable', () => {
    const verdict = green({
      board: { available: false, dbPath: '/b.db', error: null, claims: [], fileLocks: [], liveAgents: [] },
      sessions: { available: false, dbPath: '/s.db', error: null, live: [] },
      gitState: greenState({ modified: 1, dirtyPaths: ['a'] }),
    });
    expect(codes(verdict)).toEqual(['board-unavailable', 'dirty-tree', 'sessions-unavailable']);
  });

  it('accepts an inventory exactly at the age limit and refuses one millisecond past it', () => {
    expect(green({ inventory: greenInventory({ generatedAtMs: NOW - MAX_INVENTORY_AGE_MS }) }).ok).toBe(true);
    expect(green({ inventory: greenInventory({ generatedAtMs: NOW - MAX_INVENTORY_AGE_MS - 1 }) }).ok).toBe(false);
  });

  it('refuses an inventory whose generatedAt is unparseable rather than treating it as fresh', () => {
    const verdict = green({ inventory: greenInventory({ generatedAt: 'not-a-date', generatedAtMs: NaN }) });
    expect(codes(verdict)).toContain('inventory-stale');
  });
});

describe('ownership-source availability', () => {
  // The rule that keeps the fail-open closed without making the tool unusable.
  // Refusing on a board that has never existed would block every fresh clone,
  // since `board.mjs` documents a missing board as a normal state; refusing only
  // when rows exist behind an unreadable database is what closes the hole the
  // incident went through.
  it('treats a database that has never existed as available and empty', () => {
    const missing = join(TMP, 'no-such-dir', 'board.db');
    expect(resolveAvailability({ dbPath: missing, available: false })).toEqual({
      available: true,
      neverExisted: true,
      error: null,
    });
  });

  it('refuses a database that EXISTS but cannot be read', () => {
    const present = writeFixture('board.db', 'not a database at all');
    const verdict = resolveAvailability({ dbPath: present, available: false, error: 'file is not a database' });
    expect(verdict.available).toBe(false);
    expect(verdict.neverExisted).toBe(false);
    expect(verdict.error).toBe('file is not a database');
  });

  it('refuses a present database with no error text rather than inventing one', () => {
    const present = writeFixture('board.db', 'x');
    expect(resolveAvailability({ dbPath: present, available: false }).error).toBe('present but unreadable');
  });

  it('accepts a readable database whatever it returned, empty or not', () => {
    const present = writeFixture('board.db', 'x');
    expect(resolveAvailability({ dbPath: present, available: true, error: 'ignored' })).toEqual({
      available: true,
      neverExisted: false,
      error: null,
    });
  });

  it('refuses a null path that reported unavailable, since there is nothing to prove was absent', () => {
    expect(resolveAvailability({ dbPath: null, available: false }).available).toBe(false);
  });
});

describe('dispose execution', () => {
  /**
   * A runner that records what it was asked and answers from a table, paired
   * with a filesystem that records instead of writing. `dispose()` touches both,
   * so a test that injected only the runner would create `/repo/.git/...` on the
   * machine running the suite — which is why the pair is never separated here.
   */
  function harness(answers = {}) {
    const calls = [];
    const writes = [];
    const run = (cwd, args, opts = {}) => {
      calls.push(args);
      const answer = answers[args.join(' ')] ?? answers[`${args[0]} ${args[1]}`];
      if (answer instanceof Error) throw answer;
      return { stdout: typeof answer === 'string' ? answer : '' };
    };
    const fs = {
      mkdirSync() {},
      writeFileSync(p, data) {
        writes.push({ p, bytes: data.length });
      },
    };
    return { run, fs, calls, writes };
  }

  it('anchors the tip before it removes anything, so no gc can make it unreachable', () => {
    const { run, fs, calls } = harness();
    dispose('/repo', greenState({ tip: 'deadbeef' }), { run, fs });

    const anchorAt = calls.findIndex((c) => c[0] === 'update-ref');
    const removeAt = calls.findIndex((c) => c[0] === 'worktree' && c[1] === 'remove');
    expect(anchorAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThan(anchorAt);
    expect(calls[anchorAt]).toEqual(['update-ref', `${KEEP_REF_PREFIX}fix-task`, 'deadbeef']);
  });

  it('anchors under the BRANCH, slugged, and validates the ref before writing it', () => {
    // A worktree directory with a space used to produce
    // `fatal: update_ref failed for ref 'refs/keep/disposed/wt space'`, and a
    // crash in the guard is a bypass. The branch is the better source anyway:
    // it is what the anchor has to name.
    const { run, fs, calls } = harness();
    dispose('/repo', greenState({ branch: 'feat/space branch', name: 'wt space' }), { run, fs });
    expect(calls.find((c) => c[0] === 'update-ref')).toEqual([
      'update-ref',
      `${KEEP_REF_PREFIX}feat-space-branch`,
      'abc1234',
    ]);
    // `check-ref-format` must be asked BEFORE `update-ref`, not after it throws.
    expect(calls.findIndex((c) => c[0] === 'check-ref-format')).toBeLessThan(
      calls.findIndex((c) => c[0] === 'update-ref')
    );
  });

  it('writes no anchor when even the slugged ref is invalid', () => {
    const { run, fs, calls } = harness({ 'check-ref-format refs/keep/disposed/weird': new Error('bad name') });
    dispose('/repo', greenState({ branch: '(weird)', name: '(weird)' }), { run, fs });
    expect(calls.some((c) => c[0] === 'update-ref')).toBe(false);
  });

  it('never passes --force or -f to worktree remove', () => {
    const { run, fs, calls } = harness();
    dispose('/repo', greenState(), { run, fs });
    for (const call of calls) {
      expect(call).not.toContain('--force');
      expect(call).not.toContain('-f');
    }
  });

  it('deletes the branch with -d, and keeps it when git refuses', () => {
    const ok = harness();
    const kept = harness({ 'branch -d fix/task': new Error("error: the branch 'fix/task' is not fully merged") });

    const deleted = dispose('/repo', greenState(), { run: ok.run, fs: ok.fs });
    expect(deleted.branchDeleted).toBe(true);
    expect(ok.calls.some((c) => c.join(' ') === 'branch -d fix/task')).toBe(true);
    expect(ok.calls.some((c) => c.includes('-D'))).toBe(false);

    const refused = dispose('/repo', greenState(), { run: kept.run, fs: kept.fs });
    expect(refused.branchDeleted).toBe(false);
    expect(refused.steps.join('\n')).toContain('KEPT branch fix/task');
    // The anchor is what makes a kept branch recoverable, so it must be reported.
    expect(refused.steps.join('\n')).toContain(KEEP_REF_PREFIX);
  });

  it('salvages a binary-safe patch and an untracked archive, and lists what it wrote', () => {
    const h = harness({
      'diff HEAD --binary': 'diff --git a/x.png b/x.png\n',
      'ls-files --others --exclude-standard -z': 'notes.md\0',
    });
    const tars = [];
    const result = dispose('/repo', greenState(), { run: h.run, fs: h.fs, tar: (...a) => tars.push(a) });

    expect(result.salvage.written.sort()).toEqual(['tracked.patch', 'untracked.tar']);
    expect(result.salvage.failed).toEqual([]);
    expect(result.salvage.dir).toBe('/repo/.git/worktree-salvage/task');
    expect(h.writes.map((w) => w.p)).toEqual(['/repo/.git/worktree-salvage/task/tracked.patch']);
    // `tar`, never `git tar` — verified `git: 'tar' is not a git command`. The
    // swallowed failure made a partial salvage report itself as a success.
    expect(tars).toHaveLength(1);
    expect(tars[0][1]).toBe('/repo/.git/worktree-salvage/task/untracked.tar');
    expect(h.calls.some((c) => c.includes('tar'))).toBe(false);
  });

  it('REPORTS the half of a salvage that failed instead of listing a partial success', () => {
    const h = harness({
      'diff HEAD --binary': 'diff --git a/x b/x\n',
      'ls-files --others --exclude-standard -z': 'notes.md\0',
    });
    const result = dispose('/repo', greenState(), {
      run: h.run,
      fs: h.fs,
      tar: () => {
        throw new Error('Command failed: tar\ntar: /nope: Cannot open: No such file or directory');
      },
    });
    expect(result.salvage.written).toEqual(['tracked.patch']);
    expect(result.salvage.failed).toHaveLength(1);
    expect(result.salvage.failed[0]).toContain('untracked.tar');
    // And the caller says so out loud rather than returning quietly.
    expect(result.steps.join('\n')).toContain('SALVAGE INCOMPLETE');
  });

  it('salvages nothing, and says so, when there is nothing uncommitted', () => {
    const h = harness({ 'diff HEAD --binary': '', 'ls-files --others --exclude-standard -z': '' });
    const tars = [];
    const result = dispose('/repo', greenState(), { run: h.run, fs: h.fs, tar: (...a) => tars.push(a) });
    expect(result.salvage).toBeNull();
    expect(h.writes).toEqual([]);
    expect(tars).toEqual([]);
  });

  it('reports a FAILED worktree removal as text instead of throwing, and deletes no branch', () => {
    // `git worktree remove` used to be called with no try/catch, so a locked
    // worktree produced an uncaught stack trace AFTER the anchor ref had been
    // written — and git's own message on that path reads "use 'remove -f -f' to
    // override", the flag this program exists to deny.
    const { run, fs } = harness({
      'worktree remove /repo/.kilo/worktrees/task': new Error(
        "Command failed: git worktree remove\nfatal: cannot remove a locked working tree;\nuse 'remove -f -f' to override or unlock first"
      ),
    });
    const result = dispose('/repo', greenState(), { run, fs });

    expect(result.worktreeRemoved).toBe(false);
    expect(result.branchDeleted).toBe(false);
    expect(result.steps.join('\n')).toContain('KEPT worktree');
    expect(result.steps.join('\n')).toContain('cannot remove a locked working tree');
    // The branch is still there and still recoverable at its anchor.
    expect(result.steps.join('\n')).toContain(KEEP_REF_PREFIX);
  });

  it('skips the anchor when there is no tip to anchor', () => {
    const h = harness();
    const result = dispose('/repo', greenState({ tip: null }), { run: h.run, fs: h.fs });
    expect(h.calls.some((c) => c[0] === 'update-ref')).toBe(false);
    expect(result.anchorRef).toBeNull();
  });

  it('removes the worktree even when the branch deletion is refused, and reports both', () => {
    const h = harness({ 'branch -d fix/task': new Error('not fully merged') });
    const result = dispose('/repo', greenState(), { run: h.run, fs: h.fs });
    expect(h.calls.some((c) => c.join(' ') === 'worktree remove /repo/.kilo/worktrees/task')).toBe(true);
    expect(result.branchDeleted).toBe(false);
  });
});

/**
 * The four fail-open holes, each with the command that produced it.
 *
 * Every one of these was a direction where an ABSENT signal became an EMPTY one,
 * and empty is what "safe" looks like to the next gate.
 */
describe('a signal that could not be read is not an empty signal', () => {
  it('refuses when git status failed, rather than reading zero counts as clean', () => {
    // `statusError` was written at three places and read at none, so a status
    // call that failed for ANY reason left modified and untracked at 0 — and 0
    // is exactly what a clean tree reports. Nothing downstream could tell them
    // apart, because the only difference was in a field nobody looked at.
    const verdict = green({ gitState: greenState({ statusError: 'fatal: not a git repository' }) });
    expect(codes(verdict)).toContain('dirty-tree-unreadable');
    expect(verdict.ok).toBe(false);
    expect(verdict.failures.find((f) => f.code === 'dirty-tree-unreadable').message).toMatch(
      /UNKNOWN rather than clean/
    );
  });

  it('still permits a clean tree, so the unreadable rule is not a blanket refusal', () => {
    expect(green().ok).toBe(true);
    expect(codes(green({ gitState: greenState({ statusError: null }) }))).toEqual([]);
  });

  it('refuses on gitignored content that no command rebuilds', () => {
    // `git status --porcelain` honours .gitignore, and `ls-files --others
    // --exclude-standard` — which is what salvage() reads — honours it too. So a
    // worktree holding only a `.env` reported zero dirty paths, passed the gate,
    // and was archived by nothing, and `git worktree remove` deleted it.
    const verdict = green({ gitState: greenState({ ignoredWork: ['.env', 'notes.local'] }) });
    expect(codes(verdict)).toContain('ignored-content');
    expect(verdict.failures.find((f) => f.code === 'ignored-content').message).toMatch(
      /no commit, no ref and no reflog/
    );
  });

  it('permits a worktree holding only what a command rebuilds', () => {
    // THE CONSTRAINT THAT SHAPED THIS RULE. Measured on a real worktree in this
    // repository: 53 ignored entries, of which 33 under node_modules/ and 18
    // under dist/. A guard with no exceptions refuses every worktree, and an
    // earlier review here already shipped that mistake with the board database.
    const verdict = green({
      gitState: greenState({
        ignoredPaths: ['node_modules/vite/index.js', 'dist/assets/x.js', 'tsconfig.tsbuildinfo'],
        ignoredWork: [],
      }),
    });
    expect(verdict.ok).toBe(true);
  });
});

describe('the regenerable-ignored rule', () => {
  it('treats every ignore pattern it does not name as content', () => {
    // The allowlist is the exception, not the rule: an unlisted path is work.
    for (const path of [
      '.serena/index.db',
      '.vscode/settings.json',
      'playwright/.auth/state.json',
      'run.log',
      'scratch.local',
    ]) {
      expect(isRegenerableIgnored(path), `${path} must not be treated as regenerable`).toBe(false);
    }
  });

  it('names a rebuild command for everything it does treat as regenerable', () => {
    for (const path of ['node_modules/a.js', 'dist/assets/x.css', 'coverage/lcov.info', 'tsconfig.tsbuildinfo']) {
      expect(isRegenerableIgnored(path)).toBe(true);
      expect(rebuildCommand(path), `${path} must name how it is rebuilt`).toBeTruthy();
    }
  });

  it('does not let a regenerable prefix cover a sibling that merely starts with it', () => {
    // `dist/` must not exempt `dist-secrets/`, or adding a dot to the prefix
    // would quietly widen what a disposal is allowed to destroy.
    expect(isRegenerableIgnored('dist-secrets/keys.txt')).toBe(false);
    expect(isRegenerableIgnored('node_modules/.cache/x')).toBe(true);
  });
});

describe('a bare name that identifies two worktrees identifies neither', () => {
  it('refuses rather than disposing the first match', () => {
    // Git refuses two worktrees at the same PATH, so a path is unique; it says
    // nothing about a basename, and this repo registers worktrees under
    // .kilo/worktrees/ AND under the temp directory. `Array.find` returned the
    // first and printed "dispose: gamma disposed. EXIT=0" — the wrong worktree,
    // reported as success.
    const entries = [
      { path: '/private/tmp/vC/other/gamma', branch: 'c' },
      { path: '/repo/.kilo/worktrees/gamma', branch: 'fix/task' },
    ];
    const state = readGitState('/repo', 'gamma', {
      list: () => entries,
      run: () => ({ stdout: 'abc1234' }),
    });
    expect(state.found).toBe(false);
    expect(state.ambiguous).toBe(true);
    expect(state.candidates).toEqual(['/private/tmp/vC/other/gamma', '/repo/.kilo/worktrees/gamma']);
  });

  it('still resolves a bare name that identifies exactly one worktree', () => {
    const state = readGitState('/repo', 'task', {
      list: () => [{ path: '/repo/.kilo/worktrees/task', branch: 'fix/task' }],
      run: () => ({ stdout: 'abc1234' }),
    });
    expect(state.found).toBe(true);
    expect(state.absolutePath).toBe('/repo/.kilo/worktrees/task');
  });
});

describe('the anchor is the only recovery point, so it may not be overwritten', () => {
  const harness = (answers = {}) => {
    const calls = [];
    const run = (cwd, args) => {
      calls.push(args);
      const answer = answers[args.join(' ')] ?? '';
      if (answer instanceof Error) throw answer;
      return { stdout: typeof answer === 'string' ? answer : '' };
    };
    const fs = { mkdirSync() {}, writeFileSync() {} };
    return { run, fs, calls };
  };

  it('keeps the bare slug when the ref is free, so no written-down path moves', () => {
    const h = harness();
    dispose('/repo', greenState({ branch: 'feat/marble' }), { run: h.run, fs: h.fs });
    const written = h.calls.find((c) => c[0] === 'update-ref');
    expect(written[1]).toBe(`${KEEP_REF_PREFIX}feat-marble`);
  });

  it('disambiguates when a DIFFERENT branch already owns that slug', () => {
    // refSlug collapses '/', ' ' and every other run to one '-', and '-' is legal
    // in a branch name, so feat/marble, 'feat marble' and feat-marble all slug
    // to feat-marble. Two collisions overwrite the first disposal's only
    // recovery point, and `git branch recover` then hands back the wrong commit.
    const occupied = 'a1b2c3d4e5';
    const h = harness({ [`rev-parse --verify --quiet ${KEEP_REF_PREFIX}feat-marble`]: occupied });
    dispose('/repo', greenState({ branch: 'feat-marble', tip: 'deadbeef' }), { run: h.run, fs: h.fs });
    const written = h.calls.find((c) => c[0] === 'update-ref');
    expect(written[1]).not.toBe(`${KEEP_REF_PREFIX}feat-marble`);
    expect(written[1]).toMatch(new RegExp(`^${KEEP_REF_PREFIX}feat-marble-g[0-9a-f]{9}$`));
    // And it did not silently move the existing one.
    expect(h.calls.some((c) => c[0] === 'update-ref' && c[1] === `${KEEP_REF_PREFIX}feat-marble`)).toBe(false);
  });

  it('re-anchors the SAME branch without a suffix, because there is nothing to protect', () => {
    const h = harness({ [`rev-parse --verify --quiet ${KEEP_REF_PREFIX}fix-task`]: 'abc1234' });
    dispose('/repo', greenState({ branch: 'fix/task', tip: 'abc1234' }), { run: h.run, fs: h.fs });
    const written = h.calls.find((c) => c[0] === 'update-ref');
    expect(written[1]).toBe(`${KEEP_REF_PREFIX}fix-task`);
  });
});

/**
 * The ignored-file WIRING, through `readGitState` rather than around it.
 *
 * These exist because the first version of this rule had no test at all, and a
 * reviewer's mutation run proved why that mattered: eight mutants were tried and
 * four survived, including parsing the git output with the WRONG delimiter. Every
 * earlier case injected `ignoredWork` directly, so the code that turns git's
 * stdout into a list of paths was never executed by a single test — and it
 * returned ONE element where there were 394, so the gate consulted the
 * lexicographically first path and passed whenever that one happened to be
 * allowlisted. A guard that is only tested through a hand-built verdict is a
 * guard whose seam is untested.
 */
describe('readGitState reads the ignored content it is supposed to refuse on', () => {
  const stateWith = (lsFilesStdout) =>
    readGitState('/repo', 'task', {
      list: () => [{ path: '/repo/.kilo/worktrees/task', branch: 'fix/task' }],
      run: (cwd, args) => {
        if (args[0] === 'status') return { stdout: '' };
        if (args[0] === 'ls-files') return { stdout: lsFilesStdout };
        return { stdout: 'abc1234' };
      },
    });

  it('asks git for NUL-separated output, and passes --directory', () => {
    // Without `-z` git emits NEWLINE-separated paths, and a NUL split of that
    // is a single element containing every path joined by newlines. The gate then
    // tested one blob against the allowlist instead of 394 paths. `--directory`
    // collapses `node_modules/` to one entry, which is both correct for a nested
    // directory and the difference between 1000 lines and 1.
    const seen = [];
    readGitState('/repo', 'task', {
      list: () => [{ path: '/repo/.kilo/worktrees/task', branch: 'fix/task' }],
      run: (cwd, args) => {
        if (args[0] === 'ls-files') seen.push(args);
        return { stdout: args[0] === 'ls-files' ? '' : 'abc1234' };
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('-z');
    expect(seen[0]).toContain('--directory');
    expect(seen[0]).toContain('--ignored');
  });

  it('separates a real path list, not one joined blob', () => {
    // The exact shape that defeated the first version: the FIRST entry sorts
    // before the rest and is allowlisted, so a blob made the gate pass.
    const state = stateWith('coverage/lcov.info\0node_modules\0run.log\0');
    expect(state.ignoredPaths).toEqual(['coverage/lcov.info', 'node_modules', 'run.log']);
    // And the refusal is computed from that list.
    expect(state.ignoredWork).toEqual(['run.log']);
  });

  it('refuses the tree it just read, through preflight', () => {
    const state = stateWith('coverage/lcov.info\0node_modules\0run.log\0');
    const verdict = preflight({
      target: 'task',
      nowMs: NOW,
      gitState: state,
      inventory: greenInventory(),
      board: greenBoard,
      sessions: greenSessions,
    });
    expect(codes(verdict)).toContain('ignored-content');
    const message = verdict.failures.find((f) => f.code === 'ignored-content').message;
    // Both halves of the count have to agree, or the operator is told "1 path"
    // and shown three.
    expect(message).toMatch(/^The working tree holds 1 gitignored path/);
    expect(message).toContain('run.log');
  });

  it('permits a tree whose ignored content a command rebuilds', () => {
    // The shape of every real worktree: node_modules and dist and a buildinfo.
    const state = stateWith('node_modules\0dist\0tsconfig.tsbuildinfo\0coverage\0.kilo/\0');
    expect(state.ignoredWork).toEqual([]);
    expect(state.ignoredPaths.length).toBe(5);
  });

  it('does not let a regenerable name cover a sibling that merely starts with it', () => {
    // `--directory` reports `dist-secrets/` as one entry. It is one character
    // away from the build output and is exactly where a secret would live.
    expect(stateWith('dist-secrets/\0').ignoredWork).toEqual(['dist-secrets/']);
    expect(stateWith('node_modules_backup/\0').ignoredWork).toEqual(['node_modules_backup/']);
    expect(stateWith('dist/\0').ignoredWork).toEqual([]);
  });

  it('recognises a nested path inside a regenerable directory', () => {
    // git matches these patterns at any depth, so a worktree's own
    // node_modules sits inside the checkout that contains it.
    expect(isRegenerableIgnored('packages/app/node_modules/react/index.js')).toBe(true);
    expect(isRegenerableIgnored('src/dist-secrets/keys.txt')).toBe(false);
  });
});

describe('the anchor survives two disposals of one branch name', () => {
  const runner = (existing) => {
    const calls = [];
    const run = (cwd, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === '--verify') return { stdout: existing ?? '' };
      return { stdout: '' };
    };
    return { run, fs: { mkdirSync() {}, writeFileSync() {} }, calls };
  };

  it('writes a DIFFERENT ref each time the same branch advances to a new tip', () => {
    // Reachable: `git branch -d` refuses an unmerged branch, so the branch
    // survives a disposal, gets more work, and is disposed again. Hashing the
    // branch NAME gave every one of those disposals the same suffix, so the
    // second overwrote the first's only recovery point.
    //
    // THREE disposals, not two, and that is the point: a two-disposal test
    // passes under a name-only hash by accident, because the FIRST disposal
    // finds a free slug and writes the bare name. The collision needs the slug
    // already taken, which is only true from the second disposal onward.
    const refsFor = (existing, tip) => {
      const r = runner(existing);
      dispose('/repo', greenState({ branch: 'feat/marble', tip }), r);
      return r.calls.find((c) => c[0] === 'update-ref')[1];
    };

    const first = refsFor('', '457bfd4');
    expect(first).toBe(`${KEEP_REF_PREFIX}feat-marble`);

    const second = refsFor(first === `${KEEP_REF_PREFIX}feat-marble` ? '457bfd4' : first, 'a4d9306');
    expect(second).toMatch(new RegExp(`^${KEEP_REF_PREFIX}feat-marble-g[0-9a-f]{9}$`));

    // The bare ref still points at the FIRST tip, so the third disposal also
    // finds the slug taken — and must not land on the second's ref.
    const third = refsFor('457bfd4', 'f8d779a');
    expect(third).not.toBe(second);
    expect(third).toMatch(new RegExp(`^${KEEP_REF_PREFIX}feat-marble-g[0-9a-f]{9}$`));
  });
});
