import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

/**
 * Refuses to start a run that would put a browser window on the operator's screen.
 *
 * `use.headless` in `playwright.config.ts` already defaults to headless, but that
 * setting only governs the default. Three of Playwright's own flags bypass it:
 * `--headed`, `--debug` and `--ui` each override the resolved value after the
 * config has been read, and `show-report` / `show-trace` / `codegen` never load this
 * config at all. So "the config says headless" was a convention with four ways to
 * route around it, and the way you route around it is typing a flag.
 *
 * This turns the convention into a refusal that arrives before a single window is
 * created, with a message that says what to run instead. It is the difference
 * between a rule and a comment about a rule.
 *
 * ## What it can and cannot see
 *
 * The check is on the RESOLVED per-project `use.headless`, not on the config file,
 * because that is the value the browser will actually be launched with. A CLI
 * `--headed` is merged into every project's `use` before `globalSetup` runs, so this
 * catches it, and so does `--debug` (which forces `headless = false` itself) and any
 * `test.use({ headless: false })` written at project scope.
 *
 * It cannot see a `test.use({ headless: false })` inside a single spec file: that is
 * resolved per test, below this layer. Nothing in `e2e/` does that today, and
 * closing it would mean every spec importing a shared `test` from a fixtures module
 * instead of `@playwright/test`. The 18 specs import it directly, so the hole is
 * real but wide; closing it is a larger change than it looks and is not needed to
 * keep an agent from running `--headed`.
 *
 * ## The escape hatch
 *
 * `PLAYWRIGHT_ALLOW_HEADED=1`, which is what `npm run test:e2e:headed` sets. It is
 * named "allow" rather than "headed" on purpose: a model debugging a red suite will
 * try `PLAYWRIGHT_HEADED=1` because that is the obvious thing to type, and that must
 * not be enough. This variable is the human's signature on the run, and `kilo.json`
 * blocks the agent from reaching the command at all.
 */

/** The only environment value this guard accepts. Set by `npm run test:e2e:headed`. */
const ALLOW_ENV = 'PLAYWRIGHT_ALLOW_HEADED';

function refuseVisibleBrowser(config: FullConfig): void {
  if (process.env[ALLOW_ENV] === '1') return;

  const reasons: string[] = [];

  // Named explicitly so the message says which flag caused it. Authoritative for
  // `--headed` and `--debug`; `--ui` is not caught by the `use.headless` check below,
  // because in UI mode the test browsers stay headless and it is the UI itself that
  // opens in the default browser.
  for (const flag of ['--headed', '--debug', '--ui']) {
    if (config.argv.includes(flag)) reasons.push(`\`${flag}\``);
  }

  // The authoritative check. `use.headless` is `false` here for `--headed`,
  // `--debug`, `PLAYWRIGHT_ALLOW_HEADED=1`, and any project-scope `test.use`.
  for (const project of config.projects) {
    if (project.use.headless === false) reasons.push(`project "${project.name}" resolved to headless: false`);
  }

  if (reasons.length === 0) return;

  const cause = [...new Set(reasons)].join(', ');

  throw new Error(
    [
      `Refusing to start a run with a visible browser: ${cause}.`,
      '',
      "A headed browser puts a live, clickable window on the operator's screen for the whole run.",
      'Their clicks, keystrokes, mouse movement and focus changes all reach the page as real',
      "input, indistinguishable from the suite's own page.mouse / page.keyboard calls. The test",
      'then fails for a reason that is not in the code, and because the interference is',
      'intermittent it is indistinguishable from a real race. Both get filed as "flaky" and',
      'neither gets fixed.',
      '',
      'Run `npm run test:e2e`. It is headless, and this suite is verified headless. A',
      'headed run is a different measurement, not a stricter one: the CDP capture and the',
      'levels specs were root-caused and fixed, and neither reads a mode-dependent scale',
      'any more, so a headed run is expected to agree rather than to fail differently. See',
      'e2e/README.md and e2e/OPEN_PROBLEMS.md.',
      '',
      'To read a failure, open the screenshot Playwright already wrote under test-results/ on',
      'failure. Do not open a viewer, and do not run `show-report` or `show-trace`: both open',
      'a window, and both block until you close it.',
      '',
      'If something genuinely only reproduces visually and you need to watch it, that is the',
      `operator's call, not yours: ask them to run \`npm run test:e2e:headed\`, which sets`,
      `${ALLOW_ENV}=1. To unblock a run without a window, add --retries=1 so \`trace:`,
      "'on-first-retry' produces a trace file, and read the failure PNG from the test's own",
      'outputDir instead.',
    ].join('\n')
  );
}

