# SHAPE family — research notes

Prose half of `src/tools/descriptions/shape.ts`. Seven keys: `shape`, `rectangle`, `ellipse`,
`line`, `triangle`, `polygon`, `custom-shape`.

`shape` is the generic Shape Tool processor. The five `figure` variants are separate registered
`ToolName`s that each resolve to the same processor through a different `figure` value.
`custom-shape` is registered and selectable and renders a `PlaceholderTool`.

Everything in the tables was re-derived against this worktree. Line numbers into
`src/tools/shape.ts`, `src/tools/settings.ts`, `src/tools/toolProcessors.ts`,
`src/tools/toolsMap.ts`, `src/components/ToolbarsRight/Figures/Shape.tsx` and
`src/components/Main/ShapeToolArea.tsx` are current. Every `file:line` in the previous campaign
corpus was written against an older revision and is not reused.

---

## The two premises this family disproves

Both were already folded into the brief, and both were re-verified against a live source rather
than transcribed.

**1. "The Polygon Tool is click-to-place-vertices" — wrong.** The Polygon tool is drag-defined.
The click-to-place-vertices model is the Pen tool. Adobe's own Shape-tool pages describe the whole
group as click-and-drag
(`helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html`: "Click and drag on the canvas to
draw a shape with your selected shape tool"), and the polygon's Sides field is a pre-draw
parameter of a drag, not a click counter
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "Click and drag in the
document to draw the polygon shape"). The app already does the right thing here —
`src/tools/shape.ts:181-200` inscribes a regular n-gon.

**What Adobe does _not_ say is that the n-gon is _regular_.** That word is this campaign's reading of
"click and drag": a regular polygon inscribed in the drag box is the ordinary outcome of a drag
defined by a bounding box, and it is what the app builds, but no Adobe sentence opened here states
it. The data file now marks the regularity as an inference in the `polygon` `purpose` and drops
"regular" from its `summary`. See Unverified.

**2. "The Triangle Tool draws a regular inscribed triangle" — wrong twice over.** It is a
drag-defined **isosceles** triangle (apex at top-centre of the drag box, base across the bottom),
and **Shift means equilateral, not aspect-snap**. Adobe states the second half verbatim:
`helpx.adobe.com/photoshop/using/triangle-tool.html` — "Hold the Shift key while dragging to
create an equilateral triangle." The first half is the default behaviour of a drag-defined figure
and is confirmed by the same page's drag instruction plus the third-party walkthrough
(`glensmith.co.uk/photoshop/triangle-tool`: "The triangle that was created. It is an isosceles
triangle, which means that two sides are of equal length"). As with the polygon above, **Adobe
states the drag and the Shift half and never the resulting geometry**, so the isosceles reading is
third-party plus inference; the data file's `summary` now describes the box (apex at top-centre,
base across the bottom) rather than the classification, and the `purpose` labels the isosceles
reading as this description's inference. The app's `src/tools/shape.ts:186` shares one branch with
the polygon and hardcodes `figure === 'triangle' ? 3 : 5`, so it inscribes a regular triangle — the
disproved behaviour — and `src/tools/shape.ts:79` squares the drag box for it, which is neither
equilateral nor the equilateral constraint.

**Version note on the Triangle tool.** The tool did not exist before Photoshop 2021 (v22), and that
is now Adobe-attributed rather than third-party: Adobe's own launch announcement, via Julieanne
Kost, 2020-10-20, is titled "Adobe Announces Updates to Photoshop 2021 (v22)" and names
"a new Triangle tool" among the release's additions
(`https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html`). The
third-party page that previously carried this — `photoshopessentials.com`'s "The Triangle Tool was
first introduced in Photoshop 2021" — is now a corroborating rather than a load-bearing source.
What the announcement does **not** say is what the tool's Shift did at introduction; see
Unverified. The drag-defined geometry and the Shift-equals-equilateral constraint are documented
on Adobe's current page. The `detail` text on the `Mode` and `Radius` controls is therefore
version-scoped to 2021 (v22) and later.

---

## The shared options-bar surface

Every geometric figure in Photoshop carries the same bar. The row order below is the order Adobe
enumerates it: the per-tool Rectangle options bar first
(`helpx.adobe.com/photoshop/using/modify-shapes.html` lists Mode, Fill, Stroke, Stroke width,
Stroke type, Shape W&H, path operations, path alignment, path arrangement, the gear, and
Radius), then the mode-by-mode contents of the bar
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`).

| Photoshop control  | Photoshop behaviour                                            | App status | App default                         | App site                    |
| ------------------ | -------------------------------------------------------------- | ---------- | ----------------------------------- | --------------------------- |
| `Mode`             | Shape / Path / Pixels, default Shape                           | partial    | `shape`                             | `Figures/Shape.tsx:129`     |
| `Fill`             | interior swatch: None / Solid / Gradient / Pattern             | partial    | store `backgroundColor` = `#ffffff` | `shape.ts:144`              |
| `Stroke`           | outline swatch, same four contents                             | partial    | store `color` = `#000000`           | `shape.ts:143`              |
| `Stroke width`     | px; 1 px black by default                                      | partial    | 5 px, 0.5–500 step 0.5              | `Figures/Shape.tsx:153`     |
| `Stroke type`      | Solid/Dashed/Dotted + Align + Caps + Corners                   | partial    | Solid, no Align, no joins           | `Figures/Shape.tsx:219`     |
| `Weight`           | on-screen path thickness, display only                         | missing    | —                                   | —                           |
| `Opacity`          | **Pixel mode only**, 1–100%                                    | partial    | 100%, in all three modes            | `Figures/Shape.tsx:284`     |
| `Mode` (blend)     | **Pixel mode only**, layer blend list                          | missing    | —                                   | —                           |
| `Anti-alias`       | **Pixel mode only**, applied automatically                     | missing    | —                                   | —                           |
| `Path Operations`  | New Layer / Combine / Subtract Front / Intersect / Exclude     | missing    | —                                   | —                           |
| `Path Arrangement` | bring forward / send back                                      | missing    | —                                   | —                           |
| `Path Alignment`   | align and distribute components                                | missing    | —                                   | —                           |
| gear               | Path Options, Live Shapes, Import Shapes, geometry, Arrowheads | missing    | —                                   | —                           |
| `Shape W&H`        | exact W/H, plus From Center; click opens Create <Shape>        | partial    | two `window.prompt` calls           | `ShapeToolArea.tsx:181-182` |

**The `Shape W&H` row's Photoshop column above is right and its data-file `detail` was not, and the
distinction is the kind this family keeps tripping over.** The `detail` field is Photoshop's behaviour
(`types.ts:42-47`), but this one had been written as "Clicking the canvas without dragging opens a
Create <Shape> dialog offering the same Width, Height and Corner Radius fields plus From Center" —
"the same" pins it to the app, and the app has no such dialog.
`src/components/Main/ShapeToolArea.tsx:180-186` is the whole of it: a click is detected by
`start.x === end.x && start.y === end.y`, and then two `window.prompt` calls run **sequentially**,
Width first and Height second, and the shape is only committed if both parse to a number above zero.
There is no Corner Radius field and no From Center anywhere in that path. The rewritten `detail` says
exactly that, and the `rectangle` and `ellipse` `appNotes` now record the same divergence, which they
previously did not — their `purpose` sentences describe Photoshop's dialog, and the app's version of
that dialog was simply unmentioned.

Per-figure deltas:

| Photoshop control | rectangle                    | ellipse                   | triangle           | polygon                                  | line                                  |
| ----------------- | ---------------------------- | ------------------------- | ------------------ | ---------------------------------------- | ------------------------------------- |
| `Radius`          | **present** (`shape.ts:216`) | not offered (third-party) | **missing**        | **missing**                              | not offered (third-party)             |
| `Sides`           | —                            | —                         | —                  | **missing** (`shape.ts:186` hardcodes 5) | —                                     |
| `Caps`            | inside Stroke type           | inside Stroke type        | inside Stroke type | inside Stroke type                       | **partial** (`Figures/Shape.tsx:189`) |
| `Arrowheads`      | —                            | —                         | —                  | —                                        | **missing**                           |

**The Radius row is the one that looks like a bug and is not — and the "not" is itself
third-party.** Adobe confirms the control on two of the five figures and no more: the Rectangle
tool ("Radius of rounded corners: Manually set the radius…") and the Triangle tool ("specify
Width, Height, and Corner Radius"). The two figures this table marks "not offered in Photoshop" —
the Ellipse and the Line — rest entirely on
`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "since elliptical shapes
have no corners, you won't find any options to adjust them", and "the Ellipse Tool and Line Tool do
not allow rounded corners at all". The one Adobe page that enumerates per-tool shape options is
`photoshop-elements/using/creating-shapes.html`, which is a **different product** and cannot stand
in for the desktop bar.

So the app's gate at `figure === 'rectangle'` (`Figures/Shape.tsx:165`) is a **judgment**, not a
match, and the data file now says so: withholding `Radius` from the ellipse and the line is
probable but undocumented, and withholding it from the triangle is a real gap against an Adobe
sentence while withholding it from the polygon is a real gap against a third-party one. The app
is right about the ellipse for a reason nobody has cited. The persisted per-figure defaults still
carry `cornerRadius: 0` for the oval (`settings.ts:41`) because the saved-args record is shared
across all five figures; that key is never read on that path.

**Align, Caps and Corners live in the Stroke Options panel, not the bar.** The bar has a single
`Stroke type` icon that opens the panel, and the panel is where Inside/Center/Outside alignment,
the three cap styles and the Miter/Round/Bevel joins are set
(`helpx.adobe.com/photoshop/using/modify-shapes.html`). They are folded into that row's `detail`
rather than given three rows of their own. The app's `Cap` select is a bar-level control that
Photoshop does not have at that level, and it is rendered for the line figure only.

**What each drawing mode actually commits**, per
`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`:
Shape creates a filled shape layer; Path creates a vector path with no pixels; Pixels rasterizes
into the selected layer and is the only mode that carries a blend mode, an Opacity slider and an
anti-alias control. The app's `toolMode` is read in exactly one place,
`src/tools/shape.ts:172` — `const hasFill = args.toolMode !== 'path' && args.hasFill` — so Path mode
suppresses the fill and nothing else. All three modes still commit a rasterized layer.

---

## `shape` — Shape Tool (generic)

Photoshop's Shape tool is the group, not a figure: pressing U selects it and a long press offers
the members of the shapes tool group. All three figures the app registers share its processor, so
this entry is the family's own summary and the five figure entries are the specific ones.

Modifiers in Photoshop: Shift to constrain proportions (off by default, per
`jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html`), Alt/Option to draw from
the centre, Spacebar to reposition while drawing. The app implements all three
(`shape.ts:79`, `shape.ts:96`, `ShapeToolArea.tsx:52`).

App verdict: **partial**. Live and committing, not a placeholder, but Path mode is not a path,
Pixels mode is identical to Shape mode, and there is no separate Fill/Stroke swatch pair.

Sources:

- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the three modes and what each commits; Stroke Align/Caps/Corners; the bar's icon set
- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — Rectangle bar contents in bar order
- `https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html` — the group; Shift = proportional. **This list now also carries a Star tool** between Polygon and Line, which is the counter-evidence that moved the star off the Polygon tool — see Unverified.
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — Path outline is display-only; per-tool corner radius rules
- `https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` — 1 px default black stroke; stroke alignment defaults to centered

---

## `rectangle` — Rectangle Tool

Drag geometry, Shift-as-square and Alt-as-from-centre all match. `src/tools/shape.ts:201-224`
derives a top-left corner and positive extents and applies `cornerRadius` through
`roundedRectPath`, which clamps `r` to `min(|w|/2, |h|/2, radius)` — the same clamp a rounded
rectangle needs.

Photoshop specifics worth recording: the four corner radii are independent and linkable by
default, broken out with Alt/Option-drag on the on-canvas control
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "With the Rectangle
Tool, all four corners can be rounded at once, or a single corner can be rounded independently");
the separate Rounded Rectangle tool was removed in 22.3
(`helpx.adobe.com/photoshop/using/modify-shapes.html`); `[` and `]` nudge the radius by 1 px, or
10 px with Shift (`jkost.com`); and a click without a drag opens the Create Rectangle dialog with
Width, Height, corner radii and From Center. That last sentence is **Photoshop's** dialog and belongs
to the Photoshop column above; the app has no counterpart to it beyond the two `window.prompt` calls
in the shared-surface section.

**The `appNotes` used to contradict this entry's own `options` table, and the fix is a rewrite rather
than a status change.** It ended "Everything else on the Rectangle bar, from the separate Fill and
Stroke swatches down to the path-operation icons, is absent" — while `Fill` and `Stroke` were recorded
as `partial` three lines above, and the code supports them: `Figures/Shape.tsx:204-213` renders a
`Filled` checkbox whose handler sets `hasFill` (`handleFillToggle`, `:53-56`), and `hasFill` is read
in `drawShape` at `src/tools/shape.ts:172`. So what is missing is the **swatch form** — the two
separately clickable swatches with their None / Solid / Gradient / Pattern menu — and the sentence now
says that, and then lists what is absent outright (the path weight, the pixel-mode blend mode, the
anti-alias control, the three path-operation rows, the gear) and what the app's version of the W/H
prompt is. The **ellipse** carried the same contradiction in a different form — "Everything the bar
offers beyond the tool mode, thickness, dash and opacity is missing" — and is fixed the same way.

App verdict: **partial**, and the verdict is the entry's, not this section's. Drag geometry,
Shift-as-square and Alt-as-from-centre all match — the closest thing in this family to Photoshop, and
the only figure whose own distinctive control (`Radius`) is `present`. It is filed `partial` rather
than `implemented` because the three group-level divergences apply verbatim: Path mode is not a path,
Pixels mode is byte-identical to Shape mode, and the bar carries one shared colour instead of the
Fill and Stroke swatches. `types.ts:93-96` puts that bar on the `implementation` field, and the
earlier "implemented on behaviour" wording here read as a contradiction of the data file even though
it was aimed at a different axis.

Sources:

- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — the bar, the 22.3 removal, the Create Rectangle dialog, cap and join styles
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — four independent corner radii; Radius only on Rectangle/Triangle/Polygon
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — mode-by-mode bar contents
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — 1 px default stroke, 3 pt default stroke width in the older bar, Align Edges
- `https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html` — `[`/`]` radius nudge, linked corner radii, Spacebar, Control-drag rotate

---

## `ellipse` — Ellipse Tool

`src/tools/shape.ts:225-236` draws a real `ctx.ellipse` from the drag box half-extents, and Shift
through `shape.ts:79-93` squares the box, which for an ellipse is a circle. Correct.

`src/tools/shape.ts:17-22` records the repo's own version of Photoshop's rule: "Photoshop exposes
Circle and Square as Shift-constrained outcomes of the Ellipse and Rectangle tools rather than as
dedicated tools", and `legacyFigureMap` at `shape.ts:9-12` maps the persisted `circle` and `square`
figure values onto `oval` and `rectangle` rather than discarding them. That is a faithful reading
of Photoshop, and it is why there is no separate circle tool here.

The data file's `implementationRefs` for this entry pointed at `Figures/Shape.tsx:17`, which is
`return 'Rectangle Tool';` — the tail of `figureLabel`, i.e. the **rectangle's** label branch. The
only line in the toolbar component that is about the oval is `:13`, `if (figure === 'oval') return
'Ellipse Tool';`, and that is where it points now. The other two figure entries were already right:
the rectangle cites `:165` and the line `:186`, each of which is the `figure ===` gate that decides
whether their own control renders.

App verdict: **partial**, not `implemented`, for the same reason as the rectangle: the geometry is
right, but the three group-level divergences apply verbatim. The withheld Radius is a judgment, not a
documented match — the only evidence for it is a third-party page, and no desktop Adobe page
enumerating the Ellipse tool's bar was found. See the shared-surface section above and Unverified.

Sources:

- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — "since elliptical shapes have no corners, you won't find any options to adjust them"
- `https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html` — the group membership and Shift = proportional
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — Shift = circle, Alt = from centre

---

## `line` — Line Tool

The load-bearing fact: **Shift constrains to a multiple of 45 degrees, not 15.** Adobe verbatim,
`helpx.adobe.com/photoshop/using/line-tool.html`: "To constrain the line angle to a multiple of 45
degrees, hold down shift as you drag and draw the line." The 15-degree figure is the Free Transform
rotate snap, a different feature; the two are easy to conflate and the previous campaign's corpus
recorded the 45° figure correctly while the task briefing carried the 15° one.

The app declines to implement it. `src/tools/shape.ts:79` reads `if (shiftKey && figure !== 'line')`
— the exclusion is deliberate and commented ("Line keeps its free angle, because constraining it
would forbid shallow angles"), which is a defensible design opinion and a divergence from the tool
it is imitating. `src/tools/shape.ts:176-180` strokes a bare `moveTo`/`lineTo` pair, so there is no
arrowhead geometry of any kind. **`Shift` is therefore absent from the data file's `modifiers` table
for the line**, and this is the one place in the family where removing a row loses the most: Shift is
the modifier that _defines_ this tool, and the app is the one figure in the family it declines. The
`purpose` keeps Photoshop's behaviour and the `appNotes` states the exclusion, so a reader gets the
whole picture from prose while the table stays a table of modifiers that are in effect.

Arrowheads: Start and End toggles with Width, Length and Concavity, and the panel is in the
**Contextual Task Bar**, not the options bar and not the gear. Adobe verbatim,
`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html`
(last updated 2026-02-23): "Select Start or End in the **Arrowheads section of the Contextual Task
Bar** (Window > Contextual Task Bar)." The same pattern holds for the Star tool, whose points and
inner/outer radii Adobe also places in the Contextual Task Bar
(`.../create-shapes/draw-star-shapes.html`), which is independent confirmation that per-tool shape
settings migrated out of the gear. **This replaces the previous citation**, a 2015 Adobe _community_
post that placed the panel in the Properties panel after the draw; the data file's gear row no
longer claims the Arrowheads panel, and the `purpose` no longer says the values stay editable from
the Properties panel. Concavity's 0% default is unverified and has been removed from the data file.

The line's colour comes from Stroke, not Fill, because a line is an open path with no interior —
`www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`.

App verdict: **partial**. The segment is right; the 45° snap and the arrowheads are the tool.

Sources:

- `https://helpx.adobe.com/photoshop/using/line-tool.html` — Shift = multiple of 45°
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html` — the Arrowheads panel lives in the Contextual Task Bar (Window > Contextual Task Bar)
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar; Corners explicitly not applicable to the Line tool
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — Concavity default 0% (2012 page, unverified); Weight default 1 px
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — line colour is the stroke; no rounding options

---

## `triangle` — Triangle Tool

Established in the two-premises section above. The `Radius` row matters here: Adobe gives the
Triangle tool a corner-radius control — its click dialog takes "Width, Height, and Corner Radius" —
that rounds all three corners at once, and there are no individual radius handles
(`helpx.adobe.com/photoshop/using/triangle-tool.html`; `glensmith.co.uk/photoshop/triangle-tool`;
`jkost.com`: "the Triangle and Polygon tools have a single Corner Radius control point handle which
modifies the roundness of all corners equally" — note that this last quote is the only source for
the _polygon_ half, since no Adobe page listing the polygon bar was found). The app's `drawShape`
builds the triangle inside the branch shared with the polygon
(`src/tools/shape.ts:181-200`), which never reads `cornerRadius`, so even if the field were
rendered it would do nothing. It is not rendered either.

Shift is the other half. The gear menu carries persistent `Equilateral`, `Unconstrained`,
`Fixed Size`, `Proportional` and `From Center` checkboxes, and Shift is the momentary `Equilateral`
(`glensmith.co.uk/photoshop/triangle-tool`). The app's Shift for this figure is the shared
square-the-box branch at `src/tools/shape.ts:79`.

App verdict: **partial**. Both disproved premises land on this figure at once.

Sources:

- `https://helpx.adobe.com/photoshop/using/triangle-tool.html` — Shift = equilateral; click dialog with W/H/Corner Radius/Equilateral/From Center
- `https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html` — Adobe's launch announcement, 2020-10-20: "a new Triangle tool" in Photoshop 2021 (v22)
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — Radius in the bar; Alt = from centre
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — the persistent geometry checkboxes
- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — the Rectangle bar's shape, for contrast

---

## `polygon` — Polygon Tool

The premise correction is already the app's behaviour: `src/tools/shape.ts:181-200` builds a
regular n-gon inscribed in the drag box. Sides defaults to 5 in Photoshop
(`www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "you can leave
these options at their defaults (sides = 5, radius = 0 px)"), and the app hardcodes 5 at
`src/tools/shape.ts:186`. The default matches; nothing else about the control does, because there
is no control.

**The star is not the Polygon tool's any more, and the data file no longer says it is.** The
previous version of this file described the star as a ratio on the same shape — "lower the star
Ratio from 100% and the inner vertices pull inward" — sourced to
`developer.adobe.com/xd/uxp/develop/reference/polygon` ("the ratio of the smaller circle's diameter
to the outer circle's diameter, expressed as a percentage", range 1.0 to 100.0). That is the XD/UXP
document object model, not the desktop tool's bar, and it is the only source that ever carried the
claim. The counter-evidence is now positive and Adobe's own:

- Adobe's current drawing-tools overview enumerates the group as "Rectangle tool | Ellipse tool |
  Triangle tool | Polygon tool | **Star tool** | Draw star shapes | Line tool | Custom Shape tool" —
  a **Star tool in the same group**, which is what a star moved _out_ of the Polygon tool's bar looks
  like.
- Adobe's star page instructs "Select the **Star tool** from the shapes tool group in the Tools
  panel" and documents the star attributes there: "Set number of sides (or points on a star)",
  "Corner radius", "**Inner Radius**: Defines the depth of the indents between the spikes", "**Outer
  Radius**: Defines the length of the star's spikes" — in the Contextual Task Bar, and "You can also
  adjust the points, corner radius, and inner/outer radii from the Options panel"
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html`).
- Adobe Community's 26.10 announcement thread describes the same split: "You can now create
  customizable star polygons directly on the canvas using the Star tool, **located within the Shapes
  tool group in the Tools panel**."

The honest counter-counter-evidence, recorded rather than hidden: Adobe's own marketing page
`https://www.adobe.com/products/photoshop/make-stars.html` still leads with "Make a star shape with
the Polygon tool", and an undated StackExchange question records a 2013 user choosing "star" in the
Polygon's own options. So the Polygon tool may still reach a star in some builds; what no current
Adobe desktop page documents is a star control **on the Polygon tool's bar**. The data file's
`summary`, `purpose` and `Sides` row now attribute the star to the separate tool rather than
promising it here, and the `Sides` row says the indent control is not on this bar. The UXP
reference has been dropped from the data file's source list, since the claim it supported is gone;
it stays here in Unverified.

Pre-Star-tool builds carried the side count, the indent percentage and the smooth-radius value in
the Properties panel (`jkost.com`, 2021); those are now the Star tool's fields. The app has no
representation of any of it.

Modifiers: Shift constrains proportions, off by default; Alt/Option draws from the centre, though a
polygon is already centred in its drag box; Control/Cmd while dragging rotates it; Spacebar
repositions. The app implements Space and the square-box Shift, and neither the from-centre
modifier's distinct meaning nor the Control-drag rotation. **`Control` is therefore absent from the
data file's `modifiers` table**, for the same reason `Shift` is absent from the line tool's: it is
named as a Photoshop modifier and the app implements nothing for it, so listing it would put a row in
a machine-readable table that reads as "this key is in effect during the drag". The Photoshop
behaviour is not lost — it is in the `purpose` and in this paragraph.

**`[` and `]` are gone from the data file for a stronger reason than "not bound".** They are Photoshop
polygon shortcuts, and the notes' own Keyboard table already recorded that no bracket key is bound
anywhere in the app. What makes them unrecordable rather than merely absent is that they change a side
count which does not exist at runtime: `src/tools/shape.ts:186` is
`const sides = figure === 'triangle' ? 3 : 5`, a literal. A row whose action is "changes the number of
sides" would describe editing a value nothing reads, so both rows are deleted and the reason is
recorded in the polygon's `appNotes`.

App verdict: **partial**. The drag-defined model is right; the side count and the rotation are not
there, and the star is not this tool's to draw.

Sources:

- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — drag-defined; Sides default 5, Radius default 0 px; Shift = symmetrical
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — polygon always drawn from its centre; Shift limits the angles
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html` — the separate Star tool and its points / Inner Radius / Outer Radius
- `https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html` — `[`/`]` change the side count, by 10 with Shift; Control-drag rotates; star attributes in the Properties panel
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar

---

## `custom-shape` — Custom Shape Tool

**A placeholder, stated as a fact rather than hidden.** `src/tools/toolProcessors.ts:330-334` is
`commit: 'unimplemented'` with the shared `unimplemented` rasterizer; `src/tools/toolsMap.ts:158-162`
renders `PlaceholderTool` with a TODO badge; `src/tools/settings.ts:300` persists nothing but the
tool name. The panel that does render is a chip list, and the chips are Photoshop's real control
names rather than filler — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` reads
`['Tool Mode', 'Fill', 'Stroke', 'W/H', 'Shape Picker', 'Path Operations']`.

**The chip list is why nine of this entry's `options` rows were wrong, and the fix is a status, not a
sentence.** This entry had inherited the shared `sharedFigureOptions` consts, which carry the shape
**bar's** statuses and the shape bar's `appRef`s — for a tool that never renders that bar. Six of the
nine rows below were `partial` and three were `missing`; the correct reading is:

| Row               | Was     | Now       | Why                                                                                                                |
| ----------------- | ------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `Mode`            | partial | `inert`   | chip "Tool Mode" is on screen, nothing reads it                                                                    |
| `Fill`            | missing | `inert`   | chip "Fill" is on screen, nothing reads it                                                                         |
| `Stroke`          | partial | `inert`   | chip "Stroke" is on screen, nothing reads it                                                                       |
| `Shape Picker`    | missing | `inert`   | chip "Shape Picker" is on screen, nothing reads it                                                                 |
| `Shape W&H`       | partial | `inert`   | chip "W/H" is on screen, nothing reads it; the two `window.prompt` calls the other five figures get never run here |
| `Path Operations` | missing | `inert`   | chip "Path Operations" is on screen, nothing reads it                                                              |
| `Stroke width`    | partial | `missing` | no chip in this tool's list, and the bar that carries it never renders                                             |
| `Stroke type`     | partial | `missing` | same                                                                                                               |
| `Opacity`         | partial | `missing` | same                                                                                                               |

The `inert` / `missing` split is the whole point of the two statuses, and it is the same split the Pen
family already makes. `inert` is "declared **or displayed**, and nothing is wired behind it", whose
second shape is spelled out in `types.ts` as "a label on a placeholder chip that no component ever
reads" — which is these six exactly. `missing` would deny a fact a screenshot shows. The other three
go the other way: no chip exists, and the real bar does not render, so there is nothing to point at
and no `appRef` is carried. A `missing` row must not carry the key at all, so those three are built
with a rest-destructuring helper (`withoutAppRef` in `shape.ts`) rather than with
`{ ...shared, appRef: undefined }`, which leaves a present, value-less key on the row and
contradicts the contract.

**The chip list is not the only reason the shape bar does not render.** The canvas dispatch
`src/components/Main/Main.tsx:67-75` names `shape`, `rectangle`, `ellipse`, `triangle`, `polygon` and
`line` and **not** `custom-shape`, so this tool matches no branch: `interactionMode` stays `'zoom'` and
the canvas area is `DummyToolArea`, a `display: none` div
(`src/components/Main/DummyToolArea.tsx:15`). That is why every `appRef` in the nine rows above points
at the chip list and none at `Figures/Shape.tsx` or `src/tools/shape.ts`, and it is also why the three
`modifiers` rows — Shift, Alt and Space — are bound to nothing: there is no drag for them to modify.

**Path Operations, corrected.** The real set is New Shape Layer (or Create New Shape Layer),
Combine Shapes, Subtract Front Shape, Intersect Shape Areas, Exclude Overlapping Shapes, and
Merge Shape Components as a post-hoc merge that warns the live shape becomes a regular path
(`www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/`;
`community.adobe.com/questions-712/path-tool-path-operations-why-does-it-change-1150658` for the
current four-plus-New-Layer list; `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/`
for the Merge warning). **`Minus Back` is not one of them** — it is an Illustrator and InDesign
Pathfinder term, and the previous campaign's corpus listed it as a Photoshop path operation without
a source that supports it. See Unverified.

**Two Adobe names for the same subtract, and no single Adobe page for the set.** The entry is
"Subtract Front Shape" in Adobe Community (2012) and "**Subtract From Shape Area**" in Adobe's own
2022 wording; no Adobe page opened here enumerates all five together, so the data file's
`pathOperationsControl` row and the `custom-shape` `purpose` both name the variant rather than
picking one silently, and the `purpose` now carries **New Shape Layer** — which the control row had
and the prose dropped, so the enumeration was incomplete in the most-read field of the entry.

**The shape library, and the "default" the data file must not assert.** A 2020 PCWorld article
gives the default loaded groups as Leaf Trees, Wild Animals, Boats and Flowers (and names the twelve
categories the `All` set adds: Animals, Arrows, Banners, Frames, Music, Nature, Objects, Ornaments,
Shapes, Symbols, Talk Bubbles, Tiles). Those defaults are no longer what a current install shows:
since the Shapes panel arrived, the old groups live behind **Legacy Shapes and More** in the panel's
fly-out (`community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992`;
`versluis.com/2020/09/how-to-bring-back-legacy-shapes-in-photoshop/`), and Adobe's own overview
carries a separate "Add legacy custom shapes" nav item. The data file previously called these four
"the default groups" flatly, which **contradicted this section**. It now says the library includes
those groups, dates the "default" to a 2020 account, and states that what a current install shows
was not established. Data file and notes now agree.

**Shift means something different here — on third-party authority only.** For every geometric
figure Shift constrains the drag box; for a custom shape it is reported to preserve the shape's
_own_ aspect ratio (`glensmith.co.uk/photoshop/custom-shape-tool`; `photoshop-zon.blogspot.com`).
No Adobe page opened in this pass states it, and the claim appears **three times** in the data file
— `purpose`, the Shape Picker row and the Shift `modifiers` entry — where it read as though Adobe
had said it. All three now carry the third-party marker.
`normalizeShapeGeometry` squares the box for every non-line figure with no per-figure branch, so
this is a divergence that no existing setting expresses.

**The round trip.** Draw a path or a shape layer, or convert text to a path, then `Edit ▸ Define
Custom Shape` and name it; the new preset appears in the picker
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html`). The
storage format is a Cumulus file: `.csh` carries the magic number `8BCS`, and the all-shapes
preferences file `CustomShapes.psp` carries `8BPF` and is read at launch and written at quit
(`tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html`). Preset Manager
reaches them, and Adobe's own page documents the download-and-Load route
(`www.adobe.com/products/photoshop/shapes.html`).

**Shift means a different thing here.** See the third-party caveat above: `normalizeShapeGeometry`
squares the box for every non-line figure with no per-figure branch, so the reported
aspect-preserving behaviour is a divergence that no existing setting expresses.

**Why the booleans are not a toggle away.** Subtract needs a multi-subpath model with a fill rule,
so a single convex outline is structurally insufficient — a `Path2D` with `evenodd` handles a
simple hole but not a reliable cross-shape subtract, which wants a scanline rasterizer with a
winding counter. That is a data-model decision, not an options-bar one.

App verdict: **placeholder**.

Sources:

- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html` — the tool, the picker, Import Shapes, Define Custom Shape
- `https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` — Subtract Front Shape, Merge Shape Components and its warning, the 1 px default stroke
- `https://www.adobe.com/products/photoshop/shapes.html` — `.csh` via Preset Manager; Define Custom Shape
- `https://tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html` — Cumulus `8BCS` / `8BPF`
- `https://www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/` — the six path operations
- `https://www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html` — the four default groups (2020; no longer current)
- `https://community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992` — Shapes panel and Legacy Shapes and More
- `https://glensmith.co.uk/photoshop/custom-shape-tool` — third party: Shift preserves the preset's own aspect ratio

---

## Keyboard

| Keys      | Photoshop                                                                | App                                                                                                                       | App site                         |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `U`       | select the shapes tool group                                             | keeps the active figure; only a non-shape tool (including Custom Shape) falls back to `figure: 'rectangle'`               | `AppKeyboardShortcuts.tsx:89-95` |
| `Shift+U` | cycle through the whole group                                            | cycles only `rectangle → oval → line → custom-shape`; `triangle` and `polygon` index to `-1` and restart at the rectangle | `AppKeyboardShortcuts.tsx:76-78` |
| `[` / `]` | Rectangle: radius ∓1 px; Polygon: sides ∓1; Line: weight ∓1; Shift = ×10 | not bound                                                                                                                 | —                                |
| `Space`   | reposition while drawing                                                 | implemented                                                                                                               | `ShapeToolArea.tsx:52`           |

The `Shift+U` cycle is the gap: `triangle` and `polygon` are absent from the ordered list at
`src/components/Common/AppKeyboardShortcuts.tsx:76`, so `Shift+U` never advances to them even though
both are registered `ToolName`s with their own entries in the tools map. **The failure mode is a
restart, not a freeze**, and the distinction is load-bearing for the row's wording: the branch is
`orderedFigures[(currentIndex + 1) % orderedFigures.length]` with `currentIndex = indexOf(currentFigure)`,
so an unlisted figure gives `-1` and `(-1 + 1) % 4 === 0` — the rectangle. Every data-file row now says
Shift+U from the Triangle or the Polygon "restarts at the rectangle instead of advancing".

**Plain `U` is not "always jumps to the rectangle" either, and that was the other half of the same
mistake.** The five geometric figures in the rail all carry `name: 'shape'` and differ only by
`figure` (`toolbar-mapping.ts:109-113`, applied at `SidebarLeft.tsx:224-227`), so
`toolName === 'shape'` for all five and the early return at `AppKeyboardShortcuts.tsx:89-92` keeps the
figure. The Custom Shape tool is the one entry with its own tool name (`toolbar-mapping.ts:114`), so
`U` from there is the one case that does force the rectangle. Both halves are now in the row rather
than only in this table.

---

## Unverified

Claims that could not be sourced to a URL that was opened. None of them appear in the data file.

- **`Minus Back` as a Photoshop path operation.** The previous campaign's corpus listed it
  alongside Combine / Subtract / Intersect / Exclude for the Custom Shape tool. Every source opened
  here gives Photoshop's set as New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect
  Shape Areas, Exclude Overlapping Shapes, and Merge Shape Components. "Minus Back" appears only as
  an InDesign and Illustrator Pathfinder term. Closest URL:
  `http://www.graphicxtras.com/adobe-photoshop-tutorials/photoshop-how-to-tutorials/path-operations-unite-subtract-photoshop.htm`
  — a third-party page that lists Combine, Subtract front shape, Intersect, Exclude and Merge, with
  no Minus Back.
- **The version that split a dedicated Star tool out of the Polygon tool.** Adobe documents a Star
  tool with Points, Corner radius, Inner Radius and Outer Radius
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html`;
  the same content at `https://helpx.adobe.com/photoshop/using/create-star-shape.html`), but neither
  page states which release introduced it. The previous corpus's 26.10 figure now has **a page that
  names the number** — an Adobe Community announcement thread titled "Photoshop v26.10 | Create the
  perfect star shape for your designs and multiple enhancements"
  (`https://community.adobe.com/questions-712/photoshop-v26-10-create-the-perfect-star-shape-for-your-designs-and-multiple-enhancements-1181840`),
  which is a community post and not an Adobe release note, so 26.10 remains a well-attributed
  account rather than a sourced fact. **The star is now absent from the `polygon` description for a
  different and stronger reason: it is documented on another tool, not because the version is
  uncertain.**
- **Whether star generation is still reachable from the Polygon tool itself, or only from the Star
  tool, in the current release — and the counter-evidence is now positive, not merely absent.**
  `https://developer.adobe.com/xd/uxp/develop/reference/polygon` shows a Polygon _node_ with a
  `starRatio` property, but that is the XD/UXP document object model, not the desktop tool's bar.
  Against that: Adobe's current drawing-tools overview enumerates the group as "Rectangle tool |
  Ellipse tool | Triangle tool | Polygon tool | **Star tool** | Draw star shapes | Line tool |
  Custom Shape tool" — a Star tool in the same group — and Adobe's star page opens "Select the
  **Star tool** from the shapes tool group in the Tools panel" and documents the star attributes
  (points, Corner radius, Inner Radius, Outer Radius) in the Contextual Task Bar
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html`;
  the same content at `https://helpx.adobe.com/photoshop/using/create-star-shape.html`). Adobe
  Community's 26.10 thread places the new Star tool "within the Shapes tool group in the Tools
  panel". For the other side, Adobe's own marketing page
  `https://www.adobe.com/products/photoshop/make-stars.html` still leads with "Make a star shape
  with the Polygon tool". **The previous version of the data file asserted the star on the Polygon
  tool anyway, on the UXP reference alone, while this list called the question unresolvable — the
  assertion has been withdrawn** and the star is attributed to the separate Star tool throughout.
- **That the Polygon tool inscribes a _regular_ n-gon.** The drag is Adobe's; the regularity is
  this campaign's reading of it, and it is also what the app builds. Closest Adobe sentence:
  `https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html` — "Click and drag on the
  canvas to draw a shape with your selected shape tool". The data file keeps the geometry and labels
  it an inference.
- **That the Polygon tool's bar carries a `Radius` control.** Adobe documents `Radius` on the
  Rectangle and Triangle tools; **no Adobe page listing the Polygon tool's options bar was found**,
  so the "missing" verdict for the polygon rests on
  `www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` and on
  `jkost.com`'s "the Triangle and Polygon tools have a single Corner Radius control point handle".
  The data file's `Radius` row says so.
- **That the Ellipse and Line tools withhold `Radius`, and therefore that the app's
  rectangle-only gate is faithful.** No **desktop** Adobe page enumerating the Ellipse tool's bar was
  found. The one Adobe page that lists per-tool shape options is
  `https://helpx.adobe.com/photoshop-elements/using/creating-shapes.html`, which is a **different
  product**. The whole of the exoneration rests on
  `www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "since elliptical
  shapes have no corners, you won't find any options to adjust them". The data file's `ellipse`
  `purpose` and `appNotes` now call the withholding a judgment rather than a match.
- **The documented numeric range of the Polygon tool's `Sides` field** (3–100, from
  `www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/`, a 2012 page). The default
  of 5 is corroborated by a 2022 page; the range is not restated on any page of currency.
- **The numeric ranges of the Line tool's arrowhead `Width` (10–1000% of line width) and `Length`
  (10–5000%)**, and `Concavity`'s −50% to +50%. The closest URL,
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html`, is an ImageReady-era
  page and describes the pop-up dialog box as the Photoshop control, which it no longer is. The 0%
  Concavity default appears only on a 2012 page and **has been removed from the data file**; only
  the three control names are asserted there.
- **The Line tool's `Weight` default of 1 px in the current release.** Sourced only to the 2012 and
  2015 third-party pages above, not to a current Adobe sentence. The 1 px default _stroke_ is
  separately and more recently sourced (2022, `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/`).
- **The default stroke alignment being Centered.** Sourced to
  `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` (2022) only. Adobe's
  current bar page lists the three alignment values without naming a default.
- **The current default shape groups in the Custom Shape picker.** The four groups
  (Leaf Trees, Wild Animals, Boats, Flowers) are from a 2020 PCWorld article; the 2019–2021 Adobe
  Community threads say the picker changed and those groups moved behind "Legacy Shapes and More",
  and Adobe's overview carries a separate "Add legacy custom shapes" nav item. What a given
  2024–2026 install shows on first launch was not established. The data file previously called
  those four "the default groups" flatly, which **contradicted this entry**; it now names the
  library's contents, dates the "default" to the 2020 article, and says the current install is
  unestablished.
- **That the Custom Shape tool's Shift preserves the preset's own width-to-height ratio.** Carried
  entirely by `https://glensmith.co.uk/photoshop/custom-shape-tool` and a second blog; no Adobe page
  opened in this pass states it. It appears three times in the data file, and all three now say so.
- **Whether Photoshop 2021 (v22)'s Triangle tool shipped with the Shift-equals-equilateral constraint
  unchanged, and what its geometry was at introduction.** The version of introduction is no longer
  open — Adobe's launch announcement of 2020-10-20 names "a new Triangle tool" in Photoshop 2021
  (v22) (`https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html`), and
  that claim has moved out of this list and into the data file. What the announcement does not say
  is what Shift did on day one, and Adobe's triangle page carries a 2023 crawl date and no
  introduction version. The behaviour itself is directly sourced to Adobe and is asserted; only the
  behaviour **at introduction** is unverified.
- **The exact maximum of Photoshop's `Radius` field** for Rectangle, Triangle or Polygon. No source
  states one. The app's 0–250 px is its own number and is not presented as Photoshop's.
- **Whether the Star tool's `Points`, `Inner Radius` and `Outer Radius` replaced the pre-22.0
  `Indent Sides By %` and `Smooth Indents`, or coexist with it.** The old labels are sourced to
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html`; the new ones to the
  current Adobe star page. No page opened here states the migration.
