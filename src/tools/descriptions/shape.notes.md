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

**1. "The Polygon Tool is click-to-place-vertices" — wrong.** The Polygon tool is drag-defined
and inscribes a regular n-gon in the drag box. The click-to-place-vertices model is the Pen tool.
Adobe's own Shape-tool pages describe the whole group as click-and-drag
(`helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html`: "Click and drag on the canvas to
draw a shape with your selected shape tool"), and the polygon's Sides field is a pre-draw
parameter of a drag, not a click counter
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "Click and drag in the
document to draw the polygon shape"). The app already does the right thing here —
`src/tools/shape.ts:181-200` inscribes a regular n-gon.

**2. "The Triangle Tool draws a regular inscribed triangle" — wrong twice over.** It is a
drag-defined **isosceles** triangle (apex at top-centre of the drag box, base across the bottom),
and **Shift means equilateral, not aspect-snap**. Adobe states the second half verbatim:
`helpx.adobe.com/photoshop/using/triangle-tool.html` — "Hold the Shift key while dragging to
create an equilateral triangle." The first half is the default behaviour of a drag-defined figure
and is confirmed by the same page's drag instruction plus the third-party walkthrough
(`glensmith.co.uk/photoshop/triangle-tool`: "The triangle that was created. It is an isosceles
triangle, which means that two sides are of equal length"). The app's `src/tools/shape.ts:186`
shares one branch with the polygon and hardcodes `figure === 'triangle' ? 3 : 5`, so it inscribes
a regular triangle — the disproved behaviour — and `src/tools/shape.ts:79` squares the drag box
for it, which is neither equilateral nor the equilateral constraint.

**Version note on the Triangle tool.** The tool did not exist before Photoshop 22.0 (2021); before
that a triangle was the Polygon tool at three sides
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "The Triangle Tool was
first introduced in Photoshop 2021"). The drag-defined isosceles geometry and the
Shift-equals-equilateral constraint are what that tool has had since introduction, per Adobe's page
and the current options-bar guidance. The `detail` text on the `Mode` and `Radius` controls is
therefore version-scoped to 22.0 and later.

---

## The shared options-bar surface

Every geometric figure in Photoshop carries the same bar. The row order below is the order Adobe
enumerates it: the per-tool Rectangle options bar first
(`helpx.adobe.com/photoshop/using/modify-shapes.html` lists Mode, Fill, Stroke, Stroke width,
Stroke type, Shape W&H, path operations, path alignment, path arrangement, the gear, and
Radius), then the mode-by-mode contents of the bar
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`).

| Photoshop control  | Photoshop behaviour                                            | App status | App default                         | App site                |
| ------------------ | -------------------------------------------------------------- | ---------- | ----------------------------------- | ----------------------- |
| `Mode`             | Shape / Path / Pixels, default Shape                           | partial    | `shape`                             | `Figures/Shape.tsx:129` |
| `Fill`             | interior swatch: None / Solid / Gradient / Pattern             | partial    | store `backgroundColor` = `#ffffff` | `shape.ts:144`          |
| `Stroke`           | outline swatch, same four contents                             | partial    | store `color` = `#000000`           | `shape.ts:143`          |
| `Stroke width`     | px; 1 px black by default                                      | partial    | 5 px, 0.5–500 step 0.5              | `Figures/Shape.tsx:153` |
| `Stroke type`      | Solid/Dashed/Dotted + Align + Caps + Corners                   | partial    | Solid, no Align, no joins           | `Figures/Shape.tsx:219` |
| `Weight`           | on-screen path thickness, display only                         | missing    | —                                   | —                       |
| `Opacity`          | **Pixel mode only**, 1–100%                                    | partial    | 100%, in all three modes            | `Figures/Shape.tsx:284` |
| `Mode` (blend)     | **Pixel mode only**, layer blend list                          | missing    | —                                   | —                       |
| `Anti-alias`       | **Pixel mode only**, applied automatically                     | missing    | —                                   | —                       |
| `Path Operations`  | New Layer / Combine / Subtract Front / Intersect / Exclude     | missing    | —                                   | —                       |
| `Path Arrangement` | bring forward / send back                                      | missing    | —                                   | —                       |
| `Path Alignment`   | align and distribute components                                | missing    | —                                   | —                       |
| gear               | Path Options, Live Shapes, Import Shapes, geometry, Arrowheads | missing    | —                                   | —                       |
| `Shape W&H`        | exact W/H, plus From Center; click opens Create <Shape>        | partial    | two `window.prompt` calls           | `ShapeToolArea.tsx:181` |

Per-figure deltas:

| Photoshop control | rectangle                    | ellipse                  | triangle           | polygon                                  | line                                  |
| ----------------- | ---------------------------- | ------------------------ | ------------------ | ---------------------------------------- | ------------------------------------- |
| `Radius`          | **present** (`shape.ts:216`) | not offered in Photoshop | **missing**        | **missing**                              | not offered in Photoshop              |
| `Sides`           | —                            | —                        | —                  | **missing** (`shape.ts:186` hardcodes 5) | —                                     |
| `Caps`            | inside Stroke type           | inside Stroke type       | inside Stroke type | inside Stroke type                       | **partial** (`Figures/Shape.tsx:189`) |
| `Arrowheads`      | —                            | —                        | —                  | —                                        | **missing**                           |

**The Radius row is the one that looks like a bug and is not.** Photoshop offers `Radius` on the
Rectangle, Triangle and Polygon tools only — "the Ellipse Tool and Line Tool do not allow rounded
corners at all"
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`). The app gates the
slider on `figure === 'rectangle'` (`Figures/Shape.tsx:165`), so withholding it from the ellipse
and the line is faithful. Withholding it from the triangle and the polygon is a real gap. The
persisted per-figure defaults still carry `cornerRadius: 0` for the oval
(`settings.ts:41`) because the saved-args record is shared across all five figures; that key is
never read on that path.

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
- `https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html` — the group is Rectangle, Ellipse, Triangle, Polygon, Line; Shift = proportional
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
Width, Height, corner radii and From Center.

App verdict: **implemented** on behaviour. It is the only figure whose distinctive control is
present, and the closest thing in this family to Photoshop.

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

App verdict: **implemented** on behaviour. The withheld Radius is correct, not a gap.

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
arrowhead geometry of any kind.

Arrowheads: Start and End toggles with Width, Length and Concavity, from the gear before the draw
and from the Properties panel afterwards
(`community.adobe.com/questions-712/quick-tip-how-to-create-lines-and-arrows-in-photoshop-1150333`;
`helpx.adobe.com/photoshop/using/line-tool.html` for the 45° sentence). Concavity defaults to 0%
(`photoshopessentials.com/basics/shapes/photoshop-shape-essentials/`).

The line's colour comes from Stroke, not Fill, because a line is an open path with no interior —
`www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`.

App verdict: **partial**. The segment is right; the 45° snap and the arrowheads are the tool.

Sources:

- `https://helpx.adobe.com/photoshop/using/line-tool.html` — Shift = multiple of 45°
- `https://community.adobe.com/questions-712/quick-tip-how-to-create-lines-and-arrows-in-photoshop-1150333` — arrowhead Start/End, Width/Length/Concavity; Shift = nearest 45°
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar; Corners explicitly not applicable to the Line tool
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — Concavity default 0%; Weight default 1 px
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — line colour is the stroke; no rounding options

---

## `triangle` — Triangle Tool

Established in the two-premises section above. The `Radius` row matters here: Photoshop gives the
Triangle tool a single corner-radius control that rounds all three corners at once, and there are
no individual radius handles
(`glensmith.co.uk/photoshop/triangle-tool`; `jkost.com`: "the Triangle and Polygon tools have a
single Corner Radius control point handle which modifies the roundness of all corners equally").
The app's `drawShape` builds the triangle inside the branch shared with the polygon
(`src/tools/shape.ts:181-200`), which never reads `cornerRadius`, so even if the field were
rendered it would do nothing. It is not rendered either.

Shift is the other half. The gear menu carries persistent `Equilateral`, `Unconstrained`,
`Fixed Size`, `Proportional` and `From Center` checkboxes, and Shift is the momentary `Equilateral`
(`glensmith.co.uk/photoshop/triangle-tool`). The app's Shift for this figure is the shared
square-the-box branch at `src/tools/shape.ts:79`.

App verdict: **partial**. Both disproved premises land on this figure at once.

Sources:

- `https://helpx.adobe.com/photoshop/using/triangle-tool.html` — Shift = equilateral; click dialog with W/H/Corner Radius/Equilateral/From Center
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — introduced in Photoshop 2021; Radius in the bar; Alt = from centre
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

The star is a ratio on the same shape, not a separate mode: lower the star Ratio from 100% and
the inner vertices pull inward, indenting every other edge
(`developer.adobe.com/xd/uxp/develop/reference/polygon` — "the ratio of the smaller circle's
diameter to the outer circle's diameter, expressed as a percentage", range 1.0 to 100.0, where 100
is a plain convex polygon). The Properties panel carries the side count, the indent percentage and
the smooth-radius value (`jkost.com`). The app has no representation of either.

Modifiers: Shift constrains proportions, off by default; Alt/Option draws from the centre, though a
polygon is already centred in its drag box; Control/Cmd while dragging rotates it; Spacebar
repositions. The app implements Space and the square-box Shift, and neither the from-centre
modifier's distinct meaning nor the Control-drag rotation.

App verdict: **partial**. The drag-defined model is right; the side count, the star and the
rotation are not there.

Sources:

- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — drag-defined; Sides default 5, Radius default 0 px; Shift = symmetrical
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — polygon always drawn from its centre; Shift limits the angles
- `https://developer.adobe.com/xd/uxp/develop/reference/polygon` — `cornerCount`, `starRatio` 1.0–100.0, `setAllCornerRadii`
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

**Path Operations, corrected.** The real set is New Shape Layer (or Create New Shape Layer),
Combine Shapes, Subtract Front Shape, Intersect Shape Areas, Exclude Overlapping Shapes, and
Merge Shape Components as a post-hoc merge that warns the live shape becomes a regular path
(`www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/`;
`community.adobe.com/questions-712/path-tool-path-operations-why-does-it-change-1150658` for the
current four-plus-New-Layer list; `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/`
for the Merge warning). **`Minus Back` is not one of them** — it is an Illustrator and InDesign
Pathfinder term, and the previous campaign's corpus listed it as a Photoshop path operation without
a source that supports it. See Unverified.

**The shape library.** The default loaded groups are Leaf Trees, Wild Animals, Boats and Flowers
(`www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html`, which
also names the twelve categories the `All` set adds: Animals, Arrows, Banners, Frames, Music,
Nature, Objects, Ornaments, Shapes, Symbols, Talk Bubbles, Tiles). Those defaults are no longer what
a current install shows: since the Shapes panel arrived, the old groups live behind
**Legacy Shapes and More** in the panel's fly-out
(`community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992`;
`versluis.com/2020/09/how-to-bring-back-legacy-shapes-in-photoshop/`).

**The round trip.** Draw a path or a shape layer, or convert text to a path, then `Edit ▸ Define
Custom Shape` and name it; the new preset appears in the picker
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html`). The
storage format is a Cumulus file: `.csh` carries the magic number `8BCS`, and the all-shapes
preferences file `CustomShapes.psp` carries `8BPF` and is read at launch and written at quit
(`tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html`). Preset Manager
reaches them, and Adobe's own page documents the download-and-Load route
(`www.adobe.com/products/photoshop/shapes.html`).

**Shift means something different here.** For every geometric figure Shift constrains the drag box;
for a custom shape it preserves the shape's _own_ aspect ratio
(`glensmith.co.uk/photoshop/custom-shape-tool`; `photoshop-zon.blogspot.com`).
`normalizeShapeGeometry` squares the box for every non-line figure with no per-figure branch, so
this is a divergence that no existing setting expresses.

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
- `https://www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html` — the four default groups
- `https://community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992` — Shapes panel and Legacy Shapes and More

---

## Keyboard

| Keys      | Photoshop                                                                | App                                                  | App site                      |
| --------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------- |
| `U`       | select the shapes tool group                                             | selects `shape` with `figure: 'rectangle'`           | `AppKeyboardShortcuts.tsx:94` |
| `Shift+U` | cycle through the whole group                                            | cycles only `rectangle → oval → line → custom-shape` | `AppKeyboardShortcuts.tsx:76` |
| `[` / `]` | Rectangle: radius ∓1 px; Polygon: sides ∓1; Line: weight ∓1; Shift = ×10 | not bound                                            | —                             |
| `Space`   | reposition while drawing                                                 | implemented                                          | `ShapeToolArea.tsx:52`        |

The `Shift+U` cycle is the gap: `triangle` and `polygon` are absent from the ordered list at
`src/components/Common/AppKeyboardShortcuts.tsx:76`, so `Shift+U` never reaches them even though
both are registered `ToolName`s with their own entries in the tools map.

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
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html`,
  dated 2026-02-23; the same content at `https://helpx.adobe.com/photoshop/using/create-star-shape.html`,
  dated 2025-08-20), but neither page states which release introduced it. The previous corpus says
  26.10 with no source that names the number. Because it is version-dependent it is deliberately
  absent from the `polygon` description rather than asserted.
- **Whether star generation is still reachable from the Polygon tool itself, or only from the Star
  tool, in the current release.** `https://developer.adobe.com/xd/uxp/develop/reference/polygon`
  shows a Polygon _node_ with a `starRatio` property, but that is the XD/UXP document object model,
  not the desktop tool's bar. The current desktop bar is only evidenced for the separate Star tool.
- **The documented numeric range of the Polygon tool's `Sides` field** (3–100, from
  `www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/`, a 2012 page). The default
  of 5 is corroborated by a 2022 page; the range is not restated on any page of currency.
- **The numeric ranges of the Line tool's arrowhead `Width` (10–1000% of line width) and `Length`
  (10–5000%)**, and `Concavity`'s −50% to +50%. The closest URL,
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html`, is an ImageReady-era
  page and describes the pop-up dialog box as the Photoshop control, which it no longer is. Only
  the 0% Concavity default and the three control names are asserted anywhere.
- **The Line tool's `Weight` default of 1 px in the current release.** Sourced only to the 2012 and
  2015 third-party pages above, not to a current Adobe sentence. The 1 px default _stroke_ is
  separately and more recently sourced (2022, `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/`).
- **The default stroke alignment being Centered.** Sourced to
  `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` (2022) only. Adobe's
  current bar page lists the three alignment values without naming a default.
- **The current default shape groups in the Custom Shape picker.** The four groups
  (Leaf Trees, Wild Animals, Boats, Flowers) are from a 2020 PCWorld article; the 2019–2021 Adobe
  Community threads say the picker changed and those groups moved behind "Legacy Shapes and More".
  What a given 2024–2026 install shows on first launch was not established, so the description says
  what the library contains and where the legacy set lives rather than asserting a default.
- **Whether Photoshop 22.0's Triangle tool shipped with the Shift-equals-equilateral constraint
  unchanged.** Adobe's triangle page carries a 2023 crawl date and does not state an introduction
  version; the "introduced in Photoshop 2021" claim is third-party. The behaviour itself is directly
  sourced to Adobe and is asserted; only the version-of-introduction is soft.
- **The exact maximum of Photoshop's `Radius` field** for Rectangle, Triangle or Polygon. No source
  states one. The app's 0–250 px is its own number and is not presented as Photoshop's.
- **Whether the Star tool's `Points`, `Inner Radius` and `Outer Radius` replaced the pre-22.0
  `Indent Sides By %` and `Smooth Indents`, or coexist with it.** The old labels are sourced to
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html`; the new ones to the
  current Adobe star page. No page opened here states the migration.
