#!/usr/bin/env node
/**
 * Remove only a provably stale AUTO_MERGE marker from the current task worktree.
 * Git has no abort command for an orphan marker. This is deliberately narrower
 * than resetting or repairing a worktree: it never changes the index or files.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const USAGE = `Usage:
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> [--apply --confirm-owner-stopped]
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-matching-worktree
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-matching-worktree --expected-auto-merge-tree <full-sha> --expected-worktree-status-sha256 <sha256> --apply --confirm-owner-stopped

Default is a read-only preflight. Recovery only unlinks AUTO_MERGE when it is the
only operation marker, the worktree is clean and conflict-free, and its tree equals
HEAD^{tree}. Run from that worktree itself, after independently confirming its owner
has stopped. The opt-in preserve mode also permits a dirty worktree only when the
index matches HEAD, the tracked worktree exactly matches AUTO_MERGE, and the supplied
HEAD, marker-tree, and worktree-status pins still match. It unlinks only AUTO_MERGE;
it never resets, stages, or edits tracked or untracked files.
`;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitBuffer(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function statusSha256(root) {
  return createHash('sha256')
    .update(gitBuffer(['status', '--porcelain=v2', '-z', '--untracked-files=all'], root))
    .digest('hex');
}

function parseArgs(argv) {
  let expectedHead = null;
  let expectedAutoMergeTree = null;
  let expectedWorktreeStatusSha256 = null;
  let preserveMatchingWorktree = false;
  let apply = false;
  let ownerStopped = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--expected-head' && argv[i + 1]) expectedHead = argv[++i];
    else if (argv[i] === '--expected-auto-merge-tree' && argv[i + 1]) expectedAutoMergeTree = argv[++i];
    else if (argv[i] === '--expected-worktree-status-sha256' && argv[i + 1]) expectedWorktreeStatusSha256 = argv[++i];
    else if (argv[i] === '--preserve-matching-worktree') preserveMatchingWorktree = true;
    else if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--confirm-owner-stopped') ownerStopped = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}\n${USAGE}`);
  }
  if (!expectedHead || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(expectedHead))
    throw new Error(`A full --expected-head object ID is required.\n${USAGE}`);
  if (expectedAutoMergeTree && !/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(expectedAutoMergeTree))
    throw new Error(`A full --expected-auto-merge-tree object ID is required.\n${USAGE}`);
  if (expectedWorktreeStatusSha256 && !/^[a-f\d]{64}$/i.test(expectedWorktreeStatusSha256))
    throw new Error(`A full --expected-worktree-status-sha256 digest is required.\n${USAGE}`);
  if (!preserveMatchingWorktree && (expectedAutoMergeTree || expectedWorktreeStatusSha256))
    throw new Error('Worktree pins require --preserve-matching-worktree.\n');
  if (preserveMatchingWorktree && apply && (!expectedAutoMergeTree || !expectedWorktreeStatusSha256))
    throw new Error('--apply with --preserve-matching-worktree requires both worktree pins.\n');
  if (apply && !ownerStopped) throw new Error('--apply requires --confirm-owner-stopped.\n');
  if (ownerStopped && !apply) throw new Error('--confirm-owner-stopped is only valid with --apply.\n');
  return {
    expectedHead: expectedHead.toLowerCase(),
    expectedAutoMergeTree: expectedAutoMergeTree?.toLowerCase() ?? null,
    expectedWorktreeStatusSha256: expectedWorktreeStatusSha256?.toLowerCase() ?? null,
    preserveMatchingWorktree,
    apply,
    ownerStopped,
  };
}

function inspect(cwd, options) {
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
  if (head !== options.expectedHead) throw new Error(`HEAD changed: expected ${options.expectedHead}, found ${head}.`);
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

  const unmerged = gitBuffer(['diff', '--name-only', '-z', '--diff-filter=U'], root);
  if (unmerged.length)
    throw new Error(`Index has unresolved paths (${unmerged.toString('utf8').split('\0').filter(Boolean).length}).`);
  const status = gitBuffer(['status', '--porcelain=v2', '-z', '--untracked-files=all'], root);
  const worktreeStatusSha256 = createHash('sha256').update(status).digest('hex');

  const autoMergeTree = readFileSync(marker, 'utf8').trim().toLowerCase();
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(autoMergeTree))
    throw new Error('AUTO_MERGE does not contain a full object ID.');
  if (git(['cat-file', '-t', autoMergeTree], root) !== 'tree')
    throw new Error('AUTO_MERGE does not name an available tree object.');
  const headTree = git(['rev-parse', 'HEAD^{tree}'], root).toLowerCase();
  if (options.expectedAutoMergeTree && autoMergeTree !== options.expectedAutoMergeTree)
    throw new Error(`AUTO_MERGE tree changed: expected ${options.expectedAutoMergeTree}, found ${autoMergeTree}.`);
  if (options.expectedWorktreeStatusSha256 && worktreeStatusSha256 !== options.expectedWorktreeStatusSha256)
    throw new Error(
      `Worktree status changed: expected ${options.expectedWorktreeStatusSha256}, found ${worktreeStatusSha256}.`
    );

  if (options.preserveMatchingWorktree) {
    if (!status.length) throw new Error('Preserve mode requires dirty work that must remain in the worktree.');
    const staged = gitBuffer(['diff', '--cached', '--name-only', '-z', 'HEAD', '--'], root);
    if (staged.length)
      throw new Error(
        `Index has staged changes; preserve mode requires the index to match HEAD (${staged.toString('utf8').split('\0').filter(Boolean).length} path(s)).`
      );
    const flaggedIndexEntries = gitBuffer(['ls-files', '-v', '-z'], root)
      .toString('utf8')
      .split('\0')
      .filter((entry) => /^[a-z] /.test(entry) || entry.startsWith('S '));
    if (flaggedIndexEntries.length)
      throw new Error(
        'Index contains assume-unchanged or skip-worktree paths; tracked file comparison is not reliable.'
      );
    const trackedDiff = gitBuffer(
      ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', autoMergeTree, '--'],
      root
    );
    if (trackedDiff.length)
      throw new Error(
        `Tracked worktree differs from AUTO_MERGE tree (${trackedDiff.toString('utf8').split('\0').filter(Boolean).length} path(s)).`
      );
  } else {
    if (status.length) throw new Error('Worktree is not clean; preserve its changes before recovery.');
    if (autoMergeTree !== headTree)
      throw new Error(`AUTO_MERGE tree differs from HEAD^{tree}: ${autoMergeTree} != ${headTree}.`);
  }

  return {
    branch,
    head,
    headTree,
    marker,
    markerDev: markerStat.dev,
    markerIno: markerStat.ino,
    autoMergeTree,
    worktreeStatusSha256,
    preserveMatchingWorktree: options.preserveMatchingWorktree,
  };
}

export function run(argv = process.argv.slice(2), cwd = process.cwd(), write = console.log) {
  try {
    const options = parseArgs(argv);
    let proof = inspect(cwd, options);
    if (!options.apply) {
      const kind = proof.preserveMatchingWorktree ? 'PRESERVING-WIP PREFLIGHT' : 'SAFE PREFLIGHT ONLY';
      const detail = proof.preserveMatchingWorktree
        ? ` AUTO_MERGE tree=${proof.autoMergeTree} worktree-status-sha256=${proof.worktreeStatusSha256}.`
        : ` AUTO_MERGE tree=${proof.autoMergeTree}.`;
      write(
        `${kind}: branch=${proof.branch} HEAD=${proof.head}.${detail}\n` +
          (proof.preserveMatchingWorktree
            ? 'No files changed. To apply, repeat with --expected-auto-merge-tree and --expected-worktree-status-sha256 from this output, --apply, and --confirm-owner-stopped.'
            : 'No files changed. After confirming the worktree owner has stopped, rerun with --apply --confirm-owner-stopped.')
      );
      return 0;
    }

    // Recheck every precondition immediately before the one permitted mutation.
    proof = inspect(cwd, options);
    const currentStat = lstatSync(proof.marker);
    const currentTree = readFileSync(proof.marker, 'utf8').trim().toLowerCase();
    const currentHeadTree = git(['rev-parse', 'HEAD^{tree}'], cwd).toLowerCase();
    if (
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      currentStat.dev !== proof.markerDev ||
      currentStat.ino !== proof.markerIno ||
      currentTree !== proof.autoMergeTree ||
      (!proof.preserveMatchingWorktree && currentHeadTree !== currentTree) ||
      (proof.preserveMatchingWorktree &&
        (statusSha256(cwd) !== proof.worktreeStatusSha256 ||
          gitBuffer(['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', currentTree, '--'], cwd).length))
    )
      throw new Error('AUTO_MERGE changed after preflight; refusing to remove it.');
    unlinkSync(proof.marker);
    const headAfter = git(['rev-parse', '--verify', 'HEAD'], cwd).toLowerCase();
    const stagedAfter = gitBuffer(['diff', '--cached', '--name-only', '-z', 'HEAD', '--'], cwd);
    const statusAfter = statusSha256(cwd);
    if (headAfter !== proof.head || stagedAfter.length || statusAfter !== proof.worktreeStatusSha256)
      throw new Error(
        'AUTO_MERGE was removed, but the worktree changed concurrently; recovery did not edit files or the index.'
      );
    write(
      proof.preserveMatchingWorktree
        ? `Removed orphan AUTO_MERGE from ${proof.branch}; tracked work matched the marker; HEAD, index, and worktree status were unchanged.`
        : `Removed stale AUTO_MERGE from ${proof.branch}; HEAD and index were unchanged.`
    );
    return 0;
  } catch (error) {
    write(`Refusing stale AUTO_MERGE recovery: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
