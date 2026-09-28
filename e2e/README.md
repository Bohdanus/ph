# End-to-End Tests

Playwright end-to-end specs for this application, plus Vitest unit tests for the
spec helpers themselves. The application under test is `src/` in this repository.

- [`OPEN_PROBLEMS.md`](OPEN_PROBLEMS.md) — defects in the test code, with evidence.
  None of them fails a current run; all are latent. See
  [Current status](#current-status).
- [`MIGRATION-TODO.md`](MIGRATION-TODO.md) — what the move into this repository left
  undone: open fixes, pipeline gaps, and carried-over debt.

```
e2e/
├── *.spec.ts            # 12 top-level specs: canvas redraw, colour, layers,
│                        #   levels, pen types, eraser / fill / eyedropper,
│                        #   select/move, sidebar flyout / keyboard / layout,
│                        #   viewport drawing, DPR
├── export/              # 6 export-format specs + committed visual-regression baselines
├── global-setup.ts      # refuses --headed / --ui / --debug before a window exists
└── helpers/             # 7 shared helper modules
    └── __tests__/       # Node-environment unit tests for those helpers
```

## Run it headless

```bash
npm run test:e2e
```

`npm run test:e2e` is **headless by default. Keep it that way.**

A headed run leaves a live, clickable Chrome window on your desktop for the whole
run. Anything you do to that window — a stray click, a mouse that drifts across it,
a keystroke, a focus change, an app switch — reaches the page as real input and is
indistinguishable from the suite's own `page.mouse` / `page.keyboard` calls. The
test then fails for a reason that is not in the code. Because the interference is
intermittent, it also looks exactly like a real race, so the two get conflated and
both get filed as "flaky".

**To be precise about the evidence:** no operator-input-caused failure has ever been
reproduced in this suite. Headless is a preventive default. What _was_ measured, and
what made headless the default rather than a preference, is that headed mode also
changed which tests fail, independently of any human:

| formerly failing tests                        | headed | headless |
| --------------------------------------------- | ------ | -------- |
| `cdp-helpers.spec.ts:113 :129 :146 :163 :195` | 5 fail | pass     |
| `cdp-helpers.spec.ts:220, 239`                | pass   | 2 fail   |

The two groups were disjoint and each mode's set reproduced identically across
repeats. Both are now fixed — the assertions no longer name a capture scale, so they
are mode-independent by construction — and the suite is green headless. A headed run
is expected to be green too, but that has not been measured here, and per
`AGENTS.md` it should not be: an operator's stray click reaching the page is
indistinguishable from a real race, so a green headed run would be weak evidence.

**What headless does not fix:** a real race. This suite had one —
`sidebar-keyboard.spec.ts` raced on "flyout closed after Enter" and fired in **headless**
runs with no operator input at all. Headless removes a failure class; it does not
by itself make a suite green.

Headed runs are for **looking at**, not for gating on. Use `npm run test:e2e:headed`
for the one thing headless cannot do: watching a canvas or WebGL interaction that
only reproduces visually. It prints a warning first — while it runs, leave the mouse
and keyboard alone.

`--headed`, `--ui` and `--debug` override the config's `headless` setting after the
config has been read, and `show-report` / `show-trace` / `codegen` never read it at
all. So the headless default alone is a convention with several ways around it.
`e2e/global-setup.ts` closes the first three: it runs before any browser is created
and throws, naming the flag that asked for a window. `kilo.jsonc` denies them at
the agent permission layer, including the npm script spellings, with one deliberate
exception: `--debug` and `test:e2e:debug` are `ask`, not `deny`, so a wrong guess
reaches a prompt instead of a silent block. The escape hatch for all of it is
`PLAYWRIGHT_ALLOW_HEADED=1`, which `test:e2e:headed` sets and which the guard also
honours, so the config and the guard can never disagree about whether a run was
authorised. `AGENTS.md` states the rule for coding agents.

## Running the e2e suite

```bash
npm run test:e2e
```

Nothing needs to be started by hand. `playwright.config.ts` declares a
`webServer` running `npm run dev`, so Playwright starts the Vite dev server on
<http://localhost:5173> and tears it down afterwards. 5173 is a default, not a
constant: `PLAYWRIGHT_PORT` moves the dev server, the `baseURL` the tests use, and
the port that is probed, in one step.

```bash
PLAYWRIGHT_PORT=5391 npm run test:e2e
```

Set it in a second worktree. Every worktree serves its own checkout, so a run that
attaches to a :5173 server it did not start is testing the other checkout's code,
which reads exactly like "my change did nothing". An explicit `PLAYWRIGHT_PORT`
also turns server reuse off by itself — it is a request to test _this_ checkout, so
a server already on that port is this run's own stale process rather than someone
else's to share.

With nothing set, a dev server you already have on :5173 is reused, which is
convenient when it is the only thing on the port. `PLAYWRIGHT_REUSE_EXISTING_SERVER=false`
turns that off and forces Playwright to start its own server:

```bash
PLAYWRIGHT_REUSE_EXISTING_SERVER=false npm run test:e2e
```

That is now a loud failure rather than a workaround: with the port occupied, the
reuse check refuses before it would launch anything, and the dev server is started
with `--strictPort` so it cannot silently hop to the next free port. On a port
somebody else is serving, reach for `PLAYWRIGHT_PORT` instead.

Point the suite at a server you did not start with `PLAYWRIGHT_BASE_URL`. It wins
navigation, so keep it and `PLAYWRIGHT_PORT` consistent:

```bash
PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e
```

The project defaults to the system Chrome channel (`channel: 'chrome'`), so
install it once with:

```bash
npm run test:e2e:install
```

Headless is the default, so a display is not required and this works over SSH and in
a container.

## Helper unit tests

Fast, browser-free tests for the modules in `e2e/helpers/`. They run in Node via
Vitest and need no application instance, so they are the only part of this suite
that CI gates on — see the `e2e-unit` job in `.github/workflows/ci.yml`.

```bash
npm run test:e2e:unit              # single run
npm run test:e2e:unit:coverage     # with a coverage report in ./coverage-e2e
```

Every helper module under `e2e/helpers/` is in the report. That is the durable part
of it, and a tripwire in both directions: a new helper module with no
`__tests__` file silently drops off the list, and nothing fails — there are no
coverage thresholds in `vitest.e2e.config.ts`.

These run under a **second, independent Vitest project** (`vitest.e2e.config.ts`),
not the root `vitest.config.ts`. The split is not cosmetic:

|                 | root `vitest.config.ts` | `vitest.e2e.config.ts`               |
| --------------- | ----------------------- | ------------------------------------ |
| environment     | `jsdom`                 | `node`                               |
| setup file      | `src/test/setup.ts`     | none                                 |
| `globals: true` | yes                     | no                                   |
| tests           | `src/**`                | `e2e/**/__tests__/**/*.unit.test.ts` |

The helpers exercise `node:fs/promises`, `sharp` and `pixelmatch`, none of which
exist under jsdom, and `src/test/setup.ts` imports `@testing-library/jest-dom`,
which expects a DOM. The root config also excludes `e2e/**` outright, because its
default `include` glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) would otherwise load
the Playwright specs into jsdom on every `npm test`.

