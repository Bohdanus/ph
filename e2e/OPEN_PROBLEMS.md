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
| `e2e/sidebar-keyboard.spec.ts:69, 80` | 0–2, ~42% of headless runs              | root-caused to an rAF focus race, then awaited |
| `e2e/levels.spec.ts:203, 274`         | 2, both modes                           | canvas found by test id, not document order    |

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
(`sidebar-keyboard.spec.ts:80`) turned out to be a real race that fires in headless
runs with no operator input at all; the mechanism is recorded at
`sidebar-keyboard.spec.ts:5-10`. The hazard is
reported as recurring across this project's test work generally, which is why the
default is structural rather than procedural: it removes the failure class instead
of relying on everyone to remember.

Headless is also simply better for this suite, and that part is measured. The
failure sets are disjoint per mode and deterministic across repeats:

| specs                                                                                         | headed | headless |
| --------------------------------------------------------------------------------------------- | ------ | -------- |
| CDP, deriving expected size from `getDevicePixelRatio()` (`:128` `:142` `:157` `:179` `:208`) | 5 fail | pass     |
| CDP, explicit `deviceScaleFactor: 2` block (`:272` `:287`)                                    | pass   | 2 fail   |

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

`e2e/helpers/canvas-helpers.ts:505-522`

A spec must not drift into the assumption that `drawLine`'s arguments are
document coordinates. They are not. `drawLine` computes
`{ x: box.x + startX, y: box.y + startY }` and nothing else, while the document it
addresses is **contained** in that box (`object-contain`,
`src/components/Main/Main.tsx:242-246`): the CSS origin of document `(0,0)` is

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

`e2e/helpers/screenshot-scale.ts:103-125`, `e2e/helpers/cdp-helpers.ts:45-64`

The hazard, for whoever refactors this next. `Locator.boundingBox()` measures against
the VIEWPORT and goes negative the moment the page scrolls, and `page.mouse` shares
that space. But `page.screenshot({ clip })` and CDP `Page.captureScreenshot`, which
this suite calls directly, take their clip against the DOCUMENT origin. The two take
**opposite** conventions from each other for the same numbers: Playwright takes a
viewport clip and adds the scroll offset itself, so converting there moves the clip
the wrong way; raw CDP takes a page clip, so converting nothing moves the capture away
from the region the caller measured. Neither direction throws. A clip derived from a
scrolled `boundingBox()` and handed to CDP untranslated either returns the wrong region
or lands off-canvas, where the failure surfaces as `Clipped area is either empty or
outside the resulting image` and reads as a capture bug rather than a coordinate bug.

**This app no longer scrolls, so the numbers in the original version of this entry no
longer describe it.** An earlier version opened "The app is taller than Playwright's
720px window, so the window scrolls… a canvas scrolled 440px down reports `y: -340`
where it reported `y: 100` before" — measured, that was true of a layout that no longer
exists. The shell is now exactly viewport-tall at every size in
`e2e/no-document-overflow.spec.ts`'s matrix, so `getPageScroll` returns `{0, 0}`,
`boundingBox()` is not negative, and `preservingScroll` has nothing to undo. The
hazard above is kept because it is about the two conventions disagreeing, which is a
property of Playwright and CDP rather than of this app, and the same class of bug
returns the moment anything is allowed to scroll the document again.

**The helper-level fix is done, and it is recorded here so a refactor does not
undo it.** The conversion is the pure function `viewportRectToPageRect`
(`screenshot-scale.ts:126-133`), it is applied **at the CDP site only**
(`cdp-helpers.ts:56-64`) and not in the callers, the scroll offset is read per
capture rather than cached (`getPageScroll`, `canvas-helpers.ts:356` — the offset is
a live read because a page that scrolls can scroll again between captures, whatever
currently makes it scroll), and the rule is unit-tested for a non-zero offset at
`e2e/helpers/__tests__/screenshot-scale.unit.test.ts:404-427`. That unit test is the
load-bearing part now: it is the only coverage of the non-zero-offset case, since the
app cannot produce one.

What is left is a rule for new code: a spec that mixes `boundingBox()` with a CDP
capture must not assume the two agree, and must not introduce a second conversion
somewhere that already has one.

## P2 — an empty CDP capture is reported as a successful capture

