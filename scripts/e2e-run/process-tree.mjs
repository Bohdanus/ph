import { spawnSync } from 'node:child_process';

/** Signal the Playwright process tree, not only the runner that owns the Vite server. */
export function signalProcessTree(child, signal) {
  if (!child.pid) {
    child.kill(signal);
    return false;
  }

  if (process.platform === 'win32') {
    if (child.exitCode != null || child.signalCode != null) return false;
    try {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 10_000,
        windowsHide: true,
      });
      if (!result.error && result.status === 0) return true;
    } catch {
      // Fall back to stopping the direct child if the tree command is unavailable.
    }
    child.kill(signal);
    return false;
  }

  try {
    process.kill(-child.pid, signal);
    return true;
  } catch {
    if (child.exitCode != null || child.signalCode != null) return false;
    child.kill(signal);
    return false;
  }
}
