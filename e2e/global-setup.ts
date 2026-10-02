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
 * instead of `@playwright/test`. Most of the specs import it directly, so the hole is
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

/**
 * The only value that permits a run to test something other than its own checkout.
 *
 * Its own variable rather than being read out of `PLAYWRIGHT_BASE_URL`'s presence,
 * because the point of it is to be a deliberate, greppable signature — the same
 * reason the headed guard has one. `scripts/e2e-run.mjs` refuses the same pair, and
 * its refusal is the friendlier one because it happens before Playwright is even
 * loaded; this one is the load-bearing one.
 */
const ALLOW_REMOTE_ENV = 'E2E_ALLOW_REMOTE';

/**
 * The two ways the HTML REPORT opens a window, which is a window this file's own
 * name never mentioned.
 *
 * `playwright.config.ts` sets the reporter's `open: 'never'`, and that is the only
 * thing standing between a red local run and a live Chrome window. It is not a
 * guarantee, for two independent reasons, both read out of the installed runner:
 *
 * 1. `getHtmlReportOptionProcessEnv()` is consulted FIRST and the config's `open`
 *    only second (`playwright/lib/runner/index.js:3450`), and it reads
 *    `PLAYWRIGHT_HTML_OPEN` and `PW_TEST_HTML_REPORT_OPEN` (`:3510-3511`). Either
 *    one set to `always` or `on-failure` REPLACES `never`. `never` is safe and
 *    passes, so the guard is not "this variable is set" but "this variable is set to
 *    a value that opens something".
 * 2. A CLI `--reporter` REPLACES the config's reporter list wholesale
 *    (`playwright/lib/common/index.js:522`), so `open: 'never'` is discarded along
 *    with everything else and the default becomes `on-failure` (`:3450`).
 *
 * `on-failure` then opens a window when the run is red AND stdin is a TTY AND
 * `isCodingAgent()` is false (`runner/index.js:3490`), and `isCodingAgent()` is only
 * `CLAUDECODE` or `COPILOT_CLI` (`playwright-core/lib/coreBundle.js:8195-8197`) —
 * neither is set under Kilo. So the shape of the failure is: a red local run, a
 * reporter override nobody connected to a window, and a browser on the operator's
 * desktop for the rest of the run.
 *
 * `--add-reporter` is the same hole, and for a subtler reason: it leaves the
 * configured `['html', { open: 'never' }]` in place and ADDS a second `html` reporter
 * with default options (`common/index.js:522`), so the run has one that never opens
 * and one that opens on failure.
 */
const HTML_OPEN_ENV_VARS = ['PLAYWRIGHT_HTML_OPEN', 'PW_TEST_HTML_REPORT_OPEN'] as const;

/** The only two accepted values that open something (`runner/index.js:3401`). */
const HTML_OPEN_VALUES: ReadonlySet<string> = new Set(['always', 'on-failure']);

/** The reporter name that has an `open` option at all. */
const HTML_REPORTER = 'html';

/** The CLI flags that can put an `html` reporter on the command line. */
const REPORTER_FLAGS = ['--reporter', '--add-reporter'] as const;

export interface OwnServerCheck {
  /** False only when the run would navigate somewhere its own dev server is not. */
  permitted: boolean;
  /** Logged on EVERY run, so a report can never imply a local verification. */
  reason: string;
}

