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
const GIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const KILO_SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]{26}$/;
const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const CODEX_THREAD_ID_PATTERN = new RegExp(`^${UUID_PATTERN}$`);
const COPILOT_SESSION_URI_PATTERN = new RegExp(`^copilotcli:/${UUID_PATTERN}$`);
const LINUX_BASELINE_COMMIT_SUBJECT = 'test: refresh Linux export baselines';
const DISCOVERY_TIMEOUT_MS = 120_000;
export const RUN_WAIT_TIMEOUT_MS_BY_MODE = Object.freeze({
  full: 60 * 60_000,
  focused: 60 * 60_000,
  // The capture and promotion jobs have separate 55m and 10m limits; leave 25m for queue and handoff time.
  baselines: 90 * 60_000,
});
const POLL_COMMAND_TIMEOUT_MS = 30_000;

function matchesEntireString(pattern, value) {
  return pattern.exec(value)?.[0] === value;
}

function isNativeChatId(chatId) {
  if (typeof chatId !== 'string') return false;
  return (
    matchesEntireString(KILO_SESSION_ID_PATTERN, chatId) ||
    matchesEntireString(CODEX_THREAD_ID_PATTERN, chatId) ||
    matchesEntireString(COPILOT_SESSION_URI_PATTERN, chatId)
  );
}

