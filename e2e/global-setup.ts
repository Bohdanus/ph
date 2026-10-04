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
 * Two of the routes above are not this file's to close and are not pretending to be:
 * `--ui` returns before `globalSetup` ever loads (see the comment on the flag loop in
 * `refuseVisibleBrowser`), and `show-report` / `show-trace` / `codegen` never load a
 * Playwright config at all. Both are `kilo.jsonc`'s, and the comment at each says so
 * rather than implying a guarantee this function does not provide.
 *
 * ## The HTML report is in scope here too
 *
 * Not a test browser: no `chromium.launch()`, nothing in `use.headless`, no flag in
 * `config.argv`. The configured reporter asks for `open: 'never'` and two environment
 * variables plus one command-line flag outrank that ask. See the block above
 * `checkHtmlOpenEnv`.
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
 * The two environment variables that become the HTML reporter's own `open` option.
 *
 * `playwright/lib/runner/index.js:3510-3511`, read by
 * `getHtmlReportOptionProcessEnv()`. Neither is documented; both outrank
 * `playwright.config.ts`, which is the whole problem.
 */
const HTML_OPEN_ENV_VARS = ['PLAYWRIGHT_HTML_OPEN', 'PW_TEST_HTML_REPORT_OPEN'] as const;

/**
 * The one value of the above that opens nothing.
 *
 * `htmlReportOptions` is exactly `['always', 'never', 'on-failure']`
 * (`runner/index.js:3401`), so `never` is the single honest spelling of "do not open
 * this". Anything else that is truthy — `always`, `on-failure`, or a typo, which
 * Playwright reports as a configuration error and then ignores
 * (`runner/index.js:3514-3517`), leaving the `"on-failure"` fall-through in place —
 * is refused here.
 */
const NON_OPENING_HTML_OPEN = 'never';

/**
 * The environment variable that names an EXTRA reporter, appended to the configured
 * list rather than replacing it: `runner/index.js:5221-5228`. It is constructed with
 * `reporterCommandOptions` and nothing else (`runner/index.js:5250-5256`), so an `html`
 * here reaches the same `_resolveOptions()` as one from the CLI.
 */
const REPORTER_ENV_VAR = 'PW_TEST_REPORTER';

/**
 * The two CLI options that reach the reporter list (`cli/testActions.js:119,189`).
 *
 * They are not equivalent, and the difference is why both are here.
 * `--reporter` REPLACES the configured list outright —
 * `reporter: [...takeFirst(configCLIOverrides.reporter, resolveReporters(userConfig.reporter, …))]`
 * at `common/index.js:522` — so it throws away the `open: 'never'` in
 * `playwright.config.ts` along with the `list` reporter, and the replacement
 * `[['html']]` carries no options at all. `--add-reporter` APPENDS, so the configured
 * reporter keeps `open: 'never'` and a second `HtmlReporter` arrives beside it with no
 * `open`. Both land in `_resolveOptions()`, where a missing `open` is `"on-failure"`.
 */
const REPORTER_FLAGS = ['--reporter', '--add-reporter'] as const;

/** The only reporter whose missing `open` option resolves to something that opens. */
const OPENING_REPORTER = 'html';

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

/**
 * Does a variable in `env` hand the HTML reporter an `open` option that opens?
 */