/* ---------------------------------------------------------------------------
 * The dev-server warm-up.
 *
 * Vite's transform middleware only runs for a request that LOOKS like a module:
 *
 *     if (req.headers["sec-fetch-dest"] === "script" || isJSRequest(url) ||
 *         isImportRequest(url) || isCSSRequest(url) || isHTMLProxy(url))
 *
 * (node_modules/vite/dist/node/chunks/node.js:19841). A plain `fetch` to the base
 * URL has no `sec-fetch-dest` header, and `isJSRequest("/")` is false because the
 * path ends in `/` and the extension-less clause requires the opposite
 * (node.js:2139-2144). So the `GET /` that Playwright's own `webServer` plugin
 * already made before `globalSetup` runs (isURLAvailable, coreBundle.js:8889, and
 * `/` is short-circuited by the middleware's own `knownIgnoreList` at node.js:19750)
 * walks none of the module graph. The first real page load pays the whole transform
 * cost, and the first few specs lose their 5s assertion budget to it. TEST-FLAKES §8.
 *
 * The request that DOES reach the transform gate is the module entry, so that is
 * what this fetches. `server.preTransformRequests` (default true, node.js:24640)
 * then crawls and pre-transforms the graph from the entry, recursively (node.js:26159).
 *
 * Why `fetch` and not a browser: this file exists to STOP an agent opening a window,
 * and a `chromium.launch()` here would be invisible to the guard above, which only
 * inspects `config.argv` and `config.projects[].use.headless`. It would also demand a
 * browser download `test:e2e:install` does not make, and a `page.goto('/')` would
 * inherit `index.html`'s external googletagmanager/fonts.googleapis.com requests.
 *
 * Why it never fails the run: this is an optimisation. A genuinely broken dev server
 * must fail the tests, with THEIR diagnostics, not here.
 * --------------------------------------------------------------------------- */

/** The module script `index.html` loads. Derived from the file, not assumed. */
const MODULE_ENTRY_PATTERN = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i;

/** Fallback if `index.html` ever stops matching: the entry Vite is serving today. */
const FALLBACK_MODULE_ENTRY = '/src/main.tsx';

/** Generous but finite. The web server has already answered, so this is transform time only. */
export const WARMUP_TIMEOUT_MS = 60_000;

export const WARMUP_INTERVAL_MS = 250;

export interface WarmupPlan {
  /** The module URL to request, or `null` when the warm-up is skipped. */
  url: string | null;
  /** Why. Logged verbatim, so a run's output says whether the warm-up happened. */
  reason: string;
}

/**
 * Decide what, if anything, to request. Pure: no clock, no network, no `process`.
 *
 * Skips, deliberately rather than defensively:
 * - No usable base URL. `playwright.config.ts` reads `PLAYWRIGHT_BASE_URL` and
 *   pointing the suite at a deployed server is a documented use; a remote origin
 *   is not something a local warm-up can improve, and requesting its module entry
 *   is a harmless GET, so this returns the URL and lets the fetch decide. Only a
 *   missing or non-http(s) base URL skips.
 * - `--list`, which loads the config and the test files without a run. Harmless
 *   here because `config.argv` is read the same way the headless guard reads it.
 */
