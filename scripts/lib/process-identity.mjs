import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';

const DARWIN_LSTART = /^[A-Za-z]{3} [A-Za-z]{3} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

export function processStartToken(
  pid,
  {
    platform = process.platform,
    readFile = readFileSync,
    readlink = readlinkSync,
    run = spawnSync,
    env = process.env,
    currentPid = process.pid,
  } = {}
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;

  if (platform === 'linux') {
    try {
      const namespaceToken = processRuntimeScopeToken({ platform, readFile, readlink, currentPid });
      if (!namespaceToken) return null;
      const bootId = readFile('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const stat = readFile(`/proc/${pid}/stat`, 'utf8');
      const open = stat.indexOf('(');
      const close = stat.lastIndexOf(')');
      if (!bootId || open <= 0 || close <= open || stat.slice(0, open).trim() !== String(pid)) {
        return null;
      }
      // After comm (field 2), starttime (field 22) is field 20 in this list.
      const fields = stat
        .slice(close + 1)
        .trim()
        .split(/\s+/);
      const startTicks = fields[19];
      return /^\d+$/.test(startTicks ?? '') ? `${namespaceToken}:${bootId}:${startTicks}` : null;
    } catch {
      return null;
    }
  }

  if (platform === 'darwin') {
    let result;
    try {
      result = run('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
        env: { ...env, LC_ALL: 'C', TZ: 'UTC' },
      });
    } catch {
      return null;
    }
    const startTime = result?.status === 0 && !result.error ? String(result.stdout ?? '').trim() : '';
    // lstart has one-second resolution. A same-second PID reuse can only yield a
    // conservative false-alive result; it cannot prove the recorded process stopped.
    return DARWIN_LSTART.test(startTime) ? `darwin:${startTime}` : null;
  }

  if (platform === 'win32') {
    const command =
      `try { $start = (Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime(); ` +
      `$start.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture) } ` +
      `catch { exit 1 }`;
    let result;
    try {
      result = run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        timeout: 5_000,
        windowsHide: true,
      });
    } catch {
      return null;
    }
    const fileTime = result?.status === 0 && !result.error ? String(result.stdout ?? '').trim() : '';
    return /^\d{1,20}$/.test(fileTime) ? `win32:${fileTime}` : null;
  }

  return null;
}

export function processRuntimeScopeToken({
  platform = process.platform,
  readFile = readFileSync,
  readlink = readlinkSync,
  currentPid = process.pid,
} = {}) {
  if (platform !== 'linux' || !Number.isSafeInteger(currentPid) || currentPid <= 0) return null;
  try {
    // `/proc/self` and the single-entry NStgid hierarchy must use the same PID
    // view as process.kill(pid, 0) and process.pid. A procfs mount from another
    // namespace can expose a numerically coincident PID, so checking only the
    // `/proc/self` symlink is insufficient.
    const selfPid = String(readlink('/proc/self'))
      .trim()
      .match(/(?:^|\/)(\d+)$/)?.[1];
    if (Number(selfPid) !== currentPid) return null;
    const status = String(readFile('/proc/self/status', 'utf8'));
    const nstgidLine = status.split(/\r?\n/).find((line) => /^NStgid:\s*/.test(line));
    const namespacePids =
      nstgidLine
        ?.replace(/^NStgid:\s*/, '')
        .trim()
        .split(/\s+/) ?? [];
    if (namespacePids.length !== 1 || Number(namespacePids[0]) !== currentPid) return null;
    const pidNamespace = String(readlink('/proc/self/ns/pid')).trim();
    const timeNamespace = String(readlink('/proc/self/ns/time')).trim();
    if (!/^pid:\[\d+\]$/.test(pidNamespace) || !/^time:\[\d+\]$/.test(timeNamespace)) return null;
    return `linux:${pidNamespace}:${timeNamespace}`;
  } catch {
    return null;
  }
}

export function pidExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return null;
  }
}

export function recordedProcessIsAlive(
  pid,
  recordedStartToken,
  { exists = pidExists, startToken = processStartToken } = {}
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;

  let present;
  try {
    present = exists(pid);
  } catch {
    return null;
  }
  if (present === false) return false;
  if (present !== true) return null;

  // Legacy records and failed identity probes remain live/unknown. Neither can
  // authorize automatic recovery because PID existence alone cannot identify it.
  if (typeof recordedStartToken !== 'string' || recordedStartToken.length === 0) return true;

  let currentStartToken;
  try {
    currentStartToken = startToken(pid);
  } catch {
    return true;
  }
  if (typeof currentStartToken !== 'string' || currentStartToken.length === 0) return true;
  return currentStartToken === recordedStartToken;
}
