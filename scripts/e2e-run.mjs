#!/usr/bin/env node
/**
 * The single entry point for a Playwright run in this repository.
 *
 * There are two independent mechanisms here, and the difference between them is the
 * whole design.
 *
 * ## 1. The guarantee: this run starts its own server
 *
 * **A run tests the checkout it was started in, or it does not run.**
 *
 * A dev server started by somebody else is the worst failure mode this repository
 * has, because it is invisible. Every worktree under `.kilo/worktrees/` serves its
 * own checkout, so two worktrees on one port is two different applications on one
 * address; a run that attaches to the wrong one tests code it never touched, reports
 * green, and reads exactly like "my change did nothing". `TEST-FLAKES.md` §10 is a
 * mutation campaign that reported seven product mutations as green for precisely
 * that reason.
 *
 * So this does not depend on anything cooperating. It is true by construction:
 *
 * 1. **The run picks its own port** and exports it as `PLAYWRIGHT_PORT`, so the dev
 *    server, the `baseURL` the tests navigate to, and the port Playwright probes are
 *    one number belonging to this run.
 * 2. **The port is verified bindable** immediately before the suite starts, and
 *    re-picked if it is not.
 * 3. **Server reuse is switched off in the config with no way to turn it on.**
 *    `playwright.config.ts` reads `reuseExistingServer: false` unconditionally.
 * 4. **The dev server is started with `--strictPort`**, so a port taken in the moment
 *    between (2) and Vite's own `bind` is a startup FAILURE rather than Vite's
 *    default silent hop to the next free port.
 *
 * The outcome is binary: you get a server this run started, or you get a red run.
 * There is no third outcome in which the suite quietly tests a neighbour. Step (2) is
 * belt and braces around the real guarantee, which is (3) plus (4).
 *
 * ## 2. The optimisation: the swarm lock, which is only a queue
 *
 * The lock on `e2e/.swarm-e2e-runner` serializes suites so two agents rarely run at
 * once — less port pressure, less CPU contention, and one readable log at a time. It
 * is **advisory**, and everything above works without it:
 *
 * - Two runs may proceed simultaneously. That is survivable and needs no
 *   coordination, because each has its own port and its own output directory.
 * - If the board cannot be reached, a run says so and starts anyway.
 * - If the wait times out, a run says so and starts anyway.
 *
 * **No run ever refuses to run because of the lock.** A queue that can block a
 * merge gate is a gate, and a gate that is not 100% enforceable is worse than no
 * gate: it looks like a guarantee and is not one. This is why the lock is allowed to
 * be approximate — its value is entirely in the scheduling, and its absence costs
 * only scheduling.
 *
 * It is held as a RUN rather than as a branch, for a reason that is a property of the
 * board and not a matter of taste: board identity is the git branch and the conflict
 * test is `lock.agent_id !== who` (the holder check in `holdFiles()`), so a
 * branch never conflicts with itself. Two runs in one worktree would both "acquire",
 * and the second one's `unlock` would release the row the first still believes it
 * holds. The holder is therefore `e2e-run/<branch>/<pid>`.
 *
 * ## What else this file does
 *
 * - **`test` is the Playwright subcommand, and npm appends arguments after the
 *   script.** `npm run test:e2e -- e2e/foo.spec.ts` has to become
 *   `playwright test e2e/foo.spec.ts`; without this line it becomes
 *   `playwright e2e/foo.spec.ts`, which Playwright reads as an unknown command.
 * - **Each run gets its own `outputDir`.** Playwright DELETES `outputDir` at the
 *   start of every run (`playwright/lib/runner/index.js:6398-6417`), so two
 *   concurrent runs sharing one would erase each other's failure screenshots. This
 *   is a real reason to isolate output and it has nothing to do with locking.
 * - **The HTML report is NOT isolated.** `npm run test:e2e:report` is a bare
 *   `playwright show-report` and resolves `playwright-report`; a per-run folder
 *   would leave it with nothing to open.
 * - **The port is recorded**, not only printed, so a run that fails an hour later is
 *   diagnosed from the port that actually served it. The destination is the
 *   `runRecordPath` option and nothing else: a run started by any npm script records
 *   where it always has, and a caller that has a file of its own — `runPlaywright` is
 *   the same idea for the suite itself — can say so instead of writing the shared one.
 *
 * ## Environment
 *
 * - `PLAYWRIGHT_PORT` — use this port instead of picking one. Still this run's own
 *   server: reuse is off, so a busy port fails rather than attaches.
 * - `PLAYWRIGHT_BASE_URL` — **refused by default**, here AND in
 *   `e2e/global-setup.ts`. The second one is the load-bearing one: this file is not
 *   loaded by `npm run test:e2e:raw` or by the CI job's bare `npx playwright test`,
 *   and `playwright.config.ts` resolves `use.baseURL` from the variable itself, so a
 *   refusal that lived only here was one command away from being false. It works with
 *   `E2E_ALLOW_REMOTE=1`, and both layers log the target on every permitted run.
 * - `PLAYWRIGHT_REUSE_EXISTING_SERVER` — **refused, always.** The config no longer
 *   reads it; setting it now means expecting a behaviour that no longer exists, so it
 *   is an error rather than a silent no-op.
 * - `E2E_LOCK_TIMEOUT`, `E2E_LOCK_POLL`, `E2E_LOCK_LEASE` — how long to queue for
 *   the lock, how often to re-check, and how long a dead holder blocks the queue.
 * - `E2E_SKIP_LOCK=1` (or `--no-lock`) — skip the queue entirely, loudly. Since the
 *   lock is only a queue, this costs scheduling and nothing else.
 * - Quiet output is the default. `--verbose` or `E2E_QUIET=0` streams suite output;
 *   `--quiet` or `E2E_QUIET=1` explicitly captures it and replays it to stderr only
 *   when the suite fails. This keeps green runs from flooding the transcript with
 *   minutes of list-reporter lines, using the same batching strategy as
 *   `scripts/quiet-command.mjs`. stdin remains inherited, so Ctrl-C reaches the child.
 * - `CI` — keeps the default port and the default output directory. A CI job owns
 *   its runner outright, and the `e2e` job's artifacts are collected from the shared
 *   `test-results/`.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const BOARD_CLI = path.join(import.meta.dirname, 'agent-board.mjs');

/**
 * The queue's key. Virtual, repo-relative, and under `e2e/` only because that is
 * where a reader looks for an e2e concern — it claims nothing in that directory, and
 * an agent editing `e2e/*.spec.ts` holds those files separately. A relative path
 * never reaches the filesystem, which is the same property that lets an agent hold a
 * file it is about to create (`holdFiles()` canonicalises repo-relative paths).
 */
