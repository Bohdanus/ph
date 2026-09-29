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
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI keeps the default (CPU-percentage) parallelism that `fullyParallel` expects;
  // local runs stay sequential so a failure is readable one test at a time and the
  // machine is not running two browsers per core. The port argument that used to sit
  // here is gone with the old reuse default: each run owns its port, so two runs no
  // longer fight over one app instance. The readability argument for `workers: 1` is
  // gone with headed mode: the local report is the same `list` output either way.
  workers: process.env.CI ? undefined : 1,
  // Two refusals, and both run for every `playwright test` invocation whatever started
  // it: a visible browser, and a base URL this run's own dev server is not serving.
  // The flags bypass `use.headless` entirely, and `PLAYWRIGHT_BASE_URL` is read here,
  // so neither can be enforced from one caller. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
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
    // Headless is better for this suite independently of that hazard: a headed run
    // fails 5 cdp-helpers.spec.ts tests that pass headless, and instead fails 2
    // different ones in the devicePixelFactor: 2 block. So if you run headed, expect
    // those 5. They are not a regression and they are not what CI will report.
    // Measurements and the underlying defect: e2e/OPEN_PROBLEMS.md.
    //
    // PLAYWRIGHT_ALLOW_HEADED=1 is the deliberate opt-in, for watching a canvas or
    // WebGL interaction that only reproduces visually. Both earlier names are gone
    // and setting either now does nothing. The one before that,
    // PLAYWRIGHT_HEADLESS, is also gone; PLAYWRIGHT_HEADED is the name a model
    // reaches for first when it wants a visible browser, and a variable that is also
    // the guard's acknowledgement of a human-authorised run cannot be that name. It
    // is the one value e2e/global-setup.ts accepts, so the config and the guard can
    // never disagree about whether this run was authorised.
    //
    // The variable is not enough on its own: --headed, --ui and --debug override
    // this value after the config is read, so the globalSetup guard above refuses
    // them.
    headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1',

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
