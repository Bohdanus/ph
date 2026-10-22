#!/usr/bin/env node
/**
 * Commit a reviewed main landing from a private index snapshot.
 *
 * Git rereads the index after `pre-commit` returns so hook edits can be included.
 * Using a private copy means a concurrent `git add` in the shared main checkout
 * cannot replace the reviewed tree between the final guard and commit creation.
 * The main checkout's own index remains untouched and is clean after a normal
 * landing because its prepared tree equals the committed tree.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isProjectMainWorktree } from './merge-takeover-guard.mjs';
import { readMergeHeadRefs, resolveWorktree } from './main-worktree-guard.mjs';

function git(args, { cwd = process.cwd(), env = process.env, input } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `git ${args.join(' ')} failed with status ${result.status}`);
  }
  return result.stdout.trim();
}

function hasRequiredTrailers(message, { cwd, env }) {
  const parsed = git(['interpret-trailers', '--parse'], { cwd, env, input: message });
  const trailers = parsed.split('\n').filter(Boolean);
  const values = new Map();
  for (const trailer of trailers) {
    const split = trailer.indexOf(':');
    if (split < 0) continue;
    const key = trailer.slice(0, split).trim().toLowerCase();
    const value = trailer.slice(split + 1).trim();
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  }
  return ['branch', 'chat'].every((key) => values.get(key)?.length === 1 && values.get(key)[0]);
}

function isReviewedLanding(commit, { cwd, env, expectedMain, expectedIncoming, expectedTree }) {
  const parents = git(['rev-list', '--parents', '-n', '1', commit], { cwd, env }).split(' ');
  const tree = git(['rev-parse', `${commit}^{tree}`], { cwd, env });
  return (
    parents.length === 3 && parents[1] === expectedMain && parents[2] === expectedIncoming && tree === expectedTree
  );
}

function findReviewedLanding({ cwd, env, expectedMain, expectedIncoming, expectedTree }) {
  const matches = (commit) => isReviewedLanding(commit, { cwd, env, expectedMain, expectedIncoming, expectedTree });
  const head = git(['rev-parse', 'HEAD'], { cwd, env });
  if (matches(head)) return head;

  try {
    const firstParentHistory = git(['rev-list', '--first-parent', `${expectedMain}..refs/heads/main`], { cwd, env });
    for (const commit of firstParentHistory.split('\n').filter(Boolean)) {
      if (matches(commit)) return commit;
    }
  } catch {
    // A concurrent non-fast-forward ref rewrite is outside the guarded landing flow. The
    // main reflog below can still prove that this exact commit was recorded.
  }
  try {
    const recentMainHistory = git(['reflog', 'show', '--format=%H', '-n', '64', 'refs/heads/main'], { cwd, env });
    for (const commit of recentMainHistory.split('\n').filter(Boolean)) {
      if (matches(commit)) return commit;
    }
  } catch {
    // Reflogs may be disabled; first-parent history is the normal verification path.
  }
  return null;
}

function fail(message) {
  process.stderr.write(`commit-reviewed-landing: ${message}\n`);
  process.exitCode = 1;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  if (argv.length !== 2 || !['-m', '--message'].includes(argv[0]) || !argv[1].trim()) {
    return fail(
      'usage: node scripts/commit-reviewed-landing.mjs -m "Merge <branch> into main\\n\\nBranch: <branch>\\nChat: <session-id>"'
    );
  }
  if (env.GIT_INDEX_FILE) return fail('run this command outside a Git hook and without GIT_INDEX_FILE set');
  if (!isProjectMainWorktree(cwd)) return fail('this command is only for the project main worktree');

  const expectedMain = env.KILO_EXPECTED_MAIN_SHA;
  const expectedIncoming = env.KILO_EXPECTED_INCOMING_SHA;
  const expectedTree = env.KILO_EXPECTED_TREE_SHA;
  if (!expectedMain || !expectedIncoming || !expectedTree) {
    return fail(
      'set KILO_EXPECTED_MAIN_SHA, KILO_EXPECTED_INCOMING_SHA, and KILO_EXPECTED_TREE_SHA from the reviewed candidate record'
    );
  }
  try {
    if (!hasRequiredTrailers(argv[1], { cwd, env })) {
      return fail('merge message must have exactly one non-empty Branch: and Chat: trailer');
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  let worktree;
  let indexSnapshotDir;
  try {
    worktree = resolveWorktree(cwd);
    if (!worktree?.isMainWorktree || !worktree.gitDir) throw new Error('cannot identify the main worktree index');

    const mergeHeads = readMergeHeadRefs(cwd);
    if (mergeHeads.length > 1) {
      throw new Error(
        `refusing an octopus merge with ${mergeHeads.length} incoming commits; prepare and review one candidate at a time`
      );
    }
    if (mergeHeads.length !== 1) throw new Error('no single prepared MERGE_HEAD is available for this landing');

    const head = git(['rev-parse', 'HEAD^{commit}'], { cwd, env });
    const incoming = git(['rev-parse', '--verify', `${mergeHeads[0]}^{commit}`], { cwd, env });
    const tree = git(['write-tree'], { cwd, env });
    if (head !== expectedMain) throw new Error('main moved since the candidate was reviewed');
    if (incoming !== expectedIncoming) throw new Error('incoming candidate changed since review');
    if (tree !== expectedTree) throw new Error('prepared merge tree changed since review');

    const sharedIndex = realpathSync(join(worktree.gitDir, 'index'));
    indexSnapshotDir = mkdtempSync(join(tmpdir(), 'ph-reviewed-landing-'));
    const indexSnapshot = join(indexSnapshotDir, 'index');
    copyFileSync(sharedIndex, indexSnapshot);

    const child = spawnSync('git', ['commit', ...argv], {
      cwd,
      env: { ...env, GIT_INDEX_FILE: indexSnapshot },
      stdio: 'inherit',
    });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      process.exitCode = child.status ?? 1;
      return;
    }

    if (!findReviewedLanding({ cwd, env, expectedMain, expectedIncoming, expectedTree })) {
      throw new Error(
        'Git committed, but the reviewed merge object could not be found in main history; inspect main before retrying'
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (indexSnapshotDir) rmSync(indexSnapshotDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
