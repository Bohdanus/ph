import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const MIRROR_E2E_PROOF_FILE = '.kilo/mirror-e2e-result.json';
export const MIRROR_E2E_PROOF_MAX_AGE_MS = 24 * 60 * 60_000;
export const MIRROR_REPOSITORY = 'Bohdanus/ph';

const FULL_WORKFLOW_PATH = '.github/workflows/ci.yml';
const SOURCE_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const REQUEST_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function writeMirrorE2EProof(proof, { cwd = process.cwd() } = {}) {
  validateProofShape(proof);
  const target = path.join(cwd, MIRROR_E2E_PROOF_FILE);
  const directory = path.dirname(target);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export function readMirrorE2EProof({ cwd = process.cwd() } = {}) {
  const target = path.join(cwd, MIRROR_E2E_PROOF_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(
      `A successful full mirror E2E proof is required at ${target}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  validateProofShape(parsed);
  return parsed;
}

export function validateMirrorE2EProof(
  proof,
  {
    expectedBranch,
    expectedSourceSha,
    expectedWorkflowBlobSha,
    run,
    mirrorWorkflowBlobSha,
    now = Date.now(),
    maxAgeMs = MIRROR_E2E_PROOF_MAX_AGE_MS,
  }
) {
  validateProofShape(proof);
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('GitHub mirror run details are missing');
  if (
    !SOURCE_SHA_PATTERN.test(expectedWorkflowBlobSha ?? '') ||
    !SOURCE_SHA_PATTERN.test(mirrorWorkflowBlobSha ?? '')
  ) {
    throw new Error('candidate and mirror workflow file blob SHAs are required');
  }
  if (proof.branch !== expectedBranch) throw new Error('mirror E2E proof belongs to a different candidate branch');
  if (proof.sourceSha !== expectedSourceSha)
    throw new Error('mirror E2E proof does not match the incoming candidate SHA');
  if (proof.sourceSha !== run.display_title?.split(' @ ').at(-1)) {
    throw new Error('mirror workflow title is not bound to the incoming candidate SHA');
  }
  if (String(run.id) !== proof.runId) throw new Error('mirror E2E proof run ID does not match GitHub Actions');
  if (run.event !== 'repository_dispatch' || run.path !== FULL_WORKFLOW_PATH) {
    throw new Error('mirror E2E proof is not from the full repository-dispatch workflow');
  }
  if (run.display_title !== `CI ${proof.requestId} @ ${proof.sourceSha}`) {
    throw new Error('mirror E2E workflow title does not match the full-run request and candidate SHA');
  }
  if (run.html_url !== proof.runUrl) throw new Error('mirror E2E proof URL does not match GitHub Actions');
  if (run.head_branch !== 'main' || run.head_sha !== proof.workflowSha) {
    throw new Error('mirror E2E proof used a different workflow revision or ref');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success' || run.run_attempt !== proof.attempt) {
    throw new Error('mirror E2E workflow attempt did not complete successfully');
  }
  if (mirrorWorkflowBlobSha !== expectedWorkflowBlobSha) {
    throw new Error('the tested mirror workflow file does not match the candidate workflow file');
  }

  const updatedAt = Date.parse(run.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 2 * 60_000 || now - updatedAt > maxAgeMs) {
    throw new Error('mirror E2E proof is stale or has an invalid completion time');
  }
  return { ...proof, verifiedAt: new Date(now).toISOString() };
}

function validateProofShape(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new Error('mirror E2E proof must be a JSON object');
  }
  if (proof.version !== 1 || proof.mode !== 'full')
    throw new Error('landing requires a version 1 full mirror E2E proof');
  if (typeof proof.branch !== 'string' || !proof.branch) throw new Error('mirror E2E proof is missing its branch');
  if (typeof proof.sourceSha !== 'string' || !SOURCE_SHA_PATTERN.test(proof.sourceSha)) {
    throw new Error('mirror E2E proof has an invalid candidate SHA');
  }
  if (typeof proof.workflowSha !== 'string' || !SOURCE_SHA_PATTERN.test(proof.workflowSha)) {
    throw new Error('mirror E2E proof has an invalid workflow SHA');
  }
  if (typeof proof.requestId !== 'string' || !REQUEST_ID_PATTERN.test(proof.requestId)) {
    throw new Error('mirror E2E proof has an invalid request ID');
  }
  if (typeof proof.runId !== 'string' || !/^\d+$/.test(proof.runId)) {
    throw new Error('mirror E2E proof has an invalid workflow run ID');
  }
  if (!Number.isSafeInteger(proof.attempt) || proof.attempt < 1) {
    throw new Error('mirror E2E proof has an invalid workflow attempt');
  }
  if (proof.conclusion !== 'success') throw new Error('mirror E2E proof is not successful');
  if (
    typeof proof.runUrl !== 'string' ||
    !proof.runUrl.startsWith(`https://github.com/${MIRROR_REPOSITORY}/actions/runs/`)
  ) {
    throw new Error('mirror E2E proof has an invalid GitHub workflow URL');
  }
  if (typeof proof.completedAt !== 'string' || !Number.isFinite(Date.parse(proof.completedAt))) {
    throw new Error('mirror E2E proof has an invalid completion time');
  }
}
