import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildPrompt, main, parseArgs } from '../free-web-research.mjs';
import { stripHtml } from '../free-research.mjs';

describe('parseArgs', () => {
  it('parses URL only', () => {
    const result = parseArgs(['https://example.com', '--json']);
    expect(result.url).toBe('https://example.com');
    expect(result.prompt).toBeNull();
    expect(result.help).toBe(false);
    expect(result.jsonOutput).toBe(true);
  });

  it('allows human-readable stdout without an output file', () => {
    expect(parseArgs(['https://example.com'])).toMatchObject({
      url: 'https://example.com',
      outputFile: null,
      jsonOutput: false,
    });
  });

  it('parses URL and positional prompt', () => {
    const result = parseArgs(['https://example.com', 'What is this?', '--json']);
    expect(result.url).toBe('https://example.com');
    expect(result.prompt).toBe('What is this?');
  });

  it('parses --prompt flag', () => {
    const result = parseArgs(['https://example.com', '--prompt', 'Summarize', '--json']);
    expect(result.url).toBe('https://example.com');
    expect(result.prompt).toBe('Summarize');
  });

  it('parses -p flag', () => {
    const result = parseArgs(['https://example.com', '-p', 'Research', '--json']);
    expect(result.url).toBe('https://example.com');
    expect(result.prompt).toBe('Research');
  });

  it('parses --output-file', () => {
    const result = parseArgs(['https://example.com', '-o', '/tmp/out.txt']);
    expect(result.outputFile).toBe('/tmp/out.txt');
  });

  it('parses --output-file long form', () => {
    const result = parseArgs(['https://example.com', '--output-file', '/tmp/out.txt']);
    expect(result.outputFile).toBe('/tmp/out.txt');
  });

  it('parses --max-summary-tokens', () => {
    const result = parseArgs(['https://example.com', '--max-summary-tokens', '200', '--json']);
    expect(result.maxSummaryTokens).toBe(200);
  });

  it('parses --max-tokens alias', () => {
    const result = parseArgs(['https://example.com', '--max-tokens', '300', '--json']);
    expect(result.maxSummaryTokens).toBe(300);
  });

  it('parses --fetch-timeout', () => {
    const result = parseArgs(['https://example.com', '--fetch-timeout', '30000', '--json']);
    expect(result.fetchTimeout).toBe(30000);
  });

  it('parses --max-content', () => {
    const result = parseArgs(['https://example.com', '--max-content', '5000', '--json']);
    expect(result.maxContent).toBe(5000);
  });

  it('parses --probe-openrouter-quota', () => {
    const result = parseArgs(['https://example.com', '--probe-openrouter-quota', '--json']);
    expect(result.probeOpenRouterQuota).toBe(true);
  });

  it('shows help for --help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('errors when URL is missing', () => {
    expect(parseArgs(['--json']).error).toContain('URL is required');
  });

  it('errors on unknown options', () => {
    expect(parseArgs(['https://example.com', '--bogus', '--json']).error).toContain('Unknown option');
  });

  it('errors on out-of-range --max-summary-tokens', () => {
    expect(parseArgs(['https://example.com', '--max-summary-tokens', '0']).error).toContain(
      'must be an integer from 1 to'
    );
    expect(parseArgs(['https://example.com', '--max-summary-tokens', '9999']).error).toContain(
      'must be an integer from 1 to'
    );
  });

  it('errors on out-of-range --fetch-timeout', () => {
    expect(parseArgs(['https://example.com', '--fetch-timeout', '100']).error).toContain(
      'must be an integer from 1000 to'
    );
  });

  it('errors on out-of-range --max-content', () => {
    expect(parseArgs(['https://example.com', '--max-content', '0']).error).toContain('must be an integer from 1 to');
  });

  it('errors on duplicate --output-file', () => {
    expect(parseArgs(['https://example.com', '-o', '/a.txt', '-o', '/b.txt']).error).toContain('only once');
  });

  it('errors on unexpected extra arguments', () => {
    expect(parseArgs(['https://example.com', 'prompt', 'extra']).error).toContain('Unexpected argument');
  });

  it('returns error for multiple --prompt flags', () => {
    expect(parseArgs(['https://example.com', '--prompt', 'a', '--prompt', 'b']).error).toContain('only once');
  });
});

