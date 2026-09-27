# Open Problems

Not a changelog. Each entry is an unfixed defect, with the evidence that proves
it. Every line number was re-read from the working tree after the suite was
moved into this repository.

Gates: `npm run test:e2e:unit` 694 passed / 2 expected-fail (10 files),
`npm run tsc` clean, `npm run lint:check` clean (0 errors, 19 pre-existing
warnings), 97 e2e tests collected — on the default headless run: **97 pass, 0 fail,
2 skipped**, reproduced across repeated full runs. The suite is green in its default
configuration. Headed was not re-measured; it was 5 failing before the CDP fix below
and that fix is deliberately mode-independent, so the headed set is expected to be
empty too, but that is a prediction rather than a measurement.

The app's own gates are green: `npm run tsc` exits 0 and `npm run test` reports
176/176 files passing (3881 pass, 42 expected-fail).

Many entries below are **pinned** — a unit test asserts the current, incorrect
behavior on purpose. A pin is a tripwire: it passes today and fails the moment the
defect is fixed, so a fix must remove the pin in the same change. Pins are marked
**[pinned]**.

Severity: **P1** = produces a wrong or misleading pass/fail. **P2** = latent
breakage or unmaintainable. **P3** = cosmetic / robustness.

---

## Observed failures

**Run the suite headless** — `npm run test:e2e`. That is the default, and the
reason is the first entry below.

On the default (headless) configuration **nothing fails**: 97 pass, 2 are skipped by
declaration, and that is stable across repeated full runs.

Three defect groups used to fail here and have been fixed in this repository. Their
evidence is kept below rather than deleted, because each explains a shape the suite
must not drift back into:

| was failing                           | was                                     | now                                            |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `e2e/helpers/cdp-helpers.spec.ts`     | 2 headless, 5 headed, disjoint per mode | scale-agnostic contract; mode-independent      |
| `e2e/sidebar-keyboard.spec.ts:77, 89` | 0–2, ~42% of headless runs              | root-caused to an rAF focus race, then awaited |
| `e2e/levels.spec.ts:64, 109`          | 2, both modes                           | canvas found by test id, not document order    |

All of these were introduced with the specs and were independent of how they were
moved into this repository: each was reproducible with no changes to the specs or
to `src/`. The remaining entries below are latent defects that no current run
trips — none of them is a known failure.

### P1 — a headed run lets the operator's own input fail the suite

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
(`sidebar-keyboard.spec.ts:89`) turned out to be a real race that fires in headless
runs with no operator input at all — see the P2 below. The hazard is reported as
recurring across this project's test work generally, which is why the default is
structural rather than procedural: it removes the failure class instead of relying
on everyone to remember.

Headless is also simply better for this suite, and that part is measured. The
failure sets are disjoint per mode and deterministic across repeats:

| specs                                                                                         | headed | headless |
| --------------------------------------------------------------------------------------------- | ------ | -------- |
| CDP, deriving expected size from `getDevicePixelRatio()` (`:113` `:129` `:146` `:163` `:195`) | 5 fail | pass     |
| CDP, explicit `deviceScaleFactor: 2` block (`:220` `:239`)                                    | pass   | 2 fail   |

So headless removes 5 failures and adds 2. The net is better, and the remaining two
are a known defect with a known fix direction (below), not a mystery.

**Headed runs are for looking at, not for gating on.** If you must run headed, a
headless result is what CI will produce, so the 5 CDP failures listed above are
_expected_ in a headed run and are not a regression. `test:e2e:headed` prints that
warning on every invocation, so the tradeoff is visible at the moment it is
accepted.

**The invariant is "the default", not "impossible".** `npx playwright test --headed`,
`npm run test:e2e:ui` and `npm run test:e2e:debug` all bypass `use.headless` and open
a real window, because that is what they are for. The rule applies to
`npm run test:e2e` and to anyone interpreting its result.

### Fixed — CDP capture size did not match `window.devicePixelRatio` (was P1)

`e2e/helpers/cdp-helpers.spec.ts:113, 129, 146, 163, 195` (headed) and
`:220, 239` (headless)