/**
 * Would this run test the checkout it started in?
 *
 * ## Why this exists at all, when the wrapper already refuses it
 *
 * `scripts/e2e-run.mjs` refuses `PLAYWRIGHT_BASE_URL` before it starts anything,
 * which is the friendliest place to be told. It is not the only place a run can be
 * started from. `npm run test:e2e:raw` is a bare `playwright test`, the CI `e2e` job
 * runs `npx playwright test` directly, and anything an operator types does whatever
 * they typed — and `playwright.config.ts` resolves `use.baseURL` from the variable
 * itself. So a run that set `PLAYWRIGHT_BASE_URL` and bypassed the wrapper navigated
 * a whole suite to another origin, reported green, and wrote the artifacts everyone
 * trusts. The wrapper's refusal was real and the guarantee was still one command
 * away from being false.
 *
 * This runs from `globalSetup`, which every `playwright test` invocation loads
 * whatever started it. That is the same layer as `refuseVisibleBrowser`, and for the
 * same reason: a rule enforced in one caller is a convention.
 *
 * ## What it compares, and why origins rather than strings
 *
 * `webServer.url` and the project `use.baseURL` are independent settings. Comparing
 * ORIGINS rather than the two strings is what makes this correct rather than
 * annoying: `PLAYWRIGHT_BASE_URL=http://localhost:5173` with a dev server on 5173
 * names the same server and is fine, while `http://localhost:5174` does not. A
 * string comparison would refuse the first and allow nothing extra, which would make
 * the guard something agents learn to work around.
 */
export function checkOwnServer(options: {
  baseUrl: string | undefined;
  webServerUrl: string | undefined;
  allowRemote: string | undefined;
}): OwnServerCheck {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    return { permitted: true, reason: 'no base URL is configured, so there is no origin to verify' };
  }

  if (options.allowRemote === '1') {
    return {
      permitted: true,
      reason: `${ALLOW_REMOTE_ENV}=1: this run tests ${baseUrl}, which is NOT this checkout`,
    };
  }

  const target = parseHttpUrl(baseUrl);
  if (!target) {
    // REFUSED, and this is the one branch that used to permit. A base URL this
    // function cannot parse into an origin is a run whose destination cannot be
    // compared with the server this run started, and `file:///…/other-checkout/dist`
    // is a value somebody can reach by typing. `scripts/e2e-run.mjs` refuses the
    // same variable, but that is the friendly caller; this is the load-bearing one,
    // and it was the one hole in the pair: the reason it logged said "there is no
    // origin to verify" while the run navigated somewhere this run did not start.
    return {
      permitted: false,
      reason:
        `base URL ${JSON.stringify(baseUrl)} is not an http(s) URL, so this run cannot show that it is ` +
        'loading the server it started',
    };
  }

  const webServer = parseHttpUrl(options.webServerUrl);
  if (!webServer) {
    // No `webServer` block means no server was started, so there is nothing to
    // compare against and nothing this layer can prove either way. Saying so beats
    // claiming a guarantee the check did not make.
    return {
      permitted: true,
      reason: 'no webServer is configured, so this run could not verify the origin the tests will load',
    };
  }

  if (webServer.origin === target.origin) {
    return { permitted: true, reason: `the tests will load the dev server this run started at ${target.origin}` };
  }

  return {
    permitted: false,
    reason:
      `the tests will load ${target.origin}, but the dev server this run started is at ${webServer.origin}. ` +
      'A run that tests another origin is not a run about this branch.',
  };
}

function refuseForeignOrigin(check: OwnServerCheck): void {
  if (check.permitted) return;
  throw new Error(
    [
      `Refusing to start a run against a server it did not start: ${check.reason}`,
      '',
      'Every worktree serves its own checkout, so a suite pointed at a foreign origin reports',
      "somebody else's code as this branch's result — green, with the artifacts everyone trusts.",
      'TEST-FLAKES.md §10 is a mutation campaign that reported every mutation green that way.',
      '',
      'If you mean to test a deployed build, say so explicitly:',
      `  ${ALLOW_REMOTE_ENV}=1 PLAYWRIGHT_BASE_URL=https://staging.example.com npx playwright test`,
      '',
      'and the run will log, on every run, which origin the tests were pointed at.',
    ].join('\n')
  );
}

export interface CliReporterOverride {
  /** The flag and its value as they were written, for the refusal message. */
  raw: string;
  /** Lower-cased reporter names, comma-separated, with empty entries dropped. */
  names: Set<string>;
}

