import { describe, expect, it } from 'vitest';
import { isSecretKey, sanitizeForOutput } from '../lib/secrets.mjs';

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
        signature: 'value',
        sigV4: 'value',
      })
    ).toEqual({
      apiKey: '***REDACTED***',
      oauthToken: '***REDACTED***',
      clientAuth: '***REDACTED***',
      authentication: '***REDACTED***',
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
});
