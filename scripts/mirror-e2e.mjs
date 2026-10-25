import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { validateE2ESpec } from './validate-e2e-spec.mjs';

export const MIRROR_REPOSITORY = 'Bohdanus/ph';
export const LINUX_BASELINE_PATH = 'e2e/export/visual-regression.spec.ts-snapshots/export-baselines/linux';
export const LINUX_BASELINE_FILES = [
  'drawing.avif.png',
  'drawing.bmp.png',
  'drawing.gif.png',
  'drawing.jpeg.png',
  'drawing.png.png',
  'drawing.svg.png',
  'drawing.webp.png',
];

const REPO_ROOT = realpathSync(process.cwd());
const MAIN_REF = 'main';
const DISCOVERY_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 60 * 60_000;
const POLL_COMMAND_TIMEOUT_MS = 30_000;

const WORKFLOW = Object.freeze({
  full: { file: 'ci.yml', title: (requestId, sha) => `CI ${requestId} @ ${sha}` },
  focused: { file: 'focused-e2e.yml', title: (requestId, sha) => `Focused E2E ${requestId} @ ${sha}` },
  baselines: {
    file: 'capture-linux-baselines.yml',
    title: (requestId, sha) => `Linux baselines ${requestId} @ ${sha}`,
  },
});

export function parseArgs(argv) {
  const options = { mode: null, spec: null, platform: 'linux', platformProvided: false, chatId: null };
  const modes = new Set();
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--full') {
      if (seen.has(arg)) throw new Error(`${arg} may only be supplied once`);
      seen.add(arg);
      modes.add('full');
      continue;
    }
    if (arg === '--linux-baselines') {
      if (seen.has(arg)) throw new Error(`${arg} may only be supplied once`);
      seen.add(arg);
      modes.add('baselines');
      continue;
    }
    if (arg === '--spec' || arg === '--platform' || arg === '--chat-id') {
      if (seen.has(arg)) throw new Error(`${arg} may only be supplied once`);
      seen.add(arg);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--spec') {
        modes.add('focused');
        options.spec = value;
      } else if (arg === '--platform') {
        options.platform = value;
        options.platformProvided = true;
      } else {
        options.chatId = value;
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (modes.size !== 1) throw new Error('choose exactly one of --spec, --full, or --linux-baselines');
  [options.mode] = modes;

  if (options.mode === 'focused') {
    if (!['linux', 'windows', 'macos'].includes(options.platform)) {
      throw new Error('--platform must be linux, windows, or macos');
    }
    options.spec = validateE2ESpec(options.spec);
    if (options.chatId) throw new Error('--chat-id is only valid with --linux-baselines');
  } else {
    if (options.platformProvided) throw new Error('--platform is only valid with --spec');
    if (options.spec) throw new Error('--spec cannot be combined with another mode');
    if (options.mode === 'baselines') {
      if (!options.chatId || options.chatId.trim() !== options.chatId || /[\r\n]/.test(options.chatId)) {
        throw new Error('--linux-baselines requires one native --chat-id without newlines');
      }
    } else if (options.chatId) {
      throw new Error('--chat-id is only valid with --linux-baselines');
    }
  }

  return options;
}

