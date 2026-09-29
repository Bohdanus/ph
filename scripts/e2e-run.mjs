#!/usr/bin/env node
/**
 * The single entry point for a Playwright run in this repository.
 *
 * ## Why this exists
 *
 * `playwright.config.ts` was written for a machine that runs one suite at a time.
 * Under a swarm it is not one machine running one suite: several agents, each in
 * its own worktree, each firing `npm run test:e2e` before merging. Three separate
 * things go wrong, and all three of them look like something else:
 *
 * 1. **Two runs share one port.** Every worktree wants :5173, and Vite's default
 *    is to hop to the next free port rather than fail. A run that silently ends up
 *    on a server a *different* checkout started tests that checkout's code, which
 *    reads exactly like "my change did nothing". `TEST-FLAKES.md` §10 is a whole
 *    mutation campaign that reported seven mutations green for this reason.
 * 2. **Two runs share one output directory.** Playwright DELETES `outputDir` at the
 *    start of every run (`playwright/lib/runner/index.js:6398-6417`). Serialized or
 *    not, the second run erases the first run's failure screenshots before anybody
 *    has read them.
 * 3. **Two runs fight over the same dev server.** `reuseExistingServer` used to
 *    default to ON locally, so a second run attached to whatever got there first,
 *    and a stale Vite process from a dead agent outlived the run that started it.
 *
 * The fix is not "be careful". It is a lock: one run at a time, each with its own
 * port and its own output directory, so the collisions above are impossible rather
 * than discouraged. The lock is a **swarm file hold** on a sentinel path, which
 * means every agent in every worktree can see who has it (`npm run swarm status`)
 * and the ordinary `doctor` sweep reclaims it if a holder dies.
 *
 * ## What the lock is and is not
 *
 * `e2e/.swarm-e2e-runner` is a VIRTUAL path. It is never created on disk, and no
 * agent should ever create it. That is legitimate: the board's path normalization
 * is lexical on purpose and a relative path never reaches the filesystem
 * (`scripts/lib/agent-board/db.mjs:1409`), which is the same property that lets an
 * agent hold a file it is about to create. The sentinel is a mutex, not a claim on
 * anything in that directory, and an agent editing `e2e/*.spec.ts` holds those
 * files separately.
 *
 * ## Every run still happens, including the ones that "already passed"
 *
 * A lock that agents skip under pressure is worse than no lock, because it makes
 * the skip invisible. Nothing here can tell whether a change is "heavy UI work",
 * and the Definition of Done already requires `test:e2e` for a user-visible change
 * before it merges. This wrapper does not weaken that: it queues the run, names the
 * agent ahead of you, and exits with the board's own code 4 rather than letting a
 * second suite start on top of a live one.
 *
 * ## Knobs (all optional, all in the environment)
 *
 * - `E2E_LOCK_TIMEOUT` — how long to wait for the sentinel, in ms. Default 10
 *   minutes. `0` fails immediately instead of queueing.
 * - `E2E_LOCK_POLL` — how often to re-check while waiting, in ms. Default 3000.
 * - `E2E_LOCK_LEASE` — the board lease for the hold, as `swarm` spells it (`30m`,
 *   `2h`, or a bare number of minutes). Default `30m`.
 * - `E2E_SKIP_LOCK=1` — run without taking the sentinel, loudly. The operator's
 *   escape hatch; `--no-lock` is the same thing as a flag.
 *
 * `PLAYWRIGHT_PORT`, `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_REUSE_EXISTING_SERVER` and
 * `PLAYWRIGHT_ALLOW_HEADED` keep their meanings in `playwright.config.ts`; this
 * wrapper only fills in a port when you have not chosen one.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const BOARD_CLI = path.join(import.meta.dirname, 'agent-board.mjs');

/**
 * The mutex. Virtual, repo-relative, and under `e2e/` only because that is where a
 * reader looks for an e2e concern — it claims nothing in that directory, and an
 * agent editing `e2e/*.spec.ts` holds those files separately.
 */
const SENTINEL = 'e2e/.swarm-e2e-runner';

