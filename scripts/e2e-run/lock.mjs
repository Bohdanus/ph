import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BOARD_CLI = path.join(import.meta.dirname, '..', 'agent-board.mjs');

/** The queue's repo-relative key. */
export const E2E_SENTINEL = 'e2e/.swarm-e2e-runner';

const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_LOCK_POLL_MS = 3_000;
const DEFAULT_LOCK_LEASE = '30m';

const MAX_RENEW_EVERY_MS = 5 * 60_000;
const MIN_RENEW_EVERY_MS = 30_000;

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;
const DURATION_SCALE = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDurationMs(input) {
  const match = DURATION.exec(String(input).trim());
  if (!match) return null;
  return Math.round(Number(match[1]) * DURATION_SCALE[(match[2] || 'm').toLowerCase()]);
}

const PREFIX = '[e2e-run]';

export function resolveLease(lease, log) {
  const ms = parseDurationMs(lease);
  if (ms !== null && ms > 0) return ms;
  log(
    `${PREFIX} E2E_LOCK_LEASE=${JSON.stringify(lease)} is not a duration the board accepts, so this run is using ` +
      `the default of ${DEFAULT_LOCK_LEASE}. Use 45m, 90s, 2h, or a bare number of minutes. This is a queue, ` +
      'so nothing about the run itself depends on it.'
  );
  return parseDurationMs(DEFAULT_LOCK_LEASE);
}

export function defaultIdentity() {
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const name = String(branch.stdout ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._/@+-]/g, '-');
  return `e2e-run/${name || 'detached'}/${process.pid}`;
}

const RUN_IDENTITY_PREFIX = 'e2e-run/';

export function isHolderAlive(identity) {
  const name = String(identity);
  if (!name.startsWith(RUN_IDENTITY_PREFIX)) return true;
  const segment = name.slice(name.lastIndexOf('/') + 1);
  if (!/^\d+$/.test(segment)) return true;
  const pid = Number(segment);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function defaultExec(command, options) {
  const result = spawnSync(command[0], command.slice(1), { ...options, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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
    this.renewEveryMs =
      options.renewEveryMs ?? Math.max(MIN_RENEW_EVERY_MS, Math.min(MAX_RENEW_EVERY_MS, Math.floor(this.leaseMs / 3)));
    this.held = false;
    this.renewal = null;
  }

  #board(args, identity = this.identity) {
    return this.exec([process.execPath, BOARD_CLI, ...args, '--agent', identity], { cwd: REPO_ROOT, env: this.env });
  }

  async acquire() {
    const deadline = this.now() + this.timeoutMs;
    let announced = false;
    let reclaimAttempted = false;
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

      if (attempt.status === 4) {
        const holders = this.#holders(warnOnce);

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

      this.log(
        `${PREFIX} the swarm board is unavailable (exit ${attempt.status}: ` +
          `${firstLine(attempt.stderr || attempt.stdout)}). Running without the queue, which costs scheduling and ` +
          'nothing else — this run still starts its own server on its own port.'
      );
      return { acquired: false, reason: 'unavailable', holder: null };
    }
  }

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
    this.#board(['unlock', E2E_SENTINEL]);
  }
}
