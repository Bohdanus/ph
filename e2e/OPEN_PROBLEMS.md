# Open Problems

Not a changelog. Each entry is an unfixed defect, with the evidence that proves
it. The one section that is not work says so on its own heading. Every citation
names the unit it points at, re-read from the working tree when the entry is
written; where an entry sits against a spec that has since been rewritten, its
references are a record of the past and are labelled as such.

Two sections, because they came from two passes. Everything above
**Transferred findings** was written against this repository. Everything below it
arrived from a review of the pre-migration tree in `/Users/bkalynovskyi/ps-playwright`
and was re-derived against this one before being recorded — see that section's
preamble for what that does and does not license you to conclude.

Gates: `npm run tsc` exits 0, `npm run lint:check` reports no errors, and
`npm run test:e2e:unit` passes. The app's own gates are green too: `npm run tsc`
and `npm run test`.

The numbers this file used to open with — tests passed, expected-fail pins,
files, mode-specific failure sets — were each a snapshot of one tree, and each has
been wrong since it was written while the number beside it stayed silent. A count
that does appear here is a count somebody measured; read the current one off the
command. The latest recorded full headless run, `2026-10-25T16-14-11-312Z-11020`,
ran on this macOS arm64 machine and reported `573 passed, 0 failed, 2 skipped` in
9.1 minutes. This is one machine's observation, not a new baseline.

**A full headed run of the suite as it stands has never been measured, and
`AGENTS.md` forbids an agent from running one.** The headed observations quoted
below are real measurements, but they predate headless becoming the default and
they describe code that has since changed. What a headed run of the suite as it
stands would do is an inference from the shape of the assertions, and it is
labelled as such where it appears.

Many entries below are **pinned** — a unit test asserts the current, incorrect
behavior on purpose. A pin is a tripwire: it passes today and fails the moment the
defect is fixed, so a fix must remove the pin in the same change. Pins are marked
**[pinned]**.

Severity: **P1** = produces a wrong or misleading pass/fail. **P2** = latent
breakage or unmaintainable. **P3** = cosmetic / robustness.

---

## Observed failures

The latest full headless run recorded above had no failures. This is one machine's
observation, not a baseline; run `npm run test:e2e` for the current result. The
open findings below describe independent weaknesses in the suite and remain work
even when a full run passes.

### Invariant — headless is the default, and the refusal is structural

**This is not a work item.** The mitigation is already shipped, and the rest of
this file is the work queue. `playwright.config.ts`'s `use.headless` resolves
`headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1'`, and its `globalSetup`
loads `e2e/global-setup.ts`, whose `refuseVisibleBrowser()` throws on `--headed`,
`--ui` and `--debug` and on any project that resolves to `headless: false`.
The refusal arrives before a browser exists, so the
rule is structural rather than remembered. What follows is the reasoning the default
rests on, kept because whoever removes the guard needs it.

A headed browser puts a live, clickable window on the operator's desktop for the
whole run. Anything the human does to that window — a stray click, a mouse that
drifts across it, a keypress, a focus change, an app switch — reaches the page as
real input, indistinguishable from the suite's own `page.mouse` / `page.keyboard`
calls. It fails the test for a reason that is not in the code, and because the
interference is intermittent it is indistinguishable from a real race. Both causes
then get recorded as "flaky" and neither gets fixed.

