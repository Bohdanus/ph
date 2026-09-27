# AGENTS.md

Instructions for coding agents working in this repository.

## Never open a browser window

The e2e suite is headless by default and must stay that way. A headed browser puts
a live, clickable window on the operator's screen for the whole run. Their clicks,
keystrokes, mouse movement and focus changes reach the page as real input,
indistinguishable from the suite's own `page.mouse` / `page.keyboard` calls, so the
run fails for reasons that are not in the code and look exactly like real races.

Do not run, and do not reach for a workaround that involves:

| Blocked                         | Why                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `playwright test --headed`      | a visible window                                           |
| `playwright test --ui`          | opens the Playwright UI in the default browser, and blocks |
| `playwright test --debug`       | forces headed and opens the inspector                      |
| `playwright show-report`        | opens a window, and blocks until it is closed              |
| `playwright show-trace`         | opens a window, and blocks until it is closed              |
| `playwright codegen` / `open`   | opens a window                                             |
| `PLAYWRIGHT_ALLOW_HEADED=1`     | the human's opt-in, not yours                              |
| `test.use({ headless: false })` | a live window                                              |

`kilo.jsonc` denies most of these at the permission layer, and
`e2e/global-setup.ts` refuses the rest inside Playwright with a message saying what
to run instead. Both exist so this rule survives a model that has forgotten it. Do
not "fix" a failure by flipping the mode; a headed run fails 5 of the 97 tests
against headless's 2–4, on a disjoint set.

If something genuinely only reproduces visually, that is the operator's call. Ask
them to run `npm run test:e2e:headed` themselves.

## Commands

```bash
npm run test            # vitest, jsdom - app unit tests
npm run test:e2e:unit   # vitest, node - unit tests for the e2e helpers
npm run test:e2e        # playwright, HEADLESS - starts the dev server itself
npm run tsc             # tsc -b, all three project references
npm run lint:check      # eslint + prettier --check
```

`npm run test:e2e` needs no manual setup: `playwright.config.ts` starts Vite on
:5173 and tears it down after. Pass `--retries=1` if you want a trace, because
`trace: 'on-first-retry'` produces nothing at the local default of `retries: 0`.

## Reading a failure

Playwright already writes what you need. Do not open a viewer.

- `screenshot: 'only-on-failure'` puts a PNG in the failing test's `outputDir` under
  `test-results/`. Read that file.
- The `list` reporter on stdout is the pass/fail record. In CI the reporter also
  writes `test-results/results.json`.
- A trace is a `trace.zip` in the same directory. Reading it needs the trace viewer,
  which is a window, so ask the operator.

## Known failures

On the default headless run, 2–4 of the 97 e2e tests fail and 2 are skipped. They are
documented defects, not regressions, and several are **pinned** by a unit test that
asserts the current broken behaviour on purpose - a pin is a tripwire that fails the
moment the defect is fixed, so a fix must remove the pin in the same change.

| tests                                      | count |
| ------------------------------------------ | ----- |
| `e2e/helpers/cdp-helpers.spec.ts:220, 239` | 2     |
| `e2e/sidebar-keyboard.spec.ts:77, 89`      | 0-2   |

Read `e2e/OPEN_PROBLEMS.md` before investigating any of them, and read
`e2e/README.md` for how the suite works. Do not widen a threshold, add a skip, or
re-record a visual baseline to make one of these green - each is either a real defect
with a named fix or a recording decision that belongs to the operator.
