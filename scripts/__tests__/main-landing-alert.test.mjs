import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  canRecoverOrphanAutoMerge,
  claimAlert,
  formatOperationSummary,
  isOrphanAutoMergeState,
  notifyIfDue,
  observeOrphanAutoMerge,
  resetOrphanAutoMergeFailover,
  runMergeReleaseAfterLanding,
  startWatcher,
} from '../main-landing.mjs';

const tempDirectories = [];

function runNodeChild(scriptPath, environment) {
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error('failure-log worker exited with ' + code + ' (' + signal + '): ' + stderr));
    });
  });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main landing invalid lease timestamps and bounded failure logging', () => {
  it('posts one integrity diagnostic without claiming a duration threshold or changing the lease', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-'));
    tempDirectories.push(lockDir);
    const timestamp = '2026-11-17T12:45:02.3NZ';
    const owner = {
      leaseId: 'invalid-time-lease',
      occupiedSince: timestamp,
      ownerSince: timestamp,
      startedAt: timestamp,
      heartbeatAt: timestamp,
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const original = structuredClone(owner);
    const postNote = vi.fn(() => true);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(1);
    expect(postNote.mock.calls[0][1]).toContain('Lease age and recovery thresholds are unknown');
    expect(postNote.mock.calls[0][1]).toContain('Preserve the lease and main state');
    expect(JSON.parse(readFileSync(join(lockDir, 'alert-invalid-timestamp.json'), 'utf8'))).toMatchObject({
      status: 'sent',
      leaseId: owner.leaseId,
    });
    expect(existsSync(join(lockDir, 'alert-15m.json'))).toBe(false);
    expect(existsSync(join(lockDir, 'alert-240m.json'))).toBe(false);
    expect(owner).toEqual(original);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:32.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(1);
  });

  it('retries a failed integrity diagnostic after removing its pending marker', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-retry-'));
    tempDirectories.push(lockDir);
    const owner = {
      leaseId: 'retry-invalid-time-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const postNote = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const alertFile = join(lockDir, 'alert-invalid-timestamp.json');

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(existsSync(alertFile)).toBe(false);
    expect(readFileSync(join(lockDir, 'alert-failures.log'), 'utf8').trim().split('\n')).toHaveLength(1);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:32.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(alertFile, 'utf8'))).toMatchObject({
      status: 'sent',
      leaseId: owner.leaseId,
    });
  });

  it('does not create a non-idempotent integrity marker when the lease ID is missing', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-no-lease-'));
    tempDirectories.push(lockDir);
    const owner = {
      occupiedSince: 'not-a-timestamp',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const postNote = vi.fn(() => true);

    notifyIfDue({ lockDir }, owner, Date.now(), postNote);

    expect(postNote).not.toHaveBeenCalled();
    expect(existsSync(join(lockDir, 'alert-invalid-timestamp.json'))).toBe(false);
  });

  it('does not create threshold markers when the lease ID is missing', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-no-lease-id-'));
    tempDirectories.push(lockDir);
    const owner = { occupiedSince: '2026-11-17T12:45:02.000Z' };
    const postNote = vi.fn(() => true);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(postNote).not.toHaveBeenCalled();
    expect(existsSync(join(lockDir, 'alert-15m.json'))).toBe(false);
    expect(existsSync(join(lockDir, 'alert-240m.json'))).toBe(false);
  });

  it('bounds failure history by line count while retaining the newest entries', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-log-'));
    tempDirectories.push(lockDir);
    const logFile = join(lockDir, 'alert-failures.log');
    writeFileSync(logFile, Array.from({ length: 160 }, (_, index) => 'old failure ' + index).join('\n') + '\n');
    const owner = {
      leaseId: 'bounded-log-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false);

    const log = readFileSync(logFile, 'utf8');
    const lines = log.trimEnd().split('\n');
    expect(lines).toHaveLength(128);
    expect(log).not.toContain('old failure 0\n');
    expect(log).toContain('old failure 159');
    expect(log).toContain('Main landing lease timestamp is invalid');
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(256 * 1024);
  });

  it('caps large UTF-8 failure logs without preserving a partial line or character', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-log-bytes-'));
    tempDirectories.push(lockDir);
    const logFile = join(lockDir, 'alert-failures.log');
    writeFileSync(
      logFile,
      Array.from({ length: 180 }, (_, index) => 'old failure ' + index + ' ' + '🧪'.repeat(1000)).join('\n') + '\n'
    );
    const owner = {
      leaseId: 'bounded-byte-log-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false);

    const log = readFileSync(logFile, 'utf8');
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(256 * 1024);
    expect(log).not.toContain('�');
    expect(log).not.toContain('old failure 0');
    expect(log).toContain('old failure 179');
    expect(log.trimEnd().split('\n').at(-1)).toContain('Main landing lease timestamp is invalid');
  });

  it('preserves both failure records when distinct alert deliveries log concurrently', async () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-concurrent-log-'));
    tempDirectories.push(lockDir);
    const readyDir = join(lockDir, 'ready');
    mkdirSync(readyDir);
    const logFile = join(lockDir, 'alert-failures.log');
    writeFileSync(
      logFile,
      Array.from({ length: 128 }, (_, index) => 'old failure ' + index + ' ' + 'x'.repeat(500)).join('\n') + '\n'
    );
    const workerPath = join(lockDir, 'failure-log-worker.mjs');
    const mainLandingModule = pathToFileURL(join(process.cwd(), 'scripts', 'main-landing.mjs')).href;
    writeFileSync(
      workerPath,
      `import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { notifyIfDue } from ${JSON.stringify(mainLandingModule)};

const lockDir = process.env.FAILURE_LOG_DIR;
const readyDir = process.env.FAILURE_LOG_READY_DIR;
const owner = {
  leaseId: 'concurrent-failure-log-lease',
  occupiedSince: '2026-11-17T12:00:00.000Z',
  owner: { branch: 'task/example', chatId: 'example-chat' },
};
const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
const postNote = (_paths, message) => {
  writeFileSync(join(readyDir, process.pid + '.ready'), message);
  const deadline = Date.now() + 5000;
  while (readdirSync(readyDir).filter((name) => name.endsWith('.ready')).length < 2) {
    if (Date.now() >= deadline) {
      const ready = readdirSync(readyDir).filter((name) => name.endsWith('.ready')).map((name) => ({ name, message: readFileSync(join(readyDir, name), 'utf8') }));
      throw new Error('both alert writers did not reach the barrier: ' + JSON.stringify(ready));
    }
    Atomics.wait(waitCell, 0, 0, 2);
  }
  return false;
};

notifyIfDue(
  { lockDir },
  owner,
  Date.parse('2026-11-17T16:00:00.000Z'),
  postNote
);
`,
      'utf8'
    );

    const environment = { FAILURE_LOG_DIR: lockDir, FAILURE_LOG_READY_DIR: readyDir };
    let firstWriterError;
    const firstWriter = runNodeChild(workerPath, environment).catch((error) => {
      firstWriterError = error;
    });
    const startDeadline = Date.now() + 4000;
    while (!readdirSync(readyDir).some((name) => name.endsWith('.ready'))) {
      if (firstWriterError) throw firstWriterError;
      if (Date.now() >= startDeadline) {
        await firstWriter;
        throw new Error('first alert writer did not reach the barrier');
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    if (firstWriterError) throw firstWriterError;
    await Promise.all([firstWriter, runNodeChild(workerPath, environment)]);
    if (firstWriterError) throw firstWriterError;

    const log = readFileSync(logFile, 'utf8');
    const lines = log.trimEnd().split('\n');
    expect(lines).toHaveLength(128);
    expect(log).toContain('Main landing occupied for at least 15 minutes');
    expect(log).toContain('Main landing occupied for at least 4 hours');
    expect(existsSync(join(lockDir, 'alert-failures.lock'))).toBe(false);
  }, 15_000);

  it('reclaims a failure-log lock only after its same-host process has stopped', async () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-stale-log-lock-'));
    tempDirectories.push(lockDir);
    const deadProcess = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    const deadPid = deadProcess.pid;
    await new Promise((resolve, reject) => {
      deadProcess.once('error', reject);
      deadProcess.once('close', resolve);
    });
    writeFileSync(
      join(lockDir, 'alert-failures.lock'),
      JSON.stringify({
        token: '123e4567-e89b-42d3-a456-426614174000',
        pid: deadPid,
        host: hostname(),
        platform: process.platform,
        startedAt: new Date().toISOString(),
      }) + '\n'
    );
    const owner = {
      leaseId: 'stale-log-lock-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false);

    expect(readFileSync(join(lockDir, 'alert-failures.log'), 'utf8')).toContain(
      'Main landing lease timestamp is invalid'
    );
    expect(existsSync(join(lockDir, 'alert-failures.lock'))).toBe(false);
    expect(existsSync(join(lockDir, 'owner-control.lock'))).toBe(false);
  }, 10_000);

  it('reports live contention when an unreadable failure-log lock is replaced during retry', async () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-changing-log-lock-'));
    tempDirectories.push(lockDir);
    const lockFile = join(lockDir, 'alert-failures.lock');
    const readyFile = join(lockDir, 'worker-ready');
    const replacementFile = join(lockDir, 'live-lock.tmp');
    const workerPath = join(lockDir, 'failure-log-lock-worker.mjs');
    const mainLandingModule = pathToFileURL(join(process.cwd(), 'scripts', 'main-landing.mjs')).href;
    writeFileSync(lockFile, '{ malformed lock');
    writeFileSync(
      workerPath,
      `import { writeFileSync } from 'node:fs';
import { notifyIfDue } from ${JSON.stringify(mainLandingModule)};

writeFileSync(process.env.FAILURE_LOG_READY_FILE, 'started');
try {
  notifyIfDue(
    { lockDir: process.env.FAILURE_LOG_DIR },
    { leaseId: 'changing-log-lock-lease', occupiedSince: 'invalid', owner: { branch: 'task/example' } },
    Date.now(),
    () => false
  );
} catch (error) {
  process.stderr.write('LOCK_RESULT:' + error.message);
  process.exitCode = 1;
}
`,
      'utf8'
    );
    const workerResult = runNodeChild(workerPath, {
      FAILURE_LOG_DIR: lockDir,
      FAILURE_LOG_READY_FILE: readyFile,
    }).then(
      () => ({ ok: true }),
      (error) => ({ error })
    );
    const readyDeadline = Date.now() + 4000;
    while (!existsSync(readyFile) && Date.now() < readyDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(existsSync(readyFile)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 75));

    writeFileSync(
      replacementFile,
      JSON.stringify({
        token: '123e4567-e89b-42d3-a456-426614174001',
        pid: process.pid,
        host: hostname(),
        platform: process.platform,
        startedAt: new Date().toISOString(),
      }) + '\n'
    );
    renameSync(replacementFile, lockFile);

    const result = await workerResult;
    expect(result).toHaveProperty('error');
    expect(result.error?.message).toContain('lock is held or its process liveness is unknown');
    expect(result.error?.message).not.toContain('lock is unreadable');
  }, 10_000);

  it.skipIf(process.platform === 'win32')(
    'replaces a symlinked failure log without importing its target contents',
    () => {
      const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-log-link-'));
      tempDirectories.push(lockDir);
      const targetFile = join(lockDir, 'outside.log');
      const logFile = join(lockDir, 'alert-failures.log');
      writeFileSync(targetFile, 'private target contents\n');
      symlinkSync(targetFile, logFile);
      const owner = {
        leaseId: 'symlink-log-lease',
        occupiedSince: '2026-11-17T12:45:02.3NZ',
        owner: { branch: 'task/example', chatId: 'example-chat' },
      };

      notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false);

      expect(lstatSync(logFile).isSymbolicLink()).toBe(false);
      expect(readFileSync(logFile, 'utf8')).toContain('Main landing lease timestamp is invalid');
      expect(readFileSync(logFile, 'utf8')).not.toContain('private target contents');
      expect(readFileSync(targetFile, 'utf8')).toBe('private target contents\n');
    }
  );

  it.skipIf(process.platform === 'win32')('refuses a symlinked failure-log lock without touching its target', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-log-lock-link-'));
    tempDirectories.push(lockDir);
    const targetFile = join(lockDir, 'outside-lock.json');
    const lockFile = join(lockDir, 'alert-failures.lock');
    writeFileSync(
      targetFile,
      JSON.stringify({
        token: '123e4567-e89b-42d3-a456-426614174000',
        pid: process.pid,
        host: hostname(),
        platform: process.platform,
        startedAt: new Date().toISOString(),
      }) + '\n'
    );
    symlinkSync(targetFile, lockFile);
    const owner = {
      leaseId: 'symlink-log-lock-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };

    expect(() => notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false)).toThrow(
      'main landing failure log lock is not a single-link regular file'
    );
    expect(lstatSync(lockFile).isSymbolicLink()).toBe(true);
    expect(readFileSync(targetFile, 'utf8')).toContain('123e4567-e89b-42d3-a456-426614174000');
    expect(existsSync(join(lockDir, 'alert-invalid-timestamp.json'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'replaces a hard-linked failure log without importing its target contents',
    () => {
      const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-log-hardlink-'));
      tempDirectories.push(lockDir);
      const targetFile = join(lockDir, 'outside.log');
      const logFile = join(lockDir, 'alert-failures.log');
      writeFileSync(targetFile, 'private target contents\n');
      linkSync(targetFile, logFile);
      const owner = {
        leaseId: 'hardlink-log-lease',
        occupiedSince: '2026-11-17T12:45:02.3NZ',
        owner: { branch: 'task/example', chatId: 'example-chat' },
      };

      notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false);

      expect(lstatSync(logFile).isSymbolicLink()).toBe(false);
      expect(readFileSync(logFile, 'utf8')).toContain('Main landing lease timestamp is invalid');
      expect(readFileSync(logFile, 'utf8')).not.toContain('private target contents');
      expect(readFileSync(targetFile, 'utf8')).toBe('private target contents\n');
    }
  );

  it('clears a failed alert claim when failure logging itself fails', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-log-error-'));
    tempDirectories.push(lockDir);
    mkdirSync(join(lockDir, 'alert-failures.log'));
    const owner = {
      leaseId: 'failed-log-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const alertFile = join(lockDir, 'alert-invalid-timestamp.json');

    expect(() => notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), () => false)).toThrow();
    expect(existsSync(alertFile)).toBe(false);
  });
});

