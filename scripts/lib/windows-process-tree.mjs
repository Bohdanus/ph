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
      try {
        child.kill();
      } catch {}
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

  const fallbackDeadlineMs = Math.floor(commandTimeoutMs * 0.85);
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$rootPid = ${pid}`,
    '$knownIds = @($rootPid)',
    `$deadline = [DateTime]::UtcNow.AddMilliseconds(${fallbackDeadlineMs})`,
    'do {',
    '  $processes = @(Get-CimInstance Win32_Process)',
    '  do {',
    '    $previousCount = $knownIds.Count',
    '    foreach ($process in $processes) {',
    '      if (($knownIds -contains [int]$process.ParentProcessId) -and ($knownIds -notcontains [int]$process.ProcessId)) { $knownIds += [int]$process.ProcessId }',
    '    }',
    '  } while ($knownIds.Count -gt $previousCount)',
    '  for ($index = $knownIds.Count - 1; $index -ge 0; $index--) { Stop-Process -Id $knownIds[$index] -Force -ErrorAction SilentlyContinue }',
    '  Start-Sleep -Milliseconds 100',
    '  $current = @(Get-CimInstance Win32_Process)',
    '  $remaining = @($current | Where-Object { $knownIds -contains [int]$_.ProcessId -or $knownIds -contains [int]$_.ParentProcessId })',
    '} while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)',
    'if ($remaining.Count -gt 0) { exit 1 }',
  ].join('\n');
  const powerShell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const fallback = await runWindowsCommand(
    powerShell,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    commandTimeoutMs,
    spawnImpl
  );
  if (fallback.code === 0) return;

  const describeFailure = (name, result) =>
    `${name}: ${result.error?.message ?? `exited ${result.code ?? result.signal}`}`;
  throw new Error(
    `Windows process-tree termination failed (${describeFailure('taskkill', taskkill)}; ${describeFailure('PowerShell fallback', fallback)})`
  );
}
