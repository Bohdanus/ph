import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
  assertMirrorBranchPushSafe,
  buildDispatchArgs,
  buildMirrorPushArgs,
  expectedRunTitle,
  assertMirrorRunUsesWorkflowSha,
  findDispatchedRun,
  assertMirrorRemote,
  assertMirrorRemoteUrls,
  assertMirrorWorkflowCurrent,
  fastForwardBaselineCommit,
  githubRepositoryFromRemote,
  isRetryableCommandError,
  MIRROR_PUSH_TIMEOUT_MS,
  parseArgs,
  parseMirrorBranchSha,
  readMirrorBranchSha,
  RUN_WAIT_TIMEOUT_MS_BY_MODE,
  LINUX_BASELINE_FILES,
  LINUX_BASELINE_PATH,
  verifyBaselinePromotion,
  pushMirrorBranch,
  runCommandWithTimeout,
} from '../mirror-e2e.mjs';
import { validateE2ESpec } from '../validate-e2e-spec.mjs';
import {
  MIRROR_E2E_PROOF_FILE,
  MIRROR_E2E_PROOF_MAX_AGE_MS,
  readMirrorE2EProof,
  validateMirrorE2EProof,
  writeMirrorE2EProof,
} from '../lib/mirror-e2e-proof.mjs';

function normalizeWorkflowText(text) {
  return text.replace(/\r\n?/g, '\n');
}

function readWorkflow(path) {
  return normalizeWorkflowText(readFileSync(path, 'utf8'));
}

const baselineWorkflow = readWorkflow(resolve(process.cwd(), '.github/workflows/capture-linux-baselines.yml'));
const platformBaselineWorkflow = readWorkflow(
  resolve(process.cwd(), '.github/workflows/capture-platform-export-baselines.yml')
);
const ciWorkflow = readWorkflow(resolve(process.cwd(), '.github/workflows/ci.yml'));
const focusedWorkflow = readWorkflow(resolve(process.cwd(), '.github/workflows/focused-e2e.yml'));
const workflowFiles = [
  ['capture-linux-baselines.yml', baselineWorkflow],
  ['capture-platform-export-baselines.yml', platformBaselineWorkflow],
  ['ci.yml', ciWorkflow],
  ['focused-e2e.yml', focusedWorkflow],
];

function mirrorProofFixture(now = Date.now()) {
  const proof = {
    version: 1,
    mode: 'full',
    branch: 'task/e2e-proof',
    sourceSha: 'a'.repeat(40),
    workflowSha: 'b'.repeat(40),
    requestId: 'c'.repeat(32),
    runId: '123456789',
    attempt: 1,
    conclusion: 'success',
    runUrl: 'https://github.com/Bohdanus/ph/actions/runs/123456789',
    completedAt: new Date(now - 1_000).toISOString(),
  };
  const run = {
    id: 123456789,
    path: '.github/workflows/ci.yml',
    event: 'repository_dispatch',
    display_title: `CI ${proof.requestId} @ ${proof.sourceSha}`,
    head_branch: 'main',
    head_sha: proof.workflowSha,
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    updated_at: new Date(now - 1_000).toISOString(),
    html_url: proof.runUrl,
  };
  return { proof, run, now };
}