describe('main landing alert claims', () => {
  it('rejects alert marker keys outside the supported thresholds and integrity marker', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-key-'));
    tempDirectories.push(lockDir);

    expect(() => claimAlert({ lockDir }, { leaseId: 'unsafe-key' }, 'nested/../../outside')).toThrow(
      'unsupported main landing alert key'
    );
    expect(existsSync(join(lockDir, 'owner-control.lock'))).toBe(false);
  });

  it.each([
    ['unknown status', { status: 'queued' }],
    [
      'pending marker without an owner pid',
      {
        status: 'pending',
        leaseId: 'incomplete-lease',
        host: hostname(),
        platform: process.platform,
        startedAt: new Date().toISOString(),
      },
    ],
    [
      'sent marker without delivery details',
      {
        status: 'sent',
        leaseId: 'incomplete-sent-lease',
        sentAt: new Date().toISOString(),
      },
    ],
  ])('recovers an invalid %s alert marker', (_case, invalid) => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-'));
    tempDirectories.push(lockDir);
    const alertFile = join(lockDir, 'alert-15m.json');
    writeFileSync(alertFile, JSON.stringify(invalid));

    const owner = { leaseId: 'recovered-lease' };
    expect(claimAlert({ lockDir }, owner, 15)).toBe(true);
    const pending = JSON.parse(readFileSync(alertFile, 'utf8'));
    expect(pending).toMatchObject({
      status: 'pending',
      leaseId: owner.leaseId,
      host: hostname(),
      platform: process.platform,
      pid: process.pid,
    });
    expect(Number.isFinite(Date.parse(pending.startedAt))).toBe(true);
    expect(claimAlert({ lockDir }, { leaseId: 'second-lease' }, 15)).toBe(false);
    expect(JSON.parse(readFileSync(alertFile, 'utf8'))).toEqual(pending);
  });

  it('preserves a structurally valid sent alert marker', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-'));
    tempDirectories.push(lockDir);
    const alertFile = join(lockDir, 'alert-15m.json');
    const sent = {
      status: 'sent',
      leaseId: 'sent-lease',
      sentAt: new Date().toISOString(),
      message: 'The landing is still occupied.',
    };
    writeFileSync(alertFile, JSON.stringify(sent));

    expect(claimAlert({ lockDir }, { leaseId: 'new-lease' }, 15)).toBe(false);
    expect(readFileSync(alertFile, 'utf8')).toBe(JSON.stringify(sent));
  });

  it('recovers a malformed alert marker while holding the recovery control lock', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-'));
    tempDirectories.push(lockDir);
    const alertFile = join(lockDir, 'alert-15m.json');
    const controlFile = join(lockDir, 'owner-control.lock');
    writeFileSync(alertFile, '{ malformed json');

    const owner = { leaseId: 'recovered-lease' };
    expect(claimAlert({ lockDir }, owner, 15)).toBe(true);
    const pending = JSON.parse(readFileSync(alertFile, 'utf8'));
    expect(pending).toMatchObject({
      status: 'pending',
      leaseId: owner.leaseId,
    });
    expect(existsSync(controlFile)).toBe(false);

    expect(claimAlert({ lockDir }, { leaseId: 'second-lease' }, 15)).toBe(false);
    expect(JSON.parse(readFileSync(alertFile, 'utf8'))).toEqual(pending);
  });

  it('preserves a malformed alert marker while another process owns the recovery control lock', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-'));
    tempDirectories.push(lockDir);
    const alertFile = join(lockDir, 'alert-15m.json');
    const controlFile = join(lockDir, 'owner-control.lock');
    const malformed = '{ malformed json';
    const control = {
      leaseId: 'active-lease',
      pid: process.pid,
      host: hostname(),
      platform: process.platform,
      startedAt: new Date().toISOString(),
    };
    writeFileSync(alertFile, malformed);
    writeFileSync(controlFile, JSON.stringify(control));

    expect(claimAlert({ lockDir }, { leaseId: 'new-lease' }, 15)).toBe(false);
    expect(readFileSync(alertFile, 'utf8')).toBe(malformed);
    expect(readFileSync(controlFile, 'utf8')).toBe(JSON.stringify(control));
  });

  it('preserves a stale pending marker while another process owns the recovery control lock', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-alert-'));
    tempDirectories.push(lockDir);
    const alertFile = join(lockDir, 'alert-15m.json');
    const controlFile = join(lockDir, 'owner-control.lock');
    const stale = {
      status: 'pending',
      leaseId: 'old-lease',
      host: 'other-host',
      platform: 'other-platform',
      pid: 1,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
    };
    const control = {
      leaseId: 'old-lease',
      pid: process.pid,
      host: hostname(),
      platform: process.platform,
      startedAt: new Date().toISOString(),
    };
    const owner = { leaseId: 'new-lease' };
    writeFileSync(alertFile, JSON.stringify(stale));
    writeFileSync(controlFile, JSON.stringify(control));

    expect(claimAlert({ lockDir }, owner, 15)).toBe(false);
    expect(readFileSync(alertFile, 'utf8')).toBe(JSON.stringify(stale));
    expect(readFileSync(controlFile, 'utf8')).toBe(JSON.stringify(control));

    rmSync(controlFile);
    expect(claimAlert({ lockDir }, owner, 15)).toBe(true);
    expect(JSON.parse(readFileSync(alertFile, 'utf8'))).toMatchObject({
      status: 'pending',
      leaseId: owner.leaseId,
    });
    expect(existsSync(controlFile)).toBe(false);
  });

  it('waits for the detached watcher readiness token before returning', async () => {
    const child = new EventEmitter();
    let unrefed = false;
    let stdoutDestroyed = false;
    let stderrDestroyed = false;
    child.pid = 12345;
    child.stdout = new EventEmitter();
    child.stdout.destroy = () => {
      stdoutDestroyed = true;
    };
    child.stderr = new EventEmitter();
    child.stderr.destroy = () => {
      stderrDestroyed = true;
    };
    child.kill = () => {};
    child.unref = () => {
      unrefed = true;
    };
    let settled = false;
    let spawnOptions;
    const pending = startWatcher({ cwd: '/temporary/project' }, 'lease-token', {
      readyTimeoutMs: 1_000,
      spawnProcess: (_command, _args, options) => {
        spawnOptions = options;
        return child;
      },
    }).then((pid) => {
      settled = true;
      return pid;
    });

    expect(spawnOptions).toMatchObject({ detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.emit('data', 'incomplete watcher startup');
    expect(settled).toBe(false);
    child.stdout.emit('data', 'KILO_MAIN_LANDING_WATCHER_READY:lease-token\n');

    await expect(pending).resolves.toBe(12345);
    expect(unrefed).toBe(true);
    expect(stdoutDestroyed).toBe(true);
    expect(stderrDestroyed).toBe(true);
  });

  it('rejects when the detached watcher exits before readiness', async () => {
    const child = new EventEmitter();
    let killed = false;
    child.pid = 12345;
    child.stdout = new EventEmitter();
    child.stdout.destroy = () => {};
    child.stderr = new EventEmitter();
    child.stderr.destroy = () => {};
    child.kill = () => {
      killed = true;
    };
    child.unref = () => {};

    const pending = startWatcher({ cwd: '/temporary/project' }, 'lease-token', {
      readyTimeoutMs: 1_000,
      spawnProcess: () => child,
    });
    child.stderr.emit('data', 'Error: Cannot find module startup-dependency');
    child.emit('close', 1, null);

    await expect(pending).rejects.toThrow('Error: Cannot find module startup-dependency');
    expect(killed).toBe(true);
  });
});

