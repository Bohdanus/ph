import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canRecoverOrphanAutoMerge,
  claimAlert,
  isOrphanAutoMergeState,
  observeOrphanAutoMerge,
} from '../main-landing.mjs';

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('main landing alert claims', () => {
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
      canRecoverOrphanAutoMerge({ ...owner, autoMergeLastObservedAt: new Date(now - 120_000).toISOString() }, now, {
        owner: false,
        child: null,
      })
    ).toBe(false);
  });
});
