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
command. The latest recorded full headless run, `2026-10-08T05-48-57-832Z-32316`,
ran on this macOS arm64 machine and reported `469 passed, 0 failed, 3 skipped` in
7.2 minutes. This is one machine's observation, not a new baseline.

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

## P2 — `drawLine` applies no contain scale, so its arguments are not document coordinates

`e2e/helpers/canvas-helpers.ts` — `drawLine()`

A spec must not drift into the assumption that `drawLine`'s arguments are
document coordinates. They are not. `drawLine` computes
`{ x: box.x + startX, y: box.y + startY }` and nothing else, while the document it
addresses is **contained** in that box (`object-contain` on the `workspace-canvas`
element in `src/components/Main/Main.tsx`): the CSS origin of document `(0,0)` is

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

`e2e/helpers/screenshot-scale.ts` — `viewportRectToPageRect()`, `e2e/helpers/cdp-helpers.ts` — `captureCanvasScreenshot()`

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
undo it.** The conversion is the pure function `viewportRectToPageRect()`
(`screenshot-scale.ts`), it is applied **at the CDP site only** — inside
`captureCanvasScreenshot()` in `cdp-helpers.ts`, not in the callers — the scroll
offset is read per capture rather than cached (`getPageScroll()` in
`canvas-helpers.ts` — the offset is a live read because a page that scrolls can
scroll again between captures, whatever currently makes it scroll), and the rule is
unit-tested for a non-zero offset by `describe('viewportRectToPageRect')` in
`e2e/helpers/__tests__/screenshot-scale.unit.test.ts`. That unit test is the
load-bearing part now: it is the only coverage of the non-zero-offset case, since the
app cannot produce one.

What is left is a rule for new code: a spec that mixes `boundingBox()` with a CDP
capture must not assume the two agree, and must not introduce a second conversion
somewhere that already has one.

## P3 — zero-sized image yields `NaN` edges

`screenshotBoundsToCss` (`e2e/helpers/canvas-helpers.ts`) and
`imagePointToCss` / `cssPointToImage` (`e2e/helpers/screenshot-scale.ts`)
divide by the image or box dimension, so a zero-sized input produces `NaN` or
`Infinity` instead of throwing. Deliberate — the modules stay branch-free and
total, and it is pinned — but a `NaN` coordinate reaching `page.mouse.click` is
opaque. Callers must reject empty images first.

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

## P2 — the letterbox is still read as ink by two predicates and by two of the four cell colours

`e2e/helpers/canvas-helpers.ts` — `hasDarkPixels()`, `getDarkPixelBounds()` and `isLetterboxCell()`

The workspace canvas sits on a 20px checkerboard chosen from the resolved theme:
`#f3f3f3` over `#fff` for light and `#121212` over `#000` for dark
(`.chessboard-light` and `.chessboard-dark` in `src/index.scss`, switched by `renderContent()`'s
workspace-canvas `className` in `src/components/Main/Main.tsx`). The document is contained inside it
with a centred letterbox, so a clip that is not derived from the contain fit can straddle that
checkerboard.

`isLetterboxCell` excludes the two exact RGB triples `LETTERBOX_LIGHT_CELL` and
`LETTERBOX_DARK_CELL`, and it is applied inside `getStrokeAnalysis` only. Two things
remain:

1. **The exclusion is two colours, and the checkerboard is four.** `#000` gaps and the
   anti-aliased cell edges between the two cells are still classified as ink, so a
   `getStrokeAnalysis` clip straddling the dark letterbox can still report segments and
   a vertical spread it did not draw.
2. **`hasDarkPixels` and `getDarkPixelBounds` are not letterbox-aware at all.** Under
   the dark theme their threshold is satisfied by `#121212` and `#000` alone, so a wait
   on either can be satisfied by a clip containing no stroke.

**This is LATENT today, and one declaration is the only thing making it so.**
The top-level `use` block's `colorScheme: 'light'` in `playwright.config.ts` is that declaration, and
its value is Playwright's own default, so every currently-green test relies on a precondition this
file states and nothing enforces. Remove that line, or write a spec that pins
`colorScheme: 'dark'` for itself, and the wrong-pass returns with no other file
noticing.

Pinned by the `#000`-wash case
`it('reads a pure #000 capture as ink, so the dark theme's gaps are the residual it leaves')`
in `e2e/helpers/__tests__/canvas-stroke-analysis.unit.test.ts`, which asserts that a
full black capture classifies as `{type: 'spray'}` on purpose. A fix removes that pin
in the same change.

Fix: apply the same cell-colour exclusion inside `hasDarkPixels` and
`getDarkPixelBounds` that `getStrokeAnalysis` already applies, and widen it from two
exact triples to the cell geometry so the anti-aliased edges and the `#000` gaps are
covered too. Add a dark-theme case that pins the direction this depends on, so the
latent wrong-pass has a tripwire of its own rather than resting on a config default.

