import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SwarmLock, E2E_SENTINEL, findFreePort, resolvePort, run, runOutputPaths } from '../e2e-run.mjs';

/**
 * The sentinel is exported by the module rather than repeated here, so a rename in
 * the implementation moves this file's expectation with it instead of leaving two
 * strings to drift. The one place a literal is unavoidable is the board calls,
 * which are made by the real CLI.
 */
const SENTINEL = E2E_SENTINEL;

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
 *
 * `CI` is deleted rather than merely unset-by-spread, because GitHub Actions sets
 * it for every step and `run()` treats it as "skip the lock, the port and the
 * output directory" — which is correct for a CI job and wrong for these tests. An
 * earlier version inherited `process.env` wholesale and went 7-red in the `ci`
 * job, which is exactly the failure a locally-green test file cannot show you.
 */
function tempBoard() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-run-test-'));
  const env = { ...process.env, AGENT_BOARD_DIR: dir };
  delete env.CI;
  return {
    dir,
    env,
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
    expect(log.text(), 'and says another RUN, not another agent: the holder is a process').toMatch(
      /another run has the e2e sentinel/
    );
    // The refusal path returns before the `try`, so nothing releases anything. If it
    // ever did, the queue would be handed a sentinel that is still in use.
    expect(observeHeld(boardDir.env).holders, "a refused run must not take the other holder's lock with it").toEqual([
      'somebody-else',
    ]);
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
      expect(
        env.PLAYWRIGHT_HTML_OUTPUT_DIR,
        'the HTML report is NOT moved: `npm run test:e2e:report` is a bare show-report'
      ).toBeUndefined();
    } finally {
      boardDir.cleanup();
    }
  });

  it('leaves a caller-supplied --output alone instead of sending two', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      await run(['--output', 'test-results/mine'], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      });

      const { args } = suite.calls[0];
      // Playwright silently takes the LAST --output, so a second one would override
      // the caller's without either of them noticing.
      expect(
        args.filter((arg) => arg === '--output'),
        'exactly one --output'
      ).toHaveLength(1);
      expect(args[args.indexOf('--output') + 1]).toBe('test-results/mine');
    } finally {
      boardDir.cleanup();
    }
  });

  it('runs unlocked on E2E_SKIP_LOCK=1 too, not only on the --no-lock flag', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      const log = recorder();
      await run(['e2e/levels.spec.ts'], {
        env: { ...boardDir.env, E2E_SKIP_LOCK: '1' },
        log: log.log,
        runPlaywright: suite,
      });

      expect(suite.calls, 'the escape hatch still runs the suite').toHaveLength(1);
      expect(log.text(), 'and still announces that it is unsynchronized').toMatch(/UNSERIALIZED/);
      expect(observeHeld(boardDir.env).status, 'taking no lock is not the same as taking a bad one').toBe(0);
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

  it('finds a port it can then bind itself, which is what "free" has to mean', async () => {
    // The earlier version asserted only that the number was in a plausible range,
    // which `return 3000` satisfies verbatim. This one takes the port back and
    // binds it: a port something else is listening on cannot be bound, so the
    // assertion fails for a hardcoded answer and passes for a real one.
    const port = await findFreePort();
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
  });

  it('nests run output under the gitignored root, never beside it', () => {
    const paths = runOutputPaths('/repo', '2026-01-01T00-00-00-000Z-1');
    expect(paths.outputDir).toBe(join('/repo', 'test-results', 'runs', '2026-01-01T00-00-00-000Z-1'));
    // Deliberately null: a per-run HTML folder would leave `npm run test:e2e:report`
    // (a bare `playwright show-report`) with nothing to open.
    expect(paths.htmlDir, 'the HTML report stays where show-report looks for it').toBeNull();
  });
});

describe('e2e-run: the lease', () => {
  // A malformed lease used to take the run UNSERIALIZED. `parseDuration` throws
  // BoardError code 1 on `30min`, the CLI exits 1, and exit 1 is also what a
  // missing board looks like — so the wrapper printed a warning about `node:sqlite`
  // and ran anyway. A typo in one environment variable silently disarming the lock
  // is the failure mode this whole change exists to remove.
  //
  // These are the values the board actually refuses, checked against its CLI rather
  // than picked by eye. `30 m` and `0.5h` are ACCEPTED (its regex allows a space and
  // a decimal), and a first draft of this list called them invalid — which would have
  // had the wrapper refusing configurations that work. `0m` is accepted by the board
  // and refused here, on purpose: a zero lease expires the lock immediately.
  const bad = ['30min', 'soon', '-5m', '1 hour', '', '0m'];

  it.each(bad)('refuses %j rather than running without the lock', (lease) => {
    expect(() => new SwarmLock({ lease, identity: 'test' })).toThrow(/E2E_LOCK_LEASE/);
  });

  it("accepts the board's own grammar, including a bare minute count and a decimal", () => {
    for (const lease of ['30m', '30 m', '90s', '2h', '500ms', '45', '0.5h', '1.5h']) {
      expect(new SwarmLock({ lease, identity: 'test' }).leaseMs, `lease ${lease}`).toBeGreaterThan(0);
    }
  });

  it('renews inside the lease, never outside it', () => {
    // A 4-minute lease with a 5-minute interval expires the lock before the first
    // renewal, `doctor` reclaims it on the next board command from anybody, and the
    // run races a second suite until its timer happens to notice.
    const lock = new SwarmLock({ lease: '4m', identity: 'test' });
    expect(lock.renewEveryMs).toBeLessThan(lock.leaseMs / 2);
    expect(new SwarmLock({ lease: '30m', identity: 'test' }).renewEveryMs).toBe(5 * 60_000);
  });
});

describe('e2e-run: the identity it holds the lock as', () => {
  it('is per run, so two runs on one branch are two holders', async () => {
    // Board identity is the branch by default and the conflict test is
    // `lock.agent_id !== who`, so a branch never conflicts with itself: two runs on
    // one branch both "acquire", and the second one's `unlock` releases the row the
    // first still holds — handing a third run a free sentinel while a suite is live.
    const boardDir = tempBoard();
    try {
      // 0 is "refuse rather than queue", so the test does not sit on a clock.
      const env = { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' };
      const first = new SwarmLock({ env, identity: 'e2e-run/branch/1', log: recorder().log });
      const second = new SwarmLock({ env, identity: 'e2e-run/branch/2', log: recorder().log });

      expect(await first.acquire(), 'the first run takes it').toMatchObject({ acquired: true });
      const secondAttempt = await second.acquire();
      expect(secondAttempt, 'the second run is refused, not admitted alongside the first').toMatchObject({
        acquired: false,
        reason: 'contended',
      });

      // And the refusal must not have taken the first run's lock with it.
      expect(observeHeld(boardDir.env).status, 'the holder still holds it after a refusal').toBe(1);

      first.release();
      expect(observeHeld(boardDir.env).status, 'and gives it back when it finishes').toBe(0);
    } finally {
      boardDir.cleanup();
    }
  });

  it('names the branch and the pid, so `swarm status` says which checkout is running', () => {
    const identity = new SwarmLock({ env: {} }).identity;
    expect(identity).toMatch(/^e2e-run\/.+\/\d+$/);
    expect(identity, 'the pid is what makes it per run').toContain(String(process.pid));
  });
});