const WORKFLOW = Object.freeze({
  full: {
    file: 'ci.yml',
    eventType: 'mirror-e2e-full',
    title: (requestId, sha) => `CI ${requestId} @ ${sha}`,
  },
  focused: {
    file: 'focused-e2e.yml',
    eventType: 'mirror-e2e-focused',
    title: (requestId, sha) => `Focused E2E ${requestId} @ ${sha}`,
  },
  baselines: {
    file: 'capture-linux-baselines.yml',
    eventType: 'capture-linux-baselines',
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
      if (!options.chatId || !isNativeChatId(options.chatId)) {
        throw new Error('--linux-baselines requires a native --chat-id; Copilot URIs must contain a UUID');
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
  if (parsed.protocol === 'https:' && (parsed.username || parsed.password)) return null;
  if (parsed.protocol === 'ssh:' && parsed.username.toLowerCase() !== 'git') return null;
  if (parsed.password) return null;
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

export function assertMirrorRemoteUrls(fetchUrls, pushUrls) {
  const fetch = fetchUrls.map((url) => String(url).trim()).filter(Boolean);
  const push = pushUrls.map((url) => String(url).trim()).filter(Boolean);
  if (fetch.length === 0 || push.length === 0) {
    throw new Error(`mirror remote must have fetch and push URLs pointing to github.com/${MIRROR_REPOSITORY}`);
  }
  for (const url of [...fetch, ...push]) assertMirrorRemote(url);
}

export function assertMirrorWorkflowCurrent(file, localSha, mirrorSha, state) {
  if (state !== 'active') throw new Error(`${file} is not active on mirror main`);
  if (!localSha || !mirrorSha || localSha !== mirrorSha) {
    throw new Error(`${file} on mirror main does not match this commit; merge the matching workflow into mirror main`);
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

export function findDispatchedRun(runs, displayTitle, event = 'repository_dispatch') {
  const matches = runs.filter((run) => run.event === event && run.displayTitle === displayTitle);
  if (matches.length > 1) throw new Error(`More than one workflow run matched request ${displayTitle}`);
  return matches[0] ?? null;
}

export function assertMirrorRunUsesWorkflowSha(run, expectedWorkflowSha) {
  if (run.headSha !== expectedWorkflowSha) {
    throw new Error('mirror workflow run used a different main revision than the validated preflight');
  }
}

export function buildDispatchArgs(options, { requestId, sourceSha, branch, workflowSha }) {
  const workflow = WORKFLOW[options.mode];
  const payload = { request_id: requestId, source_sha: sourceSha, expected_workflow_sha: workflowSha };
  if (options.mode === 'focused') Object.assign(payload, { platform: options.platform, spec: options.spec });
  if (options.mode === 'baselines') {
    Object.assign(payload, { source_branch: branch, promote: true, chat_id: options.chatId });
  }
  const payloadFields = Object.entries(payload).flatMap(([key, value]) => [
    key === 'promote' ? '-F' : '-f',
    `client_payload[${key}]=${value}`,
  ]);
  return [
    'api',
    '--method',
    'POST',
    `repos/${MIRROR_REPOSITORY}/dispatches`,
    '-f',
    `event_type=${workflow.eventType}`,
    ...payloadFields,
  ];
}

export function parseMirrorBranchSha(output, branch) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length !== 1) throw new Error(`mirror returned multiple refs for refs/heads/${branch}`);

  const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(.+)$/i.exec(lines[0]);
  if (!match || match[2] !== `refs/heads/${branch}`) {
    throw new Error(`mirror returned an invalid ref for refs/heads/${branch}`);
  }
  return match[1];
}

export function readMirrorBranchSha(branch, cwd = process.cwd(), runCommand = command) {
  const ref = `refs/heads/${branch}`;
  const sha = parseMirrorBranchSha(runCommand('git', ['ls-remote', '--heads', 'mirror', ref], cwd), branch);
  if (sha === null) return null;

  runCommand('git', ['fetch', '--no-tags', 'mirror', ref], cwd);
  const fetchedSha = runCommand('git', ['rev-parse', '--verify', 'FETCH_HEAD'], cwd);
  if (fetchedSha !== sha) {
    throw new Error(`mirror branch ${branch} changed while it was being inspected; retry the E2E run`);
  }
  return sha;
}

export function assertMirrorBranchPushSafe({ sourceSha, remoteSha, branch, cwd = process.cwd() }) {
  if (!remoteSha || remoteSha === sourceSha) return;

  const sourceOnlyCount = Number(command('git', ['rev-list', '--count', `${remoteSha}..${sourceSha}`], cwd));
  const remoteOnlyCount = Number(command('git', ['rev-list', '--count', `${sourceSha}..${remoteSha}`], cwd));
  if (remoteOnlyCount === 0) return;
  if (sourceOnlyCount === 0) {
    throw new Error(`mirror branch ${branch} is ahead of the source commit; sync it before running mirror E2E`);
  }

  const remoteOnlyBaselineCommits = command(
    'git',
    ['log', '--format=%H%x09%s', `${sourceSha}..${remoteSha}`, '--', `${LINUX_BASELINE_PATH}/`],
    cwd
  )
    .split(/\r?\n/)
    .filter(Boolean);

  for (const commit of remoteOnlyBaselineCommits) {
    const [commitSha, subject] = commit.split('\t', 2);
    if (!commitSha || !subject) throw new Error('mirror returned an invalid baseline commit record');
    const commitAndParents = command('git', ['rev-list', '--parents', '-n', '1', commitSha], cwd).split(/\s+/);
    const [verifiedSha, parentSha] = commitAndParents;
    const diffArgs = parentSha
      ? ['diff-tree', '--no-commit-id', '--name-only', '-r', parentSha, verifiedSha]
      : ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', verifiedSha];
    const changedPaths = command('git', diffArgs, cwd).split(/\r?\n/).filter(Boolean);
    if (!changedPaths.some((file) => file.startsWith(`${LINUX_BASELINE_PATH}/`))) continue;
    if (subject !== LINUX_BASELINE_COMMIT_SUBJECT) {
      throw new Error(
        `mirror branch ${branch} contains Linux baseline file changes with an unrecognized commit; incorporate them before replacing the branch`
      );
    }
    if (commitAndParents.length !== 2) {
      throw new Error('mirror branch contains a Linux baseline promotion that is not a single-parent commit');
    }

    const commitMessage = command('git', ['show', '-s', '--format=%B', verifiedSha], cwd);
    const chatTrailers = parseCommitTrailerBlock(commitMessage)
      ?.filter((trailer) => trailer.key === 'Chat')
      .map((trailer) => trailer.value);
    const chatId = chatTrailers?.length === 1 ? chatTrailers[0] : '';

    if (!isNativeChatId(chatId)) {
      throw new Error('mirror branch contains a Linux baseline promotion with an invalid Chat trailer');
    }
    verifyBaselinePromotion({
      sourceSha: parentSha,
      remoteSha: verifiedSha,
      parents: commitAndParents.slice(1),
      commitSubject: subject,
      changedPaths,
      commitMessage,
      chatId,
    });
    throw new Error(
      `mirror branch ${branch} contains a Linux baseline promotion absent from this source commit; incorporate the promotion before rerunning`
    );
  }
}

export function buildMirrorPushArgs(sourceSha, branch, expectedRemoteSha) {
  if (expectedRemoteSha !== null && !GIT_SHA_PATTERN.test(expectedRemoteSha)) {
    throw new Error('expected mirror branch tip must be a full Git object ID or null');
  }
  const expected = expectedRemoteSha ?? '';
  return ['push', 'mirror', `--force-with-lease=refs/heads/${branch}:${expected}`, `${sourceSha}:refs/heads/${branch}`];
}

function parseCommitTrailerBlock(commitMessage) {
  const lines = commitMessage.replace(/\r\n?/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  let start = lines.length;
  while (start > 0 && lines[start - 1].trim() !== '') start -= 1;
  if (start === 0) return null;

  const trailers = [];
  for (const line of lines.slice(start)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]+(.+)$/.exec(line);
    if (!match) return null;
    trailers.push({ key: match[1], value: match[2] });
  }
  return trailers;
}

export function verifyBaselinePromotion({
  sourceSha,
  remoteSha,
  parents,
  commitSubject,
  changedPaths,
  commitMessage,
  chatId,
}) {
  if (remoteSha === sourceSha) return { changed: false, changedPaths: [] };
  if (!isNativeChatId(chatId)) throw new Error('mirror baseline commit must use a native Chat ID');
  if (!Array.isArray(parents) || parents.length !== 1) {
    throw new Error('mirror baseline commit must be a single-parent commit');
  }
  if (parents[0] !== sourceSha) throw new Error('mirror baseline commit is not a direct child of the tested commit');
  if (commitSubject !== LINUX_BASELINE_COMMIT_SUBJECT) {
    throw new Error('mirror baseline commit has an unrecognized subject');
  }
  if (!changedPaths.length || changedPaths.some((file) => !isLinuxBaselinePath(file))) {
    throw new Error('mirror baseline commit contains files outside the Linux export baseline allowlist');
  }
  const chatTrailers = parseCommitTrailerBlock(commitMessage)?.filter((trailer) => trailer.key === 'Chat') ?? [];
  if (chatTrailers.length !== 1 || chatTrailers[0].value !== chatId) {
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
    error.retryable = isRetryableCommandError(undefined, detail);
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
  if (!GIT_SHA_PATTERN.test(sourceSha)) throw new Error('could not resolve the source commit SHA');

  const fetchUrls = command('git', ['remote', 'get-url', '--all', 'mirror']).split(/\r?\n/);
  const pushUrls = command('git', ['remote', 'get-url', '--push', '--all', 'mirror']).split(/\r?\n/);
  assertMirrorRemoteUrls(fetchUrls, pushUrls);
  return { branch, sourceSha };
}

function assertMirrorWorkflowReady(mode) {
  const { file } = WORKFLOW[mode];
  command('git', ['fetch', '--no-tags', 'mirror', MAIN_REF]);
  const localSha = command('git', ['rev-parse', '--verify', `HEAD:.github/workflows/${file}`]);
  const mirrorSha = command('git', [
    'rev-parse',
    '--verify',
    `refs/remotes/mirror/${MAIN_REF}:.github/workflows/${file}`,
  ]);
  const mirrorMainSha = command('git', ['rev-parse', '--verify', `refs/remotes/mirror/${MAIN_REF}^{commit}`]);
  const state = command(
    'gh',
    ['api', `repos/${MIRROR_REPOSITORY}/actions/workflows/${file}`, '--jq', '.state'],
    process.cwd(),
    POLL_COMMAND_TIMEOUT_MS
  );
  assertMirrorWorkflowCurrent(file, localSha, mirrorSha, state);
  return mirrorMainSha;
}

async function discoverRun(mode, title, expectedWorkflowSha, deadline) {
  const workflowFile = WORKFLOW[mode].file;
  const event = 'repository_dispatch';
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
          'attempt,databaseId,displayTitle,event,headBranch,headSha,status,url',
        ],
        process.cwd(),
        POLL_COMMAND_TIMEOUT_MS
      );
      const run = findDispatchedRun(JSON.parse(output), title, event);
      if (run) {
        assertMirrorRunUsesWorkflowSha(run, expectedWorkflowSha);
        return run;
      }
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

async function waitForRun(run, title, mode, expectedWorkflowSha) {
  const timeoutMs = RUN_WAIT_TIMEOUT_MS_BY_MODE[mode] ?? RUN_WAIT_TIMEOUT_MS_BY_MODE.full;
  const deadline = Date.now() + timeoutMs;
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
          'attempt,conclusion,displayTitle,headBranch,headSha,status,url',
        ],
        process.cwd(),
        POLL_COMMAND_TIMEOUT_MS
      );
      const current = JSON.parse(output);
      if (current.displayTitle !== title || current.headBranch !== MAIN_REF) {
        throw new Error('located workflow run no longer matches the requested title and main workflow ref');
      }
      assertMirrorRunUsesWorkflowSha(current, expectedWorkflowSha);
      if (current.status === 'completed') return { ...current, databaseId: run.databaseId };
    } catch (error) {
      if (error.retryable !== true) throw error;
      lastTransientError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(
    `workflow run ${run.databaseId} exceeded the ${timeoutMs / 60_000} minute wait limit${
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

export function fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand = command }) {
  if (runCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) {
    throw new Error('local branch changed while the baseline workflow ran; leave the mirror commit for manual review');
  }
  if (runCommand('git', ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceSha) {
    throw new Error('local branch moved while the baseline workflow ran; leave the mirror commit for manual review');
  }
  if (runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('local worktree became dirty while the baseline workflow ran; do not fast-forward it');
  }

  runCommand('git', ['fetch', '--no-tags', 'mirror', `refs/heads/${branch}`]);
  const remoteSha = runCommand('git', ['rev-parse', 'FETCH_HEAD']);
  if (remoteSha === sourceSha) {
    console.log('Linux export baselines already match; no branch commit was created.');
    return;
  }

  const commitAndParents = runCommand('git', ['rev-list', '--parents', '-n', '1', remoteSha]).split(/\s+/);
  if (commitAndParents[0] !== remoteSha) throw new Error('mirror returned an invalid baseline commit ID');
  const commitSubject = runCommand('git', ['show', '-s', '--format=%s', remoteSha]);
  const changedPaths = runCommand('git', ['diff', '--name-only', `${sourceSha}..${remoteSha}`])
    .split('\n')
    .filter(Boolean);
  const commitMessage = runCommand('git', ['show', '-s', '--format=%B', remoteSha]);
  const result = verifyBaselinePromotion({
    sourceSha,
    remoteSha,
    parents: commitAndParents.slice(1),
    commitSubject,
    changedPaths,
    commitMessage,
    chatId,
  });
  if (result.changed) {
    if (runCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) {
      throw new Error(
        'local branch changed before the baseline fast-forward; leave the mirror commit for manual review'
      );
    }
    if (runCommand('git', ['rev-parse', '--verify', 'HEAD^{commit}']) !== sourceSha) {
      throw new Error('local branch moved before the baseline fast-forward; leave the mirror commit for manual review');
    }
    if (runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error(
        'local worktree became dirty before the baseline fast-forward; leave the mirror commit for manual review'
      );
    }
    runCommand('git', ['merge', '--ff-only', remoteSha]);
    console.log(`Fast-forwarded ${branch} with ${changedPaths.length} Linux baseline file(s).`);
  }
}

export async function runMirrorE2E(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { branch, sourceSha } = assertCleanTaskBranch();
  const expectedWorkflowSha = assertMirrorWorkflowReady(options.mode);
  const requestId = randomUUID().replaceAll('-', '');
  const title = expectedRunTitle(options.mode, requestId, sourceSha);

  const remoteSha = readMirrorBranchSha(branch);
  assertMirrorBranchPushSafe({ sourceSha, remoteSha, branch });
  command('git', buildMirrorPushArgs(sourceSha, branch, remoteSha));
  const dispatchArgs = buildDispatchArgs(options, { requestId, sourceSha, branch, workflowSha: expectedWorkflowSha });
  command('gh', dispatchArgs);
  console.log(`Waiting for ${title}`);

  let run;
  let finished;
  try {
    run = await discoverRun(options.mode, title, expectedWorkflowSha, Date.now() + DISCOVERY_TIMEOUT_MS);
    finished = await waitForRun(run, title, options.mode, expectedWorkflowSha);
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
