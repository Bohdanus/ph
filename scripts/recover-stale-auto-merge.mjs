#!/usr/bin/env node
/**
 * Remove only a provably stale AUTO_MERGE marker from the current task worktree.
 * Git has no abort command for an orphan marker. This is deliberately narrower
 * than resetting or repairing a worktree: it never changes the index or files.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { samePath } from './lib/path-identity.mjs';

const USAGE = `Usage:
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> [--apply --confirm-owner-stopped]
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-matching-worktree
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-matching-worktree --expected-auto-merge-tree <full-sha> --expected-worktree-status-sha256 <sha256> --expected-worktree-content-sha256 <sha256> --apply --confirm-owner-stopped
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-divergent-worktree
  node scripts/recover-stale-auto-merge.mjs --expected-head <full-sha> --preserve-divergent-worktree --expected-auto-merge-tree <full-sha> --expected-worktree-status-sha256 <sha256> --expected-worktree-content-sha256 <sha256> --apply --confirm-owner-stopped

Default is a read-only preflight. Recovery only unlinks AUTO_MERGE when it is the
only operation marker, the worktree is clean and conflict-free, and its tree equals
HEAD^{tree}. Invoke this script from the current designated main checkout by absolute
path, while keeping the process working directory at the target worktree root; do not
run a package script from the target, which may execute stale recovery code. Apply only
after independently confirming the target's owner has stopped. Preserve modes permit dirty work only when the index matches HEAD and
the supplied HEAD, marker-tree, worktree-status, and worktree-content pins still
match. Matching mode also requires tracked files to equal AUTO_MERGE. Divergent mode
requires one unstaged tracked path to differ from both HEAD and AUTO_MERGE. Both
preserve modes create or verify a durable tree ref before removing AUTO_MERGE; neither
resets, stages, nor edits tracked or untracked files. Owner-stop, process, overlay,
and board checks remain manual and mandatory.
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

function autoMergeRecoveryRef(head, tree) {
  return `refs/recovery/auto-merge/${head}/${tree}`;
}

function readRefObjectId(root, ref) {
  const rows = git(['for-each-ref', '--format=%(refname)%09%(objectname)', ref], root)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const exact = rows.filter(([name]) => name === ref);
  if (exact.length > 1) throw new Error(`Recovery ref ${ref} is ambiguous.`);
  return exact[0]?.[1]?.toLowerCase() ?? null;
}

function ensureAutoMergeRecoveryRef(root, proof) {
  if (!proof.recoveryRef) return null;
  let created = false;
  let existing = readRefObjectId(root, proof.recoveryRef);
  if (existing && existing !== proof.autoMergeTree)
    throw new Error(
      `Recovery ref ${proof.recoveryRef} points to ${existing}, not AUTO_MERGE tree ${proof.autoMergeTree}.`
    );
  if (!existing) {
    try {
      git(['update-ref', proof.recoveryRef, proof.autoMergeTree, '0'.repeat(proof.autoMergeTree.length)], root);
      created = true;
    } catch (error) {
      // Another process may have installed the exact same anchor after preflight.
      // update-ref's zero old-value prevents replacing a different ref value.
      existing = readRefObjectId(root, proof.recoveryRef);
      if (existing !== proof.autoMergeTree) throw error;
    }
  }
  const recorded = readRefObjectId(root, proof.recoveryRef);
  if (recorded !== proof.autoMergeTree || git(['cat-file', '-t', recorded], root) !== 'tree')
    throw new Error(`Could not verify durable AUTO_MERGE tree ref ${proof.recoveryRef}.`);
  return { name: proof.recoveryRef, created };
}

function nulDelimitedPaths(buffer) {
  const paths = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0) continue;
    const pathBytes = buffer.subarray(start, index);
    start = index + 1;
    if (!pathBytes.length) continue;
    const path = pathBytes.toString('utf8');
    if (!Buffer.from(path, 'utf8').equals(pathBytes))
      throw new Error('Cannot pin preserved worktree content for a path with invalid UTF-8 encoding.');
    paths.push(path);
  }
  return paths;
}

function worktreeContentStateSha256(root) {
  const trackedPaths = nulDelimitedPaths(
    gitBuffer(['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--'], root)
  );
  const untrackedPaths = nulDelimitedPaths(gitBuffer(['ls-files', '--others', '--exclude-standard', '-z'], root));
  const paths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const hash = createHash('sha256');

  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath);
    const pathBytes = Buffer.from(relativePath, 'utf8');
    const pathLength = Buffer.alloc(4);
    pathLength.writeUInt32BE(pathBytes.length);
    hash.update(pathLength);
    hash.update(pathBytes);
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('missing\0');
      continue;
    }
    hash.update(`${(stat.mode & 0o7777).toString(8)}\0`);
    if (stat.isSymbolicLink()) {
      hash.update('symlink\0');
      hash.update(readlinkSync(absolutePath, { encoding: 'buffer' }));
      hash.update('\0');
    } else if (stat.isFile()) {
      hash.update('file\0');
      hash.update(hashFileContents(absolutePath));
      hash.update('\0');
    } else {
      throw new Error(`Cannot pin preserved worktree content for non-file path: ${relativePath}`);
    }
  }

  return hash.digest('hex');
}

function hashFileContents(path) {
  const fileHash = createHash('sha256');
  const chunk = Buffer.allocUnsafe(64 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    while (true) {
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      fileHash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return fileHash.digest();
}

function parseArgs(argv) {
  let expectedHead = null;
  let expectedAutoMergeTree = null;
  let expectedWorktreeStatusSha256 = null;
  let expectedWorktreeContentSha256 = null;
  let preserveMatchingWorktree = false;
  let preserveDivergentWorktree = false;
  let apply = false;
  let ownerStopped = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--expected-head' && argv[i + 1]) expectedHead = argv[++i];
    else if (argv[i] === '--expected-auto-merge-tree' && argv[i + 1]) expectedAutoMergeTree = argv[++i];
    else if (argv[i] === '--expected-worktree-status-sha256' && argv[i + 1]) expectedWorktreeStatusSha256 = argv[++i];
    else if (argv[i] === '--expected-worktree-content-sha256' && argv[i + 1]) expectedWorktreeContentSha256 = argv[++i];
    else if (argv[i] === '--preserve-matching-worktree') preserveMatchingWorktree = true;
    else if (argv[i] === '--preserve-divergent-worktree') preserveDivergentWorktree = true;
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
  if (expectedWorktreeContentSha256 && !/^[a-f\d]{64}$/i.test(expectedWorktreeContentSha256))
    throw new Error(`A full --expected-worktree-content-sha256 digest is required.\n${USAGE}`);
  if (preserveMatchingWorktree && preserveDivergentWorktree)
    throw new Error('Choose only one worktree preservation mode.\n');
  const preserveWorktree = preserveMatchingWorktree || preserveDivergentWorktree;
  if (!preserveWorktree && (expectedAutoMergeTree || expectedWorktreeStatusSha256 || expectedWorktreeContentSha256))
    throw new Error('Worktree pins require a worktree preservation mode.\n');
  if (
    preserveWorktree &&
    apply &&
    (!expectedAutoMergeTree || !expectedWorktreeStatusSha256 || !expectedWorktreeContentSha256)
  )
    throw new Error('--apply with a worktree preservation mode requires all three worktree pins.\n');
  if (apply && !ownerStopped) throw new Error('--apply requires --confirm-owner-stopped.\n');
  if (ownerStopped && !apply) throw new Error('--confirm-owner-stopped is only valid with --apply.\n');
  return {
    expectedHead: expectedHead.toLowerCase(),
    expectedAutoMergeTree: expectedAutoMergeTree?.toLowerCase() ?? null,
    expectedWorktreeStatusSha256: expectedWorktreeStatusSha256?.toLowerCase() ?? null,
    expectedWorktreeContentSha256: expectedWorktreeContentSha256?.toLowerCase() ?? null,
    preserveMatchingWorktree,
    preserveDivergentWorktree,
    apply,
    ownerStopped,
  };
}

function inspect(cwd, options) {
  const root = resolve(git(['rev-parse', '--show-toplevel'], cwd));
  if (git(['rev-parse', '--show-prefix'], cwd) !== '') throw new Error(`Run from the worktree root: ${root}`);
  if (!samePath(cwd, root)) throw new Error(`Run from the worktree root: ${root}`);
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

  let trackedDiffPaths = [];
  let worktreeContentSha256 = null;
  let recoveryRef = null;
  let recoveryRefExists = false;
  if (options.preserveMatchingWorktree || options.preserveDivergentWorktree) {
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
    trackedDiffPaths = nulDelimitedPaths(
      gitBuffer(
        ['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', autoMergeTree, '--'],
        root
      )
    );
    if (options.preserveMatchingWorktree && trackedDiffPaths.length)
      throw new Error(`Tracked worktree differs from AUTO_MERGE tree (${trackedDiffPaths.length} path(s)).`);
    if (options.preserveDivergentWorktree && !trackedDiffPaths.length)
      throw new Error('Divergent preserve mode requires tracked work that differs from AUTO_MERGE.');
    if (options.preserveDivergentWorktree) {
      const headDiffPaths = nulDelimitedPaths(
        gitBuffer(['diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--'], root)
      );
      const headDiffSet = new Set(headDiffPaths);
      const changedAgainstBoth = trackedDiffPaths.filter((path) => headDiffSet.has(path));
      if (!changedAgainstBoth.length)
        throw new Error(
          'Divergent preserve mode requires the same unstaged tracked path to differ from both HEAD and AUTO_MERGE.'
        );
    }
    worktreeContentSha256 = worktreeContentStateSha256(root);
    if (options.expectedWorktreeContentSha256 && worktreeContentSha256 !== options.expectedWorktreeContentSha256)
      throw new Error(
        `Worktree content changed: expected ${options.expectedWorktreeContentSha256}, found ${worktreeContentSha256}.`
      );
    recoveryRef = autoMergeRecoveryRef(head, autoMergeTree);
    const existingRecoveryRef = readRefObjectId(root, recoveryRef);
    if (existingRecoveryRef && existingRecoveryRef !== autoMergeTree)
      throw new Error(
        `Recovery ref ${recoveryRef} points to ${existingRecoveryRef}, not AUTO_MERGE tree ${autoMergeTree}.`
      );
    recoveryRefExists = existingRecoveryRef === autoMergeTree;
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
    worktreeContentSha256,
    recoveryRef,
    recoveryRefExists,
    preserveMatchingWorktree: options.preserveMatchingWorktree,
    preserveDivergentWorktree: options.preserveDivergentWorktree,
    trackedDiffCount: trackedDiffPaths.length,
  };
}

export function run(argv = process.argv.slice(2), cwd = process.cwd(), write = console.log) {
  try {
    const options = parseArgs(argv);
    let proof = inspect(cwd, options);
    if (!options.apply) {
      const kind = proof.preserveMatchingWorktree
        ? 'PRESERVING-WIP PREFLIGHT'
        : proof.preserveDivergentWorktree
          ? 'PRESERVING-DIVERGENT-WIP PREFLIGHT'
          : 'SAFE PREFLIGHT ONLY';
      const detail =
        proof.preserveMatchingWorktree || proof.preserveDivergentWorktree
          ? ` AUTO_MERGE tree=${proof.autoMergeTree} recovery-ref=${proof.recoveryRef} worktree-status-sha256=${proof.worktreeStatusSha256} worktree-content-sha256=${proof.worktreeContentSha256}${proof.preserveDivergentWorktree ? ` tracked-diff-paths=${proof.trackedDiffCount}` : ''}.`
          : ` AUTO_MERGE tree=${proof.autoMergeTree}.`;
      write(
        `${kind}: branch=${proof.branch} HEAD=${proof.head}.${detail}\n` +
          (proof.preserveMatchingWorktree || proof.preserveDivergentWorktree
            ? 'No files or refs changed. To apply, repeat with this exact --expected-head and all three worktree pins from this output, --apply, and --confirm-owner-stopped; recovery creates or verifies the durable tree ref, then removes only AUTO_MERGE.'
            : 'No files changed. After confirming the worktree owner has stopped, rerun with --apply --confirm-owner-stopped.')
      );
      return 0;
    }

    // Preserve the marker tree before unlinking it, then recheck every worktree
    // predicate and the marker identity immediately before the marker mutation.
    const initialProof = inspect(cwd, options);
    const recovery = ensureAutoMergeRecoveryRef(cwd, initialProof);
    proof = inspect(cwd, options);
    if (
      proof.markerDev !== initialProof.markerDev ||
      proof.markerIno !== initialProof.markerIno ||
      proof.autoMergeTree !== initialProof.autoMergeTree ||
      proof.head !== initialProof.head ||
      proof.worktreeStatusSha256 !== initialProof.worktreeStatusSha256 ||
      proof.worktreeContentSha256 !== initialProof.worktreeContentSha256 ||
      (recovery && readRefObjectId(cwd, recovery.name) !== proof.autoMergeTree)
    )
      throw new Error(
        'AUTO_MERGE, its durable tree ref, or the pinned worktree changed after preflight; refusing to remove the marker.'
      );
    const currentStat = lstatSync(proof.marker);
    if (
      !currentStat.isFile() ||
      currentStat.isSymbolicLink() ||
      currentStat.dev !== proof.markerDev ||
      currentStat.ino !== proof.markerIno
    )
      throw new Error('AUTO_MERGE changed after preflight; refusing to remove it.');
    const currentTree = readFileSync(proof.marker, 'utf8').trim().toLowerCase();
    if (currentTree !== proof.autoMergeTree)
      throw new Error('AUTO_MERGE changed after preflight; refusing to remove it.');
    unlinkSync(proof.marker);
    const headAfter = git(['rev-parse', '--verify', 'HEAD'], cwd).toLowerCase();
    const stagedAfter = gitBuffer(['diff', '--cached', '--name-only', '-z', 'HEAD', '--'], cwd);
    const statusAfter = statusSha256(cwd);
    const contentAfter =
      proof.preserveMatchingWorktree || proof.preserveDivergentWorktree ? worktreeContentStateSha256(cwd) : null;
    const recoveryRefAfter = recovery ? readRefObjectId(cwd, recovery.name) : null;
    if (
      headAfter !== proof.head ||
      stagedAfter.length ||
      statusAfter !== proof.worktreeStatusSha256 ||
      contentAfter !== proof.worktreeContentSha256 ||
      (recovery && recoveryRefAfter !== proof.autoMergeTree)
    )
      throw new Error(
        'AUTO_MERGE was removed, but the worktree changed concurrently; recovery did not edit files or the index.'
      );
    write(
      proof.preserveMatchingWorktree
        ? `Removed orphan AUTO_MERGE from ${proof.branch}; tracked work matched the marker; ${recovery.created ? 'created' : 'verified'} durable tree ref ${recovery.name}; HEAD, index, and worktree files were unchanged.`
        : proof.preserveDivergentWorktree
          ? `Removed orphan AUTO_MERGE from ${proof.branch}; divergent tracked work was preserved; ${recovery.created ? 'created' : 'verified'} durable tree ref ${recovery.name}; HEAD, index, and worktree files were unchanged.`
          : `Removed stale AUTO_MERGE from ${proof.branch}; HEAD and index were unchanged.`
    );
    return 0;
  } catch (error) {
    write(`Refusing stale AUTO_MERGE recovery: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run();