export function githubRepositoryFromRemote(remoteUrl) {
  const remote = String(remoteUrl ?? '').trim();
  const sshScp = remote.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshScp) return `${sshScp[1]}/${sshScp[2]}`.toLowerCase();

  let parsed;
  try {
    parsed = new URL(remote);
  } catch {
    return null;
  }
  if (!['https:', 'ssh:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'github.com') return null;
  if (parsed.protocol === 'ssh:' && parsed.username.toLowerCase() !== 'git') return null;
  if (parsed.port || parsed.search || parsed.hash) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  return `${segments[0]}/${segments[1].replace(/\.git$/i, '')}`.toLowerCase();
}

export function assertMirrorRemote(remoteUrl) {
  if (githubRepositoryFromRemote(remoteUrl) !== MIRROR_REPOSITORY.toLowerCase()) {
    throw new Error(`mirror remote must point to github.com/${MIRROR_REPOSITORY}`);
  }
}

export function isRetryableCommandError(code, detail = '') {
  return (
    ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'].includes(code) ||
    /\b(?:HTTP 5\d\d|timed out|temporary failure|temporarily unavailable|could not resolve host|failed to connect|rate limit exceeded|ECONNRESET|EAI_AGAIN|ENETUNREACH)\b/i.test(
      detail
    )
  );
}

export function expectedRunTitle(mode, requestId, sourceSha) {
  const workflow = WORKFLOW[mode];
  if (!workflow) throw new Error(`Unknown mirror workflow mode: ${mode}`);
  return workflow.title(requestId, sourceSha);
}

export function findDispatchedRun(runs, displayTitle) {
  const matches = runs.filter((run) => run.event === 'workflow_dispatch' && run.displayTitle === displayTitle);
  if (matches.length > 1) throw new Error(`More than one workflow run matched request ${displayTitle}`);
  return matches[0] ?? null;
}

export function buildDispatchArgs(options, { requestId, sourceSha, branch }) {
  const workflow = WORKFLOW[options.mode];
  const inputs = { request_id: requestId, source_sha: sourceSha };
  if (options.mode === 'focused') Object.assign(inputs, { platform: options.platform, spec: options.spec });
  if (options.mode === 'baselines') {
    Object.assign(inputs, { source_branch: branch, promote: 'true', chat_id: options.chatId });
  }

  return [
    'workflow',
    'run',
    workflow.file,
    '--repo',
    MIRROR_REPOSITORY,
    '--ref',
    MAIN_REF,
    ...Object.entries(inputs).flatMap(([key, value]) => ['-f', `${key}=${value}`]),
  ];
}

export function buildMirrorPushArgs(sourceSha, branch) {
  return ['push', 'mirror', `${sourceSha}:refs/heads/${branch}`];
}

export function verifyBaselinePromotion({ sourceSha, remoteSha, parentSha, changedPaths, commitMessage, chatId }) {
  if (remoteSha === sourceSha) return { changed: false, changedPaths: [] };
  if (parentSha !== sourceSha) throw new Error('mirror baseline commit is not a direct child of the tested commit');
  if (!changedPaths.length || changedPaths.some((file) => !isLinuxBaselinePath(file))) {
    throw new Error('mirror baseline commit contains files outside the Linux export baseline allowlist');
  }
  const chatTrailers = commitMessage.split(/\r?\n/).filter((line) => /^Chat:\s*\S/.test(line));
  if (chatTrailers.length !== 1 || chatTrailers[0] !== `Chat: ${chatId}`) {
    throw new Error('mirror baseline commit must contain exactly the requested native Chat trailer');
  }
  return { changed: true, changedPaths };
}

export function isLinuxBaselinePath(file) {
  return LINUX_BASELINE_FILES.some((name) => file === `${LINUX_BASELINE_PATH}/${name}`);
}

function command(binary, args, cwd = process.cwd(), timeoutMs = 120_000) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    const error = new Error(`${binary} could not run: ${result.error.message}`);
    error.retryable = isRetryableCommandError(result.error.code, result.error.message);
    throw error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    const error = new Error(`${binary} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
    error.retryable = isRetryableCommandError(result.error?.code, detail);
    throw error;
  }
  return (result.stdout ?? '').trim();
}

function assertCleanTaskBranch() {
  const root = realpathSync(process.cwd());
  if (root !== REPO_ROOT) throw new Error(`run this command from the repository root: ${REPO_ROOT}`);
  if (realpathSync(command('git', ['rev-parse', '--show-toplevel'])) !== root) {
    throw new Error('run this command from the Git repository root');
  }

  const branch = command('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch === 'main') throw new Error('mirror E2E runs require a feature branch, not main');
  command('git', ['check-ref-format', `refs/heads/${branch}`]);

  const status = command('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error('commit or remove all tracked and untracked changes before mirror dispatch');

  const sourceSha = command('git', ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceSha)) throw new Error('could not resolve the source commit SHA');

  const mirrorUrl = command('git', ['remote', 'get-url', '--push', 'mirror']);
  assertMirrorRemote(mirrorUrl);
  return { branch, sourceSha };
}

async function discoverRun(mode, title, deadline) {
  const workflowFile = WORKFLOW[mode].file;
  let lastTransientError;
  while (Date.now() < deadline) {
    try {
      const output = command(
        'gh',
        [
          'run',
          'list',
          '--repo',
          MIRROR_REPOSITORY,
          '--workflow',
          workflowFile,
          '--branch',
          MAIN_REF,
          '--limit',
          '100',
          '--json',
          'attempt,databaseId,displayTitle,event,headBranch,status,url',
        ],
        process.cwd(),
        POLL_COMMAND_TIMEOUT_MS
      );
      const run = findDispatchedRun(JSON.parse(output), title);
      if (run) return run;
    } catch (error) {
      if (error.retryable !== true) throw error;
      lastTransientError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(
    `workflow run ${title} did not appear within ${DISCOVERY_TIMEOUT_MS / 1000}s${
      lastTransientError ? `; last transient error: ${lastTransientError.message}` : ''
    }`
  );
}

async function waitForRun(run, title) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let lastTransientError;
  while (Date.now() < deadline) {
    try {
      const output = command(
        'gh',
        [
          'run',
          'view',
          String(run.databaseId),
          '--repo',
          MIRROR_REPOSITORY,
          '--json',
          'attempt,conclusion,displayTitle,headBranch,status,url',
        ],
        process.cwd(),
        POLL_COMMAND_TIMEOUT_MS
      );
      const current = JSON.parse(output);
      if (current.displayTitle !== title || current.headBranch !== MAIN_REF) {
        throw new Error('located workflow run no longer matches the requested title and main workflow ref');
      }
      if (current.status === 'completed') return { ...current, databaseId: run.databaseId };
    } catch (error) {
      if (error.retryable !== true) throw error;
      lastTransientError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `workflow run ${run.databaseId} exceeded the ${RUN_TIMEOUT_MS / 60_000} minute wait limit${
      lastTransientError ? `; last transient error: ${lastTransientError.message}` : ''
    }`
  );
}

function downloadArtifacts(runId, attempt, requestId) {
  const outputDir = path.join(REPO_ROOT, 'test-results', 'remote-e2e', `${runId}-${attempt}-${requestId}`);
  try {
    mkdirSync(outputDir, { recursive: true });
    command(
      'gh',
      ['run', 'download', String(runId), '--repo', MIRROR_REPOSITORY, '--dir', outputDir],
      process.cwd(),
      10 * 60_000
    );
    console.error(`Run artifacts (gitignored): ${outputDir}`);
  } catch (error) {
    console.error(`Could not download run artifacts: ${error.message}`);
  }
}

function fastForwardBaselineCommit({ branch, sourceSha, chatId }) {
  if (command('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) {
    throw new Error('local branch changed while the baseline workflow ran; leave the mirror commit for manual review');
  }
  if (command('git', ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceSha) {
    throw new Error('local branch moved while the baseline workflow ran; leave the mirror commit for manual review');
  }
  if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('local worktree became dirty while the baseline workflow ran; do not fast-forward it');
  }

  command('git', ['fetch', '--no-tags', 'mirror', `refs/heads/${branch}`]);
  const remoteSha = command('git', ['rev-parse', 'FETCH_HEAD']);
  if (remoteSha === sourceSha) {
    console.log('Linux export baselines already match; no branch commit was created.');
    return;
  }

  const parentSha = command('git', ['rev-parse', `${remoteSha}^`]);
  const changedPaths = command('git', ['diff', '--name-only', `${sourceSha}..${remoteSha}`])
    .split('\n')
    .filter(Boolean);
  const commitMessage = command('git', ['show', '-s', '--format=%B', remoteSha]);
  const result = verifyBaselinePromotion({ sourceSha, remoteSha, parentSha, changedPaths, commitMessage, chatId });
  if (result.changed) {
    if (command('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) {
      throw new Error(
        'local branch changed before the baseline fast-forward; leave the mirror commit for manual review'
      );
    }
    if (command('git', ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceSha) {
      throw new Error('local branch moved before the baseline fast-forward; leave the mirror commit for manual review');
    }
    if (command('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error(
        'local worktree became dirty before the baseline fast-forward; leave the mirror commit for manual review'
      );
    }
    command('git', ['merge', '--ff-only', 'FETCH_HEAD']);
    console.log(`Fast-forwarded ${branch} with ${changedPaths.length} Linux baseline file(s).`);
  }
}

export async function runMirrorE2E(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { branch, sourceSha } = assertCleanTaskBranch();
  const requestId = randomUUID().replaceAll('-', '');
  const title = expectedRunTitle(options.mode, requestId, sourceSha);

  command('git', buildMirrorPushArgs(sourceSha, branch));
  const dispatchArgs = buildDispatchArgs(options, { requestId, sourceSha, branch });
  command('gh', dispatchArgs);
  console.log(`Waiting for ${title}`);

  let run;
  let finished;
  try {
    run = await discoverRun(options.mode, title, Date.now() + DISCOVERY_TIMEOUT_MS);
    finished = await waitForRun(run, title);
  } catch (error) {
    console.error(error.message);
    if (run) downloadArtifacts(run.databaseId, run.attempt ?? 1, requestId);
    throw error;
  }

  console.log(`Run: ${finished.url}`);
  if (finished.conclusion !== 'success') {
    downloadArtifacts(finished.databaseId, finished.attempt ?? 1, requestId);
    throw new Error(`mirror workflow concluded ${finished.conclusion ?? 'without a conclusion'}`);
  }

  if (options.mode === 'baselines') fastForwardBaselineCommit({ branch, sourceSha, chatId: options.chatId });
  console.log(`Mirror ${options.mode} run succeeded at ${sourceSha}.`);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'mirror-e2e.mjs') {
  runMirrorE2E().catch((error) => {
    console.error(`Mirror E2E failed: ${error.message}`);
    process.exitCode = 1;
  });
}
