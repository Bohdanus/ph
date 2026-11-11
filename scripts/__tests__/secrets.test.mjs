import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { isSecretKey, redactSensitiveText, sanitizeErrorMessage, sanitizeForOutput } from '../lib/secrets.mjs';

vi.setConfig({ testTimeout: 30_000 });

describe('secret key redaction', () => {
  it('preserves ordinary design and author fields', () => {
    expect(isSecretKey('design')).toBe(false);
    expect(isSecretKey('author')).toBe(false);
    expect(sanitizeForOutput({ design: 'canvas', author: 'Ada' })).toEqual({
      design: 'canvas',
      author: 'Ada',
    });
  });

  it('redacts secret names in camelCase and delimited forms', () => {
    expect(
      sanitizeForOutput({
        apiKey: 'value',
        oauthToken: 'value',
        clientAuth: 'value',
        authentication: 'value',
        passphrase: 'value',
        deploymentPassphrase: 'value',
        privateKeyPem: 'value',
        myKey123: 'value',
        hmacValue: 'value',
        signature: 'value',
        sigV4: 'value',
      })
    ).toEqual({
      apiKey: '***REDACTED***',
      oauthToken: '***REDACTED***',
      clientAuth: '***REDACTED***',
      authentication: '***REDACTED***',
      passphrase: '***REDACTED***',
      deploymentPassphrase: '***REDACTED***',
      privateKeyPem: '***REDACTED***',
      myKey123: '***REDACTED***',
      hmacValue: '***REDACTED***',
      signature: '***REDACTED***',
      sigV4: '***REDACTED***',
    });
  });

  it.each(['api_key_12', 'access_key_id_42'])('redacts numeric suffixes in %s', (key) => {
    expect(isSecretKey(key)).toBe(true);
    expect(sanitizeForOutput({ [key]: 'value' })).toEqual({ [key]: '***REDACTED***' });
  });

  it('redacts lowercase concatenated auth token and SigV4 names', () => {
    expect(
      sanitizeForOutput({
        authtoken: 'value',
        sigv4: 'value',
        author: 'Ada',
        design: 'canvas',
      })
    ).toEqual({
      authtoken: '***REDACTED***',
      sigv4: '***REDACTED***',
      author: 'Ada',
      design: 'canvas',
    });
  });

  it('does not catastrophically backtrack on long near-match keys in object and text sanitization', () => {
    const sanitizerUrl = pathToFileURL(resolve('scripts/lib/secrets.mjs')).href;
    const keys = [`key${'1'.repeat(64)}x`, `key${'-11'.repeat(32)}-`];
    const source = `
      import { sanitizeErrorMessage, sanitizeForOutput } from ${JSON.stringify(sanitizerUrl)};
      const keys = ${JSON.stringify(keys)};
      console.log(JSON.stringify(keys.map((key) => ({
        object: sanitizeForOutput({ [key]: 'ordinary value' }),
        message: sanitizeErrorMessage('request failed: ' + key + '=ordinary value'),
      }))));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      timeout: 1500,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const [nearMatchKey, delimitedKey] = keys;
    expect(JSON.parse(result.stdout.trim())).toEqual([
      {
        object: { [nearMatchKey]: 'ordinary value' },
        message: `request failed: ${nearMatchKey}=ordinary value`,
      },
      {
        object: { [delimitedKey]: '***REDACTED***' },
        message: `request failed: ${delimitedKey}=ordinary value`,
      },
    ]);
  });

  const statelessGitHubToken = `ghs_123456_${'a'.repeat(40)}.${'b'.repeat(220)}.${'c'.repeat(240)}`;

  const tokenCases = [
    ['OpenAI', `sk-proj-${'a'.repeat(40)}`],
    ['Anthropic', `sk-ant-api03-${'b'.repeat(40)}`],
    ['GitHub app', `ghs_${'c'.repeat(36)}`],
    ['GitHub stateless app', statelessGitHubToken],
    ['GitHub fine-grained', `github_pat_${'d'.repeat(50)}`],
    ['Slack', `xoxb-${'e'.repeat(24)}`],
    ['Slack app-level', `xapp-${'f'.repeat(40)}`],
    ['Slack rotating app-level', `xoxe.xapp-1-${'l'.repeat(40)}`],
    ['Slack app-level mixed case', `XAPP-${'k'.repeat(40)}`],
    ['Slack workflow', `xwfp-${'g'.repeat(32)}`],
    ['Slack rotated bot', `xoxe.xoxb-1-${'h'.repeat(40)}`],
    ['Slack rotated user', `xoxe.xoxp-1-${'i'.repeat(40)}`],
    ['Slack refresh', `xoxe-1-${'j'.repeat(40)}`],
    ['Slack refresh documented example', 'xoxe-1-abcdefg'],
    ['AWS long-term', 'AKIAIOSFODNN7EXAMPLE'],
    ['AWS temporary', 'ASIAIOSFODNN7EXAMPLE'],
  ];

  it.each(tokenCases)('redacts a standalone %s token in free text', (_kind, token) => {
    const message = `request failed: ${token}`;
    expect(sanitizeErrorMessage(message)).not.toContain(token);
    expect(sanitizeForOutput({ message }).message).not.toContain(token);
    expect(redactSensitiveText(message)).not.toContain(token);
  });

  it.each(tokenCases)('redacts an embedded %s token in free text', (_kind, token) => {
    const message = `prefix${token}. suffix`;
    const sanitizedMessage = sanitizeErrorMessage(message);
    const sanitizedObjectMessage = sanitizeForOutput({ message }).message;

    expect(sanitizedMessage).not.toContain(token);
    expect(sanitizedMessage).toContain('prefix');
    expect(sanitizedMessage).toContain('suffix');
    expect(sanitizedObjectMessage).not.toContain(token);
    expect(sanitizedObjectMessage).toContain('prefix');
    expect(sanitizedObjectMessage).toContain('suffix');
    const redactedText = redactSensitiveText(message);
    expect(redactedText).not.toContain(token);
    expect(redactedText).toContain('prefix');
    expect(redactedText).toContain('suffix');
  });

  it('preserves ordinary xoxe example labels without a numeric token generation', () => {
    const messages = [
      'example xoxe-example-value',
      'example xoxe.xapp-example-value',
      'example xoxe.xoxb-example-value',
    ];

    for (const message of messages) {
      expect(sanitizeErrorMessage(message)).toBe(message);
      expect(sanitizeForOutput({ message })).toEqual({ message });
      expect(redactSensitiveText(message)).toBe(message);
    }
  });

  it.each(['Bearer ', 'Authorization: Bearer '])('redacts stateless GitHub JWT after %s', (prefix) => {
    const message = `${prefix}${statelessGitHubToken} after-token text`;

    expect(sanitizeErrorMessage(message)).not.toContain(statelessGitHubToken);
    expect(sanitizeForOutput({ message }).message).not.toContain(statelessGitHubToken);
    expect(redactSensitiveText(message)).not.toContain(statelessGitHubToken);
    expect(sanitizeErrorMessage(message)).toContain('after-token text');
    expect(sanitizeForOutput({ message }).message).toContain('after-token text');
    expect(redactSensitiveText(message)).toContain('after-token text');
  });

  it.each([
    ['AWS long-term', 'AKIAIOSFODNN7EXAMPLE'],
    ['AWS temporary', 'ASIAIOSFODNN7EXAMPLE'],
  ])('uses the prompt-redaction marker for %s keys', (_kind, token) => {
    expect(redactSensitiveText(`prefix ${token} suffix`)).toBe('prefix [REDACTED] suffix');
  });

  it('redacts a Bearer token with repeated period characters and padding', () => {
    const token = `${'a'.repeat(20)}..${'b'.repeat(20)}==`;
    const message = `Bearer ${token} after-token text`;

    expect(sanitizeErrorMessage(message)).not.toContain(token);
    expect(sanitizeForOutput({ message }).message).not.toContain(token);
    expect(redactSensitiveText(message)).not.toContain(token);
    expect(sanitizeErrorMessage(message)).toContain('after-token text');
    expect(sanitizeForOutput({ message }).message).toContain('after-token text');
    expect(redactSensitiveText(message)).toContain('after-token text');
  });

  it('redacts the one-character Bearer credential allowed by RFC 6750', () => {
    const message = 'upstream error: Bearer x== after-token text';

    expect(sanitizeErrorMessage(message)).toBe('upstream error: Bearer ***REDACTED*** after-token text');
    expect(sanitizeForOutput({ message }).message).toBe('upstream error: Bearer ***REDACTED*** after-token text');
  });

  it('preserves short sk-like identifiers in error output while prompt redaction stays conservative', () => {
    const message = 'missing identifier: sk-abcdefghijkl';
    expect(sanitizeErrorMessage(message)).toBe(message);
    expect(sanitizeForOutput({ message }).message).toBe(message);
    expect(redactSensitiveText(message)).toBe('missing identifier: [REDACTED]');
  });

  it('redacts quoted credential assignments from error messages', () => {
    const sanitized = sanitizeErrorMessage(
      `GROQ_API_KEY='fixture-secret-value-123' token="fixture-token-456" passphrase="fixture-passphrase-789" privateKeyPem="fixture-private-pem-321"`
    );

    expect(sanitized).toBe(
      `GROQ_API_KEY='[REDACTED]' token="[REDACTED]" passphrase="[REDACTED]" privateKeyPem="[REDACTED]"`
    );
    expect(sanitized).not.toContain('fixture-secret-value-123');
    expect(sanitized).not.toContain('fixture-token-456');
    expect(sanitized).not.toContain('fixture-passphrase-789');
    expect(sanitized).not.toContain('fixture-private-pem-321');
  });
});