const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_LOCK_POLL_MS = 3_000;

/**
 * The lease, and the reason it is not the board's 45-minute default: a FILE lock
 * is never renewed. `renewOwnClaims` touches only the `claims` table
 * (`scripts/lib/agent-board/db.mjs:1762-1780`), so a long suite would watch its own
 * lock expire under it, `doctor` would reclaim it on the next board command from
 * anybody, and a second suite would start on top of a live one. The lease below is
 * therefore the CRASH window — how long a dead holder blocks everyone else — and
 * the renewal timer is what stops it firing under a live holder.
 */
const DEFAULT_LOCK_LEASE = '30m';

/** Comfortably inside the lease, so one missed tick is not an expired lock. */
const RENEW_EVERY_MS = 5 * 60_000;

const PREFIX = '[e2e-run]';

/* -------------------------------------------------------------------------- */
/* Ports                                                                       */
/* -------------------------------------------------------------------------- */

/** Ask the OS for a port nothing is listening on, then let it go. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the OS returned no TCP port to use'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * The port this run should use, or `null` to leave `playwright.config.ts`'s own
 * default in place.
 *
 * The rules, in order, and each exists because of a way the run can end up testing
 * somebody else's code:
 *
 * - `PLAYWRIGHT_BASE_URL` set: the tests navigate somewhere this wrapper did not
 *   start, so a local port is not the subject of the run. Leave it alone.
 * - `PLAYWRIGHT_PORT` set: the caller chose, out loud. Respect it.
 * - `PLAYWRIGHT_REUSE_EXISTING_SERVER=1`: the operator asked to attach to a dev
 *   server they started, so the run belongs on the default port where it is.
 * - CI: one job, one checkout, one runner. The port is in the job log and the
 *   workflow documents :5173, so keep it predictable.
 * - otherwise: allocate. This is the case that used to collide.
 */
export function resolvePort(env, ci) {
  if (env.PLAYWRIGHT_BASE_URL) return { port: null, reason: 'PLAYWRIGHT_BASE_URL is set, leaving the port alone' };
  if (env.PLAYWRIGHT_PORT) {
    return { port: null, reason: `PLAYWRIGHT_PORT=${env.PLAYWRIGHT_PORT} was chosen by the caller` };
  }
  if (env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1') {
    return { port: null, reason: 'server reuse was requested, so the run belongs on the default port' };
  }
  if (ci) return { port: null, reason: 'CI runs one checkout on one runner' };
  return { port: 'allocate', reason: 'no port was chosen and reuse was not requested' };
}

/* -------------------------------------------------------------------------- */
/* The swarm lock                                                              */
/* -------------------------------------------------------------------------- */

