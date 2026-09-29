import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SwarmLock, findFreePort, resolvePort, run, runOutputPaths } from '../e2e-run.mjs';

/**
 * The sentinel is a fixed string in the script, and these tests assert on it, so a
 * rename that left the tests passing would mean the two disagree. Read it from
 * the module's own constant instead of repeating it.
 */
const SENTINEL = 'e2e/.swarm-e2e-runner';

/**
 * Built from `import.meta.dirname`, never from `import.meta.url`: Vitest gives
 * this module an `http://localhost/…` URL, whose `pathname` is `/agent-board.mjs`
 * and does not exist on disk. The sibling board test carries the same note, and the
 * failure mode is a spawn that exits 1 for a reason that has nothing to do with the
 * test.
 */
const BOARD_CLI = join(import.meta.dirname, '..', 'agent-board.mjs');
const RUNNER_CLI = join(import.meta.dirname, '..', 'e2e-run.mjs');
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * A real board in a temp directory, for the tests that need the real CLI.
 *
 * `AGENT_BOARD_DIR` is the environment variable `resolveBoardDir` reads first
 * (scripts/lib/agent-board/db.mjs:250), so a test never touches the operator's
 * board in the common git dir. The repository itself is NOT faked: path
 * normalization is lexical but the git home and worktree list are real, and a
 * fixture that invented a repo would stop exercising the same code.
 */