describe('persistent orphan AUTO_MERGE failover', () => {
  const orphan = {
    branch: 'main',
    operations: [{ operation: null, marker: 'AUTO_MERGE', value: null }],
  };

  it('recognizes only a main checkout with an unpaired AUTO_MERGE marker', () => {
    expect(isOrphanAutoMergeState(orphan)).toBe(true);
    expect(isOrphanAutoMergeState({ branch: 'main', operations: [] })).toBe(false);
    expect(isOrphanAutoMergeState({ ...orphan, branch: 'feature' })).toBe(false);
    expect(
      isOrphanAutoMergeState({
        ...orphan,
        operations: [{ operation: 'in-progress', marker: 'AUTO_MERGE', value: null }],
      })
    ).toBe(false);
    expect(
      isOrphanAutoMergeState({
        ...orphan,
        operations: [...orphan.operations, { operation: 'merge', marker: 'MERGE_HEAD' }],
      })
    ).toBe(false);
  });

  it('formats an unpaired marker without rendering a null operation name', () => {
    expect(formatOperationSummary(orphan.operations)).toBe('AUTO_MERGE marker without a primary operation marker');
    expect(formatOperationSummary([{ operation: 'merge', marker: 'MERGE_HEAD' }])).toBe('merge:MERGE_HEAD');
    expect(formatOperationSummary([])).toBe('none');
  });

  it('serializes an AUTO_MERGE-only main state with a nullable operation in status JSON', () => {
    const repo = mkdtempSync(join(tmpdir(), 'main-landing-status-'));
    tempDirectories.push(repo);
    const initialized = spawnSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });
    expect(initialized.status).toBe(0);

    for (const [key, value] of [
      ['ph.mainWorktreeGitDir', join(repo, '.git')],
      ['ph.mainWorktreePath', repo],
    ]) {
      const configured = spawnSync('git', ['-C', repo, 'config', '--local', key, value], { encoding: 'utf8' });
      expect(configured.status).toBe(0);
    }
    writeFileSync(join(repo, '.git', 'AUTO_MERGE'), 'unpaired marker\n');

    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../main-landing.mjs'), 'status', '--json'], {
      cwd: repo,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      occupied: true,
      branch: 'main',
      operations: [{ operation: null, marker: 'AUTO_MERGE', value: null }],
    });
  });

  it('requires the same main and AUTO_MERGE tree to be observed continuously for 30 minutes', () => {
    const first = observeOrphanAutoMerge({}, orphan, 'main-a:tree-a', 0);
    const second = observeOrphanAutoMerge(first, orphan, 'main-a:tree-a', 60_000);
    expect(second.autoMergeObservedSince).toBe(first.autoMergeObservedSince);

    const changedTree = observeOrphanAutoMerge(second, orphan, 'main-a:tree-b', 120_000);
    expect(changedTree.autoMergeObservedSince).toBe(new Date(120_000).toISOString());

    const observationGap = observeOrphanAutoMerge(second, orphan, 'main-a:tree-a', 161_000);
    expect(observationGap.autoMergeObservedSince).toBe(new Date(161_000).toISOString());
    expect(observeOrphanAutoMerge(second, { branch: 'main', operations: [] }, null, 90_000)).not.toHaveProperty(
      'autoMergeObservedSince'
    );
  });

  it('waits for the full threshold and a stopped landing process tree', () => {
    const now = 30 * 60_000;
    const owner = {
      mode: 'landing',
      autoMergeRecoveryReady: true,
      mainSha: 'a'.repeat(40),
      incomingSha: 'b'.repeat(40),
      treeSha: 'c'.repeat(40),
      autoMergeSignature: 'main-a:tree-a',
      autoMergeObservedSince: new Date(0).toISOString(),
      autoMergeLastObservedAt: new Date(now).toISOString(),
      owner: { branch: 'feature', chatId: 'test-chat', pid: 1, childPid: 2 },
    };

    expect(canRecoverOrphanAutoMerge(owner, now - 1, { owner: false, child: null })).toBe(false);
    expect(canRecoverOrphanAutoMerge(owner, now, { owner: true, child: null })).toBe(false);
    expect(canRecoverOrphanAutoMerge(owner, now, { owner: false, child: true })).toBe(false);
    expect(canRecoverOrphanAutoMerge(owner, now, { owner: false, child: null })).toBe(false);
    expect(canRecoverOrphanAutoMerge(owner, now, { owner: false, child: false })).toBe(true);
    expect(
      canRecoverOrphanAutoMerge({ ...owner, autoMergeFailoverAttempted: true }, now, { owner: false, child: false })
    ).toBe(false);
    expect(
      canRecoverOrphanAutoMerge({ ...owner, autoMergeLastObservedAt: new Date(now - 120_000).toISOString() }, now, {
        owner: false,
        child: null,
      })
    ).toBe(false);
  });

  it('restarts the 30-minute observation if failover fails before creating a worktree', () => {
    const now = 60 * 60_000;
    const owner = {
      mode: 'landing',
      autoMergeRecoveryReady: true,
      autoMergeFailoverAttempted: true,
      autoMergeFailoverStartedAt: new Date(now - 1_000).toISOString(),
      autoMergeRecoveryPath: '/tmp/not-created',
      autoMergeSignature: 'main-a:tree-a',
      autoMergeObservedSince: new Date(0).toISOString(),
      autoMergeLastObservedAt: new Date(now - 1_000).toISOString(),
      owner: { pid: 100, childPid: 101, branch: 'feature', chatId: 'test-chat' },
      previousOwner: { pid: 1, childPid: 2, branch: 'feature', chatId: 'test-chat' },
    };

    const reset = resetOrphanAutoMergeFailover(owner, orphan, 'main-a:tree-a', now);

    expect(reset.autoMergeFailoverAttempted).toBe(false);
    expect(reset.autoMergeRecoveryReady).toBe(true);
    expect(reset.owner).toMatchObject({ pid: 1, childPid: null, branch: 'feature', chatId: 'test-chat' });
    expect(reset.autoMergeObservedSince).toBe(new Date(now).toISOString());
    expect(reset.autoMergeLastObservedAt).toBe(new Date(now).toISOString());
    expect(reset).not.toHaveProperty('previousOwner');
    expect(reset).not.toHaveProperty('autoMergeFailoverStartedAt');
    expect(reset).not.toHaveProperty('autoMergeRecoveryPath');
  });
});

describe('post-landing board claim cleanup', () => {
  it('runs the shared merge-release script from the designated main path', async () => {
    let invocation;
    const paths = { mainPath: '/temporary/designated-main' };
    const owner = { leaseId: 'landing-lease' };

    await expect(
      runMergeReleaseAfterLanding(paths, owner, {
        run: async (command, args, options) => {
          invocation = { command, args, options };
          return { code: 0 };
        },
      })
    ).resolves.toBe(true);

    expect(invocation).toMatchObject({
      command: process.execPath,
      args: [join(import.meta.dirname, '../merge-release.mjs')],
      options: { cwd: paths.mainPath, env: process.env },
    });
    expect(typeof invocation.options.onPid).toBe('function');
  });

  it('does not turn a claim-release failure into a failed landing', async () => {
    const errors = [];
    await expect(
      runMergeReleaseAfterLanding(
        { mainPath: '/temporary/designated-main' },
        { leaseId: 'landing-lease' },
        {
          run: async () => ({ code: 1 }),
          reportError: (message) => errors.push(message),
        }
      )
    ).resolves.toBe(false);
    expect(errors).toEqual(['main-landing: merge claim cleanup exited nonzero; inspect swarm state.']);
  });
});
