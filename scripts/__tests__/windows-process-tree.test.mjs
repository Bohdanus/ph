import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { terminateWindowsProcessTree } from '../lib/windows-process-tree.mjs';

function childWithClose(code, signal = null) {
  const child = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => child.emit('close', code, signal));
  return child;
}

describe('Windows process-tree termination', () => {
  it('uses taskkill to terminate the requested process and its descendants', async () => {
    const systemRoot = 'system-root';
    const spawnImpl = vi.fn(() => childWithClose(0));

    await expect(terminateWindowsProcessTree(4321, { systemRoot, spawnImpl })).resolves.toBeUndefined();

    expect(spawnImpl).toHaveBeenCalledWith(join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', '4321', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to PowerShell with a proportional deadline when taskkill fails', async () => {
    const systemRoot = 'system-root';
    const spawnImpl = vi
      .fn()
      .mockImplementationOnce(() => childWithClose(1))
      .mockImplementationOnce(() => childWithClose(0));

    await expect(
      terminateWindowsProcessTree(4321, { systemRoot, spawnImpl, commandTimeoutMs: 2_000 })
    ).resolves.toBeUndefined();

    const [command, args, options] = spawnImpl.mock.calls[1];
    expect(command).toBe(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
    expect(args[3]).toContain('$rootPid = 4321');
    expect(args[3]).toContain('[DateTime]::UtcNow.AddMilliseconds(1700)');
    expect(args[3]).toContain('Get-CimInstance Win32_Process');
    expect(args[3]).toContain('Stop-Process -Id');
    expect(options).toEqual({ stdio: 'ignore', windowsHide: true });
  });

  it('reports both command failures when the fallback cannot terminate the tree', async () => {
    const spawnImpl = vi
      .fn()
      .mockImplementationOnce(() => childWithClose(1))
      .mockImplementationOnce(() => childWithClose(2));

    await expect(terminateWindowsProcessTree(4321, { spawnImpl })).rejects.toThrow(
      /taskkill: exited 1; PowerShell fallback: exited 2/
    );
  });

  it('checks for surviving descendants when taskkill cannot find the root PID', async () => {
    const spawnImpl = vi
      .fn()
      .mockImplementationOnce(() => childWithClose(128))
      .mockImplementationOnce(() => childWithClose(0));

    await expect(terminateWindowsProcessTree(4321, { spawnImpl })).resolves.toBeUndefined();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });

  it('kills timed-out termination commands and reports both timeouts', async () => {
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter();
      child.kill = vi.fn();
      children.push(child);
      return child;
    });

    await expect(terminateWindowsProcessTree(4321, { spawnImpl, commandTimeoutMs: 5 })).rejects.toThrow(
      /taskkill: .*timed out after 5ms; PowerShell fallback: .*timed out after 5ms/
    );
    expect(children).toHaveLength(2);
    for (const child of children) expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid process IDs before spawning a command', async () => {
    const spawnImpl = vi.fn();
    for (const pid of [0, -1, 1.5, '4321']) {
      await expect(terminateWindowsProcessTree(pid, { spawnImpl })).rejects.toThrow(
        'Process ID must be a positive safe integer'
      );
    }
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid command timeouts before spawning a command', async () => {
    const spawnImpl = vi.fn();
    for (const commandTimeoutMs of [0, -1, 1.5, '7000']) {
      await expect(terminateWindowsProcessTree(4321, { spawnImpl, commandTimeoutMs })).rejects.toThrow(
        'Command timeout must be a positive safe integer'
      );
    }
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