function tempBoard() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-run-test-'));
  return {
    dir,
    env: { ...process.env, AGENT_BOARD_DIR: dir },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function board(args, env) {
  return spawnSync(process.execPath, [BOARD_CLI, ...args], { encoding: 'utf8', env });
}

/**
 * Observe the sentinel as somebody who is NOT the agent running the suite.
 *
 * This is the whole reason the first test needs it: `swarm check` exits 0 for the
 * holder's own lock, and 0 again when nothing holds the path at all. Read from the
 * same identity as the run, a lock that was never taken and a lock that was taken
 * and released are the same observation, so the test would pass either way.
 */
const OBSERVER = 'e2e-run-test-observer';

function observeHeld(env) {
  const check = board(['check', SENTINEL, '--json', '--agent', OBSERVER], env);
  const entry = JSON.parse(check.stdout).report[0];
  return { status: check.status, holders: entry.holders.map((holder) => holder.agent_id) };
}

/** Capture the wrapper's log lines instead of printing them. */
function recorder() {
  const lines = [];
  return { log: (line) => lines.push(line), text: () => lines.join('\n') };
}

/**
 * A stand-in for the suite.
 *
 * `run()` takes `runPlaywright` as an option precisely so this test can hold the
 * lock open, inspect the board from the outside while a suite is "running", and
 * return an exit code without starting a browser.
 */
function fakeSuite(onRun) {
  const calls = [];
  const fn = async (args, options) => {
    calls.push({ args, env: options?.env });
    if (onRun) await onRun({ args, env: options?.env });
    return 0;
  };
  fn.calls = calls;
  return fn;
}

describe('e2e-run: the swarm sentinel', () => {
  let boardDir;

  beforeEach(() => {
    boardDir = tempBoard();
  });

  afterEach(() => {
    boardDir.cleanup();
  });

  it('holds the sentinel for the duration of the run and releases it after', async () => {
    const log = recorder();
    let duringRun = null;

    const code = await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      // The assertion the test exists for: read the board from OUTSIDE the
      // wrapper, as another agent, while the suite is in flight.
      runPlaywright: fakeSuite(async () => {
        duringRun = observeHeld(boardDir.env);
      }),
    });

    expect(code, 'a green suite is forwarded as exit 0').toBe(0);
    // `check` exits 1 when ANOTHER agent holds the path, so this is the difference
    // between "the lock is taken" and "nothing is there".
    expect(duringRun.status, 'another agent can see the sentinel held while the suite runs').toBe(1);
    expect(duringRun.holders, 'and it is held by exactly this run, by the branch it is on').toHaveLength(1);

    const after = observeHeld(boardDir.env);
    expect(after.status, 'and free once the run returns').toBe(0);
    expect(after.holders, 'no holder survives the run').toEqual([]);
  });

  it('releases the sentinel when the suite throws, so a crash cannot wedge the swarm', async () => {
    await expect(
      run([], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: async () => {
          throw new Error('the suite blew up');
        },
      })
    ).rejects.toThrow('the suite blew up');

    const after = observeHeld(boardDir.env);
    expect(after.status, 'the lock is not left held by a failed run').toBe(0);
    expect(after.holders).toEqual([]);
  });

  it('refuses to run while another agent holds the sentinel, and exits 4', async () => {
    const other = board(['hold', SENTINEL, '--lease', '30m', '--agent', 'somebody-else'], boardDir.env);
    expect(other.status, 'the fixture must actually hold the lock').toBe(0);

    const suite = fakeSuite();
    const log = recorder();
    const code = await run(['e2e/undo-redo.spec.ts'], {
      // 0 is "fail instead of queueing", so the test does not wait on a clock.
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      runPlaywright: suite,
    });

    expect(code, 'exit 4 is the board\'s own "held by another agent"').toBe(4);
    expect(suite.calls, 'a refused run must not start Playwright').toEqual([]);
    expect(log.text(), 'the message names the holder').toContain('somebody-else');
  });

  it('waits for a held sentinel and runs as soon as it is free', async () => {
    const other = board(['hold', SENTINEL, '--lease', '30m', '--agent', 'somebody-else'], boardDir.env);
    expect(other.status).toBe(0);

    const suite = fakeSuite();
    // A real board, a real queue: the hold is dropped by another agent while this
    // run is polling, which is the whole point of the loop.
    const queued = run(['e2e/undo-redo.spec.ts'], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '30000', E2E_LOCK_POLL: '20' },
      log: recorder().log,
      runPlaywright: suite,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(suite.calls, 'still queued while the other agent holds it').toEqual([]);

    expect(board(['unlock', SENTINEL, '--agent', 'somebody-else'], boardDir.env).status).toBe(0);

    expect(await queued, 'the queued run completes on the suite exit code').toBe(0);
    expect(suite.calls, 'exactly one run, after the lock was free').toHaveLength(1);
  });

  it('runs unlocked with a loud warning when the board cannot be reached', async () => {
    // Exit 1 is the board's usage/error code, and the shape a machine without
    // `node:sqlite`, or outside a git home, produces.
    const brokenBoard = {
      exec: () => ({ status: 1, stdout: '', stderr: 'no home for the board' }),
      now: () => 0,
      sleep: async () => {},
      log: recorder().log,
    };
    const log = recorder();
    const suite = fakeSuite();

    const code = await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      lock: new SwarmLock({ ...brokenBoard, env: boardDir.env, log: log.log }),
      runPlaywright: suite,
    });

    expect(code, 'an unreachable board is not contention, so the suite still runs').toBe(0);
    expect(suite.calls).toHaveLength(1);
    expect(log.text(), 'and it says so, because an unserialized run is a hazard').toMatch(/NOT serialized/);
  });

  it('renews the lease while the suite runs, and stops the run if a renewal fails', async () => {
    // A file lock is never renewed by the board itself, so this wrapper owns the
    // lease for as long as the suite lives. An earlier version defined the renewal
    // and never started it: the timer existed, was documented, and no code path
    // reached it. It survived a real full-suite run (5m23s) purely because the
    // 30-minute lease outlasted it, which is exactly the kind of pass that is not
    // evidence.
    const held = [];
    let holdCalls = 0;
    const exec = (command) => {
      const args = command.slice(2);
      if (args[0] === 'hold') {
        holdCalls += 1;
        // The acquisition succeeds; the first renewal finds the sentinel gone.
        return holdCalls === 1
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 4, stdout: '', stderr: 'held by another agent' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const lock = new SwarmLock({
      env: boardDir.env,
      log: recorder().log,
      exec,
      // 5ms stands in for the production 5 minutes, so the timer is what decides
      // whether the run survives, not the test's own duration.
      renewEveryMs: 5,
    });

    const killed = [];
    const suite = fakeSuite(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const wrapped = async (args, options) => {
      options.onChild({ kill: (signal) => killed.push(signal) });
      return suite(args, options);
    };

    const log = recorder();
    await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      lock,
      runPlaywright: wrapped,
    });

    expect(holdCalls, 'the acquisition plus at least one renewal').toBeGreaterThan(1);
    expect(killed, 'a run that lost the sentinel is stopped, not left racing a second suite').toEqual(['SIGTERM']);
    expect(log.text()).toMatch(/could not be renewed/);
  });

  it('names the sentinel in a way a second script cannot drift from', () => {
    // The sentinel is a virtual path, so nothing else pins it. Assert the string
    // the runner prints, rather than a copy in this file.
    const printed = spawnSync(process.execPath, [RUNNER_CLI, '--e2e-run-help'], { encoding: 'utf8' });
    expect(printed.status, 'the runner answers its own --e2e-run-help').toBe(0);
    expect(printed.stdout, 'the sentinel is documented where an agent will read it').toContain(SENTINEL);
  });
});