**This is a preventive rule, and it is worth being precise about the evidence.** No
operator-input-caused failure has been reproduced in this suite: the one
intermittent failure on record before headless became the default
(`sidebar-keyboard.spec.ts`'s `full keyboard flow: open, navigate, select` test)
turned out to be a real race that fires in headless
runs with no operator input at all; the mechanism is recorded in the leading
comment of `sidebar-keyboard.spec.ts`, above `GROUPED_TILE`. The hazard is
reported as recurring across this project's test work generally, which is why the
default is structural rather than procedural: it removes the failure class instead
of relying on everyone to remember.

**The invariant is layered, not "impossible".** Without the explicit
`PLAYWRIGHT_ALLOW_HEADED=1` opt-in, `refuseVisibleBrowser()` rejects `--headed`,
`--debug`, and any project that resolves to `headless: false` before browser launch.
Playwright UI mode returns before `globalSetup`, so the in-process guard cannot reject
`--ui`; `kilo.jsonc` denies `--ui` and `test:e2e:ui` for agents and prompts before
`--debug` and `test:e2e:debug`. Outside that permission layer, UI mode can open a
window. `npm run test:e2e:headed` is the supported operator opt-in; agents use
`npm run test:e2e`.

## P3 — transparent pixels weighted as fully opaque (low confidence)

`dominantRed()` and `getColorAtPoint()` in `e2e/helpers/canvas-helpers.ts` **[pinned]**

`dominantRed` and `getColorAtPoint` skip only `alpha === 0`, so a nearly
invisible pixel counts at full weight. A weighting concern rather than a
correctness bug, and the only helper that reports the colour back to the caller.
They are the two places the distinction bites hardest, because the other two
`alpha === 0` filters, in `hasDarkPixels()` and `hasRedPixels()`, answer a yes/no
question where one nearly-invisible pixel is the same as one
opaque one. The other half of the file, `getDarkPixelBounds()` and
`getSelectionBounds()`, filters on `a !== 0` instead — a different question
asked with a boolean rather than a weight.

## Known-skip tests

One spec is `test.skip` by declaration:

- `e2e/export/photopea.spec.ts` — its `test.skip('exports to PSD and verifies in Photopea')`
  declaration. Round-trips through the external photopea.com, so it cannot run offline or in
  a sandboxed CI.

## Still unverified

**Not verified:**

- A headed run of the whole suite. It was never measured here, and `AGENTS.md`
  forbids it. The helper now uses Playwright's screenshot API, but its headed behavior
  has not been measured. The operator-input hazard also makes a headed green run weak
  evidence.
- Any operator-input-caused failure. None has ever been reproduced here; the
  headless default is preventive.
- The pixel baselines are verified against a **dev-server** build, because
  `playwright.config.ts` starts `npm run dev`. Nothing establishes that
  `vite build` output renders byte-identically, so a future switch to serving
  `dist/` should be treated as a possible baseline-affecting change.

## P2 — document-space gesture audits must be specific to the oracle

`e2e/helpers/canvas-helpers.ts` — `LINE_START_X`, `LINE_START_Y`, `LINE_END_X`, `LINE_END_Y`

**What exists.** `documentToCanvasOffset` maps a DOCUMENT point into the canvas box by reproducing
the app's contain fit, and the export fixture uses it, so `e2e/export/visual-regression.spec.ts` no
longer depends on where the app put the letterbox. That is the right idea and it works.

**What remains.** The mapping now appears in five suite files, at eighteen call sites:
`e2e/canvas-growth.spec.ts` (4), `e2e/filter-tools.spec.ts` (3), `e2e/shape-tools.spec.ts` (6) and
`e2e/export/helpers.ts` (4), plus `e2e/example.spec.ts` (1), counting the calls and not the imports.
`LINE_START_X`/`LINE_START_Y`/`LINE_END_X`/`LINE_END_Y` in `e2e/helpers/canvas-helpers.ts` are still
"relative to the canvas box",
and twelve specs import them: `adjustments`, `color`, `document-dialogs`,
`erase-fill-eyedropper`, `file-roundtrip`, `history-panel`, `keyboard-shortcuts`,
`layers-panel`, `levels`, `paint-tool-pixels`, `select-move`, `transform`. Beyond those, many
gestures use box-relative offsets; a raw occurrence is not by itself evidence that the test
asserts the wrong logical document point. Counted, with the counting command, because a number
here without one is worse than none:

`e2e/example.spec.ts` is the first simple gesture migrated: it maps seeded document points with
`documentToCanvasOffset` and uses the resulting page clip for both redraw polling and capture.
`drawLine` remains box-relative; classify its call sites by oracle contract before considering any
conversion.

```
rg -o -e "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[0-9]+" e2e --glob '*.ts' --glob '*.tsx' | wc -l # 98 source text matches
rg -o -e "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]*" e2e --glob '*.ts' --glob '*.tsx' | wc -l # 305 source text matches
rg -o -e "[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]* *\*" e2e --glob '*.ts' --glob '*.tsx' | wc -l # 0 source text matches
```

These source-text matches include comments, clip/sample math, measured widget offsets and relative
gestures; they are not counts of executable mouse actions or confirmed defects. The zero fraction
match shows that exact `box.width * fraction` pattern is absent, not that every other expression is
wrong. Use the inventory only to find a test whose oracle asserts a stable document point; classify
each such callsite against the assertion before changing it.

**What remains unproven.** A `box.x + 150` gesture can land on a different document pixel after a
fit/layout change. That is a false pass only when the test's oracle expects a stable document pixel
or region; an assertion intentionally relative to the gesture is valid. The Color Sampler and
fixed-size marquee audits established and fixed two such false passes. The broad text inventory does
not establish additional cases. Any next correction needs an exact test title, its logical target,
and a mutation that demonstrates the current oracle accepts the wrong pixel.

Three panel assertions in `e2e/responsive-shell.spec.ts` used to pin the right panel at 250px.
The tests `reclaims the layers column by default and offers a toggle for it` and
`has no tablet toggle and keeps the layers panel open` already prove visibility and state, so their
numeric width reads have been removed. `gives the canvas the space the collapsed panel freed` now
compares the canvas-width change to the panel's measured width. These changes remove the panel's
three fixed-width pins. The remaining coordinate expressions need oracle-specific review, not a
blanket document-space migration.

**Two more were in this list and are gone.** The entry used to name five. The other two were the
rail's own width — the collapsed rail at 56 and the two-column rail at 108 — and they are
resolved, by `feat/toolbar-overflow-collapse`. That change made one column the default and had the
rail fit its tiles to the space it has, which is exactly the kind of change this entry warns about,
and both assertions had to go rather than be re-pointed at the new numbers. What replaced them is
the pattern the rest of this entry asks for: the tablet band's rail is now asserted by the
`<ul>` count the layout renders, by `uses the one-column tool rail and hides the layout toggle` in
`e2e/responsive-shell.spec.ts`, and the two-column rail
by a width RELATION the test measures against itself — one column against two, both measured in the
same test, `keeps the layout toggle and can reach the two-column rail` in the same spec — so
neither pins a pixel. The panel-width pins have likewise been removed or made relational; unclassified
coordinate expressions remain only as search candidates until an oracle-specific issue is proven.

**The pattern to copy is already in the tree.** `measureAtViewport()` in
`e2e/viewport-drawing.spec.ts` gestures at
`box.x + box.width * 0.25` and `box.y + box.height * 0.35` — fractions of the box that preserve a
relative action. Use that form when the test is intentionally relative; use `documentToCanvasOffset`
when the oracle names a logical document coordinate.

**Do not fix this by re-recording anything.** A re-record would bless the new layout, which is
exactly the failure this campaign already made once: the seven export baselines were re-derived from
a moving letterbox before `e8f17ba` specified the line in document space.

## P2 — the AVIF export waits on a wasm encoder inside a 30s download timeout, and only AVIF exceeds it

**The two export failures in one run are the same wait, and the format is the discriminator.**
Run `2026-09-29T22-33-27-196Z-21344` — on `feat/history-remove-append`, a branch whose whole diff
is history/durable-document code with no export surface in it — reported
`334 passed, 3 failed, 3 skipped`, and its two export failures are the same error twice:

- `e2e/export/raster-formats.spec.ts` — the "exports to AVIF (.avif) with pixel verification" case
- `e2e/export/visual-regression.spec.ts` — the "exports to AVIF (.avif) matches visual baseline" case

both `TimeoutError: page.waitForEvent: Timeout 30000ms exceeded while waiting for event
"download"` at the `page.waitForEvent('download')` inside `submitSaveDialogForDownload()`
(`e2e/export/helpers.ts`). **In the same run, in the same two specs, bmp, gif,
jpeg, webp, png, ebp and svg all passed.** The save dialog, the download plumbing and the export
path are therefore not what fails; AVIF is.

The full headless run `2026-10-07T17-21-09-904Z-84103` exposed a different AVIF
failure mode: both export tests failed after the wasm request returned HTTP 403.
The raster export logged a failed wasm fetch, and the visual export did not reach a
valid baseline comparison. Treat the asset response as a separate problem from the
older encode-timeout observation.

**What the 30s is actually timing.** `submitSaveDialogForDownload()` (`e2e/export/helpers.ts`)
waits its `DOWNLOAD_TIMEOUT_MS` for a download event that can only fire once the encoder has
returned a Blob, and `encodeAvif()` (`src/contexts/avif-utils.ts`) awaits `@jsquash/avif`'s
`encode` — which first has to load the `avif_enc-*.wasm` asset the build emits, next to a small
worker shim. So this is an AVIF-encode budget wearing a download's name, and a machine running
other agents' work can spend it before the first pixel is encoded.

**Attributed: the pair does not reproduce on `main`, so the run's machine is the open
question.** Both specs pass there, and quickly — `e2e/export/raster-formats.spec.ts` in
1.4s (run `2026-09-29T22-43-08-281Z-31375`) and all 13 of `visual-regression.spec.ts` in
1.4s (run `2026-09-29T22-43-50-038Z-45877`). Neither is a near-miss on the 30s: on `main`
these two encode in about a second, so the timeout was not approached at all. Since the
branch that failed carries no export surface, load is the remaining explanation, and it is
still an explanation rather than a measurement.

The old timeout observation does not explain the newer 403. First identify why
the wasm asset request is forbidden on the failing tree and confirm the served asset
path; only after the request succeeds can a repeat timeout be attributed to encode
cost or machine load.

**Fix, in order.**

1. **Inspect the failed wasm request on the failing tree.** Record its URL and
   establish why the dev server returns 403 before treating either export as a
   timing failure.
2. **After the request succeeds, rerun the same two export specs.** A repeat
   timeout with the asset available would distinguish encode cost from the
   historical request failure.
3. **If it is contention, the fix is off the main thread, not a longer wait.**
   `encodeAvif` holds the save open across a wasm module load and a full-canvas encode;
   that is what consumed the budget.
4. **Do not raise `DOWNLOAD_TIMEOUT_MS` to get this green.** The same rule as a widened
   pixel budget applies to a widened wait: it hides the cost, and it would equally mask a
   real hang in a format that is not slow at all.

# Transferred findings — external review of the pre-migration tree

This section recorded 33 findings from a read-only review of the pre-migration tree at
`/Users/bkalynovskyi/ps-playwright`, each one re-derived against this tree before it was
written down. **Thirty-one are fixed and their entries deleted**, which is the only thing
worth reading here: if you are looking for one of them, it is gone, and the code is the
record of what it was. The commit that carried them in is `4d47904`; the one that fixed
them is `bfce8f3`, and it is on `main`. Two were not fully closable and are re-recorded
below.

**Four `## P…` entries appear below this line, and only two of them are those two** —
`P2 — Chrome stable remains unpinned and can drift from the visual baselines` and
`P3 — no dedicated mobile/HiDPI project; touch coverage and the full 2x suite remain partial`.
The other two,
`P3 — re-verification: the tablet band's option-row floor…` and
`P2 — the mobile bottom bar scrolls 615px with no affordance…`, were filed by later passes
against this tree and are not among the 33. They are here rather than above the section
because they were raised while auditing the fixes, and moving them would break the audit
trail for no gain — but a reader counting the entries to work out which findings survived will
count four, and the two-line arithmetic above is the one to trust.

The source repository is frozen at `78be956` and its own ledger is not maintained, so that
review has no other home. The list of what it claimed and what turned out to be already
fixed here is at the end of this section, under **Checked here and rejected** — that part is
still worth having.

---

## P2 — Chrome stable remains unpinned and can drift from the visual baselines

`e2e/export/visual-regression.spec.ts`, `.github/workflows/ci.yml`

`compareScreenshots` is called with `threshold: 0.01` and `maxDiffPixels: 100` over an
800x600 baseline — 100 pixels is 0.021%, and four of the seven compared formats are lossy
(JPEG, WebP, GIF, AVIF). `channel: 'chrome'` selects branded Google Chrome Stable rather
than Playwright's bundled Chromium. CI invokes `npx playwright install chrome` (with
`--with-deps` on Linux); neither the project configuration nor those install commands
specify an exact Chrome revision. See Playwright's
[Chrome and Edge channel guidance](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).
The resolved stable version can therefore differ across OS runners and drift from the
visual baselines.

