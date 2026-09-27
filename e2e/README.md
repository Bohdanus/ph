# End-to-End Tests

Playwright end-to-end specs for this application, plus Vitest unit tests for the
spec helpers themselves. The application under test is `src/` in this repository.

```
e2e/
├── *.spec.ts            # 11 top-level specs: canvas redraw, colour, layers,
│                        #   levels, pen types, select/move, sidebar flyout /
│                        #   keyboard / layout, viewport drawing, DPR
├── export/              # 6 export-format specs + committed visual-regression baselines
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
reproduced in this suite. Headless is a preventive default. What _is_ measured is
that headed mode also changes which tests fail, independently of any human:

| failing tests                                 | headed | headless |
| --------------------------------------------- | ------ | -------- |
| `cdp-helpers.spec.ts:113 :129 :146 :163 :195` | 5 fail | pass     |
| `cdp-helpers.spec.ts:220, 239`                | pass   | 2 fail   |

So a headed run fails 7 and headless fails 5, on disjoint subsets, reproducibly. If
you run headed, expect those 5 CDP failures — they are not a regression, and they
are not what CI will report.

**What headless does not fix:** the real open defects below survive it.
`sidebar-keyboard.spec.ts:77` and `:89` race on "flyout closed after Enter" and fail
in 4 of 5 **headless** runs, and the 2 `levels.spec.ts` failures are mode-independent.
Headless removes a failure class; it does not make the suite green.

Headed runs are for **looking at**, not for gating on. Use `npm run test:e2e:headed`
for the one thing headless cannot do: watching a canvas or WebGL interaction that
only reproduces visually. It prints a warning first — while it runs, leave the mouse
and keyboard alone.

Note that `--headed`, `--ui` and `--debug` bypass the config's headless setting by
design, so they all open a real window.

## Running the e2e suite

```bash
npm run test:e2e
```

Nothing needs to be started by hand. `playwright.config.ts` declares a
`webServer` running `npm run dev`, so Playwright starts the Vite dev server on
<http://localhost:5173> and tears it down afterwards.

If you already have a dev server on that port, Playwright reuses it. Point the
suite somewhere else with `PLAYWRIGHT_BASE_URL`:

```bash
PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e
```

Set `PLAYWRIGHT_REUSE_EXISTING_SERVER=false` to force Playwright to start its own
server instead of attaching to whatever is already listening.

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

Coverage covers 6 of the 7 helper modules. `e2e/helpers/cdp-helpers.ts` is absent
from the report: its only tests are the Playwright specs in
`cdp-helpers.spec.ts`, which run in a browser and so are outside this Vitest
project. That is the same reason 5 of those specs are currently red — see
`OPEN_PROBLEMS.md`.

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
`npm run tsc` type-checks the specs, the helpers and the unit tests. Note that
`tsc -b` is _not_ currently green for the whole repository — nine `src` test files
import `@testing-library/user-event`, which is missing from `package.json`. That is
pre-existing and unrelated to this suite; `tsc -b` reports **zero** errors for
`e2e/`. It also means `.husky/pre-commit` cannot pass, so nothing here is enforced
by the pre-commit hook today.

Settings that differ from `tsconfig.app.json`, and why:

- `types: ["@playwright/test", "node"]` instead of the app's vite/jest-dom/vitest
  types. Deliberately **not** `vitest/globals`: every e2e unit file imports
  `describe`/`it`/`expect` from `vitest` explicitly, and the e2e Vitest project does
  not set `globals: true`, so implicit globals would typecheck and then fail at
  runtime.
- `noUnusedParameters: false` — see `tsconfig.e2e.json` for why. Unused _locals_
  are still an error, and the e2e ESLint block uses `args: 'all'` so both
  deliberately-unread parameters are reported as warnings.
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
  `maxDiffPixels: 100` explicitly. The shared helpers carry their own defaults
  (`DEFAULT_THRESHOLD = 0.2`, `maxDiffPixels = 100`, `maxDiffPixelRatio = 0.01`),
  but `expectCanvasToMatch` in `e2e/helpers/image-comparison.ts` ends its options
  object with a `...options` spread, so an explicitly-passed `undefined` overrides
  the default instead of falling back to it. Treat the defaults as a starting
  point, not a guarantee — read the call site. This is tracked as a P1 in
  `OPEN_PROBLEMS.md`.
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

97 tests in 21 spec files, plus 694 helper unit tests (10 files).

| Suite             | Command                 | Result                                      |
| ----------------- | ----------------------- | ------------------------------------------- |
| App unit tests    | `npm run test`          | 3811 pass + 42 expected-fail, 173/173 files |
| Helper unit tests | `npm run test:e2e:unit` | 692 pass, 2 expected-fail (10 files)        |
| E2E tests         | `npm run test:e2e`      | 90 pass, 5 fail, 2 skipped (21 files)       |

**4–6 of the 97 e2e tests fail on the default headless run** (this HiDPI host);
the spread is the keyboard race below. A headed run fails 7, on a different set.
All are pre-existing defects in the tests, not integration breakage, and each is
written up with evidence in `OPEN_PROBLEMS.md`:

| failing tests                                 | count | mode                 |
| --------------------------------------------- | ----- | -------------------- |
| `cdp-helpers.spec.ts:220, 239`                | 2     | headless only        |
| `cdp-helpers.spec.ts:113 :129 :146 :163 :195` | 5     | **headed only**      |
| `levels.spec.ts:64, 109`                      | 2     | both                 |
| `sidebar-keyboard.spec.ts:77, 89`             | 0–2   | 4 of 5 runs headless |

- The CDP group derives its expected capture size from `window.devicePixelRatio`,
  but the observed capture multiplier is neither a function of that value nor of the
  emulated ratio — forcing the emulation to match the host changes which tests fail
  instead of fixing them. Which subset fails is deterministic per mode. See
  `OPEN_PROBLEMS.md` for the measurements and the fix direction.
- `levels.spec.ts` — `getWorkspaceCanvas` resolves the workspace canvas by document
  index, and the index shifts when opening the Levels panel unmounts the
  tool-preview canvas. Verified failing in both modes, 2/2 each.
- `sidebar-keyboard.spec.ts:77, 89` — a real race on "flyout closed after Enter",
  failing in 4 of 5 headless runs. **Not fixed by running headless.**

2 tests are declared `test.skip`: the Photopea PSD round-trip (needs the external
photopea.com) and one right-click flyout case.

A local run uses `retries: 0` (only `CI` sets `retries: 2`), so the keyboard race is
a hard red run locally.

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
npm run test:e2e:report              # open the last HTML report
npm run test:e2e:clean               # delete generated run output (test-results/)
npm run test:e2e:update-baselines    # rewrite the visual-regression baselines
```

