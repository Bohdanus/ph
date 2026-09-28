# Open Problems

Not a changelog. Each entry is an unfixed defect, with the evidence that proves
it. The one section that is not work says so on its own heading. Line numbers are
re-read from the working tree when the entry is written; where an entry sits
against a spec that has since been rewritten, its references are a record of the
past and are labelled as such.

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

Nothing fails on the default (headless) configuration. The export-baseline and
`pen-types` failures that used to be recorded here are gone because the cause was
fixed, not because an assertion was relaxed: `ab5f53c` corrected the export line's
document constant, which had been derived from the canvas box rather than from the
document, so the stroke landed 23 rows off the committed baseline. The recorded
pixels were correct all along. The remaining entries below are latent defects that
no run trips.

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
to `src/`. Apart from the layout entry below, the remaining entries in this file
are latent defects that no current run trips.

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
runs with no operator input at all; the mechanism is recorded at
`sidebar-keyboard.spec.ts:5-10`. The hazard is
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

## P2 — `drawLine` applies no contain scale, so its arguments are not document coordinates

`e2e/helpers/canvas-helpers.ts:524`

A spec must not drift into the assumption that `drawLine`'s arguments are
document coordinates. They are not. `drawLine` computes
`{ x: box.x + startX, y: box.y + startY }` and nothing else, while the document it
addresses is **contained** in that box (`object-contain`,
`src/components/Main/Main.tsx:245`): the CSS origin of document `(0,0)` is

```text
scale    = min(boxWidth / 800, boxHeight / 600)
offsetX  = (boxWidth  - 800 * scale) / 2
offsetY  = (boxHeight - 600 * scale) / 2
cssX     = box.x + offsetX + documentX * scale
cssY     = box.y + offsetY + documentY * scale
```

so a document point reaches `page.mouse` as
`(x / scale, (y - offsetY) / scale)` once the box origin is added. At the Desktop
Chrome default in a 1280px viewport the scale is 1.2175, and `offsetY` is 54.75
at a 840px box and 154.75 at a 1040px box — which is why the previous entry moves
the export fixture's line by more than 80 document rows upward while its box
coordinates do not change at all.

Existing specs survive this only because their strokes need to land SOMEWHERE, not
where they were asked to land. `levels.spec.ts`, `color.spec.ts`, `select-move.spec.ts`
and `example.spec.ts` all pass `LINE_START_*`/`LINE_END_*` and then assert colour,
presence or a bounding box wide enough to absorb the error. A new spec that asserts
a specific pixel position, a specific row, or a stroke that must fall inside the
document will be tens of pixels off, and the failure will look like an app bug.

Fix: add a contain-aware coordinate helper next to `drawLine` — the arithmetic is
the four lines above — and migrate the specs that need document precision onto it.
Do not change `drawLine`'s existing behaviour: the specs that call it today are
written around box-relative coordinates, and changing the meaning of the argument
breaks all of them at once.

## P2 — `boundingBox()` is viewport-relative and a CDP capture clip is page-relative

`e2e/helpers/screenshot-scale.ts:46-68`, `e2e/helpers/cdp-helpers.ts:55-74`

The hazard, for whoever refactors this next. The app is taller than Playwright's
720px window, so the window scrolls. `Locator.boundingBox()` measures against the
VIEWPORT and goes negative as soon as it does — a canvas scrolled 440px down
reports `y: -340` where it reported `y: 100` before. `page.mouse` shares that
space. But `page.screenshot({ clip })` and CDP `Page.captureScreenshot`, which
this suite calls directly, take their clip against the DOCUMENT origin. The two
take **opposite** conventions from each other for the same numbers: Playwright
takes a viewport clip and adds the scroll offset itself, so converting there moves
the clip the wrong way; raw CDP takes a page clip, so converting nothing moves the
capture 440px away from the region the caller measured. Neither direction throws.
A clip derived from a scrolled `boundingBox()` and handed to CDP untranslated
either returns the wrong region or lands off-canvas, where the failure surfaces as
`Clipped area is either empty or outside the resulting image` and reads as a
capture bug rather than a coordinate bug.

**The helper-level fix is done, and it is recorded here so a refactor does not
undo it.** The conversion is the pure function `viewportRectToPageRect`
(`screenshot-scale.ts:69-76`), it is applied **at the CDP site only**
(`cdp-helpers.ts:66-74`) and not in the callers, the scroll offset is read per
capture rather than cached (`getPageScroll`, `canvas-helpers.ts:375-377`, because
the window scrolls between captures — `clickToolButton` alone scrolls 440px, which
is what `preservingScroll` exists to undo, `toolbar-helpers.ts:117-121,128,150`),
and the rule is unit-tested for a non-zero offset at
`e2e/helpers/__tests__/screenshot-scale.unit.test.ts:306-323`.

What is left is a rule for new code: a spec that mixes `boundingBox()` with a CDP
capture must not assume the two agree, and must not introduce a second conversion
somewhere that already has one.

## P2 — an empty CDP capture is reported as a successful capture

`e2e/helpers/cdp-helpers.ts:81`

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
file` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:415`. A fix removes that
pin in the same change.

## P2 — a failing detach replaces the capture error and destroys the cause

`e2e/helpers/cdp-helpers.ts:85-87`

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
in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:446`. A fix removes that pin in
the same change.

## P2 — a CDP response without `data` surfaces as a raw `TypeError` from `Buffer`

`e2e/helpers/cdp-helpers.ts:77, 81`

A `Page.captureScreenshot` response that omits `data` reaches
`Buffer.from(undefined, 'base64')`, which throws `The first argument must be of
type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like
Object. Received undefined` (Node 24). The message names neither CDP, nor this
helper, nor the test, so the reader has to find the call site before they can tell
what failed. The sibling helper in the same directory checks its inputs and names
itself (`canvas-helpers.ts:375-377`); this one does not.

Fix: validate the response before decoding — `typeof data === 'string'`, and
non-empty — with an error that names `captureCanvasScreenshot` and the CDP request
it came from. Merge this with the length check above rather than adding a second
guard on the same two lines.

Pinned by `rejects with a raw TypeError when the CDP response omits data, and
detaches` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:397`. A fix removes that
pin in the same change.

