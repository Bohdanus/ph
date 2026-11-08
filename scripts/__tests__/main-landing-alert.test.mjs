import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimAlert } from '../main-landing.mjs';

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
