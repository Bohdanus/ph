import type { FullConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import globalSetup, {
  checkHtmlOpenEnv,
  checkHtmlReporterSelection,
  checkOwnServer,
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
  it('takes the FIRST project that declares one, not the last', () => {
    // Every other case in this file and in `globalSetup` builds a single-project config,
    // so a resolver that walked to the end of the list, or that preferred the env
    // variable over a merged project value, answers the same number on all of them. The
    // config has one project today; a second one must not be able to move the origin the
    // whole suite is checked against without a test going red.
    const config = {
      projects: [project({ baseURL: 'http://localhost:5413' }), project({ baseURL: 'https://staging.example.com' })],
    };

    expect(resolvedBaseUrl(config)).toBe('http://localhost:5413');
  });

  it('skips a project whose base URL is an empty string rather than returning it', () => {
    // `FullConfig.use.baseURL` is typed as a string, so an empty one is representable and
    // would otherwise become `''` — which `checkOwnServer` reads as "no base URL" and
    // permits, skipping the origin check for the very run it exists to catch.
    const config = { projects: [project({ baseURL: '' }), project({ baseURL: 'http://localhost:5413' })] };

    expect(resolvedBaseUrl(config)).toBe('http://localhost:5413');
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

describe('checkOwnServer', () => {
  // This is the load-bearing half of the guarantee, and it lives here rather than in
  // `scripts/e2e-run.mjs` because THIS module runs for every `playwright test`
  // invocation whatever started it. The wrapper refuses the same thing, but
  // `npm run test:e2e:raw` and the CI job's bare `npx playwright test` never load it,
  // and `playwright.config.ts` resolves `use.baseURL` from `PLAYWRIGHT_BASE_URL`
  // itself — so a refusal that lived only in the wrapper was one command away from
  // being false, and the guarantee was a convention.
  it('permits a run whose tests load the dev server it started', () => {
    expect(
      checkOwnServer({
        baseUrl: 'http://localhost:5391',
        webServerUrl: 'http://localhost:5391',
        allowRemote: undefined,
      })
    ).toMatchObject({ permitted: true });
  });

  it('permits an explicit base URL that NAMES the same server', () => {
    // Origins, not strings: `PLAYWRIGHT_BASE_URL=http://localhost:5173` with a dev
    // server on 5173 is the same server. A string comparison would refuse it, which
    // is how a guard becomes something agents learn to route around.
    expect(
      checkOwnServer({
        baseUrl: 'http://localhost:5173',
        webServerUrl: 'http://localhost:5173',
        allowRemote: undefined,
      })
    ).toMatchObject({ permitted: true });
  });

  it('refuses a run pointed at another origin', () => {
    const check = checkOwnServer({
      baseUrl: 'https://staging.example.com',
      webServerUrl: 'http://localhost:5391',
      allowRemote: undefined,
    });
    expect(check.permitted).toBe(false);
    expect(check.reason).toMatch(/staging\.example\.com/);
    expect(check.reason, 'and says which server this run did start').toMatch(/5391/);
  });

  it('refuses a different PORT on the same host, which is a different server', () => {
    expect(
      checkOwnServer({
        baseUrl: 'http://localhost:5174',
        webServerUrl: 'http://localhost:5173',
        allowRemote: undefined,
      }).permitted
    ).toBe(false);
  });

  it('permits it when the run says it means a remote build, and says so in the reason', () => {
    const check = checkOwnServer({
      baseUrl: 'https://staging.example.com',
      webServerUrl: 'http://localhost:5391',
      allowRemote: '1',
    });
    expect(check.permitted).toBe(true);
    // The reason is logged on every permitted run, so a report can never imply a
    // local verification of a remote run.
    expect(check.reason).toMatch(/E2E_ALLOW_REMOTE=1/);
    expect(check.reason).toMatch(/NOT this checkout/);
  });

  it('does not claim a guarantee it could not check', () => {
    // No `webServer` block means nothing was started, so there is no origin to
    // compare against. Saying so beats reporting a verification that never happened.
    expect(
      checkOwnServer({ baseUrl: 'https://staging.example.com', webServerUrl: undefined, allowRemote: undefined })
    ).toMatchObject({ permitted: true, reason: expect.stringMatching(/could not verify/) });
  });
  it('refuses a base URL it cannot parse into an origin at all', () => {
    // The branch the header calls out as "the one branch that used to permit". A
    // `file:///…/other-checkout/dist` is reachable by typing, it has no origin to compare,
    // and permitting it let a run navigate somebody else's built checkout while logging
    // "no base URL is configured, so there is no origin to verify" — a guarantee the
    // check had not made. Untested, so deleting the refusal failed nothing.
    const check = checkOwnServer({
      baseUrl: 'file:///Users/somebody/other-checkout/dist',
      webServerUrl: 'http://localhost:5391',
      allowRemote: undefined,
    });

    expect(check.permitted).toBe(false);
    expect(check.reason).toMatch(/not an http\(s\) URL/);
  });

  it('refuses a base URL that is not a URL at all', () => {
    expect(
      checkOwnServer({ baseUrl: 'not a url', webServerUrl: 'http://localhost:5391', allowRemote: undefined }).permitted
    ).toBe(false);
  });

  it('treats a whitespace-only base URL as no base URL, the way planWarmup does', () => {
    // Both readers of the merged config trim, and the second one losing the trim is a
    // FALSE POSITIVE: `planWarmup` would skip on `'   '` while `checkOwnServer` reached
    // `parseHttpUrl('   ')`, could not parse it, and refused every run instead.
    expect(
      checkOwnServer({ baseUrl: '   ', webServerUrl: 'http://localhost:5391', allowRemote: undefined })
    ).toMatchObject({ permitted: true, reason: expect.stringMatching(/no base URL/) });
  });

  it('permits a whitespace-only base URL even when the run is pointed at another origin', () => {
    // The companion of the case above: with no base URL there is no destination to be
    // wrong about, so this must not be a refusal — and it must not depend on the
    // `E2E_ALLOW_REMOTE` hatch, which is not set here.
    expect(process.env.E2E_ALLOW_REMOTE).toBeUndefined();
    expect(
      checkOwnServer({ baseUrl: '  ', webServerUrl: 'https://staging.example.com', allowRemote: undefined }).permitted
    ).toBe(true);
  });
});

describe('checkHtmlOpenEnv', () => {
  // The whole reason this exists: `HtmlReporter._resolveOptions()` computes
  // `open: getHtmlReportOptionProcessEnv() || this._options.open || "on-failure"`
  // (playwright/lib/runner/index.js:3450), and `getHtmlReportOptionProcessEnv()` is
  // `process.env.PLAYWRIGHT_HTML_OPEN || process.env.PW_TEST_HTML_REPORT_OPEN` (:3511).
  // So either variable outranks the `open: 'never'` this repository configures, and the
  // refused run ends in `showHTMLReport` → a browser window and
  // `await new Promise(() => {})` (:3581-3585), which never resolves.
  it.each(['PLAYWRIGHT_HTML_OPEN', 'PW_TEST_HTML_REPORT_OPEN'])('refuses %s set to always', (variable) => {
    const hazard = checkHtmlOpenEnv({ [variable]: 'always' });

    expect(hazard).not.toBeNull();
    expect(hazard?.cause).toContain(variable);
    // The message quotes the token, so the reader can see what the run actually typed.
    expect(hazard?.cause).toContain('always');
    expect(hazard?.why).toContain('playwright.config.ts');
  });

  it.each(['PLAYWRIGHT_HTML_OPEN', 'PW_TEST_HTML_REPORT_OPEN'])('refuses %s set to on-failure', (variable) => {
    // This is the value a typo silently becomes: `getHtmlReportOptionProcessEnv()`
    // prints a Configuration Error for an unknown value and returns undefined, leaving
    // the `"on-failure"` fall-through in place (runner/index.js:3514-3517). So an
    // invalid value is not a safe value.
    expect(checkHtmlOpenEnv({ [variable]: 'on-failure' })).not.toBeNull();
    expect(checkHtmlOpenEnv({ [variable]: 'yes' })).not.toBeNull();
  });

  it('permits "never", which is the one value that opens nothing', () => {
    // `htmlReportOptions` is exactly ['always', 'never', 'on-failure'] (:3401), so
    // refusing `never` would be refusing the honest spelling of the intent.
    expect(checkHtmlOpenEnv({ PLAYWRIGHT_HTML_OPEN: 'never' })).toBeNull();
    expect(checkHtmlOpenEnv({ PW_TEST_HTML_REPORT_OPEN: 'never' })).toBeNull();
  });

  it('permits an unset variable, and an empty one, which Playwright reads as unset', () => {
    // `if (!htmlOpenEnv) return void 0` (runner/index.js:3513): an empty string is falsy
    // and cannot open anything, so refusing it would be refusing nothing.
    expect(checkHtmlOpenEnv({})).toBeNull();
    expect(checkHtmlOpenEnv({ PLAYWRIGHT_HTML_OPEN: '' })).toBeNull();
    expect(checkHtmlOpenEnv({ PLAYWRIGHT_HTML_OPEN: undefined })).toBeNull();
  });

  it('reports the documented variable first when both are set', () => {
    const hazard = checkHtmlOpenEnv({
      PLAYWRIGHT_HTML_OPEN: 'always',
      PW_TEST_HTML_REPORT_OPEN: 'always',
    });

    expect(hazard?.cause).toContain('PLAYWRIGHT_HTML_OPEN');
  });
});

describe('checkHtmlReporterSelection', () => {
  const at = (name: string) => ({ argv: ['node', 'playwright', name], env: {} });

  it('refuses `--reporter=html`, which discards the configured open: never', () => {
    // `[...takeFirst(configCLIOverrides.reporter, resolveReporters(userConfig.reporter, …))]`
    // at playwright/lib/common/index.js:522: `takeFirst` means the CLI value WINS
    // OUTRIGHT. The replacement is `[['html']]`, which carries no options, so
    // `_resolveOptions()` falls through to "on-failure".
    expect(checkHtmlReporterSelection(at('--reporter=html'))).not.toBeNull();
  });

  it('refuses `--add-reporter=html`, which appends one with no open option', () => {
    // Not the same mechanism — this one keeps the configured reporters and adds a second
    // HtmlReporter — but it reaches the same constructor with an empty `_options.open`.
    expect(checkHtmlReporterSelection(at('--add-reporter=html'))).not.toBeNull();
  });

  it('refuses the space-separated spelling, which is the same option', () => {
    expect(checkHtmlReporterSelection({ argv: ['node', 'playwright', '--reporter', 'html'], env: {} })).not.toBeNull();
    expect(
      checkHtmlReporterSelection({ argv: ['node', 'playwright', '--add-reporter', 'html'], env: {} })
    ).not.toBeNull();
  });

  it('refuses html anywhere in a comma-separated list', () => {
    // `--reporter=html,line` names html and opens exactly like `--reporter=html`; a
    // check that only matched the whole value would pass it.
    expect(checkHtmlReporterSelection(at('--reporter=html,line'))).not.toBeNull();
    expect(checkHtmlReporterSelection(at('--reporter=line,html'))).not.toBeNull();
  });

  it('permits a reporter list that does not name html', () => {
    expect(checkHtmlReporterSelection(at('--reporter=list'))).toBeNull();
    expect(checkHtmlReporterSelection(at('--reporter=dot,json'))).toBeNull();
    expect(checkHtmlReporterSelection(at('--add-reporter=list'))).toBeNull();
    expect(checkHtmlReporterSelection(at('--reporter=./helpers/my-reporter.ts'))).toBeNull();
  });

  it('permits the safe reporter flags this suite already passes', () => {
    expect(checkHtmlReporterSelection({ argv: ['node', 'playwright', '--reporter=list'], env: {} })).toBeNull();
    expect(checkHtmlReporterSelection({ argv: ['node', 'playwright', '--grep', 'html'], env: {} })).toBeNull();
  });

  it('ignores a `--reporter=html` that is really a positional filter after `--`', () => {
    // commander stops parsing options at a bare `--` (program.js:51-52), so anything
    // after it selects tests. Refusing a grep filter would be refusing a legitimate way
    // to choose a subset of the suite.
    expect(checkHtmlReporterSelection({ argv: ['node', 'playwright', '--', '--reporter=html'], env: {} })).toBeNull();
  });

  it('refuses PW_TEST_REPORTER naming html', () => {
    // `runner/index.js:5221-5228` appends a reporter built from `reporterCommandOptions`
    // and nothing else (:5250-5256), so `open` is absent and resolves to "on-failure".
    const hazard = checkHtmlReporterSelection({ argv: [], env: { PW_TEST_REPORTER: 'html' } });

    expect(hazard?.cause).toContain('PW_TEST_REPORTER');
  });

  it('permits PW_TEST_REPORTER naming anything else, or nothing', () => {
    expect(checkHtmlReporterSelection({ argv: [], env: { PW_TEST_REPORTER: 'list' } })).toBeNull();
    expect(checkHtmlReporterSelection({ argv: [], env: {} })).toBeNull();
  });

  it('does not confuse the two environment variables it reads', () => {
    // The refusal exists to stop the HTML reporter opening, not to stop someone naming
    // a reporter; a variable that has nothing to do with reporters must pass through.
    expect(checkHtmlReporterSelection({ argv: [], env: { PLAYWRIGHT_HTML_OPEN: 'always' } })).toBeNull();
    expect(checkHtmlReporterSelection({ argv: [], env: { PW_TEST_HTML_REPORT_OPEN: 'never' } })).toBeNull();
  });

  it('survives a trailing --reporter with no value at all', () => {
    // commander would reject it, and this must not be the thing that throws.
    expect(checkHtmlReporterSelection({ argv: ['node', 'playwright', '--reporter'], env: {} })).toBeNull();
  });
});

/**
 * The reporter a CLI flag put on the command line, reimplemented against the current
 * API. The salvage pinned a `cliReporterOverride` helper that no longer exists; this is
 * `checkHtmlReporterSelection`, and every case below is the same hazard expressed
 * through the function `globalSetup` actually calls.
 *
 * Two of the salvaged expectations were WRONG about the platform and are asserted the
 * other way round here, with the Playwright source that decides them: `takeFirst` makes
 * the FIRST `--reporter` win (not the last), and `resolveReporter` matches the built-in
 * name exactly (no case folding, no trimming).
 */
describe('the reporter a CLI flag names', () => {
  const selection = (...argv: string[]) => checkHtmlReporterSelection({ argv, env: {} });

  it('reports nothing for a command line with no reporter flag', () => {
    expect(selection()).toBeNull();
    expect(selection('test')).toBeNull();
    // The filename case matters: `npx playwright test --ui=html` is not a reporter flag,
    // and a `startsWith('reporter')` match would call it one.
    expect(selection('test', 'e2e/levels.spec.ts')).toBeNull();
    expect(selection('test', '--ui=html')).toBeNull();
    expect(selection('test', '--headed')).toBeNull();
  });

  it('quotes the flag and value into the cause, in the space-separated spelling', () => {
    // `--reporter html` and `--reporter=html` reach the same place, and the second form
    // is the one a copy-pasted command from CI produces.
    expect(selection('--reporter', 'html')?.cause).toBe('--reporter html');
    expect(selection('--reporter=html')?.cause).toBe('--reporter html');
    expect(selection('--add-reporter', 'html')?.cause).toBe('--add-reporter html');
    expect(selection('--add-reporter=html')?.cause).toBe('--add-reporter html');
  });

  it('says which of the two flags it was, because they are different holes', () => {
    // `--add-reporter` LEAVES the configured `open: 'never'` in place and adds a second
    // `html` reporter with default options — so the run has one that never opens and one
    // that opens on failure. A guard reading only `--reporter` permits it.
    expect(selection('--add-reporter', 'html')?.why).toContain('adds to');
    expect(selection('--reporter', 'html')?.why).toContain('replaces');
  });

  it('reports the FIRST --reporter, because that is the one that replaces the list', () => {
    // The salvage asserted the LAST. `common/index.js` resolves the CLI list with
    // `takeFirst(configCLIOverrides.reporter, …)`, so the first `--reporter` on the
    // command line is the one that decides what runs — reporting the last would name a
    // reporter this run does not use, and would still be right only by accident.
    expect(selection('--reporter', 'html', '--reporter', 'list')?.cause).toBe('--reporter html');
    // And a trailing non-html `--reporter` never reaches the loop's decision at all,
    // because the earlier one already named the opening reporter.
    expect(selection('--reporter', 'list', '--reporter', 'html')?.cause).toBe('--reporter html');
  });

  it('does not case-fold or trim, because Playwright matches the built-in name exactly', () => {
    // The salvage asserted these were NORMALISED into a match. They must not be:
    // `resolveReporter` tests `builtInReporters.includes(id)`, so `HTML` is not the html
    // reporter to Playwright either — it tries `require.resolve('HTML')` and fails
    // loudly, and refusing it here would replace an accurate error with a misleading
    // one.
    expect(selection('--reporter', 'HTML')).toBeNull();
    expect(selection('--reporter', ' HTML ')).toBeNull();
    expect(selection('--reporter', 'list,,')).toBeNull();
    expect(selection('--reporter', ' , html ,')).toBeNull();
  });

  it('does not treat a reporter path as the built-in html reporter', () => {
    // A reporter may be a module path (`program.js:213`). A custom reporter cannot open a
    // window this guard can see, and one named `html.js` does not become the built-in —
    // so this has to stay a name comparison rather than a substring one.
    expect(selection('--reporter', './my-reporter.js')).toBeNull();
    expect(selection('--reporter=./html.js')).toBeNull();
  });

  it('yields nothing rather than throwing for a flag with no usable value', () => {
    // The function's contract is that it does not fail a run: the flag is invalid and
    // the runner's own parser has already said so by the time a window could exist, so
    // the only question that matters is whether one was requested.
    expect(selection('--reporter')).toBeNull();
    expect(selection('--add-reporter')).toBeNull();
    // `--reporter=` is a present flag with an empty value, so it names no reporter.
    expect(selection('--reporter=')).toBeNull();
  });

  it('does not consume the next argument when it is itself a flag', () => {
    // Commander stops at the next flag. Swallowing it would drop the flag from argv as
    // far as any later scan is concerned — and `--headed` is exactly the argument that
    // must survive to be noticed by its own check. Here the value is read as `--headed`,
    // which is not a reporter, so this refusal is silent and `--headed` is still refused
    // by the flag loop that reads the same array.
    const argv = ['--reporter', '--headed'];

    expect(selection(...argv)).toBeNull();
    expect(argv).toEqual(['--reporter', '--headed']);
  });
});

describe('globalSetup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.PLAYWRIGHT_ALLOW_HEADED;
    delete process.env.PLAYWRIGHT_BASE_URL;
    delete process.env.E2E_ALLOW_REMOTE;
    delete process.env.PLAYWRIGHT_HTML_OPEN;
    delete process.env.PW_TEST_HTML_REPORT_OPEN;
    delete process.env.PW_TEST_REPORTER;
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

  it('refuses --debug, which forces headless itself', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // A debug run both opens the inspector and forces `headless = false`, and it BLOCKS
    // until the window is closed, so the refusal has to arrive before either.
    await expect(globalSetup(config({ argv: ['--debug'] }))).rejects.toThrow(/Refusing to start a run with a visible/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names the flag that caused the refusal, so the message says what to remove', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(globalSetup(config({ argv: ['--debug'] }))).rejects.toThrow(/`--debug`/);
  });

  it.each(['--headed', '--debug'])('refuses %s even beside other arguments', async (flag) => {
    // The argv a real invocation carries: flags mixed with test filters and paths, which
    // is what makes an implementation that only inspects `argv[0]` plausible enough to be
    // written by accident.
    vi.stubGlobal('fetch', vi.fn());

    await expect(globalSetup(config({ argv: ['test', 'e2e/levels.spec.ts', '--grep', 'band', flag] }))).rejects.toThrow(
      /Refusing to start a run with a visible/
    );
  });

  it('does not claim to refuse --ui, because globalSetup never runs in UI mode', async () => {
    // The salvage asserted the opposite: that `--ui` is refused HERE because the
    // resolved-`headless` check cannot see it. It is not, and must not be —
    // `cli/testActions.js` returns from its `opts.ui` branch before the run path that
    // builds the global-setup tasks, so a `--ui` arm in this function could never fire
    // and would read as a guarantee it never provided. `kilo.jsonc` denies `*--ui*` on
    // the flag itself, which is the one layer that sees the command carrying it.
    //
    // This case pins that the two layers agree, so re-adding `--ui` to the flag list —
    // the "fix" a refactor reaches for — is a visible change to this file rather than a
    // silently dead branch, and so nobody reads the absence here as a hole.
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    // `headless: true` throughout, so the project check is silent too: with `--ui` not
    // in the flag list nothing refuses and the run reaches the warm-up.
    await expect(globalSetup(config({ argv: ['--ui'] }))).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses an HTML-report environment variable, also before the warm-up', async () => {
    // The hazard is a WINDOW and a process that never exits, so the refusal has to
    // arrive before Playwright's reporter `onEnd` — which is the only place
    // `_resolveOptions()` would finally read the variable.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('PLAYWRIGHT_HTML_OPEN', 'always');

    await expect(globalSetup(config())).rejects.toThrow(
      /Refusing to start a run that would open the HTML report and then never exit/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses PW_TEST_HTML_REPORT_OPEN as readily as the documented name', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('PW_TEST_HTML_REPORT_OPEN', 'always');

    await expect(globalSetup(config())).rejects.toThrow(/PW_TEST_HTML_REPORT_OPEN=always/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a CLI --reporter naming html, also before the warm-up', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(globalSetup(config({ argv: ['--reporter=html'] }))).rejects.toThrow(/--reporter html/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets a non-html reporter through, so the refusal is not a blunt instrument', async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    await globalSetup(config({ argv: ['--reporter=list'] }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses the HTML report even when the run is authorised to be headed', async () => {
    // `PLAYWRIGHT_ALLOW_HEADED=1` is the human's signature on the TESTS' browsers. It is
    // deliberately not a switch for the report viewer: widening one variable to mean two
    // things would make this guarantee depend on an `export`, which is the thing a model
    // under pressure will type.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('PLAYWRIGHT_ALLOW_HEADED', '1');
    vi.stubEnv('PLAYWRIGHT_HTML_OPEN', 'always');

    await expect(globalSetup(config())).rejects.toThrow(/never exit/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  /**
   * The HTML report is a window, and it is the window the config's `open: 'never'` does not
   * protect against: `getHtmlReportOptionProcessEnv()` is consulted FIRST and either of
   * these two variables REPLACES the configured value. So the guard is "set to a value that
   * opens something", not "set" — and neither variable was tested, so deleting either half
   * of that loop failed nothing and a red local run opened Chrome.
   */
  describe('the HTML report', () => {
    const refuses = async (): Promise<unknown> => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const thrown = await globalSetup(config()).then(
        () => 'resolved',
        (error: unknown) => error
      );
      expect(fetchSpy, 'the refusal must arrive before the warm-up').not.toHaveBeenCalled();
      return thrown;
    };

    it.each([
      ['PLAYWRIGHT_HTML_OPEN', 'always'],
      ['PLAYWRIGHT_HTML_OPEN', 'on-failure'],
      ['PW_TEST_HTML_REPORT_OPEN', 'always'],
      ['PW_TEST_HTML_REPORT_OPEN', 'on-failure'],
    ])('refuses %s=%s', async (name, value) => {
      vi.stubEnv(name, value);

      expect(await refuses()).toMatchObject({
        message: expect.stringContaining('Refusing to start a run that would open the HTML report and then never exit'),
      });
    });

    it.each([
      ['PLAYWRIGHT_HTML_OPEN', ' always '],
      ['PW_TEST_HTML_REPORT_OPEN', 'on-failure '],
    ])('refuses %s=%j, which is not the string `never`', async (name, value) => {
      // There is no trim on this path, and there must not be: Playwright hands the
      // variable's own bytes to the reporter's `open` option, so `' always '` opens the
      // report exactly as `always` does. A test written against a trimming
      // implementation would pass either way, so this states the rule the code has.
      vi.stubEnv(name, value);

      expect(await refuses()).toMatchObject({
        message: expect.stringContaining('Refusing to start a run that would open the HTML report and then never exit'),
      });
    });

    it('names the variable and its value in the message, and says it overrides the config', async () => {
      vi.stubEnv('PW_TEST_HTML_REPORT_OPEN', 'always');

      const thrown = await refuses();
      expect((thrown as Error).message).toContain('PW_TEST_HTML_REPORT_OPEN=always');
      expect((thrown as Error).message).toContain("open: 'never'");
    });

    it.each([
      ['PLAYWRIGHT_HTML_OPEN', 'never'],
      ['PW_TEST_HTML_REPORT_OPEN', 'never'],
      ['PLAYWRIGHT_HTML_OPEN', ''],
      ['PW_TEST_HTML_REPORT_OPEN', ''],
    ])('permits %s=%j, because the guard is the VALUE and not the presence', async (name, value) => {
      // The false-positive half: `never` is the configured value, and an empty value is
      // falsy, so Playwright reads it as unset. Refusing either would break every CI run
      // that happens to export one.
      vi.stubEnv(name, value);
      const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
        return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
      });
      vi.stubGlobal('fetch', fetchSpy);

      await expect(globalSetup(config())).resolves.toBeUndefined();
    });

    it.each([
      ['PLAYWRIGHT_HTML_OPEN', 'always-ish'],
      ['PW_TEST_HTML_REPORT_OPEN', 'NoNeVeR'],
      ['PLAYWRIGHT_HTML_OPEN', 'false'],
    ])('refuses %s=%j anyway, because an unrecognised value is not a safe value', async (name, value) => {
      // The salvage asserted these were PERMITTED, on the reasoning that an
      // unrecognised string must not refuse. It must, and this is why: `htmlReportOptions`
      // is exactly `['always', 'never', 'on-failure']`, so an unknown value makes the
      // reporter print a Configuration Error, return undefined, and leave the
      // `"on-failure"` fall-through in place — which opens the report. A guard that
      // permitted unknown values would be permitting exactly the runs that hang.
      vi.stubEnv(name, value);

      expect(await refuses()).toMatchObject({
        message: expect.stringContaining('Refusing to start a run that would open the HTML report and then never exit'),
      });
    });
  });

  it('refuses an html reporter named on the command line', async () => {
    // A CLI `--reporter` REPLACES the config's reporter list wholesale, so the
    // `open: 'never'` disappears with it and the replacement carries no options at all,
    // which resolves to `on-failure`. The guard is the only thing standing between that and
    // a window, and it is a DIFFERENT refusal from the environment-variable one because
    // the hazard arrives through a flag rather than an `export`.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(globalSetup(config({ argv: ['--reporter=html'] }))).rejects.toThrow(
      /Refusing to start a run that would open the HTML report and then never exit/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('permits a non-html reporter, which opens nothing', async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(globalSetup(config({ argv: ['--reporter=list'] }))).resolves.toBeUndefined();
  });

  /**
   * The escape hatch, and the exactness of its value.
   *
   * `PLAYWRIGHT_ALLOW_HEADED=1` is the operator's signature and `npm run test:e2e:headed`
   * is the only thing that sets it. It is untested, so an implementation that accepted any
   * truthy value would have handed the window to the exact failure the variable is named
   * against: a model that types `PLAYWRIGHT_ALLOW_HEADED=1` is stopped by `kilo.json`, but
   * one that types `PLAYWRIGHT_HEADED=1`, or `PLAYWRIGHT_ALLOW_HEADED=true`, or `=0`
   * expecting it to be inert, must not get a window either.
   */
  describe('the operator escape hatch', () => {
    const warm = async (): Promise<unknown> => {
      const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
        return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
      });
      vi.stubGlobal('fetch', fetchSpy);
      return globalSetup(config({ argv: ['--headed'] }));
    };

    it('lets the run through on exactly "1", so the documented workflow still works', async () => {
      vi.stubEnv('PLAYWRIGHT_ALLOW_HEADED', '1');

      await expect(warm()).resolves.toBeUndefined();
    });

    it.each(['0', '', 'true', 'yes', 'on', '01', ' 1 ', 'headless'])(
      'still refuses on %j rather than treating it as permission',
      async (value) => {
        // A truthiness read passes every one of these except `''`, so most of this list is
        // the mutant: `PLAYWRIGHT_ALLOW_HEADED=true` looks like permission to a human and
        // must not be permission to the guard.
        vi.stubEnv('PLAYWRIGHT_ALLOW_HEADED', value);

        await expect(warm()).rejects.toThrow(/Refusing to start a run with a visible/);
      }
    );

    it('does not read the near-miss variable an agent reaches for instead', async () => {
      // `PLAYWRIGHT_HEADED` is the obvious thing to type and is deliberately not the name.
      vi.stubEnv('PLAYWRIGHT_HEADED', '1');

      await expect(warm()).rejects.toThrow(/Refusing to start a run with a visible/);
    });

    it('still refuses a foreign origin while the headed hatch is open', async () => {
      // The hatch opens exactly one door. If it short-circuited the whole function, an
      // operator permitting a headed run would also permit a run against somebody else's
      // server.
      vi.stubEnv('PLAYWRIGHT_ALLOW_HEADED', '1');
      vi.stubGlobal('fetch', vi.fn());

      const remote = config({
        projects: [{ name: 'Google Chrome', use: { baseURL: 'https://staging.example.com', headless: true } }],
      });

      await expect(globalSetup(remote)).rejects.toThrow(/Refusing to start a run against a server it did not start/);
    });
  });

  it('refuses a foreign origin BEFORE spending anything on the warm-up', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // The PROJECT's `use.baseURL` is what moves, not the environment: the real
    // config resolves `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? baseUrl`, so the
    // variable arrives here already merged into every project. Stubbing the variable
    // against this fixture, whose project base URL is hardcoded, would test nothing.
    const foreign = config({
      projects: [{ name: 'Google Chrome', use: { baseURL: 'https://staging.example.com', headless: true } }],
    });

    await expect(globalSetup(foreign)).rejects.toThrow(/Refusing to start a run against a server it did not start/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a foreign origin even with E2E_ALLOW_REMOTE unset in the environment', async () => {
    // The default must be refusal, and the refusal must not depend on a variable
    // being absent — `delete process.env.E2E_ALLOW_REMOTE` in `afterEach` is what
    // makes the default the thing under test rather than a leftover.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(process.env.E2E_ALLOW_REMOTE).toBeUndefined();
    const foreign = config({
      projects: [{ name: 'Google Chrome', use: { baseURL: 'http://localhost:5174', headless: true } }],
    });

    await expect(globalSetup(foreign)).rejects.toThrow(/Refusing to start a run against a server it did not start/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('permits a remote run that asked for it, and says so in the log', async () => {
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => {
      return new Response('export {}', { status: 200, headers: { 'content-type': 'text/javascript' } });
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('E2E_ALLOW_REMOTE', '1');
    const lines: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });

    try {
      await globalSetup(
        config({
          projects: [{ name: 'Google Chrome', use: { baseURL: 'https://staging.example.com', headless: true } }],
        })
      );
    } finally {
      log.mockRestore();
    }

    expect(
      lines.some((line) => line.includes('NOT this checkout')),
      'a permitted remote run announces itself in the log, so no report can imply a local verification'
    ).toBe(true);
  });

  it('lets a run through when the origin matches, and logs which one it checked', async () => {
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

    expect(
      lines.some((line) => line.includes('the dev server this run started')),
      'the origin under test is in the log for every run'
    ).toBe(true);
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
