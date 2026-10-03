# Tools — too hard, and not attempted

**The policy this file records.** When a Photoshop tool capability is too hard to implement in this
architecture, we skip the implementation and record it here rather than shipping a fake or a
half-version. A capability listed here is a decision, not a backlog item: nobody re-audits it, nobody
estimates it, and nobody treats its absence as a defect. An entry is deleted only when the capability
lands — see the lifecycle rule in `docs/DOCUMENTATION.md:170-183`: **fixed and verified DELETES the
entry**, never rewrites it into a closed one.

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

Line-number citations into a growing source file go stale, and the prose at a stale line still reads
plausibly, which is why a `grep` sweep does not catch it. `AGENTS.md` records the measurement: on one
branch, inserting lines into `StoreContext.tsx` left nearly every citation below the insertion point
wrong. **Re-derive a citation from the sentence that contains it, never from the old number.**

To check one without moving through the file by eye, print the line and its neighbours and read them
against the claim the sentence makes:

```bash
sed -n '165p' src/tools/quickSelection.ts
```

A citation that resolves to a blank line, an import, a closing brace or a neighbouring function is
wrong even though the file and the number both exist. If a cited symbol has moved, the fix is the
citation in this file, not the code.

---

## TOO HARD — a new algorithm or engine is required

### Quick Selection's edge-following segmentation

**What Photoshop does.** The Quick Selection tool "automatically finds and follows defined edges in
the image" as you paint, so a stroke over a subject snaps to the subject's boundary rather than
spreading across everything of a similar tone.
<https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html>

**What this app does.** Each dab runs a contiguous flood fill and nothing else
(`src/tools/quickSelection.ts:165`):

```ts
const result = floodFill(imageData, seed, { tolerance, contiguous: true });
```

Growth is a function of colour similarity to the seed and of nothing in the image's neighbourhood, so
there is no term that can stop it at an edge. On any gradient the selection bleeds across the object.

**Why it is too hard.** Edge-following is not a threshold to tune; it is a different algorithm. It
needs a gradient or structure tensor over the image, a per-dab decision about whether the local
neighbourhood supports expansion, and the confidence model that decides when a boundary is an edge and
when it is texture. None of that exists in the app, and every layer of it would sit under the growth
loop above rather than beside it.

**What the app does instead.** A tolerance-driven flood fill that merges everything within tolerance
of the seed. Users tune Tolerance to keep it from bleeding, which trades a leaking edge for a ragged
one. The bar's controls match Photoshop's; the segmentation underneath does not.

### Selection combination modes

**What Photoshop does.** Every selection tool's options bar carries New / Add To / Subtract From /
Intersect With, so the next drag combines with the selection already on the canvas, and Shift,
Alt/Option and Shift+Alt/Option held during the drag set the same four modes.

**What this app does.** No selection tool's bar renders any of the four. A second selection appends
and activates. The union is not a missing control over a present model — it is a change to the model.
`Selection` is a single point path (`src/contexts/general-types.ts:61-64`):

```ts
export type Selection = {
  id: string;
  points: Point[];
  isActive: boolean;
```

Union and intersect are per-pixel operations, and a single point path cannot express them without
rasterising. The shared module `src/util/selection.ts` is where a committed polygon becomes a
selection, and every selection tool area, the clipboard and the pixel utilities read through it, so the
change is not confined to one tool.

**Why it is too hard.** It is a change to the type every selection consumer reads, made by tools that
each own a different geometry (an axis-aligned box, an inscribed ring, a traced contour, a freehand
lasso path). Booleans need a mask; the app has a polygon. The `metadata` field on `Selection` is where
a hidden mask would have to ride, and every writer of `points` would then have to write it in step.

**What the app does instead.** New-selection semantics only. Making a second selection replaces the
first in practice for every workflow the app supports, because there is no way to express a union.

### Select and Mask, and the Select menu

**What Photoshop does.** Every selection tool's bar carries a Select and Mask button, opening a
workspace where the result is refined with a Refine Edge Brush, a plain Brush, and Radius, Smooth,
Contrast, Shift Edge and Decontaminate Colors, then output as a selection, a layer mask, a new layer or
a new document. <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html>