`e2e/helpers/cdp-helpers.ts:71`

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
file` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:403`. A fix removes that
pin in the same change.

## P2 — a failing detach replaces the capture error and destroys the cause

`e2e/helpers/cdp-helpers.ts:75-77`

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
in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:434`. A fix removes that pin in
the same change.

## P2 — a CDP response without `data` surfaces as a raw `TypeError` from `Buffer`

`e2e/helpers/cdp-helpers.ts:67, 71`

A `Page.captureScreenshot` response that omits `data` reaches
`Buffer.from(undefined, 'base64')`, which throws `The first argument must be of
type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like
Object. Received undefined` (Node 24). The message names neither CDP, nor this
helper, nor the test, so the reader has to find the call site before they can tell
what failed. The sibling helper in the same directory checks its inputs and names
itself (`canvas-helpers.ts:392-395`); this one does not.

Fix: validate the response before decoding — `typeof data === 'string'`, and
non-empty — with an error that names `captureCanvasScreenshot` and the CDP request
it came from. Merge this with the length check above rather than adding a second
guard on the same two lines.

Pinned by `rejects with a raw TypeError when the CDP response omits data, and
detaches` in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts:385`. A fix removes that
pin in the same change.

## P3 — zero-sized image yields `NaN` edges

`screenshotBoundsToCss` (`e2e/helpers/canvas-helpers.ts:31`) and
`imagePointToCss` / `cssPointToImage` (`e2e/helpers/screenshot-scale.ts`)
divide by the image or box dimension, so a zero-sized input produces `NaN` or
`Infinity` instead of throwing. Deliberate — the modules stay branch-free and
total, and it is pinned — but a `NaN` coordinate reaching `page.mouse.click` is
opaque. Callers must reject empty images first.

## P3 — transparent pixels weighted as fully opaque (low confidence)

`e2e/helpers/canvas-helpers.ts:409` and `:706` **[pinned]**

`dominantRed` and `getColorAtPoint` skip only `alpha === 0`, so a nearly
invisible pixel counts at full weight. A weighting concern rather than a
correctness bug, and the only helper that reports the colour back to the caller.
They are the two places the distinction bites hardest, because the other two
`alpha === 0` filters, in `hasDarkPixels` (`:434`) and `hasRedPixels` (`:454`),
answer a yes/no question where one nearly-invisible pixel is the same as one
opaque one. The other half of the file, `getDarkPixelBounds` (`:602`) and
`getSelectionBounds` (`:661`), filters on `a !== 0` instead — a different question
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

`e2e/helpers/cdp-helpers.ts:19-20`

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
(`:517`) and `writes outside the output directory when the name traverses out of it`
(`:531`) in `e2e/helpers/__tests__/cdp-helpers.unit.test.ts`. A fix removes both
pins in the same change; the first one's own comment names sanitisation as the
shape a fix must not take.

## P3 — the `outputDir` guard in `captureCanvasScreenshot` has no test

`e2e/helpers/cdp-helpers.ts:15-18`

The guard exists and is the same shape as `canvas-helpers.ts:392-395`, but it is
the module's only uncovered statement: `npm run test:e2e:unit:coverage` reports
`cdp-helpers.ts` at 93.75% statements and 93.33% lines with the `throw` — now line
17 — uncovered, against 100% of its functions. The sibling guard is pinned
(`e2e/helpers/__tests__/canvas-interaction.unit.test.ts:205-229`), so nothing fails
if this one is deleted, and the raw V8 failure it exists to replace
(`The "path" argument must be of type string. Received undefined`) returns with it.

Fix: add the two cases to `e2e/helpers/__tests__/cdp-helpers.unit.test.ts` — a
`TestInfo` with no `outputDir` and one with an empty string — asserting the helper's
own message and that no CDP session was opened. `createTestInfoMock()`
(`e2e/helpers/__tests__/canvas-helpers.fixtures.ts:268`) already makes `outputDir`
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

Workaround used in `e2e/erase-fill-eyedropper.spec.ts:376`: assert the attribute and
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

- `e2e/export/photopea.spec.ts:12` — `exports to PSD and verifies in Photopea`.
  Round-trips through the external photopea.com, so it cannot run offline or in
  a sandboxed CI.
- `e2e/sidebar-flyout.spec.ts:171` — `right-click does not open flyout for
single-tool groups`.

