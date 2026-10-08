#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GIT_REPOSITORY_CONTEXT = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
];

export function runQuiet(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...env };
    for (const key of GIT_REPOSITORY_CONTEXT) delete childEnv[key];

    // Git exports these for hooks; nested test repositories must resolve their own git dirs and indexes.
    const child = spawn(command, args, { cwd, env: childEnv, stdio: ['inherit', 'pipe', 'pipe'] });
    const chunks = [];
    let finished = false;

    const capture = (chunk) => {
      chunks.push(chunk);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      const status = code ?? (signal ? 1 : 0);
      if (error) chunks.push(Buffer.from(`${error.message}\n`));
      if (status !== 0) process.stderr.write(Buffer.concat(chunks));
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