The specs derive the expected capture size from the page's own
`window.devicePixelRatio`:

```ts
const IMAGE_PIXELS_PER_CSS_PIXEL = await getDevicePixelRatio(page);
expect(imageData.width).toBe(box.width * IMAGE_PIXELS_PER_CSS_PIXEL);
```

That assumes a CDP `Page.captureScreenshot` honours the _emulated_ DPR. It does
not. Measured on a retina host against a 240x160 CSS canvas, headed, with
`devices['Desktop Chrome']` (`deviceScaleFactor: 1`) in effect:

```
dpr=1  actual=480x320  css=240x160  ratio=2
```

The emulated ratio says 1, the capture is 2x, and the five assertions above are off
by exactly the host's backing scale. The helper's own comment
(`e2e/helpers/cdp-helpers.ts:35-40`) asserts the opposite, that the result is
`clip_size x clip.scale x deviceScaleFactor`.

**The multiplier is not a function of the emulated ratio.** Forcing the emulation to
match the host does not fix the specs; it changes which ones fail. Sweeping the
project-level `deviceScaleFactor` over 1, 2 and 3 on this host gave the same capture
width (480 for a 240px clip) in all three cases, while a run with the emulation
pinned to 2 turned 5 failures into 8 — the three specs in the
`deviceScaleFactor: 2` block, which pass at the default configuration, started
failing too.

**What is deterministic is the mode**, and the two modes fail on disjoint subsets:

| specs                                                     | headed | headless |
| --------------------------------------------------------- | ------ | -------- |
| `:113` `:129` `:146` `:163` `:195` (derive from live DPR) | 5 fail | pass     |
| `:220` `:239` (explicit `deviceScaleFactor: 2`)           | pass   | 2 fail   |

Each column was reproduced identically across repeats, so this is a stable property
of the mode, not flakiness. Headless is the better default and still leaves 2
failures: with no emulated override the capture matches `devicePixelRatio` (so the
five pass), but the block that _forces_ `deviceScaleFactor: 2` and then expects 2x
does not get it.

Fix direction: assert against the decoded image's own dimensions instead of
`window.devicePixelRatio`, which makes the specs independent of host scale and of
mode entirely. `screenshotBoundsToCss` and `screenshot-scale.ts` already derive
scale from the decoded dimensions, so this also makes the specs consistent with the
rest of the suite. The helper's comment at `cdp-helpers.ts:35-40` needs correcting
either way.

**How it was fixed.** The contract `imageWidth === rect.width * devicePixelRatio` was
deleted rather than re-derived, because the quantity it names is not a property of
this code — it is Chrome's surface scale, which is mode- and host-dependent. Asserting
it is what kept the suite red in exactly the modes it was written to protect.

Replacing it with "the scale is whatever the decoded image says" would have been
tautological, so the replacement asserts the three things that are true everywhere
and that consumers depend on: the capture is exactly the requested rect, at one
integral scale shared by both axes, with the correct pixels (`expectFaithfulCaptureOf`,
plus the existing colour assertions, which carry the spatial guarantee because the
fixture is red on blue). A fourth property - that the helper adds no rescaling of its
own - is pinned against a reference rather than a constant, by comparing the capture
to `page.screenshot({ scale: 'device' })` on the same clip. That is what a
self-referential size check cannot see: a uniform 2x rescale survived every other
assertion until that test was added.

Verified by mutation, not by the green bar:

| mutation                                        | caught by                           |
| ----------------------------------------------- | ----------------------------------- |
| helper ignores the clip, captures the viewport  | 8 of 13 tests (colour assertions)   |
| width captured at a different scale than height | 8 of 13 tests (`scaleY === scaleX`) |
| uniform `clip.scale: 2`                         | the Playwright-reference test alone |

The helper's comment was corrected in the same change; it now says the capture is
native device pixels and that the scale must not be assumed.

## Fixed since the suite moved into this repository

