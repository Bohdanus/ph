#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCommandShim } from './lib/windows-command-shim.mjs';

const GIT_REPOSITORY_CONTEXT = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
];
const MAX_CAPTURE_BYTES = 1024 * 1024;
const CAPTURE_TRUNCATED = Buffer.from(`\n[quiet-command: output truncated after ${MAX_CAPTURE_BYTES} bytes]\n`);

export function runQuiet(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...env };
    for (const key of GIT_REPOSITORY_CONTEXT) delete childEnv[key];

    // Git exports these for hooks; nested test repositories must resolve their own git dirs and indexes.
    let invocation;
    try {
      invocation = resolveCommandShim(command, args, { env: childEnv, cwd });
    } catch (error) {
      process.stderr.write(`quiet-command: ${error.message}\n`);
      resolve(2);
      return;
    }
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: childEnv,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: false,
      ...invocation.spawnOptions,
    });
    const output = Buffer.allocUnsafe(MAX_CAPTURE_BYTES);
    let outputBytes = 0;
    let outputTruncated = false;
    let finished = false;

    const capture = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const count = Math.min(bytes.length, MAX_CAPTURE_BYTES - outputBytes);
      if (count > 0) bytes.copy(output, outputBytes, 0, count);
      outputBytes += count;
      if (count < bytes.length) outputTruncated = true;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      const status = code ?? (signal ? 1 : 0);
      if (error) capture(Buffer.from(`${error.message}\n`));
      if (status !== 0) {
        process.stderr.write(output.subarray(0, outputBytes));
        if (outputTruncated) process.stderr.write(CAPTURE_TRUNCATED);
      }
      resolve(status);
    };

    child.once('error', (error) => finish(1, 1, error));
    child.once('close', (code, signal) => finish(code ?? (signal ? 1 : 0), signal));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    process.stderr.write('quiet-command: expected a command\n');
    process.exitCode = 2;
  } else {
    const status = await runQuiet(command, args);
    process.exitCode = status > 255 ? 1 : status;
  }
}
