# Tools — too hard, and not attempted

**The policy this file records.** When a Photoshop tool capability is too hard to implement in this
architecture, we skip the implementation and record it here rather than shipping a fake or a
half-version. A capability listed here is a decision, not a backlog item: nobody re-audits it, nobody
estimates it, and nobody treats its absence as a defect. An entry is deleted only when the capability
lands — see the lifecycle rule in `AGENTS.md`, "Verified fix: DELETE the entry".

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

**What this app does.** There is no Select menu, and no menu bar to put one in: `src/components/Menu/Menu.tsx`
is a 13-line component that renders a `DesktopHeader` and a `ToolbarHorizontal` and nothing else
(`src/components/Menu/Menu.tsx:1-13`).

**Why it is too hard.** Select and Mask is not a dialog over the existing model — it is the workspace
where most of a selection tool's real accuracy actually lives, and it consumes the missing combination
modes above as its substrate. Building it means building a menu system first, a per-tool
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

**What this app does.** None of them exist, anywhere. There is no menu surface that could host them
(`src/components/Menu/Menu.tsx:1-13`), and no selection operation implements them — `src/util/selection.ts`
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
(`src/components/Main/QuickSelectionToolArea.tsx:202-206`):

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
(`src/tools/toolProcessors.ts:300-325`), against a shared null-bitmap stub declared at
`src/tools/toolProcessors.ts:110`:

```ts
const unimplemented = () => () => [null as never] as ToolResult;
```

They are in the rail, with Adobe's names, because the rail is a clone and the grouping is the
specification. None of them has a gesture surface: `Main`'s tool-area dispatch has no branch for any
of them, so the default handler stands (`src/components/Main/Main.tsx:203`) and the same fallback
closes the dispatch (`src/components/Main/Main.tsx:226`), which is the inert `display: none` surface
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

**What this app does.** `commit: 'unimplemented'` at `src/tools/toolProcessors.ts:331-335`, the same
null-bitmap stub, and no gesture surface. The tool is in the rail under Adobe's name.

**Why it is too hard.** It is three things, not one: a parser for the shape-preset format, the preset
library itself, and the authoring and management surfaces. None of the format's structure is present,
and shipping a hardcoded star would be exactly the fake this policy refuses.

**What the app does instead.** A stub bar. The shape flyout carries six entries
(`toolbar-mapping.ts:108-115`) and Star is the missing one, which `AGENTS.md` records as a
requirement rather than an omission to be filled by a placeholder.

### Live type

**What Photoshop does.** Type is live. It is resolution-independent, reflows inside a text box when
the box is resized, can be re-typed in place, and carries an on-canvas caret. Scaling it up is not a
resample; it re-renders.

**What this app does.** Text is baked to pixels at commit. The renderer writes the string with
`fillText` (`src/tools/text.ts:49`) into a layer-sized raster, and the processor returns that raster
as the tool's whole result (`src/tools/text.ts:69-74`):

```ts
const canvas = new OffscreenCanvas(size.width, size.height);
const ctx = canvas.getContext('2d')!;

renderText(ctx, args);

return [canvas];
```

`renderText` is a measure-and-draw function over a string (`src/tools/text.ts:22`), and nothing
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
`tempUpdateLayer` and nothing is committed until the user presses Apply —
`src/components/ToolbarsRight/Transform/Transform.tsx:48` is the `tempUpdateLayer` call inside the
throttled change handler, and the Apply button is at
`src/components/ToolbarsRight/Transform/Transform.tsx:304`.

**Why it is too hard.** The bounding box is a gesture surface that owns the pointer for its duration
and resolves to an arbitrary affine or projective transform. This app's transform path is
parameter-driven and previewed as a layer, with Distort and Warp in particular needing a
displacement field rather than a matrix. It is also a different commit discipline: one gesture, one
result, committed on a keypress rather than a panel change.

**What the app does instead.** Numeric fields and a Reset control. The preview is real and it is
correct; it is just not draggable, so every transform is a round trip through the panel.