## P3 — zero-sized image yields `NaN` edges

`screenshotBoundsToCss` (`e2e/helpers/canvas-helpers.ts:30`) and
`imagePointToCss` / `cssPointToImage` (`e2e/helpers/screenshot-scale.ts`)
divide by the image or box dimension, so a zero-sized input produces `NaN` or
`Infinity` instead of throwing. Deliberate — the modules stay branch-free and
total, and it is pinned — but a `NaN` coordinate reaching `page.mouse.click` is
opaque. Callers must reject empty images first.

## P3 — transparent pixels weighted as fully opaque (low confidence)

`e2e/helpers/canvas-helpers.ts:428` and `:718` **[pinned]**

`dominantRed` and `getColorAtPoint` skip only `alpha === 0`, so a nearly
invisible pixel counts at full weight. A weighting concern rather than a
correctness bug, and the only helper that reports the colour back to the caller.
They are the two places the distinction bites hardest, because the other two
`alpha === 0` filters, in `hasDarkPixels` (`:453`) and `hasRedPixels` (`:473`),
answer a yes/no question where one nearly-invisible pixel is the same as one
opaque one. The other half of the file, `getDarkPixelBounds` (`:621`) and
`getSelectionBounds` (`:673`), filters on `a !== 0` instead — a different question
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

`e2e/helpers/cdp-helpers.ts:38-39`

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
(`:529`) and `writes outside the output directory when the name traverses out of it`
(`:543`) in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts`. A fix removes both
pins in the same change; the first one's own comment names sanitisation as the
shape a fix must not take.

## P3 — the `outputDir` guard in `captureCanvasScreenshot` has no test

`e2e/helpers/cdp-helpers.ts:34-37`

The guard exists and is the same shape as `canvas-helpers.ts:375-377`, but it is
the module's only uncovered statement: `npm run test:e2e:unit:coverage` reports
`cdp-helpers.ts` at 93.75% statements and 93.33% lines with line 36 — the `throw` —
uncovered, against 100% of its functions. The sibling guard is pinned
(`e2e/helpers/__tests__/canvas-interaction.unit.test.ts:192-216`), so nothing fails
if this one is deleted, and the raw V8 failure it exists to replace
(`The "path" argument must be of type string. Received undefined`) returns with it.

Fix: add the two cases to `e2e/helpers/__tests__/cdp-helpers.unit.test.ts` — a
`TestInfo` with no `outputDir` and one with an empty string — asserting the helper's
own message and that no CDP session was opened. `createTestInfoMock()`
(`e2e/helpers/__tests__/canvas-helpers.fixtures.ts:223`) already makes `outputDir`
optional, so the double needs no change.

## P2 — `toBeDisabled()` on an `<option>` is retargeted to its `<select>` and always reports enabled

`@playwright/test` 1.63.0, `elementState('disabled')` → `retarget(node, 'follow-label')`

Every options bar in this repository wraps its own control in a `<label>`
(`src/components/ToolbarsRight/Eraser/Eraser.tsx:47-59` and every sibling bar), so the
markup that makes a control's accessible name is the same markup that defeats the
assertion on it. Playwright's `disabled` state does not test the element the locator
resolved: `retarget` first walks a non-form-control up to
`button, [role=button], [role=checkbox], [role=radio]`, and then — for the
`follow-label` behaviour it uses for `disabled` — up to `element.closest('label')` and
returns `enclosingLabel.control`. An `<option>` is neither a form control nor a member
of that first selector list, and its ancestor _is_ the label, so the check is made
against the `<select>`, which carries no `disabled` attribute. The result is
`Received: enabled` for an option that demonstrably has `disabled=""` and
`option.disabled === true`.

This is a wrong-pass: a bar that removed the attribute, or that enabled a mode it
cannot render, would still be reported as correct. It is also invisible in jsdom —
`src/components/ToolbarsRight/Eraser/__tests__/Eraser.test.tsx:90` asserts
`expect(options[0]).toBeDisabled()` with `@testing-library/jest-dom` and passes,
because that matcher reads the DOM property directly and has no retarget step. A
jsdom pass is therefore not evidence that the browser assertion works.

Workaround used in `e2e/erase-fill-eyedropper.spec.ts:375`: assert the attribute and
the enabled set, both read straight off the DOM.

```ts
await expect(brushOption).toHaveAttribute('disabled', '');
const selectable = await mode
  .locator('option')
  .evaluateAll((nodes) =>
    nodes.filter((n) => !(n as HTMLOptionElement).disabled).map((n) => (n as HTMLOptionElement).value)
  );
