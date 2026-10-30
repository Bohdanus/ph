#!/usr/bin/env node
/**
 * Remove only a provably stale AUTO_MERGE marker from the current task worktree.
 * Git has no abort command for an orphan marker. This is deliberately narrower
 * than resetting or repairing a worktree: it never changes the index or files.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const USAGE = `Usage:
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> [--apply --confirm-owner-stopped]

Default is a read-only preflight. Recovery only unlinks AUTO_MERGE when it is the
only operation marker, the worktree is clean and conflict-free, and its tree equals
HEAD^{tree}. Run from that worktree itself, after independently confirming its owner
has stopped. It refuses the main branch and never resets files or the index.
`;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function parseArgs(argv) {
  let expectedHead = null;
  let apply = false;
  let ownerStopped = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--expected-head' && argv[i + 1]) expectedHead = argv[++i];
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--confirm-owner-stopped') ownerStopped = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}\n${USAGE}`);
  }
  if (!expectedHead || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(expectedHead))
    throw new Error(`A full --expected-head object ID is required.\n${USAGE}`);
  if (apply && !ownerStopped) throw new Error('--apply requires --confirm-owner-stopped.\n');
  if (ownerStopped && !apply) throw new Error('--confirm-owner-stopped is only valid with --apply.\n');
  return { expectedHead: expectedHead.toLowerCase(), apply, ownerStopped };
}

function inspect(cwd, expectedHead) {
  const root = resolve(git(['rev-parse', '--show-toplevel'], cwd));
  if (resolve(cwd) !== root) throw new Error(`Run from the worktree root: ${root}`);
  const branch = git(['branch', '--show-current'], root);
  if (!branch) throw new Error('Refusing recovery from a detached or unborn HEAD.');
  if (branch === 'main') throw new Error('Refusing recovery on the main branch.');

  let head;
  try {
    head = git(['rev-parse', '--verify', 'HEAD'], root).toLowerCase();
  } catch {
    throw new Error('Refusing recovery from a detached or unborn HEAD.');
  }
  if (head !== expectedHead) throw new Error(`HEAD changed: expected ${expectedHead}, found ${head}.`);
  const gitDir = resolve(git(['rev-parse', '--absolute-git-dir'], root));
  const marker = join(gitDir, 'AUTO_MERGE');
  const markerStat = lstatSync(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('AUTO_MERGE is not a regular file.');

  // Be stricter than the operation inventory: companion files can remain after
  // their primary marker is lost, so any surviving operation state blocks recovery.
  const operationMarkers = [
    'MERGE_HEAD',
    'MERGE_MSG',
    'MERGE_MODE',
    'SQUASH_MSG',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'REBASE_HEAD',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
    'BISECT_LOG',
  ];
  const present = operationMarkers.filter((name) => {
    try {
      lstatSync(join(gitDir, name));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  });
  if (present.length) throw new Error(`Other Git operation markers remain: ${present.join(', ')}.`);

  const unmerged = git(['diff', '--name-only', '--diff-filter=U'], root);
  if (unmerged) throw new Error(`Index has unresolved paths:\n${unmerged}`);
  const status = git(['status', '--porcelain', '--untracked-files=all'], root);
  if (status) throw new Error(`Worktree is not clean:\n${status}`);

  const autoMergeTree = readFileSync(marker, 'utf8').trim().toLowerCase();
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(autoMergeTree))
    throw new Error('AUTO_MERGE does not contain a full object ID.');
  if (git(['cat-file', '-t', autoMergeTree], root) !== 'tree')
    throw new Error('AUTO_MERGE does not name an available tree object.');
  const headTree = git(['rev-parse', 'HEAD^{tree}'], root).toLowerCase();
  if (autoMergeTree !== headTree)
    throw new Error(`AUTO_MERGE tree differs from HEAD^{tree}: ${autoMergeTree} != ${headTree}.`);

  return { branch, head, headTree, marker, markerDev: markerStat.dev, markerIno: markerStat.ino, autoMergeTree };
}

export function run(argv = process.argv.slice(2), cwd = process.cwd(), write = console.log) {
  try {
    const options = parseArgs(argv);
    let proof = inspect(cwd, options.expectedHead);
    if (!options.apply) {
      write(
        `SAFE PREFLIGHT ONLY: branch=${proof.branch} HEAD=${proof.head} AUTO_MERGE tree=${proof.autoMergeTree}.\n` +
          'No files changed. After confirming the worktree owner has stopped, rerun with --apply --confirm-owner-stopped.'
      );
      return 0;
    }

    // Recheck every precondition immediately before the one permitted mutation.
    proof = inspect(cwd, options.expectedHead);
    const currentStat = lstatSync(proof.marker);
    const currentTree = readFileSync(proof.marker, 'utf8').trim().toLowerCase();
    const currentHeadTree = git(['rev-parse', 'HEAD^{tree}'], cwd).toLowerCase();
    if (
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      currentStat.dev !== proof.markerDev ||
      currentStat.ino !== proof.markerIno ||
      currentTree !== proof.autoMergeTree ||
      currentHeadTree !== currentTree
    )
      throw new Error('AUTO_MERGE changed after preflight; refusing to remove it.');
    unlinkSync(proof.marker);
    write(`Removed stale AUTO_MERGE from ${proof.branch}; HEAD and index were unchanged.`);
    return 0;
  } catch (error) {
    write(`Refusing stale AUTO_MERGE recovery: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