### Crop: Straighten, Curve and Content-Aware

**What Photoshop does.** The Crop tool's options bar carries Straighten and Curve, which rotate the
image inside a stationary crop box, and Content-Aware Fill, which synthesises canvas beyond the image
edge when the crop goes past it. <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten-photos.html>

**What this app does.** The crop processor trims a rect and returns the trimmed raster
(`src/tools/crop.ts:26-39`):

```ts
export const crop =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ rect }: CropToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);

    const { x, y, width, height } = trimRect(rect!, size);
    ...
```

There is no rotation in the processor and no synthesis. Straighten and Curve would rotate the source
under a fixed box; Content-Aware is a generative fill over regions outside the image.

**Why it is too hard.** Straighten alone is a rotation, which the app has elsewhere, but it is the
gesture and the box relationship that is the feature, and Content-Aware is a patch-based synthesis
model with no analogue in this codebase at all.

**What the app does instead.** An axis-aligned rect, with a ratio lock and a straightening rotation
applied as a separate step. The processor is honest about what it takes — a rect and a bitmap.

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
one-directional warm shift. The app's tool is labelled "Colors", not "Black and White" — see the
operator-decision section below, which is where that label belongs.

**Why it is too hard.** No CSS filter chain can express a per-hue weighting; the filter primitives are
whole-image and order-dependent, and six independent sextant weights are neither. A faithful
implementation is a per-pixel conversion in a colour space that knows which sextant a hue falls in.
The app has no such conversion routine; it composes a string and hands it to the canvas.

**What the app does instead.** Grayscale, a sepia tone and a saturation trim, applied as a CSS filter
chain. It desaturates correctly, and that is the whole of the overlap.

### Dodge, Burn and Smudge build-up while the button is held

**What Photoshop does.** Dodge, Burn and Smudge accumulate for as long as the button is held. The
result depends on how long the cursor rested in each place, which is the entire point of the tool —
it is a hand-mixed exposure, not a filter.

**What this app does.** One commit per stroke, on pointer-up. The reason is written down where the
implementation is (`src/tools/dodgeBurn.ts:336-339`):

> There is no build-up. Photoshop's dodge and burn accumulate for as long as the button is held, which
> is a per-frame effect with no single end value; a one-shot commit has to be a pure function of its
> args instead, which is also what makes the registry's `requiresRaster: true` replay reproduce the
> commit exactly.

**Why it is too hard, and the constraint is architectural rather than incidental.** This is the one
entry in this file where the obstacle is not the algorithm — accumulating light is easy — but the
replay contract. A `commit: 'raster'` tool's commit must be a pure function of its args, because
`HistoryItem[]` is the production replay authority and `requiresRaster: true` replay has to
reconstruct the same pixels from the recorded args. Dwell accumulation makes the commit a function of
wall-clock time as well, so the same args replay to a different image. The app already has the
converse recorded: `saveLayerCanvas()` promoting cached canvases outside reducer publication is a
reason not to start the single-writer cutover. Changing the commit discipline for dwell tools is a
history-architecture change with a migration attached, not a processor edit.

**What the app does instead.** One application of the effect at the tool's Exposure value, committed
on release. Exposure is a per-stroke setting, which is what the bar shows and what the commit can
honour.

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
(`src/components/ToolbarsRight/Figures/Shape.tsx:204-213`):

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
data — `src/tools/descriptions/paint.ts:85` lists `control: 'Symmetry'` in a table the docs
generator reads. There is no Symmetry symbol in any implementation, and no settings panel. The
`Symmetry` identifier being greppable in `src/` is a property of the descriptions, not evidence of
anything.

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
(`src/components/ToolbarsRight/Eraser/__tests__/Eraser.test.tsx:157`):

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