export const E2E_SENTINEL = 'e2e/.swarm-e2e-runner';

const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_LOCK_POLL_MS = 3_000;

/**
 * How long a DEAD holder blocks the queue — the crash window, for the case where
 * the holder's WORKTREE is still on disk.
 *
 * The board does renew a file lock now: `renewOwnLocks` extends this run's own
 * sentinel while its worktree exists, which is what keeps a LIVE holder's queue
 * slot from being taken by the sweep. Nothing renews a DEAD run's lock, because
 * nothing is running that identity, so this timer still reclaims it. And a run
 * whose worktree has been deleted is reclaimed on that fact alone, by the
 * `dead-worktree-lock` finding in `Board.doctor`.
 *
 * Which is why the reclaim below is not left to the timer. `isHolderAlive` reads
 * the pid out of the identity and answers in seconds rather than in half an hour,
 * and it is the only one of the three that does not need the filesystem to still
 * be there.
 */
const DEFAULT_LOCK_LEASE = '30m';

/**
 * The renewal ceiling. The real interval is a third of the lease, never more.
 */
const MAX_RENEW_EVERY_MS = 5 * 60_000;

/**
 * The renewal floor, and why it is not optional. The renewal body is a synchronous
 * `spawnSync` of the board CLI, so an interval short enough to derive from a
 * sub-minute lease would spawn a node process many times a second and block the
 * event loop that Playwright's inherited stdout depends on. `E2E_LOCK_LEASE=500ms`
 * is a duration the board accepts; it must not become a 166ms spawn loop.
 */
const MIN_RENEW_EVERY_MS = 30_000;

/**
 * The board's own duration grammar, read off `parseDuration`
 * (`parseDuration()`'s own JSDoc): `45m`, `90s`, `2h`, `500ms`, or a bare number of minutes.
 * Copied rather than imported because the board is reached through its CLI, and a
 * lease this wrapper cannot parse is a queue it would silently never join.
 */
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;
const DURATION_SCALE = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseDurationMs(input) {
  const match = DURATION.exec(String(input).trim());
  if (!match) return null;
  return Math.round(Number(match[1]) * DURATION_SCALE[(match[2] || 'm').toLowerCase()]);
}

const PREFIX = '[e2e-run]';

/* -------------------------------------------------------------------------- */
/* The guarantee: this run's own server                                         */
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

/** Can this process still take the port? The check that shrinks the race window. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * A port that was still free a moment ago, checked as late as possible.
 *
 * The check cannot close the gap between this returning and Vite calling `bind` —
 * nothing outside a single `listen` can — and that is fine. The guarantee does not
 * come from this function: it comes from `reuseExistingServer: false` plus
 * `--strictPort`, which turn the race into a startup failure. Re-picking on a lost
 * race just makes that rare enough that nobody waits for it.
 */
export async function reservePort() {
  for (let attempt = 1; ; attempt += 1) {
    const port = await findFreePort();
    if (await isPortFree(port)) return { port, attempt };
    if (attempt >= 5) {
      throw new Error(
        'picked a free port five times in a row and lost it every time. Something on this machine is ' +
          'claiming ports as fast as they are released.'
      );
    }
  }
}

/**
 * The port this run uses, or `null` to leave `playwright.config.ts`'s own default.
 *
 * - `CI`: one job, one checkout, one runner, and the workflow documents :5173.
 * - `PLAYWRIGHT_PORT`: the caller chose, out loud. Still this run's own server —
 *   reuse is off, so a busy port fails rather than attaches.
 * - otherwise: pick one. This is the case that used to collide.
 */