describe('full mirror E2E landing proof', () => {
  it('writes and reads a machine-local proof manifest', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mirror-e2e-proof-'));
    const { proof } = mirrorProofFixture();
    try {
      const path = writeMirrorE2EProof(proof, { cwd });
      expect(path).toBe(join(cwd, MIRROR_E2E_PROOF_FILE));
      expect(readMirrorE2EProof({ cwd })).toEqual(proof);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('binds a fresh successful full workflow run to the exact candidate and workflow', () => {
    const { proof, run, now } = mirrorProofFixture();
    const verified = validateMirrorE2EProof(proof, {
      expectedBranch: proof.branch,
      expectedSourceSha: proof.sourceSha,
      expectedWorkflowBlobSha: 'd'.repeat(40),
      mirrorWorkflowBlobSha: 'd'.repeat(40),
      run,
      now,
    });

    expect(verified.verifiedAt).toBe(new Date(now).toISOString());
  });

  it('rejects wrong workflows, candidate SHAs, workflow blobs, and stale runs', () => {
    const { proof, run, now } = mirrorProofFixture();
    const pins = {
      expectedBranch: proof.branch,
      expectedSourceSha: proof.sourceSha,
      expectedWorkflowBlobSha: 'd'.repeat(40),
      mirrorWorkflowBlobSha: 'd'.repeat(40),
      now,
    };

    expect(() =>
      validateMirrorE2EProof(proof, { ...pins, run: { ...run, path: '.github/workflows/focused-e2e.yml' } })
    ).toThrow(/full repository-dispatch workflow/);
    expect(() => validateMirrorE2EProof(proof, { ...pins, expectedSourceSha: 'e'.repeat(40), run })).toThrow(
      /incoming candidate SHA/
    );
    expect(() => validateMirrorE2EProof(proof, { ...pins, mirrorWorkflowBlobSha: 'f'.repeat(40), run })).toThrow(
      /workflow file does not match/
    );
    expect(() =>
      validateMirrorE2EProof(proof, {
        ...pins,
        run: { ...run, updated_at: new Date(now - MIRROR_E2E_PROOF_MAX_AGE_MS - 1).toISOString() },
      })
    ).toThrow(/stale/);
  });
});

function runGit(cwd, args, input) {
  const commandArgs = basename(cwd) === 'mirror.git' ? ['-c', 'safe.bareRepository=all', ...args] : args;
  const result = spawnSync('git', commandArgs, { cwd, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function createMirrorPushFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mirror-e2e-push-'));
  const source = join(root, 'source');
  const mirror = join(root, 'mirror.git');
  const branch = 'feat/e2e-runner';

  runGit(root, ['init', '--quiet', '--bare', '--initial-branch=main', mirror]);
  runGit(root, ['init', '--quiet', `--initial-branch=${branch}`, source]);
  runGit(source, ['config', 'user.name', 'Mirror Push Fixture']);
  runGit(source, ['config', 'user.email', 'mirror-push-fixture@example.test']);
  writeFileSync(join(source, 'README.md'), 'mirror push fixture\n');
  runGit(source, ['add', 'README.md']);
  runGit(source, ['commit', '--quiet', '-m', 'fixture source']);
  runGit(source, ['remote', 'add', 'mirror', mirror]);

  return { root, source, mirror, branch, sourceSha: runGit(source, ['rev-parse', 'HEAD']) };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function createBaselinePromotion(fixture, chatId, subject = 'test: refresh Linux export baselines') {
  const baselineFile = join(fixture.source, LINUX_BASELINE_PATH, LINUX_BASELINE_FILES[0]);
  mkdirSync(dirname(baselineFile), { recursive: true });
  writeFileSync(baselineFile, 'captured baseline\n');
  runGit(fixture.source, ['add', LINUX_BASELINE_PATH]);
  runGit(fixture.source, ['commit', '--quiet', '-m', subject, '-m', `Chat: ${chatId}`]);
  const baselineSha = runGit(fixture.source, ['rev-parse', 'HEAD']);
  runGit(fixture.source, buildMirrorPushArgs(baselineSha, fixture.branch));
  return { baselineSha, remoteSha: readMirrorBranchSha(fixture.branch, fixture.source) };
}

vi.setConfig({ testTimeout: 30_000 });

describe('Linux baseline promotion workflow', () => {
  it('accepts capture requests only through the trusted default-branch repository dispatch', () => {
    expect(baselineWorkflow).toContain('repository_dispatch:');
    expect(baselineWorkflow).toContain('types: [capture-linux-baselines]');
    expect(baselineWorkflow).not.toContain('workflow_dispatch:');
    expect(baselineWorkflow).toContain('REF: ${{ github.ref }}');
    expect(baselineWorkflow).toContain(
      'EXPECTED_WORKFLOW_SHA: ${{ github.event.client_payload.expected_workflow_sha }}'
    );
    expect(baselineWorkflow).toContain('[[ "$REF" == "refs/heads/main" ]]');
    expect(baselineWorkflow).toContain('[[ "$WORKFLOW_SHA" == "$EXPECTED_WORKFLOW_SHA" ]]');
    expect(baselineWorkflow).toContain('PROMOTE_JSON: ${{ toJSON(github.event.client_payload.promote) }}');
    expect(baselineWorkflow).toContain('[[ "$PROMOTE_JSON" == "true" || "$PROMOTE_JSON" == "false" ]]');
    expect(baselineWorkflow).toContain("if: ${{ toJSON(github.event.client_payload.promote) == 'true' }}");
  });

  it('keeps every manually dispatched mirror workflow on trusted default-branch code', () => {
    for (const [workflow, eventType] of [
      [ciWorkflow, 'mirror-e2e-full'],
      [focusedWorkflow, 'mirror-e2e-focused'],
      [baselineWorkflow, 'capture-linux-baselines'],
    ]) {
      expect(workflow).toContain('repository_dispatch:');
      expect(workflow).toContain(`types: [${eventType}]`);
      expect(workflow).not.toContain('workflow_dispatch:');
      expect(workflow).toContain('EXPECTED_WORKFLOW_SHA: ${{ github.event.client_payload.expected_workflow_sha }}');
      expect(workflow).toContain('[[ "$WORKFLOW_SHA" == "$EXPECTED_WORKFLOW_SHA" ]]');
      expect(workflow).toContain('[[ "$REF" == "refs/heads/main" ]]');
    }
    expect(focusedWorkflow).toContain(
      '[[ "$PLATFORM" == "linux" || "$PLATFORM" == "windows" || "$PLATFORM" == "macos" ]]'
    );
  });

  it('attributes the generated commit to the native chat and pushes the tested branch tip', () => {
    const captureValidationStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Validate trusted workflow revision and capture target'),
      baselineWorkflow.indexOf('      - name: Checkout exact source commit')
    );
    const promotionValidationStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Validate branch, source SHA and chat ID'),
      baselineWorkflow.indexOf('      - name: Download captured Linux baselines')
    );
    const stagingStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Validate and stage baseline allowlist'),
      baselineWorkflow.indexOf('      - name: Commit and push baseline changes')
    );
    const promotionStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Commit and push baseline changes')
    );
    const nativeChatGuard =
      '[[ "$CHAT_ID" =~ ^(ses_[A-Za-z0-9]{26}|[[:xdigit:]]{8}-[[:xdigit:]]{4}-[1-8][[:xdigit:]]{3}-[89aAbB][[:xdigit:]]{3}-[[:xdigit:]]{12}|copilotcli:/[[:xdigit:]]{8}-[[:xdigit:]]{4}-[1-8][[:xdigit:]]{3}-[89aAbB][[:xdigit:]]{3}-[[:xdigit:]]{12})$ ]] || { echo "::error::A valid Kilo ID, Codex UUID, or Copilot session URI is required"; exit 1; }';

    for (const validationStep of [captureValidationStep, promotionValidationStep]) {
      expect(validationStep).toContain('CHAT_ID: ${{ github.event.client_payload.chat_id }}');
      const guards = validationStep
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('[[ "$CHAT_ID" =~'));
      expect(guards).toEqual([nativeChatGuard]);
    }
    const stagedFiles = /expected=\(([^)]*)\)/.exec(stagingStep)?.[1].trim().split(/\s+/).sort();
    expect(stagedFiles).toEqual([
      'drawing.avif.png',
      'drawing.bmp.png',
      'drawing.gif.png',
      'drawing.jpeg.png',
      'drawing.png.png',
      'drawing.svg.png',
      'drawing.webp.png',
    ]);
    expect(stagingStep).toContain('for name in "${expected[@]}"; do');
    expect(
      stagingStep
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('git add '))
    ).toEqual(['git add -- "$target"']);
    expect(promotionStep).toContain('SOURCE_SHA: ${{ github.event.client_payload.source_sha }}');
    expect(promotionStep).toContain('CHAT_ID: ${{ github.event.client_payload.chat_id }}');
    expect(promotionStep).toContain('git push origin "HEAD:refs/heads/$SOURCE_BRANCH"');
    expect(promotionStep).not.toContain('--force');
    expect(promotionStep).toContain('if [[ "$CHAT_ID" == copilotcli:/* ]]');
    expect(promotionStep).toContain('COMMIT_TRAILERS=$(printf');
    expect(promotionStep).toContain('Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
    expect(promotionStep).toContain('COMMIT_TRAILERS="Chat: $CHAT_ID"');
    expect(promotionStep).toContain(`commit -m 'test: refresh Linux export baselines' -m "$COMMIT_TRAILERS"`);
    expect(stagingStep).toContain('git check-attr text eol filter ident working-tree-encoding -- "$target"');
    expect(stagingStep).toContain(': ident: unspecified');
  });

  it('waits beyond both Linux baseline job limits with queue margin', () => {
    expect(RUN_WAIT_TIMEOUT_MS_BY_MODE.baselines).toBeGreaterThanOrEqual((55 + 10 + 20) * 60_000);
  });
});