Unit files must satisfy **both** halves: a `__tests__` directory _and_ a
`.unit.test.ts` name. Playwright skips anything under `__tests__` (plus the
`*.unit.test.ts` and `*.unit.spec.ts` name patterns as defence in depth), and
Vitest picks up the rest, so the two runners never overlap.

No `globals: true` in the e2e project: every unit file imports
`describe`/`it`/`expect` from `vitest` explicitly, and `vitest/globals` is not in
`tsconfig.e2e.json`'s `types`, so implicit globals would typecheck and then fail
at runtime.

## Type checking and linting

`e2e/` is a TypeScript project reference off the root `tsconfig.json`, so
`npm run tsc` (`tsc -b`) type-checks the specs, the helpers and the unit tests
alongside the app and node projects. It is green. `.husky/pre-commit` runs
`lint-staged`, `npm run tsc`, `npm run build` and `npm run test:e2e:unit`, so a
change under `e2e/` is type-checked and unit-tested before it is committed, not
only in CI. `test:e2e:unit` is the only commit-path coverage of these helpers —
`vitest.config.ts` excludes `e2e/**`, so nothing else in the commit gate can see
them.

Settings that differ from `tsconfig.app.json`, and why:

- `types: ["@playwright/test", "node"]` instead of the app's vite/jest-dom/vitest
  types. Deliberately **not** `vitest/globals`: every e2e unit file imports
  `describe`/`it`/`expect` from `vitest` explicitly, and the e2e Vitest project does
  not set `globals: true`, so implicit globals would typecheck and then fail at
  runtime.