**What this app does.** There is no `Select` menu. The menu bar exists and has five menus — File,
Tools, Image, Edit, Window (`src/components/DesktopHeader/DesktopHeader.tsx:322`, `:423`, `:452`,
`:472`, `:512`) — and `Select` is not one of them, so there is nothing for Select and Mask to hang
from.

**Why it is too hard.** Select and Mask is not a dialog over the existing model — it is the workspace
where most of a selection tool's real accuracy actually lives, and it consumes the missing combination
modes above as its substrate. Building it means adding a `Select` menu, a per-tool
`Select and Mask` button, a Refine Edge Brush with its own edge-detection model, and an output
dialog. That is a build, not a feature.

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
that exist are File, Tools, Image, Edit and Window
(`src/components/DesktopHeader/DesktopHeader.tsx:322`, `:423`, `:452`, `:525`, `:559`) — and no
selection operation implements them: `src/util/selection.ts`
exports no inverse, no morphological grow or shrink, and no blur-based feather over a selection, though
it does compute a feathered alpha for the outline it draws.

**Why it is too hard.** Every one of these is a whole-image operation on a selection the app stores as
a polygon. Feathering a polygon is not feathering its outline; a correct Feather is a distance
transform followed by a smoothstep, on a mask, and the app has no mask to run it on. This is the same
missing substrate as Select and Mask above, and it is the reason the first entry in this section is a
type change.

**What the app does instead.** No selection can be inverted, grown, shrunk or feathered after the
fact. A selection is what the last tool drew, and the only edits available are copy, paste and clear
from the marquee's bar.

### Regions with holes

**What Photoshop does.** Selects a donut, a mug handle or a face correctly: the selection is the
material inside the region, and the enclosed background inside it stays unselected.

**What this app does.** Refuses. The boundary tracer classifies loops and then rejects the whole
region if any of them is a hole (`src/util/magicWand.ts:218`):

```ts
if (holes.length > 0) return null;
```

The quick selection reaches the same conclusion by a different route and reports it rather than
resolving it. `hasHoles` is carried on the result and explained at `src/tools/quickSelection.ts:455-463`:

> `hasHoles` is reported rather than resolved, because this data model cannot resolve it: a
> `Selection` carries one point path, so committing the outer contour of a region with a hole would
> cover pixels the mask reports as unselected — the user would drag a brush around a mug handle and
> select the handle's background with it.

The tool area acts on the flag and drops the stroke, logging the reason
(`src/components/Main/QuickSelectionToolArea.tsx:204-208`):

```ts
if (polygon?.hasHoles) {
  console.warn(
    `quick-selection: the grown region has an enclosed hole, which a single-polygon selection cannot ` +
      `represent, so nothing was committed (${polygon.pixelCount} pixels grown)`
  );
}
```

**Why it is too hard.** Refusing is the only correct answer a single-polygon model can give, and the
comment says so. Supporting a hole means `Selection` becomes multi-polygon — the same type change the
combination modes need — plus a rasteriser that honours outer-plus-holes rather than outer-only, on
every path that turns a polygon into pixels.

**What the app does instead.** The stroke is dropped, the warning names the reason, and a selection
is never wrong. It is missing, not silently degenerate: a user who draws a ring gets nothing rather
than a filled disc.

### The Pen family

**What Photoshop does.** Pen, Freeform Pen, Curvature Pen, Add Anchor Point, Delete Anchor Point and
Convert Point are the drawing group's core. They edit a work path of anchor points with direction
handles, with Auto Add/Delete and Rubber Band controlling how the next click lands, and the resulting
path can be stroked, filled or converted to a selection.
<https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html>

**What this app does.** All six are `commit: 'unimplemented'` in the processor registry
(`src/tools/toolProcessors.ts:343-368`), against a shared null-bitmap stub declared at
`src/tools/toolProcessors.ts:118`:

```ts
const unimplemented = () => () => [null as never] as ToolResult;
```

