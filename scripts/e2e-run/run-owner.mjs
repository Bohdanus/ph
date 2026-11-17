import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const BOARD_CLI = path.join(import.meta.dirname, '..', 'agent-board.mjs');

export const RUN_LOCK_RESOURCE = 'e2e/.swarm-e2e-runner';
export const RUN_LOCK_OWNER_ENV = 'E2E_RUN_LOCK_OWNER';

export function isGitHubHostedRunner(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted';
}

/** Verify that this Playwright process is the child of a wrapper holding the shared run lock. */
export function assertSerializedRunOwner({ env = process.env, parentPid = process.ppid, probe = defaultProbe } = {}) {
  if (isGitHubHostedRunner(env)) return;

  const owner = env[RUN_LOCK_OWNER_ENV] ?? '';
  const parts = owner.split('/');
  const ownerPid = Number(parts.at(-2));
  const nonce = parts.at(-1) ?? '';
  if (
    !owner.startsWith('e2e-run/') ||
    !Number.isInteger(ownerPid) ||
    ownerPid !== parentPid ||
    !/^[a-f\d]{32}$/i.test(nonce)
  ) {
    throw new Error(
      'Local Playwright runs must be started by npm run test:e2e; a raw invocation cannot prove it holds the shared E2E lock.'
    );
  }

  const observer = `e2e-run-lock-check/${process.pid}/${randomUUID().replaceAll('-', '')}`;
  const result = probe(observer, env);
  if (result.error || result.status !== 1) {
    throw new Error(
      `Cannot verify the shared E2E lock (board check exited ${result.status ?? 'with an error'}: ` +
        `${result.error?.message ?? result.stderr?.trim() ?? 'no lock holder was reported'}); refusing to run.`
    );
  }

  let holders;
  try {
    const report = JSON.parse(result.stdout ?? '');
    holders =
      report?.report?.find((entry) => entry.path === RUN_LOCK_RESOURCE)?.holders?.map((holder) => holder.agent_id) ??
      [];
  } catch (error) {
    throw new Error(
      `Cannot parse the shared E2E lock holder report (${error instanceof Error ? error.message : String(error)}); refusing to run.`
    );
  }

  if (!holders.includes(owner)) {
    throw new Error('The Playwright wrapper no longer owns the shared E2E lock; refusing to run concurrently.');
  }
}

function defaultProbe(observer, env) {
  return spawnSync(process.execPath, [BOARD_CLI, 'check', RUN_LOCK_RESOURCE, '--json', '--agent', observer], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}
