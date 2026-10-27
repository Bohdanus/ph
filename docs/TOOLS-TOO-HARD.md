# Tools — too hard, and not attempted

**The policy this file records.** When a Photoshop tool capability is too hard to implement in this
architecture, we skip the implementation and record it here rather than shipping a fake or a
half-version. A capability listed here is a decision, not a backlog item: nobody re-audits it, nobody
estimates it, and nobody treats its absence as a defect. An entry is deleted only when the capability
lands — see the lifecycle rule in `docs/DOCUMENTATION.md` — "Lifecycle": **fixed and verified
DELETES the entry**, never rewrites it into a closed one.

**Photoshop's documentation is the source of truth for what Photoshop does.** Every "What Photoshop
does" line below cites the Adobe page. Where this app's behaviour and Adobe's disagree, Adobe is
correct by definition — that is the whole of the product requirement in `AGENTS.md`, "The toolbar is
a Photoshop clone". This file records only capabilities that are **absent or unfaithful**; the
per-tool inventory, including everything partial, lives in [`TOOLS.md`](./TOOLS.md), which is
generated from `src/tools/descriptions/`.

**This file is not a handoff document.** It is scoped to the Tools rail and the capabilities behind
it. History and document-state defects belong in `HANDOFF.md`; test-infrastructure defects in
`TEST-FLAKES.md`. Where an entry overlaps `HANDOFF.md` — layer opacity is the case — the handoff
entry remains the record of the defect, and this file records only that it is too hard here.

## Revalidate before trusting any citation

Citations into a growing source file go stale, and the prose at a stale line still reads
plausibly. `.skills/hard-merge.md` records the measurement: on one branch, inserting lines into a
central context file left nearly every citation below the insertion point wrong. **Re-derive a
citation from the sentence that contains it, never from the old number.**

Per `docs/DOCUMENTATION.md` §Citations, tracked documents must cite declared identifiers — a
function or method in call form (`floodFill()`), a dispatched string literal (`'legacy-tool'`), a
test title (`it('...')`), or the file alone when the claim covers the whole file. Line-number
citations are banned.

To verify a citation without moving through the file by eye, search for the declared identifier
and read its context against the claim the sentence makes:

```bash
grep -n "floodFill" src/tools/quickSelection.ts
```

A citation that resolves to an import, a closing brace, or a neighbouring function is wrong even
though the identifier exists. If a cited symbol has moved, the fix is the citation in this file,
not the code.

---

## TOO HARD — a new algorithm or engine is required

### Quick Selection's edge-following segmentation

**What Photoshop does.** The Quick Selection tool "automatically finds and follows defined edges in
the image" as you paint, so a stroke over a subject snaps to the subject's boundary rather than
spreading across everything of a similar tone.
<https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html>

**What this app does.** Each brush stamp samples nine seed points inside its round tip
(the centre, four axial points and four diagonal points); each seed runs a contiguous
flood fill, and the resulting regions are combined. Size therefore changes both the
distance between stamps and the area from which those regions are seeded. This sparse
sampling is an app-level approximation inferred from Adobe's adjustable brush tip, not a
description of Photoshop's unpublished segmentation implementation. The bar also exposes
an app-specific Tolerance control; Adobe's current desktop Quick Selection page documents
brush settings instead.

Each seed still uses only colour distance from the seed, not edge strength or gradient
structure (`quickSelection.ts` — `growAlongStroke()`):

```ts
const result = floodFill(imageData, seed, { tolerance, contiguous: true });
```

Growth is a function of colour similarity to the seed and of nothing in the image's neighbourhood, so
there is no term that can stop it at an edge. Across a gradient, each additional stamp can grow a
different region; this can extend a selection but still does not reproduce Photoshop's edge-following.

**Why it is too hard.** Edge-following is not a threshold to tune; it is a different algorithm. It
needs a gradient or structure tensor over the image, a per-dab decision about whether the local
neighbourhood supports expansion, and the confidence model that decides when a boundary is an edge and
when it is texture. None of that exists in the app, and every layer of it would sit under the growth
loop above rather than beside it.

**What the app does instead.** A tolerance-driven union of contiguous fills, with a sparse brush-tip
seed pattern. Users tune Tolerance to keep it from bleeding, which trades a leaking edge for a ragged
one. The brush size has a real spatial effect, but this selection growth and the Tolerance control do
not match Photoshop's documented edge-following behavior.

### Selection combination modes

**What Photoshop does.** Selection tools can combine a new selection with the existing one using
New / Add To / Subtract From / Intersect With where those controls are provided. Shift, Alt/Option
and Shift+Alt/Option can set the same modes during a drag on tools that support them.

**What this app does.** Quick Selection's Mode dropdown offers Add and Subtract. No bar implements
the complete Photoshop set; the other selection tools do not render combination controls. On tools
without a mode selector, a second selection replaces the active one. Quick Selection rasterizes the
active contour paths and applies Add or Subtract before committing the result.
`Selection` stores compound contour paths (`general-types.ts` — `Selection`):

```ts
export type Selection = {
  id: string;
  points: Point[][];
  isActive: boolean;
  // …pos, lifecycle, geometry, sourceTool, metadata
```

Union and intersect are per-pixel operations, so combination modes rasterize the contours before
applying the boolean operation. The shared module `src/util/selection.ts` creates committed paths,
derives alpha masks, and owns clipboard clipping and hit testing; the marching-ants renderer also reads
every contour. A change to the selection model therefore crosses all these consumers.

**Why it is too hard.** A complete shared selection operator needs one coverage rule across the
different geometry writers, history snapshots, copy, hit testing, marching ants and pixel tools.
The current model stores contours and derives masks on demand; adding a second persistent mask beside
those paths would create two authorities that could drift.

**What the app does instead.** Quick Selection can add to or subtract from its current compound path.
Other selection tools create a replacement selection. There is no Intersect mode or shared mode
control across the selection family.

### Select and Mask, and the Select menu

**What Photoshop does.** Every selection tool's bar carries a Select and Mask button, opening a
workspace where the result is refined with a Refine Edge Brush, a plain Brush, and Radius, Smooth,
Contrast, Shift Edge and Decontaminate Colors, then output as a selection, a layer mask, a new layer or
a new document. <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html>