## P3 — 10 orphaned committed baselines (2.1 MB)

`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/`

The directory holds 17 files. Seven are read — the formats whose `verification` is
`browser-pixels` in `e2e/export/helpers.ts`, each read through
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

## P2 — `toBeDisabled()` on an `<option>` is retargeted to its `<select>` and always reports enabled

`@playwright/test` 1.63.0, `elementState('disabled')` → `retarget(node, 'follow-label')`

Every options bar in this repository wraps its own control in a `<label>`
(the `<label htmlFor="eraser-mode">` in
`src/components/ToolbarsRight/Eraser/Eraser.tsx` and every sibling bar), so the
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
`it('offers the three Photoshop modes, all of them selectable')` in
`src/components/ToolbarsRight/Eraser/__tests__/Eraser.test.tsx` asserts
`expect(options[0]).toBeDisabled()` with `@testing-library/jest-dom` and passes,
because that matcher reads the DOM property directly and has no retarget step. A
jsdom pass is therefore not evidence that the browser assertion works.

Workaround used by `test('the eraser mode select offers all three Photoshop modes, and the
select is live')` in `e2e/erase-fill-eyedropper.spec.ts`: assert the attribute and
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

## P2 — a CDP capture intermittently returns a screenshot of a page 87px shorter than the one measured

`e2e/helpers/cdp-helpers.ts`

**Signature.** `captureCanvasScreenshot` returns a plausible image of a page that is not the one
the caller measured. In a 700px window, `window.innerHeight` reported 700 before the call and 613
after; in a 900px window, 900 before and 813 after. **The same 87px both times**, with the capture
the only thing between the two readings. The box before was 844x563 and after 844x476 — width and
origin unchanged, height alone. The image looks correct, so nothing downstream can tell; the
caller maps a stroke it measured under the old layout through the new one and the mismatch reads
as a geometry bug in the app.

**How it was found, and what it is not.** `e2e/viewport-drawing.spec.ts` reported a 32.5px /
31.05px line-vs-cursor error at the `wide` viewport, which predicted the 763→676 box change
exactly. The obvious suspect was the rail's new width, and that was wrong: measured per viewport,
all three windows are **height-limited** (the fit never crosses modes, and width-limited at `wide`
would need a 970px-tall window), the app's pointer→document mapping
(`getLocalCoords()` in `src/hooks/usePointerPosition.ts`) and its `object-contain` paint agree
exactly in CSS space, and painting the app's own document point back through its own fit returns
the cursor to the decimal. The residual 3–5.5px is the brush's half-width. So the mapping is
self-consistent and the geometry is fine; the capture is the liar.

**Not fixed.** `captureBeyondViewport: false` is now passed explicitly, which is the documented
scope and the obvious suspect, and it did **not** eliminate the drift: 1 failure in 15 repeats
with it set. Across **50 controlled captures at a fixed viewport the drift did not reproduce at
all** — not once through the full sequence (load, select draw, `drawLine`, `waitForCanvasRedraw`,
marker injection, capture), which is what makes it a race rather than a scope problem, and why
the CDP mechanism is still open. Settling it needs native tracing (`--trace` on a run that
reproduces, or CDP tracing around the call), not more attempts to reproduce it in a loop.

**What is done about the reporting.** `e2e/viewport-drawing.spec.ts` now re-measures the box
across the capture and fails with _"the capture is of a DIFFERENT page than the one that was
measured, so every offset below is meaningless"_ plus both boxes. That guard fired on the real
drift during a 10x repeat run, so it is not theoretical. Before it, the same drift surfaced as a
32.5px app geometry error, which would have sent the next agent to the drawing engine.

**Do not "fix" this by widening a tolerance.** The same spec's tolerance is now DERIVED from the
stroke's own geometry — `(lineWidth / 2) x containFit(box).scale + 2`, which is 6.7–8.4px and
roughly a third of the fixed 25px it replaced — and there is a control asserting the widest
derived tolerance stays below 25 so a later edit cannot silently re-widen it.

## Known-skip tests

Two specs are `test.skip` by declaration:

- `e2e/export/photopea.spec.ts` — its `test.skip('exports to PSD and verifies in Photopea')`
  declaration. Round-trips through the external photopea.com, so it cannot run offline or in
  a sandboxed CI.
- `e2e/viewport-drawing.spec.ts` — its unconditional `test.skip(true, …)` on the test
  titled `line stays under cursor after window resize (normal, wide and narrow)`. Its
  declaration's own reason is the intermittent CDP capture drift that `TEST-FLAKES.md`
  §12 still records as open, behind an operator decision dated 2026-09-29.

## Still unverified

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

## P1 — the document-space oracle reached four production files, so most of the suite still moves when the frame does

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
gestures still use box-relative offsets that change the document point when the window changes.
Counted, with the counting command, because a number here without one is worse than none:

`e2e/example.spec.ts` is the first simple gesture migrated: it maps seeded document points with
`documentToCanvasOffset` and uses the resulting page clip for both redraw polling and capture.
`drawLine` remains box-relative; the broader migration remains open.

```
grep -rEo "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[0-9]+" e2e            # 36  canvas-relative LITERALS
grep -roE "[A-Za-z_]*[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]*" e2e   # 209  any box-relative offset
grep -roE "[Bb]ox\.[xy] *\+ *[A-Za-z_][A-Za-z0-9_]* *\*" e2e      #  0  the fraction form, which is correct
```

So: 36 gestures add a bare number to the box origin, and 209 add something box-relative. The 209
is the larger number because it includes sites like `box.x + LINE_Y`, which reach the same place
through a named constant rather than a literal — those are the ones the first pattern misses
entirely, and a count that only looked for literals sees under a fifth of the sites. The zero on
the third line is the part that matters, because
`e2e/viewport-drawing.spec.ts` gestures at `box.x + box.width * 0.25` and that is the one form
that survives a layout change by construction.

**Why it matters, stated as a measurement rather than a worry.** These are not merely fragile, they
are wrong in a specific direction. A `box.x + 150` gesture is a _window_-relative point: change the
window and the point the mouse visits is a different point in the document. The document-space
mapping has to be inverted before such a literal is meaningful, and it is not. So the suite still
asserts against whatever geometry the current layout happens to produce, and a layout change
silently changes what is being tested rather than failing.

Three panel assertions in `e2e/responsive-shell.spec.ts` used to pin the right panel at 250px.
The tests `reclaims the layers column by default and offers a toggle for it` and
`has no tablet toggle and keeps the layers panel open` already prove visibility and state, so their
numeric width reads have been removed. `gives the canvas the space the collapsed panel freed` now
compares the canvas-width change to the panel's measured width. These changes remove the panel's
three fixed-width pins; the broader document-space gesture migration remains open.

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
neither pins a pixel. The panel-width pins have likewise been removed or made relational; the
unconverted gesture inventory remains the open work.

**The pattern to copy is already in the tree.** `measureAtViewport()` in
`e2e/viewport-drawing.spec.ts` gestures at
`box.x + box.width * 0.25` and `box.y + box.height * 0.35` — a fraction of the box, so it tracks the
box instead of the window. That is the shape every one of them should take, via
`documentToCanvasOffset`.

**Do not fix this by re-recording anything.** A re-record would bless the new layout, which is
exactly the failure this campaign already made once: the seven export baselines were re-derived from
a moving letterbox before `e8f17ba` specified the line in document space.

## P2 — a collapsed tool's selection assertion is GROUP-level, so it passes for any member of the collapsed set

**Found 2026-09-30 while fixing the 17 `aria-pressed` failures, and it survives that fix.** The
helper is `expectToolSelected` (`e2e/helpers/toolbar-helpers.ts`). For a tool the rail still shows a
tile of its own it asserts `aria-pressed`, which is per-tool. For a tool folded into the three-dots
tile it asserts the tile's lit class instead — because `renderToolGroup()` in `SidebarLeft.tsx`
deliberately renders no `aria-pressed` there (`aria-pressed={identity === undefined ? … : undefined}`)
— and that class is painted from `group.some((tool) => tool.name === toolName)`
over the WHOLE collapsed set, on that same tile's `className`. So `expectToolSelected(page, 'eraser')`
is answered by "is SOME collapsed tool selected", not by "is the eraser selected".

**Measured at 1280x720, where it bites.** The tiles on the rail are `reposition`,
`rectangular-selection`, `freehand-lasso`, `magic-wand`, `eyedropper`, `crop` and `color` — the
first seven of the sixteen groups, the rail filling its slot with whole rows. The tool the app
opens with (`brush` in `src/tools/settings.ts`) is not among them, so it is in the collapsed set:
the three-dots tile is lit FROM PAGE LOAD and stays lit for every member. An assertion naming any
collapsed tool therefore passes before anything is selected.

**This is not a regression from the `aria-pressed` conversion, and that distinction is the whole
point.** A tile's `aria-pressed` and its lit `className` are the same `group.some(...)` call on the
same tile, so the removed attribute carried identical information to the class that replaced it. The
limitation predates the conversion and the conversion neither added nor hid it.