expect(selectable).toEqual(['pencil', 'block']);
```

`toHaveAttribute` is unaffected (it reads the resolved element), and the enabled set is
the same fact stated as what a user can actually choose. No fix is proposed here: the
retarget is upstream behaviour, and the only way to remove it from the assertions is
to stop wrapping the control in its label, which is the repo's markup convention.

## P2 — a cached canvas box addresses a different pixel after a tool switch

`e2e/canvas-helpers.ts` consumers; measured on `Desktop Chrome` (1280x720), 2026-09-28

The workspace canvas element is `width: 100%; height: 100%` of a CSS grid row, and the
row's height is the active tool's options bar. Switching from the Eraser bar to the
Magic Eraser bar changes the bar's height, the main area resizes, and the canvas box
moves. A spec that measures the box once and reuses it afterwards is then clicking and
sampling a different pixel — with no error anywhere, because every coordinate is
still a valid number.

Measured on this suite: a `boundingBox()` of `{x: 56, y: 100, width: 974, height: 890}`
taken under the Eraser bar addressed a point 20 CSS px higher under the Magic Eraser
bar, which is enough to move a 24-CSS-px stroke out of the sampled window entirely.
The symptom is not a failure but a _wrong_ one: the magic eraser appeared to erase the
whole line and a bucket appeared to fill nothing, and both readings were artefacts of
the stale box. `usePointerPosition` centres the 800x600 document inside the canvas, so
the vertical offset is the product of two scales (`974/800` and `890/600`) rather than
one, and a cached box cannot be corrected after the fact.

Fix: measure the box immediately before every gesture and every capture, or measure it
once per tool after the options bar for that tool has rendered. `e2e/erase-fill-eyedropper.spec.ts`
threads a `canvasBox(page)` call through `stroke`, `clickAt`, `readPixel`,
`measureErasedWidth` and `slabClip` for this reason. A helper that returns the box
alongside the capture it took would make the mistake harder to make.

## Known-skip tests

Two specs are `test.skip` by declaration:

- `e2e/export/photopea.spec.ts:6` — `exports to PSD and verifies in Photopea`.
  Round-trips through the external photopea.com, so it cannot run offline or in
  a sandboxed CI.
- `e2e/sidebar-flyout.spec.ts:171` — `right-click does not open flyout for
single-tool groups`.

## Verified and still unverified

**Verified by running the suite against a real browser:**

- The 7 comparison formats matched the committed baselines, before the toolbar
  grew. `e2e/export/visual-regression.spec.ts` passed, so every baseline the spec
  reads decoded and matched its committed pixels on this host. The ICO spec passes
  in-browser against the source canvas. They no longer match — see the P1 entry
  above for the one layout change that moved them and the three ways out.

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

## P2 — the export line is specified in document space; the ICO line still is not

`e2e/export/helpers.ts`, `setupIcoTest`

`setupExportTest` used to draw at canvas-relative offsets (`150,150` to `350,150`), which
made the export a function of the window rather than of the document. The canvas is
`w-full h-full` of a grid area the shell sizes, and `usePointerPosition` fits the document
into it and centres it, so the same offsets marked different document points at different
canvas sizes. The baselines encoded one particular canvas height: fixing a real desktop
overflow moved the canvas from 974x890 to 974x583 and shifted the export by 459 pixels with
no change anywhere in the export path.

`setupExportTest` now specifies the line in document space and maps it in with
`documentToCanvasOffset`, which mirrors the app's own contain-fit, and pins the committed
pixels by using the document points the old offsets mapped to. `the export is independent of
the canvas height` in the same spec asserts the property directly, and
`e2e/helpers/__tests__/document-mapping.unit.test.ts` pins the mapping.

`setupIcoTest` is untouched and still strokes at `ICON_STROKE` canvas-relative offsets
against a 256x256 document. It escapes harm today because it compares in-browser against the
source canvas rather than against a committed baseline, so a moved line still matches itself.
It is one layout change away from the same class of failure, and the fix is the same: map
`ICON_STROKE` through `documentToCanvasOffset` with a 256x256 document.

## P2 — an explicit redraw clip is in page coordinates, and a canvas-relative one passes for the wrong reason

`e2e/helpers/canvas-helpers.ts`, `buildClip`

`buildClip` returns an explicit `clip` exactly as given; only its own default,
`canvasRedrawClip`, adds the canvas box origin. A caller that passes canvas-relative
offsets therefore polls the wrong region of the page.

The failure mode is the dangerous shape rather than an obvious one: the wrong region is
still a region, and `hasDarkPixels` may be satisfied by something that was already dark —
the app's `#212529` header, for one. The wait returns, the stroke is not what was observed,
and the test continues on a false positive. A clip that lands on empty canvas instead fails
loudly, which is the better of the two outcomes and is not guaranteed.

`setupExportTest` hit this while being decoupled and passed anyway, which is why
`e2e/export/__tests__/helpers.unit.test.ts` pins the clip in page coordinates with literal
values. Worth knowing before passing a custom clip anywhere in this suite: the two forms
differ by the box origin and nothing in the types distinguishes them.

## P1 — the document-space oracle reached a handful of call sites, so most of the suite still moves when the frame does

`e2e/helpers/canvas-helpers.ts:48-51`

**What exists.** `documentToCanvasOffset` maps a DOCUMENT point into the canvas box by reproducing
the app's contain fit, and the export fixture uses it, so `e2e/export/visual-regression.spec.ts` no
longer depends on where the app put the letterbox. That is the right idea and it works.

**What does not.** The idea reached exactly one caller. `LINE_START_X`/`LINE_START_Y`/`LINE_END_X`/
`LINE_END_Y` at `e2e/helpers/canvas-helpers.ts:48-51` are still "relative to the canvas box", and nine
specs import them: `adjustments`, `color`, `document-dialogs`, `erase-fill-eyedropper`, `example`,
`file-roundtrip`, `levels`, `paint-tool-pixels`, `select-move`. Beyond those, the suite writes its
gestures as `box.x + <something>` throughout, and **none of them invert the mapping back to document
space**. Counted, with the counting command, because a number here without one is worse than none
and an earlier draft of this entry got it wrong twice — once by 7x:

```
grep -rEo "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[0-9]+" e2e            # 25  canvas-relative LITERALS
grep -roE "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]*" e2e   # 63  any box-relative offset
grep -roE "[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]* *\*" e2e      #  0  the fraction form, which is correct
```

So: 25 gestures add a bare number to the box origin, and 63 add something box-relative. The 63 is
the larger number because it includes sites like `box.x + LINE_Y`, which reach the same place
through a named constant rather than a literal — those are the ones the first pattern misses
entirely, and a count that only looked for literals is how the first draft of this entry said
"twelve" and the second said "eighty-three". Both were wrong; the zero on the third line is the
part that matters, because `e2e/viewport-drawing.spec.ts` gestures at `box.x + box.width * 0.25`
and that is the one form that survives a layout change by construction.

