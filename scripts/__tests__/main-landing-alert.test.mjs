import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

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

// Child-process landing fixtures exceed Vitest's default budget on loaded machines.
vi.setConfig({ testTimeout: 15_000 });

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main landing invalid lease timestamps', () => {
  it('shows a missing lease ID and invalid timestamp in status without creating an alert marker', () => {
    const repo = mkdtempSync(join(tmpdir(), 'main-landing-invalid-status-'));
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

    const lockDir = join(repo, '.git', 'main-landing-occupancy');
    mkdirSync(lockDir);
    writeFileSync(
      join(lockDir, 'owner.json'),
      JSON.stringify({
        occupiedSince: 'not-a-timestamp',
        owner: { branch: 'task/example', chatId: 'example-chat' },
      })
    );

    const result = spawnSync(process.execPath, [join(import.meta.dirname, '../main-landing.mjs'), 'status', '--json'], {
      cwd: repo,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      occupied: true,
      leaseIdKnown: false,
      ageKnown: false,
      age: 'unknown age',
      timestampIntegrityAlert: 'not sent',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    });
    expect(existsSync(join(lockDir, 'alert-invalid-timestamp.json'))).toBe(false);
  });

  it('posts one integrity diagnostic without applying duration thresholds or changing the lease', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-'));
    tempDirectories.push(lockDir);
    const timestamp = '2026-11-17T12:45:02.3NZ';
    const owner = {
      leaseId: 'invalid-time-lease',
      occupiedSince: timestamp,
      startedAt: timestamp,
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const original = structuredClone(owner);
    const markerFile = join(lockDir, 'alert-invalid-timestamp.json');
    const postNote = vi.fn(() => {
      const pending = JSON.parse(readFileSync(markerFile, 'utf8'));
      expect(pending).toMatchObject({
        status: 'pending',
        leaseId: owner.leaseId,
        host: hostname(),
        platform: process.platform,
        pid: process.pid,
      });
      expect(Number.isFinite(Date.parse(pending.startedAt))).toBe(true);
      return true;
    });

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(1);
    expect(postNote.mock.calls[0][1]).toContain('Lease age and recovery thresholds are unknown');
    expect(postNote.mock.calls[0][1]).toContain('Preserve the lease and main state');
    expect(JSON.parse(readFileSync(markerFile, 'utf8'))).toMatchObject({
      status: 'sent',
      leaseId: owner.leaseId,
    });
    expect(existsSync(join(lockDir, 'alert-15m.json'))).toBe(false);
    expect(existsSync(join(lockDir, 'alert-240m.json'))).toBe(false);
    expect(owner).toEqual(original);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:32.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(1);
  });

  it('retries the integrity diagnostic after delivery fails and stops after success', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-invalid-time-retry-'));
    tempDirectories.push(lockDir);
    const owner = {
      leaseId: 'retry-invalid-time-lease',
      occupiedSince: '2026-11-17T12:45:02.3NZ',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const postNote = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const paths = { lockDir };

    notifyIfDue(paths, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    const alertFile = join(lockDir, 'alert-invalid-timestamp.json');
    expect(existsSync(alertFile)).toBe(false);
    expect(readFileSync(join(lockDir, 'alert-failures.log'), 'utf8')).toContain('Main landing lease timestamp');

    notifyIfDue(paths, owner, Date.parse('2026-11-17T16:45:32.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(2);
    expect(JSON.parse(readFileSync(alertFile, 'utf8'))).toMatchObject({
      status: 'sent',
      leaseId: owner.leaseId,
    });

    notifyIfDue(paths, owner, Date.parse('2026-11-17T16:46:02.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(2);
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

  it('does not create malformed threshold markers when the lease ID is missing', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-no-lease-id-'));
    tempDirectories.push(lockDir);
    const owner = { occupiedSince: '2026-11-17T12:45:02.000Z' };
    const postNote = vi.fn(() => true);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(postNote).not.toHaveBeenCalled();
    expect(existsSync(join(lockDir, 'alert-15m.json'))).toBe(false);
    expect(existsSync(join(lockDir, 'alert-240m.json'))).toBe(false);
  });
});

describe('main landing duration alerts', () => {
  it('uses the injected delivery function for each elapsed threshold', () => {
    const lockDir = mkdtempSync(join(tmpdir(), 'main-landing-duration-alert-'));
    tempDirectories.push(lockDir);
    const owner = {
      leaseId: 'elapsed-lease',
      occupiedSince: '2026-11-17T12:45:02.000Z',
      owner: { branch: 'task/example', chatId: 'example-chat' },
    };
    const postNote = vi.fn(() => true);

    notifyIfDue({ lockDir }, owner, Date.parse('2026-11-17T16:45:02.000Z'), postNote);

    expect(postNote).toHaveBeenCalledTimes(2);
    expect(postNote.mock.calls.map(([, message]) => message)).toEqual(
      expect.arrayContaining([expect.stringContaining('15 minutes'), expect.stringContaining('4 hours')])
    );
    for (const marker of ['alert-15m.json', 'alert-240m.json']) {
      expect(JSON.parse(readFileSync(join(lockDir, marker), 'utf8'))).toMatchObject({
        status: 'sent',
        leaseId: owner.leaseId,
      });
    }
    expect(existsSync(join(lockDir, 'alert-invalid-timestamp.json'))).toBe(false);
  });
});

describe('main landing alert claims', () => {
  it('rejects alert marker keys outside the supported threshold and integrity markers', () => {
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