export function resolvePort(env, ci) {
  if (ci) return { port: null, reason: 'CI runs one checkout on one runner' };
  if (env.PLAYWRIGHT_PORT) {
    return { port: null, reason: `PLAYWRIGHT_PORT=${env.PLAYWRIGHT_PORT} was chosen by the caller` };
  }
  return { port: 'allocate', reason: 'no port was chosen, so this run picks its own' };
}

/**
 * The settings that would break the one rule, refused before a browser exists.
 *
 * Both are errors rather than warnings. A run that quietly tested a server it did
 * not start is the failure this whole file is for, so the request is answered where
 * the operator or agent is still reading.
 *
 * This is the FRIENDLY copy, not the load-bearing one. `e2e/global-setup.ts` enforces
 * the same rule for every invocation, including `npm run test:e2e:raw` and the CI
 * job's bare `npx playwright test`, which never load this file. An earlier version of
 * this branch had the guarantee here alone, and it was one command away from being
 * false.
 */
export function assertOwnServer(env) {
  if (env.PLAYWRIGHT_REUSE_EXISTING_SERVER) {
    throw new Error(
      `PLAYWRIGHT_REUSE_EXISTING_SERVER=${JSON.stringify(env.PLAYWRIGHT_REUSE_EXISTING_SERVER)} is no longer ` +
        'supported. playwright.config.ts now sets reuseExistingServer: false with no way to turn it on, because a ' +
        'run that attaches to a server it did not start tests the wrong checkout and reports green. Unset the ' +
        'variable; this run will start its own server on a port of its own.'
    );
  }
  if (env.PLAYWRIGHT_BASE_URL && env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(
      `PLAYWRIGHT_BASE_URL=${env.PLAYWRIGHT_BASE_URL} points the tests at a server this run did not start, which ` +
        'is the one thing that must never happen here. If you mean to test a deployed build, say so explicitly ' +
        'with E2E_ALLOW_REMOTE=1 — the run logs that it did, so a report can never claim the branch was verified ' +
        'against its own checkout when it was not.'
    );
  }
  return env.PLAYWRIGHT_BASE_URL ? 'E2E_ALLOW_REMOTE=1: this run tests a REMOTE build, not this checkout' : null;
}

/* -------------------------------------------------------------------------- */
/* The queue: the swarm lock, which is only a queue                             */
/* -------------------------------------------------------------------------- */