The ICO export path is still canvas-relative as well: `ICON_STROKE` at `e2e/export/helpers.ts:479`
is a set of box offsets, used at `:508` and `:510`.

**Why it matters, stated as a measurement rather than a worry.** These are not merely fragile, they
are wrong in a specific direction. A `box.x + 150` gesture is a _window_-relative point: change the
window and the point the mouse visits is a different point in the document. The document-space
mapping has to be inverted before such a literal is meaningful, and it is not. So the suite still
asserts against whatever geometry the current layout happens to produce, and a layout change
silently changes what is being tested rather than failing.

**Five assertions that fail outright on a 1px rail change**, all in `e2e/responsive-shell.spec.ts`:
`:185` expects the collapsed rail at 56, `:206` and `:270` expect the right panel at 250, `:220`
expects the panel's own width delta at 250, and `:285` expects the two-column rail at 108. Those are
`toBeCloseTo(x, 0)`, so a single pixel fails them. They are the sharp end of the same defect: a
number written into a test is a pin on the layout, and the layout is not the subject.

**The pattern to copy is already in the tree.** `e2e/viewport-drawing.spec.ts:26-27` gestures at
`box.x + box.width * 0.25` and `box.y + box.height * 0.35` — a fraction of the box, so it tracks the
box instead of the window. That is the shape every one of the eighty-three should take, via
`documentToCanvasOffset`.

**Do not fix this by re-recording anything.** A re-record would bless the new layout, which is
exactly the failure this campaign already made once: the seven export baselines were re-derived from
a moving letterbox before `e8f17ba` specified the line in document space.

## P2 — the dialog spec's `documentSize` pins a read that no longer proves the resize happens

`e2e/document-dialogs.spec.ts`

The spec's claim is that the dialog's dimensions are the thing under test, and it pins the
document size to prove the app resized its canvas to it. The read is real: the size comes
off the canvas backing store rather than being assumed, and asserting it is what makes that
read observable. But the resize it is taken to prove is not, and it is not close.

Neighbouring `src/hooks/useApp.ts` resizes the same element at **two** sites — `:63` and
`:113` — and `src/contexts/layer-renderer.ts:136` resizes it again. Neutering the call the
spec's comment names, and leaving the other two live, turns all four dialog tests green.
So a build in which `useApp`'s resize is dead still passes every one of them.

The draft-outline wait in the same file has the same shape, one level up: it proves the
DRAG happened, not that the commit did. The pixel containment assertion is what proves the
commit, and it is the one that would fail if a resize were wrong.

**Fix.** Pin the resize where it happens rather than at a distance: assert that the
document canvas's backing store equals the size the dialog committed, after the resize path
that owns it has run, and name which of the three sites the test is covering. Until then,
`documentSize` proves the READ and the word "resized" in its comment is doing work the test
does not do.

> **Re-verification baseline, restated.** These entries were re-verified against `6c84971`,
> which is before this tree merged the e2e campaign branch. A merge moves lines, so any
> `file:NNN` below is suspect for the same reason every other citation in this repository
> is suspect: re-derive it from the claim before acting on it. UNVERIFIED here.

---

# Transferred findings — external review of the pre-migration tree

Every entry below was raised against `/Users/bkalynovskyi/ps-playwright` before the
suite moved here, and every one was **re-verified against this tree** at `6c84971` — see the note below on
what has happened to the tree since
before being written down. Line numbers were re-derived; none of the originals
transferred. An entry appears here only because it is real here **and** absent from
every ledger in this repository. What an external review said is not evidence about
this tree, and what the entries below say is what this tree does.

The source repository is frozen at `78be956` and its ledger is not maintained. This
section supersedes nothing above it; it is the part of that review that survived
contact with this tree.

## P1 — the documented baseline re-record command cannot re-record

`package.json:28`, `e2e/export/visual-regression.spec.ts:73,83`

`test:e2e:update-baselines` runs `playwright test e2e/export/visual-regression.spec.ts
--update-snapshots`, and the record/compare branch is gated on
`if (testInfo.config.updateSnapshots === 'all')`. Bare `--update-snapshots` yields
`'changed'`, not `'all'` — Playwright declares the flag with `preset: "changed"` in
`node_modules/playwright/lib/program.js`, and `lib/common/index.js` falls back to
`"missing"` only when the option is absent entirely. So the branch is never taken.

Worse, `'changed'` is inert here too. This spec reads its baseline with `readFile`
and compares with `compareScreenshots`; it is not a Playwright snapshot assertion, so
there is no stored-snapshot state for `'changed'` to rewrite. **The script is a no-op
in both branches**: existing baselines are only ever compared.

The failure path then closes on itself. `visual-regression.spec.ts:83` throws
`Baseline missing for <FMT>. Run with --update-snapshots to create.` — naming the
exact command that just ran, and that cannot work.

`AGENTS.md:442` and `.skills/photoshop-tool-creation.md` both state that the baselines
re-record with `--update-snapshots`. Neither is true. The only way to re-record is
`--update-snapshots=all`.

Fix: `--update-snapshots=all` in `package.json:28`; correct the error message at
`:83` and the two documents that repeat the claim.

## P1 — `getStrokeAnalysis` thresholds are absolute pixel counts over a device-pixel capture

`e2e/helpers/canvas-helpers.ts:206,209,210` against `:753-764`