export function planWarmup(options: {
  baseUrl: string | undefined;
  argv: readonly string[];
  html: string | null;
}): WarmupPlan {
  if (options.argv.includes('--list')) {
    return { url: null, reason: 'skipping warm-up: --list runs no tests against a server' };
  }

  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    return { url: null, reason: 'skipping warm-up: no base URL is configured' };
  }

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { url: null, reason: `skipping warm-up: base URL ${JSON.stringify(baseUrl)} is not a URL` };
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return { url: null, reason: `skipping warm-up: base URL scheme ${origin.protocol} is not http(s)` };
  }

  const entry = options.html?.match(MODULE_ENTRY_PATTERN)?.[1] ?? FALLBACK_MODULE_ENTRY;
  return { url: new URL(entry, origin).toString(), reason: `warming the dev server with ${entry}` };
}

export interface WarmupResult {
  warmed: boolean;
  url: string | null;
  reason: string;
  attempts: number;
  elapsedMs: number;
}

export interface WarmupDeps {
  fetch: (
    url: string,
    init: { signal: AbortSignal; headers: Record<string, string> }
  ) => Promise<{ ok: boolean; status: number }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  intervalMs: number;
}

/**
 * Request the module entry until it answers, or until the bounded deadline passes.
 * NEVER throws: a fetch rejection, a timeout and a `planWarmup` skip all resolve.
 */
export async function runWarmup(plan: WarmupPlan, deps: WarmupDeps): Promise<WarmupResult> {
  if (plan.url === null) {
    return { warmed: false, url: null, reason: plan.reason, attempts: 0, elapsedMs: 0 };
  }

  const started = deps.now();
  const deadline = started + deps.timeoutMs;
  let attempts = 0;
  let lastError = 'no response';

  // `while (true)` with an explicit break: the only exits are the two returns and
  // the deadline, and a bounded retry is easier to read than a loop condition that
  // encodes three of them.
  for (;;) {
    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    attempts += 1;

    try {
      const response = await deps.fetch(plan.url, {
        signal: AbortSignal.timeout(remaining),
        headers: { accept: '*/*' },
      });
      if (response.ok) {
        return {
          warmed: true,
          url: plan.url,
          reason: `warmed the dev server: ${plan.url} answered ${response.status} after ${attempts} attempt(s)`,
          attempts,
          elapsedMs: deps.now() - started,
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (deps.now() + deps.intervalMs >= deadline) break;
    await deps.sleep(deps.intervalMs);
  }

  return {
    warmed: false,
    url: plan.url,
    reason: `warm-up gave up after ${attempts} attempt(s) in ${deps.timeoutMs}ms (${lastError}); continuing, the tests will report anything real`,
    attempts,
    elapsedMs: deps.now() - started,
  };
}

const INDEX_HTML = fileURLToPath(new URL('../index.html', import.meta.url));

function readIndexHtml(): string | null {
  try {
    return readFileSync(INDEX_HTML, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The base URL the tests will actually navigate to.
 *
 * `FullConfig` has no top-level `use` — only `projects[].use` (playwright/types
 * test.d.ts:2043, 774) — so the top-level `use.baseURL` in `playwright.config.ts`
 * reaches this function already merged into every project. The first project that
 * declares one wins, and `PLAYWRIGHT_BASE_URL` is the fallback for a config with no
 * project-level base URL at all.
 */
export function resolvedBaseUrl(config: Pick<FullConfig, 'projects'>): string | undefined {
  for (const project of config.projects) {
    const baseURL = project.use.baseURL;
    if (typeof baseURL === 'string' && baseURL !== '') return baseURL;
  }
  return process.env.PLAYWRIGHT_BASE_URL;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // The refusal comes first and is the only thing here that can throw. A warm-up
  // that ran before it would spend Vite's transform cost on a run about to be
  // refused for putting a window on the operator's screen.
  refuseVisibleBrowser(config);

  const plan = planWarmup({
    baseUrl: resolvedBaseUrl(config),
    argv: config.argv,
    html: readIndexHtml(),
  });
  const result = await runWarmup(plan, {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    timeoutMs: WARMUP_TIMEOUT_MS,
    intervalMs: WARMUP_INTERVAL_MS,
  });
  console.log(`[global-setup] ${result.reason}`);
}
