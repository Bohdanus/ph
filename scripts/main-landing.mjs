#!/usr/bin/env node
/**
 * Own and report the shared main landing operation.
 *
 * A prepared merge occupies main before commit. This wrapper holds a durable owner
 * record across both the merge and reviewed commit, heartbeats while child commands
 * run, and starts a detached watcher so a dead wrapper still produces 15-minute and
 * 4-hour board reports. Age alone never grants takeover or edits Git state.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { readMergeHeadRefs, resolveWorktree } from './main-worktree-guard.mjs';
import { readOperations } from './lib/git-operation-state.mjs';
import { isProjectMainWorktree } from './merge-takeover-guard.mjs';

const OWNER_FILE = 'owner.json';
const LOCK_DIR = 'main-landing-occupancy';
const HEARTBEAT_MS = 30_000;
const WATCH_POLL_MS = 30_000;
const ALERTS = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 240, label: '4 hours' },
];
const HEX_OBJECT_ID = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

const USAGE = [
  'Usage:',
  '  node scripts/main-landing.mjs land --main-sha SHA --incoming-sha SHA --tree-sha SHA --branch BRANCH --chat ID',
  '  node scripts/main-landing.mjs status [--json]',
  '  node scripts/main-landing.mjs takeover --token ID --branch BRANCH --chat ID --model gpt-6-luna --reasoning xhigh --confirm-owner-stopped --confirm-chat-dead [--confirm-owner-pid-reused] [--confirm-child-pid-reused]',
  '  node scripts/main-landing.mjs release-stale --token ID --confirm-owner-stopped',
  '  node scripts/main-landing.mjs release-incomplete --confirm-holder-stopped --confirm-no-other-recovery',
  '  node scripts/main-landing.mjs clear-control-lock --confirm-control-process-stopped --confirm-no-other-recovery',
  '  node scripts/main-landing.mjs heartbeat --token ID --step TEXT',
  '  node scripts/main-landing.mjs release --token ID',
  'The landing wrapper never takes over an existing lease based on age alone.',
].join('\n');

function gitResult(args, cwd = process.cwd(), env = process.env) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error('git ' + args.join(' ') + ': ' + result.error.message);
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function gitText(args, cwd = process.cwd(), env = process.env) {
  const result = gitResult(args, cwd, env);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git command failed').trim());
  }
  return result.stdout.trim();
}

function gitConfigValue(key, cwd) {
  const result = gitResult(['config', '--local', '--get', key], cwd);
  if (result.status === 0) return result.stdout.trim();
  if (result.status === 1) return null;
  throw new Error((result.stderr || result.stdout || 'could not read Git config').trim());
}

function resolvePath(value, base) {
  if (!value) return null;
  return resolve(isAbsolute(value) ? value : join(base, value));
}

function samePath(left, right) {
  if (!left || !right) return false;
  const first = resolve(left).replace(/\\/g, '/');
  const second = resolve(right).replace(/\\/g, '/');
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function resolvePaths(cwd = process.cwd()) {
  const registeredGitDir = gitConfigValue('ph.mainWorktreeGitDir', cwd);
  const registeredPath = gitConfigValue('ph.mainWorktreePath', cwd);
  if (!registeredGitDir || !registeredPath) {
    throw new Error('the designated main worktree is not registered; run the repository hook installer from main');
  }
  const windowsPath = /^[a-z]:[\\/]/i.test(registeredPath) || /^\\\\/.test(registeredPath);
  const posixPath = /^\/(?!\/)/.test(registeredPath);
  if ((windowsPath && process.platform !== 'win32') || (posixPath && process.platform === 'win32')) {
    throw new Error(
      'the Node runtime does not match the registered main path; use the Git and Node runtime that owns this checkout'
    );
  }
  if (!isAbsolute(registeredGitDir) || !isAbsolute(registeredPath)) {
    throw new Error('registered main worktree paths must be absolute; reinstall hooks from the matching main checkout');
  }
  const current = resolveWorktree(cwd);
  if (!current?.commonDir) throw new Error('cannot identify this checkout common Git directory');
  const commonRaw = gitText(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  const commonDir = resolvePath(commonRaw, cwd);
  const mainGitDir = resolvePath(registeredGitDir, cwd);
  const mainPath = resolvePath(registeredPath, cwd);
  return {
    cwd,
    commonDir,
    mainGitDir,
    mainPath,
    lockDir: join(commonDir, LOCK_DIR),
    archiveDir: join(commonDir, 'main-landing-archive'),
  };
}

function ownerPath(paths) {
  return join(paths.lockDir, OWNER_FILE);
}

function readOwner(paths) {
  const file = ownerPath(paths);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('the main landing owner record is unreadable: ' + (error?.message ?? String(error)));
  }
}

function readControlLock(paths) {
  const file = join(paths.lockDir, 'owner-control.lock');
  if (!existsSync(file)) return null;
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8'));
    return { ...lock, processState: processState(lock) };
  } catch {
    return { unreadable: true };
  }
}

function writeAtomic(file, value) {
  const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
}

function writeOwner(paths, owner) {
  if (!existsSync(paths.lockDir)) throw new Error('main landing lease directory disappeared');
  writeAtomic(ownerPath(paths), owner);
}

function ageMs(owner, now = Date.now()) {
  const started = Date.parse(owner.occupiedSince ?? owner.startedAt ?? '');
  return Number.isFinite(started) ? Math.max(0, now - started) : Number.NaN;
}

function formatAge(milliseconds) {
  if (!Number.isFinite(milliseconds)) return 'unknown age';
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? hours + 'h ' + minutes + 'm' : totalMinutes + 'm';
}

function safeText(value, max = 160) {
  return String(value ?? 'unknown')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

function alertText(value, max = 120) {
  return safeText(value, max).replace(/[^\x20-\x7e]/g, '?');
}

function sameRuntime(owner) {
  return String(owner?.host ?? '').toLowerCase() === hostname().toLowerCase() && owner?.platform === process.platform;
}

function pidExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return null;
  }
}

function recordedPidStates(owner) {
  if (!sameRuntime(owner)) return { owner: null, child: null };
  return {
    owner: Number.isInteger(owner?.pid) && owner.pid > 0 ? pidExists(owner.pid) : null,
    child: Number.isInteger(owner?.childPid) && owner.childPid > 0 ? pidExists(owner.childPid) : null,
  };
}

function processState(owner) {
  const pids = recordedPidStates(owner);
  if (!sameRuntime(owner)) return 'unknown: different host or runtime';
  const states = [pids.owner, pids.child].filter((state) => state !== null);
  if (states.length === 0) return 'unknown: chat owner has no local process id';
  if (states.includes(true)) return 'alive';
  if (states.every((state) => state === false)) return 'recorded PIDs are not running; check descendants';
  return 'unknown';
}

function mainGitState(paths) {
  const status = gitResult(['-C', paths.mainPath, 'status', '--porcelain=v1', '--untracked-files=all']);
  if (status.status !== 0) throw new Error((status.stderr || status.stdout || 'main status failed').trim());
  const unmerged = gitResult(['-C', paths.mainPath, 'diff', '--name-only', '--diff-filter=U', '-z']);
  if (unmerged.status !== 0)
    throw new Error((unmerged.stderr || unmerged.stdout || 'unmerged-path check failed').trim());
  return {
    branch: gitText(['-C', paths.mainPath, 'symbolic-ref', '--short', 'HEAD']),
    operations: readOperations(paths.mainGitDir),
    dirty: status.stdout.trim().length > 0,
    unmerged: unmerged.stdout.split('\0').filter(Boolean),
  };
}

function alertMarker(paths, minutes) {
  return join(paths.lockDir, 'alert-' + minutes + 'm.json');
}

function readAlert(paths, minutes) {
  const file = alertMarker(paths, minutes);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { status: 'unreadable' };
  }
}

function claimAlert(paths, owner, minutes) {
  const file = alertMarker(paths, minutes);
  const existing = readAlert(paths, minutes);
  if (existing?.status === 'sent') return false;
  if (existing?.status === 'pending') {
    const reporter = {
      host: existing.host,
      platform: existing.platform,
      pid: existing.pid,
    };
    if (sameRuntime(reporter)) {
      if (pidExists(reporter.pid) !== false) return false;
    } else {
      const pendingSince = Date.parse(existing.startedAt ?? '');
      if (!Number.isFinite(pendingSince) || Date.now() - pendingSince < 60_000) return false;
    }
    try {
      rmSync(file, { force: true });
    } catch {
      return false;
    }
  }
  try {
    writeFileSync(
      file,
      JSON.stringify({
        status: 'pending',
        leaseId: owner.leaseId,
        host: hostname(),
        platform: process.platform,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
      { flag: 'wx', mode: 0o600 }
    );
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function boardNote(paths, message) {
  const boardScript = join(dirname(paths.commonDir), 'scripts', 'agent-board.mjs');
  const result = spawnSync(process.execPath, [boardScript, 'note', message], {
    cwd: dirname(paths.commonDir),
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0;
}

function alertMessage(owner, minutes) {
  const state = processState(owner);
  const line =
    'Main landing occupied for at least ' +
    (minutes === 15 ? '15 minutes' : '4 hours') +
    ': branch=' +
    alertText(owner.owner?.branch) +
    ', chat=' +
    alertText(owner.owner?.chatId) +
    ', script=' +
    alertText(owner.owner?.script) +
    ', scriptPath=' +
    alertText(owner.owner?.scriptPath) +
    ', pid=' +
    alertText(owner.owner?.pid) +
    ', childPid=' +
    alertText(owner.owner?.childPid) +
    ', step=' +
    alertText(owner.step) +
    ', process=' +
    alertText(state) +
    ', lease=' +
    alertText(owner.leaseId);
  if (minutes === 15) {
    return (
      line +
      '. Other agents should report the blocker in their chat and continue unrelated work; do not wait or take over.'
    ).replace(/--/g, '- -');
  }
  return (
    line +
    '. Check structured host session liveness without opening transcripts. If the owning chat is dead and the owner/child process tree is confirmed stopped, launch the required Luna xhigh recovery agent. Preserve the worktree state before changing it; age alone grants no takeover.'
  ).replace(/--/g, '- -');
}

function notifyIfDue(paths, owner, now = Date.now()) {
  const elapsed = ageMs(owner, now);
  if (!Number.isFinite(elapsed)) return;
  for (const alert of ALERTS) {
    if (elapsed < alert.minutes * 60_000 || !claimAlert(paths, owner, alert.minutes)) continue;
    const message = alertMessage(owner, alert.minutes);
    if (boardNote(paths, message)) {
      writeAtomic(alertMarker(paths, alert.minutes), {
        status: 'sent',
        leaseId: owner.leaseId,
        sentAt: new Date().toISOString(),
        message,
      });
    } else {
      appendFileSync(join(paths.lockDir, 'alert-failures.log'), new Date().toISOString() + ' ' + message + '\n');
      rmSync(alertMarker(paths, alert.minutes), { force: true });
    }
  }
}

function cleanMain(paths) {
  const state = mainGitState(paths);
  return state.branch === 'main' && state.operations.length === 0 && !state.dirty && state.unmerged.length === 0;
}

function releaseLock(paths, leaseId) {
  const controlLock = acquireRecoveryControl(paths, { leaseId });
  try {
    const current = readOwner(paths);
    if (!current || current.leaseId !== leaseId)
      throw new Error('main landing lease token changed; refusing to release it');
    if (!cleanMain(paths))
      throw new Error('main still has Git operation markers or dirty files; preserving the owner record');
    rmSync(paths.lockDir, { recursive: true, force: false });
  } finally {
    if (existsSync(paths.lockDir)) rmSync(controlLock, { force: true });
  }
}

function acquireRecoveryControl(paths, owner) {
  const lock = join(paths.lockDir, 'owner-control.lock');
  const record = {
    leaseId: owner.leaseId,
    pid: process.pid,
    host: hostname(),
    platform: process.platform,
    startedAt: new Date().toISOString(),
  };
  const create = () => writeFileSync(lock, JSON.stringify(record) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing;
    try {
      existing = JSON.parse(readFileSync(lock, 'utf8'));
    } catch {
      throw new Error('main landing owner-control lock is unreadable; manual inspection required');
    }
    const state = sameRuntime(existing) ? pidExists(existing.pid) : null;
    if (state === false) {
      throw new Error(
        'main landing owner-control lock belongs to a stopped process; inspect it before removing the lock'
      );
    }
    throw new Error('main landing owner-control lock is held or its process liveness is unknown');
  }
  return lock;
}

function ownerSummary(owner, paths) {
  const state = processState(owner.owner ?? {});
  return {
    occupied: true,
    mainPath: paths.mainPath,
    gitState: mainGitState(paths),
    ownerControl: readControlLock(paths),
    leaseId: owner.leaseId,
    occupiedSince: owner.occupiedSince,
    age: formatAge(ageMs(owner)),
    heartbeatAt: owner.heartbeatAt,
    step: owner.step,
    owner: owner.owner,
    processState: state,
    alerts: ALERTS.map((alert) => ({
      threshold: alert.label,
      status: readAlert(paths, alert.minutes)?.status ?? 'not sent',
    })),
  };
}

function showStatus(paths, json = false) {
  const owner = readOwner(paths);
  if (owner) {
    notifyIfDue(paths, owner);
    const summary = ownerSummary(owner, paths);
    if (json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    else {
      process.stdout.write(
        'main landing occupied for ' +
          summary.age +
          ' by ' +
          safeText(owner.owner?.script) +
          ' on ' +
          safeText(owner.owner?.branch) +
          ' at ' +
          safeText(paths.mainPath) +
          ' (chat ' +
          safeText(owner.owner?.chatId) +
          ', path ' +
          safeText(owner.owner?.scriptPath) +
          ', pid ' +
          safeText(owner.owner?.pid) +
          ', child ' +
          safeText(owner.owner?.childPid) +
          ', step ' +
          safeText(owner.step) +
          ', process ' +
          safeText(summary.processState) +
          ', git ' +
          safeText(summary.gitState.branch) +
          '/' +
          (summary.gitState.operations.map((entry) => entry.marker).join(',') || 'no operation') +
          (summary.gitState.dirty ? ', dirty' : ', clean') +
          ', unmerged ' +
          summary.gitState.unmerged.length +
          ', owner-control ' +
          (summary.ownerControl
            ? summary.ownerControl.unreadable
              ? 'unreadable'
              : safeText(summary.ownerControl.processState) + ' pid ' + safeText(summary.ownerControl.pid)
            : 'free') +
          '). Lease ' +
          owner.leaseId +
          '.\n'
      );
    }
    return 0;
  }

  const state = mainGitState(paths);
  const leaseDirectory = existsSync(paths.lockDir);
  const controlLock = readControlLock(paths);
  const occupied = leaseDirectory || state.operations.length > 0 || state.dirty || state.unmerged.length > 0;
  const summary = {
    occupied,
    mainPath: paths.mainPath,
    owner: null,
    leaseDirectory,
    ownerControl: controlLock,
    branch: state.branch,
    operations: state.operations,
    dirty: state.dirty,
    unmerged: state.unmerged,
  };
  if (json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  else if (leaseDirectory) {
    process.stdout.write(
      'main landing at ' +
        safeText(paths.mainPath) +
        ' has an owner lease directory but no readable owner record; owner-control=' +
        (controlLock
          ? controlLock.unreadable
            ? 'unreadable'
            : safeText(controlLock.processState) + ' pid ' + safeText(controlLock.pid)
          : 'not present') +
        '. After confirming the holder process tree has stopped, use release-incomplete only if the directory contains expected owner-record temporary files and main is clean; otherwise preserve it for recovery.\n'
    );
  } else if (occupied) {
    process.stdout.write(
      'main landing at ' +
        safeText(paths.mainPath) +
        ' has unowned Git state; owner is unknown. branch=' +
        state.branch +
        ', operations=' +
        (state.operations.map((entry) => entry.operation + ':' + entry.marker).join(', ') || 'none') +
        ', dirty=' +
        state.dirty +
        ', unmerged=' +
        state.unmerged.length +
        '. Preserve and inspect it; do not start another landing.\n'
    );
  } else {
    process.stdout.write(
      'main landing at ' + safeText(paths.mainPath) + ' is free; no owner record or Git operation is present.\n'
    );
  }
  return 0;
}

function parseOptions(args) {
  const options = { flags: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) throw new Error('unexpected argument: ' + arg);
    const name = arg.slice(2);
    if (
      [
        'confirm-owner-stopped',
        'confirm-chat-dead',
        'confirm-owner-pid-reused',
        'confirm-child-pid-reused',
        'confirm-holder-stopped',
        'confirm-control-process-stopped',
        'confirm-no-other-recovery',
        'json',
      ].includes(name)
    ) {
      options.flags.add(name);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(arg + ' requires a value');
    if (options[name] !== undefined) throw new Error(arg + ' may be supplied only once');
    options[name] = value;
    index += 1;
  }
  return options;
}

function requireNonEmpty(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.trim() === '' || /[\r\n]/.test(value)) {
    throw new Error('--' + name + ' must be a non-empty single-line value');
  }
  return value.trim();
}

function validateLandingOptions(options) {
  const mainSha = requireNonEmpty(options, 'main-sha');
  const incomingSha = requireNonEmpty(options, 'incoming-sha');
  const treeSha = requireNonEmpty(options, 'tree-sha');
  const branch = requireNonEmpty(options, 'branch');
  const chatId = requireNonEmpty(options, 'chat');
  for (const [name, value] of [
    ['main-sha', mainSha],
    ['incoming-sha', incomingSha],
    ['tree-sha', treeSha],
  ]) {
    if (!HEX_OBJECT_ID.test(value)) throw new Error('--' + name + ' must be a full Git object ID');
  }
  return { mainSha, incomingSha, treeSha, branch, chatId };
}

function assertMainLandingCheckout(paths, cwd) {
  const worktree = resolveWorktree(cwd);
  if (!isProjectMainWorktree(cwd) || !worktree?.isMainWorktree || !samePath(worktree.gitDir, paths.mainGitDir)) {
    throw new Error('run land from the designated main worktree with refs/heads/main checked out');
  }
}

function assertCleanPreflight(paths, pins) {
  const state = mainGitState(paths);
  if (state.branch !== 'main') throw new Error('designated main checkout is not on the main branch');
  if (state.operations.length > 0 || state.dirty || state.unmerged.length > 0) {
    throw new Error('main is already occupied or dirty; run npm run main:landing -- status and preserve its state');
  }
  const head = gitText(['rev-parse', 'HEAD^{commit}'], paths.mainPath);
  if (head !== pins.mainSha) throw new Error('main moved since the candidate was reviewed');
  gitText(['check-ref-format', '--branch', pins.branch], paths.mainPath);
  const tip = gitText(['rev-parse', '--verify', 'refs/heads/' + pins.branch + '^{commit}'], paths.mainPath);
  if (tip !== pins.incomingSha) throw new Error('source branch no longer points to the reviewed candidate');
  const ancestor = gitResult(['merge-base', '--is-ancestor', pins.mainSha, pins.incomingSha], paths.mainPath);
  if (ancestor.status !== 0) throw new Error('reviewed candidate is not based on the pinned main commit');
  const mergeTree = gitResult(['merge-tree', '--write-tree', pins.mainSha, pins.incomingSha], paths.mainPath);
  if (mergeTree.status !== 0)
    throw new Error('candidate conflicts with main; resolve and review it in the candidate worktree');
  const computedTree = mergeTree.stdout.trim().split(/\s+/)[0];
  if (computedTree !== pins.treeSha) throw new Error('reviewed merge tree does not match the candidate record');
}

function assertMainAvailable(paths) {
  const state = mainGitState(paths);
  if (state.branch !== 'main') throw new Error('designated main checkout is not on the main branch');
  if (state.operations.length > 0 || state.dirty || state.unmerged.length > 0) {
    throw new Error('main is already occupied or dirty; run npm run main:landing -- status and preserve its state');
  }
}

function newOwner(pins, mode = 'landing') {
  const now = new Date().toISOString();
  return {
    version: 1,
    leaseId: randomUUID(),
    mode,
    occupiedSince: now,
    ownerSince: now,
    startedAt: now,
    heartbeatAt: now,
    step: mode === 'landing' ? 'preflight complete' : 'recovery takeover',
    mainSha: pins.mainSha ?? null,
    incomingSha: pins.incomingSha ?? null,
    treeSha: pins.treeSha ?? null,
    owner: {
      branch: pins.branch,
      chatId: pins.chatId,
      pid: mode === 'landing' ? process.pid : null,
      childPid: null,
      host: hostname(),
      platform: process.platform,
      script: mode === 'landing' ? 'scripts/main-landing.mjs' : 'Luna recovery agent',
      scriptPath: mode === 'landing' ? SCRIPT_PATH : null,
    },
  };
}

function acquire(paths, owner) {
  try {
    mkdirSync(paths.lockDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readOwner(paths);
    if (!existing)
      throw new Error(
        'main landing lease directory exists without a readable owner record; manual inspection required'
      );
    notifyIfDue(paths, existing);
    throw new Error(
      'main landing is held by branch ' +
        safeText(existing.owner?.branch) +
        ', chat ' +
        safeText(existing.owner?.chatId) +
        ', script ' +
        safeText(existing.owner?.script) +
        ', pid ' +
        safeText(existing.owner?.pid) +
        ', step ' +
        safeText(existing.step) +
        ', since ' +
        safeText(existing.occupiedSince) +
        '. Report this in your chat and continue unrelated work; do not wait or modify main.'
    );
  }
  try {
    writeOwner(paths, owner);
  } catch (error) {
    rmSync(paths.lockDir, { recursive: true, force: true });
    throw error;
  }
}

function startWatcher(paths, leaseId) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, 'watch', leaseId], {
      cwd: dirname(paths.commonDir),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      child.unref();
      resolvePromise(child.pid);
    });
    child.once('error', (error) => {
      rejectPromise(new Error('could not start the detached alert watcher: ' + error.message, { cause: error }));
    });
  });
}

function runChild(command, args, { cwd, env, onPid }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    let settled = false;
    const reportPid = (pid) => {
      try {
        onPid(pid);
      } catch (error) {
        if (!settled) {
          settled = true;
          child.kill();
          rejectPromise(error);
        }
      }
    };
    child.once('spawn', () => reportPid(child.pid ?? null));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      try {
        onPid(null);
      } catch (error) {
        settled = true;
        rejectPromise(error);
        return;
      }
      settled = true;
      resolvePromise({ code: code ?? 1, signal });
    });
  });
}

function heartbeat(paths, owner, step = owner.step, childPid = owner.owner.childPid) {
  const controlLock = acquireRecoveryControl(paths, owner);
  try {
    const current = readOwner(paths);
    if (!current || current.leaseId !== owner.leaseId)
      throw new Error('main landing lease was replaced; stopping before another Git command');
    owner.heartbeatAt = new Date().toISOString();
    owner.step = step;
    owner.owner.childPid = childPid ?? null;
    writeOwner(paths, owner);
  } finally {
    rmSync(controlLock, { force: true });
  }
}

function beginHeartbeat(paths, owner) {
  const timer = setInterval(() => {
    try {
      heartbeat(paths, owner);
    } catch (error) {
      process.stderr.write('main-landing: heartbeat failed: ' + error.message + '\n');
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}

function operationIsClean(paths) {
  try {
    return cleanMain(paths);
  } catch {
    return false;
  }
}

async function land(paths, options, cwd) {
  const pins = validateLandingOptions(options);
  assertMainLandingCheckout(paths, cwd);
  assertMainAvailable(paths);
  const owner = newOwner(pins);
  acquire(paths, owner);
  const timer = beginHeartbeat(paths, owner);
  try {
    await startWatcher(paths, owner.leaseId);
    assertCleanPreflight(paths, pins);
    heartbeat(paths, owner, 'preparing reviewed merge', null);
    const merge = await runChild('git', ['merge', '--no-commit', '--no-ff', '--no-edit', pins.incomingSha], {
      cwd: paths.mainPath,
      env: process.env,
      onPid: (pid) => heartbeat(paths, owner, 'git merge --no-commit --no-ff', pid),
    });
    if (merge.code !== 0) {
      throw new Error(
        'git merge exited ' +
          merge.code +
          (merge.signal ? ' after ' + merge.signal : '') +
          '; leaving state and owner record for recovery'
      );
    }

    const hooks = await runChild(process.execPath, [join(paths.mainPath, 'scripts/install-git-hooks.js')], {
      cwd: paths.mainPath,
      env: process.env,
      onPid: (pid) => heartbeat(paths, owner, 'refreshing shared Git hook dispatchers', pid),
    });
    if (hooks.code !== 0)
      throw new Error('Git hook installation exited ' + hooks.code + '; preserving prepared merge for recovery');

    const mergeHeads = readMergeHeadRefs(paths.mainPath);
    if (mergeHeads.length !== 1 || mergeHeads[0] !== pins.incomingSha) {
      throw new Error('prepared merge markers do not match the reviewed incoming commit; preserving state');
    }
    const unmergedResult = gitResult(['diff', '--name-only', '--diff-filter=U', '-z'], paths.mainPath);
    if (unmergedResult.status !== 0) {
      throw new Error((unmergedResult.stderr || unmergedResult.stdout || 'unmerged-path check failed').trim());
    }
    const unmerged = unmergedResult.stdout.split('\0').filter(Boolean);
    if (unmerged.length > 0) throw new Error('prepared merge has unmerged paths; preserving state for recovery');
    const resultTree = gitText(['write-tree'], paths.mainPath);
    if (resultTree !== pins.treeSha)
      throw new Error('prepared merge tree differs from the reviewed tree; preserving state');

    heartbeat(paths, owner, 'committing reviewed landing', null);
    const message = 'Merge ' + pins.branch + ' into main\n\nBranch: ' + pins.branch + '\nChat: ' + pins.chatId;
    const commitEnv = {
      ...process.env,
      KILO_EXPECTED_MAIN_SHA: pins.mainSha,
      KILO_EXPECTED_INCOMING_SHA: pins.incomingSha,
      KILO_EXPECTED_TREE_SHA: pins.treeSha,
      KILO_EXPECTED_BRANCH: pins.branch,
      KILO_EXPECTED_CHAT_ID: pins.chatId,
      KILO_MAIN_LANDING_LEASE_ID: owner.leaseId,
    };
    const commit = await runChild(
      process.execPath,
      [join(dirname(SCRIPT_PATH), 'commit-reviewed-landing.mjs'), '-m', message],
      {
        cwd: paths.mainPath,
        env: commitEnv,
        onPid: (pid) => heartbeat(paths, owner, 'commit-reviewed-landing and hooks', pid),
      }
    );
    if (commit.code !== 0)
      throw new Error('reviewed landing commit exited ' + commit.code + '; preserving state for recovery');
    if (!cleanMain(paths)) throw new Error('landing commit returned, but main is not clean; preserving owner record');
    clearInterval(timer);
    releaseLock(paths, owner.leaseId);
    process.stdout.write('main landing committed and owner lease released.\n');
    return 0;
  } catch (error) {
    clearInterval(timer);
    try {
      if (operationIsClean(paths)) {
        releaseLock(paths, owner.leaseId);
        process.stderr.write('main-landing: operation ended without Git state; owner lease released.\n');
      } else {
        const current = readOwner(paths);
        if (current?.leaseId === owner.leaseId) {
          owner.owner.childPid = null;
          owner.step = 'recovery required: ' + safeText(error.message, 240);
          owner.heartbeatAt = new Date().toISOString();
          writeOwner(paths, owner);
        }
        process.stderr.write(
          'main-landing: Git state preserved. Run npm run main:landing -- status and follow the recovery procedure.\n'
        );
      }
    } catch (releaseError) {
      process.stderr.write('main-landing: lease cleanup failed: ' + releaseError.message + '\n');
    }
    process.stderr.write('main-landing: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    return 1;
  } finally {
    clearInterval(timer);
  }
}

function takeover(paths, options) {
  const token = requireNonEmpty(options, 'token');
  const branch = requireNonEmpty(options, 'branch');
  const chatId = requireNonEmpty(options, 'chat');
  const model = requireNonEmpty(options, 'model');
  const reasoning = requireNonEmpty(options, 'reasoning');
  if (model !== 'gpt-6-luna' || reasoning !== 'xhigh') {
    throw new Error('the four-hour recovery takeover requires the specified gpt-6-luna xhigh agent');
  }
  if (!options.flags.has('confirm-owner-stopped') || !options.flags.has('confirm-chat-dead')) {
    throw new Error(
      'takeover requires both --confirm-owner-stopped and --confirm-chat-dead after checking host liveness without reading transcripts'
    );
  }
  const current = readOwner(paths);
  if (!current || current.leaseId !== token)
    throw new Error('lease token does not match the current main landing owner');
  if (current.mode !== 'landing')
    throw new Error('the current lease is already recovery-owned; a second takeover is refused');
  const occupiedFor = ageMs(current);
  if (!Number.isFinite(occupiedFor) || occupiedFor < 4 * 60 * 60_000) {
    throw new Error('four hours of occupied time cannot be proven; takeover is not eligible');
  }
  const pidStates = recordedPidStates(current.owner);
  if (pidStates.owner === true && !options.flags.has('confirm-owner-pid-reused')) {
    throw new Error('the recorded owner PID still exists; takeover requires confirming it is an unrelated PID reuse');
  }
  if (pidStates.child === true && !options.flags.has('confirm-child-pid-reused')) {
    throw new Error('the recorded child PID still exists; takeover requires confirming it is an unrelated PID reuse');
  }
  const takeoverLock = acquireRecoveryControl(paths, current);
  let archived;
  let replacement;
  try {
    const latest = readOwner(paths);
    if (!latest || latest.leaseId !== token)
      throw new Error('main landing lease changed while recovery takeover was starting');
    mkdirSync(paths.archiveDir, { recursive: true });
    archived = join(paths.archiveDir, latest.leaseId + '.json');
    copyFileSync(ownerPath(paths), archived);
    replacement = {
      ...latest,
      leaseId: randomUUID(),
      mode: 'recovery',
      ownerSince: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      step: 'Luna recovery agent owns recovery; Git state unchanged',
      previousOwner: latest.owner,
      owner: {
        branch,
        chatId,
        pid: null,
        childPid: null,
        host: hostname(),
        platform: process.platform,
        script: 'Luna recovery agent',
        scriptPath: null,
        model,
        reasoning,
      },
    };
    writeOwner(paths, replacement);
  } finally {
    rmSync(takeoverLock, { force: true });
  }
  boardNote(
    paths,
    'Main landing recovery ownership transferred to Luna xhigh. Previous lease ' +
      current.leaseId +
      ' is archived at ' +
      archived +
      '. Git state was not changed; inspect and preserve it before recovery.'
  );
  process.stdout.write(
    'recovery ownership recorded as lease ' +
      replacement.leaseId +
      '. Git state is unchanged; preserve the old worktree and refs before any reset, abort, detach, or replacement.\n'
  );
  return 0;
}

function releaseStale(paths, options) {
  const token = requireNonEmpty(options, 'token');
  if (!options.flags.has('confirm-owner-stopped')) {
    throw new Error('release-stale requires --confirm-owner-stopped after checking the full process tree');
  }
  const current = readOwner(paths);
  if (!current || current.leaseId !== token || current.mode !== 'landing') {
    throw new Error('token does not match a landing lease eligible for stale release');
  }
  if (processState(current.owner) === 'alive') {
    throw new Error('a recorded owner or child PID is alive; only release after the holder process tree has stopped');
  }
  const controlLock = acquireRecoveryControl(paths, current);
  let archived;
  let leaseRemoved = false;
  try {
    const latest = readOwner(paths);
    if (!latest || latest.leaseId !== token || latest.mode !== 'landing') {
      throw new Error('landing lease changed while stale release was starting');
    }
    if (!cleanMain(paths)) {
      throw new Error('main has dirty files or Git operation markers; stale release is only for a clean main worktree');
    }
    mkdirSync(paths.archiveDir, { recursive: true });
    archived = join(paths.archiveDir, latest.leaseId + '.json');
    copyFileSync(ownerPath(paths), archived);
    rmSync(paths.lockDir, { recursive: true, force: false });
    leaseRemoved = true;
  } finally {
    if (!leaseRemoved) rmSync(controlLock, { force: true });
  }
  boardNote(
    paths,
    'Released stale main landing lease ' +
      token +
      ' after owner-stop confirmation. Main was clean; archived record: ' +
      archived
  );
  process.stdout.write('stale landing lease released; main was clean and the owner record was archived.\n');
  return 0;
}

function clearControlLock(paths, options) {
  if (!options.flags.has('confirm-control-process-stopped') || !options.flags.has('confirm-no-other-recovery')) {
    throw new Error(
      'clear-control-lock requires confirmation that its process stopped and no other recovery command is running'
    );
  }
  const file = join(paths.lockDir, 'owner-control.lock');
  if (!existsSync(file)) {
    process.stdout.write('no owner-control lock is present.\n');
    return 0;
  }
  let expected;
  try {
    expected = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('owner-control lock is unreadable; preserve the owner directory for manual inspection');
  }
  if (sameRuntime(expected) && pidExists(expected.pid) === true) {
    throw new Error('the owner-control process is still alive; do not clear its lock');
  }
  const latest = JSON.parse(readFileSync(file, 'utf8'));
  if (
    latest.leaseId !== expected.leaseId ||
    latest.pid !== expected.pid ||
    latest.host !== expected.host ||
    latest.platform !== expected.platform ||
    latest.startedAt !== expected.startedAt
  ) {
    throw new Error('owner-control lock changed during inspection; retry status before recovery');
  }
  rmSync(file);
  process.stdout.write('stale owner-control lock cleared; no Git state was changed.\n');
  return 0;
}

function releaseIncomplete(paths, options) {
  if (!options.flags.has('confirm-holder-stopped') || !options.flags.has('confirm-no-other-recovery')) {
    throw new Error(
      'release-incomplete requires confirmation that the holder stopped and no other recovery command is running'
    );
  }
  if (!existsSync(paths.lockDir)) {
    process.stdout.write('no incomplete landing lease directory is present.\n');
    return 0;
  }
  if (existsSync(ownerPath(paths))) {
    throw new Error('an owner record exists; use the normal stale-release or recovery path');
  }
  const controlLock = acquireRecoveryControl(paths, { leaseId: null });
  let archived;
  let directoryMoved = false;
  try {
    if (existsSync(ownerPath(paths))) {
      throw new Error(
        'an owner record appeared during incomplete-lease inspection; preserve it and use the normal recovery path'
      );
    }
    const entries = readdirSync(paths.lockDir, { withFileTypes: true });
    const unexpected = entries.filter((entry) => {
      if (!entry.isFile()) return true;
      if (entry.name === 'owner-control.lock') return false;
      return !/^owner\.json\.\d+\.[0-9a-f-]{36}\.tmp$/i.test(entry.name);
    });
    if (unexpected.length > 0) {
      throw new Error(
        'incomplete lease directory contains unexpected entries: ' +
          unexpected.map((entry) => safeText(entry.name, 120)).join(', ')
      );
    }
    if (!cleanMain(paths)) {
      throw new Error('main has dirty files or Git operation markers; preserving the incomplete lease directory');
    }
    mkdirSync(paths.archiveDir, { recursive: true });
    archived = join(paths.archiveDir, 'incomplete-' + Date.now() + '-' + randomUUID());
    renameSync(paths.lockDir, archived);
    directoryMoved = true;
  } finally {
    if (!directoryMoved && existsSync(controlLock)) rmSync(controlLock, { force: true });
  }
  boardNote(paths, 'Archived an incomplete main landing lease directory after holder-stop confirmation: ' + archived);
  process.stdout.write('incomplete landing lease directory archived; main was clean and Git state was unchanged.\n');
  return 0;
}

function updateRecoveryHeartbeat(paths, options) {
  const token = requireNonEmpty(options, 'token');
  const step = requireNonEmpty(options, 'step');
  const controlLock = acquireRecoveryControl(paths, { leaseId: token });
  try {
    const owner = readOwner(paths);
    if (!owner || owner.leaseId !== token || owner.mode !== 'recovery') {
      throw new Error('recovery lease token does not match the current owner');
    }
    owner.heartbeatAt = new Date().toISOString();
    owner.step = safeText(step, 240);
    writeOwner(paths, owner);
  } finally {
    rmSync(controlLock, { force: true });
  }
  process.stdout.write('recovery lease heartbeat recorded.\n');
  return 0;
}

function releaseRecovery(paths, options) {
  const token = requireNonEmpty(options, 'token');
  const owner = readOwner(paths);
  if (!owner || owner.leaseId !== token || owner.mode !== 'recovery') {
    throw new Error('recovery lease token does not match the current owner');
  }
  releaseLock(paths, token);
  process.stdout.write('recovery lease released; main is clean and has no operation markers.\n');
  return 0;
}

async function watch(paths, leaseId) {
  for (;;) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, WATCH_POLL_MS));
    let owner;
    try {
      owner = readOwner(paths);
    } catch (error) {
      appendFileSync(
        join(paths.lockDir, 'alert-failures.log'),
        new Date().toISOString() + ' watcher: ' + error.message + '\n'
      );
      return 1;
    }
    if (!owner || owner.leaseId !== leaseId) return 0;
    try {
      notifyIfDue(paths, owner);
    } catch (error) {
      try {
        appendFileSync(
          join(paths.lockDir, 'alert-failures.log'),
          new Date().toISOString() + ' watcher: ' + error.message + '\n'
        );
      } catch {
        return 1;
      }
    }
  }
}

async function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const [action, ...rest] = argv;
  if (!action || action === '--help' || action === '-h') {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  if (action === 'watch') {
    const paths = resolvePaths(cwd);
    const leaseId = rest[0];
    if (!leaseId || rest.length !== 1) throw new Error('watch requires one lease ID');
    return watch(paths, leaseId);
  }
  const options = parseOptions(rest);
  const paths = resolvePaths(cwd);
  if (action === 'status') return showStatus(paths, options.flags.has('json'));
  if (action === 'land') return land(paths, options, cwd);
  if (action === 'takeover') return takeover(paths, options);
  if (action === 'release-stale') return releaseStale(paths, options);
  if (action === 'release-incomplete') return releaseIncomplete(paths, options);
  if (action === 'clear-control-lock') return clearControlLock(paths, options);
  if (action === 'heartbeat') return updateRecoveryHeartbeat(paths, options);
  if (action === 'release') return releaseRecovery(paths, options);
  throw new Error('unknown action: ' + action + '\n' + USAGE);
}

export function assertLandingLease(cwd, leaseId, expected) {
  if (!leaseId) throw new Error('main landing commit has no owner lease token');
  const paths = resolvePaths(cwd);
  const owner = readOwner(paths);
  if (!owner || owner.leaseId !== leaseId || owner.mode !== 'landing') {
    throw new Error('main landing owner lease is missing or changed');
  }
  if (
    owner.owner?.branch !== expected.branch ||
    owner.owner?.chatId !== expected.chatId ||
    owner.mainSha !== expected.mainSha ||
    owner.incomingSha !== expected.incomingSha ||
    owner.treeSha !== expected.treeSha
  ) {
    throw new Error('main landing owner lease does not match the reviewed landing pins');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write('main-landing: ' + (error instanceof Error ? error.message : String(error)) + '\n');
      process.exitCode = 1;
    }
  );
}