`verticalSpread` is measured in raw capture pixels and compared against
`SPRAY_VERTICAL_SPREAD_THRESHOLD: 30`; occupied-column gaps are compared against
`SPRAY_GAP_THRESHOLD: 3` and `PEN_GAP_THRESHOLD: 5`. Nothing in the function is
DPI-relative, and both inputs are device-resolution: `cdp-helpers.ts:79` pins
`scale: 1`, and `shape-tools.spec.ts:212,221` feeds the function
`page.screenshot({ clip })`, whose default is `scale: 'device'`.

So the same physical stroke classified at 1x and at 2x gets roughly double the
`verticalSpread` and double the gaps against thresholds that did not scale. At 2x a
pen stroke's anti-aliased edge crosses 30 and `type` flips to `'spray'`; a 3-CSS-px
anti-aliasing bridge becomes 6 device columns, clears `PEN_GAP_THRESHOLD`, and splits
— turning `solid` into `dashed`.

The unit tests cannot catch it: every fixture is a synthetic
`createImageData(100, 10)`, so it is DPR-agnostic by construction, and the pinned
`CONSTANT_CONTRACT` table covers the constants, not the resolution they are applied at.

This was latent when it was first raised. **It is not latent here**, and the scale is
already measured rather than assumed. `cdp-helpers.spec.ts:88-93` records that a CDP
capture comes back at Chrome's **surface** scale, which on this HiDPI host is 2x and
is unaffected by the emulated `deviceScaleFactor`. So the thresholds at `:206,209,210`
are already being compared against 2x device pixels on every run on a developer
machine, with no config change at all. And the second consumer at
`shape-tools.spec.ts:212,221` asserts `segments === 1` and `type === 'solid'` directly
against a `'device'`-scaled capture, which is the same 2x on the same host.

Fix: make the thresholds DPI-relative (compare `spread * cssScale`), and state the
capture scale at the call sites rather than leaving it implicit. This is the
precondition for any mobile or HiDPI project, and it is not in the scope of adding
one.

## P1 — the tool-active assertion in `color.spec.ts` cannot fail

`e2e/color.spec.ts:31-32`

```ts
await clickToolButton(page, 'draw');
// The draw tool only strokes with the active foreground color once it is the active tool.
await expect(page.getByTestId('tool-button-draw')).toHaveAttribute('aria-pressed', 'true');
```

`aria-pressed` on `tool-button-draw` is already `'true'` on a virgin load: `draw` is
the app's default tool (`src/util/constants.ts:17` `DEFAULT_TOOL = 'draw'`), and
`SidebarLeft.tsx:265` computes `aria-pressed` from the group membership. The
assertion is satisfied before the click and after it, so it is a no-op — and
`clickToolButton` asserts nothing about activation, so this line is the test's only
tool-state check.

The comment describes a real precondition that nothing verifies. Fix: select a
different tool first and assert the attribute _flips_, or assert against a tool that
is not the default.

## P1 — the dialog-closed assertion is one rename from vacuous

`e2e/export/helpers.ts:235`

```ts
await expect(page.getByRole('heading', { name: 'Save File As...' })).toHaveCount(0);
```

The locator matches exactly one node today. But the title is an implicit-heading
`<h3>`: render it as a `<div>`, or reword it to "Save As…", and the locator matches
nothing while the assertion passes forever with the dialog still open.

The migration proposed this fix and it was never applied here, while the correct
pattern landed in a sibling spec — `document-dialogs.spec.ts:202,206,210` already
uses `getByTestId('save-dialog')` with `toHaveCount(0)`, and the testid exists
(`src/components/SaveDialog/SaveDialog.tsx:44`). The fix is already in this suite; it
was only never copied into `export/helpers.ts`.

## P1 — the keyboard-flow test asserts the menu closed and nothing else

`e2e/sidebar-keyboard.spec.ts:80-89`

The test navigates by hard-coded index (`ArrowDown` = "Levels", an ordering nothing
pins) and then asserts only `toBeHidden()` on the menu. The placeholder comment at
`:88` — `// Levels tool should now be selected (would need verifyPrimaryTool for
'levels')` — is still the state of the file. Reorder the three flyout entries and the
test selects a different tool and still passes.

`navigateAndSelectInFlyout` exists for exactly this and is used by
`paint-tools.spec.ts:615` and `selection-tools.spec.ts:828,934`; this spec does not
import it. `verifyPrimaryTool` is already imported here and used by the sibling test
at `:77`, so the fix is local.

## P1 — `levels.spec.ts` compares colour through two different clip rects

`e2e/levels.spec.ts:81` against `:95-105` (and `:123` against `:136-146`)

`original` is sampled with the pre-flyout `box`; `afterBrightness` is sampled with
`adjustedBox`, re-measured after the Levels panel opened. The assertion at `:105` is
`expect(afterBrightness.red).not.toBe(original!.red)`, so **any two differing red
values satisfy it** — including a pair produced by sampling two different regions of
the page. The comment at `:93-94` justifies re-measuring for the second reading
without re-measuring the first, which is the defect stated as a rationale.

The `fill(x)` → `toHaveValue(x)` pair at `:90-91` and `:132-133` compounds it: it
proves the input accepted keystrokes and nothing about the app.

The docblock overstates what the test checks. Fix: sample both readings through one
box, and assert a direction rather than mere difference.

## P1 — `.first()` immediately above `toHaveCount(1)`, and a unit test that resists the fix

`e2e/export/helpers.ts:426-427`

```ts
const input = page.locator('input[type="file"]').first();
await expect(input).toHaveCount(1);
```

`.first()` caps the match at 1, so `toHaveCount(1)` can only ever distinguish _0_ from
_1_. The evident intent — assert the file input is unique — is defeated by the line
above it.

It is also **pinned**: `e2e/export/__tests__/helpers.unit.test.ts:1365` asserts
`expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(1)`, so removing the `.first()`
— the fix — turns the helper suite red for the wrong reason. The two must change in
one commit, or the pin blocks the fix.

## P2 — the DPR contract in `cdp-helpers.ts` is contradicted by the measurement in its own spec

