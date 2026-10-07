#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function runQuiet(command, args, { cwd = process.cwd(), env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    let finished = false;

    const capture = (chunk) => {
      output += chunk;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const finish = (code, signal, error) => {
      if (finished) return;
      finished = true;
      const status = code ?? (signal ? 1 : 0);
      if (error) output += `${error.message}\n`;
      if (status !== 0) process.stderr.write(output);
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