- **The workspace canvas was resolved by document index** (was P1; it broke
  `levels.spec.ts:64, 109` in both browser modes). `data-testid="workspace-canvas"`
  is now published on the primary `<canvas>` in `src/components/Main/Main.tsx`, and
  `getWorkspaceCanvas` is that single selector. Both specs pass, measured headless.
  There is deliberately no positional fallback: a document index lands on the Draw
  toolbar's 96x48 preview canvas, or on a `display: none` overlay once selecting
  Levels unmounts it, which is what made `boundingBox()` null. The helper's comment
  carries that reasoning.
- **`.or()` is a union, not a priority** (was P1). Publishing the test id alone did
  not fix the specs - `.or()` returns every element matched by _either_ side, so
  `getByTestId(...).or(locator('canvas').nth(1))` resolved to 2 elements and every
  `boundingBox()` raised a strict-mode violation. A single-selector locator matches
  at most one element, which is why the test id and the helper could ship as one
  change.
- **The locator test double collapsed the union** (was P2). `resolveFakeLocator` took
  `?.[0]`, so a correctly built union read as a clean single-element hit and the
  intended-priority pins passed against semantics Playwright does not provide - which
  is how the defect above survived a 694-test suite. It is replaced by
  `resolveFakeMatches`, which returns the whole match list; the five pins were
  rewritten to the real contract and a sixth pins `.or()` as a union.

`data-testid="reposition-hint-text"` was published on the Move hint in the same change,
replacing two `getByText('Drag or resize on canvas')` lookups in `select-move.spec.ts`.

- **The visual-regression comparison never ran** (was P1, and it made the committed
  baselines disposable). `e2e/export/visual-regression.spec.ts` gated the
  record-vs-compare branch on `if (testInfo.config.updateSnapshots)`, but that option
  is a string union `'all' | 'changed' | 'missing' | 'none'` whose **default is
  `'missing'`** (`playwright/lib/common/index.js`, `takeFirst(..., "missing")`), and
  `'missing'` is truthy. `playwright.config.ts` never overrides it, so on every run the
  branch was taken: `writeFile` overwrote the committed baseline and the test returned
  three lines before `readFile(baselineFilePath)`, `compareScreenshots` and the
  `expect`. All 7 comparison formats were a no-op that reported success.

  The failure was invisible in `git status` because re-encoding the same export
  produced byte-identical files. It was not visible in any test either: the 8 specs
  passed, and `OPEN_PROBLEMS.md` recorded that as evidence the baselines matched.

  Fixed to `if (testInfo.config.updateSnapshots === 'all')`, so only an explicit
  `--update-snapshots` may re-record. Verified by mutation, not by the green bar:
  corrupting a baseline now fails the spec (sharp decode error), and substituting a
  valid-but-different PNG fails it with
  `Visual mismatch for PNG: 480000 diff pixels (ratio: 1.0000)` - every pixel of
  800x600. Under the old check both mutations were silently overwritten. The
  baselines were confirmed untouched by a post-fix run (identical mtimes, `git status`
  clean), which is the direct evidence that the compare path is now the one running.

---

## Fixed before this suite was moved into the application repository

Recorded so the same ground is not re-audited. Each was verified by mutation
testing, not inspection.

- `waitForFunction(fn, { timeout })` passed options in Playwright's `arg`
  position, so the intended 60 s / 10 s budgets never applied
  (`e2e/export/helpers.ts`). Fixed, and the mock signature was corrected so
  the test file can no longer express the buggy call shape.
- `visual-regression.spec.ts` read baselines from a per-run, gitignored path
  while the committed baselines live in the snapshot dir — every one of the 7
  comparison formats failed on a clean checkout. Fixed to
  `testInfo.snapshotDir` (deliberately **not** `snapshotPath`, which appends
  the project name and the OS and would make a baseline committed on one
  machine read as missing on another).
- `cdp-helpers.spec.ts` asserted a 120x80 CSS clip decodes to 120x80 at
  `deviceScaleFactor: 2`. Chromium returns `clip x clip.scale x deviceScaleFactor`,
  so all 3 tests in that block would have failed. Now scale-derived.