**What this app does.** There is no `Select` menu. The menu bar has five hosts — File, Tools, Image,
Edit and Window (`DesktopHeader.tsx`) — and `Select` is not one of them, so there is no menu surface
for Select and Mask to hang from.

**Why it is too hard.** Select and Mask is not a dialog over the existing model — it is the workspace
where most of a selection tool's real accuracy actually lives, and it consumes the missing combination
modes above as its substrate. Building it means adding a `Select` menu, a per-tool `Select and Mask`
button, a Refine Edge Brush with its own edge-detection model, and an output dialog. That is a build,
not a feature.

**What the app does instead.** Nothing, and the app does not pretend otherwise — the controls are
absent rather than rendered inert. [`TOOLS.md`](./TOOLS.md) records `Select and Mask` as `missing` on
the marquee, lasso, wand and quick-selection bars.

### Select ▸ Modify, Inverse, Deselect, Grow and Quick Mask

**What Photoshop does.** Select ▸ Modify offers Feather, Expand, Contract, Border and Smooth;
Select ▸ Inverse inverts the selection; Select ▸ Deselect, Select ▸ Grow and Select ▸ Similar expand
it; and Quick Mask mode shows the selection as a red overlay that brushes can cut. Feather, Expand and
Contract are the three every selection workflow depends on. Feather and Grow in particular are
reachable from the same Select menu Select and Mask is.

**What this app does.** None of them exist, anywhere. There is no `Select` menu to host them — the five
hosts are File, Tools, Image, Edit and Window (`DesktopHeader.tsx`) — and no selection operation
implements them: `src/util/selection.ts`
exports no inverse, no morphological grow or shrink, and no blur-based feather over a selection. It
does compute a feathered alpha, but only on the clipboard copy path
(`copyFeatheredPolygonSelectionToCanvas()` calling `createFeatheredAlphaMask()`); the outline it draws
on the canvas is not feathered.

**Why it is too hard.** Every one of these is a whole-image operation on a selection the app stores as
a polygon. Feathering a polygon is not feathering its outline; a correct Feather is a distance
transform followed by a smoothstep, on a mask, and the app has no mask to run it on. This is the same
missing substrate as Select and Mask above, and it is the reason the first entry in this section is a
type change.

**What the app does instead.** No selection can be inverted, grown, shrunk or feathered after the
fact. A selection is what the last tool drew, and the only edits available are copy, paste and deselect
from the marquee's bar.

### Persistent pixel-channel selection behavior

