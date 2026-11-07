import { describe, expect, it } from 'vitest';
import { isSecretKey, sanitizeErrorMessage, sanitizeForOutput } from '../lib/secrets.mjs';

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

  it('redacts quoted credential assignments from error messages', () => {
    const sanitized = sanitizeErrorMessage(
      `GROQ_API_KEY='fixture-secret-value-123' token="fixture-token-456" passphrase="fixture-passphrase-789"`
    );

    expect(sanitized).toBe(`GROQ_API_KEY='[REDACTED]' token="[REDACTED]" passphrase="[REDACTED]"`);
    expect(sanitized).not.toContain('fixture-secret-value-123');
    expect(sanitized).not.toContain('fixture-token-456');
    expect(sanitized).not.toContain('fixture-passphrase-789');
  });
});
