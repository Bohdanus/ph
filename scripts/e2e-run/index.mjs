import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { reservePort, resolvePort } from './port.mjs';
import { SwarmLock } from './lock.mjs';
import { runOutputPaths, resolvePlaywrightCli } from './output.mjs';
import { signalProcessTree } from './process-tree.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const PREFIX = '[e2e-run]';

const RUN_RECORD = path.join(REPO_ROOT, '.kilo', 'e2e-last-run.json');

function hasOutputFlag(args) {
  return args.some((arg) => arg === '--output' || arg.startsWith('--output='));
}

function isHelpRequest(args) {
  const positional = args.slice(0, args.indexOf('--') === -1 ? undefined : args.indexOf('--'));
  return ['--help', '-h', '--version', '-v'].some((flag) => positional.includes(flag));
}

export function assertOwnServer(env) {
  if (env.PLAYWRIGHT_REUSE_EXISTING_SERVER) {
    throw new Error(
      `PLAYWRIGHT_REUSE_EXISTING_SERVER=${JSON.stringify(env.PLAYWRIGHT_REUSE_EXISTING_SERVER)} is no longer ` +
        'supported. playwright.config.ts now sets reuseExistingServer: false with no way to turn it on, because a ' +
        'run that attaches to a server it did not start tests the wrong checkout and reports green. Unset the ' +
        'variable; this run will start its own server on a port of its own.'
    );
  }
  if (env.PLAYWRIGHT_BASE_URL && env.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(
      `PLAYWRIGHT_BASE_URL=${env.PLAYWRIGHT_BASE_URL} points the tests at a server this run did not start, which ` +
        'is the one thing that must never happen here. If you mean to test a deployed build, say so explicitly ' +
        'with E2E_ALLOW_REMOTE=1 — the run logs that it did, so a report can never claim the branch was verified ' +
        'against its own checkout when it was not.'
    );
  }
  return env.PLAYWRIGHT_BASE_URL ? 'E2E_ALLOW_REMOTE=1: this run tests a REMOTE build, not this checkout' : null;
}

export function runPlaywright(args, options = {}) {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? REPO_ROOT;
  const cli = options.cli ?? resolvePlaywrightCli();
  const quiet = options.quiet ?? false;

  return new Promise((resolve, reject) => {
    const stdio = quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit';
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env,
      stdio,
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    let signalled = 0;
    const forward = (signal, name) => () => {
      signalled += 1;
      if (signalled === 1) {
        if (!signalProcessTree(child, signal)) {
          console.error(`${PREFIX} could not signal the full Playwright process tree; a descendant may survive.`);
        }
        return;
      }
      console.error(`${PREFIX} ${name} again: the suite is not stopping, so this wrapper is giving up on it.`);
      if (!signalProcessTree(child, 'SIGKILL')) {
        console.error(`${PREFIX} could not force-stop the full Playwright process tree.`);
      }
      cleanup();
      process.exit(128 + (constants.signals[signal] ?? 0));
    };
    const onSigint = forward('SIGINT', 'interrupted');
    const onSigterm = forward('SIGTERM', 'terminated');
    const cleanup = () => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    const captured = quiet ? [] : null;
    if (quiet) {
      child.stdout.on('data', (chunk) => captured.push(chunk));
      child.stderr.on('data', (chunk) => captured.push(chunk));
    }

    child.on('error', (error) => {
      cleanup();
      if (quiet && captured.length > 0) process.stderr.write(Buffer.concat(captured));
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      const exitCode = signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1);
      if (quiet && exitCode !== 0) {
        const output = Buffer.concat(captured);
        if (output.length > 0) process.stderr.write(output);
      }
      resolve(exitCode);
    });
  });
}

