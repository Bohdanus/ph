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

On the default (headless) configuration **nothing fails**: 97 pass, 2 are skipped by
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
detaches` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:322`. A fix removes that
pin in the same change.

## P2 — the Text toolbar supplies the rectangle Apply's gate asks for, so text typed without a drag commits at the document origin

`src/components/ToolbarsRight/Text/Text.tsx:37-42`, `:83`, `:210` and
`src/util/rect.ts:117-166`

`Apply` is gated on `disabled={!text || !rect}` (`Text.tsx:210`) and `applyText`
re-checks `if (text && rect)` (`:83`), so the control states that a rectangle is a
precondition for committing a text layer. The toolbar's own text input satisfies that
precondition by itself: `handleTextChange` passes every keystroke through
`calculateNewRect`, which manufactures a rectangle from the `{ x1: 0, y1: 0, x2: 0,
y2: 0 }` placeholder it substitutes when `args.rect` is null (`rect.ts:123`), then
widens it to the measured text (`rect.ts:133-166`). Typing the first character
therefore produces a real rectangle, `!rect` is false, and Apply enables with no canvas
interaction at all — so the `!rect` half of the gate is unreachable from the toolbar.

Measured headless, foreground set to `#ff0000`, starting document 800x600, no canvas
drag at any point. Every row was read on `main` at `aea55d3` except the overlay read,
which was taken on `e2e/text-tool` at `c7b268f` — a tree whose `src/` is byte-identical
to `aea55d3` — where it also reproduced the `Apply` enabled row:

| step                                                            | observed                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| select the Type tool                                            | `Apply` disabled                                              |
| type `Hi` into `#text-input`                                    | `Apply` **enabled**, and `Clear` enabled too                  |
| read the tool overlay's own backing store, still before `Apply` | 867 fully opaque foreground-red pixels, 943 at >=50% coverage |
| click `Apply`                                                   | layer row `text 2` added                                      |
| where those pixels are                                          | document (9,8)-(61,54) — a 52x46 block in the top-left corner |

(9,8) and (61,54) are read out of the overlay canvas's `ImageData`, so they are
document pixels with no scaling involved. `renderText` does not start there: it
starts at `x1 + TEXT_PADDING` / `y1 + TEXT_PADDING` (`text.ts:32`, `:49`,
`constants.ts:3`), which with the substituted placeholder rect is document
(5,5) — the _start_ of the layout, not the first painted pixel. The 4px of
horizontal and 3px of vertical offset from (5,5) are the glyph's side bearing and
ascent, and they are why an entry that says the pixels land "onward from document
(5,5)" is measuring the wrong pixel.

The drag-then-type path instead commits inside the dragged rectangle
(`e2e/text-tool.spec.ts` measures 11 / 20 / 328 / 45 CSS px of ink inset on left
/ top / right / bottom), so the two ways of enabling Apply place the text in
different places. What the UI does about it is the part an earlier version of this
entry got wrong: **the placement is visible before the commit.** The tool overlay
repaints the draft on every keystroke (`TextToolArea.tsx:46-50` -> `redrawText` ->
`renderText`), and the row above is that read taken _before_ `Apply` is clicked, so
a user who types without dragging watches the glyphs appear in the document's
top-left corner and can see that this is not where their other work is. The defect
is the gate and the default origin, not a placement the user cannot see: nothing
tells them a rectangle was supposed to be a precondition, and the origin is a poor
default for a document being worked on elsewhere, but it is on screen before the
click rather than after it.

Fix is a product decision, not a test change. Either commit at the origin deliberately
and drop `!rect` from the gate so the control stops implying otherwise, or keep the
gate and stop `calculateNewRect` from inventing a rectangle when `args.rect` is null:
return `null` in that branch and have `handleTextChange` leave the existing rectangle
alone. Whichever is chosen, `Text.tsx:210` and `handleTextChange` have to agree about
it.

**A fix to the gate would be completely unpinned, and that is deliberate.**
`e2e/text-tool.spec.ts` is the only spec in the tree that drives `#text-input`, and
all four of its tests drag a rectangle before typing — including the Clear test's
re-apply. So neither making `!rect` reachable nor dropping it from
`disabled={!text || !rect}` turns any test red, and nothing in the suite would notice
either way. A fix should land with a test that types without dragging: the observable
consequences are `Apply` staying disabled until a rectangle exists, and the committed
ink landing where the user dragged. Until then the behaviour is recorded here and
nowhere else.

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
