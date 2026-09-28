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

On the default (headless) configuration the only failures are the export
baselines and one `pen-types` case, and they share the single layout cause
recorded in the first entry below — not a defect in the app, and not a defect in
the specs. Everything else is green, and that has been stable across repeated
full runs.

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

## P1 — the taller toolbar overflows the viewport, and the recorded baselines encode the old layout

**This is a recording decision, not a defect, and it is left failing on purpose.**
`AGENTS.md` forbids an agent from re-recording a visual baseline or weakening a
gate to get a suite green, so the operator has to choose. Nothing here is being
fixed by an agent, and no assertion was changed to make room for the new layout.

**What fails.** `e2e/export/visual-regression.spec.ts:37`, once per format, for
the seven `comparePixels` formats in `e2e/export/helpers.ts:59-66`. And
`e2e/pen-types.spec.ts:78`, the parameterized test body, in its solid-pen case
(`y: 150` at `:44`).

**One cause.** The left toolbar gained tools, which made the toolbar taller,
which made the app taller than Playwright's 1280x720 viewport. Measured on this
branch, the workspace canvas box height went from 840 to 1040 and the page height
from 977 to 1177. `screenshot-scale.ts:53` and `cdp-helpers.ts:60` already record
the post-branch page height in-tree, so the two agree.

The document is `object-contain` (`src/components/Main/Main.tsx:241`), so the
scale is width-limited and **did not change** — the document's rendered size is
the same before and after. What moved is its vertical centre, by the difference
in the letterbox: the document's top edge in box-relative coordinates is
`(boxHeight - 600 * scale) / 2`, which is 54.75 at a 840 box and 154.75 at a 1040
box, so the document moved down 100px inside the box while its scale held.

**Why that breaks the export baselines.** The export fixture draws in BOX
coordinates, not document coordinates: `setupExportTest` takes
`canvas.boundingBox()` and calls `drawLine(page, box, LINE_START_X, LINE_START_Y, …)`
(`e2e/export/helpers.ts:103-109`) with `LINE_START_Y = 150`
(`e2e/helpers/canvas-helpers.ts:49`). `drawLine` adds the box origin and nothing
else (`canvas-helpers.ts:435-436`), so the app maps that through the letterbox
into document space, and the export — which is the document, 800x600, as the
committed baselines confirm — carries the line wherever the layout put it.
Pre-branch the line landed at document row 78; it now lands at row 0 and is
clipped. Every one of the seven baselines encodes the old position, and
`compareScreenshots` compares against a budget of `DEFAULT_MAX_DIFF_PIXELS = 100`
pixels (`e2e/helpers/image-comparison.ts:28`, applied at `:95`). The ratio cap
beside it is 1% of 800x600 (`image-comparison.ts:29`) and is not the binding
constraint.

**Why `pen-types` misreads rather than merely shifting.** The solid case clips
`y - 50` to `y + 70` (`e2e/pen-types.spec.ts:93-96`, with `CLIP_Y_OFFSET = -50`
at `:18`), so the clip's top 55 box-relative rows now sit ABOVE the document's top
edge at 154.75 and land on the workspace checkerboard (`Main.tsx:226-227`,
`#f3f3f3` at `src/index.scss:68-72`). `getStrokeAnalysis` counts a pixel that is
neither dark nor near-white, bright enough and unsaturated enough, as spray
(`canvas-helpers.ts:720-724`, thresholds at `:154-155`) — and 243/243/243 is
exactly that: not near-white, luminance 243 over 200, saturation 0 under 30. So
`top` is driven to the clip's top edge, `verticalSpread` passes
`SPRAY_VERTICAL_SPREAD_THRESHOLD` (30, `:158`), and `type` is `'spray'` (`:756`).
The test then asserts the wrong pen type at `:110`.

**Why the pre-branch layout was itself wrong, which is the part that reframes
this.** A 720px viewport with a 977px page and an 840px canvas box is 257px of
overflow, and the recorded baselines encode the 840. This is not a branch that
broke a good layout; it is a branch that made a pre-existing overflow visible.
The mechanism is in the grid, and it is not a bug in the toolbar:

- The page is viewport-pinned: `html, body, #root { height: 100% }`
  (`src/index.scss:46-49`) and the shell is `grid h-full grid-rows-[auto_auto_1fr_auto]`
  (`src/App.tsx:40`).
- A `1fr` track is `minmax(auto, 1fr)`, so its floor is the largest min-content
  contribution of the items in it.
- `<main>` already declares `overflow-y-auto` (`src/components/Main/Main.tsx:296`),
  which zeroes its automatic minimum, so it contributes nothing to that floor.
- The left `<aside>` declares no `overflow` (`src/components/SidebarLeft/SidebarLeft.tsx:319-323`),
  so its min-content height is the whole toolbar, that becomes the row floor, and
  the `h-full` canvas at `Main.tsx:231,241` is dragged up with it.

**Three options, and they are not equivalent.**

1. **Keep the overflow.** Nothing in the suite changes and the baselines stay
   valid, at the cost of an eleven-tool toolbar that permanently overflows a 720px
   viewport. This is the status quo before the toolbar grew.