**What this app does.** Layer opacity has no writer: `Layer.opacity` is a required field, PSD import
populates it and materialization applies it, and nothing in the app ever writes it. The defect and its
blast radius are `HANDOFF.md` §56 (`HANDOFF.md:1184`); it is recorded here only because closing it is
not a small change.

The paint model is the larger half. A brush stroke commits as a **new layer** rather than painting the
active one. `DrawToolArea` calls `createLayerFromTool` on commit
(`src/components/Main/DrawToolArea.tsx:143`), and the contrast with a tool that edits in place is
written down at `src/components/Main/EraserToolArea.tsx:16-21`:

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
rule costs a real capability in one case, and building a menu system is a budget decision in another.
They are recorded here so they are not re-derived, and so nobody implements them as if they were
engineering judgements.

### The three adjustment "tools" must leave the rail, and that means building a menu

`color` ("Colors"), `levels` ("Levels") and `transform` ("Transform") are `Image ▸ Adjustments` and
`Edit ▸ Transform` commands. Photoshop's Tools panel contains no such entries — Adobe's name for
`color` is Black and White, which is not a tool either. `AGENTS.md` requires they leave the rail, and
that they have no replacement tool, because Photoshop puts nothing in their place.

**The extraction is half-staged and the flag has no consumer.**
`toolbar-mapping.ts:163` already declares it:

```ts
export const extraTools = ['color', 'levels', 'transform'] as const satisfies readonly ToolName[];
```

Nothing in production reads `extraTools`. Only `AGENTS.md`'s prose and a test read it, so all three
entries still render in the rail.

**Why this is a decision and not a refactor.** Removing the rail entries does not relocate the
functionality, it deletes it, and the destination is `Image ▸` and `Edit ▸` — which is
`src/components/Menu/Menu.tsx`, a 13-line component rendering a header and a toolbar
(`src/components/Menu/Menu.tsx:1-13`). Extracting these three means building a real menu bar first.
That is a build, and the operator owns the decision to fund it.

### Three invented controls on the Magnetic Lasso bar

Photoshop's Magnetic Lasso bar carries `Stylus Pressure` and `Select and Mask`. This app puts three
controls there instead: `Snap`, `Smooth` and `Preview feather`
(`src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:304-339`).

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

The rail does not carry these Adobe tools. The list is a roadmap rather than a defect, and it is
recorded so that nobody re-audits Adobe's Tools panel to rediscover it — most of it is
placeholder-class work, or it depends on a capability this file records as too hard.

**Selection:** Star, Object Selection, Single Row Marquee, Single Column Marquee.
**Retouch:** Spot Healing Brush, Healing Brush, Patch, Red Eye, Background Eraser, Sponge.
**Painting:** Mixer Brush, History Brush, Art History Brush, Pattern Stamp, Color Sampler.
**Type:** Vertical Type, Vertical Type Mask, Horizontal Type Mask.
**Navigation and measuring:** Ruler, Note, Count, Hand, Rotate View, Zoom, Frame, Slice, Slice Select,
Perspective Crop.
**Path:** Path Selection, Direct Selection.

**Star is the notable one**, because it is not a missing tool so much as a missing entry: the shape
flyout carries Rectangle, Ellipse, Line, Triangle, Polygon and Custom Shape (`toolbar-mapping.ts:108-115`)
and Star is the shape Adobe's list has that the flyout does not. It is listed here rather than filed
separately because the same custom-shape work is recorded as too hard above, and a hardcoded star
would be the fake this policy refuses.

**The rest follow from this file.** The Pen family and Path Type are the work-path object that Path
Selection and Direct Selection would edit. Object Selection needs an edge-following segmentation
comparable to the Quick Selection entry. History Brush and Art History Brush need the retained-raster
history model that Erase to History needs. Perspective Crop is the Crop entry's transform work. Zoom
is worth one note of accuracy: the app has a zoom _interaction mode_ on the canvas, and no Zoom
_tool_ — the registry at `src/contexts/tool-types.ts:28-78` has no entry for it, and the rail has
none either.