### Local vs CI behaviour

`npm run test:e2e` is deliberately a plain `playwright test` with **no** `CI=true`
prefix. Setting `CI` locally would flip `forbidOnly` on (a stray `test.only`
becomes a hard error), enable `retries: 2`, switch the reporter to `github`, and
default `workers` to full parallelism. Locally you get `workers: 1` and a
`list`/`html` reporter, which keeps a debug run readable.

**Both local and CI runs are headless.** The old `headless: !!process.env.CI` meant a
local run was _headed_ — the trap this file opens on. It is now
`headless: process.env.PLAYWRIGHT_HEADED !== '1'`, so the only way to get a window is
to ask for one explicitly. `PLAYWRIGHT_HEADED=1` is that switch, and
`test:e2e:headed` is the script wrapping it. The previous `PLAYWRIGHT_HEADLESS`
variable is gone and setting it now does nothing.

To use a browser other than Chrome, set `PLAYWRIGHT_CHANNEL` yourself:

```bash
PLAYWRIGHT_CHANNEL=msedge npx playwright test
```

## CI

`.github/workflows/ci.yml` has three jobs.

`e2e-unit` is the **blocking** gate for this directory: it runs
`npm run test:e2e:unit` (692 pass, 2 expected-fail) and `npx tsc -b
tsconfig.e2e.json` (0 errors). It needs no browser and no application instance.

It is a **separate job** rather than a step inside `ci` on purpose. Sharing a job
would mean this coverage is only ever reached after the app pipeline's own steps
succeed, so a break anywhere in `ci` would silently remove the only gate on the e2e
code while the workflow still looked like it was covered. A separate job cannot be
skipped that way. It also builds only `tsconfig.e2e.json`, so an app-project type
error cannot take the e2e type-check down with it.

`ci` is the pre-existing app pipeline (lint, audit, type-check, test, build),
unchanged by this work apart from `tsc -b` now also building `tsconfig.e2e.json`.

`e2e` installs Chrome and runs the browser tests against the dev server started by
`playwright.config.ts`. It is marked `continue-on-error: true` and is
**informational only**, because 5 of the 97 tests fail for reasons documented in
`OPEN_PROBLEMS.md`, and because the CDP failure tracks the browser mode in a way not
yet observed on a Linux runner. It runs the full suite with no `--grep-invert`, so
the job reports the true state including the known failures rather than a filtered
one. Flip `continue-on-error` to `false` once the tests are green.