The tolerance question has been answered: the 100-pixel budget is a **tripwire, not a
tolerance**, and the argument is written out at the call site so it is not widened later to
make a red go green. `browser.version()` is now in the failure message, so a red run can
answer "did the encoder change?" instead of leaving it to be guessed.

Manual `workflow_dispatch` run `40134364993` on
`task/linux-snapshot-ci-20261024` recorded and verified Chrome `156.0.8078.47` on Linux
and `156.0.8078.48` on Windows and macOS. The Linux images in
`export-baselines/linux/` match its artifact byte-for-byte. An earlier Chrome
`155.0.8059.39` run exceeded the strict 100-pixel budget on six formats. This records
provenance, not a pin: CI installs each OS's current stable Chrome, which can drift.
Choosing a per-platform version policy remains open; do not widen the pixel budget to
mask drift.

## P3 — no dedicated mobile/HiDPI project; touch coverage and the full 2x suite remain partial

`playwright.config.ts` declares one project, with no project-level mobile emulation or touch
profile. Some specs do opt into touch per test: `layers.spec.ts` covers tablet layer reorder,
`text-edit.spec.ts` uses touchscreen taps for tablet re-entry, and `canvas-growth.spec.ts` runs a
tablet touch case. The original phone-width flow in `mobile-shell.spec.ts` drives its bar with the
mouse; a separate tablet-scoped case now checks horizontal touch reachability at 744×1133.
Separately, `check-dpr.spec.ts`
has test-scoped coverage at device scale factors 1 and 2, but the full suite is not 2x-clean as
described below.