2. **Fix the layout and re-record.** Add `min-h-0 overflow-y-auto` to the
   `<aside>`, which removes the overflow entirely and fixes `pen-types`. The
   canvas box then lands at 583 rather than 840, so all seven baselines change
   and must be re-recorded once. The diff is larger than the current failure
   (4283 against a 100-pixel budget), which is a re-record, not a repair.
3. **Decouple the fixture from layout.** Make the export fixture draw in DOCUMENT
   space — compute the contain transform and offset, the same arithmetic the
   letterbox already implies, and pass document coordinates through it — so the
   baseline stops depending on the toolbar's height at all. This is the only
   option under which a future toolbar change cannot invalidate the export
   baselines, and it is the largest change of the three.

**Fix.** Operator's call, options above. If option 3, the transformation belongs in
one helper next to `drawLine` rather than in the fixture, and `drawLine`'s own
contain-scale gap (the next entry) is the same arithmetic and should be fixed in
the same change.

**What has been resolved.** The overflow itself is fixed, in two parts, and both are
measured rather than assumed (Playwright 1280x720):

| layout                                                   | canvas box  | page height | overflow  |
| -------------------------------------------------------- | ----------- | ----------- | --------- |
| one column, before                                       | 974x1040    | 1177        | **457px** |
| two columns only                                         | 922x612     | 749         | 29px      |
| two columns + `min-h-0 overflow-y-auto` on the `<aside>` | 922x**583** | **720**     | **0**     |
| one column + the same                                    | 974x**583** | **720**     | **0**     |

1. **The toolbar defaults to two columns** (`src/components/SidebarLeft/SidebarLeft.tsx:32`).
   That alone took the overflow from 457px to 29px.
2. **The `<aside>` declares `min-h-0 overflow-y-auto`**
   (`src/components/SidebarLeft/SidebarLeft.tsx:324`). This is the actual fix and it is why the
   toolbar stopped dictating the layout at all: the aside's min-content height was becoming the
   grid row floor, and scrolling inside its own column means the row is bounded by `<main>` and
   the toolbar-right instead. The canvas is now **583px tall in BOTH layouts**, so the number of
   tools installed no longer moves it.
   `e2e/sidebar-layout.spec.ts` pins that the default page does not scroll, so this cannot
   silently regress.
3. **`e2e/pen-types.spec.ts` passes.** It was failing for this reason and now is not, because that
   spec already aimed in document space and was never layout-dependent.
4. **The export fixture no longer aims in box space.** `setupExportTest` maps the stroke through
   the `object-contain` letterbox with `documentToBoxPoint`
   (`e2e/helpers/canvas-helpers.ts`) and aims at document (118, 78)-(291, 78), read off the
   recorded `drawing.png` (800x600, stroke on rows 73-82, columns 118-291) rather than assumed.
   The redraw poll is aimed the same way, so it cannot time out because the line drifted out of a
   box-relative window.

**What still needs the operator, and it is now only a re-record.** The canvas box is 583px tall
where the seven baselines were recorded at 840px, so the recorded pixels are stale no matter how
the fixture is written: the export the fixture now produces is correct and layout-independent, but
it is not the export that was recorded. `--update-snapshots` ONCE is the fix, and it is only worth
doing now — before it, any sidebar change would have invalidated them again, which is exactly what
happened twice. That is the operator's call under `AGENTS.md` and is not taken here.

**Do not** fix the remainder by raising `DEFAULT_MAX_DIFF_PIXELS`, or by nudging the two document
coordinates until the count reaches zero. The second fits a constant to the old layout and would
be wrong the moment the box changes again.

## P2 — `drawLine` applies no contain scale, so its arguments are not document coordinates

`e2e/helpers/canvas-helpers.ts:426-436`

A spec must not drift into the assumption that `drawLine`'s arguments are
document coordinates. They are not. `drawLine` computes
`{ x: box.x + startX, y: box.y + startY }` and nothing else, while the document it
addresses is **contained** in that box (`object-contain`,
`src/components/Main/Main.tsx:241`): the CSS origin of document `(0,0)` is

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
capture rather than cached (`getPageScroll`, `canvas-helpers.ts:207-209`, because
the window scrolls between captures — `clickToolButton` alone scrolls 440px, which
is what `preservingScroll` exists to undo, `toolbar-helpers.ts:117-121,128,150`),
and the rule is unit-tested for a non-zero offset at
`e2e/helpers/__tests__/screenshot-scale.unit.test.ts:306-323`.

What is left is a rule for new code: a spec that mixes `boundingBox()` with a CDP
capture must not assume the two agree, and must not introduce a second conversion
somewhere that already has one.

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
`src/components/ToolbarsRight/Eraser/__tests__/Eraser.test.tsx:89` asserts
`expect(options[0]).toBeDisabled()` with `@testing-library/jest-dom` and passes,
because that matcher reads the DOM property directly and has no retarget step. A
jsdom pass is therefore not evidence that the browser assertion works.

Workaround used in `e2e/erase-fill-eyedropper.spec.ts:326`: assert the attribute and
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