function refuseVisibleBrowser(config: FullConfig): void {
  if (process.env[ALLOW_ENV] === '1') return;

  const reasons: string[] = [];

  // Named explicitly so the message says which flag caused it. Authoritative for
  // `--headed` and `--debug`.
  //
  // `--ui` WAS IN THIS LIST AND IS DELIBERATELY NOT ANY MORE. It could never fire
  // here: `runUIMode` is reached from `cli/testActions.js:62` and RETURNS at :77, while
  // `globalSetup` only exists inside `runAllTestsWithConfig`
  // (`runner/index.js:6949-6954`). So the branch read as a guarantee it never provided
  // — a reader would conclude `--ui` was covered at the layer that is supposed to cover
  // it, and it is covered one layer out, in `kilo.jsonc`, by a rule on the flag itself
  // rather than on the command that carries it. A branch for a condition this function
  // cannot observe is not a safety property; it is a second code path a reader has to
  // verify and a refactor can "fix" in either direction.
  for (const flag of ['--headed', '--debug']) {
    if (config.argv.includes(flag)) reasons.push(`\`${flag}\``);
  }

  // The HTML REPORT is deliberately NOT checked here. It is a window, and it is
  // handled by `refuseOpeningHtmlReport`, which is called from `globalSetup` OUTSIDE
  // this function — because the escape hatch above is the operator's signature on a
  // HEADED BROWSER, and the report viewer is not the thing that variable is about. A
  // check in here would be skipped entirely by `PLAYWRIGHT_ALLOW_HEADED=1`, which is
  // exactly the hole that arrangement exists to close.

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
 * The HTML report is a window too, and it is the only one that also never exits.
 *
 * `playwright.config.ts` asks for `open: 'never'`. That ask is worth nothing on its
 * own, because the reporter resolves its own option as
 *
 *     open: getHtmlReportOptionProcessEnv() || this._options.open || "on-failure"
 *
 * (node_modules/playwright/lib/runner/index.js:3450) and `getHtmlReportOptionProcessEnv()`
 * is `process.env.PLAYWRIGHT_HTML_OPEN || process.env.PW_TEST_HTML_REPORT_OPEN`
 * (`runner/index.js:3511`). So EITHER variable silently outranks the config. Failing
 * that, `"on-failure"` is what a reporter configured with NO `open` option resolves to
 * — which is exactly what a CLI `--reporter` produces.
 *
 * `showHTMLReport` then serves the report, opens it in the default browser, and awaits
 * a promise that is never resolved (`runner/index.js:3581-3585`). A window AND a process
 * that never prints a summary and never exits. `refuseVisibleBrowser` sees none of it:
 * no browser is launched, `config.argv` carries no flag, and every project still
 * resolves to `headless: true`.
 *
 * Two decisions worth stating, because either could reasonably have gone the other way.
 *
 * ## No escape hatch
 *
 * `PLAYWRIGHT_ALLOW_HEADED=1` is the human's signature and `refuseVisibleBrowser`
 * honours it. This refusal does NOT. Widening that variable to mean "and may also open
 * the report viewer" would make the one knob in this file mean two things, and would
 * make the guarantee depend on an environment variable — which is the thing a model
 * under pressure will set. The cost is that an operator who wants to read the report in
 * a browser cannot get Playwright to open it for them, and does not need to: the run
 * still writes `playwright-report/`, and opening a file is not a Playwright command.
 *
 * ## Why this layer and not `kilo.jsonc`
 *
 * `kilo.jsonc` denies these tokens too, and it is the friendlier refusal because it
 * arrives before the process starts. It is not the load-bearing one: it is scoped to
 * this project directory, so it does not apply to a run started elsewhere, and every
 * other caller of the rule in this repository is a convention waiting for a bare
 * `npx playwright test`. `globalSetup` is the only layer that every invocation loads.
 * --------------------------------------------------------------------------- */

/** What named a window-opening hazard, and what it would have done. */
export interface WindowHazard {
  /** The exact token, quoted into the refusal so the reader can see what the run typed. */
  cause: string;
  /** Why that token opens something. Reported separately because the two causes differ. */
  why: string;
}

/**
 * Would a variable in `env` hand the HTML reporter an `open` option that opens?
 *
 * Pure over the environment record it is given, so the refusal is unit-testable with
 * the variable set and unset without mutating `process.env` — which matters here
 * because the thing under test is precisely "what this function reads out of the
 * environment".
 */
export function checkHtmlOpenEnv(env: Record<string, string | undefined>): WindowHazard | null {
  for (const variable of HTML_OPEN_ENV_VARS) {
    const value = env[variable];
    // Empty is falsy, so Playwright ignores it (`runner/index.js:3513`); refusing an
    // empty value would be refusing something that cannot open anything.
    if (!value || value === NON_OPENING_HTML_OPEN) continue;
    return {
      cause: `${variable}=${value}`,
      why:
        `${variable} is read as the HTML reporter's "open" option, and it outranks the ` +
        `\`open: '${NON_OPENING_HTML_OPEN}'\` in playwright.config.ts`,
    };
  }
  return null;
}

/**
 * Would this run name the `html` reporter without an `open` option?
 *
 * Covers the CLI (`--reporter`, `--add-reporter`, both the `--flag=value` and the
 * `--flag value` spellings) and `PW_TEST_REPORTER`, because all three reach the same
 * constructor with nothing in `_options.open` and therefore resolve to `"on-failure"`.
 *
 * There is no CLI syntax for reporter OPTIONS at all — `resolveReporterOption` splits
 * the value on `,` and hands each name to `resolveReporter` with nothing else
 * (`cli/testActions.js:165-168`) — so "names `html`" and "names `html` with an `open`"
 * are the same condition on this path, and there is no way to write the safe one.
 */
export function checkHtmlReporterSelection(options: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
}): WindowHazard | null {
  const fromEnv = options.env[REPORTER_ENV_VAR];
  if (fromEnv && namesHtmlReporter(fromEnv)) {
    return {
      cause: `${REPORTER_ENV_VAR}=${fromEnv}`,
      why: `${REPORTER_ENV_VAR} adds a reporter built from no options, so "open" resolves to "on-failure"`,
    };
  }

  for (const [index, arg] of options.argv.entries()) {
    // Everything after a bare `--` is a positional filter rather than an option, and
    // commander stops parsing options there (`program.js:51-52`). Refusing a grep
    // filter that happens to spell `--reporter=html` would be refusing a legitimate
    // way to select tests.
    if (arg === '--') break;

    const flag = REPORTER_FLAGS.find((candidate) => arg === candidate || arg.startsWith(`${candidate}=`));
    if (!flag) continue;

    const value = arg.includes('=') ? arg.slice(flag.length + 1) : (options.argv[index + 1] ?? '');
    if (!namesHtmlReporter(value)) continue;

    return {
      cause: `${flag} ${value}`,
      why:
        `${flag === '--reporter' ? 'replaces' : 'adds to'} the reporter list, and a reporter ` +
        'named on the command line carries no "open" option, so it resolves to "on-failure"',
    };
  }

  return null;
}