**What Photoshop does.** Adobe's current [desktop Magic Wand guide](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html)
says Contiguous selects only adjacent areas of similar color. Adobe's [Magic Wand guide for Photoshop on the web](https://helpx.adobe.com/id_en/photoshop/web/edit-images/make-selections/enhance-selections-with-magic-wand-tool.html)
states that, with Contiguous off, all pixels in the image using the sampled colors are selected.
Separately, the [UXP Selection reference](https://developer.adobe.com/photoshop/uxp/ps_reference/classes/selection/)
describes a pixel-based selection that can represent "area or areas" with 8-bit transparency. The
expectation that a differently colored hole remains unselected follows from those color-match and
pixel-selection descriptions; Adobe does not prescribe a contour representation.

**What this app does.** `Selection` stores one authoritative form: ordinary selections use compound
contour paths; highly fragmented Magic Wand and Quick Selection results use a cropped, row-major,
one-bit-per-pixel mask when their exposed boundary exceeds the safe vector budget. The mask-backed
form has no point paths, so hit-testing, copying, processor clipping, history replay and marching ants
read that mask directly. Vector selections retain every traced loop, including disconnected
components, enclosed holes and nested islands; exact pixel round trips are tested for those shapes.
Fill, Eraser and Clone Stamp derive alpha masks from either selection form when they clip pixel
operations. The packed representation is binary and exists to keep large boundaries bounded; it is
not Photoshop's general 8-bit selection channel.

**What remains missing.** Photoshop's selection is a pixel channel, so partial alpha can remain part of
the active selection. This app does not store per-pixel coverage or expose Quick Mask, selection
channels, save/load, invert, expand, contract or general combination controls. Quick Selection alone
provides Add and Subtract. Before combining a stroke, Quick Selection rasterizes the active selection
by testing destination pixel centers. A fractional position or antialiased edge therefore becomes
binary pixel membership, and the committed one-bit mask cannot retain the previous partial alpha.
Vector-backed Magic Wand results apply the app's nonzero Smooth value by simplifying the paths, which
can differ from the original color-match mask. The high-complexity mask-backed path keeps exact
matched pixels and currently bypasses that simplification.

**Architectural boundary.** The stored geometry is mutually exclusive: a committed selection has
either vector points or one authoritative packed mask, never both. History, undo/redo, copy, marching
ants, hit-testing and the supported pixel tools all consume the same form. This binary fallback does
not provide Photoshop's partial alpha, saved selection channels, or general selection operations.

### The Pen family

**What Photoshop does.** Pen, Freeform Pen, Curvature Pen, Add Anchor Point, Delete Anchor Point and
Convert Point are the drawing group's core. They edit a work path of anchor points with direction
handles, with Auto Add/Delete and Rubber Band controlling how the next click lands, and the resulting
path can be stroked, filled or converted to a selection.
<https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html>

**What this app does.** All six are `commit: 'unimplemented'` in the `toolProcessors` registry
(`toolProcessors.ts`), against a shared null-bitmap stub declared as `unimplemented` in the same
file:

```ts
const unimplemented = () => () => [null as never] as ToolResult;
```

They are in the rail, with Adobe's names, because the rail is a clone and the grouping is the
specification. None of them has a gesture surface: `Main`'s tool-area dispatch has no branch for any
of them, so the default handler stands (`Main.tsx` — `renderContent()`'s `EventHandler` dispatch)
and that same dispatch closes on `DummyToolArea`, which is the inert `display: none` surface
every unrouted tool gets.

**Why it is too hard.** A work path is a first-class document object: anchors, bezier direction
handles, open and closed state, and the Auto Add/Delete and Rubber Band gestures that decide what a
click means. The app has no work-path model — selections are raster-bound compound contour paths
and shapes are rasterised polygons — so the Pen family is not six tools to implement but a document layer to design,
and the Path Type entry below is the same work seen from the shape tools.

**What the app does instead.** The six tools are in the rail under Adobe's names and mount a stub
options bar. `docs/PHOTOSHOP-UX.md` §"Open violations" is explicit that this is the correct state for a tool
the app cannot do: the Photoshop grouping and naming are the specification, and the stub bar is the debt.

### Custom Shape

**What Photoshop does.** Draws reusable vector graphics from a built-in library, imported shapes,
or shapes the user creates and saves. Adobe documents this separately from the Star tool, which is
its own entry in the shapes group with adjustable points and inner/outer radii:
[Custom Shape](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html),
[Star](https://helpx.adobe.com/photoshop/using/create-star-shape.html).

**What this app does.** `commit: 'unimplemented'` at `toolProcessors.ts` — its `'custom-shape'`
entry — the same null-bitmap stub, and no gesture surface. The tool is in the rail under Adobe's name.

**Why it is too hard.** It is three things, not one: a parser for the shape-preset format, the preset
library itself, and the authoring and management surfaces. None of the format's structure is present,
so drawing a built-in or imported Custom Shape is not implemented by adding a single preset.

**What the app does instead.** A stub bar. The shape flyout carries seven entries
(`toolbar-mapping.ts` — `toolbarMap`'s shape flyout): Rectangle, Ellipse, Line, Triangle,
Polygon, Star and Custom Shape. Star is implemented — it renders via the shared `shape` processor
with `figure: 'star'` (see `src/tools/descriptions/shape.notes.md`); only Custom Shape remains
absent, behind the `commit: 'unimplemented'` stub. Star is a separate parametric shape tool, not a
Custom Shape preset; its implementation did not require the `.csh` parser or library described
above. Its behavior and options are researched in `src/tools/descriptions/shape.notes.md` and the
generated shape documentation.

### Live type

**What Photoshop does.** Type is live. It is resolution-independent, reflows inside a text box when
the box is resized, can be re-typed in place, and carries an on-canvas caret. Scaling it up is not a
resample; it re-renders.

**What this app does.** Each committed text presentation is rasterized. The renderer writes the
string with `fillText` (`text.ts` — `fillLine()`) into a layer-sized raster, and the `text` processor
returns that raster as the tool's whole result (the same file's `text` processor):

```ts
export const text =
  ({ size }: CreatorToolParams) =>
  (args: TextToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    renderText(ctx, args);

    return [canvas];
  };
```

`renderText` is a measure-and-draw function over a string (`text.ts` — `renderText()`), and the
**durable** engine does re-run it: `materialization.ts` — `sourceBitmap()` re-runs the creator for a
`kind: 'text'` durable source, classified by `history-adapter.ts` — `convertSource()`. Only the
RUNTIME path skips it — `layer-renderer.ts`'s `vectorToolNames` lists six tools with `text` absent,
so a live layer draws from `layer.bitmap`. Stating the skip without the qualifier is what made this
paragraph wrong when the Type tool was in scope: it told a reader the committed characters could not
be reproduced from the args, when one of the two engines can. `docs/TOOLS.md`'s two-engine section
has it right.

**Why it is too hard.** It needs a text layout engine, font shaping and rasterisation, and an
on-canvas editing surface with a caret, selection and IME input. The app also has a replay contract
that makes this harder than it looks: `HistoryItem[]` is the production replay authority, and a
replayed type entry has to reproduce the same pixels from its args on any host. A live text object is
not a raster and does not survive that unchanged.

**What the app does instead.** The production path retains the text source arguments and supports
Photoshop-style panel re-entry: selecting an existing text row with the Type tool active (`LayersTab.tsx`
— `selectLayer()`), or double-clicking its row, hydrates those arguments into the contenteditable
overlay. `Text.tsx` — `applyText()` and the dirty-tool commit arm call `replaceLayerSource()`, so the
edit is recorded and replayable. Canvas-click re-entry remains open. The runtime renderer still uses
the committed raster for text, so runtime scaling resamples it. The remaining gaps are canvas entry and
live vector rendering rather than retention of the text arguments.

### Free Transform as an interactive bounding box

**What Photoshop does.** One continuous drag with handles for Scale, Rotate, Skew, Distort,
Perspective and Warp, a draggable reference point for the transform origin, Shift/Alt constraints, and
commit on Enter. <https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html>

**What this app does.** A fixed-parameter panel. The options bar publishes a preview through
`tempUpdateLayer`, and the geometry is committed when the gesture ends: a drag previews until the
pointer is released and then lands as one history entry, bound to the browser's native `change`
event rather than to React's `onChange`, which is the per-frame `input` event
(`Transform.tsx` — the native `change` listener its `useEffect` registers, and the
`throttledOnChange()` that publishes each frame). Switching tool (`useApp.ts` — `goToTool()`) and
exporting still commit too. The bar carries no commit control and no
discard control; the whole right-hand column is the two mirror toggles, centered in the slack the
removed links left behind (`Transform.tsx` — the `toggleMirrorH` / `toggleMirrorV` pair), and Escape
— handled by the `useEffect` that calls `cancel()` — is the only route that
discards a preview.

**Why it is too hard.** The bounding box is a gesture surface that owns the pointer for its duration
and resolves to an arbitrary affine or projective transform. This app's transform path is
parameter-driven and previewed as a layer, with Distort and Warp in particular needing a
displacement field rather than a matrix. It is also a different commit discipline: one gesture, one
result, committed on a keypress rather than a panel change.

**What the app does instead.** Numeric fields and a gesture that commits when you let go. The
preview is real and it is correct; it is just not draggable, so every transform is a round trip
through the panel.

### Crop: Straighten, Content-Aware and Generative Expand

**What Photoshop does.** The Crop tool's options bar carries **Straighten** — "Select the Straighten
tool from the Options bar, then drag a line along an edge in the tilted image" — which rotates the
image behind a stationary crop box.
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/straighten-tilted-photos.html>

A **Fill** dropdown on the same bar decides what fills the canvas a crop adds outside the image edge —
"Go to the Fill dropdown in the Options bar and select Content-Aware Fill". Generative Expand is a
separate action in the Contextual Task Bar, not a value in that dropdown.
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html>

**The bar carries no Curve, and Adobe does not claim that it does.** Adobe's own enumeration of the
bar's controls is the _Crop tool options_ page, last updated 23 Feb 2026: it lists the aspect-ratio
values, and in the gear menu Delete Cropped Pixels, Use Classic Mode, Auto Center Preview, Show Cropped
Area and Enable Crop Shield — no Curve among them. Straighten and Fill are documented on sibling pages,
and the Curve Photoshop documents is the separate Curves adjustment, recorded under
[Curves — a spline over the tonal range](#curves--a-spline-over-the-tonal-range) below.
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html>

**Generative Expand** is the separate action that flow is built around: "From the Tools panel, select
Crop tool and drag the crop handles outward to expand the canvas", then "Leave the prompt blank and
select Generate to let Photoshop extend the image" and "Choose a variation from the Properties
panel". The model is picked from Adobe's Firefly list in the Contextual Task Bar, so the pixels in
the added band are computed by a cloud service and arrive on a layer of their own.
<https://helpx.adobe.com/photoshop/desktop/create-open-import-images/create-images/explore-beyond-the-canvas-with-generative-expand.html>

**What this app does.** The frame grows and nothing is filled. `applyDocumentCrop` takes the gesture
rect **unclamped** — `sortRoundRect` (`rect.ts` — `sortRoundRect()`) sorts it and rounds each edge
once, with no clamp to the document — so a rect dragged past an edge produces a larger
`documentFrame` (`useLayer.ts` — `applyDocumentCrop()`, which computes the next frame and compares it
against the current one):

```ts
const { x, y, width, height } = sortRoundRect(rect);
```

The crop is registered as a `document-operation` (`toolProcessors.ts` — its `crop` entry's
`commit: 'document-operation'`), so the commit is a frame edit and not a raster: it dispatches no
fill or synthesis of any kind. Existing layer-source pixels outside the old frame still render
when the frame expands; only areas with no retained source pixels remain transparent. The latter
empty-band behavior is the operator's decision, recorded as OVR-1 in [`OVERRIDES.md`](./OVERRIDES.md),
and it does not block recovery of pixels hidden by an earlier crop.

The **Fill** control is not rendered at all: the bar carries an `Aspect Ratio` select and two buttons,
`Apply` and `Clear` (`Crop.tsx` — the `Crop` options bar), and the only file under
`src/` naming Content-Aware or Generative is the generated tool description
(`type-crop.ts` — the `Fill` control entry, whose detail names Content-Aware Fill), which is
documentation data rather than code.

**Why it is too hard.** Straighten alone is a rotation, which the app has elsewhere, but it is the
gesture and the box relationship that is the feature. Content-Aware is a patch-based synthesis model
with no analogue in this codebase at all, and Generative Expand is a cloud generative feature: a model
server answers with three variations that land on a new generative layer. Neither is a gap in the crop
processor — it is a gap in what the app is. The app has no network surface anywhere under `src/`, and
a tool commit is a synchronous call returning `[BitmapSource, Partial<Pos>?]`
(`toolProcessors.ts` — `ToolResult`, whose `ToolProcessorDefinition` carries the `imageProcessor`
processor signature), which is the shape a server round trip and three returned variations cannot
take.

**What the app does instead.** An axis-aligned rect with a ratio lock, which may be dragged past the
image edge: the frame grows and retained off-frame source pixels are revealed. Newly exposed areas
with no source pixels remain transparent. The commit path is honest about what it takes — a rect,
the current frame, and one document edit — and it says so by writing no fill.

**The frame growth is not this entry's missing capability.** The app can grow the document frame and
reveals any retained layer pixels that extend beyond it. Transparent fill applies only to newly
exposed areas without source pixels; that behavior is OVR-1 in `docs/OVERRIDES.md`. Frame growth is
not a Photoshop Fill choice. What this entry records is the missing Straighten gesture,
Content-Aware Fill, and Generative Expand. Patch-based synthesis and a cloud generative call are not
landing, so this entry stays open under the lifecycle rule in the preamble.

### Black and White as a hue-sextant weighted mix

**What Photoshop does.** Six independent sliders, one per hue sextant — reds, yellows, greens, cyans,
blues and magentas, each defaulting to a different value — so a conversion is a weighted mix that can
push one family of hues toward white and another toward black.
<https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html>

**What this app does.** A three-filter CSS chain over the whole layer
(`functions.ts` — `buildColorsFilter()`):

```ts
export function buildColorsFilter({ grayscale, sepia, saturation }: ColorsFilterArgs): string {
  const saturate = adjustmentPercent(expAdjustment(saturation, SATURATION_EXPONENT));
  return `grayscale(${grayscale}%) sepia(${sepia}%) saturate(${saturate})`;
}
```

`grayscale()` is a flat luminance average with no hue dependence at all, and `sepia()` is a fixed
one-directional warm shift. The app's capability is reached at `Image ▸ Adjustments ▸ Desaturate`,
where **Black and White is a disabled item** (`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`'s
`{ label: 'Black and White' }` entry) because nothing computes it — see the operator-decision section
below for why `Desaturate` is the name the enabled item carries.

**Why it is too hard.** No CSS filter chain can express a per-hue weighting; the filter primitives are
whole-image and order-dependent, and six independent sextant weights are neither. A faithful
implementation is a per-pixel conversion in a colour space that knows which sextant a hue falls in.
The app has no such conversion routine; it composes a string and hands it to the canvas.

**What the app does instead.** Grayscale, a sepia tone and a saturation trim, applied as a CSS filter
chain. It desaturates correctly, and that is the whole of the overlap.

**This entry will be deleted rather than rewritten when the capability lands, and the operator has
signalled it will.** 2026-10-01: Levels, Colors and the other `Image ▸ Adjustments` commands "will be
implemented". The requirements are **not written down**, so nothing here is a spec and nobody should
build against this entry — the "why it is too hard" above describes the CSS-filter mechanism this
implementation happens to use, which is exactly what a per-hue conversion replaces rather than
constrains. What survives the rewrite is Adobe's six-sextant behaviour, which is the product
requirement and is unchanged by anything an agent decides about the mechanism.

The retained `src/tools/colors.ts` and `src/tools/levels.ts` processors are the future raster
implementations behind that canvas-filter limitation. They remain intentionally registered for
replay and materialization, even though the current production adjustment path uses CSS filters;
do not delete them as dead code or wire them into a different tool until the adjustment rendering
contract is specified.

### Real Levels — the three-point remap, the histogram and the channel selector

**What Photoshop does.** The Levels adjustment "correct[s] the tonal range and color balance of an
image by adjusting intensity levels of image shadows, midtones, and highlights", with a histogram as
"a visual guide for adjusting the image key tones". It has **three Input Levels sliders** — black
point, a middle gamma slider and white point — **two Output sliders** ("By default, the Output sliders
are at level 0, where the pixels are black, and level 255, where the pixels are white"), a **channel
selector**, three **eyedroppers** (black, grey and white point) and an **Auto** button whose algorithm
is configurable in the Auto Color Correction Options dialog.
<https://helpx.adobe.com/photoshop/using/levels-adjustment.html>

**What this app does.** There is no Levels. `Image ▸ Adjustments ▸ Levels` is a **disabled** menu
item (`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`'s `{ label: 'Levels' }` entry), and the tool
registered under the id `levels` is not Levels either: `LevelsToolArgs` is `{ brightness, contrast }`
(`levels.ts` — `LevelsToolArgs`) and the processor emits a single `brightness(%) contrast(%)` string
(`functions.ts` — `buildLevelsFilter()`). It is the app's `Brightness/Contrast`, reached at
`Image ▸ Adjustments ▸ Brightness/Contrast` (`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`'s
`{ label: 'Brightness/Contrast', toolName: 'levels' }` entry).

**Why it is too hard.** Levels is a per-channel **lookup table**: three control points map an input
level to an output level, and every pixel in the selected channel is then a table index. The app has no
per-channel pixel path to build the table against — what it owns is a CSS `ctx.filter` string handed
to the canvas by `getLayerFilter` (`layer-renderer.ts` — `getLayerFilter()`, applied by
`drawLayerSource()`), and a filter string cannot express an arbitrary LUT. The histogram is a second,
separable piece: it is a 256-bucket
count per channel over the composited image, which means reading back what the renderer just wrote.

**What the app does instead.** Two global CSS filters. It moves brightness and contrast; it cannot move
a black or a white point, cannot address one channel, cannot show the histogram and cannot Auto.

**Levels is one of the two commands the operator named on 2026-10-01**, so the suspension recorded on
the Black-and-White entry above applies to this one too: the "why it is too hard" describes the
CSS-filter mechanism being replaced, not a constraint on the replacement. The load-bearing question is
still unanswered and is not this file's to answer — whether `Image ▸ Adjustments` bakes pixels or
creates adjustment layers changes the durable schema, not the UI. `HANDOFF.md` §172 carries it.

### Curves — a spline over the tonal range

**What Photoshop does.** "In the Curves adjustment, you adjust points throughout an image's tonal
range. Initially, the image's tonality is represented as a straight diagonal line on a graph"; adding
and dragging **control points** reshapes the curve, up to **14** of them, with per-channel overlays,
presets, an on-image adjustment tool, and a histogram behind the graph.
<https://helpx.adobe.com/photoshop/using/curves-adjustment.html>

**What this app does.** Nothing. `Image ▸ Adjustments ▸ Curves` is a **disabled** menu item
(`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`'s `{ label: 'Curves' }` entry). There is no curve type, no
control-point model, and no evaluator anywhere in `src`.

**Why it is too hard.** Curves is the same missing primitive as Levels with a worse control surface: a
monotone spline through N points, evaluated per input level, per channel. The evaluator is a day; the
editor — draggable points on a graph over a live histogram, with channel switching, numeric readouts
and preset curves — is the work, and it needs the same histogram as the Levels entry above.

**What the app does instead.** The disabled item. Nothing is rendered inert, so nothing pretends.

### Adjustment layers, and the Properties panel that edits them

**What Photoshop does.** "In adjustment layers, apply color and tonal corrections (like brightness,
contrast, or vibrance) **without permanently changing pixel data**" — each adjustment is its own layer
carrying its own settings and a mask, edited afterwards in the **Properties** panel, and the whole
family (Brightness/Contrast, Levels, Curves, Exposure, Hue/Saturation, Color Balance, Black & White,
Photo Filter, Channel Mixer, Color Lookup, Selective Color, Invert, Posterize, Threshold, Gradient Map)
is created from `Layer > New Adjustment Layer`.
<https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html>

**What this app does.** No adjustment layer exists as a type, a layer kind or an import path.
`psd-utils.ts` — the `visit()` walk inside `loadPsd()` — warns that `adjustment`, `mask` and
`clipping` are "unsupported and not preserved" on import, so a PSD written by Photoshop loses them on
the way in. There is no Properties panel (`PanelId = 'history' | 'layers'`, `PanelLayout.tsx` —
`PanelId`). What exists is a
**retained per-layer operation stack** — `FilterLayerOperation | AffineLayerOperation`
(`layer-types.ts` — the `LayerOperation` union) — which retains an adjustment and re-renders it, and
cannot re-edit it: the only writer is the tool that created it, and the stack is a list, not a
settings object with a UI.

**Why it is too hard.** An adjustment layer is not a rendering feature; it is a **document-model** one.
It needs a layer kind, a settings payload that survives serialization, a mask, and a Properties panel
that can render and write back settings that no tool owns — plus the history interaction, since an
adjustment's parameters change without changing pixels and the linear history model has no entry for
that. Every one of those is a type change with a durable-path consequence, which is why the whole
`Image > Adjustments` family above it is recorded as disabled rather than half-built.

**What the app does instead.** Destructive `Image > Adjustments` on the active layer, and a retained
operation stack that can re-render but not re-edit. It is non-destructive in retention only, which is a
narrower thing than the word means and must not be described as smart objects — `docs/FEATURES.md`'s
Non-destructive editing section is where that distinction is already drawn.

### Dodge, Burn, Sponge and Smudge build-up while the button is held

**Not a handoff item.** The gap is real but it is recorded here as a capability decision, and per
this file's own policy nobody treats its absence as a defect. The rail entries for these ids are
`HANDOFF.md` §74's — the rail-clone decision, which names Sponge among the entries to replace —
which is a separate decision.

**What Photoshop does.** Dodge, Burn, Sponge and Smudge accumulate for as long as the button is
held. The result depends on how long the cursor rested in each place, which is the entire point of
the tool — it is a hand-mixed exposure, not a filter. **On the Sponge it is worse than an
inconvenience**, because Flow is a per-DAB rate there rather than a per-pass one: the CS-era
documentation calls Flow "the opacity of each spot of colour a tool delivers", and every tutorial
retouches with a low Flow and repeated passes, so a one-shot commit at Flow 50% is not the tool at
a setting — it is half the whole effect in one pass.

**What this app does.** One commit per stroke, on pointer-up. The reason is written down where the
implementation is (`dodgeBurn.ts` — `applyDodgeBurn()`'s doc comment, and the same paragraph restated
in `sponge.ts` — `applySponge()`'s doc comment):

> There is no build-up. Photoshop's dodge and burn accumulate for as long as the button is held, which
> is a per-frame effect with no single end value; a one-shot commit has to be a pure function of its
> args instead, which is also what makes the registry's `requiresRaster: true` replay reproduce the
> commit exactly.

**The Sponge's own cost is a wrong meaning for a labelled control, which is a stronger form of the
same gap than the other three carry.** Flow means "the strength of one dab" in Photoshop and "the
entire effect of the stroke" here, and the two coincide only at 100%. A user who sets 20% and paints
once gets a fifth of what Photoshop gives them at the same number, with nothing on the bar saying
so. The control is present, named Photoshop's, and does not do what its name says — which is the
half-version this file's policy refuses.

**Smudge is a different case and must not be folded into this entry's evidence.** The app's Smudge
_does_ accumulate, along the stroke rather than over dwell time: `smudgeStroke` is a read-modify-write
because "`blendPixel` composites over what is already there, and a smudge accumulates along the
stroke" (`smudge.ts` — `smudgeStroke()`'s doc comment). What it has no build-up for is the same dwell
half — how long the cursor rests in one place while the button is held — and that is the half this entry
is about. The
per-dab path accumulation is why the Smudge entry's own cost is memory, not commit discipline.

**Why it is too hard, and the constraint is architectural rather than incidental.** This is the one
entry in this file where the obstacle is not the algorithm — accumulating light is easy — but the
replay contract. A `commit: 'raster'` tool's commit must be a pure function of its args, because
`HistoryItem[]` is the production replay authority and `requiresRaster: true` replay has to
reconstruct the same pixels from the recorded args. Dwell accumulation makes the commit a function of
wall-clock time as well, so the same args replay to a different image. That is a different half of
the replay contract from the one the presentation boundary covers — a promoted cache reaches a
published layer only inside the reducer's `PROMOTE_LAYER_PRESENTATIONS` arm
(`StoreContext.tsx`), and `docs/ARCHITECTURE.md` §"The presentation cache" is the
one home for that — so what dwell accumulation breaks is commit purity, not cache publication. Changing
the commit discipline for dwell tools is a history-architecture change with a migration attached,
not a processor edit.

**What the app does instead.** One application of the effect at the tool's Exposure value — or, on the
Sponge, at its Flow value — committed on release. Both are per-stroke settings, which is what the bar
shows and what the commit can honour.

### Path Type = Path for the shape tools

**What Photoshop does.** Each shape tool's bar has a Type row — Shape, Path, Pixels. Path fills the
interior and strokes the outline, creating a work path instead of pixels, and a Paths panel holds
those paths so they can be edited, saved, and used as vector masks.

**What this app does.** It drops the interior and stops there (`shape.ts` — `drawShape()`):

```ts
const hasFill = args.toolMode !== 'path' && !!args.hasFill && !!args.backgroundColor;
```

That third term is a separate, later fix — a figure with no background colour is not filled, so a
Path-mode selection is not the only way to get an unfilled polygon. The shape is still rasterised. What the user gets in Path mode is the same filled-or-not polygon,
drawn as pixels.

**Why it is too hard.** It is the same missing work-path object the Pen family needs, plus the Panels
and the vector-mask semantics that let a path outlive a rasterisation. Delivering Path mode as a
fill toggle is the half-version this policy refuses: it renders, it looks like the real control, and
it discards the thing the control is for.

**What the app does instead.** An unfilled stroked shape. The control is present and named
Photoshop's, and it does not do what its name says.

### Per-shape Fill and Stroke swatches with Gradient and Pattern

**What Photoshop does.** Two independent swatches per shape — Fill and Stroke — each opening a menu
of None, Solid Color, Gradient and Pattern. Fill and stroke are separate paint sources, not one
foreground colour.
<https://helpx.adobe.com/photoshop/using/fill-and-stroke-shapes.html>

**What this app does.** One `Filled` checkbox over the global foreground/background pair
(`Shape.tsx` — the `filled-toggle` checkbox):

```tsx
<input
  id="filled-toggle"
  type="checkbox"
  checked={hasFill}
  onChange={handleFillToggle}
  ...
/>
<label htmlFor="filled-toggle" ...>
  Filled
</label>
```

There is no second swatch, and the single control reads the global colours.

**Why it is too hard.** Two independent paint sources, where one of the four choices is a CSS filter
chain and another is a pattern tile. The app's colour model is a foreground/background pair shared by
the swatches in the toolbar; per-object paint is a change to how a shape carries its own appearance,
and Pattern in particular needs a pattern engine that does not exist here.

**What the app does instead.** A `Filled` checkbox and a line-style control. A shape is filled from
the toolbar's foreground colour, or not filled.

### The Brush Settings panel and Symmetry

**What Photoshop does.** The Brush Settings panel holds Tip Shape, Spacing, Angle Jitter, Roundness
Jitter, Shape Dynamics, Scattering, Texture, Colour Dynamics, Transfer and Noise, Wet Edges and
Protect Texture. Symmetry is a separate butterfly control offering Vertical, Horizontal, Dual Axis,
Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala, present for the Brush, the Pencil
and the Eraser, and it mirrors every dab live as the stroke is drawn.
<https://helpx.adobe.com/photoshop/using/paint-symmetry.html>

**What this app does.** The names appear in `src/`, but only as strings in the generated description
data — `paint.ts` carries `control: 'Symmetry'` in a table the docs
generator reads. There is no Symmetry symbol in any implementation, and no settings panel. The
`Symmetry` identifier being greppable in `src/` is a property of the descriptions, not evidence of
anything: the only other hit outside `src/tools/descriptions/` is `Paint.test.tsx` — the
`it('no longer renders the TODO placeholder it replaced')` case, whose
`['Flow', 'Airbrush', 'Symmetry', 'Auto Erase']` loop asserts Symmetry's
**absence**.

**Why it is too hard.** The panel is a per-dab pipeline: jitter and dynamics are evaluated at each
stamp, not at commit. The app's paint commit is a single `stroke()` per stroke
(`DrawToolArea.tsx` — `handlePointerUp()`), which has no per-dab step to jitter or mirror at. The
Eraser's own documentation already records this consequence for a much simpler control — Flow is
rendered with Photoshop's label and disabled, because Flow is a per-dab alpha ramp and a single
`stroke()` cannot honour one. Symmetry is the same constraint at ten times the scope.

**What the app does instead.** Per-stroke settings — Size, Opacity, Flow where it applies, Mode — and
one stamp per stroke. Nothing varies between one point of a stroke and the next.

### Erase to History, and the Eraser's Airbrush build-up

**What Photoshop does.** Erase to History turns the same drag into a restore, painting the area back
to whichever history state or snapshot is set in the History panel; holding Alt does it temporarily
for the length of the drag. Airbrush erases continuously while the button is held.
<https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html>

**What this app does.** Neither control is rendered, and the Eraser's tests pin the absence
(`Eraser.test.tsx` — the
`it('does not render an Erase-to-History control, which has no history source here')` case):

```ts
expect(screen.queryByLabelText(/Erase to History/i)).toBeNull();
```

**Why it is too hard.** Erase to History needs a raster of a _named history state_ to paint back to,
and the app's history stores tool args to replay, not retained rasters to sample from. The Airbrush
half is the build-up constraint already recorded above: a one-shot commit cannot accumulate.

**What the app does instead.** A stroke that subtracts alpha from the active layer, committed on
pointer-up, which is the right model for the tool as far as it goes — the Eraser edits in place and
never creates a layer, unlike the Brush.

### Layer opacity, and the paint model

**What Photoshop does.** Every layer carries an opacity the user sets, and a brush stroke paints
into the layer that is already there, subject to the layer's kind and protection state. Current
Photoshop's Brush has a documented exception for type, shape, Smart Object, and adjustment layers:
it creates a new transparent layer rather than prompting to rasterize. The full editability,
rasterization, mask, and lock matrix belongs in [`LAYERS-PANEL.md`](LAYERS-PANEL.md#92-layer-editability-and-rasterization-gates),
not in this tool difficulty record.

**What this app does.** `Layer.opacity` is a required field (`layer-types.ts` — `Layer.opacity`),
populated by PSD import (`psd-utils.ts` — the layer record `loadPsd()`'s `visit()` walk builds).
The desktop Layers panel and mobile drawer write it through a dedicated, titled and replayable
history action. Both sliders commit once per gesture; preset values remain unverified.

The paint model is the larger half. A brush stroke commits as a **new layer** rather than painting the
active one. `DrawToolArea` calls `createLayerFromTool` on commit
(`DrawToolArea.tsx` — `handlePointerUp()`), and the contrast with a tool that edits in place is
written down in `EraserToolArea.tsx` — its doc comment:

> `DrawToolArea` commits through `createLayerFromTool`, which is right for a painting tool: a new
> layer is the paint. It is wrong for the eraser, which subtracts alpha from the layer that is already
> there.

**Why it is too hard.** A new-layer-per-stroke model makes the stroke a discrete object with a
history entry of its own, which is what makes undo and the recorded e2e baselines work. Moving to
painting the active layer changes what a stroke _is_: it stops being a layer, becomes an operation on
one, and every consumer of the create-layer shape — the history model, the preview path, the recorded
baselines, the presentation cache — has to move with it.

**What the app does instead.** Each brush stroke becomes its own layer. Undo removes a whole stroke
cleanly, which is legible, and it is why a canvas with many strokes has many layers.

---

## Needs an operator decision

These are not engineering calls. Each one is a trade the operator owns: honouring the Photoshop-clone
rule costs a real capability in one case, and what an enabled menu item is allowed to promise is a
naming decision in another. They are recorded here so they are not re-derived, and so nobody
implements them as if they were engineering judgements.

### What an enabled `Image ▸ Adjustments` item may promise

`color`, `levels` and `transform` left the Tools rail on 2026-10-01 — the operator's ruling, recorded
in `HANDOFF.md` §74 and completed. They are now `Image ▸ Adjustments` and `Edit ▸ Transform`
**commands**, and `toolbar-mapping.ts`'s `extraTools` lists them as the registered tool ids that have no
rail entry. **What the two enabled items are called was settled on 2026-10-01 and is implemented:**
`Brightness/Contrast` and `Desaturate`.

`ADJUSTMENTS_ITEMS` (`DesktopHeader.tsx`) carries Adobe's list in
a reconstructed order, with **two items enabled and twenty disabled**. An item is enabled by carrying a
`toolName` and nothing else, and the rule has two halves rather than one: the optional `toolName?` on
the `MenuHostItem` type declares it (`DesktopHeader.tsx` — `MenuHostItem`), and the
`disabled={toolName === undefined}` on each button of the `ADJUSTMENTS_ITEMS` submenu render enforces
it (`DesktopHeader.tsx` — that submenu's `ADJUSTMENTS_ITEMS.map()`), so a disabled item is a
recorded absence rather than a fake. The type alone does not enforce it — an optional field states no
such rule — and the gate alone does not explain it, which is why the claim needs both.

**`levels` is `Brightness/Contrast`, not Levels — and that is honest, not a dodge.**
`LevelsToolArgs` is `{ brightness, contrast }` (`levels.ts` — `LevelsToolArgs`) and the processor
emits one `brightness(…) contrast(…)` filter (`functions.ts` — `buildLevelsFilter()`), which is
Adobe's Brightness / Contrast. **Adobe's Levels is unbuilt**: three control points, a histogram, a
channel selector, output levels and Auto. That capability has its own entry below.

**`color` is `Desaturate`, because its leading control is the computation Adobe's Desaturate
performs.** Its three controls are grayscale, sepia and saturation (`functions.ts` —
`ColorsFilterArgs`). Adobe's Desaturate "converts a color image to grayscale values, but leaves the
image in the same color mode", and "assigns equal red, green, and blue values to each pixel in an RGB
image" (<https://helpx.adobe.com/photoshop/using/applying-special-color-effects-images.html>) — which is what `grayscale(100%)` does, and `e2e/adjustments.spec.ts` asserts the
three channels come out **equal** rather than close. Adobe adds that the command "has the same effect as
setting Saturation to minus (-)100 in the Hue/Saturation adjustment", which is the bar's `saturation`
slider, so two of the three controls are the command it is named for. **`sepia` is the bounded
divergence**: it belongs to neither command, and Adobe's Desaturate is a one-shot command with no dialog
where this bar is three continuous sliders.

**The naming rule, which the operator settled and which now binds every adjustment command.** An item
takes Adobe's name, and takes it **only if it computes that command**: "use naming that photoshop has",
2026-10-01. An item whose computation does not match its Adobe name is a falsehood and does not get
enabled — which is why `Levels` and `Black and White` are `disabled` items rather than relabelled ones,
and why an app-invented name (`Colors`) is not available as a fallback. Applied to `color` it is what
moved the item below.

**`Photo Filter` used to be the enabled item and was the falsehood this corrects.** Adobe's Photo
Filter is a hue adjustment from a preset filter or a custom colour, with a Density slider and
Preserve Luminosity
(<https://helpx.adobe.com/photoshop/using/applying-color-balance-adjustment.html>) — the bar
reproduced **none** of those three, and `grayscale` is a conversion to luminance that Photo Filter never
performs, so the enabled item opened a bar its own label did not describe. It is a `disabled` item now,
which is this menu's rule applied: the capability is unbuilt. The row cannot simply have been dropped,
because `color` is in `extraTools` and this submenu is the only surface the Colors panel is reachable
from — and the app's `color` is not Adobe's Black and White either (that entry, below), so `Desaturate`
is the one Adobe command in this submenu the bar's leading control actually computes.

**The rest of `Image ▸ Adjustments` is disabled, and that is the accurate state of this app.** The app
has no adjustment-layer machinery at all: `psd-utils.ts` — the `visit()` walk inside
`loadPsd()` — warns that `adjustment`,
`mask` and `clipping` are unsupported and not preserved on import. What exists instead is a retained
per-layer operation stack — `layer.operations[]` re-rendered as a CSS filter string by
`getLayerFilter` (`layer-renderer.ts`, applied by `drawLayerSource()`) — which retains an adjustment
but cannot re-edit it and has no properties panel. That capability has its own entry below.

**The operator has put this family back on the list**, 2026-10-01: Levels, Colors and the other
`Image ▸ Adjustments` commands "will be implemented". That makes every entry above a **known gap with
a known destination** rather than a decision to skip, and it **suspends this file's own "nobody
re-audits it, nobody estimates it" policy for the `Image ▸ Adjustments` family** — otherwise the next
session reads this file by its stated policy and treats the gap as closed. The requirements are not
written down, so none of this is a spec: Adobe's behaviour in each entry is the requirement, and an
agent implementing from the requirement rather than from the app's current CSS-filter chain is
implementing it correctly. The black-and-white entry above carries the same signal for the same
reason.

**One thing this file does not decide, because it is not a capability question.** Whether
`Image ▸ Adjustments` bakes pixels or creates adjustment layers changes the durable schema, not the
UI, and it is unanswered. `HANDOFF.md` §172 carries it, and `docs/PHOTOSHOP-UX.md`'s "No adjustment is
a tool is too strong" bullet carries the separate fact that Adobe's Adjustment Brush is a real
Tools-panel entry — which is why the rail decision and the general statement about adjustments are
different claims.

### Three invented controls on the Magnetic Lasso bar

Photoshop's Magnetic Lasso bar carries `Stylus Pressure` and `Select and Mask`. This app puts three
controls there instead: `Snap`, `Smooth` and `Preview feather`
(`FeatherMagneticLasso.tsx` — the three controls, by their bar labels).

**They are wired, and they work.** `Snap` is the cursor-pull strength: the weight given to the
gradient search that picks the edge point the path locks onto
(`magneticLasso.ts` — the `options.snapStrength` `createMagneticSegment()` hands
`findStrongestGradientPoint()`), which is the closest thing here to Photoshop's
pressure-driven behaviour. `Smooth` is path simplification in pixels. `Preview feather` renders the
outline the feather would produce. All three write real args; none is inert.

**The trade.** Removing them honours the Photoshop-clone rule and loses real capability, including the
control that decides how hard the path locks onto an edge. Keeping them violates a product requirement
stated as non-negotiable in `AGENTS.md`. The operator owns that trade, and it should be made
explicitly rather than by whichever agent touches the bar next. Note that `Select and Mask` is itself
too hard (above), so one of the two Photoshop controls has no honest replacement available today.

### The Adobe tools the rail omits

The rail does not carry a number of Adobe tools. The full roster, keyed by Adobe's own
identity for each tool — name, group, shortcut, headline options, and a source — is
[`TOOLS-INVENTORY.md`](TOOLS-INVENTORY.md), which took this list over. That file also records
the current candidate rows and the unresolved default-roster evidence. The older 30-entry list and
`HANDOFF.md` §74's 34-to-add arithmetic are historical, not a current target: Adobe publishes no
complete numbered default Tools-panel roster. `TOOLS-INVENTORY.md` now separates the current
non-preview candidates from the default-off Content-Aware Tracing preview and records the source-backed
map counts instead of adding historical totals.

What follows is only why the absent tools follow from this file, not a restatement of the
list itself.

**Custom Shape is now the only absent rail entry among the shape tools.** It is the strongest
documented absent rail entry, and it is a separate candidate from Star. The flyout carries Rectangle,
Ellipse, Line, Triangle, Polygon and Star (all implemented via the shared `shape` processor) plus
Custom Shape (absent — `commit: 'unimplemented'`) (`toolbar-mapping.ts` — `toolbarMap`'s shape flyout),
while Adobe documents Star as a separate tool with its own points and inner/outer radii. Star's
sourced behavior and implementation are in `src/tools/descriptions/shape.notes.md`; the `.csh`
parser and preset library that block Custom Shape do not block Star. The Star geometry, controls
and integration are already implemented; only Custom Shape remains unimplemented.

**The rest follow from this file.** The Pen family and Path Type are the work-path object that
Path Selection and Direct Selection would edit. Object Selection needs an edge-following
segmentation comparable to the Quick Selection entry. History Brush and Art History Brush
need the retained-raster history model that Erase to History needs. Perspective Crop is the
Crop entry's transform work.