- `levels.spec.ts` contrast test was empirically red (3 of 4 recorded attempts,
  all-white capture). The redraw wait had been added to the first read but not
  the second, and the bounding box was captured before opening the flyout, so
  the clip could miss the stroke entirely. Both reads now poll after a fresh box.
- `resolveToolName` indexed a plain object literal, so `constructor`,
  `toString`, `__proto__` and friends resolved to inherited functions and threw
  `TypeError: name.toLowerCase is not a function` — defeating the actionable
  error message that had just been added. Both maps are now null-prototype
  (`e2e/helpers/toolbar-helpers.ts:13`).
- `npm test` set `CI=true`, which silently flipped `forbidOnly`, `retries: 2`,
  headless mode and the reporter on a developer's machine.
- `reuseExistingServer` defaulted to `true` in CI, so CI reused whatever was
  listening on :5173 and the webServer gate never ran.
- Two `page.evaluate` pixel-comparison closures were never invoked by any test;
  mutation testing showed both could `return true` unconditionally with the
  suite still green. Now executed against a stubbed canvas.
- Threshold constants were pinned only against the symbols the source itself
  used, so `50_000 -> 500_000` passed. Now pinned to literals.
- `verifyHoverDoesNotOpenFlyout` could not fail: the fake's `hover` invoked no
  handler, so the flyout was closed for any implementation. The fake is now
  wired, and a positive control proves the threshold is real.
- `waitForCanvasRedraw` — a 28-line poll loop with 4 direct call sites across 3 spec
  files (`e2e/example.spec.ts:26`, `e2e/viewport-drawing.spec.ts:33`,
  `e2e/select-move.spec.ts:39` and `:74`) plus 2 indirect ones in
  `e2e/export/helpers.ts:110` and `:232`, had zero unit coverage. Now 32 tests,
  and it delegates to a single shared implementation.

---

## P2 — `expectCanvasToMatch` ignores its own defaults (currently unreachable)

`e2e/helpers/image-comparison.ts:111` **[pinned by 2 `it.fails`]**

The `??` defaults are computed and then unconditionally overwritten by a
trailing `...options` spread. A caller spreading a partial options object with
an explicit `undefined` key silently reverts to **Playwright's** defaults.

`maxDiffPixels` is the damaging one: Playwright's default is `0`, so a caller
passing `maxDiffPixels: undefined` gets a **zero** pixel budget instead of the
intended `100` — false visual-regression failures, with a cause invisible at
the call site because `?? 100` looks correct.

**Downgraded from P1 to P2 because the function has no call sites.** A
repo-wide search finds `expectCanvasToMatch` only in its own unit test, so the
failure mode above cannot occur today. It is a live landmine rather than a live
bug: the first spec that calls it with a spread options object gets a zero pixel
budget and a misleading failure. Either fix the defaults or delete the function —
the exported `compareScreenshots` is what `visual-regression.spec.ts` actually
uses, and it does not have this defect.

The two `it.fails` tripwires (`image-comparison.unit.test.ts:838, 844`) will
start failing the moment the defaults are fixed. That is intentional; remove them
in the same change.

Fix if kept: spread first, default second, and read the defaults from
`DEFAULT_THRESHOLD`.

## P1 — unescaped tool name in a RegExp selector

`e2e/helpers/toolbar-helpers.ts:67`

`new RegExp(name.replace(/&/g, 'and'), 'i')` builds a pattern from an
unescaped name. Verified against the real function: `'Brush (B)'`,
`'Levels[beta]'` and `'C:\Tool'` each produce a regex that does **not** match
their own literal accessible name, so the button is silently not found and the
error below it names a name that was never searched. `'a|b'` matches the wrong
button.

Latent today — no call site passes a name containing `()[]+|?*^\$`. Fix:
`new RegExp(escapeRegExp(name.replace(/&/g, 'and')), 'i')`. Needs sign-off
because it changes selector behaviour.

## P2 — `hexToRgb` rejects valid CSS-4 hex

`e2e/helpers/color-helpers.ts:12` **[pinned]**

The 3-character expansion runs before the length guard, so 4-digit `#rgba` and
8-digit `#rrggbbaa` fall into the error branch:

```
hexToRgb('#ff0000ff') -> expected 3 or 6 hex digits, got "ff0000ff"
hexToRgb('#f00a')     -> expected 3 or 6 hex digits, got "f00a"
```

Both are valid CSS and should yield `{r:255,g:0,b:0}`. Consequence:
`setForegroundColor(page, '#ff0000ff', true)` rejects a colour the application
itself accepts.

## P2 — `setForegroundColor` can succeed without setting the colour

`e2e/helpers/color-helpers.ts:24-27` **[pinned]**

Two independent ways to get a green result with nothing changed:

1. No validation before the DOM is touched. `hexToRgb` is only called when
   `verifySwatch` is true, so `setForegroundColor(page, 'red')` writes `red`
   into a `<input type="color">` and resolves successfully.
2. `if (input) {` (`:26`) makes a missing or renamed testid a silent no-op.

Combined, a test that sets a colour can pass having changed nothing. The specs
that set a colour now pass `verifySwatch: true`, which closes the loop from
the call side, but the helper itself is still permissive.

## P2 — selection thresholds are hardcoded, not in the constants table

`e2e/helpers/canvas-helpers.ts:430-432` **[pinned]**

```ts
const redMax = colorThresholds?.redMax ?? 80;
const greenMin = colorThresholds?.greenMin ?? 80;
const blueMin = colorThresholds?.blueMin ?? 180;
```

Every other threshold lives in `STROKE_ANALYSIS`. These three cannot be
derived or overridden through the constants object, which is the drift risk the
constants table exists to prevent.

## P2 — duplicated default threshold literals

`e2e/helpers/image-comparison.ts:22` vs `:111` **[pinned]**

`compareScreenshots` uses the exported `DEFAULT_THRESHOLD`; `expectCanvasToMatch`
re-inlines `0.2`, `100`, `0.01`. Currently equal, so latent rather than
observable. A test fails if the two drift apart.

## P2 — swatch verification compares an exact CSS string

`e2e/helpers/color-helpers.ts` **[pinned]**

The check compares the computed value against a literal
`` `rgb(${r}, ${g}, ${b})` ``. Any legitimately non-opaque computed value —
`opacity`, `color(srgb ...)`, a gradient or animation in flight — fails even
though the colour is correct. Not reproduced; flagged as fragility.

## P2 — a negative sample radius reports "no colour here"

`e2e/helpers/canvas-helpers.ts:467` **[pinned]**

`for (let y = pointY - radius; y <= pointY + radius; y++)` never executes when
`radius < 0`, so `getColorAtPoint` returns `null` — meaning "nothing at this
point" — instead of sampling the centre pixel or rejecting the argument. A
misconfigured constant reads as a legitimate miss.

## P2 — an unsound source-side cast

`e2e/helpers/color-helpers.ts:25`

`document.querySelector(...) as HTMLInputElement` asserts an element type
`querySelector` cannot guarantee. A non-`input` element published under that
testid reaches `descriptor.set.call(input, color)` and throws an opaque
`TypeError: Illegal invocation`. This is the mirror image of the
`as unknown as` casts removed from the test files.

## P2 — the per-call dynamic import makes the fs surface unspyable

`e2e/helpers/canvas-helpers.ts:193`, `e2e/helpers/cdp-helpers.ts:32`

`takeLineScreenshot` does `await import('node:fs/promises')` inside the hot
helper. Because that is an ESM namespace binding rather than the spied CJS
export, a `vi.spyOn(fs, 'mkdir')` records zero calls even when `mkdir`
definitely ran — so mkdir/attach ordering cannot be asserted. A top-level import
fixes both the per-call cost and the untestability.

## P3 — a missing output directory surfaces as a raw `TypeError`

`e2e/helpers/canvas-helpers.ts:192` **[pinned, message-matched]**

`path.join(testInfo.outputDir, ...)` runs before the `fs.mkdir` and has no
guard, so a `TestInfo` without an `outputDir` fails with
`The "path" argument must be of type string. Received undefined` — no
screenshot taken, no attachment made, and nothing naming the test.

## P3 — zero-sized image yields `NaN` edges

