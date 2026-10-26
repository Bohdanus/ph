#!/usr/bin/env node
import {
  readQuarantineState,
  releaseQuarantine,
  removeExpiredQuarantines,
  upsertQuarantine,
  writeQuarantineState,
} from './lib/free-model-quarantine.mjs';

function parseArgs(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--') || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new Error(`Expected a value after ${key}`);
    }
    options[key.slice(2)] = rest[++index];
  }
  return { command, options };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/free-model-quarantine.mjs list',
    '  node scripts/free-model-quarantine.mjs add --source SOURCE --model ID --reason REASON [--hours N]',
    '  node scripts/free-model-quarantine.mjs release --source SOURCE --model ID',
    '  node scripts/free-model-quarantine.mjs prune',
    '',
  ].join('\n');
}

export async function main(args = process.argv.slice(2), io = process) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    io.stderr.write(`${error.message}\n${usage()}`);
    return 2;
  }
  const { command, options } = parsed;
  if (!['list', 'add', 'release', 'prune'].includes(command)) {
    io.stderr.write(usage());
    return 2;
  }

  try {
    const state = await readQuarantineState();
    if (command === 'list') {
      io.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      return 0;
    }
    if (command === 'add') {
      const hours = options.hours === undefined ? undefined : Number(options.hours);
      const key = upsertQuarantine(state, {
        source: options.source,
        model: options.model,
        reason: options.reason,
        ...(hours === undefined ? {} : { hours }),
      });
      await writeQuarantineState(state);
      io.stdout.write(`Quarantined ${key} until ${state.entries[key].expiresAt}\n`);
      return 0;
    }
    if (command === 'release') {
      if (!options.source || !options.model) throw new Error('Release requires --source and --model');
      const released = releaseQuarantine(state, options.source, options.model);
      if (released) await writeQuarantineState(state);
      io.stdout.write(released ? `Released ${options.source}:${options.model}\n` : 'No matching quarantine entry\n');
      return released ? 0 : 1;
    }
    const removed = removeExpiredQuarantines(state);
    if (removed) await writeQuarantineState(state);
    io.stdout.write(`Removed ${removed} expired quarantine entr${removed === 1 ? 'y' : 'ies'}\n`);
    return 0;
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