- `noUnusedParameters: true`, as in the app and node configs. It was off here only to
  accommodate two unread parameters, and `tsconfig.e2e.json` records what happened to
  both. No e2e parameter is deliberately unread, so an unused one is a type error
  rather than a warning nobody has to read; the e2e ESLint block's `args: 'all'`
  reports the same thing a second way, so neither tool can hide it from the other.
- No `paths` alias and no `jsx`: nothing under `e2e/` imports app source. The e2e
  suite drives the real application through a browser, so reaching into `src/` from
  here would duplicate what the app's own unit tests already cover.
- `verbatimModuleSyntax` is on here too, as in the app config. It is why imports a
  type must be written `import { type Page }`.

`npm run lint:check` covers `e2e/` under a dedicated ESLint block that declares
Node **and** browser globals: the Playwright runner and Vitest need Node globals,
while every `page.evaluate()` callback is serialised into the page and needs DOM
globals. React rules are switched off there, since nothing under `e2e/` renders
React.

## Visual regression tests

`e2e/export/visual-regression.spec.ts` compares exported images against committed
baseline snapshots.

```bash
# run them
npx playwright test e2e/export/visual-regression.spec.ts

# update the baselines, then review `git diff` before committing
npm run test:e2e:update-baselines
```

### How it works

- Tests export drawings in various formats, render each to a canvas, and compare
  pixel-by-pixel against the baseline using `compareScreenshots`
  (`sharp` + `pixelmatch`, entirely in Node — no browser round-trip).
- Comparison must satisfy **both** a per-pixel threshold and a cap on differing
  pixels. `visual-regression.spec.ts` passes `threshold: 0.01` and
  `maxDiffPixels: 100` explicitly. The budgets live in one place —
  `DEFAULT_THRESHOLD = 0.2`, `DEFAULT_MAX_DIFF_PIXELS = 100`,
  `DEFAULT_MAX_DIFF_PIXEL_RATIO = 0.01` in `e2e/helpers/image-comparison.ts` — and
  `compareScreenshots` reads them through `options.x ?? DEFAULT_X`, so an
  explicitly-passed `undefined` falls back to the default instead of overwriting it.
  Read the call site rather than assuming a budget: the number that ran is whatever
  the call site passed, or the default when it passed nothing.
- The ICO test is a different comparison: it allows at most
  `CHANGED_CHANNEL_THRESHOLD_ICO` (20,000) colour channels to drift by more than
  `CHANNEL_DELTA_TOLERANCE` (40) from the source canvas.
- A **missing** baseline attaches the export and then throws, pointing at
  `--update-snapshots`. That fails the run on purpose: a missing baseline means
  the comparison was never made.

### Baseline layout

Committed baselines live under `e2e/export/visual-regression.spec.ts-snapshots/`.
Paths come from `testInfo.snapshotDir`, not `snapshotPath()` — the latter appends
the project name and the OS, which would make a baseline committed on one machine
read as missing on another.

The directory holds 17 files. These 7 are the ones `visual-regression.spec.ts`
actually reads, one per format with `comparePixels: true`:

```
e2e/export/visual-regression.spec.ts-snapshots/
└── export-baselines/
    ├── drawing.png.png            # PNG export baseline
    ├── drawing.jpeg.png           # JPEG export baseline
    ├── drawing.webp.png           # WebP export baseline
    ├── drawing.svg.png            # SVG (flattened) baseline
    ├── drawing.bmp.png            # BMP export baseline
    ├── drawing.gif.png            # GIF (static) baseline
    └── drawing.avif.png           # AVIF export baseline
```