This was raised against the review with a precondition attached: enabling a 2x project
before `getStrokeAnalysis` was DPI-relative "trades a coverage gain for three new failure
modes". **That precondition is now met for the stroke classifier** — its thresholds are
CSS-pixel counts, the captured region is a required argument, and no call site can be
DPI-blind. Two point-sampling specs that were in exactly that class (`levels.spec.ts`,
`adjustments.spec.ts`) were CSS-pixel samples over a device-scaled capture, and are fixed
here.

**The suite as a whole is still not 2x-clean, and an earlier version of this entry
claimed it was.** A prior run with `projects[].use.deviceScaleFactor` forced to 2 (the
project-level `use` overrides the top-level one, so setting it at the top does nothing)
measured 256 pass, 6 fail, 2 skipped. Its reported failures were

- `e2e/helpers/cdp-helpers.spec.ts` — the
  `describe('captureCanvasScreenshot at an emulated deviceScaleFactor of 2')` block, which
  exercises capture behavior under an emulated 2x device scale factor.
- `e2e/erase-fill-eyedropper.spec.ts` — `the eyedropper sample size averages the clicked block`;
  an eyedropper block average over a fixed-size sample, in image pixels.
- `e2e/keyboard-shortcuts.spec.ts` and `e2e/responsive-shell.spec.ts` — one test each, which this
  entry does not name.

