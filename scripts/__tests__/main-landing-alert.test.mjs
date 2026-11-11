import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canRecoverOrphanAutoMerge,
  claimAlert,
  isOrphanAutoMergeState,
  observeOrphanAutoMerge,
  resetOrphanAutoMergeFailover,
  startWatcher,
} from '../main-landing.mjs';

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main landing alert claims', () => {
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
    operations: [{ operation: 'in-progress', marker: 'AUTO_MERGE', value: null }],
  };

  it('recognizes only an unnamed AUTO_MERGE operation on main', () => {
    expect(isOrphanAutoMergeState(orphan)).toBe(true);
    expect(isOrphanAutoMergeState({ ...orphan, branch: 'feature' })).toBe(false);
    expect(
      isOrphanAutoMergeState({
        ...orphan,
        operations: [...orphan.operations, { operation: 'merge', marker: 'MERGE_HEAD' }],
      })
    ).toBe(false);
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