function defaultExec(command, options) {
  const result = spawnSync(command[0], command.slice(1), { ...options, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function readNumber(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * A lease this wrapper cannot parse is reported and replaced, not fatal.
 *
 * `parseDuration` in the board throws `BoardError code 1` on `30min` and its CLI
 * exits 1, which is also what a missing board looks like. An earlier version of this
 * file let that distinction decide the run, so a typo in one environment variable
 * killed a suite — and worse, it killed it even under `--no-lock`, `E2E_SKIP_LOCK=1`
 * and `CI=true`, because the lock was constructed before those were considered. That
 * made a scheduling knob into a hard block on a merge gate, which is the exact thing
 * the advisory-queue design exists to prevent, and three documents stated the
 * forgiving behaviour the code did not have.
 *
 * So it forgives, like its two siblings `readNumber` handles: say what was ignored,
 * use the default, and let the run go. The alternative is to amend three documents
 * instead, and the documents are right.
 */
function resolveLease(lease, log) {
  const ms = parseDurationMs(lease);
  if (ms !== null && ms > 0) return ms;
  log(
    `${PREFIX} E2E_LOCK_LEASE=${JSON.stringify(lease)} is not a duration the board accepts, so this run is using ` +
      `the default of ${DEFAULT_LOCK_LEASE}. Use 45m, 90s, 2h, or a bare number of minutes. This is a queue, ` +
      'so nothing about the run itself depends on it.'
  );
  return parseDurationMs(DEFAULT_LOCK_LEASE);
}

/**
 * This run's board identity: the branch, so `swarm status` says which checkout has
 * the suite, plus the pid, so two runs on one branch are two holders rather than one
 * holder and a race.
 */
function defaultIdentity() {
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const name = String(branch.stdout ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._/@+-]/g, '-');
  return `e2e-run/${name || 'detached'}/${process.pid}`;
}

/** The prefix this file owns. Anything else on the sentinel is not ours to judge. */
const RUN_IDENTITY_PREFIX = 'e2e-run/';

/**
 * The board identity ends in the holder's pid, and a pid is a liveness signal.
 *
 * This matters more than it looks. The identity is `e2e-run/<branch>/<pid>`, so a run
 * that was killed — a terminal closed, a tool timeout, a crash — leaves a queue entry
 * that looks exactly like a run in progress, and the board cannot tell the difference
 * until the lease runs out. Measured here: a hard-killed holder made the next run wait
 * the entire `E2E_LOCK_TIMEOUT` (10 minutes) for a process that no longer existed,
 * before proceeding as designed. The queue is only scheduling, so ten minutes of dead
 * air in front of a merge gate is pure loss — and the fix is not a shorter timer, it
 * is positive evidence.
 *
 * ## Why it only answers for identities this file created
 *
 * The reclaim path UNLOCKS as the holder it is reclaiming, so a wrong answer here is
 * not a wrong log line: it releases a real agent's queue slot. The board's default
 * identity is the sanitized git branch and `sanitize` preserves `/`
 * (it keeps `A-Za-z0-9._/@+-`), so a holder on a branch called
 * `fix/1234`, or anyone who passed `--agent 2026`, has an identity whose last segment
 * parses as a pid. Probing pid 1234, finding nothing, and unlocking that agent's row
 * is the failure this guard exists to prevent — an earlier version of this function
 * did precisely that, while the comment above it claimed it could not happen.
 *
 * Hence: the prefix is required, and the segment must be ALL digits. `Number.parseInt`
 * alone is not enough, because it accepts `1234abc` and returns 1234.
 */
function isHolderAlive(identity) {
  const name = String(identity);
  if (!name.startsWith(RUN_IDENTITY_PREFIX)) return true; // not ours to judge
  const segment = name.slice(name.lastIndexOf('/') + 1);
  if (!/^\d+$/.test(segment)) return true;
  const pid = Number(segment);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to somebody else, which is alive.
    return error?.code === 'EPERM';
  }
}

/**
 * A swarm file hold used as a queue.
 *
 * The CLI is the interface on purpose: `scripts/agent-board.mjs` is the tested
 * surface and its exit codes are the documented vocabulary ("4 file held by another
 * agent"). Reading the SQLite file from a second script would put two places that
 * know the schema.
 *
 * Nothing here can fail a run. `acquire` resolves with what it managed, and the
 * caller proceeds either way.
 */
export class SwarmLock {
  constructor(options = {}) {
    this.env = options.env ?? process.env;
    this.log = options.log ?? ((line) => console.log(line));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
    this.exec = options.exec ?? defaultExec;
    this.identity = options.identity ?? defaultIdentity();
    this.lease = options.lease ?? this.env.E2E_LOCK_LEASE ?? DEFAULT_LOCK_LEASE;
    this.timeoutMs = options.timeoutMs ?? readNumber(this.env.E2E_LOCK_TIMEOUT, DEFAULT_LOCK_TIMEOUT_MS);
    this.pollMs = options.pollMs ?? readNumber(this.env.E2E_LOCK_POLL, DEFAULT_LOCK_POLL_MS);
    this.leaseMs = resolveLease(this.lease, this.log);
    // A third of the lease, capped ABOVE and floored below.
    //
    // The cap is 5 minutes because a suite is minutes long and a renewal is cheap.
    // The floor matters more than it looks: the renewal body is a synchronous
    // `spawnSync` of the board CLI, so a lease short enough to derive a sub-second
    // interval turns the wrapper into the bottleneck and stalls the stdout it exists
    // to keep streaming. `E2E_LOCK_LEASE=500ms` is a value the board accepts and an
    // earlier version of this file's own error message used to advertise; it derived
    // a 166ms spawn loop. Sub-minute leases are honoured, floored, and said to be.
    this.renewEveryMs =
      options.renewEveryMs ?? Math.max(MIN_RENEW_EVERY_MS, Math.min(MAX_RENEW_EVERY_MS, Math.floor(this.leaseMs / 3)));
    this.held = false;
    this.renewal = null;
  }

  /**
   * `node scripts/agent-board.mjs <args>`, in the repository root.
   *
   * `identity` defaults to this run's, and is a parameter because reclaiming the queue
   * from a dead holder means acting AS that holder: passing `--agent` twice makes the
   * board take the last one, so the reclaim ran as us, matched no row, and reported
   * success — `unlock` exits 0 whether or not it released anything. That is what made
   * the first version of the dead-holder reclaim look like it worked.
   *
   * `process.execPath`, not a bare `node`: the rest of this file deliberately avoids
   * PATH lookup, and a `node` on PATH that is a different interpreter — an nvm shim
   * on another major, anything without `node:sqlite` — turns every board call into
   * exit 1, which the caller reports as "the board is unavailable" and proceeds. The
   * queue would then be permanently and silently gone and look like a healthy run.
   */
  #board(args, identity = this.identity) {
    return this.exec([process.execPath, BOARD_CLI, ...args, '--agent', identity], { cwd: REPO_ROOT, env: this.env });
  }

  /**
   * Wait for the sentinel, and report what happened either way.
   *
   * Resolves `{ acquired, reason, holder }` with `reason` one of `free` (got it),
   * `contended` (gave up waiting), `unavailable` (no board) or `skipped`. None of
   * them is an error the caller has to handle: the run starts regardless, because
   * the port guarantee does not depend on any of this.
   */
  async acquire() {
    const deadline = this.now() + this.timeoutMs;
    let announced = false;
    let reclaimAttempted = false;
    // One flag rather than a log per degraded probe, so a long wait does not
    // produce a line per poll.
    let warnedAboutHolders = false;
    const warnOnce = (line) => {
      if (warnedAboutHolders) return;
      warnedAboutHolders = true;
      this.log(line);
    };

    for (;;) {
      const attempt = this.#board(['hold', E2E_SENTINEL, '--lease', this.lease]);

      if (attempt.status === 0) {
        this.held = true;
        return { acquired: true, reason: 'free', holder: null };
      }

      // Exit 4 is the board's documented "file held by another agent", and it is
      // deliberately not collapsed into 1: the code says the queue is busy, not that
      // this script is broken.
      if (attempt.status === 4) {
        const holders = this.#holders(warnOnce);

        // A holder whose process is gone is not queueing, it is debris. Reclaim it
        // rather than waiting out its lease: the board cannot check this itself (a
        // file lock's holder is a string, and its own reclamation is a timer), and the
        // queue is worth nothing to the next run while it is blocked behind a corpse.
        // `unlock` only removes the named row, so a live holder is never touched.
        //
        // ONCE, and then only via the normal wait path. This loop calls the board
        // synchronously, so a branch that `continue`s without awaiting is a tight
        // synchronous loop that no timer can interrupt — an earlier version of this
        // code could hang the whole test run that way when the unlock did not take.
        if (!reclaimAttempted && holders.length > 0 && holders.every((id) => !isHolderAlive(id))) {
          reclaimAttempted = true;
          this.log(
            `${PREFIX} the e2e queue is held by a process that no longer exists (${holders.join(', ')}); ` +
              'reclaiming it rather than waiting for its lease to run out'
          );
          for (const identity of holders) {
            const freed = this.#board(['unlock', E2E_SENTINEL], identity);
            if (freed.status !== 0) {
              this.log(`${PREFIX} could not release ${identity} (exit ${freed.status}); carrying on regardless`);
            }
          }
          await this.sleep(0);
          continue;
        }

        const holder = holders.join(', ') || null;
        if (!announced) {
          announced = true;
          const how = this.timeoutMs === 0 ? 'E2E_LOCK_TIMEOUT=0, so it will not wait' : 'queueing';
          this.log(`${PREFIX} another run has the e2e queue${holder ? ` (${holder})` : ''}; ${how}`);
        }
        if (this.now() >= deadline) {
          this.log(
            `${PREFIX} waited ${this.timeoutMs}ms for ${E2E_SENTINEL}` +
              `${holder ? `, still held by ${holder}` : ''} and is going ahead anyway. That costs a concurrent run, ` +
              'not correctness: this run still starts its own server on its own port.'
          );
          return { acquired: false, reason: 'contended', holder };
        }
        await this.sleep(Math.min(this.pollMs, Math.max(0, deadline - this.now())));
        continue;
      }

      // Anything else means the BOARD is unavailable: no git home, no `node:sqlite`,
      // a database that will not open.
      this.log(
        `${PREFIX} the swarm board is unavailable (exit ${attempt.status}: ` +
          `${firstLine(attempt.stderr || attempt.stdout)}). Running without the queue, which costs scheduling and ` +
          'nothing else — this run still starts its own server on its own port.'
      );
      return { acquired: false, reason: 'unavailable', holder: null };
    }
  }

  /**
   * Who holds the sentinel right now, as board identities.
   *
   * Every degraded path here LOGS. An earlier version returned `[]` silently on both
   * a wrong exit code and a parse failure, and an empty list is the one value that
   * disables the dead-holder reclaim — so a board that changed its `check` output
   * shape would cost the next run the full `E2E_LOCK_TIMEOUT` waiting behind a
   * corpse, with nothing in the log to say why. It is reported once per `acquire`.
   */
  #holders(warn) {
    const probe = this.#board(['check', E2E_SENTINEL, '--json']);
    if (probe.status !== 1) {
      warn(
        `could not read the queue's holders (check exited ${probe.status}: ` +
          `${firstLine(probe.stderr || probe.stdout)}), so a dead holder cannot be reclaimed and this run may ` +
          'wait its full timeout. Only scheduling is at stake.'
      );
      return [];
    }
    try {
      const parsed = JSON.parse(probe.stdout);
      const entry = parsed?.report?.find((item) => item.path === E2E_SENTINEL);
      return (entry?.holders ?? []).map((holder) => holder.agent_id);
    } catch (error) {
      warn(
        `could not parse the queue's holders (${error instanceof Error ? error.message : String(error)}), so a ` +
          'dead holder cannot be reclaimed and this run may wait its full timeout. Only scheduling is at stake.'
      );
      return [];
    }
  }

  /**
   * Keep the lease alive for as long as the suite runs.
   *
   * A renewal that FAILS means the lock is gone, so a second run may be queueing. Since
   * correctness does not depend on the lock, this is not fatal — it is worth saying out
   * loud, because the thing it predicts is exactly the thing the operator would
   * otherwise discover as a slow run.
   */
  startRenewal(onLost) {
    if (!this.held || this.renewal) return;
    this.renewal = setInterval(() => {
      const renew = this.#board(['hold', E2E_SENTINEL, '--lease', this.lease]);
      if (renew.status === 0) return;
      this.held = false;
      this.stopRenewal();
      onLost(
        `the ${E2E_SENTINEL} queue could not be renewed (exit ${renew.status}), so another run may start alongside ` +
          'this one. The suite keeps going: both runs have their own ports.'
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
    // agent unless given --force, so a late timer cannot free a run that has
    // legitimately taken the sentinel since.
    this.#board(['unlock', E2E_SENTINEL]);
  }
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
 * `outputDir` is per-run because Playwright deletes it at the start of every run
 * (`playwright/lib/runner/index.js:6398-6417`), and because two runs are allowed to
 * happen at once. The HTML report deliberately is not isolated: it is a viewer,
 * `npm run test:e2e:report` is a bare `show-report` that resolves `playwright-report`,
 * and the artifacts worth keeping are in `outputDir`.
 */
export function runOutputPaths(repoRoot, runId) {
  return { outputDir: path.join(repoRoot, 'test-results', 'runs', runId), htmlDir: null };
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
 * The default quiet mode captures output and replays it only on failure; `--verbose`
 * can restore live streaming for diagnosis. `process.execPath` plus a resolved path
 * means no shell, no PATH lookup, and no `playwright.cmd` on Windows.
 *
 * ## Quiet mode
 *
 * When `options.quiet` is set (the default for wrapped runs), stdout and stderr
 * are piped — captured but never seen by the terminal — and replayed to stderr
 * ONLY when the suite exits non-zero. This mirrors `scripts/quiet-command.mjs`,
 * which the commit and push gates already use so a green check stays silent. An
 * e2e suite that passes should not emit a wall of list-reporter lines into the
 * transcript every time; only a failure does, with the full output to diagnose it.
 *
 * `stdio: ['inherit', 'pipe', 'pipe']` keeps stdin attached so Ctrl-C still
 * reaches the child.
 *
 * ## Why there are signal handlers at all, and what they cost
 *
 * The child shares this process's process group, so Ctrl-C in the terminal reaches
 * Playwright directly. Registering a handler is still necessary for one case the
 * group does not cover — `kill <wrapper-pid>`, which an agent or a script does, and
 * which would otherwise leave the suite running with nobody waiting for it.
 *
 * The cost is real, though: a registered handler REPLACES Node's default exit, so
 * every later signal is also forwarded and the wrapper keeps waiting. A suite wedged
 * in a browser teardown would then be un-interruptible from the terminal, and the
 * only way out would be `kill -9` on the wrapper pid. So the second signal stops
 * waiting: it says so and exits with the shell's own 128+SIGINT. The first is
 * forwarded and the child decides when it is done.
 */
export function runPlaywright(args, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? REPO_ROOT;
  const cli = options.cli ?? resolvePlaywrightCli();
  const quiet = options.quiet ?? false;

  return new Promise((resolve, reject) => {
    const stdio = quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit';
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio });

    let signalled = 0;
    const forward = (signal, name) => () => {
      signalled += 1;
      if (signalled === 1) {
        child.kill(signal);
        return;
      }
      console.error(`${PREFIX} ${name} again: the suite is not stopping, so this wrapper is giving up on it.`);
      cleanup();
      process.exit(128 + (constants.signals[signal] ?? 0));
    };
    const onSigint = forward('SIGINT', 'interrupted');
    const onSigterm = forward('SIGTERM', 'terminated');
    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    const captured = quiet ? [] : null;
    if (quiet) {
      child.stdout.on('data', (chunk) => captured.push(chunk));
      child.stderr.on('data', (chunk) => captured.push(chunk));
    }

    child.on('error', (error) => {
      cleanup();
      if (quiet && captured.length > 0) process.stderr.write(Buffer.concat(captured));
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      // A signalled run has no exit code of its own. 128 + signal is the shell's
      // own convention, and it keeps `npm run test:e2e` red either way.
      const exitCode = signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1);
      if (quiet && exitCode !== 0) {
        const output = Buffer.concat(captured);
        if (output.length > 0) process.stderr.write(output);
      }
      resolve(exitCode);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a run records its port, so a human or a later agent can find it after the
 * fact. `.kilo/` is gitignored and machine-local, which is right for per-run state;
 * the same numbers are printed, and stdout is what a run's log actually contains.
 *
 * A constant, and the DEFAULT rather than the only choice: `run()` takes it as
 * `options.runRecordPath`. This path is real machine state that `npm run test:e2e`
 * overwrites on every run, and a second process on this worktree owns it — so anything
 * that merely wants to exercise `run()` has to be able to point the record somewhere
 * of its own, exactly as it passes its own `runPlaywright`. Without that, a test of
 * this module either destroys a live run's record or races one, and neither failure
 * is visible from the test that caused it.
 */
const RUN_RECORD = path.join(REPO_ROOT, '.kilo', 'e2e-last-run.json');

const HELP = [
  `${PREFIX} node scripts/e2e-run.mjs [playwright args...]`,
  '',
  '  Every argument is forwarded to Playwright verbatim, after the `test` subcommand:',
  '    npm run test:e2e -- e2e/sidebar-flyout.spec.ts',
  '    npm run test:e2e -- --retries=1 e2e/undo-redo.spec.ts',
  '',
  '  THE GUARANTEE: this run starts its own dev server, on a port it picks, and records',
  '  that port. Server reuse is impossible - playwright.config.ts sets',
  '  reuseExistingServer: false with no way to turn it on, and the server is started with',
  '  --strictPort, so a busy port is a startup failure rather than a silent attach to',
  '  another checkout. PLAYWRIGHT_BASE_URL and PLAYWRIGHT_REUSE_EXISTING_SERVER are refused.',
  '',
  '  THE QUEUE: the run also takes the swarm lock e2e/.swarm-e2e-runner so two agents',
  '  rarely run e2e at once. It is advisory - a run never refuses to start because of it,',
  '  and a board that cannot be reached just means no queue. Two runs at once is fine.',
  '',
  '  Quiet output is the default. --verbose (or E2E_QUIET=0) streams suite output;',
  '  --quiet (or E2E_QUIET=1) explicitly captures it, replaying only on failure.',
  '  This keeps a green run from flooding the terminal with minutes of list-reporter',
  '  lines — the same batching strategy the commit and push gates use.',
  '',
  '  Environment: E2E_LOCK_TIMEOUT, E2E_LOCK_POLL, E2E_LOCK_LEASE, E2E_SKIP_LOCK=1,',
  '  E2E_QUIET=0|1, E2E_ALLOW_REMOTE=1. The header of scripts/e2e-run.mjs is the full contract.',
].join('\n');

export async function run(argv, options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => console.log(line));
  const ci = Boolean(env.CI);
  const spawnSuite = options.runPlaywright ?? runPlaywright;
  // `?? ` and not `||`: an explicitly empty string is a caller that wants nowhere,
  // and it must not silently resolve to the shared path.
  const runRecordPath = options.runRecordPath ?? RUN_RECORD;

  // `test` is the Playwright SUBCOMMAND, and npm appends a caller's arguments after
  // the script rather than inside it. The scripts that call this wrapper
  // (`test:e2e:headed`, `:ui`, `:debug`, `:update-baselines`) pass run arguments
  // too, so every one of them needs the subcommand as well. Wrapper flags are
  // consumed here and never forwarded to Playwright.
  const separatorIndex = argv.indexOf('--');
  const wrapperArgs = argv.slice(0, separatorIndex === -1 ? argv.length : separatorIndex);
  const forwardedArgs = wrapperArgs.filter((arg) => !['--no-lock', '--quiet', '--verbose'].includes(arg));
  if (separatorIndex !== -1) forwardedArgs.push(...argv.slice(separatorIndex));
  const quiet = wrapperArgs.includes('--quiet') || (!wrapperArgs.includes('--verbose') && env.E2E_QUIET !== '0');
  const playwrightArgv = ['test', ...forwardedArgs];

  if (isHelpRequest(playwrightArgv)) {
    // Nothing runs, so there is nothing to prepare — but the refusals still run
    // first (below the port), because `PLAYWRIGHT_REUSE_EXISTING_SERVER` is documented
    // as refused unconditionally and "unconditionally" should not have a help-shaped
    // exception. They are cheap and they throw before anything is started.
    assertOwnServer(env);
    return spawnSuite(playwrightArgv, { ...options, env, quiet: false });
  }

  // The guarantee is settled first, because it is the one that must not be negotiable.
  const remote = assertOwnServer(env);
  if (remote) log(`${PREFIX} WARNING: ${remote}`);

  if (quiet) log(`${PREFIX} quiet: suite output is captured and only shown on failure`);

  const childEnv = { ...env };

  if (!ci) {
    const { port, reason } = resolvePort(env, ci);
    if (port === 'allocate') {
      const reserved = await reservePort();
      childEnv.PLAYWRIGHT_PORT = String(reserved.port);
      log(
        `${PREFIX} port ${reserved.port} (${reason}` +
          `${reserved.attempt > 1 ? `, re-picked ${reserved.attempt} times` : ''})`
      );
    } else {
      log(`${PREFIX} port: unchanged, ${reason}`);
    }

    // `--last-failed` reads `<outputDir>/.last-run.json` and silently runs the WHOLE
    // suite when that file is not where it expects it
    // (playwright/lib/runner/index.js:6608-6625 swallows the read error and applies no
    // filter). A per-run `outputDir` moves that file every run, so without this the
    // flag quietly stops meaning anything — an agent that ran it to re-check a fix
    // would be told everything passed. Pinned to the SHARED path, which is also where
    // `npm run test:e2e:clean` already looks for it.
    childEnv.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE = path.join(REPO_ROOT, 'test-results', '.last-run.json');
  }

  // The queue, second, and best-effort. A run that cannot have it runs anyway.
  //
  // The lock is constructed ONLY on the branch that uses it. An earlier version built
  // it unconditionally, before this decision, so a run that had already declared it
  // would not queue still paid for `git rev-parse` and for lease validation — and a
  // bad lease killed it outright (see `resolveLease`).
  const skipReason = ci
    ? 'CI'
    : env.E2E_SKIP_LOCK === '1'
      ? 'E2E_SKIP_LOCK=1'
      : wrapperArgs.includes('--no-lock')
        ? '--no-lock'
        : null;
  const lock = skipReason ? null : (options.lock ?? new SwarmLock({ ...options, env, log }));
  let queued = false;

  if (skipReason === 'CI') {
    log(`${PREFIX} CI: one checkout, one runner, so the e2e queue is not used.`);
  } else if (skipReason) {
    log(`${PREFIX} ${skipReason}: not queueing. Only scheduling is lost; this run still has a port of its own.`);
  } else {
    const attempt = await lock.acquire();
    queued = attempt.acquired;
    if (queued) log(`${PREFIX} running with the e2e queue held.`);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const paths = runOutputPaths(REPO_ROOT, runId);
  let runRecord = null;

  if (!ci) {
    // A caller who passed their own `--output` has said where the run's output goes.
    // Two `--output` flags is not an error to Playwright, it silently takes the last
    // one, so the caller's wins by not being overridden. BOTH spellings: the bundled
    // commander accepts `--output=dir` as well as `--output dir`, and `includes` on
    // the bare token missed the equals form — so a caller who used it had their
    // choice discarded with a log line that still looked correct.
    if (!hasOutputFlag(playwrightArgv)) {
      playwrightArgv.push('--output', paths.outputDir);
      log(`${PREFIX} output: ${path.relative(REPO_ROOT, paths.outputDir)}`);
    } else {
      log(`${PREFIX} output: as given on the command line`);
    }

    // What the tests will actually load. On the sanctioned remote path the port is
    // still allocated and still served by this run's own dev server, so deriving
    // `baseUrl` from it unconditionally recorded a localhost URL as the thing under
    // test — in the one file whose stated job is to stop a report implying a local
    // verification. The remote target is recorded too, and `remote` is true.
    runRecord = {
      runId,
      pid: process.pid,
      port: childEnv.PLAYWRIGHT_PORT ?? null,
      baseUrl:
        env.PLAYWRIGHT_BASE_URL ?? (childEnv.PLAYWRIGHT_PORT ? `http://localhost:${childEnv.PLAYWRIGHT_PORT}` : null),
      remote: Boolean(remote),
      outputDir: paths.outputDir,
      queued,
      startedAt: new Date().toISOString(),
    };
    writeRunRecord(runRecord, runRecordPath);
    // The default is named relative to the repository, because that is the path a
    // reader is told to look for. An injected one is printed as given: it is outside
    // the repository by construction, and a `../..`-relative rendering of a temp
    // directory would be noise in the one line that says where the run left evidence.
    log(
      `${PREFIX} port recorded in ${
        runRecordPath === RUN_RECORD ? path.relative(REPO_ROOT, runRecordPath) : runRecordPath
      }`
    );
  }

  try {
    if (queued) lock.startRenewal((why) => log(`${PREFIX} ${why}`));
    const code = await spawnSuite(playwrightArgv, { ...options, env: childEnv, quiet });
    // Close the record. Without this, a run that died before Playwright started and a
    // run that served an hour of tests leave byte-identical evidence except for the
    // wall-clock stamp, and the file exists to be read by someone debugging a failure
    // an hour later.
    if (!ci) writeRunRecord({ ...runRecord, exitCode: code, finishedAt: new Date().toISOString() }, runRecordPath);
    return code;
  } finally {
    lock?.release();
  }
}

/** Did the caller already choose an output directory, in either spelling? */
function hasOutputFlag(args) {
  return args.some((arg) => arg === '--output' || arg.startsWith('--output='));
}

/**
 * Is this a request for Playwright's own help or version, rather than a run?
 *
 * Only tokens BEFORE the first bare `--` count. Playwright treats everything after
 * `--` as a grep pattern, so `e2e/foo.spec.ts -- --help` is a filtered run whose
 * pattern is the string `--help`; short-circuiting on it would print help instead of
 * running the suite. `-h` and `-v` are Playwright's own aliases
 * (playwright/lib/program.js) and an earlier version matched neither, so `-h` fell
 * through the whole path: it allocated a port, took the queue, wrote a run record,
 * and then printed help.
 */
function isHelpRequest(args) {
  const positional = args.slice(0, args.indexOf('--') === -1 ? undefined : args.indexOf('--'));
  return ['--help', '-h', '--version', '-v'].some((flag) => positional.includes(flag));
}

/**
 * The last run's port and output directory, for whoever is diagnosing it later.
 *
 * `target` defaults to the shared `RUN_RECORD` so that every existing caller keeps
 * the documented path; `run()` passes its own resolved destination through, and both
 * of its writes — the start-write and the close-write — must go to the SAME file. A
 * run that recorded its port in one place and its exit code in another would be
 * indistinguishable from a run that died at startup, which is the whole reason the
 * second write exists.
 */
function writeRunRecord(record, target = RUN_RECORD) {
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    // A record that could not be written must not stop the suite. The port is also
    // on stdout, and stdout is what a run's log actually contains.
    console.error(`${PREFIX} could not record the run: ${error instanceof Error ? error.message : String(error)}`);
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
 *
 * Both sides are `realpath`ed. Comparing a resolved path to an unresolved one is a
 * mismatch for an ordinary symlink, and the result of that mismatch is the worst
 * shape this file can produce: the module imports, does nothing, and the process
 * exits 0 — an "e2e run" that ran no tests and reported success. `realpathSync` on a
 * path that does not exist throws, so it is applied only to paths that resolve.
 */
function invokedAsThisFile() {
  if (!process.argv[1]) return false;
  const resolve = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolve(process.argv[1]) === resolve(path.join(import.meta.dirname, 'e2e-run.mjs'));
}

if (invokedAsThisFile()) {
  const argv = process.argv.slice(2);
  if (argv.includes('--e2e-run-help')) {
    console.log(HELP);
    process.exitCode = 0;
  } else {
    process.exitCode = await main(argv);
  }
}
