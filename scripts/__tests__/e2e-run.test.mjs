import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SwarmLock,
  E2E_SENTINEL,
  assertOwnServer,
  findFreePort,
  isPortFree,
  resolvePort,
  run,
  runOutputPaths,
} from '../e2e-run.mjs';

/**
 * This file's budget, and the reason it is not Vitest's default 5s.
 *
 * These are not unit tests. Almost every one of them builds its state by
 * `spawnSync`-ing `scripts/agent-board.mjs` and its assertions by reading the
 * result back out of a child process, so what a test costs here is dominated by
 * process spawns rather than by anything being computed. A cold board call is
 * ~60-80ms from a shell, and this file's slowest test spends eight of them.
 *
 * The default is not merely tight for that, it is SMALLER THAN THE WORK ALREADY
 * MEASURED IN THIS FILE. Across three isolated runs of the three `scripts/`
 * suites on this machine, the slowest span here was 7.1s
 * (`never reclaims a holder that this wrapper did not create`, which loops four
 * identities and spends two board spawns on each) and the slowest in
 * `agent-board.test.mjs` was 4.5s. A budget below a test's own measured cost is
 * not a flake waiting to happen; it is a coin flip, and on a machine slower than
 * this one, or on one also running a Playwright suite as this repository normally
 * is, the same tests fail with no code change at all — which is exactly how
 * `npm run test` reported five of them.
 *
 * What is deliberately NOT claimed here: any contention factor. A full 266-file
 * run was measured against these same tests and came out FASTER per test than the
 * three-file run (median 0.45x, max 1.1x), so "a full run is N times slower" is not
 * a thing this suite can currently support, and a number of that shape would be a
 * guess wearing a measurement's clothes. The headroom below is therefore stated
 * for what it is: 30s is about four times this file's own worst measured case, so
 * a machine several times slower than this one still runs the file, and nothing
 * more is claimed on top of that.
 *
 * This is a BUDGET, not a threshold. It cannot turn a failing assertion green: it
 * only decides how long a test may run before the harness reports it, and every
 * assertion below is unchanged. Its cost is that a genuinely hung test now takes
 * 30s to be reported instead of 5s, which is bounded and is the price of tests
 * that are allowed to spawn processes.
 *
 * A per-test `it(name, fn, timeout)` argument still wins over this, which is how
 * the two tests in `worktree-inventory.test.mjs` that read git in every worktree
 * keep their declared `60_000`. This file declares none of its own, so 30s is
 * what every test in it gets; a test that ever needs longer should say so on
 * itself rather than by raising this.
 *
 * The budget is scoped to THIS file, which was checked rather than assumed: a 7s
 * body in a sibling file with no declaration still died at the 5s default while
 * running in the same run as this one. So raising it here buys nothing outside
 * here, and cannot be quietly masking a slow test somewhere else.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * The sentinel is exported by the module rather than repeated here, so a rename in
 * the implementation moves this file's expectation with it instead of leaving two
 * strings to drift.
 */
const SENTINEL = E2E_SENTINEL;

/**
 * Built from `import.meta.dirname`, never from `import.meta.url`: Vitest gives this
 * module an `http://localhost/…` URL, whose `pathname` is `/agent-board.mjs` and
 * does not exist on disk. The sibling board test carries the same note, and the
 * failure mode is a spawn that exits 1 for a reason unrelated to the test.
 */
const BOARD_CLI = join(import.meta.dirname, '..', 'agent-board.mjs');
const RUNNER_CLI = join(import.meta.dirname, '..', 'e2e-run.mjs');
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * A real board in a temp directory, for the tests that need the real CLI.
 *
 * `AGENT_BOARD_DIR` is what `resolveBoardDir` reads first
 * (scripts/lib/agent-board/db.mjs:250), so a test never touches the operator's board
 * in the common git dir. The repository itself is NOT faked: path normalization is
 * lexical but the git home and worktree list are real.
 *
 * `CI` is deleted rather than left inherited, because GitHub Actions sets it for
 * every step and `run()` reads it as "no queue, default port, default output dir" —
 * correct for a CI job, wrong for most of these tests, and invisible locally. An
 * earlier version inherited `process.env` wholesale and went 7-red in the `ci` job.
 */
