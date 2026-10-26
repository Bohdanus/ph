#!/usr/bin/env node
import {
  DEFAULT_QUARANTINE_FILE,
  loadQuarantineState,
  MAX_QUARANTINE_HOURS,
  QUARANTINE_REASONS,
  QUARANTINE_SOURCES,
  releaseQuarantine,
  removeExpiredQuarantines,
  upsertQuarantine,
  withQuarantineWriteLock,
} from './lib/free-model-quarantine.mjs';

class UsageError extends Error {}

function parseArgs(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') return { help: true };
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--') || !rest[index + 1] || rest[index + 1].startsWith('--')) {
      throw new UsageError(`Expected a value after ${key}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) throw new UsageError(`Duplicate option: ${key}`);
    options[name] = rest[++index];
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

export async function main(args = process.argv.slice(2), io = process, deps = {}) {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    io.stderr.write(`${error.message}\n${usage()}`);
    return error instanceof UsageError ? 2 : 1;
  }
  if (parsed.help) {
    io.stdout.write(usage());
    return 0;
  }
  const { command, options } = parsed;
  if (!['list', 'add', 'release', 'prune'].includes(command)) {
    io.stderr.write(`Unknown command: ${command}\n${usage()}`);
    return 2;
  }

  const allowedOptions = {
    list: [],
    add: ['source', 'model', 'reason', 'hours'],
    release: ['source', 'model'],
    prune: [],
  }[command];
  const unknownOption = Object.keys(options).find((option) => !allowedOptions.includes(option));
  if (unknownOption) {
    io.stderr.write(`Unknown option: --${unknownOption}\n${usage()}`);
    return 2;
  }
  if (command === 'add') {
    const hours = options.hours === undefined ? 6 : Number(options.hours);
    if (
      !options.source ||
      !QUARANTINE_SOURCES.has(options.source) ||
      !options.model ||
      !QUARANTINE_REASONS.has(options.reason) ||
      !Number.isFinite(hours) ||
      hours <= 0 ||
      hours > MAX_QUARANTINE_HOURS
    ) {
      io.stderr.write(
        `Add requires a supported source, model, reason, and hours greater than zero and no more than ${MAX_QUARANTINE_HOURS}\n${usage()}`
      );
      return 2;
    }
  }
  if (command === 'release' && (!options.source || !QUARANTINE_SOURCES.has(options.source) || !options.model)) {
    io.stderr.write(`Release requires a supported source and model\n${usage()}`);
    return 2;
  }

  try {
    const filePath = deps.quarantineFile ?? DEFAULT_QUARANTINE_FILE;
    if (command === 'list') {
      const state = await loadQuarantineState(filePath);
      io.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
      return 0;
    }
    const outcome = await withQuarantineWriteLock(filePath, async (saveState) => {
      const state = await loadQuarantineState(filePath);
      if (command === 'add') {
        const hours = options.hours === undefined ? undefined : Number(options.hours);
        const key = upsertQuarantine(state, {
          source: options.source,
          model: options.model,
          reason: options.reason,
          ...(hours === undefined ? {} : { hours }),
        });
        await saveState(state);
        return { code: 0, message: `Quarantined ${key} until ${state.entries[key].expiresAt}\n` };
      }
      if (command === 'release') {
        const released = releaseQuarantine(state, options.source, options.model);
        if (released) await saveState(state);
        return {
          code: released ? 0 : 1,
          message: released ? `Released ${options.source}:${options.model}\n` : 'No matching quarantine entry\n',
        };
      }
      const removed = removeExpiredQuarantines(state);
      if (removed) await saveState(state);
      return { code: 0, message: `Removed ${removed} expired quarantine entr${removed === 1 ? 'y' : 'ies'}\n` };
    });
    io.stdout.write(outcome.message);
    return outcome.code;
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