The reported `color-helpers.spec.ts` failure was not reproduced in a focused run. That spec now
sets `deviceScaleFactor: 2` and the swatch test asserts that `window.devicePixelRatio` is actually 2;
`npm run test:e2e:verbose -- e2e/helpers/color-helpers.spec.ts` passed all seven tests in run
`2026-11-02T08-51-16-969Z-95889` against code commit
`6a1cbe6cf9a1f6e6fccc94eb9f8a148cef0b73e7`. This focused result removes that test from the
unresolved list; it does not revalidate the other failures or the old whole-suite totals.

The full suite has not been remeasured at 2x since that run, so the current failure count is
unknown. Some test-scoped touch/mobile cases exist, but there is no dedicated project and coverage
remains sparse across controls and gestures. Adding a project multiplies every run's cost and is a
coverage decision, not a one-line change to `playwright.config.ts`.

`e2e/check-dpr.spec.ts` also asserts that the four presentation canvases' backing-store
width and height equal the document dimensions multiplied by the expected device scale
factor, at both 1x and 2x. Its `toleranceFor` assertion checks that a drawn line lands near
the cursor using `imageBoundsToCss`, which is scale-agnostic by construction;
the backing-store assertions, not the screenshot mapping, detect a mismatch at those two
tested scale factors. The two export checks that read the store — `the export is independent
of the shell layout` in
`e2e/export/visual-regression.spec.ts`, and `setupExportTest()`'s backing-store read in
`e2e/export/helpers.ts` — assert it is the DOCUMENT size, which is the correct invariant for
export and says nothing about presentation. Broader high-DPI coverage remains open: these
checks do not make the full suite 2x-clean, nor do they exercise mobile/touch input. The
app side, and the app work that has to land first, is in
`CANVAS-RESOLUTION-PLAN.md`. The display/export decoupling that used to gate raising the display
resolution is done: export renders its own surface from `(layers, size, documentFrame)` in
`src/contexts/export-canvas.ts` and no longer reads the visible canvas.