/**
 * The reporter list a CLI flag put on the command line, or `null`.
 *
 * Both spellings commander accepts are read, because both reach the same place:
 * `--reporter html` and `--reporter=html`. A reporter may also be a path to a module
 * (`program.js:213`), so a name that is not one of the built-ins is kept as-is and
 * simply will not match `html` — which is the honest answer, not a guess: a custom
 * reporter cannot open a window this guard can see, and a custom reporter NAMED
 * `html.js` does not become the built-in.
 *
 * A trailing flag with no value (`--reporter` as the last argument) yields no
 * override rather than a throw. This function's contract is that it does not fail a
 * run: the flag is invalid and the runner's own argument parser has already said so
 * by the time a browser could exist, so the interesting question is only whether a
 * WINDOW was requested, and an empty answer is the safe one.
 */
export function cliReporterOverride(argv: readonly string[]): CliReporterOverride | null {
  const found: CliReporterOverride[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    for (const flag of REPORTER_FLAGS) {
      let value: string | undefined;

      if (arg === flag) {
        value = argv[index + 1];
        if (value === undefined) continue;
        index += 1;
      } else if (arg.startsWith(`${flag}=`)) {
        value = arg.slice(flag.length + 1);
      } else {
        continue;
      }

      // A flag's own value never looks like a flag; commander stops at the next one.
      if (value.startsWith('-')) {
        index -= 1;
        continue;
      }

      found.push({
        raw: `${flag} ${value}`,
        names: new Set(
          value
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter((name) => name !== '')
        ),
      });
    }
  }

  return found.length === 0 ? null : found[found.length - 1];
}

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

  // The HTML REPORT — a window, and the only one this guard missed. The rationale,
  // and the two installed-runner line numbers that prove it, are on
  // `HTML_OPEN_ENV_VARS` above; do not repeat them here.
  for (const envVar of HTML_OPEN_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value !== undefined && HTML_OPEN_VALUES.has(value)) {
      reasons.push(`\`${envVar}=${value}\`, which overrides the config's \`open: 'never'\``);
    }
  }
  const reporter = cliReporterOverride(config.argv);
  if (reporter && reporter.names.has(HTML_REPORTER)) {
    reasons.push(
      `\`${reporter.raw}\`, which puts an \`html\` reporter on the command line and with it the default \`open\``
    );
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
      'To read a failure, open the screenshot Playwright already wrote under the run output',
      'directory: test-results/, or test-results/runs/<run-id>/ when the run went through',
      'scripts/e2e-run.mjs, which prints the path it used. Do not open a viewer, and do not run',
      '`show-report` or `show-trace`: both open a window, and both block until you close it.',
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
 *
 * ## The part that made a wrong entry look like a working one
 *
 * A Vite dev server does NOT 404 a path that does not exist. The SPA fallback
 * answers it with `200` and `content-type: text/html`, verified against a live
 * Vite 8.3.0. So `response.ok` alone cannot tell "transformed a module graph" from
 * "served index.html for a URL no module lives at", and the difference is the whole
 * point of the warm-up. Every success below therefore requires BOTH an ok status
 * AND a non-HTML content type.
 * --------------------------------------------------------------------------- */

/** One whole `<script ...>` tag. Attribute order is not the tag's business. */
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>/gi;
const SCRIPT_TYPE_PATTERN = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const SCRIPT_SRC_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;

/** Fallback if `index.html` ever stops matching: the entry Vite is serving today. */
const FALLBACK_MODULE_ENTRY = '/src/main.tsx';

/**
 * The whole budget for the warm-up, and it is a BUDGET for a failure, not for the
 * work. A server that already answered `webServer.url` is alive, so the remaining
 * cost is Vite's transform of the entry's graph — and on a healthy checkout that is
 * the only branch that is ever taken. Everything else reaching the loop is a
 * permanently wrong request: a 404, a 410, or the SPA fallback's HTML (both of
 * which return immediately below), or a connection that is not being made at all.
 * At 250ms between attempts that is about twenty tries, enough to outlast a slow
 * dependency pre-bundle, and short enough that a permanently wrong entry cannot
 * cost a minute of every run. A genuinely dead server never reaches this code at
 * all: `webServer.timeout: 120_000` in `playwright.config.ts` gates it first.
 */
export const WARMUP_TIMEOUT_MS = 5_000;

/**
 * The cap on ONE attempt, and it is deliberately below the budget.
 *
 * `AbortSignal.timeout(remaining)` reads like a per-attempt timeout and is not: it
 * hands attempt 1 the entire remaining budget, and a server that accepts the
 * connection and then hangs spends all of it there. The loop's
 * `now() + interval >= deadline` check then trips on the first pass and the retry
 * that was supposed to follow never happens. `Math.min(remaining, …)` is the shape
 * that fixes it, but the cap only earns its keep if it is SMALLER than the budget —
 * with the two equal, the minimum is a no-op and the hang still takes everything.
 *
 * 2500ms against a 5000ms budget leaves a second attempt to run in. Measured against
 * a live Vite 8.3.0 in this worktree with the dep cache cleared before each start,
 * the first request for `/src/main.tsx` on a cold server took 0.47-1.32s over five
 * runs, so 2500ms is about twice the slowest of them — and the failure mode of
 * cutting it closer than that is benign anyway. Vite does not cancel an in-flight
 * transform when the client goes away, so an attempt that is aborted at 2500ms has
 * still left the work done, and the retry finds it. A hang is the only thing the cap
 * is for, and a hang is unbounded by definition.
 */
export const PER_ATTEMPT_TIMEOUT_MS = 2_500;

export const WARMUP_INTERVAL_MS = 250;

/**
 * Statuses no retry can change. A 404 is a wrong entry; a 410 is a wrong entry on
 * an origin that has since said so. Both are answers, not failures to wait out, so
 * they end the loop at once instead of paying the whole budget to learn the same
 * thing twenty more times.
 */
const TERMINAL_STATUSES: ReadonlySet<number> = new Set([404, 410]);

const HTML_CONTENT_TYPE = /\btext\/html\b/i;

/**
 * The `src` of the first `type="module"` script in `index.html`, or `null`.
 *
 * The tag is matched whole and its attributes read separately, because a single
 * regex over both attributes encodes an attribute ORDER into the code: the obvious
 * one (`...type=...src=`) does not match `<script src="..." type="module">`, and
 * every such HTML file is a valid one.
 */
function moduleEntryFromHtml(html: string | null): string | null {
  if (!html) return null;
  for (const [tag] of html.matchAll(SCRIPT_TAG_PATTERN)) {
    if (SCRIPT_TYPE_PATTERN.exec(tag)?.[1]?.toLowerCase() !== 'module') continue;
    const src = SCRIPT_SRC_PATTERN.exec(tag)?.[1];
    if (src) return src;
  }
  return null;
}

export interface WarmupPlan {
  /** The module URL to request, or `null` when the warm-up is skipped. */
  url: string | null;
  /** Why. Logged verbatim, so a run's output says whether the warm-up happened. */
  reason: string;
}

/**
 * Decide what, if anything, to request. Pure: no clock, no network, no `process`,
 * and it does not throw — including on a `src` that is not a URL, because the
 * alternative is a malformed `index.html` taking down a whole e2e run from the one
 * component whose contract is that it cannot.
 *
 * Skips, each with a reason that names the thing that caused it:
 * - No usable base URL, or one that does not parse, or one that is not http(s).
 * - The tests are pointed somewhere other than the server this run started. The
 *   documented remote workflow (`PLAYWRIGHT_BASE_URL=https://staging.example.com`,
 *   `e2e/README.md`) does exactly that: `webServer.url` stays LOCAL and only the
 *   project `use.baseURL` moves, so a warm-up aimed at the base URL asks somebody
 *   else's server for `/src/main.tsx`. This SKIPS rather than retargeting the
 *   web server's origin, because in a remote run nothing will ever request that
 *   origin either — the dev server is started and then ignored — so retargeting
 *   would pay a full cold transform to warm a server no test touches.
 * - The derived entry lands outside the base path. `index.html` is read off disk
 *   and its `src` is usually root-absolute, so `new URL('/src/main.tsx', 'http://h/app')`
 *   silently drops `/app`. A `base` on the Vite config would do the same; there is
 *   none today (`vite.config.ts:6-35`), which is exactly why this check is here
 *   rather than a comment saying the path cannot change.
 *
 * There is deliberately no `--list` branch, and there was one. It was unreachable:
 * `playwright/lib/runner/index.js:6946-6954` builds the task list in a ternary, and
 * the `listMode` arm is `[createLoadTask, createReportBeginTask]` with
 * `createGlobalSetupTasks` in the OTHER arm only, so `globalSetup` never runs under
 * `--list`. A branch for a condition the runner cannot produce is not a safety
 * property, it is a second code path a reader has to verify and a future refactor
 * could "fix" in either direction. Deleting it also removed the last reason this
 * pure function read `config.argv`. `refuseVisibleBrowser` still reads argv, which
 * is different: `--headed`, `--ui` and `--debug` are flags a real run can carry.
 */
export function planWarmup(options: {
  baseUrl: string | undefined;
  webServerUrl: string | undefined;
  html: string | null;
}): WarmupPlan {
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

  const webServer = parseHttpUrl(options.webServerUrl);
  if (webServer && webServer.origin !== origin.origin) {
    return {
      url: null,
      reason:
        `skipping warm-up: the tests will load ${origin.origin}, not the dev server this run started ` +
        `at ${webServer.origin}; a local warm-up cannot improve a remote origin`,
    };
  }

  const entry = moduleEntryFromHtml(options.html) ?? FALLBACK_MODULE_ENTRY;

  let url: URL;
  try {
    url = new URL(entry, origin);
  } catch {
    return { url: null, reason: `skipping warm-up: the module entry ${JSON.stringify(entry)} is not a URL` };
  }

  const basePath = origin.pathname.endsWith('/') ? origin.pathname : `${origin.pathname}/`;
  if (!url.pathname.startsWith(basePath)) {
    return {
      url: null,
      reason: `skipping warm-up: the module entry resolves to ${url.pathname}, outside the base path ${basePath}`,
    };
  }

  return { url: url.toString(), reason: `warming the dev server with ${entry}` };
}

function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
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
  ) => Promise<{ ok: boolean; status: number; contentType: string }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Injected for the same reason as `fetch`: `AbortSignal.timeout` is a real timer. */
  abortSignal: (ms: number) => AbortSignal;
  timeoutMs: number;
  intervalMs: number;
}