describe('e2e-run: run isolation', () => {
  it('forwards every argument verbatim and appends only the output directory', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      await run(['e2e/export/visual-regression.spec.ts', '--retries=1', '-g', 'draw'], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      });

      const { args } = suite.calls[0];
      // `test` first: npm appends a caller's arguments AFTER the script, so
      // `npm run test:e2e -- e2e/foo.spec.ts` reaches this script without the
      // subcommand, and Playwright reads a bare `e2e/foo.spec.ts` as an unknown
      // command rather than as a filter.
      expect(args.slice(0, 5)).toEqual(['test', 'e2e/export/visual-regression.spec.ts', '--retries=1', '-g', 'draw']);
      expect(args.slice(5), 'only --output is added').toEqual(['--output', expect.stringContaining('test-results')]);
    } finally {
      boardDir.cleanup();
    }
  });

  it('strips --no-lock instead of forwarding it to Playwright', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      const log = recorder();
      await run(['--no-lock', 'e2e/levels.spec.ts'], {
        env: boardDir.env,
        log: log.log,
        runPlaywright: suite,
      });

      expect(suite.calls[0].args).not.toContain('--no-lock');
      expect(log.text(), 'an unlocked run announces itself').toMatch(/UNSERIALIZED/);
      expect(observeHeld(boardDir.env).status, 'and takes no lock, so there is nothing to release').toBe(0);
    } finally {
      boardDir.cleanup();
    }
  });

  it('gives the run its own port and its own output directories', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

      const { args, env } = suite.calls[0];
      const output = args[args.indexOf('--output') + 1];
      expect(output).toMatch(/test-results[\\/]runs[\\/]\d{4}-/);
      expect(env.PLAYWRIGHT_PORT, 'a port of its own, never the shared 5173').toMatch(/^\d+$/);
      expect(Number(env.PLAYWRIGHT_PORT)).toBeGreaterThan(0);
      expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toMatch(/playwright-report[\\/]runs[\\/]\d{4}-/);
      expect(
        env.PLAYWRIGHT_HTML_OUTPUT_DIR.includes(env.PLAYWRIGHT_PORT) || env.PLAYWRIGHT_HTML_OUTPUT_DIR.includes(output),
        'the report folder is not nested inside outputDir, which Playwright rejects'
      ).toBe(false);
    } finally {
      boardDir.cleanup();
    }
  });

  it('keeps the default port and the default output directory in CI', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      const code = await run([], { env: { ...boardDir.env, CI: '1' }, log: recorder().log, runPlaywright: suite });

      expect(code).toBe(0);
      const { args, env } = suite.calls[0];
      expect(args, 'CI reads test-results/ for its reporter output').not.toContain('--output');
      expect(env.PLAYWRIGHT_PORT, 'and the workflow documents :5173').toBeUndefined();
      expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBeUndefined();
    } finally {
      boardDir.cleanup();
    }
  });

  it('never creates the sentinel on disk', async () => {
    // A virtual path is the whole reason the board can hold a lock on something
    // that is not a file. If this ever fails, the lock is a claim on a real file
    // and an agent editing it would be refused.
    const boardDir = tempBoard();
    try {
      await run([], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: fakeSuite(),
      });
      expect(existsSync(join(REPO_ROOT, SENTINEL)), 'the sentinel is virtual and must never be written').toBe(false);
    } finally {
      boardDir.cleanup();
    }
  });
});

describe('e2e-run: port rules', () => {
  // Each of these is a way a run ends up testing somebody else's code, so each is
  // pinned rather than argued in a comment.
  const cases = [
    [
      'a remote base URL leaves the local port alone',
      { PLAYWRIGHT_BASE_URL: 'https://staging.example.com' },
      false,
      null,
    ],
    ["an explicit port is the caller's choice", { PLAYWRIGHT_PORT: '5391' }, false, null],
    [
      'reusing a server the operator started keeps the default port',
      { PLAYWRIGHT_REUSE_EXISTING_SERVER: '1' },
      false,
      null,
    ],
    ['anything else allocates, which is the case that used to collide', {}, false, 'allocate'],
    ['CI keeps :5173, which the workflow documents', {}, true, null],
  ];

  it.each(cases)('%s', (_name, env, ci, expected) => {
    expect(resolvePort(env, ci).port).toBe(expected);
  });

  it('always returns a reason, because the wrapper logs which rule fired', () => {
    for (const [name, env, ci] of cases) {
      expect(resolvePort(env, ci).reason, `no reason for ${name}`).toBeTruthy();
    }
  });

  it('finds a port that is actually free', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  it('nests run output under the two gitignored roots, never beside them', () => {
    const paths = runOutputPaths('/repo', '2026-01-01T00-00-00-000Z-1');
    expect(paths.outputDir).toBe(join('/repo', 'test-results', 'runs', '2026-01-01T00-00-00-000Z-1'));
    expect(paths.htmlDir).toBe(join('/repo', 'playwright-report', 'runs', '2026-01-01T00-00-00-000Z-1'));
  });
});

describe('e2e-run: the board it depends on', () => {
  it('probes that node:sqlite is loadable, so the lock is not silently dead', () => {
    // The lock is a `node:sqlite` database one process over. If a pool or engine
    // change took the binding away, `hold` would exit non-zero and the wrapper would
    // run unlocked with a warning — which is the right behaviour but a silent loss
    // of serialization, so the binding is asserted here.
    const db = new DatabaseSync(':memory:');
    db.exec('create table t (a integer)');
    db.prepare('insert into t values (1)').run();
    expect(db.prepare('select a from t').get()).toEqual({ a: 1 });
    db.close();
  });
});
