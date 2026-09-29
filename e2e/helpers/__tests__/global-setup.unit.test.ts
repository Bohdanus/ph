import type { FullConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import globalSetup, {
  PER_ATTEMPT_TIMEOUT_MS,
  planWarmup,
  resolvedBaseUrl,
  resolvedWebServerUrl,
  runWarmup,
  WARMUP_INTERVAL_MS,
  WARMUP_TIMEOUT_MS,
} from '../../global-setup';

/**
 * This file tests `e2e/global-setup.ts`, which is NOT a helper module, and it lives
 * here anyway. The reason is the collector plus the convention:
 * `vitest.e2e.config.ts` includes every `*.unit.test.ts` under a `__tests__` directory
 * anywhere in `e2e/`, and `playwright.config.ts` `testIgnore`s every `__tests__`
 * directory, so any such directory under `e2e/` would be collected by the
 * node-environment project and skipped by Playwright — and this is where every other
 * e2e unit test already lives, so it runs under the same command, the same CI job and
 * the same coverage report as the rest.
 *
 * An earlier version of this note gave a different reason: that a module existing only
 * to be tested would break `e2e/README.md`'s statement that every helper module appears
 * in the coverage report. That was a non-sequitur — a new `e2e/helpers/warmup.ts`
 * would simply have appeared in the report — and it was the reason the location went
 * unexamined, so it is recorded here as wrong rather than quietly replaced.
 *
 * Every case below runs against injected `fetch` / `now` / `sleep` /
 * `abortSignal`. Nothing in this file opens a socket or a browser. The one real
 * clock this code would otherwise reach for is `AbortSignal.timeout()`, which
 * allocates a Node timer per attempt, so it is injected too: asserting on it (see
 * the hanging-attempt case) is only possible because the test owns the factory.
 */

const HTML = '<html><body><script type="module" src="/src/main.tsx"></script></body></html>';

type WarmupDeps = Parameters<typeof runWarmup>[1];
type FetchResponse = Awaited<ReturnType<WarmupDeps['fetch']>>;

/** What a Vite dev server actually answers a transformed `.tsx` request with. */
const ok: FetchResponse = { ok: true, status: 200, contentType: 'text/javascript' };

/** What it answers a path that is not a module with: the SPA fallback. */
const spaFallback: FetchResponse = { ok: true, status: 200, contentType: 'text/html' };

const failure = (status: number): FetchResponse => ({
  ok: false,
  status,
  contentType: 'text/plain',
});

function deps(overrides: Partial<WarmupDeps> = {}): WarmupDeps {
  return {
    fetch: vi.fn(async () => ok),
    now: () => 0,
    sleep: vi.fn(async () => {}),
    abortSignal: () => new AbortController().signal,
    timeoutMs: 1000,
    intervalMs: 1,
    ...overrides,
  };
}

function plan(overrides: Partial<Parameters<typeof planWarmup>[0]> = {}) {
  return planWarmup({
    baseUrl: 'http://localhost:5173',
    webServerUrl: 'http://localhost:5173',
    html: HTML,
    ...overrides,
  });
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
      expect(planWarmup({ baseUrl: base, webServerUrl: undefined, html: HTML }).url).toBeNull();
    } finally {
      if (previous !== undefined) process.env.PLAYWRIGHT_BASE_URL = previous;
    }
  });
});

describe('resolvedWebServerUrl', () => {
  it('reads the URL out of the webServer block', () => {
    const config = { webServer: { command: 'npm run dev', url: 'http://localhost:5432' } } as FullConfig;
    expect(resolvedWebServerUrl(config)).toBe('http://localhost:5432');
  });

  // `playwright/lib/common/index.js:541-549`: an ARRAY of servers leaves
  // `config.webServer` null, and a `port`-only block has no `url` at all.
  it('is undefined for an array of servers or a port-only block', () => {
    expect(resolvedWebServerUrl({ webServer: null })).toBeUndefined();
    expect(
      resolvedWebServerUrl({ webServer: { command: 'npm run dev', port: 5173 } } as unknown as FullConfig)
    ).toBeUndefined();
  });
});

