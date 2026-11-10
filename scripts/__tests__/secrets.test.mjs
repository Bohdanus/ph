import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { isSecretKey, sanitizeErrorMessage, sanitizeForOutput } from '../lib/secrets.mjs';

/** One bounded Node child exercises the regex timeout without blocking Vitest's worker. */
vi.setConfig({ testTimeout: 15_000 });

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

  it('does not catastrophically backtrack on a long near-match object key', () => {
    const sanitizerUrl = pathToFileURL(resolve('scripts/lib/secrets.mjs')).href;
    const source = `
      import { sanitizeForOutput } from ${JSON.stringify(sanitizerUrl)};
      const key = 'key' + '1'.repeat(64) + 'x';
      console.log(JSON.stringify(sanitizeForOutput({ [key]: 'ordinary value' })));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      timeout: 3000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(JSON.stringify({ [`key${'1'.repeat(64)}x`]: 'ordinary value' }));
  });

  it('redacts standalone tokens handled by the shared text sanitizer', () => {
    const tokens = [
      `sk-proj-${'a'.repeat(40)}`,
      `sk-ant-api03-${'b'.repeat(40)}`,
      `ghs_${'c'.repeat(36)}`,
      `github_pat_${'d'.repeat(50)}`,
      `xoxb-${'e'.repeat(24)}`,
      'AKIAIOSFODNN7EXAMPLE',
    ];

    for (const token of tokens) {
      const message = `request failed: ${token}`;
      expect(sanitizeErrorMessage(message)).not.toContain(token);
      expect(sanitizeForOutput({ message }).message).not.toContain(token);
    }
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