`e2e/helpers/cdp-helpers.ts:41-46`

The comment asserts that a capture comes back at
`clip_size × clip.scale × deviceScaleFactor`, that this is "the same as
`page.screenshot()`", and that at `deviceScaleFactor` 2 a 120x80 CSS clip decodes to
240x160. Both statements are contradicted by measurements recorded in the sibling file
300 lines away:

- `cdp-helpers.spec.ts:88-93` — "`Page.captureScreenshot` returns native device
  pixels, and on this HiDPI host that scale is a function of the browser mode rather
  than of the emulated `deviceScaleFactor`. Measured, a 240x160 CSS clip decodes to
  480x320 while `window.devicePixelRatio` reports 1; sweeping the project-level
  `deviceScaleFactor` over 1, 2 and 3 produced the same 480."
- `cdp-helpers.spec.ts:274-279` — "the emulated ratio is a Playwright setting applied
  to `window.devicePixelRatio`; what CDP captures at is Chrome's surface scale.
  Measured on this host the two diverge."

A clipped CDP capture does not scale with `deviceScaleFactor`; it comes back at the
host's surface scale. `page.screenshot({clip})` does scale with it. The comment states
the opposite, and `e2e/OPEN_PROBLEMS.md` records the resulting question as "why the
helper's comment still describes the capture as native device pixels" without noticing
that the description is wrong about the mechanism.

The two assertions that were red on this premise are gone — `expectFaithfulCaptureOf`
derives its scale from the decoded image and the emulated-`deviceScaleFactor: 2` block
asserts "one integral scale" — so the residue is a comment that has already misled
once. Fix the comment; do not reintroduce a named DPR into the assertions.

## P2 — `getStrokeAnalysis` segment seeding has an unstated bound

`e2e/helpers/canvas-helpers.ts:757-762`

```ts
let segments = 0;
let prev = -10;
for (const col of columns) {
  if (col - prev > gapThreshold) segments++;
  prev = col;
}
```

`segments` only lands on 1 for a solid stroke while `gapThreshold < 10`. Nothing at
the site states that dependency. The hand-maintained
`CONSTANT_CONTRACT` table (`canvas-stroke-analysis.unit.test.ts:48-49`) currently
guarantees it, so raising `PEN_GAP_THRESHOLD` to >= 10 makes `segments` return **0**
for a solid stroke — and since `type` tests `segments > 1` (`:768`), the function then
returns the self-inconsistent `{ type: 'solid', segments: 0 }`.

`let segments = 1; let prev = columns[0];` has no precondition.

## P2 — `getColorAtPoint` returns NaN components for fractional coordinates

`e2e/helpers/canvas-helpers.ts:666,673-679`

The bounds guard is `if (pointX < 0 || pointX >= width || pointY < 0 || pointY >= height) return null;`.
A fractional `pointX`/`pointY` passes it. The sampling loop then computes
`const index = (y * width + x) * 4` with fractional `x`/`y`, every `data[index]` read
returns `undefined`, and `if (alpha === 0) continue` does not fire because
`undefined === 0` is false. The result is a non-null
`{ red: NaN, green: NaN, blue: NaN }` — a fabricated colour, where the function's own
contract says `null` means "nothing at this point".

The sibling "zero-sized image yields NaN edges" entry above documents the divide in
`imagePointToCss` / `cssPointToImage`; this is a different function and a different
mechanism, and nothing records it.

Still latent: every call site rounds (`layers.spec.ts:44` does it explicitly). A
`Number.isInteger` guard at the top of the function closes it.

## P2 — `clickToolButton`'s `&` fallback makes the real label unreachable, and a test pins it

`e2e/helpers/toolbar-helpers.ts:132-134,147-148`

`fallbackNames` includes the **raw** caller-supplied name whenever it differs from the
normalized one, and then `:148` applies `name.replace(/&/g, 'and')` to _every_
candidate. For `toolName = 'Select & Move'` the raw candidate is therefore searched as
`/Select and Move/i` — which cannot match a button whose accessible name is literally
`Select & Move`. One of the three attempts is dead for the case that motivated it.

`escapeRegExp` is now applied (`:148`), so the unescaped-pattern half is closed; this
is the remaining half. `toolbar-helpers.unit.test.ts:839-843` pins the mangled
behaviour against a fixture whose element name is already the substituted form, so
fixing it means removing that pin in the same change.

## P2 — `exportIcoAndVerify` has no dialog-closed assertion

`e2e/export/helpers.ts:335-392` against `:235`

`exportAndVerify` proves the dialog unmounted. `exportIcoAndVerify` takes no
`testInfo` and has no equivalent, so `e2e/export/ico.spec.ts` ends without proving the
dialog closed — the one asymmetry between two functions that otherwise do the same
job. Not recorded anywhere in this repository.

## P2 — `color-helpers.spec.ts` pre-seeds the swatch with the colour it then sets

`e2e/helpers/color-helpers.spec.ts:18-24`

```ts
await page.setContent(`
  <input data-testid="foreground-color-input" type="color" value="#000000">
  <div data-testid="foreground-color-swatch" style="background-color: rgb(255, 0, 0)"></div>
`);
await setForegroundColor(page, '#ff0000', true);
```

The swatch is _already_ `rgb(255, 0, 0)`. If the helper became a no-op, the internal
`toHaveCSS` would still see the seeded value and the test would pass. The test
carries no assertion of its own. The structurally identical test further down the file
was strengthened for exactly this reason; this one was missed.

## P2 — the Photopea oracle asserts a common substring on a third-party page

`e2e/export/helpers.ts:433-434`

```ts
const expectedDocumentName = path.basename(psdPath, path.extname(psdPath));
await expect(page.locator('body')).toContainText(expectedDocumentName, { timeout: 30_000 });
```