function tempBoard() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-run-test-'));
  const env = { ...process.env, AGENT_BOARD_DIR: dir };
  delete env.CI;
  return { dir, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function board(args, env) {
  return spawnSync(process.execPath, [BOARD_CLI, ...args], { encoding: 'utf8', env });
}

/**
 * Observe the sentinel as somebody who is NOT the run holding it. `swarm check`
 * exits 0 both for the holder's own lock and for no lock at all, so reading it with
 * the same identity as the run cannot tell a taken lock from a released one.
 */
const OBSERVER = 'e2e-run-test-observer';

function observeHeld(env) {
  const check = board(['check', SENTINEL, '--json', '--agent', OBSERVER], env);
  const entry = JSON.parse(check.stdout).report[0];
  return { status: check.status, holders: entry.holders.map((holder) => holder.agent_id) };
}

function recorder() {
  const lines = [];
  return { log: (line) => lines.push(line), text: () => lines.join('\n') };
}

/**
 * A stand-in for the suite, so a test can read the board from outside while a run is
 * "in flight" and return an exit code without starting a browser.
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

/* -------------------------------------------------------------------------- */
/* The guarantee: this run's own server. Nothing below here may depend on the   */
/* swarm board, because the board is only a queue.                              */
/* -------------------------------------------------------------------------- */

describe('e2e-run: the own-server guarantee', () => {
  let boardDir;

  beforeEach(() => {
    boardDir = tempBoard();
  });

  afterEach(() => {
    boardDir.cleanup();
  });

  it('picks a port for the run and hands it to Playwright', async () => {
    const suite = fakeSuite();
    await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

    const { env } = suite.calls[0];
    expect(env.PLAYWRIGHT_PORT, 'a port of its own, never the shared 5173').toMatch(/^\d+$/);
    expect(Number(env.PLAYWRIGHT_PORT)).toBeGreaterThan(0);
  });

  it('runs with a port even when the board is completely unavailable', async () => {
    // The load-bearing test of the whole design. If the guarantee needed the board,
    // this is where it would show: no board, no port, and a run against whatever
    // happens to be listening. Instead the run allocates exactly as it does with a
    // board, because the board was never load-bearing.
    const suite = fakeSuite();
    const log = recorder();
    const code = await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      lock: new SwarmLock({
        env: boardDir.env,
        log: log.log,
        exec: () => ({ status: 2, stdout: '', stderr: 'no home for the board' }),
      }),
      runPlaywright: suite,
    });

    expect(code, 'an unreachable board is not a failure').toBe(0);
    expect(suite.calls, 'the suite still starts').toHaveLength(1);
    expect(suite.calls[0].env.PLAYWRIGHT_PORT, 'on a port of its own').toMatch(/^\d+$/);
    expect(log.text(), 'and the loss of scheduling is stated').toMatch(/board is unavailable/);
  });

  it('refuses PLAYWRIGHT_REUSE_EXISTING_SERVER instead of inheriting a dead variable', () => {
    // The config no longer reads it. A silent no-op would leave whoever set it
    // believing they had a run that attaches to their dev server; an error tells
    // them the truth at the moment they set it.
    expect(() => assertOwnServer({ PLAYWRIGHT_REUSE_EXISTING_SERVER: '1' })).toThrow(/no longer/);
    expect(() => assertOwnServer({ PLAYWRIGHT_REUSE_EXISTING_SERVER: 'false' })).toThrow(/no longer/);
    expect(() => assertOwnServer({})).not.toThrow();
  });

  it('refuses PLAYWRIGHT_BASE_URL unless the run says it means a remote build', () => {
    expect(() => assertOwnServer({ PLAYWRIGHT_BASE_URL: 'https://staging.example.com' })).toThrow(/own checkout/);
    expect(
      assertOwnServer({ PLAYWRIGHT_BASE_URL: 'https://staging.example.com', E2E_ALLOW_REMOTE: '1' }),
      'and says so in the log, so a report cannot claim the branch was verified locally'
    ).toMatch(/REMOTE/);
  });

  it('never lets a refused setting reach Playwright', async () => {
    const suite = fakeSuite();
    await expect(
      run([], {
        env: { ...boardDir.env, PLAYWRIGHT_REUSE_EXISTING_SERVER: '1', E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      })
    ).rejects.toThrow(/no longer/);
    expect(suite.calls, 'a refused run must not start Playwright').toEqual([]);
  });

  it('gives the run its own output directory, because Playwright deletes it every run', async () => {
    const suite = fakeSuite();
    await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

    const { args } = suite.calls[0];
    expect(args[args.indexOf('--output') + 1]).toMatch(/test-results[\\/]runs[\\/]\d{4}-/);
    expect(
      suite.calls[0].env.PLAYWRIGHT_HTML_OUTPUT_DIR,
      'the HTML report is NOT moved: `npm run test:e2e:report` is a bare show-report'
    ).toBeUndefined();
  });

  it('leaves a caller-supplied --output alone in BOTH spellings', async () => {
    // `--output=dir` is the one an earlier version missed: `includes('--output')` on
    // the bare token does not match it, and the bundled commander accepts both
    // (playwright/lib/program.js:207 and the option parser it uses), so the caller's
    // choice was silently discarded and the log still named the wrapper's directory.
    for (const form of [['--output', 'test-results/mine'], ['--output=test-results/mine']]) {
      const suite = fakeSuite();
      await run(form, {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      });

      const { args } = suite.calls[0];
      expect(
        args.filter((arg) => arg === '--output' || arg.startsWith('--output=')),
        `exactly one --output for "${form[0]}"`
      ).toHaveLength(1);
      expect(args.join(' '), "the caller's value is the one that survives").toMatch(/test-results\/mine/);
      expect(args.join(' '), "not the wrapper's per-run directory").not.toMatch(/test-results[\\/]runs/);
    }
  });

  it('pins --last-failed to a path the per-run output directory cannot move', async () => {
    // `--last-failed` reads `<outputDir>/.last-run.json` and silently runs the WHOLE
    // suite when that file is not where it expects it
    // (playwright/lib/runner/index.js:6608-6625 swallows the read error and applies
    // no filter at all). A per-run outputDir moves that file every run, so without
    // this pin the flag quietly stops meaning anything after the first run — and an
    // agent that used it to re-check a fix would be told everything passed.
    const suite = fakeSuite();
    await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

    expect(suite.calls[0].env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE).toBe(join(REPO_ROOT, 'test-results', '.last-run.json'));
    expect(
      suite.calls[0].env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE.includes('runs/'),
      'not inside the per-run directory'
    ).toBe(false);
  });

  it('treats a bare -h as help rather than as a run', async () => {
    // `-h` is Playwright's own alias and an earlier version matched neither it nor
    // `-v`, so `npm run test:e2e -- -h` fell through the whole path: it allocated a
    // port, took the queue, wrote a run record, and then printed help.
    const suite = fakeSuite();
    await run(['-h'], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

    expect(suite.calls[0].env.PLAYWRIGHT_PORT, 'no port allocated for a help request').toBeUndefined();
    expect(observeHeld(boardDir.env).status, 'and no queue taken').toBe(0);
  });

  it('does not read a grep pattern after -- as a help request', async () => {
    // Playwright reads everything after a bare `--` as a filter, so
    // `e2e/x.spec.ts -- --help` is a filtered RUN whose pattern is the string
    // `--help`. Short-circuiting on it would print help instead of running the suite.
    const suite = fakeSuite();
    await run(['e2e/x.spec.ts', '--', '--help'], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: recorder().log,
      runPlaywright: suite,
    });

    expect(suite.calls[0].env.PLAYWRIGHT_PORT, 'a real run, so a port was allocated').toMatch(/^\d+$/);
  });

  it('records the port it used, so a run that fails later is diagnosable', async () => {
    const recordPath = join(REPO_ROOT, '.kilo', 'e2e-last-run.json');
    // Real shared state in a real repository, so the previous contents are restored
    // rather than deleted: an earlier version of this test removed the file in both
    // branches of its `finally` under a comment saying "put it back", which destroyed
    // whatever a real `npm run test:e2e` in this worktree had recorded.
    const previous = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : null;
    try {
      const suite = fakeSuite();
      await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: suite });

      const record = JSON.parse(readFileSync(recordPath, 'utf8'));
      expect(record.port, 'the port that served this run').toBe(suite.calls[0].env.PLAYWRIGHT_PORT);
      expect(record.baseUrl).toBe(`http://localhost:${suite.calls[0].env.PLAYWRIGHT_PORT}`);
      expect(record.outputDir).toContain('test-results');
      expect(record.queued, 'and whether it had the queue, which is diagnostic not load-bearing').toBe(true);
      // The record is closed when the run finishes, so "died at startup" is
      // distinguishable from "served an hour" by more than a timestamp.
      expect(record.exitCode).toBe(0);
      expect(record.finishedAt, 'the record says the run ended').toBeTruthy();
    } finally {
      if (previous === null) rmSync(recordPath, { force: true });
      else writeFileSync(recordPath, previous);
    }
  });

  it('records the REMOTE target as the base URL, not the localhost port it also started', async () => {
    // A remote run still allocates a port and still starts a dev server for nothing.
    // Deriving `baseUrl` from that port recorded a URL that served no test as the
    // thing under test, in the one file whose job is to stop a report implying a
    // local verification.
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      await run([], {
        env: { ...boardDir.env, E2E_ALLOW_REMOTE: '1', PLAYWRIGHT_BASE_URL: 'https://staging.example.com' },
        log: recorder().log,
        runPlaywright: suite,
      });

      const record = JSON.parse(readFileSync(join(REPO_ROOT, '.kilo', 'e2e-last-run.json'), 'utf8'));
      expect(record.baseUrl).toBe('https://staging.example.com');
      expect(record.remote, 'and the record admits it was not a local verification').toBe(true);
    } finally {
      rmSync(join(REPO_ROOT, '.kilo', 'e2e-last-run.json'), { force: true });
    }
  });

  it('nests run output under the gitignored root, never beside it', () => {
    const paths = runOutputPaths('/repo', '2026-01-01T00-00-00-000Z-1');
    expect(paths.outputDir).toBe(join('/repo', 'test-results', 'runs', '2026-01-01T00-00-00-000Z-1'));
    // Deliberately null: a per-run HTML folder would leave the report-viewer script
    // with nothing to open.
    expect(paths.htmlDir, 'the HTML report stays where show-report looks for it').toBeNull();
  });

  it('keeps the default port and the default output directory in CI', async () => {
    const suite = fakeSuite();
    const code = await run([], { env: { ...boardDir.env, CI: '1' }, log: recorder().log, runPlaywright: suite });

    expect(code).toBe(0);
    const { args, env } = suite.calls[0];
    expect(args, 'CI reads test-results/ for its reporter output').not.toContain('--output');
    expect(env.PLAYWRIGHT_PORT, 'and the workflow documents :5173').toBeUndefined();
    expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBeUndefined();
    // The CI branch of `run()` had NO test at all: `resolvePort` was exercised as a
    // pure function with `ci=true`, which cannot catch a branch in `run()` that
    // ignored the flag — and `CI` is set in this repo's own `ci` job.
    expect(observeHeld(boardDir.env).status, 'CI does not take the e2e queue').toBe(0);
    expect(args[0], 'and Playwright is still invoked rather than skipped').toBe('test');
  });

  it('refuses a remote base URL here, and global-setup refuses it on the raw path', async () => {
    // This is the wrapper's half. The load-bearing half is `checkOwnServer` in
    // `e2e/global-setup.ts`, because `npm run test:e2e:raw` and the CI job's bare
    // `npx playwright test` never load this file, and `playwright.config.ts`
    // resolves `use.baseURL` from the variable itself — so a refusal that lived only
    // here was one command away from being false. The global-setup half is covered
    // in `e2e/__tests__/global-setup.unit.test.ts`.
    const suite = fakeSuite();
    await expect(
      run([], {
        env: { ...boardDir.env, PLAYWRIGHT_BASE_URL: 'https://staging.example.com', E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      })
    ).rejects.toThrow(/must never happen/);
    expect(suite.calls, 'a refused run must not start Playwright').toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The queue: advisory only. None of this may fail a run.                       */
/* -------------------------------------------------------------------------- */

describe('e2e-run: the queue is a queue, not a gate', () => {
  let boardDir;

  beforeEach(() => {
    boardDir = tempBoard();
  });

  afterEach(() => {
    boardDir.cleanup();
  });

  it('takes the sentinel for the run and gives it back after', async () => {
    let duringRun = null;
    const code = await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: recorder().log,
      runPlaywright: fakeSuite(async () => {
        duringRun = observeHeld(boardDir.env);
      }),
    });

    expect(code).toBe(0);
    expect(duringRun.status, 'another agent can see the sentinel held while the suite runs').toBe(1);
    expect(duringRun.holders).toHaveLength(1);

    const after = observeHeld(boardDir.env);
    expect(after.status, 'and free once the run returns').toBe(0);
    expect(after.holders).toEqual([]);
  });

  it('gives the sentinel back when the suite throws', async () => {
    await expect(
      run([], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: async () => {
          throw new Error('the suite blew up');
        },
      })
    ).rejects.toThrow('the suite blew up');

    expect(observeHeld(boardDir.env).status, 'a failed run must not leave the queue held').toBe(0);
  });

  it('waits for a held sentinel and runs as soon as it is free', async () => {
    expect(board(['hold', SENTINEL, '--lease', '30m', '--agent', 'somebody-else'], boardDir.env).status).toBe(0);

    const suite = fakeSuite();
    const queued = run(['e2e/undo-redo.spec.ts'], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '30000', E2E_LOCK_POLL: '20' },
      log: recorder().log,
      runPlaywright: suite,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(suite.calls, 'still waiting while the other run holds it').toEqual([]);

    expect(board(['unlock', SENTINEL, '--agent', 'somebody-else'], boardDir.env).status).toBe(0);

    expect(await queued, 'and completes on the suite exit code').toBe(0);
    expect(suite.calls, 'exactly one run, after the queue was free').toHaveLength(1);
  });

  it('STARTS ANYWAY when another run holds the sentinel for too long', async () => {
    // This is the difference between a queue and a gate. The old version exited 4 and
    // ran nothing, which made an unenforceable mechanism into a hard block on a merge
    // gate: it looked like a guarantee and was not one. Two concurrent runs are
    // survivable, so the run goes.
    expect(board(['hold', SENTINEL, '--lease', '30m', '--agent', 'somebody-else'], boardDir.env).status).toBe(0);

    const suite = fakeSuite();
    const log = recorder();
    const code = await run(['e2e/undo-redo.spec.ts'], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      runPlaywright: suite,
    });

    expect(code, 'not 4: a queue that blocks a merge gate is a gate').toBe(0);
    expect(suite.calls, 'the suite starts anyway').toHaveLength(1);
    expect(suite.calls[0].args[0]).toBe('test');
    expect(log.text()).toMatch(/going ahead anyway/);
    expect(observeHeld(boardDir.env).holders, 'and the other run keeps its queue slot: this run never took it').toEqual(
      ['somebody-else']
    );
  });

  it('runs unlocked on E2E_SKIP_LOCK=1 too, not only on the --no-lock flag', async () => {
    const suite = fakeSuite();
    const log = recorder();
    await run(['e2e/levels.spec.ts'], {
      env: { ...boardDir.env, E2E_SKIP_LOCK: '1' },
      log: log.log,
      runPlaywright: suite,
    });

    expect(suite.calls).toHaveLength(1);
    expect(suite.calls[0].args, 'and --no-lock is not forwarded to Playwright').not.toContain('--no-lock');
    expect(log.text()).toMatch(/not queueing/);
    expect(observeHeld(boardDir.env).status, 'taking no queue is not the same as taking a bad one').toBe(0);
  });

  it('renews the lease while the suite runs, and says so if a renewal fails', async () => {
    // A file lock is never renewed by the board itself, so this wrapper owns the
    // lease for as long as the suite lives. An earlier version defined the renewal
    // and never started it: the timer existed, was documented, and no code path
    // reached it. It survived a real full-suite run purely because the 30-minute
    // lease outlasted it, which is exactly the kind of pass that is not evidence.
    //
    // A failed renewal is now a MESSAGE, not a kill. The old version stopped the
    // suite, which was correct when the lock was the guarantee and is wrong now that
    // the port is: the run is safe, and stopping it would hand a merge gate to a
    // scheduling detail.
    let holdCalls = 0;
    const exec = (command) => {
      if (command.slice(2)[0] === 'hold') {
        holdCalls += 1;
        return holdCalls === 1
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 4, stdout: '', stderr: 'held by another agent' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const lock = new SwarmLock({ env: boardDir.env, log: recorder().log, exec, renewEveryMs: 5 });

    const log = recorder();
    let suiteFinished = false;
    const suite = fakeSuite(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      suiteFinished = true;
    });

    const code = await run([], {
      env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
      log: log.log,
      lock,
      runPlaywright: suite,
    });

    expect(holdCalls, 'the acquisition plus at least one renewal').toBeGreaterThan(1);
    expect(log.text()).toMatch(/could not be renewed/);
    // The suite runs to completion even though the queue was lost mid-run. Under the
    // old design, where the lock WAS the guarantee, killing it was right; now the
    // port is the guarantee and this run is safe, so stopping it would hand a merge
    // gate to a scheduling detail.
    expect(suiteFinished, 'a lost queue does not stop a run that already has its own server').toBe(true);
    expect(code, 'and the run still reports the suite exit code').toBe(0);
  });

  it('reclaims the queue from a holder whose process is gone', async () => {
    // A run that was killed — terminal closed, tool timeout, crash — leaves a queue
    // entry indistinguishable from a live one, and the board's only recovery is a
    // timer. Measured here: a hard-killed holder made the next run wait the whole
    // 10-minute E2E_LOCK_TIMEOUT for a process that no longer existed. The identity
    // carries the pid, so this is checked directly rather than waited out.
    const dead = 'e2e-run/branch/999999';
    expect(board(['hold', E2E_SENTINEL, '--lease', '30m', '--agent', dead], boardDir.env).status).toBe(0);

    const log = recorder();
    // A long timeout on purpose: if the reclaim did not work, this test would hang for
    // it rather than fail, which is the failure mode being fixed.
    const lock = new SwarmLock({ env: boardDir.env, log: log.log, timeoutMs: 60_000, pollMs: 20 });
    const attempt = await lock.acquire();

    expect(attempt, 'the queue is taken over rather than waited on').toMatchObject({ acquired: true });
    expect(log.text()).toMatch(/no longer exists/);
    expect(observeHeld(boardDir.env).holders, 'and the dead holder is not among them any more').not.toContain(dead);
    lock.release();
  });

  it('waits for a LIVE holder rather than reclaiming its queue', async () => {
    // The mirror of the case above, and the one that would be dangerous to get wrong:
    // pid reuse is rare but a live run must never be displaced by a liveness check.
    const live = `e2e-run/branch/${process.pid}`;
    expect(board(['hold', E2E_SENTINEL, '--lease', '30m', '--agent', live], boardDir.env).status).toBe(0);

    const lock = new SwarmLock({ env: boardDir.env, log: recorder().log, timeoutMs: 0 });
    expect(await lock.acquire(), 'a live holder is not displaced').toMatchObject({
      acquired: false,
      reason: 'contended',
    });
    expect(observeHeld(boardDir.env).holders, 'and keeps its queue slot').toContain(live);
  });

  it('never reclaims a holder that this wrapper did not create', async () => {
    // The reclaim UNLOCKS as the holder it is reclaiming, so a wrong liveness answer
    // is not a wrong log line — it releases a real agent's queue slot. The board's
    // default identity is the sanitized branch and `sanitize` preserves `/`
    // (scripts/lib/agent-board/identity.mjs:28), so a holder on `fix/1234`, or anyone
    // who passed `--agent 2026`, has an identity whose last segment parses as a pid.
    // An earlier version of `isHolderAlive` probed it, found nothing, and stole it.
    for (const identity of ['fix/1234', '2026', 'somebody-else', 'e2e-run/branch/1234abc']) {
      const boardDir = tempBoard();
      try {
        expect(board(['hold', SENTINEL, '--lease', '30m', '--agent', identity], boardDir.env).status).toBe(0);
        const log = recorder();
        const attempt = await new SwarmLock({
          env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
          identity: 'e2e-run/branch/1',
          log: log.log,
        }).acquire();

        expect(attempt, `${identity} is not ours to reclaim`).toMatchObject({ acquired: false, reason: 'contended' });
        expect(log.text(), `${identity} is not judged dead`).not.toMatch(/no longer exists/);
        expect(observeHeld(boardDir.env).holders, `${identity} keeps its queue slot`).toContain(identity);
      } finally {
        boardDir.cleanup();
      }
    }
  });

  it('never creates the sentinel on disk', async () => {
    // A virtual path is the whole reason the board can hold a lock on something that
    // is not a file. If this ever fails, the lock is a claim on a real file and an
    // agent editing it would be refused.
    await run([], { env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' }, log: recorder().log, runPlaywright: fakeSuite() });
    expect(existsSync(join(REPO_ROOT, SENTINEL)), 'the sentinel is virtual and must never be written').toBe(false);
  });

  it('names the sentinel where an agent will read it', () => {
    const printed = spawnSync(process.execPath, [RUNNER_CLI, '--e2e-run-help'], { encoding: 'utf8' });
    expect(printed.status, 'the runner answers its own --e2e-run-help').toBe(0);
    expect(printed.stdout).toContain(SENTINEL);
    expect(printed.stdout, 'and the guarantee is stated where it is read').toMatch(/its own dev server/);
  });
});

/* -------------------------------------------------------------------------- */
/* The identity it holds the queue as                                           */
/* -------------------------------------------------------------------------- */

describe('e2e-run: the queue holder is a run, not a branch', () => {
  it('is per run, so two runs on one branch are two holders', async () => {
    // Board identity is the branch by default and the conflict test is
    // `lock.agent_id !== who`, so a branch never conflicts with itself: two runs on
    // one branch both "acquire", and the second one's `unlock` releases the row the
    // first still holds. Since the queue is only scheduling, the cost of that is a
    // noisy log rather than a false green — but it is still wrong, and it is still
    // fixed here.
    const boardDir = tempBoard();
    try {
      const env = { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' };
      const first = new SwarmLock({ env, identity: 'e2e-run/branch/1', log: recorder().log });
      const second = new SwarmLock({ env, identity: 'e2e-run/branch/2', log: recorder().log });

      expect(await first.acquire(), 'the first run takes it').toMatchObject({ acquired: true });
      expect(await second.acquire(), 'the second is told the queue is busy').toMatchObject({
        acquired: false,
        reason: 'contended',
      });
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

/* -------------------------------------------------------------------------- */
/* The lease, and the grammar that came with it                                */
/* -------------------------------------------------------------------------- */

describe('e2e-run: the lease', () => {
  // A malformed lease used to be FATAL, and three documents said it was not. The
  // constructor threw from `assertLease`, and `run()` built the lock before it had
  // decided whether the run wanted a queue at all — so `CI=1 E2E_LOCK_LEASE=30min`
  // died with no suite, which is exactly the "a scheduling knob blocks a merge gate"
  // failure the advisory-queue design exists to prevent. It now logs and falls back.
  //
  // These are the values the board's own `parseDuration` refuses, checked against its
  // CLI rather than picked by eye: `30 m` and `0.5h` are ACCEPTED (its regex allows a
  // space and a decimal), and a first draft of this list called them invalid — which
  // would have had the wrapper rejecting configurations that work.
  const bad = ['30min', 'soon', '-5m', '1 hour', '', '0m'];

  it.each(bad)('reports %j and uses the default rather than killing the run', (lease) => {
    const log = recorder();
    const lock = new SwarmLock({ lease, identity: 'test', env: {}, log: log.log });
    expect(lock.leaseMs, 'the default lease, not zero').toBe(30 * 60_000);
    expect(log.text(), 'and the operator is told what was ignored').toMatch(/E2E_LOCK_LEASE/);
  });

  it('does not kill a run that has already said it will not queue', async () => {
    // The regression itself, not the policy: a bad lease under CI and under
    // --no-lock must still reach the suite, because neither of those paths wants a
    // lock at all. Before the fix the SwarmLock was constructed first, so both died
    // in the constructor with exit 1 and no Playwright.
    const boardDir = tempBoard();
    try {
      for (const env of [{ CI: '1' }, { E2E_SKIP_LOCK: '1' }]) {
        const suite = fakeSuite();
        const code = await run([], {
          env: { ...boardDir.env, ...env, E2E_LOCK_LEASE: '30min' },
          log: recorder().log,
          runPlaywright: suite,
        });
        expect(code, `a run with ${JSON.stringify(env)} still runs`).toBe(0);
        expect(suite.calls).toHaveLength(1);
      }
    } finally {
      boardDir.cleanup();
    }
  });

  it("accepts the board's own grammar, including a bare minute count and a decimal", () => {
    for (const lease of ['30m', '30 m', '90s', '2h', '500ms', '45', '0.5h', '1.5h']) {
      expect(new SwarmLock({ lease, identity: 'test' }).leaseMs, `lease ${lease}`).toBeGreaterThan(0);
    }
  });

  it('renews inside the lease, and never faster than a spawn can bear', () => {
    // A 4-minute lease with a 5-minute interval expires the lock before the first
    // renewal, `doctor` reclaims it on the next board command from anybody, and the
    // run quietly stops being serialized at all.
    const lock = new SwarmLock({ lease: '4m', identity: 'test' });
    expect(lock.renewEveryMs).toBeLessThan(lock.leaseMs / 2);
    expect(new SwarmLock({ lease: '30m', identity: 'test' }).renewEveryMs).toBe(5 * 60_000);

    // The other end: the renewal body is a synchronous `spawnSync` of the board CLI,
    // so a lease short enough to derive a sub-minute interval would spawn a node
    // process many times a second and block the stdout it exists to keep streaming.
    // `500ms` is a duration the board accepts.
    expect(new SwarmLock({ lease: '500ms', identity: 'test' }).renewEveryMs).toBe(30_000);
    expect(new SwarmLock({ lease: '1s', identity: 'test' }).renewEveryMs).toBe(30_000);
  });
});

/* -------------------------------------------------------------------------- */
/* Ports, and the argument shape                                                */
/* -------------------------------------------------------------------------- */

describe('e2e-run: ports and arguments', () => {
  const cases = [
    ["an explicit port is the caller's choice", { PLAYWRIGHT_PORT: '5391' }, false, null],
    ['anything else allocates, which is the case that used to collide', {}, false, 'allocate'],
    ['CI keeps :5173, which the workflow documents', {}, true, null],
  ];

  it.each(cases)('%s', (_name, env, ci, expected) => {
    expect(resolvePort(env, ci).port).toBe(expected);
  });

  it('always returns a reason that NAMES the rule that fired', () => {
    // This test's stated purpose is that the wrapper logs WHICH rule fired, so
    // asserting only that a reason is truthy does not test its own reason to exist:
    // a single constant string, or the same reason returned for every case, passes.
    // Each expectation is a fragment only that case can produce.
    expect(resolvePort({ PLAYWRIGHT_PORT: '5391' }, false).reason).toMatch(/5391/);
    expect(resolvePort({}, true).reason).toMatch(/CI/);
    expect(resolvePort({}, false).reason).toMatch(/picks its own/);
  });

  it('finds a port it can then bind itself, which is what "free" has to mean', async () => {
    // The earlier version asserted only that the number was in a plausible range,
    // which `return 3000` satisfies verbatim. This one takes the port back and binds
    // it: a port something else is listening on cannot be bound.
    const port = await findFreePort();
    expect(await isPortFree(port)).toBe(true);
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
  });

  it('reports a taken port as taken, which is what makes re-picking worth doing', async () => {
    const taken = createServer();
    const port = await new Promise((resolve) => taken.listen(0, '127.0.0.1', () => resolve(taken.address().port)));
    try {
      expect(await isPortFree(port), 'a port with a listener on it is not free').toBe(false);
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  it('puts the `test` subcommand first, because npm appends arguments after the script', async () => {
    const boardDir = tempBoard();
    try {
      const suite = fakeSuite();
      await run(['e2e/export/visual-regression.spec.ts', '--retries=1', '-g', 'draw'], {
        env: { ...boardDir.env, E2E_LOCK_TIMEOUT: '0' },
        log: recorder().log,
        runPlaywright: suite,
      });

      // `playwright e2e/foo.spec.ts` is an unknown COMMAND, not a filter, so without
      // this line `npm run test:e2e -- e2e/foo.spec.ts` fails with "unknown command".
      expect(suite.calls[0].args.slice(0, 5)).toEqual([
        'test',
        'e2e/export/visual-regression.spec.ts',
        '--retries=1',
        '-g',
        'draw',
      ]);
    } finally {
      boardDir.cleanup();
    }
  });
});
