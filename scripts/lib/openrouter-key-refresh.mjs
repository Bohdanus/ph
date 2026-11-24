#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { posix } from 'node:path';

export const WINDOWS_USER_OPENROUTER_KEY_TIMEOUT_MS = 3_000;
const WINDOWS_USER_OPENROUTER_KEY_MAX_BYTES = 8 * 1024;
const WINDOWS_USER_OPENROUTER_KEY_COMMAND = "[Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User')";

export function readWindowsUserOpenRouterKey({
  platform = process.platform,
  environment = process.env,
  spawnSyncImpl = spawnSync,
  lstatSyncImpl = lstatSync,
} = {}) {
  const isWindows = platform === 'win32';
  const interopPath = environment.WSL_INTEROP;
  let isWsl = false;
  if (
    platform === 'linux' &&
    typeof interopPath === 'string' &&
    interopPath.startsWith('/run/WSL/') &&
    posix.isAbsolute(interopPath) &&
    posix.normalize(interopPath) === interopPath
  ) {
    try {
      isWsl = lstatSyncImpl(interopPath).isSocket();
    } catch {
      isWsl = false;
    }
  }
  if (!isWindows && !isWsl) return '';

  let result;
  try {
    result = spawnSyncImpl(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_USER_OPENROUTER_KEY_COMMAND],
      {
        encoding: 'utf8',
        maxBuffer: WINDOWS_USER_OPENROUTER_KEY_MAX_BYTES,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: WINDOWS_USER_OPENROUTER_KEY_TIMEOUT_MS,
        windowsHide: true,
      }
    );
  } catch {
    return '';
  }
  if (result?.error || result?.status !== 0 || typeof result.stdout !== 'string') return '';

  const key = result.stdout.replace(/^\uFEFF/, '').trim();
  if (!key || /[\x00-\x1f\x7f\uFEFF]/.test(key)) return '';
  return key;
}
