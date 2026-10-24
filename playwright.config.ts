import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * The application under test lives in this repository (`src/`), so unlike the
 * standalone test package these specs were extracted from, `webServer` below can
 * actually start it. Running the e2e suite needs nothing started by hand.
 */
/**
 * The port the dev server and the tests agree on.
 *
 * This is a default, and the interesting caller is `scripts/e2e-run.mjs`, which
 * every `test:e2e*` run script routes through: it sets `PLAYWRIGHT_PORT` to a port
 * it found free, so the dev server, the `baseURL` the tests navigate to, and the
 * port probed below are one number belonging to that run. It leaves this value
 * alone when the caller has already chosen one, and under `CI`.
 */
const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseUrl = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  // Unit files live under a `__tests__` DIRECTORY and are named `*.unit.test.ts`.
  // The `__tests__` rule is what actually excludes them; the two name patterns are
  // defence in depth so a unit file that lands outside `__tests__` is still skipped
  // by Playwright and left to vitest.
  testIgnore: ['**/__tests__/**', '**/*.unit.spec.ts', '**/*.unit.test.ts'],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  // UNCONDITIONAL, and deliberately not `!!process.env.CI`.
  //
  // A committed `test.only` is not a CI problem, it is a SILENT SCOPE REDUCTION on
  // every local run: the suite collects one test, prints it green, and the operator
  // reads a green run as coverage. The old `!!process.env.CI` guard therefore made
  // the failure mode worst exactly where it is least visible — a local run reports
  // one passing test where there should be hundreds, and nothing says so.
  //
  // `forbidOnly` costs a developer nothing: a `test.only` in a working tree is a
  // deliberate act, and the fix is to delete it or commit it as `test.skip`, which
  // states the intent in a form that survives review.
  //
  // This is a STRUCTURAL refusal, like the `headless` default below: it holds for
  // every invocation whatever started it, and nothing but a reviewable edit to this
  // file can turn it off. Pinned by the `it('refuses a committed `test.only` on every
  // run, not only under CI')` guard in src/__tests__/harness-integrity.test.ts, which
  // reads the config with `CI` deleted AND set, because one reading does not
  // discriminate — `!!process.env.CI` is already `true` under CI.
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  // A FLAKY test is one that failed an attempt and passed a later one, and
  // Playwright REPORTS that as a pass: `ok()` accepts `"expected"`, `"flaky"` and
  // `"skipped"` alike. `failOnFlakyTests` below turns a pass after retry into a
  // failed run; the policy is documented in `docs/TESTING.md#ci`.
  //
  // Playwright's own default is `false`, and the key gates ONLY the flaky term of a
  // five-term disjunction, so its absence is not a permissive default that happens
  // to be inherited: it is the reason the other four terms are the only ones that
  // can turn a run red.
  //
  // UNCONDITIONAL, and deliberately not `!!process.env.CI`, for the opposite reason
  // to the one above `forbidOnly`. `retries` is 0 locally, so a local test cannot be
  // flaky in the sense this key measures — `computeTestCaseOutcome` answers `"flaky"`
  // only when a test has at least one expected AND one unexpected RESULT, which
  // requires a second attempt to exist — so the key is TRUE LOCALLY AND CANNOT FIRE.
  // Stating it costs a developer nothing, and it stops a value this file does not
  // declare from being what decides the question.
  failOnFlakyTests: true,
  // The WHOLE-RUN clock, and deliberately BELOW the `e2e` matrix legs'
  // `timeout-minutes` (30 on Linux, 35 on Windows/macOS) in .github/workflows/ci.yml.
  // Playwright's default is `0`, which is unbounded, so today a hung suite is stopped
  // by GitHub killing the job — and a job killed for exceeding `timeout-minutes` runs
  // NONE of its remaining steps: no HTML report, no `test-results/results.json`, no
  // trace, no diff image. The timeout and the evidence it was meant to preserve cancel
  // out, and that is the whole reason this number is not 1800 or more.
  //
  // The arithmetic, with the Linux leg's 1800 s split three ways:
  //   SETUP  <= 480 s  checkout, setup-node, `npm ci` (431 packages, 347 MB of
  //                   node_modules, and `cache: 'npm'` misses on every
  //                   package-lock.json change) and `npx playwright install
  //                   --with-deps chrome`, which the workflow deliberately does not
  //                   cache at all
  //   TESTS  <= 900 s  this key, under CI
  //   UPLOAD <= 180 s  actions/upload-artifact@v4 zipping `playwright-report/` plus
  //                   `test-results/`, whose per-retry traces are the bulk of it
  // 480 + 900 + 180 = 1560 s = 26 min, which leaves 4 min INSIDE the 30-minute job
  // kill. Raise it to 1800 s and GitHub wins that race, so a hang produces no diff
  // image at all — the exact loss the timeout was added to prevent.
  //
  // 900 s against a measured ~8 min for all 447 tests at `workers: 1` on this
  // machine, which is an UPPER bound for the job: CI resolves `workers` to "50%" of
  // 4 vCPUs, so it runs 2 of them. Roughly 3x the real test phase, so the bound can
  // only fire on a hang.
  //
  // CI splits the suite into two Playwright shards so every spec can finish while
  // leaving time for report and trace upload inside the job timeout. Keep this
  // deadline below the shortest E2E job timeout; local runs retain extra time for
  // diagnostics on slower machines.
  //
  // A Playwright global timeout still produces the HTML and JSON reports before
  // exiting as a failure. GitHub's job timeout does not, so the two limits must
  // remain ordered. `--debug` resets this to 0 for interactive debugging.
  globalTimeout: process.env.CI ? 20 * 60_000 : 45 * 60_000,
  // CI keeps the default (CPU-percentage) parallelism that `fullyParallel` expects;
  // local runs stay sequential so a failure is readable one test at a time and the
  // machine is not running two browsers per core. The port argument that used to sit
  // here is gone with the old reuse default: each run owns its port, so two runs no
  // longer fight over one app instance. The readability argument for `workers: 1` is
  // gone with headed mode: the local report is the same `list` output either way.
  workers: process.env.CI ? undefined : 1,
  // Three refusals, and all three run for every `playwright test` invocation whatever
  // started it: a visible browser, a base URL this run's own dev server is not
  // serving, and an HTML report that would open itself and never let the run exit.
  // None of the three can be enforced from one caller — the flags bypass
  // `use.headless` entirely, `PLAYWRIGHT_BASE_URL` is read here, and the reporter
  // computes its own `open` option in preference to the one below.
  // See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  // `open: 'never'` is necessary and NOT sufficient: two undocumented environment
  // variables and a CLI `--reporter` all outrank it (runner/index.js:3450, 3511,
  // 5221). The refusal that makes it binding is in e2e/global-setup.ts, which runs
  // before the reporter's onExit.
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list'], ['html', { open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Testing a deployed build needs E2E_ALLOW_REMOTE=1, which
     * `npm run test:e2e` refuses without and `e2e/global-setup.ts` refuses without
     * for EVERY invocation, including a bare `npx playwright test`:
     *   E2E_ALLOW_REMOTE=1 PLAYWRIGHT_BASE_URL=https://staging.example.com npx playwright test
     * The run logs which origin it loaded. See e2e/README.md. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? baseUrl,
    // HEADLESS IS THE DEFAULT. Do not flip this to headed-on-local.
    //
    // A headed browser puts a live, clickable window on the operator's desktop for
    // the whole run. Anything the human does to that window - a stray click, a mouse
    // that drifts across it, a keypress, a focus change, switching apps - reaches
    // the page as real input and is indistinguishable from the suite's own
    // page.mouse / page.keyboard calls. The test then fails for a reason that is not
    // in the code, and because the interference is intermittent it is
    // indistinguishable from a real race. Both get written down as "flaky" and
    // neither gets fixed.
    //
    // A headed run is a DIFFERENT MEASUREMENT, not a stricter one, and it is not
    // evidence about this branch even where it agrees. This paragraph used to tell an
    // operator to expect "5 failures in cdp-helpers.spec.ts and 2 different ones in the
    // devicePixelFactor: 2 block". Both sets were real once and neither exists now: the
    // five derived an expected capture size from `getDevicePixelRatio()`, and that
    // function is gone from e2e/helpers/cdp-helpers.spec.ts. Quoting counts for defects
    // that are fixed is worse than quoting nothing — an operator who runs headed, gets
    // zero failures, and concludes the run is not measuring this branch.
    //
    // So: the reason not to run headed is the operator-input hazard above and nothing
    // else. The measurements, the two fixed defect groups and the shapes the suite must
    // not drift back into are recorded in e2e/OPEN_PROBLEMS.md; go there for numbers
    // rather than taking a stale count from here.
    //
    // PLAYWRIGHT_ALLOW_HEADED=1 is the deliberate opt-in, for watching a canvas or
    // WebGL interaction that only reproduces visually. Both earlier names are gone
    // and setting either now does nothing. The one before that,
    // PLAYWRIGHT_HEADLESS, is also gone; PLAYWRIGHT_HEADED is the name a model
    // reaches for first when it wants a visible browser, and a variable that is also
    // the guard's acknowledgement of a human-authorised run cannot be that name. It is
    // the one value e2e/global-setup.ts accepts, so the config and the guard can
    // never disagree about whether this run was authorised.
    //
    // The variable is not enough on its own: --headed and --debug override this value
    // after the config is read, so the globalSetup guard refuses them. `--ui` is NOT
    // refused there and cannot be: runUIMMode returns before globalSetup is ever
    // constructed. kilo.jsonc denies that flag on its own pattern instead.
    headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1',

    /* The pixel helpers in e2e/helpers/canvas-helpers.ts classify a pixel with FIXED
     * thresholds that are only correct against the app's LIGHT theme, and nothing
     * declared that. DARK_THRESHOLD is 50 and NEAR_WHITE_THRESHOLD is 250
     * (the `DARK_THRESHOLD` / `NEAR_WHITE_THRESHOLD` constants), and the workspace backdrop the
     * canvas sits on is a
     * 20px checkerboard chosen from the resolved theme: `#f3f3f3` over `#fff` for
     * light, `#121212` over `#000` for dark (the `.chessboard-light` / `.chessboard-dark`
     * rules in `src/index.scss`, switched by `Main.tsx`). So under dark the backdrop is
     * itself below
     * the dark threshold, and under light the letterbox is above the near-white one.
     * The thresholds are not "roughly right"; they are calibrated to one palette.
     *
     * Playwright's own default is 'light', so every already-green test is correct today
     * and is correct by an inherited value that this file never stated.
     * `e2e/document-dialogs.spec.ts` no longer pins the theme itself; its own comment
     * records that as a deletion rather than a demotion, which is what makes this line
     * the only pin.
     *
     * What breaks without it, in the canvas helpers: every `hasDarkPixels` wait can be
     * satisfied by the dark letterbox alone, and every `getStrokeAnalysis` reads a
     * backdrop it believes is the page's background. A stroke that never landed passes
     * its wait and fails later, or passes for the wrong reason.
     *
     * This DECLARES a precondition every green test already relies on; it constrains
     * nothing new. It is deliberately not a variable: an escape hatch on a pixel
     * threshold is a way to turn the suite's colour measurements off, which is the same
     * move as raising a threshold, and it would not be greppable as one. A spec that
     * genuinely needs the dark palette should pin `colorScheme: 'dark'` on itself and
     * measure the direction it depends on, exactly as document-dialogs.spec.ts did. */
    colorScheme: 'light',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Chrome is a system browser; disable video so it can run without Playwright ffmpeg.
    video: 'off',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'Google Chrome',
      use: {
        ...devices['Desktop Chrome'],
        // System Chrome, not Playwright's bundled Chromium. Override with
        // PLAYWRIGHT_CHANNEL, e.g. PLAYWRIGHT_CHANNEL=msedge.
        channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
      },
    },
  ],

  /* Run the dev server before starting the tests */
  webServer: {
    // `npm run dev` is this repository's Vite dev server, serving `src/` on the port
    // above. `--strictPort` makes a port clash a hard failure rather than Vite's
    // default silent hop to 5174, which would leave the tests pointed at a server
    // this run never started.
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseUrl,
    // NEVER TRUE, AND NOT CONFIGURABLE. There is no environment variable, no
    // argument and no field to turn this on, and that is the point.
    //
    // Every worktree under `.kilo/worktrees/` serves its OWN checkout, so two
    // worktrees on one port are two different applications on one address. A run
    // that attaches to a server it did not start tests the other checkout's code
    // and reports green, which reads exactly like "my change did nothing".
    // TEST-FLAKES.md §10 is a mutation campaign that reported seven product
    // mutations as green for precisely this reason.
    //
    // An earlier version of this file had an opt-in here
    // (`PLAYWRIGHT_REUSE_EXISTING_SERVER=1`) on the reasoning that an operator
    // might want to attach to a `npm run dev` they started. It was withdrawn: an
    // escape hatch that attaches to whatever holds the port is the same defect
    // with a documented name, and the only thing it reliably does is let an agent
    // under time pressure choose it. `scripts/e2e-run.mjs` now refuses the variable
    // outright, so setting it is an error rather than a silent no-op.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
