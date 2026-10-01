# Canvas resolution: investigation, blast radius, and plan

D3 and D2a landed on `fix/canvas-contain-scale`; D2b landed on `fix/export-decouple-display`. D3,
D2a and D2b are fixed and pinned; D2c and the e2e 2× project are the open work. Every `file:line`
below was re-derived against this tree.

## The finding that reorders the work

**The reported problem is not a paint-algorithm bug, and fixing it as one would waste the effort
on the one part of the codebase that is already correct.**

The report was "all canvas tools and similar algos are not retina aware". An eight-way audit of
every geometry path found the opposite for the algorithms:

- **All ten paint tools are DPR-proof.** ~50 length constants were classified against the only
  question that matters — _is this compared against a screen value?_ — and the answer was **zero
  suspect**. Six of seven `drawImage` calls take no size argument at all; the rest take a
  document-px `Size`.
- **`devicePixelRatio` is not merely absent from the paint path, it is structurally incapable of
  reaching it.** The pipeline is
  `clientX (CSS px, DPR-invariant) → ÷ contain-fit scale → document px → − layer.pos → layer raster px → pixel loop`.
  No step can introduce a device-pixel count. There is not one `ctx.scale`/`setTransform` in any of
  the ten tools; the only `setTransform` in production is the Transform tool (`transform.ts:80`).
- **Pointer mapping is exact at any DPR and is pinned by a test** that sets `devicePixelRatio = 3`
  and asserts the contain fit is unchanged (`usePointerPosition.test.ts:856-869`).
- **Export, persistence and clipboard are 8/8 CLEAR** — they never see a CSS box or a pointer.
  PSD export is structurally immune: it is passed document `size` and `documentFrame`, not the
  canvas (`useFile.tsx:122`).

**Do not re-audit the ten tool files on the strength of the original report.** That is the
expensive mistake this document exists to prevent: the budget goes on the code that was never
wrong.

## The defects, in dependency order

### D1 — The display canvas _was_ the export canvas — FIXED

`DesktopHeader.tsx:252` used to pass `canvasRef.current` to `useFile.tsx:125` → `saveImageToDisk`.
That canvas's backing store is set at `layer-renderer.ts:119` to `documentFrameSize(documentFrame)`
— **document pixels** — so the surface that determined on-screen sharpness was the same surface
that determined exported file dimensions, and raising display resolution would have raised export
resolution with it, silently.

The invariant was never the defect; the absence of a second surface was. `export-canvas.ts` exports
`renderExportCanvas(layers, size, frame?)`, which creates a detached canvas and hands it to
`drawLayersToCanvas` with `getSortedLayersArray(layers)` and the document frame. The compositor
sizes it at `documentFrameSize` (`layer-renderer.ts:119`, `:136`), which is why the export extent is
unchanged by construction rather than by coincidence. `ImageSaveInput` has no `canvas` field, and
the three call sites — `DesktopHeader.tsx:251`, `MobileHeader.tsx:72`, `MobileMenuDrawer.tsx:73` —
pass `layers`, `size` and `documentFrame` only. A frame is checked with `isValidDocumentFrame` and
falls back to `documentFrameFromSize(size)`, which is stricter than `savePsd`, whose frame is a
defaulted parameter (`psd-utils.ts:208`); an unrenderable surface throws onto the save dialog's
existing failure path (`useFile.tsx:142-152`) rather than being encoded. The module comment carries
the rationale.

The product invariant is unchanged and is still asserted in prose at
`e2e/export/helpers.ts:228-232`: _"the export is the document at the document resolution, so image
pixels are document pixels"_. What changed is that it is now structural. The regression net is
these three gates, which must stay green and unedited:

| Gate                                           | Assertion                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `e2e/export/visual-regression.spec.ts:210-213` | `canvas.width === 800 && canvas.height === 600`                           |
| `e2e/export/helpers.ts:228-232`                | `profile.imageWidth === DEFAULT_DOCUMENT_WIDTH`                           |
| `e2e/helpers/image-comparison.ts:52-58`        | any dimension mismatch → `matches: false`, `diffPixels: MAX_SAFE_INTEGER` |

The third is consulted **before** the 100-pixel budget (`image-comparison.ts:26`), so a naive DPR
change detonates all seven export formats on the first run rather than degrading them. With the
coupling gone, raising the display store no longer reaches an exported file at all.

### D2 — Presentation resolution is absent (the retina symptom)

Backing stores are document pixels; CSS `object-contain` upscales by `scale × dpr` at composite
time. On a retina display every pixel the user sees is resampled. Retouching cannot fix this — the
resolution simply is not there.

