#!/usr/bin/env node

/**
 * Validate the actual message Git is about to record for a pinned main landing.
 *
 * Git runs `prepare-commit-msg` after `pre-commit`, so the latter cannot prove
 * that the final Branch and Chat trailers still match the reviewed record.
 * This hook runs after message preparation and checks both the message file
 * and the pinned merge snapshot again.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hasChatTrailer, hasRequiredTrailers } from './commit-reviewed-landing.mjs';
import { assertExpectedLandingHeads, findTakeovers, isProjectMainWorktree } from './merge-takeover-guard.mjs';
import {
  isIsolatedIndex,
  isReviewedLandingSnapshot,
  readMergeHeadRefs,
  resolveWorktree,
} from './main-worktree-guard.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  process.stderr.write(`commit-reviewed-landing-message-guard: ${message}\n`);
  process.exitCode = 1;
}

function hasReviewedLandingContext(env) {
  return ['KILO_REVIEWED_LANDING_MARKER', 'KILO_REVIEWED_LANDING_TOKEN'].some((name) => Boolean(env[name]));
}

function hasExpectedLandingPins(env) {
  return [
    'KILO_EXPECTED_MAIN_SHA',
    'KILO_EXPECTED_INCOMING_SHA',
    'KILO_EXPECTED_TREE_SHA',
    'KILO_EXPECTED_BRANCH',
    'KILO_EXPECTED_CHAT_ID',
  ].some((name) => env[name] !== undefined);
}

function hasAutoMergeMarker(cwd) {
  const autoMergePath = git(['rev-parse', '--git-path', 'AUTO_MERGE'], cwd);
  return existsSync(resolve(cwd, autoMergePath));
}

function pendingMergeStatePath(cwd) {
  return resolve(cwd, git(['rev-parse', '--git-path', 'kilo-prepared-merge-state.json'], cwd));
}

function readPendingMergeState(cwd) {
  const path = pendingMergeStatePath(cwd);
  if (!existsSync(path)) return null;
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const isSha = (value) => typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value);
  if (!state || !isSha(state.head) || !isSha(state.headTree) || !isSha(state.incoming) || !isSha(state.resultTree)) {
    throw new Error('prepared merge state is invalid; inspect the worktree Git directory before committing');
  }
  if (state.phase !== undefined && !['prepared', 'markers-lost'].includes(state.phase)) {
    throw new Error('prepared merge state has an unknown phase; inspect the worktree Git directory before committing');
  }
  return state;
}

function clearPendingMergeState(cwd) {
  const path = pendingMergeStatePath(cwd);
  if (existsSync(path)) unlinkSync(path);
}

function discardAbandonedPreparedMerge(cwd) {
  const state = readPendingMergeState(cwd);
  if (!state) return;
  if (!['prepared', 'markers-lost'].includes(state.phase)) {
    throw new Error('only abandoned prepared merge state can be explicitly discarded');
  }
  if (readMergeHeadRefs(cwd).length !== 0 || hasAutoMergeMarker(cwd)) {
    throw new Error('merge markers are still present; resolve or abort the merge before discarding its state');
  }
  const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
  const resultTree = git(['write-tree'], cwd);
  const headTree = git(['rev-parse', 'HEAD^{tree}'], cwd);
  if (head !== state.head || resultTree !== headTree) {
    throw new Error('reset the index to the recorded HEAD before discarding abandoned prepared merge state');
  }
  clearPendingMergeState(cwd);
}

function writePendingMergeState(cwd, state) {
  const path = pendingMergeStatePath(cwd);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function recordPreparedMerge(cwd, phase = 'before') {
  const previousState = readPendingMergeState(cwd);
  const mergeHeads = readMergeHeadRefs(cwd);
  if (mergeHeads.length === 0) {
    if (!previousState) return;
    if (phase === 'after') {
      writePendingMergeState(cwd, { ...previousState, phase: 'markers-lost' });
      throw new Error('prepared merge markers disappeared during pre-commit; refusing to commit');
    }
    if (previousState.phase === 'markers-lost') {
      throw new Error(
        'prepared merge state records missing merge markers; after confirming the merge was abandoned and resetting the index to HEAD, run `node scripts/commit-reviewed-landing-message-guard.mjs --discard-abandoned-prepared-merge`'
      );
    }
    const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
    const resultTree = git(['write-tree'], cwd);
    const headTree = git(['rev-parse', 'HEAD^{tree}'], cwd);
    if (head === previousState.head && resultTree === previousState.headTree && !hasAutoMergeMarker(cwd)) {
      clearPendingMergeState(cwd);
      return;
    }
    throw new Error(
      'a previous prepared merge left unresolved state; abort or restore that merge before starting another commit'
    );
  }
  if (mergeHeads.length !== 1) {
    throw new Error('feature merge requires exactly one incoming commit; refusing an octopus merge');
  }
  const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
  const incoming = git(['rev-parse', '--verify', `${mergeHeads[0]}^{commit}`], cwd);
  if (previousState && (previousState.head !== head || previousState.incoming !== incoming)) {
    throw new Error(
      'prepared merge parents changed before pre-commit; refusing to record the merge. If the previous merge was abandoned, abort this merge, reset the index to the recorded HEAD, then run `node scripts/commit-reviewed-landing-message-guard.mjs --discard-abandoned-prepared-merge`'
    );
  }
  const resultTree = git(['write-tree'], cwd);
  writePendingMergeState(cwd, {
    head,
    headTree: git(['rev-parse', 'HEAD^{tree}'], cwd),
    incoming,
    resultTree,
    phase: 'prepared',
  });
}

function assertPendingMergeState(cwd, mergeHeads) {
  const state = readPendingMergeState(cwd);
  if (!state) return null;
  const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
  if (mergeHeads.length === 0) {
    throw new Error('prepared merge markers disappeared after pre-commit; refusing to record a feature merge');
  }
  if (mergeHeads.length !== 1) {
    throw new Error('feature merge requires exactly one incoming commit; refusing an octopus merge');
  }
  const resultTree = git(['write-tree'], cwd);
  const incoming = mergeHeads.length === 1 ? git(['rev-parse', '--verify', `${mergeHeads[0]}^{commit}`], cwd) : null;
  if (head !== state.head || incoming !== state.incoming || resultTree !== state.resultTree) {
    throw new Error('prepared merge parents or result tree changed after pre-commit; refusing to commit');
  }
  return state;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  try {
    if (
      argv[0] === '--record-prepared-merge' ||
      argv[0] === '--record-prepared-merge-before' ||
      argv[0] === '--record-prepared-merge-after'
    ) {
      if (argv.length !== 1) throw new Error('unexpected arguments for prepared merge state recording');
      const phase = argv[0] === '--record-prepared-merge-after' ? 'after' : 'before';
      recordPreparedMerge(cwd, phase);
      return;
    }
    if (argv[0] === '--discard-abandoned-prepared-merge') {
      if (argv.length !== 1) throw new Error('unexpected arguments for abandoned prepared merge cleanup');
      discardAbandonedPreparedMerge(cwd);
      return;
    }
    const reviewedLanding = hasReviewedLandingContext(env);
    const worktree = resolveWorktree(cwd);
    const projectMainWorktree = isProjectMainWorktree(cwd);
    const mergeHeads = readMergeHeadRefs(cwd);
    const pendingMergeState = assertPendingMergeState(cwd, mergeHeads);
    if (reviewedLanding && (!projectMainWorktree || !worktree?.isMainWorktree)) {
      throw new Error('reviewed landing checkout changed away from the designated main worktree');
    }
    if (!reviewedLanding) {
      if (argv.length !== 1 || !argv[0]) throw new Error('Git did not provide the prepared commit message file');
      const message = readFileSync(resolve(cwd, argv[0]), 'utf8');
      if (!hasChatTrailer(message, { cwd, env })) {
        if (
          projectMainWorktree &&
          worktree?.isMainWorktree &&
          mergeHeads.length === 0 &&
          env.ALLOW_MAIN_COMMIT === '1'
        ) {
          throw new Error('an operator hotfix on main must have exactly one non-empty Chat: trailer');
        }
        throw new Error('every commit must have exactly one non-empty Chat: trailer');
      }
      if (!projectMainWorktree) {
        const expectedPins = hasExpectedLandingPins(env);
        if (mergeHeads.length === 0) {
          if (expectedPins || hasAutoMergeMarker(cwd)) {
            throw new Error(
              `${expectedPins ? 'pinned ' : ''}feature merge MERGE_HEAD disappeared or changed; refusing to commit`
            );
          }
          return;
        }
        if (mergeHeads.length !== 1) {
          throw new Error('feature merge requires exactly one incoming commit; refusing an octopus merge');
        }
        const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
        const incoming = git(['rev-parse', '--verify', `${mergeHeads[0]}^{commit}`], cwd);
        const resultTree = git(['write-tree'], cwd);
        assertExpectedLandingHeads({ head, incoming, incomingCount: mergeHeads.length, resultTree }, env, {
          required: false,
          isolatedIndex: isIsolatedIndex(worktree, cwd, env),
          reviewedSnapshot: isReviewedLandingSnapshot(worktree, cwd, env),
          cwd,
        });
        if (!expectedPins) {
          const finalTakeovers = findTakeovers({ cwd, head, incoming, resultTree }).takeovers;
          if (finalTakeovers.length > 0) {
            const paths = finalTakeovers
              .slice(0, 20)
              .map(({ path, kind }) => `${JSON.stringify(path)} [${kind}]`)
              .join(', ');
            const remaining = finalTakeovers.length > 20 ? `, and ${finalTakeovers.length - 20} more` : '';
            throw new Error(
              `feature merge result fails the final takeover check after message preparation: ${finalTakeovers.length} path(s) would drop committed work (${paths}${remaining})`
            );
          }
        }
        if (
          expectedPins &&
          !hasRequiredTrailers(message, {
            cwd,
            env,
            expectedBranch: env.KILO_EXPECTED_BRANCH,
            expectedChat: env.KILO_EXPECTED_CHAT_ID,
          })
        ) {
          throw new Error(
            `Git's final feature merge message must have exactly one Branch: ${env.KILO_EXPECTED_BRANCH} and Chat: ${env.KILO_EXPECTED_CHAT_ID} trailer`
          );
        }
        if (pendingMergeState) clearPendingMergeState(cwd);
        return;
      }
      if (!worktree?.isMainWorktree) {
        throw new Error('designated main checkout must have refs/heads/main checked out before committing');
      }
      if (mergeHeads.length === 0) {
        if (hasAutoMergeMarker(cwd)) {
          throw new Error(
            'an operator hotfix on main cannot be committed while AUTO_MERGE remains; resolve or abort the interrupted merge first'
          );
        }
        return;
      }
    }
    if (reviewedLanding && mergeHeads.length !== 1) {
      throw new Error('reviewed landing MERGE_HEAD disappeared or changed; refusing to commit');
    }
    if (argv.length !== 1 || !argv[0]) throw new Error('Git did not provide the prepared commit message file');

    const head = git(['rev-parse', 'HEAD^{commit}'], cwd);
    const incoming = git(['rev-parse', '--verify', `${mergeHeads[0]}^{commit}`], cwd);
    const resultTree = git(['write-tree'], cwd);
    assertExpectedLandingHeads({ head, incoming, incomingCount: mergeHeads.length, resultTree }, env, {
      required: true,
      isolatedIndex: isIsolatedIndex(worktree, cwd, env),
      reviewedSnapshot: isReviewedLandingSnapshot(worktree, cwd, env),
      cwd,
    });

    const expectedBranch = env.KILO_EXPECTED_BRANCH;
    const expectedChat = env.KILO_EXPECTED_CHAT_ID;
    const messagePath = resolve(cwd, argv[0]);
    const message = readFileSync(messagePath, 'utf8');
    if (!hasRequiredTrailers(message, { cwd, env, expectedBranch, expectedChat })) {
      throw new Error(
        `Git's final merge message must have exactly one Branch: ${expectedBranch} and Chat: ${expectedChat} trailer`
      );
    }
    if (pendingMergeState) clearPendingMergeState(cwd);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
