import { describe, expect, it, vi } from 'vitest';

import {
  pidExists,
  processRuntimeScopeToken,
  processStartToken,
  recordedProcessIsAlive,
} from '../lib/process-identity.mjs';

describe('processStartToken', () => {
  it('can identify the current process on a supported runtime', () => {
    expect(processStartToken(process.pid)).toEqual(expect.any(String));
  });

  it('uses the Linux boot ID and parses starttime after a command name containing parentheses', () => {
    const pid = 123;
    const fields = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 1)), '8675309'];
    const readlink = (path) => {
      if (path === '/proc/self') return String(pid);
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      if (path === '/proc/self/ns/time') return 'time:[4026531837]';
      throw new Error(`unexpected path: ${path}`);
    };
    const readFile = vi.fn((path) => {
      if (path === '/proc/self/status') return `Name:\ttest\nNStgid:\t${pid}\n`;
      if (path === '/proc/sys/kernel/random/boot_id') return 'boot-uuid\n';
      if (path === `/proc/${pid}/stat`) return `${pid} (odd ) command) ${fields.join(' ')}\n`;
      throw new Error('unexpected path');
    });

    expect(processStartToken(pid, { platform: 'linux', readFile, readlink, currentPid: pid })).toBe(
      'linux:pid:[4026531836]:time:[4026531837]:boot-uuid:8675309'
    );
    expect(readFile).toHaveBeenCalledTimes(3);
  });

  it('returns no Linux token when the process entry is unreadable or malformed', () => {
    const readlink = (path) => {
      if (path === '/proc/self') return '123';
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      if (path === '/proc/self/ns/time') return 'time:[4026531837]';
      throw new Error(`unexpected path: ${path}`);
    };
    expect(
      processStartToken(123, {
        platform: 'linux',
        readFile: () => {
          throw new Error('denied');
        },
        readlink,
      })
    ).toBeNull();
    expect(
      processStartToken(123, {
        platform: 'linux',
        readFile: (path) => (path === '/proc/self/status' ? 'Name:\ttest\nNStgid:\t123\n' : '123 (name) S 1 2'),
        readlink,
      })
    ).toBeNull();
    expect(
      processStartToken(123, {
        platform: 'linux',
        readFile: (path) => {
          if (path === '/proc/self/status') return 'Name:\ttest\nNStgid:\t123\n';
          return path.includes('boot_id') ? 'boot-uuid' : '124 (name) S';
        },
        readlink,
      })
    ).toBeNull();
  });

  it('rejects Linux procfs when its self PID is outside the caller PID view', () => {
    const readFile = vi.fn();
    expect(
      processStartToken(123, {
        platform: 'linux',
        currentPid: 123,
        readlink: (path) => (path === '/proc/self' ? '456' : 'pid:[4026531836]'),
        readFile,
      })
    ).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('identifies the caller PID and time namespaces without treating another namespace as this one', () => {
    const readlink = (path) => {
      if (path === '/proc/self') return '/proc/123';
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      if (path === '/proc/self/ns/time') return 'time:[4026531837]';
      throw new Error(`unexpected path: ${path}`);
    };
    const readFile = () => 'Name:\ttest\nNStgid:\t123\n';
    expect(processRuntimeScopeToken({ platform: 'linux', readFile, readlink, currentPid: 123 })).toBe(
      'linux:pid:[4026531836]:time:[4026531837]'
    );
    expect(processRuntimeScopeToken({ platform: 'linux', readFile, readlink, currentPid: 124 })).toBeNull();
    expect(processRuntimeScopeToken({ platform: 'win32', readFile, readlink, currentPid: 123 })).toBeNull();
  });

  it('rejects a numerically coincident PID from a procfs mount in an ancestor PID namespace', () => {
    const readlink = (path) => {
      if (path === '/proc/self') return '123';
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      if (path === '/proc/self/ns/time') return 'time:[4026531837]';
      throw new Error(`unexpected path: ${path}`);
    };
    const readFile = () => 'Name:\ttest\nNStgid:\t123 123\n';
    expect(processRuntimeScopeToken({ platform: 'linux', readFile, readlink, currentPid: 123 })).toBeNull();
  });

  it('rejects Linux process identity when time namespace identity is unavailable', () => {
    const readlink = (path) => {
      if (path === '/proc/self') return '123';
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      throw new Error(`unexpected path: ${path}`);
    };
    const readFile = () => 'Name:\ttest\nNStgid:\t123\n';
    expect(processRuntimeScopeToken({ platform: 'linux', readFile, readlink, currentPid: 123 })).toBeNull();
  });

  it('rejects Linux process identity when the procfs PID hierarchy is missing', () => {
    const readlink = (path) => {
      if (path === '/proc/self') return '123';
      if (path === '/proc/self/ns/pid') return 'pid:[4026531836]';
      if (path === '/proc/self/ns/time') return 'time:[4026531837]';
      throw new Error(`unexpected path: ${path}`);
    };
    const readFile = () => 'Name:\ttest\n';
    expect(processRuntimeScopeToken({ platform: 'linux', readFile, readlink, currentPid: 123 })).toBeNull();
  });

  it('pins Darwin lstart formatting to a stable locale and UTC and accepts a padded day', () => {
    const run = vi.fn(() => ({ status: 0, stdout: 'Sun Nov  2 02:31:35 2026\n' }));

    expect(processStartToken(456, { platform: 'darwin', run, env: { PATH: '/bin', TZ: 'Pacific/Honolulu' } })).toBe(
      'darwin:Sun Nov  2 02:31:35 2026'
    );
    expect(run).toHaveBeenCalledWith(
      'ps',
      ['-p', '456', '-o', 'lstart='],
      expect.objectContaining({ env: expect.objectContaining({ LC_ALL: 'C', TZ: 'UTC' }) })
    );
  });

  it('uses invariant UTC file time on Windows and fails closed when lookup fails', () => {
    const run = vi.fn(() => ({ status: 0, stdout: '134095123456789000\r\n' }));
    expect(processStartToken(789, { platform: 'win32', run })).toBe('win32:134095123456789000');
    const command = run.mock.calls[0][1].at(-1);
    expect(command).toContain('Get-Process -Id 789');
    expect(command).toContain('ToUniversalTime');
    expect(command).toContain('ToFileTimeUtc');
    expect(command).toContain('InvariantCulture');
    expect(processStartToken(789, { platform: 'win32', run: () => ({ status: 1, stdout: '' }) })).toBeNull();
  });

  it('returns no token for unsupported platforms, invalid PIDs, and failed commands', () => {
    expect(processStartToken(0, { platform: 'linux', readFile: vi.fn() })).toBeNull();
    expect(processStartToken(123, { platform: 'freebsd' })).toBeNull();
    expect(
      processStartToken(123, {
        platform: 'darwin',
        run: () => {
          throw new Error('spawn failed');
        },
      })
    ).toBeNull();
    expect(
      processStartToken(123, { platform: 'darwin', run: () => ({ status: 0, stdout: 'not a timestamp' }) })
    ).toBeNull();
  });
});