`screenshotBoundsToCss` (`e2e/helpers/canvas-helpers.ts:29`) and
`imagePointToCss` / `cssPointToImage` (`e2e/helpers/screenshot-scale.ts`)
divide by the image or box dimension, so a zero-sized input produces `NaN` or
`Infinity` instead of throwing. Deliberate — the modules stay branch-free and
total, and it is pinned — but a `NaN` coordinate reaching `page.mouse.click` is
opaque. Callers must reject empty images first.

## P3 — `drawLine` silently drops an explicit `steps: 0`

`e2e/helpers/canvas-helpers.ts:288` **[pinned]**

`if (options.steps)` is a truthy check, so `steps: 0` drops the whole options
object rather than being forwarded. Unreachable from current call sites.

## P3 — `TOOL_NAME_MAP` lookup is case-sensitive

`e2e/helpers/toolbar-helpers.ts:13`, `:25`, `:37`

`resolveToolName('SELECT & MOVE')` returns `'select-and-move'`, not
`'reposition'`. Harmless today only because the role fallback regex is
case-insensitive — two weaknesses cancelling out.

Separately, `generateSlug` does not expand `&` while `normalizeToolName` does,
so the two produce different slugs for the same label.

## P3 — transparent pixels weighted as fully opaque (low confidence)

`e2e/helpers/canvas-helpers.ts:214`, `:475` **[pinned]**

`dominantRed` and `getColorAtPoint` skip only `alpha === 0`, so a nearly
invisible pixel counts at full weight. A weighting concern rather than a
correctness bug, and the only helper that reports the colour back to the caller.
Every other helper in the file uses `a !== 0` as a filter, so these are the only
two places the distinction is observable.

## P3 — 10 orphaned committed baselines (2.1 MB)

`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`

The directory holds 17 files. Seven are read — the formats with
`comparePixels: true` in `e2e/export/helpers.ts`, each read through
`baselineFile()` by `visual-regression.spec.ts`. The other 10 are orphaned:

- the 8 raw export files (`drawing.png`, `.jpeg`, `.webp`, `.svg`, `.bmp`, `.gif`,
  `.avif`, and `drawing-icon.ico`) — no code writes or reads them any more, and
  `drawing.bmp` alone is most of the 2.1 MB
- `drawing-icon.ico.png` (256x256) — the ICO spec compares the export against the
  source canvas in-browser via `CHANGED_CHANNEL_THRESHOLD_ICO` and never calls
  `baselineFile()`
- `source-baseline.png` (300x100, exactly `CANVAS_REDRAW_CLIP`)

A repo-wide grep finds no reference to any of the 10. All are safe to delete; they
were left in place because deleting committed baselines was not authorized.

## Fixed — Enter did not reliably close the flyout (was P2, a real race)

`e2e/sidebar-keyboard.spec.ts:77` and `:89`

`expect(locator).toBeHidden() failed — waiting for getByRole('menu')`, at the
assertion that follows `page.keyboard.press('Enter')`.

Observed in **4 of 5 headless runs** (individual test failures: 1, 2, 1, 1, 0),
with no operator input of any kind. That is what establishes this as a genuine race
rather than the headed-input hazard above, and it means **headless does not fix
it**. It was previously recorded only as "flaky at roughly 1 run in 5" from a single
headed observation; headless is what showed the real rate.

Headed rate is not established: 0 failures in 2 observed headed runs, which is not
enough to claim it is mode-independent. It is only established that the race fires
headless.

**The mechanism was never "the flyout closes asynchronously".** That was the reading
this entry used to stop at. It is diagnosed, and the diagnosis is elsewhere:
`SidebarLeft.tsx` focuses the flyout's first item from a `requestAnimationFrame`
callback in the tool button's keydown handler, _not_ in the React commit that mounts
the menu. "The menu is visible" and "an item holds focus" are therefore two different
moments, one animation frame apart.

`openToolFlyoutViaKeyboard` waited only on visibility, so it could return inside that
gap. The test's next `ArrowDown`/`Enter` then landed on the **tool button** handler
again, which re-opens the flyout rather than navigating or activating it - so Enter
left the flyout open, and the following `toBeHidden()` timed out after 5 s.