describe('planWarmup', () => {
  it('builds a module-entry URL from the base URL, not the base URL itself', () => {
    expect(plan().url).toBe('http://localhost:5173/src/main.tsx');
  });

  it('derives the entry from index.html rather than assuming it', () => {
    expect(plan({ html: HTML.replace('/src/main.tsx', '/src/entry.ts') }).url).toBe(
      'http://localhost:5173/src/entry.ts'
    );
  });

  it('matches the module script when `src` comes before `type`', () => {
    // The removed single-regex version required type-before-src, so this file
    // parsed as "no module script found" and silently fell back.
    const html = '<html><body><script src="/src/late.tsx" type="module"></script></body></html>';
    expect(plan({ html }).url).toBe('http://localhost:5173/src/late.tsx');
  });

  it('skips a non-module script that happens to come first', () => {
    // `index.html` itself has an inline GTM <script> with neither attribute, and a
    // page may have a plain external one ahead of the module.
    const html =
      '<html><body><script>gtm()</script>' +
      '<script src="https://example.test/analytics.js"></script>' +
      '<script type="module" src="/src/main.tsx"></script></body></html>';
    expect(plan({ html }).url).toBe('http://localhost:5173/src/main.tsx');
  });

  it('picks the first module script when a page has two', () => {
    const html =
      '<html><body><script type="module" src="/src/first.ts"></script>' +
      '<script type="module" src="/src/second.ts"></script></body></html>';
    expect(plan({ html }).url).toBe('http://localhost:5173/src/first.ts');
  });

  it('accepts an unquoted type attribute', () => {
    expect(plan({ html: '<script type=module src="/src/main.tsx"></script>' }).url).toBe(
      'http://localhost:5173/src/main.tsx'
    );
  });

  it('falls back to the known entry when index.html cannot be read', () => {
    const skipped = plan({ html: null });
    expect(skipped.url).toBe('http://localhost:5173/src/main.tsx');
    expect(skipped.reason).toContain('/src/main.tsx');
  });

  it('skips with no base URL', () => {
    const skipped = planWarmup({ baseUrl: undefined, webServerUrl: undefined, html: HTML });
    expect(skipped.url).toBeNull();
    expect(skipped.reason).toContain('no base URL');
  });

  it('skips a whitespace-only base URL', () => {
    expect(planWarmup({ baseUrl: '   ', webServerUrl: undefined, html: HTML }).url).toBeNull();
  });

  it('skips a base URL that is not a URL', () => {
    // `new URL('localhost:5173')` does NOT throw — it parses with the scheme
    // `localhost:` — which is why there is a separate scheme check below and why
    // this case uses a string that genuinely cannot be parsed.
    const skipped = planWarmup({ baseUrl: 'not a url', webServerUrl: undefined, html: HTML });
    expect(skipped.url).toBeNull();
    expect(skipped.reason).toContain('not a URL');
  });

  it('skips a base URL that parses but is not http(s)', () => {
    const skipped = planWarmup({ baseUrl: 'localhost:5173', webServerUrl: undefined, html: HTML });
    expect(skipped.url).toBeNull();
    expect(skipped.reason).toContain('not http(s)');
  });

  it('skips a non-http scheme', () => {
    const skipped = planWarmup({ baseUrl: 'file:///tmp/app', webServerUrl: undefined, html: HTML });
    expect(skipped.url).toBeNull();
    expect(skipped.reason).toContain('not http(s)');
  });

  describe('the remote workflow', () => {
    // `e2e/README.md:139-144` documents
    // `PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e`, which
    // moves `use.baseURL` and leaves `webServer.url` on localhost. The warm-up
    // used to follow the base URL and ask staging for a module it does not serve.
    it('skips when the tests are pointed away from the server this run started', () => {
      const skipped = plan({ baseUrl: 'https://staging.example.com' });
      expect(skipped.url).toBeNull();
      expect(skipped.reason).toContain('staging.example.com');
      expect(skipped.reason).toContain('localhost:5173');
    });

    it('warms when the two differ only by path on the same origin', () => {
      expect(plan({ baseUrl: 'http://localhost:5173/app/' }).url).toBeNull(); // entry is root-absolute
      expect(
        plan({ baseUrl: 'http://localhost:5173/app/', html: HTML.replace('/src/main.tsx', './src/main.tsx') }).url
      ).toBe('http://localhost:5173/app/src/main.tsx');
    });

    it('does not gate on a webServer block that has no usable url', () => {
      expect(plan({ webServerUrl: undefined }).url).toBe('http://localhost:5173/src/main.tsx');
      expect(plan({ webServerUrl: 'nonsense' }).url).toBe('http://localhost:5173/src/main.tsx');
    });
  });

  describe('a base path the entry would escape', () => {
    it('skips a root-absolute entry under a sub-path base URL', () => {
      // `new URL('/src/main.tsx', 'http://h/app')` is `http://h/src/main.tsx`:
      // the leading slash silently discards `/app`.
      const skipped = plan({ baseUrl: 'http://localhost:5173/app' });
      expect(skipped.url).toBeNull();
      expect(skipped.reason).toContain('outside the base path /app/');
    });

    it('skips rather than throws on a module entry that is not a URL', () => {
      // A malformed `src` in `index.html` must not take down the run: the whole
      // contract of this component is that it never fails the suite.
      const skipped = plan({ html: '<script type="module" src="http://[bad"></script>' });
      expect(skipped.url).toBeNull();
      expect(skipped.reason).toContain('is not a URL');
    });
  });
});