describe('buildPrompt', () => {
  it('builds a general summary prompt when no prompt is given', () => {
    const result = buildPrompt({ url: 'https://example.com', content: 'Hello world', prompt: null });
    expect(result).toContain('Summarize the following web page content');
    expect(result).toContain('https://example.com');
    expect(result).toContain('Hello world');
    expect(result).not.toContain('Question:');
  });

  it('builds a research prompt when prompt is given', () => {
    const result = buildPrompt({ url: 'https://example.com', content: 'Hello world', prompt: 'What is this?' });
    expect(result).toContain('research assistant');
    expect(result).toContain('What is this?');
    expect(result).toContain('https://example.com');
    expect(result).toContain('Hello world');
    expect(result).toContain('Question:');
    expect(result).toContain('Answer:');
  });

  it('truncates content to MAX_CONTENT_CHARS', () => {
    const longContent = 'x'.repeat(20_000);
    const result = buildPrompt({ url: 'https://example.com', content: longContent, prompt: null });
    // MAX_CONTENT_CHARS is 10_000, template adds ~500 chars
    expect(result.length).toBeLessThan(11_000);
  });

  it('truncates prompt to MAX_PROMPT_CHARS', () => {
    const longPrompt = 'y'.repeat(5000);
    const result = buildPrompt({ url: 'https://example.com', content: 'content', prompt: longPrompt });
    expect(result).toContain('y'.repeat(2000));
    expect(result).not.toContain('y'.repeat(2001));
  });
});

describe('stripHtml entity decoding', () => {
  it('decodes numeric decimal entities', () => {
    expect(stripHtml('&#65;&#66;&#67;')).toBe('ABC');
  });

  it('decodes numeric hex entities', () => {
    expect(stripHtml('&#x41;&#x42;&#x43;')).toBe('ABC');
    expect(stripHtml('&#x1F600;')).toBe('\uD83D\uDE00');
  });

  it('decodes common named entities', () => {
    expect(stripHtml('&copy; &reg; &trade; &mdash; &hellip; &laquo;')).toBe(
      '\u00A9 \u00AE \u2122 \u2014 \u2026 \u00AB'
    );
  });

  it('decodes entities embedded in text', () => {
    expect(stripHtml('Price: &euro;10 &mdash; &lsquo;hello&rsquo;')).toBe('Price: \u20AC10 \u2014 \u2018hello\u2019');
  });

  it('leaves unknown entities untouched', () => {
    expect(stripHtml('a &nonexistent; b')).toBe('a &nonexistent; b');
  });

  it('does not re-decode double-encoded entities', () => {
    expect(stripHtml('&amp;lt;')).toBe('&lt;');
  });

  it('still strips tags before decoding entities', () => {
    expect(stripHtml('<p>line1</p>\n  \n  <p>line2</p> &amp; &mdash;')).toBe('line1 line2 & ' + '\u2014');
  });
});