## P3 — re-verification: the tablet band's option-row floor is no longer the panel's measured width

`e2e/responsive-shell.spec.ts` — `MIN_PANEL_WIDTH`, the shared floor both panel tests compare against

**The 4 px shortfall this entry used to record is no longer asserted by the suite, and
the derivation the old entry named as "the next step" has since been done.** The two
"makes the … option panel horizontally scrollable rather than unreachable" tests no
longer pin each panel to its own measured width. They share one derived floor:

```
const MIN_PANEL_WIDTH = TABLET.width + 100;   // the shared floor — 1000 at the 900px tablet band
…
expect(metrics.overflowX, 'the tablet band must scroll the option row').toBe('auto');
expect(
  metrics.scrollWidth,
  'the option row must be wider than the window, with room to spare'
).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);   // the assertion every panel is measured against
```

The per-panel floors this replaced were 1089 (Shape) and 1036 (Horizontal Type), and
both panels landed 4 px short of them deterministically — 2/2 in isolation, not only in
a full run, so it was never the `vmThreads` pool flake the two suites under
`scripts/__tests__/` usually are. The reasoning is now written out beside `MIN_PANEL_WIDTH` in
`e2e/responsive-shell.spec.ts`: two floors moving by the same 4 px together is
a shared-chrome signal rather than a lost control, because a lost control takes a whole
widget with it. The panels are measured there at 1085 and 1032 against a 900px window,
both clearing the 1000px floor.

**The two tests pass on this host** (`npx playwright test e2e/responsive-shell.spec.ts`,
21 passed), so the assertion is no longer red. That is NOT the same as the defect being
fixed, and the reason matters: the required width was LOWERED, not the row widened. The
panels still measure 1085 and 1032; what changed is the number they are compared against.
So the 4 px the original entry recorded is still missing, and whether it was missing in a
way a user can see is the open question — a derived floor that the current layout happens
to clear will keep clearing it until the layout changes again, and then the test fails for
a reason nobody will read as "the row got narrower".

Nothing else it raised is in question: the row still has to overflow its own box
(`expect(metrics.scrollWidth, 'the row must overflow its own box')`) and still has to scroll to its
end (`expect(scrolled.scrollLeft, 'the row must scroll to its end')`), and both are asserted. The
decision between "widen the row" and "the floor was derived correctly all along" needs someone who
can say which, so this entry stays open rather than being deleted on a green run.

