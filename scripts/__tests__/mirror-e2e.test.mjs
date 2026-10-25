import { describe, expect, it } from 'vitest';

import {
  buildDispatchArgs,
  buildMirrorPushArgs,
  expectedRunTitle,
  findDispatchedRun,
  assertMirrorRemote,
  githubRepositoryFromRemote,
  isRetryableCommandError,
  parseArgs,
  verifyBaselinePromotion,
} from '../mirror-e2e.mjs';
import { validateE2ESpec } from '../validate-e2e-spec.mjs';

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
  });

  it.each(
    [
      [],
      ['--full', '--linux-baselines', '--chat-id', 'ses_1'],
      ['--spec', 'e2e/levels.spec.ts', '--platform', 'darwin'],
      ['--full', '--chat-id', 'ses_1'],
      ['--linux-baselines'],
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
  ])('recognizes the expected mirror URL %s', (remote) => {
    expect(githubRepositoryFromRemote(remote)).toBe('bohdanus/ph');
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
          { databaseId: 1, event: 'push', displayTitle: title },
          { databaseId: 2, event: 'workflow_dispatch', displayTitle: `${title} other` },
          { databaseId: 3, event: 'workflow_dispatch', displayTitle: title },
        ],
        title
      )
    ).toMatchObject({ databaseId: 3 });
  });

  it('builds an explicit mirror dispatch with no force-push option', () => {
    const args = buildDispatchArgs(
      { mode: 'baselines', chatId: 'ses_42' },
      { requestId: 'req-1', sourceSha: 'b'.repeat(40), branch: 'feat/baselines' }
    );
    expect(args).toContain('capture-linux-baselines.yml');
    expect(args).toContain('--repo');
    expect(args).toContain('Bohdanus/ph');
    expect(args).toContain('source_branch=feat/baselines');
    expect(args).toContain('promote=true');
    expect(args).toContain('chat_id=ses_42');
    expect(args).not.toContain('--force');
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
    'e2e/missing.spec.ts',
  ])('rejects non-literal, escaped, ignored, or missing spec %s', (spec) => {
    expect(() => validateE2ESpec(spec)).toThrow();
  });
});

describe('Linux baseline promotion verification', () => {
  const sourceSha = 'a'.repeat(40);
  const remoteSha = 'b'.repeat(40);
  const path = 'e2e/export/visual-regression.spec.ts-snapshots/export-baselines/linux/drawing.png.png';

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
});