| Surface                 | Store                                                              | CSS box                           | Status                      |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------- | --------------------------- |
| workspace canvas        | document px (`layer-renderer.ts:119`)                              | `object-contain` (`Main.tsx:255`) | 1× — **Phase 4, unblocked** |
| tool overlay            | document px (`Main.tsx:141`)                                       | `Main.tsx:261`                    | 1× — **Phase 4, unblocked** |
| rect overlay            | document px (`Main.tsx:149`)                                       | `Main.tsx:301`                    | 1× — **Phase 4, unblocked** |
| selection ants overlay  | document px (`Main.tsx:154`)                                       | `Main.tsx:314`                    | 1× — **Phase 4, unblocked** |
| 3 option-bar thumbnails | `96 × 48 × dpr` (`Draw.tsx:228`, `Shape.tsx:308`, `Paint.tsx:231`) | `h-12 w-24`, fixed                | **D2a fixed**               |

The thumbnails were the most user-visible, and the only canvases whose bitmap was actively
_resampled_ rather than merely upscaled: each set a backing store of exactly 96×48 from a hardcoded
constant (`Draw.tsx:11-12`, `Shape.tsx:10-11`, `Paint.tsx:21-22`) and laid out at exactly 96×48
CSS px. On a 2× display the browser magnified a 96px bitmap into 192 device pixels.

**D2 fragile sites.** These are why a naive fix is dangerous. Each reads a _backing-store_
dimension and would change meaning **silently**, with no error and no test failure:

- `EyedropperToolArea.tsx:98-99` clips its sample window against `canvas.width`/`canvas.height`. At
  2× it would sample a half-size _physical_ region — a silent colour-accuracy regression.
- `rect.ts:144` calls `getTextWidth(ctx2d, …)` for the text tool on the **overlay** context, while
  `text.ts:75-80` bakes into an `OffscreenCanvas` sized to the layer. They agree today because
  both are 1×. A 2× overlay makes the measured rect and the rendered ink diverge.
- `useRect.ts:216` clears with the caller's document `imageSize` while `:221` clamps with
  `getCanvasSize(overlayRef)` (the backing store). These are different units that coincide only
  because store == document size today.

### D3 — The overlays disagreed on units (pre-existing, _not_ retina) — FIXED

Four painters draw screen chrome into a **document-sized** overlay that CSS displays with
`object-contain`, so the context draws in document px while the constants are CSS px. One divided;
three did not.

| Painter                                       | Chrome                                                     | Space           | Now                 |
| --------------------------------------------- | ---------------------------------------------------------- | --------------- | ------------------- |
| `useRect.ts:234-235, 240`                     | `2/scale`, `[5/scale, 5/scale]`, `HANDLE_SIZE/scale`       | CSS px          | was already correct |
| `useAnts.ts:11-14, 65-68, 91`                 | `LINE_WIDTH=1`, `DASH_LENGTH=6`, `GAP_LENGTH=6`, `SPEED=1` | was document px | **divided**         |
| `useSelectionAnts.ts:6, 127-136, 152`         | the same four, imported                                    | was document px | **divided**         |
| `selection.ts:17-18, 23-25, 182-183, 194-195` | `lineWidth=2`, `dash [6,4]`, anchors 5/8, hit radius 8     | was document px | **divided**         |

The marquee was a fixed 2 CSS px at any zoom, while the marching ants and the selection outline
were 1–2 _document_ px: sub-pixel and smeared below 1:1, proportionally heavy above it. The ant
crawl speed (`SPEED`, document px per frame) varied with zoom too. **This was observable before
the fix, at DPR 1, with no retina involved.**

`useSelectionAnts.ts` is the one the original audit missed, and it is the more visible of the two:
it owns the animated border around every committed polygon selection, and it was added to `main`
after the original report was written. The original defect list named three painters; there were
four.

## Two design constraints any further work must respect

1. **Thread the scale as a parameter; do not read `window.devicePixelRatio` at the point of use.**
   `src/test/setup.ts:354-355` replaces `HTMLCanvasElement.prototype.getContext` with a bare mock
   and jsdom performs no layout, so **no jsdom test in this repo can observe DPR at all** — which
   is why the gap survived. A global read would be untestable in the entire unit suite. An injected
   ratio is both testable and better design, and it is what `useContainScale` does for the
   contain fit: the overlay painters read a **ref**, not state, because they read it inside a 60fps
   loop and measuring there would force a synchronous layout per frame.
2. **Never re-record an export baseline to accommodate this.** Per `AGENTS.md`, export dimensions
   are a correctness invariant. The 800×600 baseline is right and the fix must keep it.

## What is landed, and what remains

`containFit` (`util/contain-fit.ts:33`) is the single divisor: `usePointerPosition` and
`useContainScale` both compute the fit from it, so the number the pointer is divided by and the
number the painters are divided by cannot drift apart. It defaults to 1 at every call site, which
is the identity divisor — an unmeasured container degrades to the pre-fix behaviour, not to a
divide-by-zero.

