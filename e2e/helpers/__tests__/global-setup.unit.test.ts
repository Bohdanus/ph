import type { FullConfig } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import { planWarmup, resolvedBaseUrl, runWarmup, WARMUP_INTERVAL_MS, WARMUP_TIMEOUT_MS } from '../../global-setup';

/**
 * The warm-up is covered here rather than in a new `e2e/helpers/*.ts` module on
 * purpose: `e2e/README.md` states that every helper module appears in the
 * coverage report, and a module that existed only to be tested would break that.
 * `e2e/global-setup.ts` is imported by `playwright.config.ts`, never by a spec,
 * so this file is its only coverage — which is why it is here at all.
 *
 * Every case below runs against an injected `fetch`/`now`/`sleep`. Nothing in
 * this file opens a socket, a browser, or a timer: the point of the warm-up is
 * that it needs neither, and a test that proved it by using them would prove
 * nothing.
 */

const HTML = '<html><body><script type="module" src="/src/main.tsx"></script></body></html>';

const ok = { ok: true, status: 200 };

function deps(overrides: Partial<Parameters<typeof runWarmup>[1]> = {}): Parameters<typeof runWarmup>[1] {
  return {
    fetch: vi.fn(async () => ok),
    now: () => 0,
    sleep: vi.fn(async () => {}),
    timeoutMs: 1000,
    intervalMs: 1,
    ...overrides,
  };
}

describe('resolvedBaseUrl', () => {
  const project = (use: Record<string, unknown>) => ({ use }) as unknown as FullConfig['projects'][number];

  it('reads the base URL the merged config gives each project', () => {
    const config = { projects: [project({ baseURL: 'http://localhost:5413' })] };
    expect(resolvedBaseUrl(config)).toBe('http://localhost:5413');
  });

  it('falls back to PLAYWRIGHT_BASE_URL when no project declares one', () => {
    const previous = process.env.PLAYWRIGHT_BASE_URL;
    process.env.PLAYWRIGHT_BASE_URL = 'https://example.test';
    try {
      expect(resolvedBaseUrl({ projects: [project({})] })).toBe('https://example.test');
    } finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_BASE_URL;
      else process.env.PLAYWRIGHT_BASE_URL = previous;
    }
  });

  it('is undefined when neither source has one, so planWarmup skips', () => {
    const previous = process.env.PLAYWRIGHT_BASE_URL;
    delete process.env.PLAYWRIGHT_BASE_URL;
    try {
      const base = resolvedBaseUrl({ projects: [project({})] });
      expect(base).toBeUndefined();
      expect(planWarmup({ baseUrl: base, argv: [], html: HTML }).url).toBeNull();
    } finally {
      if (previous !== undefined) process.env.PLAYWRIGHT_BASE_URL = previous;
    }
  });
});

describe('planWarmup', () => {
  it('builds a module-entry URL from the base URL, not the base URL itself', () => {
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    expect(plan.url).toBe('http://localhost:5173/src/main.tsx');
  });

  it('derives the entry from index.html rather than assuming it', () => {
    const html = HTML.replace('/src/main.tsx', '/src/entry.ts');
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html });
    expect(plan.url).toBe('http://localhost:5173/src/entry.ts');
  });

  it('falls back to the known entry when index.html cannot be read', () => {
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: null });
    expect(plan.url).toBe('http://localhost:5173/src/main.tsx');
    expect(plan.reason).toContain('/src/main.tsx');
  });

  it('honours a resolved PLAYWRIGHT_BASE_URL override', () => {
    // `use.baseURL` is `process.env.PLAYWRIGHT_BASE_URL ?? baseUrl`, so the override
    // arrives here already resolved. A remote origin is a documented use, and the
    // safest behaviour is still to ask it for its module entry: a GET is harmless,
    // and if it is not there the fetch gives up quietly.
    const plan = planWarmup({ baseUrl: 'https://example.test', argv: [], html: HTML });
    expect(plan.url).toBe('https://example.test/src/main.tsx');
  });

  it('skips with no base URL', () => {
    const plan = planWarmup({ baseUrl: undefined, argv: [], html: HTML });
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('no base URL');
  });

  it('skips a whitespace-only base URL', () => {
    expect(planWarmup({ baseUrl: '   ', argv: [], html: HTML }).url).toBeNull();
  });

  it('skips a base URL that is not a URL', () => {
    // `new URL('localhost:5173')` does NOT throw — it parses with the scheme
    // `localhost:` — which is why there is a separate scheme check below and why
    // this case uses a string that genuinely cannot be parsed.
    const plan = planWarmup({ baseUrl: 'not a url', argv: [], html: HTML });
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('not a URL');
  });

  it('skips a base URL that parses but is not http(s)', () => {
    const plan = planWarmup({ baseUrl: 'localhost:5173', argv: [], html: HTML });
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('not http(s)');
  });

  it('skips a non-http scheme', () => {
    const plan = planWarmup({ baseUrl: 'file:///tmp/app', argv: [], html: HTML });
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('not http(s)');
  });

  it('skips --list, which runs no tests against a server', () => {
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: ['--list'], html: HTML });
    expect(plan.url).toBeNull();
    expect(plan.reason).toContain('--list');
  });
});

describe('runWarmup', () => {
  it('requests the module entry once and reports success', async () => {
    const d = deps();
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    const result = await runWarmup(plan, d);

    expect(result.warmed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.reason).toContain('answered 200');
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('http://localhost:5173/src/main.tsx');
  });

  it('retries until the entry answers', async () => {
    const fetchMock = vi
      .fn<() => Promise<typeof ok>>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ok);
    let clock = 0;
    const d = deps({
      fetch: fetchMock,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    const result = await runWarmup(plan, d);

    expect(result.warmed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('retries a non-2xx response as well as a rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(ok);
    const d = deps({ fetch: fetchMock });
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });

    expect((await runWarmup(plan, d)).warmed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up at the deadline, names the last error, and does NOT throw', async () => {
    // The clock advances on every sleep, so the bounded deadline is what ends the
    // loop — and the rejected fetch is what the message has to name, because
    // "warm-up did not help" is useless on its own in a failure report.
    let clock = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      now: () => clock,
      timeoutMs: 100,
      intervalMs: 50,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    const result = await runWarmup(plan, d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.reason).toContain('ECONNREFUSED');
    expect(result.reason).toContain('continuing');
  });

  it('makes no request at all when the budget is already spent', async () => {
    const d = deps({ timeoutMs: 0 });
    const result = await runWarmup(planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML }), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBe(0);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('bounds the retry loop by the clock, not by an attempt count', async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    const d = deps({
      fetch: fetchMock,
      timeoutMs: 100,
      intervalMs: 25,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    const result = await runWarmup(plan, d);

    expect(result.warmed).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(clock).toBeLessThanOrEqual(100);
  });

  it('makes no request at all when the plan skipped', async () => {
    const d = deps();
    const result = await runWarmup(planWarmup({ baseUrl: undefined, argv: [], html: HTML }), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBe(0);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('sends no sec-fetch-dest, so the request is judged purely on the module path', async () => {
    const d = deps();
    const plan = planWarmup({ baseUrl: 'http://localhost:5173', argv: [], html: HTML });
    await runWarmup(plan, d);

    const init = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['sec-fetch-dest']).toBeUndefined();
    expect(init.headers.accept).toBe('*/*');
  });

  it('exports finite, non-zero bounds', () => {
    expect(WARMUP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(WARMUP_TIMEOUT_MS)).toBe(true);
    expect(WARMUP_INTERVAL_MS).toBeGreaterThan(0);
  });
});