The other 10 committed files are orphans — the 8 raw `drawing.<ext>` exports
(including `drawing.bmp`, the bulk of the 2.1 MB), plus `drawing-icon.ico.png` and
`source-baseline.png`. Nothing reads them; the ICO spec compares in-browser against
the source canvas instead. They are still tracked, pending authorisation to delete
committed baselines. See the entry in `OPEN_PROBLEMS.md`.

Per-run generated output — the actual exported files — is disposable and lands
under the test's own output dir in `test-results/`, which is gitignored. Clear it
with `npm run test:e2e:clean`.

`.gitattributes` marks `visual-regression.spec.ts-snapshots/**` as `binary` so the
committed pixels can never be rewritten by line-ending normalisation.

## Current status

Nothing fails on the default headless run, and that is stable across repeated full
runs. The numbers move every time a test is added, so the three commands below are
where to read them.

| Suite             | Command                 |
| ----------------- | ----------------------- |
| App unit tests    | `npm run test`          |
| Helper unit tests | `npm run test:e2e:unit` |
| E2E tests         | `npm run test:e2e`      |

Three groups used to; all three are fixed, and each was fixed by changing
an assertion or a wait rather than by loosening a threshold:

| formerly failing tests            | was                                     | now                                                               |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| `cdp-helpers.spec.ts`             | 2 headless, 5 headed, disjoint per mode | capture scale is no longer asserted; mode-independent             |
| `sidebar-keyboard.spec.ts:76, 88` | 0–2, 5 of 12 measured headless runs     | root-caused to a `requestAnimationFrame` focus race, then awaited |
| `levels.spec.ts:64, 109`          | 2, both modes                           | canvas located by test id, not document order                     |

- The CDP group derived its expected capture size from `window.devicePixelRatio`, but
  the capture scale is neither a function of that value nor of the emulated ratio.
  The contract was removed rather than re-derived — the scale belongs to Chrome, not
  to this code — and replaced with assertions that hold everywhere: exact rect, one
  integral scale on both axes, correct pixels, and no rescaling of the helper's own.
  Each was mutation-tested. See `OPEN_PROBLEMS.md` for the measurements.
- `sidebar-keyboard.spec.ts` was a real race, and not the one it looked like: the app
  focuses the flyout's first item in a `requestAnimationFrame`, so a keypress landing
  in that one-frame gap is handled by the tool button again and re-opens the flyout
  instead of activating an item. The opener now waits for the focus to land.
- The visual-regression baselines are genuinely compared. They were not before:
  `if (testInfo.config.updateSnapshots)` was always truthy, because Playwright's
  default for that option is the string `'missing'`, so every run re-recorded the
  baseline and returned before `compareScreenshots`. A green run now means the pixels
  matched.

The workspace canvas is located by `data-testid="workspace-canvas"`, published on the
primary `<canvas>` in `src/components/Main/Main.tsx`. There is no positional fallback:
a document index put the locator on the Draw preview canvas, or on a hidden overlay
once a tool change unmounted it. `getWorkspaceCanvas` is a single-selector locator
precisely so it can only ever match one element.

2 tests are declared `test.skip`: the Photopea PSD round-trip (needs the external
photopea.com) and one right-click flyout case.

A local run uses `retries: 0`; only `CI` sets `retries: 2`, so a local failure is
never retried away.

## Test commands

```bash
# e2e specs  (headless by default - see "Run it headless" above)
npm run test:e2e                     # plain `playwright test`; CI=true is set by the workflow
npm run test:e2e:headed               # opt in to a visible window; warns first, do not touch it
npm run test:e2e:ui                  # Playwright UI mode
npm run test:e2e:debug               # Playwright inspector
npm run test:e2e:install             # one-time browser install

# helper unit tests
npm run test:e2e:unit
npm run test:e2e:unit:coverage

# output
npm run test:e2e:report              # open the last HTML report (opens a window, and blocks)
npm run test:e2e:clean               # delete generated run output (test-results/)
npm run test:e2e:update-baselines    # rewrite the visual-regression baselines
```

