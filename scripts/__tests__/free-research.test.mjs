import { describe, expect, it, vi } from 'vitest';

import { fetchAll, fetchUrl, buildResearchPrompt, stripHtml } from '../free-research.mjs';

describe('stripHtml', () => {
  it('removes HTML tags and decodes common entities', () => {
    const html = '<p>Hello <b>world</b> &amp; <i>goodbye</i></p>';
    expect(stripHtml(html)).toBe('Hello world & goodbye');
  });

  it('removes script and style blocks', () => {
    const html = '<style>.x{color:red}</style><script>alert(1)</script><p>visible</p>';
    expect(stripHtml(html)).toBe('visible');
  });

  it('collapses whitespace', () => {
    const html = '<p>line1</p>\n  \n  <p>line2</p>';
    expect(stripHtml(html)).toBe('line1 line2');
  });

  it('strips HTML comments', () => {
    const html = '<!-- secret --><p>visible</p>';
    expect(stripHtml(html)).toBe('visible');
  });
});

describe('fetchUrl', () => {
  it('strips HTML and returns text content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<html><body><p>Real content here</p></body></html>',
    });
    const result = await fetchUrl('https://example.com', { fetchImpl, truncate: true });
    expect(result).toBe('Real content here');
  });

  it('returns JSON as string for application/json content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ key: 'value', list: [1, 2, 3] }),
    });
    const result = await fetchUrl('https://api.example.com', { fetchImpl });
    expect(JSON.parse(result)).toEqual({ key: 'value', list: [1, 2, 3] });
  });

  it('throws on non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => 'text/html' },
      text: async () => 'not found',
    });
    await expect(fetchUrl('https://missing.example.com', { fetchImpl })).rejects.toThrow('HTTP 404');
  });

  it('truncates content beyond maxContent when truncate is true', async () => {
    const longContent = 'A'.repeat(1000);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => longContent,
    });
    const result = await fetchUrl('https://long.example.com', { fetchImpl, maxContent: 100, truncate: true });
    expect(result.length).toBeLessThan(100 + 100);
    expect(result).toContain('truncated');
  });

  it('does not truncate when truncate is false', async () => {
    const longContent = 'A'.repeat(1000);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      text: async () => longContent,
    });
    const result = await fetchUrl('https://long.example.com', { fetchImpl, maxContent: 100, truncate: false });
    expect(result.length).toBe(1000);
  });
});

describe('fetchAll', () => {
  it('fetches all URLs and returns results in order', async () => {
    const urls = ['a.com', 'b.com', 'c.com'];
    const fetchImpl = vi.fn((url) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => `<p>${url}</p>`,
      })
    );
    const results = await fetchAll(urls, {
      fetchImpl,
      maxConcurrency: 3,
      maxContent: 30000,
      timeout: 20000,
      truncate: true,
    });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.content)).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('records fetch failures without throwing', async () => {
    const fetchImpl = vi.fn((url) =>
      url === 'fail.com'
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'text/html' },
            text: async () => '<p>ok</p>',
          })
    );
    const results = await fetchAll(['ok.com', 'fail.com'], {
      fetchImpl,
      maxConcurrency: 2,
      maxContent: 30000,
      timeout: 20000,
      truncate: true,
    });
    expect(results).toHaveLength(2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toContain('network error');
  });
});

describe('buildResearchPrompt', () => {
  it('includes the question and all source URLs in the prompt', () => {
    const fetched = [
      { url: 'https://a.com', ok: true, content: 'content A' },
      { url: 'https://b.com', ok: false, error: 'connection refused' },
    ];
    const prompt = buildResearchPrompt('What is the answer?', fetched);
    expect(prompt).toContain('Research request: What is the answer?');
    expect(prompt).toContain('url="https://a.com"');
    expect(prompt).toContain('content A');
    expect(prompt).toContain('url="https://b.com"');
    expect(prompt).toContain('FETCH_FAILED');
    expect(prompt).toContain('connection refused');
    expect(prompt).toContain('bullet points with URL citations');
  });

  it('handles empty fetched list gracefully', () => {
    const prompt = buildResearchPrompt('Question?', []);
    expect(prompt).toContain('Research request: Question?');
    expect(prompt).toContain('Evidence sources below');
  });
});
