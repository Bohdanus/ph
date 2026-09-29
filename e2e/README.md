# End-to-End Tests

Playwright end-to-end specs for this application, plus Vitest unit tests for the
spec helpers themselves. The application under test is `src/` in this repository.

- [`OPEN_PROBLEMS.md`](OPEN_PROBLEMS.md) — defects in the test code, with evidence.
  None of them fails a current run; all are latent. See
  [Current status](#current-status).
- [`MIGRATION-TODO.md`](MIGRATION-TODO.md) — what the move into this repository left
  undone: open fixes, pipeline gaps, and carried-over debt.

The tree, at the level of shape rather than of inventory. New spec files land here
constantly, so read the directory instead of a list, and keep no counts in this
comment — a count here is only correct until the next merge.

````
e2e/
├── *.spec.ts            # top-level app specs
├── export/              # export-format specs + committed visual-regression baselines
├── helpers/             # shared helper modules, each with a unit file in
│   │                    #   __tests__/ and a Playwright spec beside the
│   │                    #   browser-facing ones
│   └── __tests__/       # Node-environment unit tests for the helper modules
└── global-setup.ts      # refuses --headed / --ui / --debug before a window exists
```

Counts are deliberately absent, and an earlier version of this block carried them
(22 specs / 8 helpers, then 26 / 9). Each was correct on the day it was written and
wrong within a merge, because a spec that lands or is deleted in any branch rewrites
the number without touching this file. The counts were wrong in both directions at
once — a stale total beside a table that named specs the total omitted. Derive one when
you need it: `ls e2e/*.spec.ts | wc -l`, and
`ls e2e/helpers/*.ts | grep -v '\.spec\.ts$' | wc -l`.

### What the top-level specs are organised by

`ls e2e/*.spec.ts` is alphabetical because that is how the directory is. What is not
alphabetical is what each one is responsible for, and several of them overlap on
purpose:

| Concern                       | Specs                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Keyboard                      | `keyboard-shortcuts`, `sidebar-keyboard`                                                            |
| The left rail and its flyouts | `sidebar-flyout`, `sidebar-keyboard`, `sidebar-layout`                                              |
| Layers and the panel          | `layers`, `layers-panel`, `undo-redo`                                                               |
| History and its panel         | `keyboard-shortcuts`, `history-panel`, `undo-redo`                                                  |
| Dialogs and the document      | `document-dialogs`, `select-move` (crop), `file-roundtrip`                                          |
| Adjustments and filters       | `adjustments`, `filter-tools`, `levels`                                                             |
| Pixel-affecting tools         | `paint-tools`, `paint-options`, `pen-types`, `shape-tools`, `filter-tools`, `erase-fill-eyedropper` |
| Selections                    | `selection-tools`, `select-move`                                                                    |
| Text                          | `text-tool`                                                                                         |
| Shell and viewport            | `responsive-shell`, `mobile-shell`, `viewport-drawing`                                              |
| Device pixel ratio            | `check-dpr`                                                                                          |

The table is a map of overlaps, not an index: a spec with no second entry here is
simply one nothing else contends with. Several of the top-level specs are not listed,
and the list is not maintained as one — read the directory for the current inventory,
per the note at the top.

`layers.spec.ts` and `layers-panel.spec.ts` overlap deliberately: the first is
about the stack a tool sees, the second about the panel that edits it. Splitting
them by file would have hidden that they describe one feature from two sides.

## Run it headless

```bash
npm run test:e2e
````

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

**That command is a wrapper, not `playwright test`.** It runs
`scripts/e2e-run.mjs`, which does three things before Playwright starts, and every
one of them exists because of a way concurrent runs get silently wrong:

1. **It takes a swarm lock**, so only one suite runs at a time across every
   worktree on this machine. See [One suite at a time](#one-suite-at-a-time).
2. **It allocates a port of its own**, so two agents in two worktrees are never
   asking for :5173.
3. **It gives the run its own output directory**, because Playwright _deletes_
   `outputDir` at the start of every run, so a second run otherwise erases the
   first run's failure screenshots before anybody has read them.

Every argument is forwarded verbatim:

```bash
npm run test:e2e -- e2e/sidebar-flyout.spec.ts
npm run test:e2e -- --retries=1 e2e/undo-redo.spec.ts
```

### One suite at a time

`npm run test:e2e` asks the swarm board for a file lock on
`e2e/.swarm-e2e-runner` before it starts, and gives it back when the run ends —
including when the run fails or the wrapper is interrupted. That path is
**virtual**: it is never created on disk, and `npm run swarm status` shows it as a
live lock while a suite is in flight, so an agent can see who has it without
asking.

If another agent has it, the run **queues** rather than starting on top of it. It
prints the holder's name and waits; if the wait runs out, nothing runs and the
command exits **4** — the board's own "file held by another agent" code, so
`npm run swarm check e2e/.swarm-e2e-runner` and this wrapper agree on what 4
means. Do the other work and run the same command again.

| Variable           | Default | What it does                                            |
| ------------------ | ------- | ------------------------------------------------------- |
| `E2E_LOCK_TIMEOUT` | 10 min  | How long to queue. `0` fails immediately.               |
| `E2E_LOCK_POLL`    | 3 s     | How often to re-check while queued.                     |
| `E2E_LOCK_LEASE`   | `30m`   | How long a **dead** holder blocks the queue.            |
| `E2E_SKIP_LOCK`    | unset   | `1` runs unsynchronized, loudly. Operator escape hatch. |

`--no-lock` is the same as `E2E_SKIP_LOCK=1`. The lock is skipped automatically
under `CI`, where one job owns one checkout and there is no board to talk to. If
the board cannot be reached at all — outside a git checkout, or a Node without
`node:sqlite` — the wrapper prints a **warning and runs anyway**: failing every
suite on that machine would be worse than the collision the lock prevents.

The lease is deliberately shorter than a full suite and renewed while the run
lives. A file lock is never renewed by the board itself (`renewOwnClaims` only
touches issue _claims_), so a long run would otherwise watch its own lock expire,
have it reclaimed by the next `swarm` command from anybody, and start racing a
second suite. A renewal that fails stops the run rather than risking that.

**A lock is a queue, not a gate.** It never decides that a change does not need
e2e: the Definition of Done still requires a run for a user-visible change, and
this is what makes that requirement survivable when several agents are merging at
once. Run the full suite before merging; use a targeted spec to iterate.

### Ports and servers

Nothing needs to be started by hand. `playwright.config.ts` declares a
`webServer` running `npm run dev`, so Playwright starts the Vite dev server and
tears it down afterwards. 5173 is a default, not a constant, and the wrapper
usually replaces it: it asks the OS for a free port and sets `PLAYWRIGHT_PORT`,
which moves the dev server, the `baseURL` the tests use, and the port that is
probed, in one step.

It leaves the port alone when you have already chosen one:

```bash
PLAYWRIGHT_PORT=5391 npm run test:e2e
```

**Server reuse is opt-in now, and the flag was renamed to say so.** A run used to
attach to any server already on :5173, which in a worktree is _another
checkout's_ code — a mutation campaign in `TEST-FLAKES.md` §10 reported every
mutation green that way. To attach to a dev server you started yourself:

```bash
PLAYWRIGHT_REUSE_EXISTING_SERVER=1 npm run test:e2e
```

That is the only way to reuse, `PLAYWRIGHT_PORT` disables it, and with the port
occupied the dev server is started with `--strictPort` so it fails loudly instead
of silently hopping to the next free port.

Point the suite at a server you did not start with `PLAYWRIGHT_BASE_URL`. It wins
navigation, so keep it and `PLAYWRIGHT_PORT` consistent:

```bash
PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e
```

### Output

Each run writes to `test-results/runs/<run-id>/` and
`playwright-report/runs/<run-id>/`, and the wrapper prints the directory before
the suite starts. Both parents are gitignored, and `npm run test:e2e:clean`
removes them. A bare `npx playwright test` (or `npm run test:e2e:raw`) skips the
wrapper and writes to the shared `test-results/` — that is the same as CI, where
the JSON reporter's output is collected as an artifact, and it is why CI calls
Playwright directly.

The project defaults to the system Chrome channel (`channel: 'chrome'`), so
install it once with:

```bash
npm run test:e2e:install
```

Headless is the default, so a display is not required and this works over SSH and in
a container.

## Helper unit tests

Fast, browser-free tests for the modules in `e2e/helpers/`. They run in Node via
Vitest and need no application instance, so they get their own CI job rather than
sharing one with the browser run — see the `e2e-unit` job in
`.github/workflows/ci.yml`. The specs themselves are gated too, by the `e2e` job.

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
`lint-staged`, `npm run tsc` and `npm run build`, so a change under `e2e/` is
type-checked and built before it is committed. It does **not** run the helper
unit tests: `test:e2e:unit` is not in the commit gate. It is the only coverage
these helpers have — `vitest.config.ts` excludes `e2e/**` — and it is not
optional, because the `e2e-unit` CI job runs it as its own blocking step,
separately from `ci`, so a break in the app pipeline cannot remove the only gate
on `e2e/`. Run `npm run test:e2e:unit` by hand when you change anything here.

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
  `npm run test:e2e:update-baselines`. That fails the run on purpose: a missing
  baseline means the comparison was never made. The npm script, not a bare
  `--update-snapshots`, is the recovery: the flag's own preset is `'changed'`,
  the record branch requires `'all'`, and `'changed'` rewrites nothing here
  because this spec reads its baseline with `readFile` rather than through a
  Playwright snapshot assertion.

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

`.gitattributes` marks every committed image corpus under `e2e/` `binary`, by path
rather than by a `*.png`-style pattern, so committed pixels can never be rewritten by
line-ending normalisation. Read the file for the current list rather than trusting a
copy of it here — each new corpus needs its own rule, and the file is the only place
that stays right.

## Current status

Nothing fails on the default headless run, and that is stable across repeated full
runs. The numbers move every time a test is added, so the three commands below are
where to read them.

| Suite             | Command                 |
| ----------------- | ----------------------- |
| App unit tests    | `npm run test`          |
| Helper unit tests | `npm run test:e2e:unit` |
| E2E tests         | `npm run test:e2e`      |

The workspace canvas is located by `data-testid="workspace-canvas"`, published on the
primary `<canvas>` in `src/components/Main/Main.tsx`. There is no positional fallback:
a document index put the locator on the Draw preview canvas, or on a hidden overlay
once a tool change unmounted it. `getWorkspaceCanvas` is a single-selector locator
precisely so it can only ever match one element.

### Name every coordinate in document space

An 800x600 document is contained into the canvas element with a uniform scale and a
centred letterbox, so one CSS pixel on the canvas is not one document pixel and the
canvas box has no fixed size. `drawLine` takes **box-relative** offsets, and
`documentToCanvasOffset` / `canvasOffsetToDocument` convert between the two spaces.

Everything a test _asserts_ on has to be named in document space, and any
spec that both places a gesture and reads a pixel back has to convert in the
right direction at each end. Getting it backwards is silent: a sample 200 units
"beyond" a drag that started 131 units into the document lands off the document
entirely, and the checkerboard behind it reads as a plausible value. The failure
is a wrong number, not an error.

Two more consequences of the same geometry, both of which have bitten a spec here:

- **Measure the box per sample, not once per test.** A tool change swaps the
  options bar, the toolbar row changes height, the canvas box moves, and every
  cached coordinate is now pointing somewhere else. `filter-tools.spec.ts` and
  `shape-tools.spec.ts` re-measure inside their sampling helper for this reason.
- **A layer's own bounds are not the document's.** A stroke commits a layer the
  size of the stroke, so an adjustment that spreads, fills or blurs is only
  observable from outside the shape if the layer is bigger than the gesture. Both
  of those specs draw a corner-to-corner stroke first, because that is the only
  cheap way to get a full-document layer (`GradientToolArea` also refuses to run
  on the bedrock layer at all).

2 tests are declared `test.skip`: the Photopea PSD round-trip (needs the external
photopea.com) and one right-click flyout case.

A local run uses `retries: 0`; only `CI` sets `retries: 2`, so a local failure is
never retried away.

## Test commands

```bash
# e2e specs  (headless by default - see "Run it headless" above)
npm run test:e2e                     # locked, own port, own output dir; forwards args after `--`
npm run test:e2e:raw                 # bare `playwright test`, no lock, shared output dir (what CI runs)
npm run test:e2e:headed              # opt in to a visible window; warns first, do not touch it
npm run test:e2e:ui                  # Playwright UI mode
npm run test:e2e:debug               # Playwright inspector
npm run test:e2e:install             # one-time browser install

# helper unit tests
npm run test:e2e:unit
npm run test:e2e:unit:coverage

# output
npm run test:e2e:report              # open the last HTML report (opens a window, and blocks)
npm run test:e2e:clean               # delete generated run output (test-results/, playwright-report/)
npm run test:e2e:update-baselines    # rewrite the visual-regression baselines
```

`test:e2e:headed`, `test:e2e:ui` and `test:e2e:debug` all put a window on your screen,
and `test:e2e:report` does too — it also serves until you close the tab, so an agent
that runs it blocks. They are not interchangeable ways of reading a result: the
`list` reporter on stdout, the screenshot under `test-results/runs/<run-id>/` and
the `test-results/results.json` written in CI are all readable without a window.

### Local vs CI behaviour

`npm run test:e2e` sets **no** `CI=true`. Setting it would flip `forbidOnly` on (a
stray `test.only` becomes a hard error), enable `retries: 2`, switch the reporter
to `github`, and default `workers` to full parallelism. Locally you get
`workers: 1` and a `list`/`html` reporter, which keeps a debug run readable.

The one thing `CI` does change in the wrapper is that it skips the swarm lock and
keeps the default :5173 and the shared `test-results/`, because a CI job owns its
checkout outright. That is also why the `e2e` job in the workflow calls
`npx playwright test` directly rather than going through `npm run test:e2e`.

**Both local and CI runs are headless.** `playwright.config.ts` resolves
`headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1'`, so the only way to get a
window is to ask for one explicitly. `PLAYWRIGHT_ALLOW_HEADED=1` is that switch, and
`test:e2e:headed` is the script wrapping it. `PLAYWRIGHT_HEADLESS` is not read, and
neither is `PLAYWRIGHT_HEADED` — the latter is the name a model reaches for first
when it wants a window, and that must not be sufficient on its own.

To use a browser other than Chrome, set `PLAYWRIGHT_CHANNEL` yourself:

```bash
PLAYWRIGHT_CHANNEL=msedge npm run test:e2e
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
`playwright.config.ts`. It is a **blocking** gate. It was `continue-on-error`, on the
stated grounds that a handful of specs failed for documented reasons; those are all
fixed and the job went on reporting a state the suite no longer had.

Two things are still unmeasured, and neither is a reason to unblock the job — both
concern configurations this job does not run in:

- a headed run, to confirm the CDP fix is green outside the headless configuration
  this host can produce (see `AGENTS.md` — the operator runs it, not an agent);
- whether the visual-regression baselines should be regenerated from a production
  build rather than a dev server, since the job runs against `npm run dev`.

The job reports the true state including the 2 declared skips. It runs the full
suite with no `--grep-invert`, so the report is unfiltered — but note that
`playwright.config.ts` sets `retries: 2` when `CI` is set, so a green run here is a
green run _after_ retries. A flake that only shows on the first attempt is
invisible in this job by design.
