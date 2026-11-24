import { describe, expect, it, vi } from 'vitest';
import {
  readWindowsUserOpenRouterKey,
  WINDOWS_USER_OPENROUTER_KEY_TIMEOUT_MS,
} from '../lib/openrouter-key-refresh.mjs';

describe('readWindowsUserOpenRouterKey', () => {
  it('reads a Windows user-scope key from WSL interop with bounded hidden PowerShell', () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0, stdout: 'rotated-key\r\n' });

    expect(
      readWindowsUserOpenRouterKey({
        platform: 'linux',
        environment: { WSL_INTEROP: '/run/WSL/100_interop' },
        spawnSyncImpl,
        lstatSyncImpl: vi.fn(() => ({ isSocket: () => true })),
      })
    ).toBe('rotated-key');
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')",
      ],
      expect.objectContaining({
        encoding: 'utf8',
        maxBuffer: 8192,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: WINDOWS_USER_OPENROUTER_KEY_TIMEOUT_MS,
        windowsHide: true,
      })
    );
  });

  it('uses the same user-scope lookup on native Windows', () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0, stdout: 'windows-key\r\n' });
    expect(readWindowsUserOpenRouterKey({ platform: 'win32', environment: {}, spawnSyncImpl })).toBe('windows-key');
    expect(spawnSyncImpl).toHaveBeenCalledOnce();
  });

  it.each([{ WSL_INTEROP: '/tmp/fake_interop' }, { WSL_INTEROP: '/run/WSL/../tmp/fake_interop' }])(
    'does not invoke interop for an untrusted Linux path %#',
    (environment) => {
      const spawnSyncImpl = vi.fn();
      expect(readWindowsUserOpenRouterKey({ platform: 'linux', environment, spawnSyncImpl })).toBe('');
      expect(spawnSyncImpl).not.toHaveBeenCalled();
    }
  );

  it('requires the WSL interop path to be a socket', () => {
    const spawnSyncImpl = vi.fn();
    expect(
      readWindowsUserOpenRouterKey({
        platform: 'linux',
        environment: { WSL_INTEROP: '/run/WSL/100_interop' },
        spawnSyncImpl,
        lstatSyncImpl: vi.fn(() => ({ isSocket: () => false })),
      })
    ).toBe('');
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  it('rejects an interop path that is a symlink, even if its target is a socket', () => {
    const spawnSyncImpl = vi.fn();
    expect(
      readWindowsUserOpenRouterKey({
        platform: 'linux',
        environment: { WSL_INTEROP: '/run/WSL/100_interop' },
        spawnSyncImpl,
        lstatSyncImpl: vi.fn(() => ({ isSocket: () => false, isSymbolicLink: () => true })),
      })
    ).toBe('');
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  it('fails closed when WSL interop cannot be inspected', () => {
    const spawnSyncImpl = vi.fn();
    expect(
      readWindowsUserOpenRouterKey({
        platform: 'linux',
        environment: { WSL_INTEROP: '/run/WSL/100_interop' },
        spawnSyncImpl,
        lstatSyncImpl: vi.fn(() => {
          throw new Error('no interop socket');
        }),
      })
    ).toBe('');
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  it('does not invoke interop on ordinary Linux', () => {
    const spawnSyncImpl = vi.fn();
    expect(readWindowsUserOpenRouterKey({ platform: 'linux', environment: {}, spawnSyncImpl })).toBe('');
    expect(spawnSyncImpl).not.toHaveBeenCalled();
  });

  it.each([
    { status: 1, stdout: 'key' },
    { status: 0, stdout: '' },
    { status: 0, stdout: 'two\nlines' },
    { status: 0, stdout: 'prefix\uFEFFsuffix' },
    { status: 0, stdout: 'key', error: new Error('interop unavailable') },
  ])('fails closed for an unavailable or malformed lookup', (result) => {
    expect(
      readWindowsUserOpenRouterKey({
        platform: 'win32',
        environment: {},
        spawnSyncImpl: vi.fn().mockReturnValue(result),
      })
    ).toBe('');
  });

  it('fails closed when process creation throws', () => {
    expect(
      readWindowsUserOpenRouterKey({
        platform: 'win32',
        environment: {},
        spawnSyncImpl: vi.fn(() => {
          throw new Error('interop unavailable');
        }),
      })
    ).toBe('');
  });
});