## Verified and still unverified

**Verified by running the suite against a real browser:**

- The 7 comparison formats matched the committed baselines, before the toolbar
  grew. `e2e/export/visual-regression.spec.ts` passed, so every baseline the spec
  reads decoded and matched its committed pixels on this host. The ICO spec passes
  in-browser against the source canvas. They no longer match; the one layout change
  that moved them and the three ways out are recorded under **Checked here and
  rejected** below, which is where a re-derived claim about them belongs.

  **This was not true until the `updateSnapshots` guard was fixed** — see the
  transferred-findings section, whose deleted P1 recorded it. The check that produced
  this claim was `if (testInfo.config.updateSnapshots)`,
  and Playwright's default for that option is the string `'missing'`, so the branch was
  always taken: every run re-recorded the baseline and returned before
  `compareScreenshots`. The comparison below it was unreachable, so "matches the
  committed baselines" was never actually established by any run. It is now, and it was
  established by mutation testing rather than by a green bar: a corrupted baseline fails
  with a sharp decode error, and a valid-but-different baseline fails with
  `Visual mismatch for PNG: 480000 diff pixels (ratio: 1.0000)`. Before the fix both
  were silently overwritten and the spec passed.

- The CDP failing set used to be deterministic per browser mode with disjoint sets:
  headed failed `:128 :142 :157 :179 :208`, headless failed `:272 :287`,
  reproduced identically across repeats. Both sets are now empty, and the new
  assertions are mode-independent by construction rather than by observation.
- `levels.spec.ts:203` and `:274` used to fail in both modes, 2/2 each, which is
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

`e2e/helpers/canvas-helpers.ts:48-52`

**What exists.** `documentToCanvasOffset` maps a DOCUMENT point into the canvas box by reproducing
the app's contain fit, and the export fixture uses it, so `e2e/export/visual-regression.spec.ts` no
longer depends on where the app put the letterbox. That is the right idea and it works.

**What does not.** The idea reached exactly one caller. `LINE_START_X`/`LINE_START_Y`/`LINE_END_X`/
`LINE_END_Y` at `e2e/helpers/canvas-helpers.ts:48-52` are still "relative to the canvas box", and nine
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

The ICO export path is still canvas-relative as well: `ICON_STROKE` at `e2e/export/helpers.ts:512`
is a set of box offsets, used at `:541` and `:543`.

**Why it matters, stated as a measurement rather than a worry.** These are not merely fragile, they
are wrong in a specific direction. A `box.x + 150` gesture is a _window_-relative point: change the
window and the point the mouse visits is a different point in the document. The document-space
mapping has to be inverted before such a literal is meaningful, and it is not. So the suite still
asserts against whatever geometry the current layout happens to produce, and a layout change
silently changes what is being tested rather than failing.

**Five assertions that fail outright on a 1px rail change**, all in `e2e/responsive-shell.spec.ts`:
`:186` expects the collapsed rail at 56, `:207` and `:281` expect the right panel at 250, `:221`
expects the panel's own width delta at 250, and `:296` expects the two-column rail at 108. Those are
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

> **Re-verification baseline, restated.** Every line-numbered citation in this file —
> above and below this line — was re-derived against this tree as it stands after the
> e2e campaign branch merged into main, by content match and not by offset arithmetic,
> and the ones the merge moved were corrected. That is the whole authority behind the
> numbers here: they describe one tree, and the next merge moves them again, so
> re-derive a `file:NNN` from the claim before acting on it.

---

# Transferred findings — external review of the pre-migration tree

This section recorded 33 findings from a read-only review of the pre-migration tree at
`/Users/bkalynovskyi/ps-playwright`, each one re-derived against this tree before it was
written down. **Thirty-one are fixed and their entries deleted**, which is the only thing
worth reading here: if you are looking for one of them, it is gone, and the code is the
record of what it was. The commit that carried them in is `4d47904`; the one that fixed
them is `bfce8f3`, and it is on `main`. Two were not fully closable and are re-recorded
below.

**Three `## P…` entries appear below this line, and only two of them are those two.** The
third, `P3 — re-verification: the tablet band's option-row floor…`, was filed by a later
pass against this tree and is not one of the 33. It is here rather than above the section
because it was raised while auditing the fixes, and moving it would break the audit trail
for no gain — but a reader counting the entries to work out which findings survived will
count three, and the two-line arithmetic above is the one to trust.