**Fixed** by waiting for the app to actually take focus before returning. Measured
on the same host, same command, 12 consecutive runs of the two Enter tests:

| variant                            | failures |
| ---------------------------------- | -------- |
| wait on visibility only (previous) | 5 of 12  |
| wait on the promised item's focus  | 0 of 12  |

Two details the fix had to get right, both found by the first version failing:

- The readiness wait belongs to the keyboard opener, not to `waitForFlyout`. The
  right-click path never focuses an item, so a shared assertion would break it.
- `ArrowUp` focuses the **last** item, not the first (`SidebarLeft.tsx`:
  `event.key === 'ArrowUp' ? items.length - 1 : ...`). A single `.first()` assertion
  is simply wrong for that key and was caught by running the file.

Since the race was the suite's last intermittent failure, `openToolFlyoutViaKeyboard`'s
unit pins were extended to cover the new contract: a two-item flyout so "first" and
"last" are distinguishable, the correct end asserted per key, single-valued focus in
the double, and a case that rejects when the flyout opens but nothing takes focus.
Removing the readiness wait fails that last one.

## Known-skip tests

Two specs are `test.skip` by declaration:

- `e2e/export/photopea.spec.ts:6` — `exports to PSD and verifies in Photopea`.
  Round-trips through the external photopea.com, so it cannot run offline or in
  a sandboxed CI.
- `e2e/sidebar-flyout.spec.ts:48` — `right-click does not open flyout for
single-tool groups`.

## Verified and still unverified

**Verified by running the suite against a real browser:**

- The 7 comparison formats match the committed baselines.
  `e2e/export/visual-regression.spec.ts` passes all 8 specs, so every baseline the
  spec reads decodes and matches its committed pixels on this host. The ICO spec
  passes in-browser against the source canvas.

  **This was not true until the `updateSnapshots` guard was fixed — see the entry
  below.** The check that produced this claim was `if (testInfo.config.updateSnapshots)`,
  and Playwright's default for that option is the string `'missing'`, so the branch was
  always taken: every run re-recorded the baseline and returned before
  `compareScreenshots`. The comparison below it was unreachable, so "matches the
  committed baselines" was never actually established by any run. It is now, and it was
  established by mutation testing rather than by a green bar: a corrupted baseline fails
  with a sharp decode error, and a valid-but-different baseline fails with
  `Visual mismatch for PNG: 480000 diff pixels (ratio: 1.0000)`. Before the fix both
  were silently overwritten and the spec passed.

- The CDP failing set used to be deterministic per browser mode with disjoint sets:
  headed failed `:113 :129 :146 :163 :195`, headless failed `:220 :239`,
  reproduced identically across repeats. Both sets are now empty, and the new
  assertions are mode-independent by construction rather than by observation.
- `levels.spec.ts:64` and `:109` used to fail in both modes, 2/2 each, which is
  what established the `getWorkspaceCanvas` index shift as a real defect rather
  than a mode artifact. Both pass now that the canvas is found by test id.

**Not verified:**

- A headed run of the whole suite. It was never re-measured here, and
  `AGENTS.md` forbids it. The CDP fix removes the only headed-failing group and is
  written to be mode-independent, so headed is expected to be green too — but that
  is an inference from the assertions' shape, not a measurement. The operator-input
  hazard that made headed runs untrustworthy is also why: a headed green run here
  would not be strong evidence.
- Whether the CDP capture scale reproduces on CI's headless Linux runner, a third
  configuration never observed directly. It no longer matters for correctness — the
  assertions no longer name a scale — but it is why the helper's comment still
  describes the capture as "native device pixels" rather than a known factor.
- Any operator-input-caused failure. None has ever been reproduced here; the
  headless default is preventive.
- The pixel baselines are verified against a **dev-server** build, because
  `playwright.config.ts` starts `npm run dev`. Nothing establishes that
  `vite build` output renders byte-identically, so a future switch to serving
  `dist/` should be treated as a possible baseline-affecting change.