---

## Checked here and rejected

Recorded so the same ground is not re-audited. Each was re-derived against this tree
and **is not a defect here**:

- **A `layers.spec.ts` assertion reads text the app does not contain.** It does
  contain it. `REORDER_ACTION` in `src/util/constants.ts` is `'reorder layers'`,
  rendered through a `capitalize` class, and Playwright's string text matching is
  case-insensitive. A case-sensitive `grep` for the capitalised form is what produced
  the false report.
- **The workspace-canvas helper resolves a union and detonates the suite when the
  testid lands.** `getWorkspaceCanvas()` in `e2e/helpers/canvas-helpers.ts` is testid-only, no
  `.or()`, and `resolveFakeMatches` returns the whole match list so the fake can model a union.
  All three parts landed together.
- **CI-parallelism has no per-test isolation against a shared app.** Playwright's
  default `page`/`context` fixtures give every test a fresh browser context; the app's
  state is client-side, and there is no `storageState`, no `beforeAll` and no
  `newContext` anywhere under `e2e/`. The config caps workers at 1 locally for
  readability, and `webServer` is a stateless Vite dev server shared by every worker.
- **52 timeout literals / 10 unused imports / 8 red CDP assertions / 10 orphaned
  baselines.** The first two are fixed (`noUnusedLocals` and `noUnusedParameters` are
  on, the count is 0); the CDP assertions now derive their scale; the orphans are
  recorded in the P3 entry above.
- **Four review findings about `getStrokeAnalysis` and the Photopea oracle, left
  unaddressed when the orchestrator session died.** All four were re-derived against
  this tree; one was real and is fixed, and three were not defects here:
  - _The capture scale is read off the width axis and spent on a row measurement._ Real,
    and fixed — but **not reachable from any current call site**, so the fix is a rule
    rather than a repair. `canvas-helpers.ts` scales `verticalSpread` (rows) by the row
    scale and the column gap by the column scale. What a later reader must not do is
    re-file this as a live bug: it is pinned by two tests whose capture is DELIBERATELY
    exaggerated, because a real fractional clip diverges by ~2% and that cannot cross a
    threshold against a one-or-two-pixel measurement. The exaggeration is stated at the
    test, and the per-call-site arithmetic is in the `CaptureRegion` JSDoc.
  - _`captureScale` never validates `imageWidth`, so scale 0 is reachable._ Not
    reachable, and the stated mechanism was wrong. The defence is `bottom < 0`, not the
    length of `data` — with `width === 0` the coordinate arithmetic yields `NaN`, a
    `NaN` never compares less than the initial `top`, and the function reports "nothing
    here" before any threshold is consulted. The pre-existing zero-sized test passes an
    EMPTY buffer, so it could not tell the two defences apart; a test carrying real ink
    now does.
  - _A rejection inside a `waitForCanvasPixels` poll aborts the poll instead of
    retrying._ True in mechanism, unreachable at the only poll call site —
    `pen-types.spec.ts` builds its clip's width and height from module constants. The
    JSDoc now states which of `null` and a rejection is which.
  - _The Photopea oracle's JSDoc claimed neither check is reachable without the file
    opening._ The comment was wrong, not the code, and it is corrected in place:
    `getByText` matches regardless of visibility and `not.toHaveCount(0)` is a count,
    so a HIDDEN recent-files row satisfies the name check exactly as a visible one
    would. The canvas-backing-store check is the load-bearing one. Both share the blind
    spot, and the spec is `test.skip`ped, so neither is a proof.

  What makes this worth recording rather than deleting: **four of five defects found in
  that review were defects in the CLAIMS, and a green suite could not tell.** The code was
  correct and every gate was passing in every one of them. A test suite that only fails
  on behaviour will not find this class, and a comment that over-credits what an
  assertion proves is invisible to `tsc`, to `eslint` and to a passing run.