/**
 * Does this reporter list name the `html` reporter?
 *
 * Exact, comma-separated, no trimming and no case folding, because that is what
 * Playwright does: `resolveReporter` tests `builtInReporters.includes(id)`
 * (`cli/testActions.js:201-208`), so `--reporter=HTML` is not the html reporter to
 * Playwright either — it tries `require.resolve('HTML')` and fails loudly. Refusing it
 * here would replace an accurate error with a misleading one.
 */
function namesHtmlReporter(value: string): boolean {
  return value.split(',').includes(OPENING_REPORTER);
}

function refuseOpeningHtmlReport(hazard: WindowHazard | null): void {
  if (!hazard) return;

  throw new Error(
    [
      `Refusing to start a run that would open the HTML report and then never exit: ${hazard.cause}.`,
      '',
      `This run ${hazard.why}. When the report opens, Playwright serves it, hands it to the`,
      'default browser, and then waits on a promise it never resolves',
      '(node_modules/playwright/lib/runner/index.js:3581-3585) — so the run does not print a',
      'summary, does not set an exit code, and does not end until it is killed.',
      '',
      "playwright.config.ts asks for `open: 'never'` on purpose, and asking is not the same as",
      'binding: this refusal is what makes the ask hold for every `playwright test` invocation,',
      'and `kilo.jsonc` refuses the same tokens at the permission layer, before the process',
      'starts. Nothing here has an escape hatch, on purpose: a variable that switches off this',
      'refusal would put the guarantee one `export` away from being false.',
      '',
      'Run `npm run test:e2e`. It writes `playwright-report/` and never opens it.',
      '',
      'To read a failure, open the screenshot Playwright already wrote under the run output',
      'directory: test-results/, or test-results/runs/<run-id>/ when the run went through',
      'scripts/e2e-run.mjs, which prints the path it used. Add --retries=1 so `trace:',
      "'on-first-retry' produces a trace file. Do not run `show-report` or `show-trace`: both open",
      'a window and block until you close it.',
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
  // Two separate checks rather than one combined expression, so that the order is the
  // order a reader expects: a variable first, because it is the silent route, then the
  // flag someone typed. Both run before the warm-up, and both run before Playwright's
  // reporter `onExit` — which is when `_resolveOptions()` would finally read them.
  refuseOpeningHtmlReport(checkHtmlOpenEnv(process.env));
  refuseOpeningHtmlReport(checkHtmlReporterSelection({ argv: config.argv, env: process.env }));

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