function writeRunRecord(record, target = RUN_RECORD) {
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    console.error(`${PREFIX} could not record the run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function run(argv, options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => console.log(line));
  const ci = Boolean(env.CI);
  const spawnSuite = options.runPlaywright ?? runPlaywright;
  const allocateRunPort = options.reservePort ?? reservePort;
  const runRecordPath = options.runRecordPath ?? RUN_RECORD;

  const separatorIndex = argv.indexOf('--');
  const wrapperArgs = argv.slice(0, separatorIndex === -1 ? argv.length : separatorIndex);
  const forwardedArgs = wrapperArgs.filter((arg) => !['--no-lock', '--quiet', '--verbose'].includes(arg));
  if (separatorIndex !== -1) forwardedArgs.push(...argv.slice(separatorIndex));
  const quiet = wrapperArgs.includes('--quiet') || (!wrapperArgs.includes('--verbose') && env.E2E_QUIET !== '0');
  const playwrightArgv = ['test', ...forwardedArgs];

  if (isHelpRequest(playwrightArgv)) {
    assertOwnServer(env);
    return spawnSuite(playwrightArgv, { ...options, env, quiet: false });
  }

  const remote = assertOwnServer(env);
  if (remote) log(`${PREFIX} WARNING: ${remote}`);

  if (quiet) log(`${PREFIX} quiet: suite output is captured and only shown on failure`);

  const childEnv = { ...env };

  if (!ci) {
    const { port, reason } = resolvePort(env, ci);
    if (port === 'allocate') {
      const reserved = await allocateRunPort();
      childEnv.PLAYWRIGHT_PORT = String(reserved.port);
      const retryCount = reserved.attempt - 1;
      const retrySummary = retryCount > 0 ? `, ${retryCount} retr${retryCount === 1 ? 'y' : 'ies'}` : '';
      log(`${PREFIX} port ${reserved.port} (${reason}${retrySummary})`);
    } else {
      log(`${PREFIX} port: unchanged, ${reason}`);
    }

    childEnv.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE = path.join(REPO_ROOT, 'test-results', '.last-run.json');
  }

  const skipReason = ci
    ? 'CI'
    : env.E2E_SKIP_LOCK === '1'
      ? 'E2E_SKIP_LOCK=1'
      : wrapperArgs.includes('--no-lock')
        ? '--no-lock'
        : null;
  const lock = skipReason ? null : (options.lock ?? new SwarmLock({ ...options, env, log }));
  let queued = false;

  if (skipReason === 'CI') {
    log(`${PREFIX} CI: one checkout, one runner, so the e2e queue is not used.`);
  } else if (skipReason) {
    log(`${PREFIX} ${skipReason}: not queueing. Only scheduling is lost; this run still has a port of its own.`);
  } else {
    const attempt = await lock.acquire();
    queued = attempt.acquired;
    if (queued) log(`${PREFIX} running with the e2e queue held.`);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const paths = runOutputPaths(REPO_ROOT, runId);
  let runRecord = null;

  if (!ci) {
    if (!hasOutputFlag(playwrightArgv)) {
      playwrightArgv.push('--output', paths.outputDir);
      log(`${PREFIX} output: ${path.relative(REPO_ROOT, paths.outputDir)}`);
    } else {
      log(`${PREFIX} output: as given on the command line`);
    }

    runRecord = {
      runId,
      pid: process.pid,
      port: childEnv.PLAYWRIGHT_PORT ?? null,
      baseUrl:
        env.PLAYWRIGHT_BASE_URL ?? (childEnv.PLAYWRIGHT_PORT ? `http://localhost:${childEnv.PLAYWRIGHT_PORT}` : null),
      remote: Boolean(remote),
      outputDir: paths.outputDir,
      queued,
      startedAt: new Date().toISOString(),
    };
    writeRunRecord(runRecord, runRecordPath);
    log(
      `${PREFIX} port recorded in ${
        runRecordPath === RUN_RECORD ? path.relative(REPO_ROOT, runRecordPath) : runRecordPath
      }`
    );
  }

  try {
    if (queued) lock.startRenewal((why) => log(`${PREFIX} ${why}`));
    const code = await spawnSuite(playwrightArgv, { ...options, env: childEnv, quiet });
    if (!ci) writeRunRecord({ ...runRecord, exitCode: code, finishedAt: new Date().toISOString() }, runRecordPath);
    return code;
  } finally {
    lock?.release();
  }
}

const HELP = [
  `${PREFIX} node scripts/e2e-run.mjs [playwright args...]`,
  '',
  '  Every argument is forwarded to Playwright verbatim, after the `test` subcommand:',
  '    npm run test:e2e -- e2e/sidebar-flyout.spec.ts',
  '    npm run test:e2e -- --retries=1 e2e/undo-redo.spec.ts',
  '',
  '  THE GUARANTEE: this run starts its own dev server, on a port it picks, and records',
  '  that port. Server reuse is impossible - playwright.config.ts sets',
  '  reuseExistingServer: false with no way to turn it on, and the server is started with',
  '  --strictPort, so a busy port is a startup failure rather than a silent attach to',
  '  another checkout. PLAYWRIGHT_BASE_URL and PLAYWRIGHT_REUSE_EXISTING_SERVER are refused.',
  '',
  '  THE QUEUE: the run also takes the swarm lock e2e/.swarm-e2e-runner so two agents',
  '  rarely run e2e at once. It is advisory - a run never refuses to start because of it,',
  '  and a board that cannot be reached just means no queue. Two runs at once is fine.',
  '',
  '  Quiet output is the default. --verbose (or E2E_QUIET=0) streams suite output;',
  '  --quiet (or E2E_QUIET=1) explicitly captures it, replaying only on failure.',
  '  This keeps a green run from flooding the terminal with minutes of list-reporter',
  '  lines - the same batching strategy the commit and push gates use.',
  '',
  '  Environment: E2E_LOCK_TIMEOUT, E2E_LOCK_POLL, E2E_LOCK_LEASE, E2E_SKIP_LOCK=1,',
  '  E2E_QUIET=0|1, E2E_ALLOW_REMOTE=1. Implementation modules live under scripts/e2e-run/.',
].join('\n');

export async function main(argv) {
  try {
    return await run(argv);
  } catch (error) {
    console.error(`${PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

function invokedAsThisFile() {
  if (!process.argv[1]) return false;
  const resolve = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolve(process.argv[1]) === resolve(path.join(import.meta.dirname, '..', 'e2e-run.mjs'));
}

if (invokedAsThisFile()) {
  const argv = process.argv.slice(2);
  if (argv.includes('--e2e-run-help')) {
    console.log(HELP);
    process.exitCode = 0;
  } else {
    process.exitCode = await main(argv);
  }
}
