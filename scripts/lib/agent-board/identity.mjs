/**
 * Who is running a command.
 *
 * The default identity is the git branch, not a session id, and that is a
 * deliberate choice about the unit of work rather than about the tooling. This
 * repository's own rule is one task, one worktree, one branch: a branch is
 * unique per task, it is the same string across every command the task runs,
 * and it survives the session, the agent and the machine. A process id changes
 * on every invocation, so it cannot answer "is this the same agent as last
 * time"; a Kilo run id is inherited by every subagent the session spawns, so
 * it cannot distinguish two agents working at once. The branch can do both.
 *
 * The Kilo run id is still recorded, on the `agents` row, because correlating a
 * board entry with a session transcript is useful even though it is not an
 * identity. `--agent` overrides everything for the cases where one task really
 * does drive two identities — a review that claims nothing, or an operator
 * filing an issue by hand.
 */

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function sanitize(value) {
  return value ? String(value).replace(/[^A-Za-z0-9._/@+-]/g, '_') : null;
}

export function resolveIdentity({ agent = null, cwd = process.cwd(), env = process.env } = {}) {
  const worktree = git(['rev-parse', '--show-toplevel'], cwd);
  let branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (branch === 'HEAD' || branch === null) {
    const sha = git(['rev-parse', '--short', 'HEAD'], cwd);
    branch = sha ? `detached@${sha}` : null;
  }
  const sessionId = env.KILO_RUN_ID ?? null;
  const agentId =
    sanitize(agent) ||
    (env.AGENT_BOARD_AGENT ? sanitize(env.AGENT_BOARD_AGENT) : null) ||
    (branch ? sanitize(branch) : null) ||
    (sessionId ? `session-${sanitize(sessionId).slice(0, 8)}` : `pid-${process.pid}`);
  return {
    agentId,
    kind: env.KILOCODE_VERSION ? 'kilo' : 'agent',
    worktree,
    branch,
    sessionId,
    pid: process.pid,
    meta: {
      host: hostname(),
      kiloVersion: env.KILOCODE_VERSION ?? null,
      platform: env.KILO_PLATFORM ?? null,
    },
  };
}
