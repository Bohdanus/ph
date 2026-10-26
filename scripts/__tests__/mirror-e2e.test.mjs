import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
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
  parseArgs,
  RUN_WAIT_TIMEOUT_MS_BY_MODE,
  verifyBaselinePromotion,
} from '../mirror-e2e.mjs';
import { validateE2ESpec } from '../validate-e2e-spec.mjs';

const baselineWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/capture-linux-baselines.yml'), 'utf8');
const ciWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
const focusedWorkflow = readFileSync(resolve(process.cwd(), '.github/workflows/focused-e2e.yml'), 'utf8');

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

  it('attributes the generated commit to the native chat and leases the tested branch tip', () => {
    const validationStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Validate trusted workflow revision and capture target'),
      baselineWorkflow.indexOf('      - name: Download captured Linux baselines')
    );
    const promotionStep = baselineWorkflow.slice(
      baselineWorkflow.indexOf('      - name: Commit and push baseline changes')
    );

    expect(validationStep).toContain('[[ "$CHAT_ID" =~ ^[A-Za-z0-9._:/-]+$ ]]');
    const chatIdPattern = validationStep.match(/\[\[ "\$CHAT_ID" =~ (.+?) \]\]/)?.[1];
    expect(chatIdPattern).toBeDefined();
    const chatIdValidator = new RegExp(chatIdPattern);
    expect(chatIdValidator.test('copilotcli:/7befb061-b313-497b-8694-97929d9054e4')).toBe(true);
    expect(chatIdValidator.test('bad\nChat: injected')).toBe(false);
    expect(promotionStep).toContain('SOURCE_SHA: ${{ github.event.client_payload.source_sha }}');
    expect(promotionStep).toContain('--force-with-lease="refs/heads/$SOURCE_BRANCH:$SOURCE_SHA"');
    expect(promotionStep).toContain('-m "Chat: $CHAT_ID"');
    expect(promotionStep).not.toContain('Co-authored-by: Copilot');
  });

  it('waits beyond both Linux baseline job limits with queue margin', () => {
    expect(RUN_WAIT_TIMEOUT_MS_BY_MODE.baselines).toBeGreaterThanOrEqual((55 + 10 + 20) * 60_000);
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
    expect(parseArgs(['--linux-baselines', '--chat-id', 'ses_native-session'])).toMatchObject({
      mode: 'baselines',
      chatId: 'ses_native-session',
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
    ].map((args) => [args])
  )('rejects invalid invocation %j', (args) => {
    expect(() => parseArgs(args)).toThrow();
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

  it('pushes only the current branch and SHA to mirror without force', () => {
    const args = buildMirrorPushArgs('c'.repeat(40), 'feat/e2e-runner');
    expect(args).toEqual(['push', 'mirror', `${'c'.repeat(40)}:refs/heads/feat/e2e-runner`]);
    expect(args.some((arg) => arg.includes('force'))).toBe(false);
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
  const chatId = 'ses_42';
  const path = 'e2e/export/visual-regression.spec.ts-snapshots/export-baselines/linux/drawing.png.png';

  function createPromotionGitCommand({
    branchAtStart = branch,
    branchBeforeMerge = branch,
    headAtStart = sourceSha,
    headBeforeMerge = sourceSha,
    statusAtStart = '',
    statusBeforeMerge = '',
    fetchedSha = remoteSha,
    parentSha = sourceSha,
    changedPaths = [path],
    commitMessage = `test: refresh Linux export baselines\n\nChat: ${chatId}`,
  } = {}) {
    const calls = [];
    let branchReads = 0;
    let headReads = 0;
    let statusReads = 0;
    const runCommand = (binary, args) => {
      calls.push({ binary, args: [...args] });
      if (binary !== 'git') throw new Error(`Unexpected command: ${binary}`);
      switch (args[0]) {
        case 'symbolic-ref':
          return branchReads++ === 0 ? branchAtStart : branchBeforeMerge;
        case 'rev-parse':
          if (args[1] === '--verify') return headReads++ === 0 ? headAtStart : headBeforeMerge;
          if (args[1] === 'FETCH_HEAD') return fetchedSha;
          if (args[1] === `${fetchedSha}^`) return parentSha;
          break;
        case 'status':
          return statusReads++ === 0 ? statusAtStart : statusBeforeMerge;
        case 'fetch':
        case 'merge':
          return '';
        case 'diff':
          return changedPaths.join('\n');
        case 'show':
          return commitMessage;
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
        parentSha: sourceSha,
        changedPaths: [path],
        commitMessage: 'test: refresh Linux export baselines\n\nChat: ses_42',
        chatId: 'ses_42',
      })
    ).toMatchObject({ changed: true });
  });

  it('counts blank Chat trailers when enforcing exactly one native Chat trailer', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parentSha: sourceSha,
        changedPaths: [path],
        commitMessage: `test: refresh Linux export baselines\n\nChat:\nChat: ${chatId}`,
        chatId,
      })
    ).toThrow(/exactly the requested native Chat trailer/);
  });

  it('rejects a generated commit that is not a direct child of the tested SHA', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parentSha: 'c'.repeat(40),
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
        parentSha: sourceSha,
        changedPaths: [],
        chatId: 'ses_42',
      })
    ).toMatchObject({ changed: false });
  });

  it('rejects an unrelated file in the generated commit', () => {
    expect(() =>
      verifyBaselinePromotion({
        sourceSha,
        remoteSha,
        parentSha: sourceSha,
        changedPaths: [path, 'src/App.tsx'],
        commitMessage: 'test: refresh baselines\n\nChat: ses_42',
        chatId: 'ses_42',
      })
    ).toThrow(/allowlist/);
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
