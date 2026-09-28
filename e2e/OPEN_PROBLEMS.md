# Open Problems

Not a changelog. Each entry is an unfixed defect, with the evidence that proves
it. The one section that is not work says so on its own heading. Line numbers are
re-read from the working tree when the entry is written; where an entry sits
against a spec that has since been rewritten, its references are a record of the
past and are labelled as such.

Gates: `npm run tsc` exits 0, `npm run lint:check` reports no errors, and
`npm run test:e2e:unit` passes. The app's own gates are green too: `npm run tsc`
and `npm run test`.

The numbers this file used to open with — tests passed, expected-fail pins,
files, mode-specific failure sets — were each a snapshot of one tree, and each has
been wrong since it was written while the number beside it stayed silent. A count
that does appear here is a count somebody measured; read the current one off the
command.

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

**Run the suite headless** — `npm run test:e2e`. That is the default, and the
reason is the first entry below.

On the default (headless) configuration **nothing fails**: 106 pass, 2 are skipped by
declaration, and that is stable across repeated full runs.

Three defect groups used to fail here and have been fixed in this repository. Their
evidence is kept below rather than deleted, because each explains a shape the suite
must not drift back into:

| was failing                           | was                                     | now                                            |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| `e2e/helpers/cdp-helpers.spec.ts`     | 2 headless, 5 headed, disjoint per mode | scale-agnostic contract; mode-independent      |
| `e2e/sidebar-keyboard.spec.ts:76, 88` | 0–2, ~42% of headless runs              | root-caused to an rAF focus race, then awaited |
| `e2e/levels.spec.ts:64, 109`          | 2, both modes                           | canvas found by test id, not document order    |

All of these were introduced with the specs and were independent of how they were
moved into this repository: each was reproducible with no changes to the specs or
to `src/`. The remaining entries below are latent defects that no current run
trips — none of them is a known failure.

### Invariant — headless is the default, and the refusal is structural

**This is not a work item.** The mitigation is already shipped, and the rest of
this file is the work queue. `playwright.config.ts:83` resolves
`headless: process.env.PLAYWRIGHT_ALLOW_HEADED !== '1'`, and
`playwright.config.ts:46` loads `e2e/global-setup.ts`, which throws on `--headed`,
`--ui` and `--debug` and on any project that resolves to `headless: false`
(`e2e/global-setup.ts:44-61`). The refusal arrives before a browser exists, so the
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
(`sidebar-keyboard.spec.ts:88`) turned out to be a real race that fires in headless
runs with no operator input at all — see the Enter entry below. The hazard is
reported as recurring across this project's test work generally, which is why the
default is structural rather than procedural: it removes the failure class instead
of relying on everyone to remember.

Headless is also simply better for this suite, and that part is measured. The
failure sets are disjoint per mode and deterministic across repeats:

| specs                                                                                         | headed | headless |
| --------------------------------------------------------------------------------------------- | ------ | -------- |
| CDP, deriving expected size from `getDevicePixelRatio()` (`:113` `:129` `:146` `:163` `:195`) | 5 fail | pass     |
| CDP, explicit `deviceScaleFactor: 2` block (`:220` `:239`)                                    | pass   | 2 fail   |

So headless was the better mode even then, and both sets have since been fixed
(below).

**Headed runs are for looking at, not for gating on.** If you must run headed, a
headless result is what CI will produce. The five CDP failures in the table above
were _expected_ in a headed run at the time and are fixed now, so a headed run is
expected to be green too — which is the one claim in this file that no run in this
repository can establish. `test:e2e:headed` prints its warning on every invocation,
so the tradeoff is visible at the moment it is accepted.

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
(`e2e/helpers/cdp-helpers.ts:39-51`) used to assert the opposite, that the result
is `clip_size x clip.scale x deviceScaleFactor`.

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
rest of the suite. The helper's comment at `cdp-helpers.ts:39-51` needed correcting
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
  is how the defect above survived the e2e helper unit suite. It is replaced by
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
  `e2e/select-move.spec.ts:39` and `:72`) plus 2 indirect ones in
  `e2e/export/helpers.ts:110` and `:263`, had zero unit coverage. Now 32 tests,
  and it delegates to a single shared implementation.

---

## P2 — an empty CDP capture is reported as a successful capture

`e2e/helpers/cdp-helpers.ts:64-66`

`Buffer.from(data, 'base64')` is never length-checked, so a response whose `data`
is `''` decodes to a zero-byte buffer that the helper writes to
`<outputDir>/<name>.png`, attaches to the report, and returns as the capture. The
caller is told the capture succeeded and the report carries a file that is not an
image. The failure surfaces later and somewhere else: whatever reads the artifact
(`loadImageData`) raises a decode error naming the file, so the message points at
the consumer rather than at the capture that produced nothing.

Fix: reject a decoded payload of length 0 with an error naming
`captureCanvasScreenshot`, before the write and before the attach, so the capture
failure is the one the caller sees. Test the decoded length, not just the field:
`{ data: '' }` is a present, correctly-typed response that decodes to nothing, so
a `typeof data === 'string'` guard alone still lets it through.