function defaultExec(command, options) {
  const result = spawnSync(command[0], command.slice(1), { ...options, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A swarm file hold, driven through the CLI rather than the database.
 *
 * The CLI is the interface on purpose: `scripts/agent-board.mjs` is the tested
 * surface, its exit codes are documented as the interface ("4 file held by another
 * agent"), and reading the SQLite file from a second script would put two places
 * that know the schema. Each call is one short-lived `node` process, which costs
 * nothing beside a suite and keeps this file free of board internals.
 */
export class SwarmLock {
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.log = options.log ?? ((line) => console.log(line));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.exec = options.exec ?? defaultExec;
    this.lease = options.lease ?? this.env.E2E_LOCK_LEASE ?? DEFAULT_LOCK_LEASE;
    this.timeoutMs = options.timeoutMs ?? readNumber(this.env.E2E_LOCK_TIMEOUT, DEFAULT_LOCK_TIMEOUT_MS);
    this.pollMs = options.pollMs ?? readNumber(this.env.E2E_LOCK_POLL, DEFAULT_LOCK_POLL_MS);
    this.renewEveryMs = options.renewEveryMs ?? RENEW_EVERY_MS;
    this.held = false;
    this.renewal = null;
  }

  /** `node scripts/agent-board.mjs <args>`, in the repository root. */
  #board(args) {
    return this.exec(['node', BOARD_CLI, ...args], { cwd: REPO_ROOT, env: this.env });
  }

  /**
   * Take the sentinel, or give up once `timeoutMs` has passed.
   *
   * The result distinguishes THREE outcomes, not two, and the caller needs all
   * three: a held lock (run), contention that timed out (refuse, exit 4) and a
   * board that cannot be reached at all (warn, then run unlocked — failing every
   * suite on a machine whose `node:sqlite` is missing would be worse than the
   * collision the lock prevents).
   */
  async acquire() {
    const deadline = this.now() + this.timeoutMs;
    let announced = false;

    for (;;) {
      const attempt = this.#board(['hold', SENTINEL, '--lease', this.lease]);

      if (attempt.status === 0) {
        this.held = true;
        return { acquired: true, reason: 'free', holder: null };
      }

      // Exit 4 is the board's documented "file held by another agent", and it is
      // deliberately not collapsed into 1: an exit code tells a branching agent
      // that another agent has the suite, not that this script is broken.
      if (attempt.status === 4) {
        const holder = this.#holderName();
        if (!announced) {
          announced = true;
          const how = this.timeoutMs === 0 ? 'E2E_LOCK_TIMEOUT=0, so this fails instead of waiting' : 'queueing';
          this.log(`${PREFIX} another agent is running e2e${holder ? ` (${holder})` : ''}; ${how}`);
        }
        if (this.now() >= deadline) {
          this.log(
            `${PREFIX} gave up after ${this.timeoutMs}ms waiting for ${SENTINEL}` +
              `${holder ? `, still held by ${holder}` : ''}. Nothing ran. Do the other work, then run the ` +
              'same command again — it queues exactly the same way.'
          );
          return { acquired: false, reason: 'contended', holder };
        }
        await this.sleep(Math.min(this.pollMs, Math.max(0, deadline - this.now())));
        continue;
      }

      // Anything else means the BOARD is unavailable: no git home, no `node:sqlite`,
      // a database that will not open.
      this.log(
        `${PREFIX} WARNING: the swarm board is unavailable (exit ${attempt.status}: ` +
          `${firstLine(attempt.stderr || attempt.stdout)}), so this run is NOT serialized against other ` +
          "agents' suites. Run inside the repository on Node 24+ to get the lock."
      );
      return { acquired: false, reason: 'unavailable', holder: null };
    }
  }

  /** Who holds the sentinel right now, for a message somebody can act on. */
  #holderName() {
    const probe = this.#board(['check', SENTINEL, '--json']);
    if (probe.status !== 1) return null;
    try {
      const parsed = JSON.parse(probe.stdout);
      const entry = parsed?.report?.find((item) => item.path === SENTINEL);
      const holders = entry?.holders ?? [];
      return holders.length > 0 ? holders.map((holder) => holder.agent_id).join(', ') : null;
    } catch {
      return null;
    }
  }

  /**
   * Keep the lease alive for as long as the suite runs.
   *
   * A renewal that FAILS is not a warning. It means this run's lock is gone — most
   * likely reaped by `doctor` on another agent's command — so a second suite is
   * entitled to start and this one has to stop. `onLost` is what stops it.
   *
   * Measured on a full local suite: 5m23s, which is past `RENEW_EVERY_MS` and so
   * exercises this path on an ordinary run. Without it the same suite on a slower
   * machine, or a full one twice over, would sit on a lease that expires under it.
   */
  startRenewal(onLost) {
    if (!this.held || this.renewal) return;
    this.renewal = setInterval(() => {
      const renew = this.#board(['hold', SENTINEL, '--lease', this.lease]);
      if (renew.status === 0) return;
      this.held = false;
      this.stopRenewal();
      onLost(
        `the ${SENTINEL} lock could not be renewed (exit ${renew.status}). Another agent may have taken it, ` +
          'so this run is being stopped rather than left racing a second suite.'
      );
    }, this.renewEveryMs);
    // Never the reason the process stays alive: the child process is.
    this.renewal.unref?.();
  }

  stopRenewal() {
    if (!this.renewal) return;
    clearInterval(this.renewal);
    this.renewal = null;
  }

  release() {
    this.stopRenewal();
    if (!this.held) return;
    this.held = false;
    // Only ever releases OUR OWN hold: `unlock` skips a row belonging to another
    // agent unless given --force, so a late timer here cannot free a suite that
    // has legitimately taken the sentinel since.
    this.#board(['unlock', SENTINEL]);
  }
}

function readNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function firstLine(value) {
  const line = String(value ?? '')
    .trim()
    .split('\n')[0];
  if (!line) return 'no output';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/* -------------------------------------------------------------------------- */
/* Running Playwright                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where this run's output goes.
 *
 * Both are per-run, and both live under directories that are gitignored wholesale
 * (`test-results`, `playwright-report`), so isolation costs one nested directory
 * and nothing else. The HTML folder is set through the ENVIRONMENT because that is
 * the only lever the installed Playwright reads ahead of the config
 * (`playwright/lib/runner/index.js:3506-3509`); `outputDir` has no environment
 * equivalent in 1.63, so it is set with the `--output` flag instead.
 */
export function runOutputPaths(repoRoot, runId) {
  return {
    outputDir: path.join(repoRoot, 'test-results', 'runs', runId),
    htmlDir: path.join(repoRoot, 'playwright-report', 'runs', runId),
  };
}

/** The Playwright CLI, resolved through Node so an ancestor `node_modules` works. */
export function resolvePlaywrightCli() {
  const require = createRequire(path.join(REPO_ROOT, 'package.json'));
  const manifestPath = require.resolve('@playwright/test/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.playwright;
  if (!entry) throw new Error('@playwright/test declares no `playwright` bin, so its CLI cannot be started');
  return path.join(path.dirname(manifestPath), entry);
}

/**
 * Start the suite and resolve with the exit code it finished on.
 *
 * `stdio: 'inherit'` is the reason this is a wrapper and not `execSync`: an e2e
 * suite streams a `list` reporter for minutes, and a buffered child looks hung.
 * `process.execPath` plus a resolved path means no shell, no PATH lookup, and no
 * `playwright.cmd` on Windows.
 *
 * `onChild` hands the child back so the caller can stop it — the lock renewal in
 * `run()` is what needs that, because a run that has lost the sentinel must not
 * keep a browser and a dev server alive while a second suite starts.
 */
export function runPlaywright(args, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? REPO_ROOT;
  const cli = options.cli ?? resolvePlaywrightCli();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: 'inherit' });
    if (typeof options.onChild === 'function') options.onChild(child);

    // The same handlers are used to forward and to detach, so `off` below removes
    // exactly what `on` registered.
    const onSigint = () => child.kill('SIGINT');
    const onSigterm = () => child.kill('SIGTERM');
    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      // A signalled run has no exit code of its own. 128 + signal is the shell's
      // own convention, and it keeps `npm run test:e2e` red either way.
      resolve(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1));
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

const HELP = [
  `${PREFIX} node scripts/e2e-run.mjs [playwright args...]`,
  '',
  '  Every argument is forwarded to Playwright verbatim:',
  '    npm run test:e2e -- e2e/sidebar-flyout.spec.ts',
  '    npm run test:e2e -- --retries=1 e2e/undo-redo.spec.ts',
  '',
  '  The run takes the swarm lock e2e/.swarm-e2e-runner first, so one suite runs at a',
  '  time across every worktree, and gives the run a port and an output directory of',
  '  its own. Exit 4 means another agent has the sentinel and nothing ran.',
  '',
  '  Environment: E2E_LOCK_TIMEOUT, E2E_LOCK_POLL, E2E_LOCK_LEASE, E2E_SKIP_LOCK=1.',
  '  The header of scripts/e2e-run.mjs is the full contract.',
].join('\n');

export async function run(argv, options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => console.log(line));
  const ci = Boolean(env.CI);
  const spawnSuite = options.runPlaywright ?? runPlaywright;

  const noLock = argv.includes('--no-lock') || env.E2E_SKIP_LOCK === '1';
  const passthrough = argv.filter((arg) => arg !== '--no-lock');

  // `test` is the Playwright SUBCOMMAND, and npm appends a caller's arguments after
  // the script rather than inside it: `npm run test:e2e -- e2e/foo.spec.ts` used
  // to resolve to `playwright test e2e/foo.spec.ts`, and without this line it
  // resolves to `playwright e2e/foo.spec.ts`, which Playwright reads as an unknown
  // command. The scripts that call this wrapper (`test:e2e:headed`, `:ui`,
  // `:debug`, `:update-baselines`) pass run arguments too, so every one of them
  // needs the subcommand as well.
  const playwrightArgv = ['test', ...passthrough];

  if (playwrightArgv.includes('--help') || playwrightArgv.includes('--version')) {
    // Nothing runs, so there is nothing to serialize and nothing to isolate.
    return spawnSuite(playwrightArgv, { ...options, env });
  }

  const lock = options.lock ?? new SwarmLock({ env, log, ...options });
  let locked = false;

  if (noLock) {
    log(`${PREFIX} --no-lock: running UNSERIALIZED against other agents' suites.`);
  } else if (ci) {
    log(`${PREFIX} CI: one checkout, one runner, so the swarm lock is not used.`);
  } else {
    const attempt = await lock.acquire();
    if (attempt.reason === 'contended') {
      // Exit 4, the board's own code for "somebody else holds this file", so an
      // agent branching on exit codes learns the same thing here as it would from
      // `swarm check`.
      log(`${PREFIX} not running: another agent holds the e2e sentinel.`);
      return 4;
    }
    locked = attempt.acquired;
  }

  const playwrightArgs = [...playwrightArgv];
  const childEnv = { ...env };
  let child = null;

  /**
   * A run that has lost the sentinel stops, and says why. Waiting for the suite to
   * finish "naturally" here is the wrong trade: the next agent has been told the
   * sentinel is free, and a second suite is entitled to be running against the same
   * checkout while this one is still driving a browser at it.
   */
  const stopForLostLock = (why) => {
    log(`${PREFIX} ${why}`);
    child?.kill('SIGTERM');
  };

  try {
    if (locked) lock.startRenewal(stopForLostLock);

    if (!ci) {
      const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
      const paths = runOutputPaths(REPO_ROOT, runId);
      playwrightArgs.push('--output', paths.outputDir);
      childEnv.PLAYWRIGHT_HTML_OUTPUT_DIR = paths.htmlDir;
      log(`${PREFIX} output: ${path.relative(REPO_ROOT, paths.outputDir)} (report under playwright-report/runs)`);

      const { port, reason } = resolvePort(env, ci);
      if (port === 'allocate') {
        const free = await findFreePort();
        childEnv.PLAYWRIGHT_PORT = String(free);
        log(`${PREFIX} port ${free} (${reason})`);
      } else {
        log(`${PREFIX} port: unchanged, ${reason}`);
      }
    }

    if (locked) log(`${PREFIX} running with the e2e sentinel held.`);
    return await spawnSuite(playwrightArgs, {
      ...options,
      env: childEnv,
      onChild: (started) => {
        child = started;
      },
    });
  } finally {
    lock.release();
  }
}

export async function main(argv) {
  try {
    return await run(argv);
  } catch (error) {
    console.error(`${PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Entry-point detection by path, never by `import.meta.url` against
 * `process.argv[1]`: this module is imported in-process by
 * `scripts/__tests__/e2e-run.test.mjs`, and under Vitest `import.meta.url` is an
 * `http://localhost/…` URL, which `fileURLToPath` cannot resolve. `import.meta.dirname`
 * is what the sibling board test uses for the same reason.
 */
const INVOKED_AS = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (INVOKED_AS === path.join(import.meta.dirname, 'e2e-run.mjs')) {
  const argv = process.argv.slice(2);
  if (argv.includes('--e2e-run-help')) {
    console.log(HELP);
    process.exitCode = 0;
  } else {
    process.exitCode = await main(argv);
  }
}