The source repository is frozen at `78be956` and its own ledger is not maintained, so that
review has no other home. The list of what it claimed and what turned out to be already
fixed here is at the end of this section, under **Checked here and rejected** — that part is
still worth having.

---

## P2 — the visual baselines record no Chrome version, and a pin cannot be invented

`e2e/export/visual-regression.spec.ts`, `.github/workflows/ci.yml`

`compareScreenshots` is called with `threshold: 0.01` and `maxDiffPixels: 100` over an
800x600 baseline — 100 pixels is 0.021%, and four of the seven compared formats are lossy
(JPEG, WebP, GIF, AVIF). `channel: 'chrome'` is the **system** browser and CI installs
`google-chrome-stable` with no version, so any encoder change is a hard red on a blocking
gate.

The tolerance question has been answered: the 100-pixel budget is a **tripwire, not a
tolerance**, and the argument is written out at the call site so it is not widened later to
make a red go green. `browser.version()` is now in the failure message, so a red run can
answer "did the encoder change?" instead of leaving it to be guessed.

What is still open is the half that cannot be closed from inside a code change:
**nothing in this repository records which Chrome produced the committed baselines.** No
provenance file, no version in `e2e/README.md`, nothing in the commit that added them.
Pinning `google-chrome-stable` to a version now would be a guess, and a pin that does not
match the recording version turns a green gate red for a reason nothing in the tree can
diagnose — strictly worse than the drift risk it pretends to remove.

Closing it is an operator decision and needs a browser: record the version that produced
the current baselines, write it down next to them, then pin CI to it. **Re-recording the
baselines under a known version is the only way to establish the record, and that is not a
change an agent makes.**

## P3 — no mobile or HiDPI project, and no touch anywhere

`playwright.config.ts` declares one project. `isMobile`, `hasTouch` and `touchscreen` have
zero occurrences under `e2e/`. `mobile-shell.spec.ts` resizes a viewport on a desktop
project, which is not the same thing — no touch, no mobile UA, no HiDPI.

This was raised against the review with a precondition attached: enabling a 2x project
before `getStrokeAnalysis` was DPI-relative "trades a coverage gain for three new failure
modes". **That precondition is now met for the stroke classifier** — its thresholds are
CSS-pixel counts, the captured region is a required argument, and no call site can be
DPI-blind. Two point-sampling specs that were in exactly that class (`levels.spec.ts`,
`adjustments.spec.ts`) were CSS-pixel samples over a device-scaled capture, and are fixed
here.

**The suite as a whole is still not 2x-clean, and an earlier version of this entry
claimed it was.** Measured by running the whole suite with `projects[].use.deviceScaleFactor`
forced to 2 (the project-level `use` overrides the top-level one, so setting it at the top
does nothing — verified by printing `window.devicePixelRatio`): **256 pass, 6 fail, 2
skipped.** The failures are

- `e2e/helpers/cdp-helpers.spec.ts:235` — the expected one. `playwright.config.ts` already
  records that a `deviceScaleFactor: 2` block fails differently from the default mode, and
  this is that block.
- `e2e/helpers/color-helpers.spec.ts:18` — the swatch `toHaveCSS` is compared against a
  literal CSS colour on a 2x surface.
- `e2e/erase-fill-eyedropper.spec.ts:653` — an eyedropper block average over a fixed-size
  sample, in image pixels.
- `e2e/keyboard-shortcuts.spec.ts:164` and `e2e/responsive-shell.spec.ts:239` (two tests).

So the honest statement is: the classifier and the specs this change touched are now
resolution-independent, and four other specs are not. What remains is a coverage decision
rather than a single defect, which is why it is still open: adding a project multiplies
every run's cost, and the mobile/HiDPI specs this would exercise do not exist yet. It is
not a one-line change to `playwright.config.ts`.

## P3 — re-verification: the tablet band's option-row floor is no longer the panel's measured width

`e2e/responsive-shell.spec.ts:238-256`

**The 4 px shortfall this entry used to record is no longer asserted by the suite, and
the derivation the old entry named as "the next step" has since been done.** The two
"makes the … option panel horizontally scrollable rather than unreachable" tests no
longer pin each panel to its own measured width. They share one derived floor:

```
const MIN_PANEL_WIDTH = TABLET.width + 100;   // :237 — 1000 at the 900px tablet band
…
expect(metrics.overflowX, 'the tablet band must scroll the option row').toBe('auto');
expect(
  metrics.scrollWidth,
  'the option row must be wider than the window, with room to spare'
).toBeGreaterThanOrEqual(MIN_PANEL_WIDTH);   // :255
```

The per-panel floors this replaced were 1089 (Shape) and 1036 (Horizontal Type), and
both panels landed 4 px short of them deterministically — 2/2 in isolation, not only in
a full run, so it was never the `vmThreads` pool flake the two suites under
`scripts/__tests__/` usually are. The reasoning is now written out at
`e2e/responsive-shell.spec.ts:224-236`: two floors moving by the same 4 px together is
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

Nothing else it raised is in question: the row still has to overflow its own box (`:256`)
and still has to scroll to its end (`:266-267`), and both are asserted. The decision
between "widen the row" and "the floor was derived correctly all along" needs someone who
can say which, so this entry stays open rather than being deleted on a green run.

---

## P2 — the mobile bottom bar scrolls 615px with no affordance, and nothing tests it

`src/components/Mobile/MobileBottomBar.tsx`, `e2e/no-document-overflow.spec.ts`

`nav[data-testid="mobile-bottom-bar"]` is `overflow-x-auto` and carries every
`mobileToolGroups` entry in one row — 18 focusable tiles, 16 groups plus Options and
Layers, separated by 5 dividers. Measured, it overflows its own width by **615px** at a
744×1133 viewport and by **969px** at 390×844, which is the reference phone size the rest
of the mobile suite already uses. It now carries `scrollbar-none`, so the only cue that
most of those tiles are off-screen is gone. A user with a mouse and no trackpad has
nothing left to drag: the bar is `position: fixed`, so the document behind it does not
scroll either.

This is the same trade the left tool rail makes, and the rail's version is deliberate and
pinned — the rail scrolls and stays reachable by wheel, arrows and touch. The difference
is magnitude. The rail overflows by 71px at iPad 10.2" portrait (810×1080) and 5px at iPad
mini landscape (1133×744); this bar overflows by 615px at the same width and by 969px on
a phone. A 5px overflow hides a cue for something already within reach of a scroll; a
969px one hides most of the tool list.

**The CSS is pinned; the overflow is not.** `no-document-overflow.spec.ts` asserts this
bar is a scroll container with `scrollbar-width: none`, which is a statement about the
stylesheet and would still pass if the group list grew or shrank by a factor of ten. No
test reads the bar's `scrollWidth` against its `clientWidth`.

The open question is a product one, not a defect report: a tool bar with 969px of hidden
overflow needs either a visible scroll affordance or a different layout — the tool sheet
already exists as `MobileToolSheet`, and wrapping is the other obvious answer. What keeps
it undecided is coverage, recorded in the `P3 — no mobile or HiDPI project, and no touch
anywhere` entry below: `e2e/` has zero `hasTouch`, zero `isMobile` and zero `touchscreen`.
`mobile-shell.spec.ts` does run at a device width (it sets `test.use({ viewport: { width:
390, height: 844 } })`) and it drives the bar with `page.mouse`, so what is missing is
touch emulation and a reachability assertion — not a device width, which it already has.

**Exact remaining verification:** decide the affordance, implement it, and add a
reachability test that scrolls the bar to its last tile and asserts that tile is inside
the viewport — the same shape as the rail's swatch test in
`e2e/no-document-overflow.spec.ts`.

## Checked here and rejected

Recorded so the same ground is not re-audited. Each was re-derived against this tree
and **is not a defect here**:

- **A `layers.spec.ts` assertion reads text the app does not contain.** It does
  contain it. `src/util/constants.ts:28` is `REORDER_ACTION = 'reorder layers'`,
  rendered through a `capitalize` class, and Playwright's string text matching is
  case-insensitive. A case-sensitive `grep` for the capitalised form is what produced
  the false report.
- **The workspace-canvas helper resolves a union and detonates the suite when the
  testid lands.** `canvas-helpers.ts:373` is testid-only, no `.or()`, and
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