Pinned by `reports success for an empty capture, writing and attaching a zero-byte
file` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:340`. A fix removes that
pin in the same change.

## P2 — a failing detach replaces the capture error and destroys the cause

`e2e/helpers/cdp-helpers.ts:68-70`

`finally { await cdp.detach() }` runs on the way out whether or not the capture
threw, and a rejection from it becomes the rejection the caller sees. When the
capture fails and the detach also fails — the likely pairing, because a capture
fails most often when the page or the target is already gone — the reported error
is the detach's, and the real cause is never reported at all. The one thing this
helper's error path has to do is name what went wrong.

Fix: keep the in-flight failure and let the detach replace it only when there is
none. Hold the capture's error (or nest the capture in its own `try`/`catch`) and
run the detach inside a `catch` that attaches the detach error as `cause` when
something is already failing. Do not swallow a detach failure on the success path:
a session that cannot be closed is the leak this helper exists to avoid.

Pinned by `reports a detach failure in place of the capture failure when both fail`
in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:371`. A fix removes that pin in
the same change.

## P2 — a CDP response without `data` surfaces as a raw `TypeError` from `Buffer`

`e2e/helpers/cdp-helpers.ts:60, 64`

A `Page.captureScreenshot` response that omits `data` reaches
`Buffer.from(undefined, 'base64')`, which throws `The first argument must be of
type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like
Object. Received undefined` (Node 24). The message names neither CDP, nor this
helper, nor the test, so the reader has to find the call site before they can tell
what failed. The sibling helper in the same directory checks its inputs and names
itself (`canvas-helpers.ts:207-209`); this one does not.

Fix: validate the response before decoding — `typeof data === 'string'`, and
non-empty — with an error that names `captureCanvasScreenshot` and the CDP request
it came from. Merge this with the length check above rather than adding a second
guard on the same two lines.

Pinned by `rejects with a raw TypeError when the CDP response omits data, and
detaches` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:322`. A fix removes
that pin in the same change.

## P3 — zero-sized image yields `NaN` edges

`screenshotBoundsToCss` (`e2e/helpers/canvas-helpers.ts:30`) and
`imagePointToCss` / `cssPointToImage` (`e2e/helpers/screenshot-scale.ts`)
divide by the image or box dimension, so a zero-sized input produces `NaN` or
`Infinity` instead of throwing. Deliberate — the modules stay branch-free and
total, and it is pinned — but a `NaN` coordinate reaching `page.mouse.click` is
opaque. Callers must reject empty images first.

## P3 — transparent pixels weighted as fully opaque (low confidence)

`e2e/helpers/canvas-helpers.ts:231` and `:507` **[pinned]**

`dominantRed` and `getColorAtPoint` skip only `alpha === 0`, so a nearly
invisible pixel counts at full weight. A weighting concern rather than a
correctness bug, and the only helper that reports the colour back to the caller.
They are the two places the distinction bites hardest, because the other two
`alpha === 0` filters, in `hasDarkPixels` (`:254`) and `hasRedPixels` (`:274`),
answer a yes/no question where one nearly-invisible pixel is the same as one
opaque one. The other half of the file, `getDarkPixelBounds` (`:401`) and
`getSelectionBounds` (`:457`), filters on `a !== 0` instead — a different question
asked with a boolean rather than a weight.

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

## P3 — the artifact name is interpolated into a path unsanitised

`e2e/helpers/cdp-helpers.ts:36-37`

Only `outputDir` is created, so `name` is sound only if it is a bare filename. A
name containing a separator (`nested/thing`) fails with `ENOENT` on a parent
directory that was never created, and a name that traverses (`../escaped`) resolves
outside `outputDir` — the file is written there, attached from there, and is not
removed by anything that cleans the output dir. Severity is low only because
`outputDir` is a throwaway per-test directory under `test-results/`.

Fix: **reject, do not sanitise.** Validate that `name` is a single path component
(no separator, not `.` or `..`) and throw an error naming the helper, for the same
reason the `outputDir` guard throws: the caller passed something impossible, and
silently rewriting it would attach the report under a name the test never asked
for. Sanitising would also let two distinct names collide into one artifact.

Pinned by `treats a name containing a path separator as a path, not a filename`
(`:454`) and `writes outside the output directory when the name traverses out of it`
(`:468`) in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts`. A fix removes both
pins in the same change; the first one's own comment names sanitisation as the
shape a fix must not take.

## P3 — the `outputDir` guard in `captureCanvasScreenshot` has no test

`e2e/helpers/cdp-helpers.ts:33-35`

The guard exists and is the same shape as `canvas-helpers.ts:207-209`, but it is
the module's only uncovered statement: `npm run test:e2e:unit:coverage` reports
`cdp-helpers.ts` at 93.75% statements and 93.33% lines with line 34 — the `throw` —
uncovered, against 100% of its functions. The sibling guard is pinned
(`e2e/helpers/__tests__/canvas-interaction.unit.test.ts:192-216`), so nothing fails
if this one is deleted, and the raw V8 failure it exists to replace
(`The "path" argument must be of type string. Received undefined`) returns with it.

Fix: add the two cases to `e2e/helpers/__tests__/cdp-helpers.unit.test.ts` — a
`TestInfo` with no `outputDir` and one with an empty string — asserting the helper's
own message and that no CDP session was opened. `createTestInfoMock()`
(`e2e/helpers/__tests__/canvas-helpers.fixtures.ts:121`) already makes `outputDir`
optional, so the double needs no change.

## Fixed — Enter did not reliably close the flyout (was P2, a real race)

`e2e/sidebar-keyboard.spec.ts:76` and `:88`

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
  `e2e/export/visual-regression.spec.ts` passes, so every baseline the spec reads
  decodes and matches its committed pixels on this host. The ICO spec passes
  in-browser against the source canvas.

  **This was not true until the `updateSnapshots` guard was fixed — see that entry
  above.** The check that produced this claim was `if (testInfo.config.updateSnapshots)`,
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