/**
 * Request the module entry until it answers, or until the bounded deadline passes.
 * NEVER throws: a fetch rejection, a timeout, a `planWarmup` skip and an unreadable
 * content type all resolve.
 *
 * A response counts as warmed only when it is `ok` AND is not HTML. See the header:
 * a wrong entry gets a 200 with `text/html` from the SPA fallback, and reporting
 * that as a success is a log line that says a cold server is warm.
 */
export async function runWarmup(plan: WarmupPlan, deps: WarmupDeps): Promise<WarmupResult> {
  if (plan.url === null) {
    return { warmed: false, url: null, reason: plan.reason, attempts: 0, elapsedMs: 0 };
  }

  const started = deps.now();
  const deadline = started + deps.timeoutMs;
  let attempts = 0;
  let lastError = 'no response';

  // One exit shape for every "not warmed" that is not a transport error, so the
  // reason reads the same however the run stopped.
  const notWarmed = (why: string): WarmupResult => ({
    warmed: false,
    url: plan.url,
    reason: `${why}; continuing, the tests will report anything real`,
    attempts,
    elapsedMs: deps.now() - started,
  });

  // `while (true)` with an explicit break: the only exits are the two returns and
  // the deadline, and a bounded retry is easier to read than a loop condition that
  // encodes three of them.
  for (;;) {
    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    attempts += 1;

    try {
      const response = await deps.fetch(plan.url, {
        signal: deps.abortSignal(Math.min(remaining, PER_ATTEMPT_TIMEOUT_MS)),
        headers: { accept: '*/*' },
      });

      const contentType = response.contentType ?? '';
      if (response.ok && !HTML_CONTENT_TYPE.test(contentType)) {
        return {
          warmed: true,
          url: plan.url,
          reason: `warmed the dev server: ${plan.url} answered HTTP ${response.status} (${contentType}) after ${attempts} attempt(s)`,
          attempts,
          elapsedMs: deps.now() - started,
        };
      }

      if (response.ok) {
        // 200 with an HTML body: the SPA fallback, so no module was transformed.
        // Retrying cannot change it, and saying "warmed" here would be the exact
        // lie the content-type check exists to prevent.
        return notWarmed(
          `not warmed: ${plan.url} answered HTTP ${response.status} with content-type ${contentType || '(none)'}, ` +
            'which is the SPA fallback rather than a module, so nothing was transformed'
        );
      }

      lastError = `HTTP ${response.status}`;
      if (TERMINAL_STATUSES.has(response.status)) {
        return notWarmed(`not warmed: ${plan.url} answered HTTP ${response.status}, which no retry will change`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (deps.now() + deps.intervalMs >= deadline) break;
    await deps.sleep(deps.intervalMs);
  }

  return notWarmed(`warm-up gave up after ${attempts} attempt(s) in ${deps.timeoutMs}ms (${lastError})`);
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

/**
 * The origin the dev server this run started is served from, when the config starts
 * one. `FullConfig.webServer` is `null` for an array of servers and for a config with
 * no `webServer` block at all (`playwright/lib/common/index.js:541-549`), and `url`
 * is absent when the block configures `port` instead.
 *
 * The warm-up needs this because `webServer.url` and the project `use.baseURL` are
 * INDEPENDENT settings: `playwright.config.ts` sets the second from
 * `PLAYWRIGHT_BASE_URL` and leaves the first pointing at localhost, so setting the
 * documented remote override moves the tests without moving the server.
 */
export function resolvedWebServerUrl(config: Pick<FullConfig, 'webServer'>): string | undefined {
  const url = config.webServer?.url;
  return typeof url === 'string' && url !== '' ? url : undefined;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // The refusals come first and are the only things here that can throw. A warm-up
  // that ran before them would spend Vite's transform cost on a run about to be
  // refused for putting a window on the operator's screen, or for testing somebody
  // else's server.
  refuseVisibleBrowser(config);

  const baseUrl = resolvedBaseUrl(config);
  const webServerUrl = resolvedWebServerUrl(config);
  const ownServer = checkOwnServer({ baseUrl, webServerUrl, allowRemote: process.env[ALLOW_REMOTE_ENV] });
  refuseForeignOrigin(ownServer);
  // Logged whether or not it was permitted: a permitted REMOTE run is exactly the
  // case that must be visible in the log afterwards, and this is the only place that
  // can say it.
  console.log(`[global-setup] ${ownServer.reason}`);

  const plan = planWarmup({
    baseUrl,
    webServerUrl,
    html: readIndexHtml(),
  });
  const result = await runWarmup(plan, {
    fetch: (url, init) =>
      fetch(url, init).then((response) => ({
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
      })),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    abortSignal: (ms) => AbortSignal.timeout(ms),
    timeoutMs: WARMUP_TIMEOUT_MS,
    intervalMs: WARMUP_INTERVAL_MS,
  });
  console.log(`[global-setup] ${result.reason}`);
}