describe('recordedProcessIsAlive', () => {
  it('proves a different process start token is not the recorded process', () => {
    expect(recordedProcessIsAlive(123, 'start-a', { exists: () => true, startToken: () => 'start-b' })).toBe(false);
    expect(recordedProcessIsAlive(123, 'start-a', { exists: () => true, startToken: () => 'start-a' })).toBe(true);
  });

  it('keeps legacy and unavailable identities fail-safe while preserving explicit absence', () => {
    const startToken = vi.fn(() => 'different-process');
    expect(recordedProcessIsAlive(123, null, { exists: () => true, startToken })).toBe(true);
    expect(startToken).not.toHaveBeenCalled();
    expect(recordedProcessIsAlive(123, 'recorded', { exists: () => true, startToken: () => null })).toBe(true);
    expect(recordedProcessIsAlive(123, 'recorded', { exists: () => null, startToken: () => 'different' })).toBeNull();
    expect(recordedProcessIsAlive(123, 'recorded', { exists: () => false })).toBe(false);
    expect(recordedProcessIsAlive(0, 'recorded', { exists: () => false })).toBeNull();
  });

  it('treats permission-limited PID existence as alive and missing PIDs as stopped', () => {
    const originalKill = process.kill;
    const kill = vi.spyOn(process, 'kill');
    try {
      kill.mockImplementation(() => {
        const error = new Error('permission denied');
        error.code = 'EPERM';
        throw error;
      });
      expect(pidExists(123)).toBe(true);
      kill.mockImplementation(() => {
        const error = new Error('no such process');
        error.code = 'ESRCH';
        throw error;
      });
      expect(pidExists(123)).toBe(false);
    } finally {
      kill.mockRestore();
      expect(process.kill).toBe(originalKill);
    }
  });
});