`test:e2e:headed`, `test:e2e:ui` and `test:e2e:debug` all put a window on your screen,
and `test:e2e:report` does too — it also serves until you close the tab, so an agent
that runs it blocks. They are not interchangeable ways of reading a result: the
`list` reporter on stdout, the screenshot under `test-results/` and the
`test-results/results.json` written in CI are all readable without a window.

### Local vs CI behaviour

`npm run test:e2e` is deliberately a plain `playwright test` with **no** `CI=true`
prefix. Setting `CI` locally would flip `forbidOnly` on (a stray `test.only`
becomes a hard error), enable `retries: 2`, switch the reporter to `github`, and
default `workers` to full parallelism. Locally you get `workers: 1` and a
`list`/`html` reporter, which keeps a debug run readable.

**Both local and CI runs are headless.** The old `headless: !!process.env.CI` meant a
local run was _headed_ — the trap this file opens on. It is now
`headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1'`, so the only way to get a
window is to ask for one explicitly. `PLAYWRIGHT_ALLOW_HEADED=1` is that switch, and
`test:e2e:headed` is the script wrapping it. The previous `PLAYWRIGHT_HEADLESS`
variable is gone and setting it now does nothing, and so is `PLAYWRIGHT_HEADED` —
renamed, because it is the name a model reaches for first when it wants a window, and
that must not be sufficient on its own.

To use a browser other than Chrome, set `PLAYWRIGHT_CHANNEL` yourself:

```bash
PLAYWRIGHT_CHANNEL=msedge npx playwright test
```

## CI

`.github/workflows/ci.yml` has three jobs.

`e2e-unit` is the **blocking** gate for this directory: it runs
`npm run test:e2e:unit`, then `npm run test:e2e:unit:coverage`, and uploads
`coverage-e2e/` as the `e2e-helper-coverage` artifact. It needs no browser and no
application instance. The coverage step is ordered after the gate on purpose, so a
failure there is reported against a job whose tests already passed and can never
stand in for the gate; and because `vitest.e2e.config.ts` declares no coverage
thresholds, that step cannot go red on a percentage — only a failing test turns it
red.

It is a **separate job** rather than a step inside `ci` on purpose. Sharing a job
would mean this coverage is only ever reached after the app pipeline's own steps
succeed, so a break anywhere in `ci` would silently remove the only gate on the e2e
code while the workflow still looked like it was covered. A separate job cannot be
skipped that way. It carries no type-check step of its own: the `ci` job's
`npm run tsc` is `tsc -b`, which builds `tsconfig.e2e.json` along with the app and
node projects, so a second scoped run here could only repeat it.

`ci` is the pre-existing app pipeline: lint, audit, type-check, an assertion that
every tracked `.ts`/`.tsx` is inside some project's `include`, unit tests, and the
production build. `tsc -b` is what also builds `tsconfig.e2e.json`.

`e2e` installs Chrome and runs the browser tests against the dev server started by
`playwright.config.ts`. It is still marked `continue-on-error: true`, and that
justification no longer holds: it was there because 2–4 of the 97 tests failed for
documented reasons, and **all of them are now fixed**. The suite is green locally,
headless, across repeated full runs.

It is left as-is because making the job blocking is a workflow decision that belongs
to the operator, not a consequence of this work. It is also the one thing left to do
to make the job a real gate: flipping `continue-on-error` to `false`. Two things
should be settled first, because a blocking job is only as good as what it compares
against:

- a headed run, to confirm the CDP fix is green outside the headless configuration
  this host can produce (see `AGENTS.md` — the operator runs it, not an agent);
- whether the visual-regression baselines should be regenerated from a production
  build rather than a dev server, since the job runs against `npm run dev`.

Until then the job reports the true state including the 2 declared skips. It runs
the full suite with no `--grep-invert`, so the report is unfiltered.
