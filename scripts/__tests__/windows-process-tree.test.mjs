import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { terminateWindowsProcessTree } from '../lib/windows-process-tree.mjs';

function childWithClose(code, signal = null) {
  const child = new EventEmitter();
  child.exitCode = code;
  child.signalCode = signal;
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

  it('fails closed without PID enumeration when taskkill reports a nonzero exit', async () => {
    const spawnImpl = vi.fn(() => childWithClose(128));

    await expect(terminateWindowsProcessTree(4321, { spawnImpl })).rejects.toThrow(
      /Windows process-tree termination failed \(taskkill: exited 128\)/
    );
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a synchronous taskkill spawn failure without another PID-based fallback', async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error('spawn unavailable');
    });

    await expect(terminateWindowsProcessTree(4321, { spawnImpl })).rejects.toThrow(
      /Windows process-tree termination failed \(taskkill: spawn unavailable\)/
    );
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('kills a timed-out taskkill command and reports its timeout', async () => {
    const children = [];
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = vi.fn();
      children.push(child);
      return child;
    });

    await expect(terminateWindowsProcessTree(4321, { spawnImpl, commandTimeoutMs: 100 })).rejects.toThrow(
      /Windows process-tree termination failed \(taskkill: .*timed out after 100ms\)/
    );
    expect(children).toHaveLength(1);
    for (const child of children) expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid process IDs before spawning a command', async () => {
    const spawnImpl = vi.fn();
    for (const pid of [0, -1, 1.5, '4321', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
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