describe('runWarmup', () => {
  it('requests the module entry once and reports success', async () => {
    const d = deps();
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.reason).toContain('answered HTTP 200');
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('http://localhost:5173/src/main.tsx');
  });

  describe('an HTML body is not a warm server', () => {
    // A Vite dev server does not 404 a path that is not there; the SPA fallback
    // answers 200 with text/html. Reporting that as a success is a log line
    // claiming a cold server is warm, having transformed nothing.
    it('does NOT report warmed for a 200 with an HTML content type', async () => {
      const d = deps({ fetch: vi.fn(async () => spaFallback) });
      const result = await runWarmup(plan(), d);

      expect(result.warmed).toBe(false);
      expect(result.reason).toContain('SPA fallback');
      expect(result.reason).toContain('nothing was transformed');
    });

    it('does not retry it, because retrying cannot change which handler answers', async () => {
      const d = deps({ fetch: vi.fn(async () => spaFallback) });
      await runWarmup(plan(), d);

      expect(d.fetch).toHaveBeenCalledTimes(1);
    });

    it('is content-type based, not status based: a 206 with JS is a warm server', async () => {
      const d = deps({
        fetch: vi.fn(async () => ({ ok: true, status: 206, contentType: 'text/javascript; charset=utf-8' })),
      });
      expect((await runWarmup(plan(), d)).warmed).toBe(true);
    });
  });

  it('retries until the entry answers', async () => {
    const fetchMock = vi
      .fn<() => Promise<FetchResponse>>()
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
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('retries a non-2xx response as well as a rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(failure(503)).mockResolvedValueOnce(ok);
    const d = deps({ fetch: fetchMock });

    expect((await runWarmup(plan(), d)).warmed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([404, 410])('stops on a terminal HTTP %i instead of paying the whole budget', async (status) => {
    // Before this, a remote/staging run retried 404 every 250ms for the full
    // deadline: sixty seconds added to a workflow nobody had changed.
    let clock = 0;
    const d = deps({
      fetch: vi.fn(async () => failure(status)),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const result = await runWarmup(
      plan({ baseUrl: 'https://staging.example.com', webServerUrl: 'https://staging.example.com' }),
      d
    );

    expect(result.warmed).toBe(false);
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expect(result.reason).toContain(`HTTP ${status}`);
    expect(result.reason).toContain('no retry will change');
  });

  it('caps each attempt at PER_ATTEMPT_TIMEOUT_MS so a hang still leaves a retry', async () => {
    // `AbortSignal.timeout(remaining)` handed attempt 1 the whole budget: a server
    // that accepts and then hangs burned all of it there, and the loop's
    // `now() + interval >= deadline` check then broke on the first pass, so no
    // retry ever happened. The injected factory is what makes the cap observable —
    // with the real `AbortSignal.timeout` a test cannot tell a capped abort from a
    // budget-sized one, which is why the code is written this way and not inlined.
    let clock = 0;
    const fetchMock = vi
      .fn<() => Promise<FetchResponse>>()
      .mockImplementationOnce(async () => {
        // A hang: the only thing that ends it is this attempt's own abort signal,
        // and it cannot have cost more than the cap.
        clock += PER_ATTEMPT_TIMEOUT_MS;
        throw new DOMException('The operation was aborted.', 'TimeoutError');
      })
      .mockResolvedValue(ok);
    const d = deps({
      fetch: fetchMock,
      now: () => clock,
      timeoutMs: 5000,
      intervalMs: 10,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const result = await runWarmup(plan(), d);

    // The hang did not end the run: attempt 2 ran, and the loop returned warm.
    expect(result.warmed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('names the abort when a hang eats the whole budget', async () => {
    // The other end of the same cap: a server that hangs on every attempt, so the
    // report has to say the attempt was aborted rather than "no response".
    let clock = 0;
    const d = deps({
      fetch: vi.fn(async () => {
        clock += PER_ATTEMPT_TIMEOUT_MS;
        throw new DOMException('The operation was aborted.', 'TimeoutError');
      }),
      now: () => clock,
      timeoutMs: 5000,
      intervalMs: 10,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.reason).toContain('The operation was aborted.');
    expect(result.reason).toContain('continuing');
  });

  it('asks the signal factory for min(remaining, PER_ATTEMPT_TIMEOUT_MS)', async () => {
    const budgets: number[] = [];
    let clock = 0;
    const d = deps({
      fetch: vi.fn(async () => failure(500)),
      abortSignal: (ms) => {
        budgets.push(ms);
        return new AbortController().signal;
      },
      now: () => clock,
      // Larger than the cap, so the first call is the cap and not the remainder.
      timeoutMs: 6000,
      intervalMs: 100,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    await runWarmup(plan(), d);

    expect(budgets.length).toBeGreaterThan(2);
    expect(budgets[0]).toBe(PER_ATTEMPT_TIMEOUT_MS);
    // Each retry is handed what is left, and never more than the cap.
    expect(budgets.at(-1)).toBeGreaterThan(0);
    expect(budgets.at(-1)).toBeLessThan(budgets[0]);
    expect(Math.max(...budgets)).toBe(PER_ATTEMPT_TIMEOUT_MS);
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
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.reason).toContain('ECONNREFUSED');
    expect(result.reason).toContain('continuing');
  });

  it('makes no request at all when the budget is already spent', async () => {
    const d = deps({ timeoutMs: 0 });
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBe(0);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('bounds the retry loop by the clock, not by an attempt count', async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () => failure(500));
    const d = deps({
      fetch: fetchMock,
      timeoutMs: 100,
      intervalMs: 25,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const result = await runWarmup(plan(), d);

    expect(result.warmed).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(clock).toBeLessThanOrEqual(100);
  });

  it('makes no request at all when the plan skipped', async () => {
    const d = deps();
    const result = await runWarmup(plan({ baseUrl: undefined }), d);

    expect(result.warmed).toBe(false);
    expect(result.attempts).toBe(0);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('sends no sec-fetch-dest, so the request is judged purely on the module path', async () => {
    const d = deps();
    await runWarmup(plan(), d);

    const init = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['sec-fetch-dest']).toBeUndefined();
    expect(init.headers.accept).toBe('*/*');
  });

  it('exports finite, non-zero bounds', () => {
    expect(WARMUP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(WARMUP_TIMEOUT_MS)).toBe(true);
    expect(WARMUP_INTERVAL_MS).toBeGreaterThan(0);
    expect(PER_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(0);
    // Twenty attempts at 250ms, and a per-attempt cap that cannot exceed the whole
    // budget — the two numbers are the cost of a permanently wrong entry, so they
    // are asserted rather than left to a comment.
    expect(WARMUP_TIMEOUT_MS / WARMUP_INTERVAL_MS).toBeLessThanOrEqual(25);
    expect(PER_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(WARMUP_TIMEOUT_MS);
  });
});

describe('globalSetup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PLAYWRIGHT_ALLOW_HEADED;
  });

  const config = (overrides: Record<string, unknown> = {}) =>
    ({
      argv: [],
      projects: [{ name: 'Google Chrome', use: { baseURL: 'http://localhost:5173', headless: true } }],
      webServer: { command: 'npm run dev', url: 'http://localhost:5173' },
      ...overrides,
    }) as unknown as FullConfig;

  it('refuses a visible browser BEFORE spending anything on the warm-up', async () => {
    // The ordering is the one behaviour the diff calls out in a comment, and moving
    // the warm-up above the refusal would pass every other test in this file: the
    // refusal is the only thing here that throws, so a warm-up that ran first would
    // still end in the same thrown error, just after a full cold transform.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(globalSetup(config({ argv: ['--headed'] }))).rejects.toThrow(
      /Refusing to start a run with a visible browser/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a project that resolves to headless: false, also before the warm-up', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const headed = config({
      projects: [{ name: 'Google Chrome', use: { baseURL: 'http://localhost:5173', headless: false } }],
    });
    await expect(globalSetup(headed)).rejects.toThrow(/headless: false/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('warms when nothing refuses the run', async () => {
    // Typed as the real `fetch`, because `globalSetup` wraps the global and reads
    // `ok` / `status` / `headers` off whatever this returns.
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });

    try {
      await globalSetup(config());
    } finally {
      log.mockRestore();
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:5173/src/main.tsx');
    expect(lines.join('\n')).toContain('warmed the dev server');
  });
});