The name is now derived from the path rather than hard-coded, which fixes the
rename-coupling, but the oracle is still `body` on **photopea.com**. `'drawing'` is a
common substring on a third-party page — a menu label, an ad, a filename in a recent
list. Nothing asserts the layer list, the tab title, or the document dimensions. If
the skip above it is ever lifted, this passes for the wrong reason.

Masked today by the skip. The local alternative is now available: `ag-psd@^31.0.2` is
a root dependency, so the "no PSD library in `package.json`" premise that the skip
comment rests on is no longer true.

## P2 — a 100-pixel budget over 480,000 pixels, against an unpinned system Chrome

`e2e/export/visual-regression.spec.ts:86-89`, `playwright.config.ts:100`

```ts
const result = await compareScreenshots(exportedBuffer, baseline, {
  threshold: 0.01,
  maxDiffPixels: 100,
});
```

100 differing pixels is 0.021% of an 800x600 baseline. Seven of the nine formats are
lossy (JPEG, GIF, AVIF, WebP), so any Chrome, libjpeg or libavif change is a hard red
on a gate that is now blocking. `channel: 'chrome'` is the _system_ browser, and
`.github/workflows/ci.yml` installs `google-chrome-stable` with no version pin.

This was latent while the comparison was unreachable. Now that the `updateSnapshots`
gate is fixed and the comparison is real, it is the load-bearing risk on the
oracle — and the baselines are already known to be on the edge, per the P1 entry above.

Decide whether 100 px is a tolerance or a tripwire, and pin a Chrome version if it is
meant to be an oracle.

## P2 — a test title promises a contract the body does not check

`e2e/sidebar-flyout.spec.ts:192`

`test('selecting shape from flyout updates primary and patches figure', …)` — the body
asserts one `verifyPrimaryTool(page, 'shape', 'Ellipse Tool')`. Half the stated
contract is untested, and nothing in the body signals that, so the gap is not
discoverable by reading the test. Either assert the figure or rename the test.

## P3 — `select-move.spec.ts` passes thresholds identical to the defaults

`e2e/select-move.spec.ts:17-18`, called at `:85`

```ts
// Selection outline in the app appears to be cyan-ish; pass explicit thresholds instead of relying on defaults
const SELECTION_COLOR_THRESHOLDS = { redMax: 80, greenMin: 80, blueMin: 180 };
```

Those are character-for-character the constants at `canvas-helpers.ts:197-199`, which
is the point — they moved into `STROKE_ANALYSIS` and are now tripwire-pinned. Passing
them explicitly is therefore a **behavioural no-op**, and the comment claims a
protection the call site does not provide. A reader auditing for default-drift would
conclude this call is pinned. It is not; it is just silent today.

## P3 — three copies of the same structural types

`canvas-helpers.ts:7-19`, `screenshot-scale.ts:26-38`, `cdp-helpers.ts:7-19`

`BoundingBox` is declared in `canvas-helpers.ts` and again, unexported, in
`cdp-helpers.ts`; `CssBox` is the third. `CssBounds` is declared twice, `ClipOptions`
twice. They interoperate by structural typing, not aliasing, so a field added to one
will not propagate — and because `cdp-helpers.ts` declares its own private copy
rather than importing either, `export type { CssBox as BoundingBox }` does not reach
it. Import all three from one module.

## P3 — `imageBoundsToCss` maps inclusive indices to pixel centres, and says nothing

`e2e/helpers/screenshot-scale.ts:98-106`

`left`/`right`/`top`/`bottom` are inclusive pixel indices and pass through the same
function as points, so `right` lands on the **centre** of the last covered pixel and
`right - left` under-reports the covered width by one pixel. Both current consumers
want a point or a tolerant comparison, so nothing breaks today. There is no JSDoc, and
the module docstring does not mention it. Two tests freeze the convention
(`screenshot-scale.unit.test.ts:132-137,148-157`), so a future caller doing
drag-delta or area math will hit it, and a fix has two pins to move.

## P3 — `getDevicePixelRatio` is a dead export that re-invites a rejected strategy

`e2e/helpers/cdp-helpers.ts:21-23`

No spec, helper or fixture calls it; its only consumers are `cdp-helpers.spec.ts` and
the helper unit tests. It survives as a browser round-trip for an expression the tests
could inline, while `screenshot-scale.ts:5-6` declares that dividing by
`devicePixelRatio` is "deliberately not supported". Leaving it exported invites the
strategy back into a suite that deliberately removed it.

## P3 — `ico.spec.ts` runs the full export setup and discards all of it

`e2e/export/ico.spec.ts:7-8`

`setupExportTest` navigates, resolves the canvas, draws a line and encodes a data URL;
`setupIcoTest` then navigates _again_ and opens File -> New. Only `downloadDirectory` is
kept. The corrected shape is 30 lines away in the same directory —
`visual-regression.spec.ts:137-147` does only `mkdir` before calling `setupIcoTest` —
and was not applied here. Pure cost against a 60 s budget.

## P3 — 52 inlined timeout literals against one exported constant

`e2e/export/helpers.ts:48` defines `INTEGRATION_TEST_TIMEOUT_MS`; three call sites in
`e2e/export/visual-regression.spec.ts` use it. Everything else inlines the literal:
**49** occurrences of `60_000` and **2** of `90_000` across 15 spec files, plus a
`120_000` in `paint-tools.spec.ts:576` with no constant at all, plus a bare
`{ timeout: 60_000 }` in `export/helpers.ts:402`. The only place that centralises a
timeout is the export flow, which is the one place that had to.

## P3 — `saveScreenshotArtifact` has zero non-test callers

`e2e/helpers/image-comparison.ts:35-54`

Its only references in the repository are its own definition and
`e2e/helpers/__tests__/image-comparison.unit.test.ts`. The sibling
`expectCanvasToMatch` was deleted for exactly this reason; this one was left. Either
adopt it or delete it — an untested-in-anger export is a second convention the suite
does not follow.