| Phase                                              | State                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| D3 — unify the overlay unit convention             | **landed.** Four painters, one divisor, pinned at two non-unit scales per painter. |
| D2a — option-bar thumbnails at device resolution   | **landed.** `h-12 w-24` on the canvas, `dpr` on the raster, `drawImage` 1:1.       |
| D2b — decouple display from export (the arch step) | **landed.** `export-canvas.ts` renders the surface.                                |
| D2c — raise the display resolution                 | **open, unblocked — D2b is closed. See the fragile sites above.**                  |
| e2e 2× coverage                                    | **open, and see the blind spot below.**                                            |

### D2b — Phase 3, the architectural step — DONE

- `export-canvas.ts` exports `renderExportCanvas(layers, size, frame?)`: a detached canvas, the
  sorted layer array, and the document frame. `ImageSaveInput` has no `canvas` field and no caller
  supplies one, so the export path reads the same inputs `savePsd` always read. That is what makes
  the display canvas free to scale.
- **Test:** the three gates above are the regression net; they stay green and unedited, and
  `export-canvas.test.ts` pins the decoupling itself.

### D2c — Phase 4, the resolution increase

- `resizeCanvas` gains an explicit ratio; the composite path applies `ctx.scale(backingScale)`
  before drawing; the D2 fragile sites move from backing-store reads to explicit ratios.
- **Test:** e2e. jsdom cannot see it, by construction.

### Phase 5 — e2e 2× coverage

- `e2e/OPEN_PROBLEMS.md:802` measures what breaks at 2×: `cdp-helpers.spec.ts:235`,
  `color-helpers.spec.ts:18`, `erase-fill-eyedropper.spec.ts:653`, `keyboard-shortcuts.spec.ts:164`,
  `responsive-shell.spec.ts:239` (`:816-829` carries the measurement).
- **Known blind spot, and it is structural:** `check-dpr.spec.ts` is the one spec unable to detect
  this change — it asserts a line lands within 25 CSS px of the cursor (`check-dpr.spec.ts:8`),
  which holds at any store size, and its `imageBoundsToCss` is scale-agnostic by construction. Nor
  does any other spec compare `canvas.width` to a bounding box. So a 2× project would raise the
  floor of what fails but would not _pin_ backing-store resolution. That needs its own assertion:
  a `canvas.width === box.width × dpr` check, which exists nowhere today.

## Blast radius

| Area                                  | Files                                                                   | Verdict                         |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| Paint algorithms                      | 10 tool files + `util/draw.ts`                                          | **CLEAR — do not touch**        |
| Export / persistence / clipboard      | 8 files + `export-canvas.ts`                                            | **CLEAR — decoupled at source** |
| Pointer mapping                       | `usePointerPosition.ts`                                                 | CLEAR and correct; keep pinned  |
| Unit conversion (text/shape/gradient) | 5 files                                                                 | CLEAR; no pt/px bug             |
| Overlay chrome                        | `useAnts.ts`, `useSelectionAnts.ts`, `selection.ts`                     | **D3 — fixed**                  |
| Option-bar thumbnails                 | 3 files                                                                 | **D2a — fixed**                 |
| Display surfaces                      | `Main.tsx`, `layer-renderer.ts`, `useApp.ts`, `util/canvas.ts`          | **D2c — Phase 4, unblocked**    |
| Export coupling                       | `DesktopHeader.tsx`, `MobileHeader.tsx`, `MobileMenuDrawer.tsx`         | **D2b — fixed, decoupled**      |
| e2e export gates                      | `visual-regression.spec.ts`, `export/helpers.ts`, `image-comparison.ts` | **Must not weaken**             |

## Adjacent findings from the original audit that this document does NOT carry

The original audit filed three adjacent items alongside D1–D3. They are **not** in the table above
because their citations have rotted and the claims no longer hold against this tree. Re-derive
before filing any of them; do not quote the old line numbers.

- **`src/index.scss` `touch-action`.** The original claim was that the stylesheet asserts
  `touch-action: none` comes from `.zoom-container` and `<main>` while no active rule sets it
  anywhere. That is now false: `index.scss:100-103` states it deliberately, and the rule it names
  is present. Nothing to file.
- **`src/contexts/layer-utils.ts:45`.** The original claim was a TypeScript syntax error
  (`{ bitmap: }`). It is inside a `//` comment, so it is not a syntax error and the inference that
  the region escaped `tsc -b` does not follow. Nothing to file.
- **`EraserToolArea` preview/commit space mismatch.** The original claim was that raw
  `getLocalCoords` (canvas space) reaches the overlay while the commit is in layer space, and that
  the two agree only while `documentFrame.x/y === 0`. The current code converts explicitly
  (`EraserToolArea.tsx:88-92`) and comments that the preview and the commit are kept in step, so
  the claim needs a fresh derivation before it is worth anything.