**Why the suite is nonetheless sound today, and where that stops being true.** Every caller that
depends on a specific tool pairs the tile assertion with a per-tool one:
the `${KEY} selects ${tool}` cases in `describe('tool shortcuts')` (`keyboard-shortcuts.spec.ts`)
assert the tool's own options-bar control (`bar`), precisely
because the tile "answers 'is SOME tool of the collapsed set selected'" — its comment says so. The
`erase-fill-eyedropper` tests instead drive pixels: the eraser must clear the slab, the bucket must
fill a contiguous region, the eyedropper must set a specific colour, and none of those can happen
with the wrong tool. `color.spec.ts` and `paint-tool-pixels.spec.ts` draw and measure. So the
TOOL-SPECIFIC claim is made by a second assertion everywhere it matters, and `selectBrushFamilyTool`
is misnamed — it proves the group is lit, and the test's own pixels prove the rest.

**What would actually close it.** A per-tool channel on the overflow tile — `data-active-tool={toolName}`
on the three-dots `<button>` that `renderToolGroup()` in `SidebarLeft.tsx` already gives
`data-toolbar-tile` for the fit measurement — lets the helper assert the tool by name at any window,
with no second assertion needed.
That is a PRODUCT change, deliberately not made here: `aria-pressed` was removed from that tile on
purpose (`1dcc25cb`), and the same reasoning that removed it is why nothing should be added back in a
shape that announces the wrong thing. Decide it deliberately, with the accessibility intent in view.

**Do not "fix" it by restoring `aria-pressed` on the three-dots tile.** That would announce a
pressed toggle for whichever hidden tool happens to be selected, on a control whose only job is to
open a menu — the exact defect `1dcc25cb` corrected.

---

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
`P2 — the visual baselines record no Chrome version, and a pin cannot be invented` and
`P3 — no mobile or HiDPI project, and no touch anywhere`. The other two,
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

In run `2026-10-07T17-21-09-904Z-84103`, Chrome `155.0.8059.39` exceeded the
100-pixel budget for PNG (386), JPEG (321), WebP (896), BMP (386), GIF (384), and
SVG (386). The AVIF visual case failed at the wasm request instead of producing a
comparison. This records the current encoder version, not the version used to
create the baselines.

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

- `e2e/helpers/cdp-helpers.spec.ts` — the
  `describe('captureCanvasScreenshot at an emulated deviceScaleFactor of 2')` block, the expected
  one. `playwright.config.ts` already records that a `deviceScaleFactor: 2` block fails
  differently from the default mode, and this is that block.
- `e2e/helpers/color-helpers.spec.ts` — `verifies swatch color when verifySwatch is true`; the
  swatch `toHaveCSS` is compared against a literal CSS colour on a 2x surface.
- `e2e/erase-fill-eyedropper.spec.ts` — `the eyedropper sample size averages the clicked block`;
  an eyedropper block average over a fixed-size sample, in image pixels.
- `e2e/keyboard-shortcuts.spec.ts` and `e2e/responsive-shell.spec.ts` — one test each, which this
  entry does not name.

So the honest statement is: the classifier and the specs this change touched are now
resolution-independent, and four other specs are not. What remains is a coverage decision
rather than a single defect, which is why it is still open: adding a project multiplies
every run's cost, and the mobile/HiDPI specs this would exercise do not exist yet. It is
not a one-line change to `playwright.config.ts`.

**One more gap this entry did not name.** Nothing in the suite can detect a change to a canvas
_backing store_. `CSS_POSITION_TOLERANCE` in `e2e/check-dpr.spec.ts` asserts a drawn line lands
within 25 CSS px of the cursor, and its `imageBoundsToCss` is scale-agnostic by construction, so that
file passes identically whether the store is 1x, 2x or 8x — the one spec named for DPR is the least
able to catch a DPR change. Nor does any other spec compare `canvas.width` against a bounding box:
the two that read the store — `the export is independent of the shell layout` in
`e2e/export/visual-regression.spec.ts`, and `setupExportTest()`'s backing-store read in
`e2e/export/helpers.ts` — assert it is the DOCUMENT size, which is the correct invariant for
export and says nothing about presentation.

So a 2x project would raise the floor of what fails, but on its own it would not _pin_ backing
store resolution; that needs its own assertion — a `canvas.width === box.width × dpr` check that
exists nowhere today. (It would also have to be the binding axis of the contain fit, not the
width axis: the workspace canvas is `object-contain`, so at 1280x720 the fit is height-limited and
the naive width form is red today.) The app side, and the app work that has to land first, is in
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

This is the same trade the left tool rail makes, and the rail's version was deliberate and
pinned — the rail scrolls and stays reachable by wheel, arrows and touch. The difference
is magnitude, and it is now starker than it was: **the rail no longer overflows at either
size at all** — 0px at iPad 10.2" portrait (810×1080), whose slot is 834px against a 16-row
grid of 822px, and 0px at iPad mini landscape (1133×744) — where it used to overflow by 71px
and 5px respectively, before the fit stopped reserving a fifth of the slot it measures.
This bar overflows by 615px at the same width and by 969px on a phone. A 5px overflow hides a
cue for something already within reach of a scroll; a 969px one hides most of the tool list.

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