describe('cross-platform baseline artifact workflow', () => {
  it('normalizes Windows CRLF checkouts before inspecting workflow sections', () => {
    const workflowDirectory = mkdtempSync(join(tmpdir(), 'mirror-e2e-workflows-'));
    try {
      const windowsWorkflows = new Map();
      for (const [filename, workflow] of workflowFiles) {
        const workflowPath = join(workflowDirectory, filename);
        writeFileSync(workflowPath, workflow.replace(/\n/g, '\r\n'));
        const windowsWorkflow = readWorkflow(workflowPath);
        expect(windowsWorkflow, `${filename} should preserve its contents after newline normalization`).toBe(workflow);
        windowsWorkflows.set(filename, windowsWorkflow);
      }
      const windowsWorkflow = windowsWorkflows.get('capture-platform-export-baselines.yml');
      const concurrencyIndex = windowsWorkflow.indexOf('\n\nconcurrency:');
      const captureIndex = windowsWorkflow.indexOf('  capture:\n');
      expect(concurrencyIndex).toBeGreaterThan(0);
      expect(captureIndex).toBeGreaterThan(0);
      const triggerSection = windowsWorkflow.slice(0, concurrencyIndex);
      expect(triggerSection.match(/^  [a-z_-]+:/gm)).toEqual(['  workflow_dispatch:']);
      expect(windowsWorkflow.slice(captureIndex)).toContain('fromJSON(needs.validate.outputs.platforms)');
    } finally {
      rmSync(workflowDirectory, { recursive: true, force: true });
    }
  });

  it('restricts manual captures to the compute mirror trusted main revision', () => {
    const triggerSection = platformBaselineWorkflow.slice(0, platformBaselineWorkflow.indexOf('\n\nconcurrency:'));
    expect(triggerSection.match(/^  [a-z_-]+:/gm)).toEqual(['  workflow_dispatch:']);
    expect(platformBaselineWorkflow).toContain('required: true\n        type: choice');
    expect(platformBaselineWorkflow).toContain("required: false\n        type: string\n        default: ''");
    expect(platformBaselineWorkflow).toContain('default: all');
    expect(platformBaselineWorkflow).toContain(
      'options:\n          - all\n          - linux\n          - windows\n          - macos'
    );
    expect(platformBaselineWorkflow).toContain('inputs.platform');
    expect(platformBaselineWorkflow).toContain('concurrency:');
    expect(platformBaselineWorkflow).toContain('group: export-baselines-${{ github.ref }}-${{ inputs.platform }}');
    expect(platformBaselineWorkflow).toContain('cancel-in-progress: false');
    expect(platformBaselineWorkflow).toContain('source_sha:');
    expect(platformBaselineWorkflow).toContain('SOURCE_SHA_INPUT: ${{ inputs.source_sha }}');
    expect(platformBaselineWorkflow).toContain('source_sha="${SOURCE_SHA_INPUT:-$WORKFLOW_SHA}"');
    expect(platformBaselineWorkflow).toContain('^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$');
    expect(platformBaselineWorkflow).toContain('printf \'source_sha=%s\\n\' "$source_sha" >> "$GITHUB_OUTPUT"');
    expect(platformBaselineWorkflow).toContain('source_sha: ${{ steps.validate-target.outputs.source_sha }}');
    expect(platformBaselineWorkflow).toContain('platforms: ${{ steps.validate-target.outputs.platforms }}');
    expect(platformBaselineWorkflow).toContain('fromJSON(needs.validate.outputs.platforms)');
    expect(platformBaselineWorkflow).toContain('all) platforms=\'["linux","windows","macos"]\'');
    expect(platformBaselineWorkflow).toContain('linux) platforms=\'["linux"]\'');
    expect(platformBaselineWorkflow).toContain('windows) platforms=\'["windows"]\'');
    expect(platformBaselineWorkflow).toContain('macos) platforms=\'["macos"]\'');
    expect(platformBaselineWorkflow).toContain('REF: ${{ github.ref }}');
    expect(platformBaselineWorkflow).toContain('REPOSITORY: ${{ github.repository }}');
    expect(platformBaselineWorkflow).toContain('"${REPOSITORY,,}" == "bohdanus/ph"');
    expect(platformBaselineWorkflow).toContain('"$REF" == "refs/heads/main"');
    expect(platformBaselineWorkflow).toContain('needs: validate');
    expect(platformBaselineWorkflow).toContain('ref: ${{ needs.validate.outputs.source_sha }}');
    expect(platformBaselineWorkflow).toContain('persist-credentials: false');
    expect(platformBaselineWorkflow).toContain('permissions:\n  contents: read');
    expect(platformBaselineWorkflow).not.toMatch(/contents:\s*write/i);
  });

  it('captures, verifies, validates and uploads exact OS-specific PNG sets without promotion', () => {
    const captureJob = platformBaselineWorkflow.slice(platformBaselineWorkflow.indexOf('  capture:\n'));
    const actionPins = [...captureJob.matchAll(/^\s+uses:\s*[^@\s]+@([^\s#]+).*$/gm)].map((match) => match[1]);
    const stepNames = [...captureJob.matchAll(/^\s+- name: ([^\r\n]+)$/gm)].map((match) => match[1]);

    expect(captureJob).toContain('fromJSON(needs.validate.outputs.platforms)');
    expect(stepNames).toEqual([
      'Checkout exact source commit',
      'Setup Node',
      'Install dependencies',
      'Install Chrome',
      'Record export baselines',
      'Verify recorded baselines',
      'Validate exact platform baseline set',
      'Upload export baseline artifact',
      'Upload Playwright diagnostics',
    ]);
    expect(captureJob).toContain('persist-credentials: false');
    expect(captureJob).toContain("node-version-file: '.nvmrc'");
    expect(captureJob).toContain("cache: 'npm'");
    expect(captureJob).toContain(
      "runs-on: ${{ matrix.platform == 'linux' && 'ubuntu-latest' || matrix.platform == 'windows' && 'windows-latest' || 'macos-latest' }}"
    );
    expect(captureJob).toContain("matrix.platform == 'windows' && 'win32'");
    expect(captureJob).toContain("matrix.platform == 'macos' && 'darwin'");
    expect(captureJob).toContain(
      "run: ${{ matrix.platform == 'linux' && 'npx playwright install --with-deps chrome' || 'npx playwright install chrome' }}"
    );
    const snapshotPlatformExpression =
      "${{ matrix.platform == 'windows' && 'win32' || matrix.platform == 'macos' && 'darwin' || 'linux' }}";
    expect(captureJob).toContain(`SNAPSHOT_PLATFORM: ${snapshotPlatformExpression}`);
    expect(captureJob).toContain(
      `path: e2e/export/visual-regression.spec.ts-snapshots/export-baselines/${snapshotPlatformExpression}/`
    );

    const capture = captureJob.indexOf('run: npm run test:e2e:update-baselines -- --workers=1');
    const verify = captureJob.indexOf('run: npm run test:e2e -- e2e/export/visual-regression.spec.ts --workers=1');
    const validate = captureJob.indexOf('- name: Validate exact platform baseline set');
    const upload = captureJob.indexOf('- name: Upload export baseline artifact');
    expect(capture).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(capture);
    expect(validate).toBeGreaterThan(verify);
    expect(upload).toBeGreaterThan(validate);
    expect(captureJob).toContain(
      'name: ${{ matrix.platform }}-export-baselines-source-${{ needs.validate.outputs.source_sha }}-workflow-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}'
    );
    expect(captureJob).toContain(
      'name: ${{ matrix.platform }}-baseline-diagnostics-source-${{ needs.validate.outputs.source_sha }}-workflow-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}'
    );
    const baselineUploadStart = captureJob.indexOf('- name: Upload export baseline artifact');
    const diagnosticsUploadStart = captureJob.indexOf('- name: Upload Playwright diagnostics');
    const baselineUpload = captureJob.slice(baselineUploadStart, diagnosticsUploadStart);
    const diagnosticsUpload = captureJob.slice(diagnosticsUploadStart);
    for (const upload of [baselineUpload, diagnosticsUpload]) expect(upload).toContain('retention-days: 7');
    expect(baselineUpload).toContain('if-no-files-found: error');
    expect(diagnosticsUpload).toContain('if-no-files-found: warn');
    const expectedFiles = /const expected = \[([\s\S]*?)\]\.sort\(\);/.exec(captureJob)?.[1];
    expect(expectedFiles).toBeDefined();
    expect(
      expectedFiles
        ?.split(/\r?\n/)
        .map((line) => line.trim().replace(/,$/, '').replace(/^'|'$/g, ''))
        .filter(Boolean)
    ).toEqual([
      'drawing.avif.png',
      'drawing.bmp.png',
      'drawing.gif.png',
      'drawing.jpeg.png',
      'drawing.png.png',
      'drawing.svg.png',
      'drawing.webp.png',
    ]);
    expect(captureJob).toContain('for (const name of expected)');
    expect(captureJob).toContain("signature !== '89504e470d0a1a0a'");
    expect(actionPins).toHaveLength(4);
    expect(actionPins.every((pin) => /^[a-f0-9]{40}$/.test(pin))).toBe(true);
    expect(platformBaselineWorkflow).not.toMatch(/\bgit\s+(?:commit|push)\b|contents:\s*write/i);
    expect(platformBaselineWorkflow).not.toContain('promote:');
  });
});

describe('mirror E2E command parsing', () => {
  it('accepts one focused spec and defaults to Linux', () => {
    expect(parseArgs(['--spec', 'e2e/export/visual-regression.spec.ts'])).toMatchObject({
      mode: 'focused',
      spec: 'e2e/export/visual-regression.spec.ts',
      platform: 'linux',
    });
  });

  it('accepts full runs and baseline promotion with native chat attribution', () => {
    expect(parseArgs(['--full'])).toMatchObject({ mode: 'full' });
    expect(parseArgs(['--linux-baselines', '--chat-id', 'ses_0123456789ABCDEF0123456789'])).toMatchObject({
      mode: 'baselines',
      chatId: 'ses_0123456789ABCDEF0123456789',
    });
    expect(parseArgs(['--linux-baselines', '--chat-id', '01234567-89ab-4def-8123-456789abcdef'])).toMatchObject({
      mode: 'baselines',
      chatId: '01234567-89ab-4def-8123-456789abcdef',
    });
    expect(
      parseArgs(['--linux-baselines', '--chat-id', 'copilotcli:/01234567-89ab-4def-8123-456789abcdef'])
    ).toMatchObject({
      mode: 'baselines',
      chatId: 'copilotcli:/01234567-89ab-4def-8123-456789abcdef',
    });
    expect(
      parseArgs(['--linux-baselines', '--chat-id', 'copilotcli:/7befb061-b313-497b-8694-97929d9054e4'])
    ).toMatchObject({
      mode: 'baselines',
      chatId: 'copilotcli:/7befb061-b313-497b-8694-97929d9054e4',
    });
  });

  it.each(
    [
      [],
      ['--full', '--linux-baselines', '--chat-id', 'ses_1'],
      ['--spec', 'e2e/levels.spec.ts', '--platform', 'darwin'],
      ['--full', '--chat-id', 'ses_1'],
      ['--linux-baselines'],
      ['--linux-baselines', '--chat-id', '   '],
      ['--linux-baselines', '--chat-id', '\tses_1'],
      ['--linux-baselines', '--chat-id', 'ses id'],
      ['--linux-baselines', '--chat-id', 'bad\nChat: injected'],
      ['--linux-baselines', '--chat-id', 'ses_1@other'],
      ['--linux-baselines', '--chat-id', 'ses_nativeSession123'],
      ['--linux-baselines', '--chat-id', 'not-native-session'],
      ['--linux-baselines', '--chat-id', `ses_${'a'.repeat(26)}\n`],
      ['--linux-baselines', '--chat-id', 'ses_id-with-dashes'],
      ['--linux-baselines', '--chat-id', 'copilotcli:/not-a-uuid'],
      ['--linux-baselines', '--chat-id', '01234567-89ab-cdef-8123-456789abcdef'],
      ['--linux-baselines', '--chat-id', '01234567-89ab-4def-0123-456789abcdef'],
      ['--linux-baselines', '--chat-id', '01234567-89ab-4def-8123-456789abcdef\r'],
      ['--linux-baselines', '--chat-id', 'copilotcli:/01234567-89ab-4def-0123-456789abcdef'],
      ['--linux-baselines', '--chat-id', 'copilotcli:01234567-89ab-4def-8123-456789abcdef'],
      ['--linux-baselines', '--chat-id', `copilotcli:/01234567-89ab-4def-8123-456789abcdef\n`],
    ].map((args) => [args])
  )('rejects invalid invocation %j', (args) => {
    expect(() => parseArgs(args)).toThrow();
  });
});

describe('mirror E2E push timeout', () => {
  it('passes the full pre-push gate budget to Git when pushing a tested branch', () => {
    const sourceSha = 'c'.repeat(40);
    const runCommand = vi.fn();
    pushMirrorBranch(sourceSha, 'feat/e2e-runner', { cwd: '/repo', runCommand });

    expect(runCommand).toHaveBeenCalledWith(
      'git',
      ['push', 'mirror', `${sourceSha}:refs/heads/feat/e2e-runner`],
      '/repo',
      MIRROR_PUSH_TIMEOUT_MS
    );
    expect(MIRROR_PUSH_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it('kills the command process tree when the timeout expires', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mirror-e2e-timeout-'));
    const childPidFile = join(root, 'child-pid');
    const script = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'writeFileSync(process.argv[1], String(child.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n');

    try {
      await expect(
        runCommandWithTimeout(process.execPath, ['-e', script, childPidFile], root, 750)
      ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      const childPid = Number(readFileSync(childPidFile, 'utf8'));
      const deadline = Date.now() + 5_000;
      while (isProcessAlive(childPid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(isProcessAlive(childPid)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('mirror remote and dispatch selection', () => {
  it.each([
    'git@github.com:Bohdanus/ph.git',
    'ssh://git@github.com/Bohdanus/ph.git',
    'https://github.com/Bohdanus/ph',
    'https://github.com/Bohdanus/ph.git',
    'https://user:secret-token@github.com/Bohdanus/ph.git',
    'https://secret-token:x-oauth-basic@github.com/Bohdanus/ph.git',
  ])('classifies mirror URL credentials for %s', (remote) => {
    const parsed = URL.canParse(remote) ? new URL(remote) : null;
    const expected = parsed?.protocol === 'https:' && (parsed.username || parsed.password) ? null : 'bohdanus/ph';
    expect(githubRepositoryFromRemote(remote)).toBe(expected);
  });

  it.each(['git@github.com:Bohdanus/other.git', 'https://example.com/Bohdanus/ph.git', '/tmp/ph'])(
    'does not mistake %s for the mirror',
    (remote) => expect(githubRepositoryFromRemote(remote)).not.toBe('bohdanus/ph')
  );

  it('does not include credentials in a rejected mirror URL error', () => {
    const remote = 'https://user:secret-token@github.com/other/repo.git';
    let error;
    try {
      assertMirrorRemote(remote);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('secret-token');
    expect(error.message).toContain('Bohdanus/ph');
  });

  it('rejects HTTPS remotes with embedded credentials', () => {
    expect(githubRepositoryFromRemote('https://user:secret@github.com/Bohdanus/ph.git')).toBeNull();
  });

  it('validates every fetch and push URL for the mirror remote', () => {
    const mirrorUrl = 'git@github.com:Bohdanus/ph.git';

    expect(() => assertMirrorRemoteUrls([mirrorUrl, mirrorUrl], [mirrorUrl])).not.toThrow();
    expect(() => assertMirrorRemoteUrls([mirrorUrl, 'git@github.com:Bohdanus/other.git'], [mirrorUrl])).toThrow(
      /mirror remote must point/
    );
    expect(() => assertMirrorRemoteUrls([mirrorUrl], [mirrorUrl, 'git@github.com:Bohdanus/other.git'])).toThrow(
      /mirror remote must point/
    );
    expect(() => assertMirrorRemoteUrls([], [mirrorUrl])).toThrow(/fetch and push URLs/);
  });

  it('requires the active mirror workflow to match the committed workflow before dispatch', () => {
    expect(() => assertMirrorWorkflowCurrent('ci.yml', 'blob-a', 'blob-a', 'active')).not.toThrow();
    expect(() => assertMirrorWorkflowCurrent('ci.yml', 'blob-a', 'blob-b', 'active')).toThrow(
      /does not match this commit/
    );
    expect(() => assertMirrorWorkflowCurrent('ci.yml', 'blob-a', 'blob-a', 'disabled_manually')).toThrow(
      /not active on mirror main/
    );
  });

  it.each([
    ['ETIMEDOUT', 'request timed out'],
    [undefined, 'HTTP 503: Service temporarily unavailable'],
    [undefined, 'API rate limit exceeded'],
  ])('retries transient GitHub errors', (code, detail) => {
    expect(isRetryableCommandError(code, detail)).toBe(true);
  });

  it('does not retry permanent authentication failures', () => {
    expect(isRetryableCommandError(undefined, 'HTTP 401: Bad credentials')).toBe(false);
  });

  it('binds a dispatch to a unique request id and source SHA', () => {
    const title = expectedRunTitle('focused', 'request-123', 'a'.repeat(40));
    expect(title).toBe(`Focused E2E request-123 @ ${'a'.repeat(40)}`);
    expect(
      findDispatchedRun(
        [
          { databaseId: 1, event: 'workflow_dispatch', displayTitle: title },
          { databaseId: 2, event: 'repository_dispatch', displayTitle: `${title} other` },
          { databaseId: 3, event: 'repository_dispatch', displayTitle: title },
        ],
        title
      )
    ).toMatchObject({ databaseId: 3 });
  });

  it('builds a default-branch baseline repository dispatch with no selected ref or force-push option', () => {
    const args = buildDispatchArgs(
      { mode: 'baselines', chatId: '@/tmp/should-remain-a-literal' },
      { requestId: 'req-1', sourceSha: 'b'.repeat(40), branch: 'feat/baselines', workflowSha: 'c'.repeat(40) }
    );
    expect(args).toContain('repos/Bohdanus/ph/dispatches');
    expect(args).toContain('event_type=capture-linux-baselines');
    expect(args).toContain('client_payload[request_id]=req-1');
    expect(args).toContain(`client_payload[source_sha]=${'b'.repeat(40)}`);
    expect(args).toContain('client_payload[source_branch]=feat/baselines');
    expect(args).toContain('client_payload[promote]=true');
    expect(args).toContain('client_payload[chat_id]=@/tmp/should-remain-a-literal');
    expect(args).toContain(`client_payload[expected_workflow_sha]=${'c'.repeat(40)}`);
    expect(args[args.indexOf('client_payload[chat_id]=@/tmp/should-remain-a-literal') - 1]).toBe('-f');
    expect(args.filter((arg) => arg === '-F')).toHaveLength(1);
    expect(args[args.indexOf('-F') + 1]).toBe('client_payload[promote]=true');
    expect(args).not.toContain('--ref');
    expect(args).not.toContain('--force');
  });

  it.each([
    [
      { mode: 'full' },
      { requestId: 'req-1', sourceSha: 'a'.repeat(40), workflowSha: 'b'.repeat(40) },
      'event_type=mirror-e2e-full',
    ],
    [
      { mode: 'focused', platform: 'linux', spec: 'e2e/levels.spec.ts' },
      { requestId: 'req-1', sourceSha: 'a'.repeat(40), workflowSha: 'b'.repeat(40) },
      'event_type=mirror-e2e-focused',
    ],
  ])('uses a default-branch repository dispatch for %j', (options, target, eventType) => {
    const args = buildDispatchArgs(options, target);
    expect(args).toContain(eventType);
    expect(args).toContain(`client_payload[expected_workflow_sha]=${'b'.repeat(40)}`);
    expect(args).not.toContain('--ref');
    expect(args).not.toContain('workflow');
  });

  it('rejects a mirror run when default main moved after preflight', () => {
    expect(() => assertMirrorRunUsesWorkflowSha({ headSha: 'a'.repeat(40) }, 'a'.repeat(40))).not.toThrow();
    expect(() => assertMirrorRunUsesWorkflowSha({ headSha: 'b'.repeat(40) }, 'a'.repeat(40))).toThrow(
      /different main revision/
    );
  });

  it('pushes a new mirror branch with an explicit ref and no force option', () => {
    const sourceSha = 'c'.repeat(40);
    const args = buildMirrorPushArgs(sourceSha, 'feat/e2e-runner');
    expect(args).toEqual(['push', 'mirror', `${sourceSha}:refs/heads/feat/e2e-runner`]);
    expect(args.some((arg) => arg.includes('force'))).toBe(false);
  });

  it('builds a normal fast-forward push for an existing mirror branch', () => {
    const sourceSha = 'c'.repeat(40);
    const args = buildMirrorPushArgs(sourceSha, 'feat/e2e-runner');
    expect(args).toEqual(['push', 'mirror', `${sourceSha}:refs/heads/feat/e2e-runner`]);
  });

  it('parses exactly the mirror branch SHA and recognizes an absent ref', () => {
    expect(parseMirrorBranchSha(`${'a'.repeat(40)}\trefs/heads/feat/e2e-runner\n`, 'feat/e2e-runner')).toBe(
      'a'.repeat(40)
    );
    expect(parseMirrorBranchSha('', 'feat/e2e-runner')).toBeNull();
    expect(() => parseMirrorBranchSha(`${'a'.repeat(40)}\trefs/heads/main`, 'feat/e2e-runner')).toThrow(/invalid ref/);
  });

  it('refuses a mirror branch that changes between ls-remote and fetch', () => {
    const remoteSha = 'a'.repeat(40);
    const fetchedSha = 'b'.repeat(40);
    const outputs = [`${remoteSha}\trefs/heads/feat/e2e-runner\n`, '', fetchedSha];
    const runCommand = vi.fn(() => outputs.shift() ?? '');

    expect(() => readMirrorBranchSha('feat/e2e-runner', '/tmp', runCommand)).toThrow(
      /changed while it was being inspected/
    );
    expect(runCommand).toHaveBeenCalledTimes(3);
  });

  it('creates an absent branch and permits a fast-forward update', () => {
    const fixture = createMirrorPushFixture();
    try {
      expect(readMirrorBranchSha(fixture.branch, fixture.source)).toBeNull();
      runGit(fixture.source, buildMirrorPushArgs(fixture.sourceSha, fixture.branch));
      expect(readMirrorBranchSha(fixture.branch, fixture.source)).toBe(fixture.sourceSha);

      const treeSha = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const nextSha = runGit(fixture.source, [
        'commit-tree',
        treeSha,
        '-p',
        fixture.sourceSha,
        '-m',
        'fast-forward fixture source',
      ]);
      const observedRemoteSha = readMirrorBranchSha(fixture.branch, fixture.source);
      expect(observedRemoteSha).toBe(fixture.sourceSha);
      assertMirrorBranchPushSafe({
        sourceSha: nextSha,
        remoteSha: observedRemoteSha,
        branch: fixture.branch,
        cwd: fixture.source,
      });

      runGit(fixture.source, buildMirrorPushArgs(nextSha, fixture.branch));
      expect(readMirrorBranchSha(fixture.branch, fixture.source)).toBe(nextSha);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects a concurrent mirror update with a normal fast-forward push', () => {
    const fixture = createMirrorPushFixture();
    try {
      runGit(fixture.source, buildMirrorPushArgs(fixture.sourceSha, fixture.branch));
      const observedRemoteSha = readMirrorBranchSha(fixture.branch, fixture.source);
      const divergedTree = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const sourceAheadSha = runGit(fixture.source, [
        'commit-tree',
        divergedTree,
        '-p',
        fixture.sourceSha,
        '-m',
        'source update before racing push',
      ]);
      assertMirrorBranchPushSafe({
        sourceSha: sourceAheadSha,
        remoteSha: observedRemoteSha,
        branch: fixture.branch,
        cwd: fixture.source,
      });

      const racingClone = join(fixture.root, 'racing-clone');
      runGit(fixture.root, ['clone', '--quiet', '--branch', fixture.branch, fixture.mirror, racingClone]);
      runGit(racingClone, ['config', 'user.name', 'Racing Writer']);
      runGit(racingClone, ['config', 'user.email', 'racing-writer@example.test']);
      writeFileSync(join(racingClone, 'racing.txt'), 'concurrent mirror update\n');
      runGit(racingClone, ['add', 'racing.txt']);
      runGit(racingClone, ['commit', '--quiet', '-m', 'concurrent source update']);
      runGit(racingClone, ['push', '--quiet', 'origin', `HEAD:refs/heads/${fixture.branch}`]);

      const stalePush = spawnSync('git', buildMirrorPushArgs(sourceAheadSha, fixture.branch), {
        cwd: fixture.source,
        encoding: 'utf8',
      });
      expect(stalePush.status).not.toBe(0);
      expect(`${stalePush.stderr}\n${stalePush.stdout}`).toMatch(/non-fast-forward|fetch first|rejected/i);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects an unrelated remote-only commit instead of overwriting it', () => {
    const fixture = createMirrorPushFixture();
    try {
      runGit(fixture.source, buildMirrorPushArgs(fixture.sourceSha, fixture.branch));
      const sourceTree = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const remoteOnlySha = runGit(fixture.source, [
        'commit-tree',
        sourceTree,
        '-p',
        fixture.sourceSha,
        '-m',
        'remote-only mirror update',
      ]);
      runGit(fixture.source, ['push', 'mirror', `${remoteOnlySha}:refs/heads/${fixture.branch}`]);

      const localOnlySha = runGit(fixture.source, [
        'commit-tree',
        sourceTree,
        '-p',
        fixture.sourceSha,
        '-m',
        'source-only update',
      ]);
      const remoteSha = readMirrorBranchSha(fixture.branch, fixture.source, (_binary, args, cwd) =>
        runGit(cwd, ['-c', 'safe.bareRepository=all', ...args])
      );
      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: localOnlySha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/contains commits absent from this source/);
      expect(readMirrorBranchSha(fixture.branch, fixture.source)).toBe(remoteOnlySha);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses to rewind a mirror branch when the source is behind it', () => {
    const fixture = createMirrorPushFixture();
    try {
      runGit(fixture.source, buildMirrorPushArgs(fixture.sourceSha, fixture.branch));

      const racingClone = join(fixture.root, 'racing-clone');
      runGit(fixture.root, ['clone', '--quiet', '--branch', fixture.branch, fixture.mirror, racingClone]);
      runGit(racingClone, ['config', 'user.name', 'Racing Writer']);
      runGit(racingClone, ['config', 'user.email', 'racing-writer@example.test']);
      writeFileSync(join(racingClone, 'racing.txt'), 'newer mirror commit\n');
      runGit(racingClone, ['add', 'racing.txt']);
      runGit(racingClone, ['commit', '--quiet', '-m', 'newer source commit']);
      runGit(racingClone, ['push', '--quiet', 'origin', `HEAD:refs/heads/${fixture.branch}`]);

      const remoteSha = readMirrorBranchSha(fixture.branch, fixture.source);
      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: fixture.sourceSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/mirror branch .* is ahead of the source commit/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('preserves an unmerged baseline promotion when a rebased source diverges', () => {
    const fixture = createMirrorPushFixture();
    try {
      const { baselineSha, remoteSha } = createBaselinePromotion(fixture, 'ses_0123456789ABCDEF0123456789');

      const originalTreeSha = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const rebasedSha = runGit(fixture.source, [
        'commit-tree',
        originalTreeSha,
        '-p',
        fixture.sourceSha,
        '-m',
        'rebased source without promoted baselines',
      ]);

      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: rebasedSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/baseline promotion absent from this source commit/);
      expect(readMirrorBranchSha(fixture.branch, fixture.source)).toBe(baselineSha);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects a remote-only baseline promotion with an invalid Chat trailer', () => {
    const fixture = createMirrorPushFixture();
    try {
      const { remoteSha } = createBaselinePromotion(fixture, 'not-native-session');
      const originalTreeSha = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const rebasedSha = runGit(fixture.source, [
        'commit-tree',
        originalTreeSha,
        '-p',
        fixture.sourceSha,
        '-m',
        'rebased source without promoted baselines',
      ]);

      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: rebasedSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/invalid Chat trailer/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('preserves remote-only baseline changes even when their commit subject is noncanonical', () => {
    const fixture = createMirrorPushFixture();
    try {
      const { remoteSha } = createBaselinePromotion(
        fixture,
        'ses_0123456789ABCDEF0123456789',
        'manual snapshot update'
      );
      const originalTreeSha = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const rebasedSha = runGit(fixture.source, [
        'commit-tree',
        originalTreeSha,
        '-p',
        fixture.sourceSha,
        '-m',
        'rebased source without promoted baselines',
      ]);

      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: rebasedSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/Linux baseline file changes with an unrecognized commit/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses an unrelated root commit that changes a Linux baseline path', () => {
    const fixture = createMirrorPushFixture();
    const rootRepo = join(fixture.root, 'root-baseline');
    try {
      runGit(fixture.source, buildMirrorPushArgs(fixture.sourceSha, fixture.branch));
      runGit(fixture.root, ['init', '--quiet', '--initial-branch=main', rootRepo]);
      runGit(rootRepo, ['config', 'user.name', 'Root Baseline Fixture']);
      runGit(rootRepo, ['config', 'user.email', 'root-baseline-fixture@example.test']);
      const baselineFile = join(rootRepo, LINUX_BASELINE_PATH, LINUX_BASELINE_FILES[0]);
      mkdirSync(dirname(baselineFile), { recursive: true });
      writeFileSync(baselineFile, 'root baseline\n');
      runGit(rootRepo, ['add', LINUX_BASELINE_PATH]);
      runGit(rootRepo, [
        'commit',
        '--quiet',
        '-m',
        'test: refresh Linux export baselines',
        '-m',
        'Chat: ses_rootBaselineFixture',
      ]);
      const rootSha = runGit(rootRepo, ['rev-parse', 'HEAD']);
      runGit(fixture.root, [
        '-c',
        'safe.bareRepository=all',
        '--git-dir',
        fixture.mirror,
        'fetch',
        '--quiet',
        rootRepo,
        'refs/heads/main',
      ]);
      runGit(fixture.root, [
        '-c',
        'safe.bareRepository=all',
        '--git-dir',
        fixture.mirror,
        'update-ref',
        `refs/heads/${fixture.branch}`,
        rootSha,
      ]);

      const remoteSha = readMirrorBranchSha(fixture.branch, fixture.source);
      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: fixture.sourceSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/not a single-parent commit/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('refuses a merge commit that changes a Linux baseline path', () => {
    const fixture = createMirrorPushFixture();
    try {
      const sourceTree = runGit(fixture.source, ['rev-parse', `${fixture.sourceSha}^{tree}`]);
      const sideSha = runGit(fixture.source, [
        'commit-tree',
        sourceTree,
        '-p',
        fixture.sourceSha,
        '-m',
        'side source commit',
      ]);
      const baselineFile = join(fixture.source, LINUX_BASELINE_PATH, LINUX_BASELINE_FILES[0]);
      mkdirSync(dirname(baselineFile), { recursive: true });
      writeFileSync(baselineFile, 'merge-resolved baseline\n');
      runGit(fixture.source, ['add', LINUX_BASELINE_PATH]);
      const mergeTree = runGit(fixture.source, ['write-tree']);
      const mergeSha = runGit(fixture.source, [
        'commit-tree',
        mergeTree,
        '-p',
        fixture.sourceSha,
        '-p',
        sideSha,
        '-m',
        'test: refresh Linux export baselines',
        '-m',
        'Chat: ses_0123456789ABCDEF0123456789',
      ]);
      runGit(fixture.source, buildMirrorPushArgs(mergeSha, fixture.branch));
      const remoteSha = readMirrorBranchSha(fixture.branch, fixture.source);
      const rebasedSourceSha = runGit(fixture.source, [
        'commit-tree',
        sourceTree,
        '-p',
        fixture.sourceSha,
        '-m',
        'rebased source without promoted baselines',
      ]);

      expect(() =>
        assertMirrorBranchPushSafe({
          sourceSha: rebasedSourceSha,
          remoteSha,
          branch: fixture.branch,
          cwd: fixture.source,
        })
      ).toThrow(/not a single-parent commit/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  // Windows cannot materialize a filename with a trailing space; the other
  // malformed path forms remain covered on every platform.
  it.each([
    ['leading-space path', { pathPrefix: ' ' }, /allowlist/],
    ...(process.platform === 'win32' ? [] : [['trailing-space path', { fileSuffix: ' ' }, /allowlist/]]),
    ['trailing-space subject', { subjectSuffix: ' ' }, /unrecognized subject/],
    ['trailing-space Chat trailer', { chatSuffix: ' ' }, /exactly the requested native Chat trailer/],
  ])('rejects a baseline promotion with %s', (_, mutation, error) => {
    const fixture = createMirrorPushFixture();
    try {
      const promotionRepo = join(fixture.root, 'promotion');
      runGit(fixture.root, ['clone', '--quiet', fixture.source, promotionRepo]);
      runGit(promotionRepo, ['config', 'user.name', 'Baseline Promotion Fixture']);
      runGit(promotionRepo, ['config', 'user.email', 'baseline-promotion-fixture@example.test']);

      const baselinePath = mutation.pathPrefix
        ? `${mutation.pathPrefix}${LINUX_BASELINE_PATH}/${LINUX_BASELINE_FILES[0]}`
        : `${LINUX_BASELINE_PATH}/${LINUX_BASELINE_FILES[0]}${mutation.fileSuffix ?? ''}`;
      const baselineFile = join(promotionRepo, baselinePath);
      mkdirSync(dirname(baselineFile), { recursive: true });
      writeFileSync(baselineFile, 'captured baseline\n');
      runGit(promotionRepo, ['add', '--', baselinePath]);

      const subject = `test: refresh Linux export baselines${mutation.subjectSuffix ?? ''}`;
      const chatTrailer = `Chat: ses_0123456789ABCDEF0123456789${mutation.chatSuffix ?? ''}`;
      const tree = runGit(promotionRepo, ['write-tree']);
      const author = runGit(promotionRepo, ['var', 'GIT_AUTHOR_IDENT']);
      const committer = runGit(promotionRepo, ['var', 'GIT_COMMITTER_IDENT']);
      const commitObject = [
        `tree ${tree}`,
        `parent ${fixture.sourceSha}`,
        `author ${author}`,
        `committer ${committer}`,
        '',
        `${subject}\n\n${chatTrailer}\n`,
      ].join('\n');
      const promotionSha = runGit(promotionRepo, ['hash-object', '-w', '-t', 'commit', '--stdin'], commitObject);
      runGit(promotionRepo, ['remote', 'add', 'mirror', fixture.mirror]);
      runGit(promotionRepo, buildMirrorPushArgs(promotionSha, fixture.branch));

      const calls = [];
      const runCommand = (binary, args, cwd = fixture.source, _timeoutMs, { trimOutput = true } = {}) => {
        calls.push({ binary, args: [...args] });
        const result = spawnSync(binary, args, { cwd, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
        const output = result.stdout ?? '';
        return trimOutput ? output.trim() : output;
      };

      expect(() =>
        fastForwardBaselineCommit({
          branch: fixture.branch,
          sourceSha: fixture.sourceSha,
          chatId: 'ses_0123456789ABCDEF0123456789',
          cwd: fixture.source,
          runCommand,
        })
      ).toThrow(error);
      expect(runGit(fixture.source, ['rev-parse', 'HEAD'])).toBe(fixture.sourceSha);
      expect(calls.some(({ args }) => args[0] === 'merge')).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

describe('focused spec validation', () => {
  it('accepts a real Playwright spec', () => {
    expect(validateE2ESpec('e2e/export/visual-regression.spec.ts')).toBe('e2e/export/visual-regression.spec.ts');
  });

  it.each([
    '../src/app.spec.ts',
    'e2e/../src/app.spec.ts',
    '/tmp/app.spec.ts',
    'e2e/*.spec.ts',
    'e2e/helpers/__tests__/canvas.unit.spec.ts',
    'e2e/export/line\nbreak.spec.ts',
    'e2e/export/tab\tseparator.spec.ts',
  ])('rejects non-literal, escaped, ignored, or missing spec %s', (spec) => {
    expect(() => validateE2ESpec(spec)).toThrow();
  });

  it('reports a missing spec with a controlled validation error', () => {
    expect(() => validateE2ESpec('e2e/missing.spec.ts')).toThrow('spec must be an existing regular file');
  });
});

describe('Linux baseline promotion verification', () => {
  const sourceSha = 'a'.repeat(40);
  const remoteSha = 'b'.repeat(40);
  const branch = 'feat/baselines';
  const chatId = 'ses_0123456789ABCDEF0123456789';
  const path = 'e2e/export/visual-regression.spec.ts-snapshots/export-baselines/linux/drawing.png.png';

  function createPromotionGitCommand({
    branchAtStart = branch,
    branchBeforeMerge = branch,
    headAtStart = sourceSha,
    headBeforeMerge = sourceSha,
    statusAtStart = '',
    statusBeforeMerge = '',
    fetchedSha = remoteSha,
    parents = [sourceSha],
    commitSubject = 'test: refresh Linux export baselines',
    changedPaths = [path],
    commitMessage,
  } = {}) {
    const calls = [];
    let branchReads = 0;
    let headReads = 0;
    let statusReads = 0;
    const fullCommitMessage = commitMessage ?? `${commitSubject}\n\nChat: ${chatId}`;
    const runCommand = (binary, args, _cwd, _timeoutMs, { trimOutput = true } = {}) => {
      calls.push({ binary, args: [...args] });
      if (binary !== 'git') throw new Error(`Unexpected command: ${binary}`);
      switch (args[0]) {
        case 'symbolic-ref':
          return branchReads++ === 0 ? branchAtStart : branchBeforeMerge;
        case 'rev-parse':
          if (args[1] === '--verify') return headReads++ === 0 ? headAtStart : headBeforeMerge;
          if (args[1] === 'FETCH_HEAD') return fetchedSha;
          break;
        case 'rev-list':
          return [fetchedSha, ...parents].join(' ');
        case 'status':
          return statusReads++ === 0 ? statusAtStart : statusBeforeMerge;
        case 'fetch':
        case 'merge':
          return '';
        case 'diff':
          return trimOutput
            ? (args.includes('-z') ? `${changedPaths.join('\0')}\0` : changedPaths.join('\n')).trim()
            : `${changedPaths.join('\0')}\0`;
        case 'show': {
          if (args.includes('--format=x%B%x00')) return `x${fullCommitMessage}\0\n`.trim();
          if (args.includes('--format=%s')) return `${commitSubject}\n`.trim();
          return `${fullCommitMessage}\n`.trim();
        }
      }
      throw new Error(`Unexpected git command: ${args.join(' ')}`);
    };
    return { calls, runCommand };
  }

  it('accepts a direct baseline-only child commit with one matching Chat trailer', () => {
    expect(
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId}`,
        chatId,
      })
    ).toMatchObject({ changed: true });
  });

  it('counts blank Chat trailers when enforcing exactly one native Chat trailer', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat:\nChat: ${chatId}`,
        chatId,
      })
    ).toThrow(/exactly the requested native Chat trailer/);
  });

  it('does not accept a Chat line in the commit body as a trailer', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId}\nordinary body prose`,
        chatId,
      })
    ).toThrow(/exactly the requested native Chat trailer/);
  });

  it('uses only the final trailer block when the body also mentions Chat', () => {
    expect(
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nBody note: Chat: not-the-session\n\nChat: ${chatId}`,
        chatId,
      })
    ).toMatchObject({ changed: true });
  });

  it('accepts a valid Chat trailer alongside a coauthor trailer', () => {
    expect(
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId}\nCo-authored-by: Example <example@example.test>`,
        chatId,
      })
    ).toMatchObject({ changed: true });
  });

  it('rejects a matching but malformed native Chat ID', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: 'test: refresh Linux export baselines\n\nChat: ses_42',
        chatId: 'ses_42',
      })
    ).toThrow(/native Chat ID/);
  });

  it('rejects a generated commit that is not a direct child of the tested SHA', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: ['c'.repeat(40)],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId}`,
        chatId,
      })
    ).toThrow(/direct child/);
  });

  it('accepts a no-op capture without expecting a generated commit', () => {
    expect(
      verifyBaselinePromotion({
        sourceSha,
        remoteSha: sourceSha,
        parents: [],
        commitSubject: '',
        changedPaths: [],
        chatId,
      })
    ).toMatchObject({ changed: false });
  });

  it('rejects an unrelated file in the generated commit', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parents: [sourceSha],
        commitSubject: 'test: refresh Linux export baselines',
        changedPaths: [path, 'src/App.tsx'],
        commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId}`,
        chatId,
      })
    ).toThrow(/allowlist/);
  });

  it('rejects generated merge commits and noncanonical promotion subjects', () => {
    const merged = createPromotionGitCommand({ parents: [sourceSha, 'd'.repeat(40)] });
    expect(() => fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand: merged.runCommand })).toThrow(
      /single-parent/
    );
    expect(merged.calls.some(({ args }) => args[0] === 'merge')).toBe(false);

    const renamed = createPromotionGitCommand({ commitSubject: 'manual Linux baseline refresh' });
    expect(() => fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand: renamed.runCommand })).toThrow(
      /unrecognized subject/
    );
    expect(renamed.calls.some(({ args }) => args[0] === 'merge')).toBe(false);
  });

  it.each([
    ['path', { changedPaths: [`${path} `] }, /allowlist/],
    ['subject', { commitSubject: 'test: refresh Linux export baselines ' }, /unrecognized subject/],
    [
      'Chat trailer',
      { commitMessage: `test: refresh Linux export baselines\n\nChat: ${chatId} ` },
      /exactly the requested native Chat trailer/,
    ],
  ])('preserves trailing whitespace in Git %s output for strict validation', (_, state, error) => {
    const { calls, runCommand } = createPromotionGitCommand(state);

    expect(() => fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand })).toThrow(error);
    expect(calls.some(({ args }) => args[0] === 'merge')).toBe(false);
  });

  it.each([
    ['branch', { branchAtStart: 'main' }, /local branch changed while/],
    ['HEAD', { headAtStart: 'c'.repeat(40) }, /local branch moved while/],
    ['worktree', { statusAtStart: ' M src/App.tsx' }, /local worktree became dirty while/],
  ])('refuses to fetch when the %s is unsafe when capture completes', (_, state, error) => {
    const { calls, runCommand } = createPromotionGitCommand(state);

    expect(() => fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand })).toThrow(error);
    expect(calls.some(({ args }) => args[0] === 'fetch')).toBe(false);
  });

  it.each([
    ['branch', { branchBeforeMerge: 'main' }, /local branch changed before/],
    ['HEAD', { headBeforeMerge: 'c'.repeat(40) }, /local branch moved before/],
    ['worktree', { statusBeforeMerge: ' M src/App.tsx' }, /local worktree became dirty before/],
  ])('refuses to fast-forward when the %s changes during promotion', (_, state, error) => {
    const { calls, runCommand } = createPromotionGitCommand(state);

    expect(() => fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand })).toThrow(error);
    expect(calls.some(({ args }) => args[0] === 'merge')).toBe(false);
  });

  it('fast-forwards a validated baseline commit only after the final local-state checks', () => {
    const { calls, runCommand } = createPromotionGitCommand();

    fastForwardBaselineCommit({ branch, sourceSha, chatId, runCommand });

    expect(calls.at(-1)).toEqual({ binary: 'git', args: ['merge', '--ff-only', remoteSha] });
  });
});