describe('CLI: integration with mocked deps', () => {
  it('preserves human-readable stdout when no output mode is specified', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('Example domain content for testing');
    const completeImpl = vi.fn().mockResolvedValue({
      source: 'kilo',
      model: 'test-free-model',
      content: 'This is a test summary.',
      finishReason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const code = await main(['https://example.com'], { fetchUrlImpl, completeImpl, stdout, stderr });

    expect(code).toBe(0);
    const output = stdout.write.mock.calls.map((call) => call[0]).join('');
    expect(output).toContain('URL: https://example.com');
    expect(output).toContain('This is a test summary.');
    expect(() => JSON.parse(output)).toThrow();
  });

  it('fetches URL and produces general summary', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('Example domain content for testing');
    const completeImpl = vi.fn().mockResolvedValue({
      source: 'kilo',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      content: 'This is a test summary.',
      finishReason: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
    });
    const code = await main(['https://example.com', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(fetchUrlImpl).toHaveBeenCalled();
    expect(completeImpl).toHaveBeenCalled();
    const output = stdout.write.mock.calls.map((c) => c[0]).join('');
    const result = JSON.parse(output);
    expect(result.content).toContain('This is a test summary.');
  });

  it('fetches URL and produces research answer when prompt given', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('Example domain content for testing');
    const completeImpl = vi.fn().mockResolvedValue({
      source: 'openrouter',
      model: 'deepseek-r1:free',
      content: 'The answer is 42.',
      finishReason: 'stop',
      usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0 },
    });
    const code = await main(['https://example.com', 'What is the answer?', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const output = stdout.write.mock.calls.map((c) => c[0]).join('');
    const result = JSON.parse(output);
    expect(result.content).toContain('The answer is 42.');
    expect(result.prompt).toBe('What is the answer?');
  });

  it('returns exit code 2 for invalid URL', async () => {
    const stderr = { write: vi.fn() };
    const code = await main(['not-a-url', '--json'], { stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'));
  });

  it('returns exit code 3 when fetch fails', async () => {
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockRejectedValue(new Error('network error'));
    const completeImpl = vi.fn();
    const code = await main(['https://example.com', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stderr,
    });
    expect(code).toBe(3);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Fetch failed'));
  });

  it('returns exit code 3 when page has no content', async () => {
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('');
    const completeImpl = vi.fn();
    const code = await main(['https://example.com', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stderr,
    });
    expect(code).toBe(3);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('no extractable text'));
  });

  it('returns exit code 2 for missing URL', async () => {
    const stderr = { write: vi.fn() };
    const code = await main([], { stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('URL is required'));
  });

  it('writes output to file when --output-file specified', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'web-research-'));
    const outputPath = join(directory, 'out.txt');
    const fetchUrlImpl = vi.fn().mockResolvedValue('Test content');
    const completeImpl = vi.fn().mockResolvedValue({
      source: 'kilo',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      content: 'Summary result',
      finishReason: 'stop',
      usage: null,
    });
    const writeFileFn = vi.fn().mockResolvedValue(undefined);
    const stderr = { write: vi.fn() };
    const stdout = { write: vi.fn() };
    try {
      const code = await main(['https://example.com', '-o', outputPath], {
        fetchUrlImpl,
        completeImpl,
        writeFileFn,
        stdout,
        stderr,
      });
      expect(code).toBe(0);
      expect(writeFileFn).toHaveBeenCalledWith(outputPath, expect.stringContaining('Summary result'), 'utf8');
      expect(stdout.write).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to truncated content when free model fails', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('A'.repeat(3000));
    const completeImpl = vi.fn().mockRejectedValue(new Error('no free models'));
    const code = await main(['https://example.com', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stdout,
      stderr,
    });
    expect(code).toBe(5);
    const output = stdout.write.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('A'.repeat(2000));
  });

  it('shows help for --help', async () => {
    const stdout = { write: vi.fn() };
    const code = await main(['--help'], { stdout });
    expect(code).toBe(0);
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('errors on invalid --source value', async () => {
    const stderr = { write: vi.fn() };
    const code = await main(['https://example.com', '--source', 'invalid'], { stderr });
    expect(code).toBe(2);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Unknown option'));
  });

  it('handles --prompt flag overriding positional', async () => {
    const stdout = { write: vi.fn() };
    const stderr = { write: vi.fn() };
    const fetchUrlImpl = vi.fn().mockResolvedValue('Content');
    const completeImpl = vi.fn().mockResolvedValue({
      source: 'kilo',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      content: 'Answer',
      finishReason: 'stop',
      usage: null,
    });
    const code = await main(['https://example.com', 'positional prompt', '--prompt', 'flag prompt', '--json'], {
      fetchUrlImpl,
      completeImpl,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const output = stdout.write.mock.calls.map((c) => c[0]).join('');
    const result = JSON.parse(output);
    expect(result.prompt).toBe('flag prompt');
  });
});