## P3 — `check-dpr.spec.ts` is an unprovable placebo that costs a browser launch

`e2e/check-dpr.spec.ts:6`

Its only assertion is `expect(dpr).toBeGreaterThanOrEqual(1)`. The same tautology is
duplicated at `cdp-helpers.spec.ts`; the well-formed version of that idea is the
assertion beside it, and the real DPI-dependent math is already covered by
`e2e/helpers/__tests__/screenshot-scale.unit.test.ts`. Delete it.

## P3 — unanchored Tailwind class regexes

`e2e/sidebar-layout.spec.ts:18,40,51`

`toHaveClass(/w-14/)` also matches `w-14.5`, `w-140` and `min-w-14`. These pass
today, so this is fragility rather than breakage. `toHaveCSS('width', '56px')` states
the intent.

## P3 — the verbose skip blocks were never trimmed

`e2e/export/photopea.spec.ts:14-38` (25 lines, three of them whitespace-only) and
`e2e/sidebar-flyout.spec.ts:157-165`. Neither carries a tracking reference; the
nearest thing is a commit hash in prose. The "Known-skip tests" section above records
_that_ they are skipped, not that their rationale is untraceable.

## P3 — two overlapping line-clip constants, never cross-checked

`e2e/helpers/canvas-helpers.ts:38` `DEFAULT_LINE_CLIP` (260x80 at 120,120) and `:45`
`CANVAS_REDRAW_CLIP` (300x100 at 100,100). Nothing asserts that the redraw region
contains the line the assertion clip samples, so moving one can silently weaken the
other. The `buildClip` entry above explains why the two forms differ; it does not
cover this pair.

## P3 — no mobile or HiDPI project, and no touch anywhere

`playwright.config.ts:93-103` declares one project. `isMobile`, `hasTouch` and
`touchscreen` have zero occurrences under `e2e/`. `mobile-shell.spec.ts` resizes a
viewport on a desktop project, which is not the same thing.

Read the `getStrokeAnalysis` DPI entry first: enabling a 2x project without making
those thresholds DPI-relative trades a coverage gain for three new failure modes.

## P3 — `levels.spec.ts` reuses one artifact path inside `expect.poll`

`e2e/levels.spec.ts:42`

`readRedLine` polls `takeLineScreenshot(page, box, name, testInfo)` with a constant
`name`, so the same `outputDir` path is written N times and N attachments share one
name. On failure only the last frame survives — the frame least likely to be
diagnostic — and the poll pays N PNG-encode + decode round trips. Vary `name` by
attempt.

## P3 — a wall-clock timing assertion, and a duplicated `rejects.toThrow()`

`e2e/helpers/canvas-helpers.spec.ts:245-251`

`loadImageData rejects quickly on invalid input (no hang)` asserts
`Date.now()` delta `< 5000`, which makes the suite wall-clock dependent for no
coverage, and its `rejects.toThrow()` is the one the previous test already asserts.
Delete the timing assertion; keep one rejection test.

## P3 — a ±3 px selection-bounds tolerance

`e2e/helpers/canvas-helpers.spec.ts:98-101`

Accepts `left <= 13` / `right >= 87` for a `lineWidth: 3` `strokeRect` at
(10, 10, 80, 80). A 3-pixel detection error passes; a shifted or partial detection is
not caught. Tighten to the antialiasing margin the geometry actually allows.

## P3 — `test:e2e:clean` deletes the JSON reporter output

`package.json:30`, `playwright.config.ts:47`

`rm -rf test-results` touches no baseline — those live under
`e2e/export/…-spec.ts-snapshots/` — and it removes `test-results/results.json`, which
is the configured JSON reporter path. Run locally after a CI-shaped run and the
machine-readable result is gone. The misnomer is fixed (the script was renamed); the
deletion is not. `ci.yml` does not call it, so this is local-only.

## P3 — an app-source line citation that has already rotted

`e2e/helpers/toolbar-helpers.ts:236`

`// All flyouts have role="menu" (SidebarLeft.tsx line 285).` Line 285 is
`selectTool(primaryTool);`; the context-menu handler that decides whether a flyout
opens is at `:287-291`. The citation cannot be checked from inside this repository and
it is wrong here — which is the evidence for deleting it rather than refreshing it. The
other citation in the file (`:167,184`) has already been replaced with prose, and that
is the shape to use.

---

## Checked here and rejected

Recorded so the same ground is not re-audited. Each was re-derived against this tree
and **is not a defect here**:

- **A `layers.spec.ts` assertion reads text the app does not contain.** It does
  contain it. `src/util/constants.ts:28` is `REORDER_ACTION = 'reorder layers'`,
  rendered through a `capitalize` class, and Playwright's string text matching is
  case-insensitive. A case-sensitive `grep` for the capitalised form is what produced
  the false report.
- **The workspace-canvas helper resolves a union and detonates the suite when the
  testid lands.** `canvas-helpers.ts:330` is testid-only, no `.or()`, and
  `resolveFakeMatches` returns the whole match list so the fake can model a union.
  All three parts landed together.
- **CI-parallelism has no per-test isolation against a shared app.** Playwright's
  default `page`/`context` fixtures give every test a fresh browser context; the app's
  state is client-side, and there is no `storageState`, no `beforeAll` and no
  `newContext` anywhere under `e2e/`. The config caps workers at 1 locally for
  readability, and `webServer` is a stateless Vite dev server shared by every worker.
- **52 timeout literals / 10 unused imports / 8 red CDP assertions / 9 orphaned
  baselines.** The first two are fixed (`noUnusedLocals` and `noUnusedParameters` are
  on, the count is 0); the CDP assertions now derive their scale; the orphans are
  recorded in the P3 entry above.