They are in the rail, with Adobe's names, because the rail is a clone and the grouping is the
specification. None of them has a gesture surface: `Main`'s tool-area dispatch has no branch for any
of them, so the default handler stands (`src/components/Main/Main.tsx:225`) and the same fallback
closes the dispatch (`src/components/Main/Main.tsx:250`), which is the inert `display: none` surface
every unrouted tool gets.

**Why it is too hard.** A work path is a first-class document object: anchors, bezier direction
handles, open and closed state, and the Auto Add/Delete and Rubber Band gestures that decide what a
click means. The app has no path model at all — `Selection` is one point path and a shape is a
rasterised polygon — so the Pen family is not six tools to implement but a document layer to design,
and the Path Type entry below is the same work seen from the shape tools.

**What the app does instead.** The six tools are in the rail under Adobe's names and mount a stub
options bar. `AGENTS.md` is explicit that this is the correct state for a tool the app cannot do: the
Photoshop grouping and naming are the specification, and the stub bar is the debt.

### Custom Shape

**What Photoshop does.** Draws from a library of preset shapes stored in `.csh` files, and the user
can add to it with Edit ▸ Define Custom Shape and manage it in the Preset Manager. Star is the
seventh entry in the shape flyout alongside Rectangle, Ellipse, Triangle, Polygon and Line.

**What this app does.** `commit: 'unimplemented'` at `src/tools/toolProcessors.ts:374-378`, the same
null-bitmap stub, and no gesture surface. The tool is in the rail under Adobe's name.

**Why it is too hard.** It is three things, not one: a parser for the shape-preset format, the preset
library itself, and the authoring and management surfaces. None of the format's structure is present,
and shipping a hardcoded star would be exactly the fake this policy refuses.

**What the app does instead.** A stub bar. The shape flyout carries six entries
(`toolbar-mapping.ts:114-121`) and Star is the missing one, which `AGENTS.md` records as a
requirement rather than an omission to be filled by a placeholder.

### Live type

**What Photoshop does.** Type is live. It is resolution-independent, reflows inside a text box when
the box is resized, can be re-typed in place, and carries an on-canvas caret. Scaling it up is not a
resample; it re-renders.

**What this app does.** Text is baked to pixels at commit. The renderer writes the string with
`fillText` (`src/tools/text.ts:55`) into a layer-sized raster, and the processor returns that raster
as the tool's whole result (`src/tools/text.ts:72-81`):

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

`renderText` is a measure-and-draw function over a string (`src/tools/text.ts:28`), and nothing
re-runs it against the committed pixels.

**Why it is too hard.** It needs a text layout engine, font shaping and rasterisation, and an
on-canvas editing surface with a caret, selection and IME input. The app also has a replay contract
that makes this harder than it looks: `HistoryItem[]` is the production replay authority, and a
replayed type entry has to reproduce the same pixels from its args on any host. A live text object is
not a raster and does not survive that unchanged.

**What the app does instead.** A raster that cannot be edited after the fact. Changing the text
commits a new layer.

### Free Transform as an interactive bounding box

**What Photoshop does.** One continuous drag with handles for Scale, Rotate, Skew, Distort,
Perspective and Warp, a draggable reference point for the transform origin, Shift/Alt constraints, and
commit on Enter. <https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html>

**What this app does.** A fixed-parameter panel. The options bar publishes a preview through
`tempUpdateLayer`, and the geometry is committed when the gesture ends: a drag previews until the
pointer is released and then lands as one history entry, bound to the browser's native `change`
event rather than to React's `onChange`, which is the per-frame `input` event
(`src/components/ToolbarsRight/Transform/Transform.tsx:54-69` and `:80`). Switching tool
(`src/hooks/useApp.ts:167`) and exporting still commit too. The bar carries no commit control and no
discard control; the whole right-hand column is the two mirror toggles, centered in the slack the
removed links left behind (`:314`), and Escape — handled at `:31-39` — is the only route that
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
"Go to the Fill dropdown in the Options bar and select Content-Aware Fill" — with Generative Expand the
cloud value described below.
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html>

