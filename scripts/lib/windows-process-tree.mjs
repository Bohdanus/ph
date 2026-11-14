import { spawn } from 'node:child_process';
import { join } from 'node:path';

function runWindowsCommand(command, args, timeoutMs, spawnImpl) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      child = spawnImpl(command, args, { stdio: 'ignore', windowsHide: true });
    } catch (error) {
      finish({ error });
      return;
    }
    child.once('error', (error) => finish({ error }));
    child.once('close', (code, signal) => finish({ code, signal }));
    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill();
        } catch {}
      }
      finish({ error: new Error(`${command} timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
  });
}

export async function terminateWindowsProcessTree(
  pid,
  {
    systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows',
    spawnImpl = spawn,
    commandTimeoutMs = 7_000,
  } = {}
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new TypeError('Process ID must be a positive safe integer');
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs <= 0) {
    throw new TypeError('Command timeout must be a positive safe integer');
  }

  const taskkill = await runWindowsCommand(
    join(systemRoot, 'System32', 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
    commandTimeoutMs,
    spawnImpl
  );
  if (taskkill.code === 0) return;

  // ParentProcessId can name a reused PID; never widen a failed tree kill into PID enumeration.
  const failure = taskkill.error?.message ?? `exited ${taskkill.code ?? taskkill.signal}`;
  throw new Error(`Windows process-tree termination failed (taskkill: ${failure})`);
}