**The bar carries no Curve, and Adobe does not claim that it does.** Adobe's own enumeration of the
bar's controls is the _Crop tool options_ page, last updated 23 Feb 2026: it lists the aspect-ratio
values, and in the gear menu Delete Cropped Pixels, Use Classic Mode, Auto Center Preview, Show Cropped
Area and Enable Crop Shield — no Curve among them. Straighten and Fill are documented on sibling pages,
and the Curve Photoshop documents is the separate Curves adjustment, recorded under
[Curves — a spline over the tonal range](#curves--a-spline-over-the-tonal-range) below.
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html>

**Generative Expand** is the value that flow is built around: "From the Tools panel, select Crop tool
and drag the crop handles outward to expand the canvas", then "Leave the prompt blank and select
Generate to let Photoshop extend the image" and "Choose a variation from the Properties panel". The
model is picked from Adobe's Firefly list in the Contextual Task Bar, so the pixels in the added band
are computed by a cloud service and arrive on a layer of their own.
<https://helpx.adobe.com/photoshop/desktop/create-open-import-images/create-images/explore-beyond-the-canvas-with-generative-expand.html>

**What this app does.** The frame grows and nothing is filled. `applyDocumentCrop` takes the gesture
rect **unclamped** — `sortRoundRect` (`src/util/rect.ts:84`) sorts it and rounds each edge once, with
no clamp to the document — so a rect dragged past an edge produces a larger `documentFrame`
(`src/contexts/useLayer.ts:839`, the next frame computed at `:840` and compared against the current
one):

```ts
const { x, y, width, height } = sortRoundRect(rect);
```

The crop is registered as a `document-operation` (`src/tools/toolProcessors.ts:157-162`), so the
commit is a frame edit and not a raster: it dispatches no fill of any kind, and the band the growth
adds is covered by no layer and left transparent whatever the bottom layer is — the operator's
decision, recorded as OVR-1 in [`OVERRIDES.md`](./OVERRIDES.md).

The **Fill** control is not rendered at all: the bar carries an `Aspect Ratio` select and two buttons,
`Apply` and `Clear` (`src/components/ToolbarsRight/Crop/Crop.tsx:55-95`), and the only file under
`src/` naming Content-Aware or Generative is the generated tool description
(`src/tools/descriptions/type-crop.ts:241-245`), which is documentation data rather than code.

**Why it is too hard.** Straighten alone is a rotation, which the app has elsewhere, but it is the
gesture and the box relationship that is the feature. Content-Aware is a patch-based synthesis model
with no analogue in this codebase at all, and Generative Expand is a cloud generative feature: a model
server answers with three variations that land on a new generative layer. Neither is a gap in the crop
processor — it is a gap in what the app is. The app has no network surface anywhere under `src/`, and
a tool commit is a synchronous call returning `[BitmapSource, Partial<Pos>?]`
(`src/tools/toolProcessors.ts:37`, the processor signature at `:75`), which is the shape a server round
trip and three returned variations cannot take.

**What the app does instead.** An axis-aligned rect with a ratio lock, which may be dragged past the
image edge: the canvas grows and the added band is transparent. The commit path is honest about what
it takes — a rect, the current frame, and one document edit — and it says so by writing no fill.

**The frame growth is not this entry's capability, so the growth deletes nothing here.** What this
entry records is Straighten, Content-Aware and Generative Expand. Growing the canvas is a fourth thing,
and the cheapest of Adobe's Fill values, decided by the operator rather than synthesised. Patch-based
synthesis and a cloud generative call are not landing, so this entry stays open under the lifecycle
rule in the preamble, and what survives the growth is Adobe's behaviour, which a transparent band does
not change.

### Black and White as a hue-sextant weighted mix

**What Photoshop does.** Six independent sliders, one per hue sextant — reds, yellows, greens, cyans,
blues and magentas, each defaulting to a different value — so a conversion is a weighted mix that can
push one family of hues toward white and another toward black.
<https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html>

**What this app does.** A three-filter CSS chain over the whole layer
(`src/tools/functions.ts:60-62`):

```ts
export function buildColorsFilter({ grayscale, sepia, saturation }: ColorsFilterArgs): string {
  const saturate = adjustmentPercent(expAdjustment(saturation, SATURATION_EXPONENT));
  return `grayscale(${grayscale}%) sepia(${sepia}%) saturate(${saturate})`;
}
```

`grayscale()` is a flat luminance average with no hue dependence at all, and `sepia()` is a fixed
one-directional warm shift. The app's capability is reached at `Image ▸ Adjustments ▸ Photo Filter`,
where **Black and White is a disabled item** (`src/components/DesktopHeader/DesktopHeader.tsx:193`)
because nothing computes it — see the operator-decision section below for why `Photo Filter` is the
name the enabled item carries.

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
item (`src/components/DesktopHeader/DesktopHeader.tsx:208`), and the tool registered under the id
`levels` is not Levels either: `LevelsToolArgs` is `{ brightness, contrast }`
(`src/tools/levels.ts:5`) and the processor emits a single `brightness(%) contrast(%)` string
(`src/tools/functions.ts:66-70`). It is the app's `Brightness/Contrast`, reached at
`Image ▸ Adjustments ▸ Brightness/Contrast` (`DesktopHeader.tsx:187`).

**Why it is too hard.** Levels is a per-channel **lookup table**: three control points map an input
level to an output level, and every pixel in the selected channel is then a table index. The app has no
per-channel pixel path to build the table against — what it owns is a CSS `ctx.filter` string handed to
the canvas by `getLayerFilter` (`src/contexts/layer-renderer.ts:32`, applied at `:99`), and a filter
string cannot express an arbitrary LUT. The histogram is a second, separable piece: it is a 256-bucket
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
(`src/components/DesktopHeader/DesktopHeader.tsx:191`). There is no curve type, no control-point
model, and no evaluator anywhere in `src`.

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
`src/contexts/psd-utils.ts:88-106` warns that `adjustment`, `mask` and `clipping` are "unsupported and
not preserved" on import, so a PSD written by Photoshop loses them on the way in. There is no Properties
panel (`PanelId = 'history' | 'layers'`, `src/contexts/PanelLayout.tsx:89`). What exists is a
**retained per-layer operation stack** — `FilterLayerOperation | AffineLayerOperation`
(`src/contexts/layer-types.ts:31-46`) — which retains an adjustment and re-renders it, and cannot
re-edit it: the only writer is the tool that created it, and the stack is a list, not a settings object
with a UI.

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

### Dodge, Burn and Smudge build-up while the button is held

**Not a handoff item.** The gap is real but it is recorded here as a capability decision, and per
this file's own policy nobody treats its absence as a defect. The rail entries for the two ids are
`HANDOFF.md` §170's, which is a separate decision.

### Dodge, Burn, Sponge and Smudge build-up while the button is held

**What Photoshop does.** Dodge, Burn, Sponge and Smudge accumulate for as long as the button is
held. The result depends on how long the cursor rested in each place, which is the entire point of
the tool — it is a hand-mixed exposure, not a filter. **On the Sponge it is worse than an
inconvenience**, because Flow is a per-DAB rate there rather than a per-pass one: the CS-era
documentation calls Flow "the opacity of each spot of colour a tool delivers", and every tutorial
retouches with a low Flow and repeated passes, so a one-shot commit at Flow 50% is not the tool at
a setting — it is half the whole effect in one pass.

**What this app does.** One commit per stroke, on pointer-up. The reason is written down where the
implementation is (`src/tools/dodgeBurn.ts:248-252`, and the same paragraph restated at
`src/tools/sponge.ts:351-356`):

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
stroke" (`src/tools/smudge.ts:170-174`). What it has no build-up for is the same dwell half — how long
the cursor rests in one place while the button is held — and that is the half this entry is about. The
per-dab path accumulation is why the Smudge entry's own cost is memory, not commit discipline.

**Why it is too hard, and the constraint is architectural rather than incidental.** This is the one
entry in this file where the obstacle is not the algorithm — accumulating light is easy — but the
replay contract. A `commit: 'raster'` tool's commit must be a pure function of its args, because
`HistoryItem[]` is the production replay authority and `requiresRaster: true` replay has to
reconstruct the same pixels from the recorded args. Dwell accumulation makes the commit a function of
wall-clock time as well, so the same args replay to a different image. That is a different half of
the replay contract from the one the presentation boundary covers — a promoted cache reaches a
published layer only inside the reducer's `PROMOTE_LAYER_PRESENTATIONS` arm
(`src/contexts/StoreContext.tsx:647-660`), and `AGENTS.md`'s Architecture status section is the one
home for that — so what dwell accumulation breaks is commit purity, not cache publication. Changing
the commit discipline for dwell tools is a history-architecture change with a migration attached,
not a processor edit.

**What the app does instead.** One application of the effect at the tool's Exposure value — or, on the
Sponge, at its Flow value — committed on release. Both are per-stroke settings, which is what the bar
shows and what the commit can honour.

### Path Type = Path for the shape tools

**What Photoshop does.** Each shape tool's bar has a Type row — Shape, Path, Pixels. Path fills the
interior and strokes the outline, creating a work path instead of pixels, and a Paths panel holds
those paths so they can be edited, saved, and used as vector masks.

**What this app does.** It clears `hasFill` and stops there (`src/tools/shape.ts:196`):

```ts
const hasFill = args.toolMode !== 'path' && args.hasFill;
```

The shape is still rasterised. What the user gets in Path mode is the same filled-or-not polygon,
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
(`src/components/ToolbarsRight/Figures/Shape.tsx:209-222`):

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
data — `src/tools/descriptions/paint.ts:91` lists `control: 'Symmetry'` in a table the docs
generator reads. There is no Symmetry symbol in any implementation, and no settings panel. The
`Symmetry` identifier being greppable in `src/` is a property of the descriptions, not evidence of
anything: the only other hit outside `src/tools/descriptions/` is
`src/components/ToolbarsRight/Paint/__tests__/Paint.test.tsx:157`, which asserts Symmetry's
**absence**.

**Why it is too hard.** The panel is a per-dab pipeline: jitter and dynamics are evaluated at each
stamp, not at commit. The app's paint commit is a single `stroke()` per stroke
(`src/components/Main/DrawToolArea.tsx:143`), which has no per-dab step to jitter or mirror at. The
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
(`src/components/ToolbarsRight/Eraser/__tests__/Eraser.test.tsx:201`):

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
into the layer that is already there.

**What this app does.** Layer opacity has no writer: `Layer.opacity` is a required field
(`src/contexts/layer-types.ts:58`), PSD import populates it (`src/contexts/psd-utils.ts:159,229`) and
materialization applies it, and nothing in the app ever writes it. The defect and its
blast radius are `HANDOFF.md` §56 (`HANDOFF.md:816`); it is recorded here only because closing it is
not a small change.

The paint model is the larger half. A brush stroke commits as a **new layer** rather than painting the
active one. `DrawToolArea` calls `createLayerFromTool` on commit
(`src/components/Main/DrawToolArea.tsx:143`), and the contrast with a tool that edits in place is
written down at `src/components/Main/EraserToolArea.tsx:18-20`:

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

### The two enabled `Image ▸ Adjustments` items are named for capabilities the app does not have

`color`, `levels` and `transform` left the Tools rail on 2026-10-01 — the operator's ruling, recorded
in `HANDOFF.md` §74 and completed. They are now `Image ▸ Adjustments` and `Edit ▸ Transform`
**commands**, and `toolbar-mapping.ts`'s `extraTools` lists them as the registered tool ids that have no
rail entry (`toolbar-mapping.ts:172-189`). What is still open is not where they live but **what the two
enabled items are called**, because both names are a partial match and neither is a match.

`ADJUSTMENTS_ITEMS` (`src/components/DesktopHeader/DesktopHeader.tsx:186-209`) carries Adobe's list in
a reconstructed order, with **two items enabled and twenty disabled**. An item is enabled by carrying a
`toolName` and nothing else (`DesktopHeader.tsx:147-150`, `:488`), so a disabled item is a recorded
absence rather than a fake.

**`levels` is `Brightness/Contrast`, not Levels — and that is honest, not a dodge.**
`LevelsToolArgs` is `{ brightness, contrast }` (`src/tools/levels.ts:5`) and the processor emits one
`brightness(…) contrast(…)` filter (`src/tools/functions.ts:66-70`), which is Adobe's Brightness /
Contrast. **Adobe's Levels is unbuilt**: three control points, a histogram, a channel selector, output
levels and Auto. That capability has its own entry below.

**`color` is `Photo Filter`, and `grayscale` is a control Photo Filter does not have.** Its three
controls are grayscale, sepia and saturation (`src/tools/functions.ts:60-63`). Adobe's Photo Filter is a
hue adjustment from a preset filter or a custom colour, with a Density slider and Preserve Luminosity
(<https://helpx.adobe.com/photoshop/using/applying-color-balance-adjustment.html>) — so `sepia` picks
the kind of colour Adobe's presets pick and `saturation` is the trim Preserve Luminosity performs, but
**`grayscale` is a conversion to luminance that Photo Filter never performs**. The alternative name is
worse: the app's `color` is not Adobe's Black and White either (that entry, below), so the honest
options were a bounded partial match or a wrong name. The open question is whether to drop the
`grayscale` control or move it to `Desaturate`, which is the operator's to make — `HANDOFF.md` §168.

**The rest of `Image ▸ Adjustments` is disabled, and that is the accurate state of this app.** The app
has no adjustment-layer machinery at all: `src/contexts/psd-utils.ts:88-106` warns that `adjustment`,
`mask` and `clipping` are unsupported and not preserved on import. What exists instead is a retained
per-layer operation stack — `layer.operations[]` re-rendered as a CSS filter string by
`getLayerFilter` (`src/contexts/layer-renderer.ts:32`, applied at `:99`) — which retains an adjustment
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
(`src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:323-358` — `Snap` at `:323-335`,
`Smooth` at `:337-348`, and `Preview feather` at `:355-358`).

**They are wired, and they work.** `Snap` is the cursor-pull strength: the weight given to the
gradient search that picks the edge point the path locks onto
(`src/util/magneticLasso.ts:420`), which is the closest thing here to Photoshop's
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
the roster counts that disagree — the 30 names this section used to carry against "34 to
add" in `HANDOFF.md` §74 (`HANDOFF.md:1271`) — and leaves the discrepancy unresolved for
the operator. **One addition to its arithmetic, from this pass:** `HANDOFF.md` §74 names a
**sixth** absent tool the 30 never listed, **Content-Aware Move** (`HANDOFF.md:1325`), so the
union is 30 + 6 = **36**, two over the stated 34 rather than one. `TOOLS-INVENTORY.md` now carries
that name, at its Selection row.

What follows is only why the absent tools follow from this file, not a restatement of the
list itself.

**Star is the notable one**, because it is not a missing tool so much as a missing entry: the
shape flyout carries Rectangle, Ellipse, Line, Triangle, Polygon and Custom Shape
(`toolbar-mapping.ts:114-121`) and Star is the shape Adobe's list has that the flyout does
not. It is listed there rather than filed here separately because the same custom-shape work is
recorded as too hard above, and a hardcoded star would be the fake this policy refuses.

**The rest follow from this file.** The Pen family and Path Type are the work-path object that
Path Selection and Direct Selection would edit. Object Selection needs an edge-following
segmentation comparable to the Quick Selection entry. History Brush and Art History Brush
need the retained-raster history model that Erase to History needs. Perspective Crop is the
Crop entry's transform work. Zoom is worth one note of accuracy: the app has a zoom
_interaction mode_ on the canvas, and no Zoom _tool_ — the registry at
`src/contexts/tool-types.ts:30-89` has no entry for it, and the rail has none either.
