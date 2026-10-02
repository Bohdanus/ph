# SHAPE family — research notes

Prose half of `src/tools/descriptions/shape.ts`. Seven keys: `shape`, `rectangle`, `ellipse`,
`line`, `triangle`, `polygon`, `custom-shape`.

`shape` is the generic Shape Tool processor. The five `figure` variants are separate registered
`ToolName`s that each resolve to the same processor through a different `figure` value.
`custom-shape` is registered and selectable and renders a `PlaceholderTool`.

**Every `file:line` below and in the data file was re-derived against this worktree by opening the
line, and the previous revision of this file was wrong about nearly all of them.** Its closing
sentence claimed the numbers had been re-derived; they had not, and they had drifted. The correct
map, each verified by printing the line:

| Claimed                                | Actual             | What is actually there                                     |
| -------------------------------------- | ------------------ | ---------------------------------------------------------- |
| `Figures/Shape.tsx:129` (Mode)         | **:137**           | `<select aria-label="Tool mode">`                          |
| `Figures/Shape.tsx:204` (Fill, Stroke) | **:212**           | `id="filled-toggle"`                                       |
| `Figures/Shape.tsx:153` (Stroke width) | **:161**           | `id="thickness-slider"`                                    |
| `Figures/Shape.tsx:219` (Stroke type)  | **:227**           | `id="dash-toggle"`                                         |
| `Figures/Shape.tsx:284` (Opacity)      | **:292**           | `id="alpha-slider"`                                        |
| `Figures/Shape.tsx:165` (Radius)       | **:182**           | `aria-label="Radius"`                                      |
| `Figures/Shape.tsx:186` / `:189` (Cap) | **:197**           | `aria-label="Line cap"`                                    |
| `src/tools/shape.ts:216`               | **:240**           | `const radius = args.cornerRadius ?? 0`                    |
| `src/tools/shape.ts:172`               | **:196**           | `const hasFill = args.toolMode !== 'path' && args.hasFill` |
| `src/tools/shape.ts:181`               | **:205**           | the shared triangle/polygon branch                         |
| `src/tools/shape.ts:186`               | **:210**           | `const sides = figure === 'triangle' ? 3 : 5`              |
| `src/tools/shape.ts:201`               | **:225**           | the rectangle branch                                       |
| `src/tools/shape.ts:225`               | **:249**           | the oval branch                                            |
| `src/tools/shape.ts:176`               | **:200**           | the line branch                                            |
| `src/tools/shape.ts:71` / `:79`        | **:93** / **:103** | `normalizeShapeGeometry` and its `if (shiftKey)` arm       |
| `src/tools/settings.ts:271…306`        | **:278…313**       | the six figure blocks, each 7 lines lower                  |
| `src/components/Main/Main.tsx:74`      | **:82**            | `toolName === 'shape' \|\|`, first arm of the dispatch     |
| `toolbar-mapping.ts:109-114`           | **:103-108**       | the six fly-out entries                                    |
| `AppKeyboardShortcuts.tsx:76-78`       | **:116-118**       | `orderedFigures` and the index arithmetic                  |
| `AppKeyboardShortcuts.tsx:89-95`       | **:129-135**       | the `U` handler: keep, else force `rectangle`              |

Two of those were not drift but **wrong files of the right line**: `Figures/Shape.tsx:20` and
`Figures/Shape.tsx:13` are the closing brace of `figureLabel` and the declaration of `figureLabel`
respectively, so the entries that cited them were pointing one line above the code they meant.
`docs/TOOLS-TOO-HARD.md:378` already carries `src/tools/shape.ts:196`, which is right, and this
family carried the pre-drift number — one of the two documents in the repo is stale and it is not
that one.

---

## What this pass found that was not a line-number problem

**The Line tool's 45° Shift snap IS implemented, and the data file said it was not.** This is the
one substantive reversal. The previous revision read `src/tools/shape.ts` as a single
`if (shiftKey && figure !== 'line')` and concluded from it that "the app is the one figure in the
family it declines" — and then removed `Shift` from the line's `modifiers` table on that basis. The
file has since been refactored to give the line its own path:

```ts
if (figure === 'line') return snapLineGeometry(anchor, pointer, altKey, shiftKey); // :101
```

and `snapLineGeometry` quantizes the angle (`:77`):

```ts
const angle = Math.round(Math.atan2(dy, dx) / LINE_ANGLE_STEP) * LINE_ANGLE_STEP; // LINE_ANGLE_STEP = Math.PI / 4
```

which is Adobe's sentence — "To constrain the line angle to a multiple of 45 degrees, hold down
shift as you drag and draw the line" (`helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html`)
— implemented exactly, and the one place in the family where Shift is _not_ a box-squaring
constraint. `Shift` is back in the `modifiers` table, and the `line` `appNotes` now spends its first
sentence on the snap being right and its last on the thing that is actually missing: the arrowheads,
which is what holds the verdict at `partial`.

**"No bracket key is bound anywhere in the app" was false.** `[` and `]` _are_ bound —
`AppKeyboardShortcuts.tsx:539` and `:547` — and they are a repeat-enabled scrub. They are gated on
`tipSizeTool(toolName) !== null`, and `tipSizeField` (`:43-52`) lists exactly eight tools: brush,
pencil, eraser, color-replacement, smudge, dodge, burn, clone-stamp. No shape figure is in it. The
`polygon` `appNotes` now says the bracket keys "reach only the eight tools that carry a tip Size",
which is the true statement; the old wording was a claim about the whole app resting on a claim
about one family.

**`Pixels mode is byte-identical to Shape mode` was both too kind and too vague.** It is literally
true of the raster — `drawShape` branches only on `figure`, and `toolMode` is read in exactly one
place, `src/tools/shape.ts:196` — but it hides the divergence that matters: the processor row is
`commit: 'source'` with `creator: true` (`toolProcessors.ts:160`), so the app allocates a **new
layer** in Pixels mode, where Photoshop paints into the active layer and adds nothing to the Layers
panel. The `shape` and `ellipse` `appNotes` now say that.

**Two internal counting errors, both of the "four things… — lists five" shape.** The `triangle`
`appNotes` said "of the four things Adobe's click dialog offers — Width, Height, Corner Radius,
Equilateral and From Center" (five). The `ellipse` `appNotes` said "the same five controls every
figure gets" and then listed seven plus the preview. Both are corrected; the `ellipse` sentence now
enumerates the bar instead of counting it.

**Adobe's own ScriptListener dump is a better source for the stroke defaults than the 2012
third-party page, and it was not being used.** An Adobe Community thread
(`community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207`, 2025-07-27) dumps
live `currentToolOptions` for the rectangle tool, and the `shape` block reads
`"strokeStyleLineWidth": 1` px, `"strokeStyleLineAlignment": "strokeStyleAlignCenter"`,
`"strokeStyleLineCapType": "strokeStyleButtCap"`,
`"strokeStyleLineJoinType": "strokeStyleMiterJoin"`, and a `fillContents` RGB of (255, 3.9, 3.9) —
white. The `pixels` block reads `"antiAlias": true` and `"opacity": 100`. That is four of this
family's Unverified entries (1 px default stroke width, Centered default alignment, the Butt default
cap, and the anti-alias-on default) answered from a first-hand current dump rather than from 2012
and 2022 tutorials, and the URL is now in all seven `sources` arrays. The community thread is not an
Adobe help page, so the _source_ is still not Adobe official — but it is Adobe-hosted and it is a
measurement rather than a recollection, which is a different kind of thing from a tutorial.

**A third-party source stronger than the two it replaced puts Custom Shape's Shift in better
company.** `trainingonsite.com/images/downloads/Photoshop-2026-tools-modifiers-2026-01-01.pdf` — an
Adobe training partner's modifier cheat sheet — lists, under VECTOR SHAPE TOOLS, "Custom Shape (U)
shift constrains ratio; opt/alt draws from center". The claim was carried by two personal tutorial
sites and marked accordingly in three places; it now has a second, more institutional witness. It
is still not an Adobe help sentence and the markers stay.

---

## The two premises this family disproves

Both were already folded into the brief, and both were re-verified against a live source rather
than transcribed.

**1. "The Polygon Tool is click-to-place-vertices" — wrong.** The Polygon tool is drag-defined.
The click-to-place-vertices model is the Pen tool. Adobe's own desktop Shape-tool pages describe the
whole group as click-and-drag
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html`: "To draw a
shape on the canvas, click and drag any tool from the shapes tool group in the Tools panel"), and
the polygon's Sides field is a pre-draw
parameter of a drag, not a click counter
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "Click and drag in the
document to draw the polygon shape"). The app already does the right thing here —
`src/tools/shape.ts:205-224` inscribes a regular n-gon.

**What Adobe does _not_ say is that the n-gon is _regular_.** That word is this campaign's reading of
"click and drag": a regular polygon inscribed in the drag box is the ordinary outcome of a drag
defined by a bounding box, and it is what the app builds, but no Adobe sentence opened here states
it. The data file now marks the regularity as an inference in the `polygon` `purpose` and drops
"regular" from its `summary`. See Unverified.

**2. "The Triangle Tool draws a regular inscribed triangle" — wrong twice over.** It is a
drag-defined **isosceles** triangle (apex at top-centre of the drag box, base across the bottom),
and **Shift means equilateral, not aspect-snap**. Adobe states the second half verbatim:
`helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html` — "Hold the Shift key while dragging to
create an equilateral triangle." The first half is the default behaviour of a drag-defined figure
and is confirmed by the same page's drag instruction plus the third-party walkthrough
(`glensmith.co.uk/photoshop/triangle-tool`: "The triangle that was created. It is an isosceles
triangle, which means that two sides are of equal length"). As with the polygon above, **Adobe
states the drag and the Shift half and never the resulting geometry**, so the isosceles reading is
third-party plus inference; the data file's `summary` now describes the box (apex at top-centre,
base across the bottom) rather than the classification, and the `purpose` labels the isosceles
reading as this description's inference. The app's `src/tools/shape.ts:210` shares one branch with
the polygon and hardcodes `figure === 'triangle' ? 3 : 5`, so it inscribes a regular triangle — the
disproved behaviour — and `src/tools/shape.ts:103` squares the drag box for it, which is neither
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
Stroke type, **Shape W&H**, path operations, path alignment, path arrangement, the gear, and
Radius), then the mode-by-mode contents of the bar
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`).
**`Shape W&H` is sixth, not last** — the data file used to close the table with it, after the gear,
and that is the bar order Adobe's own enumeration contradicts. Adobe's Triangle page gives the same
order from the other end: "set Mode, Fill, Stroke, W, H, Path operation, Path alignment, Path
arrangement, and Additional shape and path options"
(`.../using/tool-techniques/triangle-tool.html`). The three Pixel-mode-only rows have no place on
that bar at all and come last, and the Path-mode-only `Operation` row sits with the path rows
rather than at the end.

| Photoshop control  | Photoshop behaviour                                        | App status | App default                          | App site                   |
| ------------------ | ---------------------------------------------------------- | ---------- | ------------------------------------ | -------------------------- |
| `Mode`             | Shape / Path / Pixels, default Shape                       | partial    | `shape`                              | `Figures/Shape.tsx:137`    |
| `Fill`             | interior swatch: None / Solid / Gradient / Pattern         | partial    | store `backgroundColor` = `#ffffff`  | `StoreContext.tsx:325`     |
| `Stroke`           | outline swatch, same four contents                         | partial    | store `color` = `#000000`            | `StoreContext.tsx:324`     |
| `Stroke width`     | px; 1 px black by default                                  | partial    | 5 px, 0.5–500 step 0.5               | `Figures/Shape.tsx:161`    |
| `Stroke type`      | Solid/Dashed/Dotted + Align + Caps + Corners               | partial    | Solid, no Align, no joins            | `Figures/Shape.tsx:227`    |
| `Shape W&H`        | exact W/H, plus From Center; click opens Create <Shape>    | partial    | Create <Figure> dialog, 100×100 seed | `CreateShapeDialog.tsx:80` |
| `Path Operations`  | New Layer / Combine / Subtract Front / Intersect / Exclude | missing    | —                                    | —                          |
| `Path Alignment`   | align and distribute components                            | missing    | —                                    | —                          |
| `Path Arrangement` | bring forward / send back                                  | missing    | —                                    | —                          |
| `Operation`        | **Path mode only**: Add / Subtract / Intersect / Exclude   | missing    | —                                    | —                          |
| `Weight`           | path thickness — see below; mode-dependent                 | missing    | —                                    | —                          |
| gear               | Path Options, Live Shapes, Arrowheads, geometry, Import    | missing    | —                                    | —                          |
| `Mode` (blend)     | **Pixel mode only**, layer blend list                      | missing    | —                                    | —                          |
| `Opacity`          | **Pixel mode only**, 1–100%                                | partial    | 100%, in all three modes             | `Figures/Shape.tsx:292`    |
| `Anti-alias`       | **Pixel mode only**, applied automatically                 | missing    | —                                    | —                          |

**The Fill and Stroke app sites moved file, and the values did not.** Both defaults are still
`#ffffff` and `#000000`; what was wrong was the file. `src/tools/shape.ts:167-168` is
`ctx.strokeStyle = color;` and `if (hasFill && backgroundColor) {` inside `setShapeCtx` — where the
colours are _consumed_, the same distinction the `Fill` and `Stroke` rows draw when they refuse to
cite the processor. The store defaults are `src/contexts/StoreContext.tsx:324-325`, and those two
numbers were already right — the audit checked them and left them.

**`Weight` is not one behaviour across three modes, and the table row above used to say it was.**
The old row read "on-screen path thickness, display only" flat, which is true of the Shape/Path
mode row and false twice over. Adobe's Shape-mode and Path-mode bullet is "**Weight**: Set the
width of the path in pixels (visual reference only)", and its Pixel-mode bullet is "**Weight**: Set
the width of the line or shape edge in pixels" — it paints. And for the Line tool the Weight is not
a display aid in any mode: Adobe's Line page instructs "To create a line as a shape, choose Shape
mode in the Options bar and then set the Stroke and **Weight**", with a pixel line under "choose
Pixels mode in the options bar and then set the Weight". A line has no filled area, so for that one
tool there is nothing else the weight could be. The data file's `Weight` row now distinguishes the
three cases instead of asserting one.

**Path mode has an `Operation` row of its own, and it is not the `Path Operations` control.** The
same page gives Path mode "**Operation**: Select how new paths interact with existing paths (Add,
Subtract, Intersect, or Exclude)", alongside its own Path arrangement and Path alignment rows,
while the bar icon is separately "**Path Operations icon**: Show or hide path operation buttons".
Collapsing the two would lose one of them, so the Path-mode `Operation` row is now a row of its
own, placed with the path rows, and it says in its `detail` which of the two it is.

**Two rows in this family are named `Mode`, and that is Adobe's word rather than a slip.** The
bar prints `Mode` twice: the three-button drawing-mode group at its left end, and — in Pixel
mode only — a blend-mode control at the right-hand end, in the group with Opacity and
Anti-alias. `types.ts:39-42` requires `control` to be the name Photoshop's own bar prints,
verbatim, so **neither row can be renamed to separate them**: inventing a second name would
break the one rule that field exists to enforce, and Adobe uses the same word for the two
different controls. The blend row takes its name from the mode-by-mode page this family
already cites for the Pixel-mode contents
(`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`),
the same page that documents the three drawing modes.

The resolution is that **each `detail` opens by saying which `Mode` it is**, in its first
sentence: the group as "the first of the two controls Adobe names Mode, and the one at the
left of the bar", the blend mode as "the second of the two controls Adobe names Mode, and a
different control from the three-button drawing-mode group at the left of the bar". The
second row also says where it sits, so a reader who lands on either row in the generated
table learns which control it is without leaving the row. This is the same treatment the
Path-mode `Operation` row above already gets against `Path Operations`, and the generator
prints the whole `detail` (`scripts/generate-tool-docs.mjs:84`), so nothing depends on a
reader having seen the other row.

**Both rows ship in all seven records, so the collision is the family's shape and not one
entry's accident.** Six records take them through `sharedFigureOptions` and `custom-shape`
builds its own list out of the same consts, so every one of the seven tables in
`docs/TOOLS.md` shows two rows whose first column reads `Mode`. Renaming either row to make
the table prettier would contradict the contract's own worked example — `types.ts:39-42` lists
`Mode` in the very line that requires the verbatim name.

**The gear does hold Arrowheads, and the row used to say the opposite.** The same page's additional
settings end "**Set additional shape and path options icon**: Set additional Path options, Live
Shapes Controls, **Arrowheads**, and more." An earlier version of the data file closed that row with
"The per-tool settings Adobe documents in the Contextual Task Bar are not in it", which the source
contradicts on the page it was citing; the claim is removed and Arrowheads is named in the gear.
Note this does **not** undo the Arrowheads-section finding below: the gear lists the control, the
Contextual Task Bar is where the Line tool's Start/End/Width/Length/Concavity values live, and both
sentences are true at once.

**The `Shape W&H` row's Photoshop column above is right, and its `detail` is right too.** The
`detail` field is Photoshop's behaviour (`types.ts:43-47`). It had drifted the other way — it was
written as "The app does ask for them, but it asks with two sequential `window.prompt` calls",
which is an `appNotes` sentence in a `detail` field, and it said so three lines after the same
material already sat in the `rectangle` and `ellipse` `appNotes`. The `detail` describes Adobe's
control and the click dialog; the app's version is in the `appNotes` of every tool that renders
the control — `shape`, `line`, `triangle` and `custom-shape` alongside the two that already had it.
`src/components/Main/ShapeToolArea.tsx:205-209` is where the app's version starts: a click is
detected by `start.x === end.x && start.y === end.y`, and every figure except the Line sets a
`pendingShape` and returns instead of committing, so **the click itself commits nothing**.
`CreateShapeDialog` is a modal opened on that state and portalled to `document.body`
(`ShapeToolArea.tsx:333-344`), offering Width, Height and From Center, plus a Corner Radius field
on the rectangle only, seeded from that figure's live Radius slider
(`CreateShapeDialog.tsx:186-214`) and handed to the commit as an argument rather than written back
into the bar (`ShapeToolArea.tsx:230`). **OK is the only commit**: Cancel, the backdrop, the
header × and Escape all route to the same `onClose` (`:220`, `:131`, `:141-146`, and
`useDialogFocusContainment`'s `onEscape` at `:117`), and OK is `disabled` outright while a dimension
is below 1 px or unparseable (`:95`, `:228`). The From Center checkbox is seeded from the Alt held
at the press (`ShapeToolArea.tsx:126`, `:339`) and stays editable, and the press point is the
shape's corner or, with the box checked, its centre (`:247-250`).

Per-figure deltas:

| Photoshop control | rectangle                             | ellipse                   | triangle           | polygon                                  | line                                  |
| ----------------- | ------------------------------------- | ------------------------- | ------------------ | ---------------------------------------- | ------------------------------------- |
| `Radius`          | **present** (`Figures/Shape.tsx:182`) | not offered (third-party) | **missing**        | **missing**                              | not offered (third-party)             |
| `Sides`           | —                                     | —                         | —                  | **missing** (`shape.ts:210` hardcodes 5) | —                                     |
| `Caps`            | inside Stroke type                    | inside Stroke type        | inside Stroke type | inside Stroke type                       | **partial** (`Figures/Shape.tsx:197`) |
| `Arrowheads`      | —                                     | —                         | —                  | —                                        | **missing**                           |

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

So the app's gate at `figure === 'rectangle'` (`Figures/Shape.tsx:172`) is a **judgment**, not a
match, and the data file now says so: withholding `Radius` from the ellipse and the line is
probable but undocumented, and withholding it from the triangle is a real gap against an Adobe
sentence while withholding it from the polygon is a real gap against a third-party one. The app
is right about the ellipse for a reason nobody has cited. The persisted per-figure defaults still
carry `cornerRadius: 0` for the oval (`settings.ts:46`) because the saved-args record is shared
across all five figures; that key is never read on that path.

**The rectangle's `Radius` appRef was citing the consumer, which is the rule the same record
states two rows earlier.** It pointed at `src/tools/shape.ts:216` (now `:240`), which is
`const radius = args.cornerRadius ?? 0;` — where the value is read. The `Fill` and `Stroke` rows
carry a comment saying exactly why that is not an appRef ("they are where the value is consumed, not
where the control is drawn"), and the Radius row broke it. The renderer is the
`figure === 'rectangle'` gate and the slider it wraps, `Figures/Shape.tsx:172-191`, so that is what
the row cites now.

**Align, Caps and Corners live in the Stroke Options panel, not the bar.** The bar has a single
`Stroke type` icon that opens the panel, and the panel is where Inside/Center/Outside alignment,
the three cap styles and the Miter/Round/Bevel joins are set
(`helpx.adobe.com/photoshop/using/modify-shapes.html`). They are folded into that row's `detail`
rather than given three rows of their own. The app's `Cap` select is a bar-level control that
Photoshop does not have at that level, and it is rendered for the line figure only.

**The two "too hard" items in the brief, and what the bar actually offers for each.**

- _Per-shape Fill and Stroke swatches with Gradient and Pattern._ Recorded at
  `docs/TOOLS-TOO-HARD.md:409` under that heading. The bar offers **one `Filled` checkbox**
  (`Figures/Shape.tsx:212`) over the app's single foreground/background pair: `setShapeCtx` writes
  `ctx.strokeStyle = color` and `ctx.fillStyle = backgroundColor` (`src/tools/shape.ts:167-169`),
  so there is no second paint source to configure, let alone four choices per swatch. `partial` on
  both rows is therefore the right reading, and the _detail_ is the Photoshop side — "a swatch
  offering None, Solid Color, Gradient or Pattern" — which is exactly the control the policy file
  says is out of reach.
- _Path Type = Path for the shape tools._ Recorded at `docs/TOOLS-TOO-HARD.md:380`. The bar offers
  the three-button **Mode** group — `Figures/Shape.tsx:136-146`, a `<select>` with `shape` / `path`
  / `pixels` — and nothing else that could be a path type. What Path mode does in this app is the
  single line `src/tools/shape.ts:196`, `const hasFill = args.toolMode !== 'path' && args.hasFill`,
  so the same rasterized outline is committed with the fill suppressed. Adobe's own name for the
  setting that _would_ create a work path is the Path-mode `Operation` row on the same page — "Select
  how new paths interact with existing paths (Add, Subtract, Intersect, or Exclude)" — and there is
  no `Path Type` control on a shape tool's bar in any Adobe page opened in any pass. The policy
  file's phrase is its own framing of the gap, not Adobe's label, and the data file does not
  reproduce it.

**What each drawing mode actually commits**, per
`helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`:
Shape creates a filled shape layer; Path creates a vector path with no pixels; Pixels rasterizes
into the selected layer and is the only mode that carries a blend mode, an Opacity slider and an
anti-alias control. The app's `toolMode` is read in exactly one place,
`src/tools/shape.ts:196` — `const hasFill = args.toolMode !== 'path' && args.hasFill` — so Path mode
suppresses the fill and nothing else. All three modes still commit a rasterized layer.

---

## `shape` — the Tools panel group (no tool of that name)

**There is no Photoshop tool called the Shape tool, and the `photoshopName` field says so.** The
Tools panel has no entry by that name: the group is seven separate tools — Rectangle, Ellipse,
Triangle, Polygon, Star, Line, Custom Shape — behind one group icon
(`.../create-shapes/drawing-tools-overview.html`, whose tools table lists each of the seven with its
one-line description; `.../create-shapes/create-shapes.html`: "click and drag any tool from the
shapes tool group in the Tools panel"). The caveat matters and the wording is chosen for it:
**Adobe's own marketing copy does use the phrase.** `https://www.adobe.com/products/photoshop/shapes.html`
says "From the toolbar, click and hold the **Shape tool** icon", and the desktop Rectangle page says
"click and hold the Shape tool ( ) group icon". So the claim is not "Adobe never writes those
words" — it is that the Tools panel carries no entry under that name, and the panel is what
`types.ts:100-106` asks `photoshopName` to be verbatim from. The field now reads
`'Shape Tool (the Tools panel group; no entry by that name)'`, and the same project's `AGENTS.md`
already records the identical conclusion: "`shape` is a grouping container carrying a `figure` …
and Adobe has no tool by that name."

`shape` is also this app's grouping container rather than a tool the rail displays: all five
geometric figures resolve to one app tool name and differ only by `figure`, and
`U`/`Shift+U` select and cycle it. All of them share the one processor, so this entry is the
family's own summary and the figure entries are the specific ones.

**The star's version is now sourced, and both of its sources are in the data file, with one piece of
counter-evidence recorded under Unverified.** Photoshop 26.10 added the Star tool — "You can now create customizable star polygons directly on the canvas
using the Star tool, located within the Shapes tool group in the Tools panel" (Adobe Community
announcement, 2025-08-20, thread 1181840), and CG Channel's release report for the same day is
blunter: "The update adds a new Star tool … Photoshop 26.10 is a minor update, with the only new
feature listed being the Star tool." The community thread is an announcement post rather than an
Adobe release note, and the data file says "in 26.10" on those two together rather than on one.

**The web page this entry used to cite cannot carry any of it, and none of those claims needed
it.** `https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html` is the
Photoshop-on-the-web page — its own group list is "Rectangle, Ellipse, Triangle, Polygon, and
Line", with no Custom Shape and no Star — so it cannot support a seven-entry desktop-bar claim and
its absence of a Star is evidence about the _web_ product, not about Photoshop 26.10 or later. An
earlier version of this section even read that missing Star back as "**This list now also carries a
Star tool** between Polygon and Line", which was this file's inference about a page that never said
it; that sentence is deleted. Every claim it was carrying now comes from the desktop pages listed
below.

Modifiers in Photoshop: Shift to constrain proportions (off by default, per
`jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html`), Alt/Option to draw from
the centre, Spacebar to reposition while drawing. The app implements all three
(`shape.ts:103`, `shape.ts:120`, `ShapeToolArea.tsx:52`).

App verdict: **partial**. Live and committing, not a placeholder, but Path mode is not a path,
Pixels mode is identical to Shape mode, there is no separate Fill/Stroke swatch pair, and the
app's fly-out is six entries where Photoshop's group is seven.

**The missing Star tool is the app's gap, and it is recorded in `shape`'s `appNotes` rather than
left to be inferred.** The app's fly-out is `toolbar-mapping.ts:114-121` — Rectangle, Ellipse,
Line, Triangle, Polygon, Custom Shape — and there is no `star` `ToolName`, no `FigureType` for it
(`src/tools/shape.ts:5`), and no gear menu in which its points and radii could be set. The
`polygon` `appNotes` used to read "the star is not this tool's to draw in the current release, so
there is nothing here to compare a star Ratio against", which stated an app limitation in the voice
of a Photoshop fact; it now says the app has no Star tool. See the `polygon` section below.

Sources:

- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the three modes and what each commits; Stroke Align/Caps/Corners; the Path-mode `Operation` row; the Pixel-mode `Weight`; the bar's icon set and the gear's contents
- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — Rectangle bar contents in bar order
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html` — the shapes tool group; Shift = proportional
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html` — the seven entries of the group, Star included
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html` — "Select the Star tool from the shapes tool group in the Tools panel"
- `https://community.adobe.com/questions-712/photoshop-v26-10-create-the-perfect-star-shape-for-your-designs-and-multiple-enhancements-1181840` — the 26.10 announcement thread
- `https://www.cgchannel.com/2025/08/adobe-releases-photoshop-26-10/` — 26.10's new Star tool, third party, 2025-08-20
- `https://helpx.adobe.com/photoshop/using/create-star-shape.html` — the same Star tool page on its older path, 2025-08-20; opens "Select the Star tool from the shapes tool group in the Tools panel" and lists Fill and Stroke, Stroke width, points, Corner radius, Inner Radius and Outer Radius in the Contextual Task Bar
- `https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207` — a first-hand ScriptListener dump of `currentToolOptions` for the rectangle tool: 1 px stroke width, Centered alignment, Butt cap, Miter join, white fill; `antiAlias: true` and `opacity: 100` in pixel mode. Re-opened in this pass and added to all seven `sources` arrays
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — Path outline is display-only; per-tool corner radius rules
- `https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` — 1 px default black stroke; stroke alignment defaults to centered

---

## `rectangle` — Rectangle Tool

Drag geometry, Shift-as-square and Alt-as-from-centre all match. `src/tools/shape.ts:225-248`
derives a top-left corner and positive extents and applies `cornerRadius` through
`roundedRectPath`, which clamps `r` to `min(|w|/2, |h|/2, radius)` — the same clamp a rounded
rectangle needs.

Photoshop specifics worth recording: the four corner radii are independent and linkable by
default, broken out with Alt/Option-drag on the on-canvas control
(`photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "With the Rectangle
Tool, all four corners can be rounded at once, or a single corner can be rounded independently");
the separate Rounded Rectangle tool was removed in 22.3
(`helpx.adobe.com/photoshop/using/modify-shapes.html`); `[` and `]` nudge the radius by 1 px, or
10 px with Shift (`jkost.com`); and a click without a drag opens the Create Rectangle dialog. Adobe
documents that in one sentence and no more — "Click on the canvas to bring up the Create Rectangle
dialog", where you manually set "the dimensions, corner radii of your rectangle, and choose to align
from centre" (`helpx.adobe.com/photoshop/using/modify-shapes.html`) — so the rectangle's field list
is the best-evidenced of the family and the only one Adobe spells out field by field. The app has
a counterpart to it: `CreateShapeDialog` opens on the click with Width, Height, Corner Radius and
From Center, which is all four of the fields Adobe names. What diverges is the entry point rather
than the fields — `Shape W&H` is a control on Photoshop's bar and this app's bar has none — and the
shared-surface section above has the click-detection code.

**The `appNotes` used to contradict this entry's own `options` table, and the fix is a rewrite rather
than a status change.** It ended "Everything else on the Rectangle bar, from the separate Fill and
Stroke swatches down to the path-operation icons, is absent" — while `Fill` and `Stroke` were recorded
as `partial` three lines above, and the code supports them: `Figures/Shape.tsx:209-222` renders a
`Filled` checkbox whose handler sets `hasFill` (`handleFillToggle`, `:53-56`), and `hasFill` is read
in `drawShape` at `src/tools/shape.ts:196`. So what is missing is the **swatch form** — the two
separately clickable swatches with their None / Solid / Gradient / Pattern menu — and the sentence now
says that, and then lists what is absent outright (the path weight, the pixel-mode blend mode, the
anti-alias control, the three path-operation rows, the gear) and what the app's version of the W/H
control is. The **ellipse** carried the same contradiction in a different form — "Everything the bar
offers beyond the tool mode, thickness, dash and opacity is missing" — and is fixed the same way.

App verdict: **partial**, and the verdict is the entry's, not this section's. Drag geometry,
Shift-as-square and Alt-as-from-centre all match — the closest thing in this family to Photoshop, and
the only figure whose own distinctive control (`Radius`) is `present`. It is filed `partial` rather
than `implemented` because the three group-level divergences apply verbatim: Path mode is not a path,
Pixels mode commits a new layer rather than painting into the active one, and the bar carries one
shared colour instead of the
Fill and Stroke swatches. `types.ts:93-96` puts that bar on the `implementation` field, and the
earlier "implemented on behaviour" wording here read as a contradiction of the data file even though
it was aimed at a different axis.

Sources:

- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — the bar, the 22.3 removal, the Create Rectangle dialog, cap and join styles. Re-opened in this pass (2023-11-20) and the removal note is verbatim: "With the March 2021 release of Photoshop 22.3, the Rounded Rectangle tool has been removed"
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — four independent corner radii; Radius only on Rectangle/Triangle/Polygon
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — mode-by-mode bar contents
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — 1 px default stroke, 3 pt default stroke width in the older bar, Align Edges
- `https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html` — `[`/`]` radius nudge, linked corner radii, Spacebar, Control-drag rotate

---

## `ellipse` — Ellipse Tool

`src/tools/shape.ts:249-260` draws a real `ctx.ellipse` from the drag box half-extents, and Shift
through `shape.ts:103-117` squares the box, which for an ellipse is a circle. Correct.

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
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html` — the group membership and Shift = proportional, on the desktop: "click and drag any tool from the shapes tool group in the Tools panel. Hold the Shift key while drawing the shape to make it proportional"
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html` — "Ellipse tool | Draw circular and elliptical shapes"
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — Shift = circle, Alt = from centre

**This entry, like `shape`, was sourcing a desktop-bar claim to the Photoshop-on-the-web page.** The
two claims it leaned on that page for are group membership and Shift = proportional, and both are on
the two desktop pages above — so the web URL is gone and nothing in the entry lost its support. The
`ellipse` `purpose` keeps its own sentence, which is the one this entry's app verdict rests on: no
**desktop** Adobe page enumerating the Ellipse tool's own bar was found, so that the withheld Radius
matches Photoshop is still a judgment. That is unaffected by the swap, and the Unverified entry
below says the same thing.

---

## `line` — Line Tool

The load-bearing fact: **Shift constrains to a multiple of 45 degrees, not 15.** Adobe verbatim,
`helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html` (2024-05-23): "To constrain the
line angle to a multiple of 45 degrees, hold down shift as you drag and draw the line." The
15-degree figure is the Free Transform rotate snap, a different feature; the two are easy to
conflate and the previous campaign's corpus recorded the 45° figure correctly while the task
briefing carried the 15° one.

**And the app implements it — this section previously said the opposite, and the reversal is the
single most important correction in this pass.** See "What this pass found" above. The line figure
has its own branch in `normalizeShapeGeometry`, `src/tools/shape.ts:101`, which hands off to
`snapLineGeometry`, and that function quantizes the drag angle against `LINE_ANGLE_STEP = Math.PI / 4`
(`:61`, applied at `:77`). Shift is therefore **in** the `modifiers` table for the line, cited as
`src/tools/shape.ts:101`, and it is the only figure in the family for which Shift does _not_ square
the drag box — the `if (shiftKey)` arm at `:103` is unreachable for the line. The earlier reading
("`shape.ts:79` reads `if (shiftKey && figure !== 'line')`") described a revision of the file that no
longer exists; what it actually shows now is an early return for the line _above_ the box-squaring
arm. `Shift` is listed for the line, `Alt` and `Space` stay, and the `appNotes` opens on the snap
being right.

**The page moved, and the old URL is not a shortened form of the new one.** The data file and this
file cited `https://helpx.adobe.com/photoshop/using/line-tool.html`; the live page is
`https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html`, "Draw lines with the Line
tool", last updated 2024-05-23. Same for the Triangle tool below. The quote is unchanged; only the
path was wrong, which is the kind of rot a `sources` array accumulates silently because a dead URL
still looks like a citation.

**The same page is the source for the three-mode Weight split**, and it is the reason the shared
`Weight` row cannot state a single behaviour: "To create a line as a shape, choose Shape mode in
the Options bar and then set the Stroke and Weight. To create a pixel line, choose Pixels mode in
the options bar and then set the Weight. To create a path, choose Path mode in the options bar and
then set the Weight." See the shared-surface section above.

Arrowheads: Start and End toggles with Width, Length and Concavity, and the panel is in the
**Contextual Task Bar**, not the options bar. Adobe verbatim,
`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html`
(last updated 2026-02-23): "Select Start or End in the **Arrowheads section of the Contextual Task
Bar** (Window > Contextual Task Bar). Enter values for Width and Length (in pixels) of the arrowhead.
Enter a value for Concavity, between -50% and +50%, to control the curve where the arrowhead meets
the line." The same pattern holds for the Star tool, whose points and inner/outer radii Adobe also
places in the Contextual Task Bar (`.../create-shapes/draw-star-shapes.html`). **This replaces the
previous citation**, a 2015 Adobe _community_ post that placed the panel in the Properties panel
after the draw; the `purpose` no longer says the values stay editable from the Properties panel.

**Concavity's range is now asserted and its default is still not.** The `Arrowheads` row used to say
"the Concavity default could not be sourced to a current Adobe page" and stop there, which read as
though the whole field were unsourced. The range is documented — between −50% and +50% — so it is in
the data file, and only the 0% default remains unverified. See Unverified for the percentage
framing that has replaced the pixel one.

**"Not the gear" was true of the panel and false of the control, and the data file had taken the
wider reading.** An earlier version of the `gearControl` row said the per-tool settings Adobe
documents in the Contextual Task Bar "are not in it", and this section recorded that the gear row
"no longer claims the Arrowheads panel". But the same mode-by-mode page lists Arrowheads inside the
gear: "Set additional shape and path options icon: Set additional Path options, Live Shapes Controls,
**Arrowheads**, and more." The distinction is the one above: the gear offers the Arrowheads control,
the Contextual Task Bar holds the Line tool's Start/End/Width/Length/Concavity values. The row now
names Arrowheads in the gear, and this paragraph is why the two are not in conflict.

The line's colour comes from Stroke, not Fill, because a line is an open path with no interior —
`www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`.

App verdict: **partial**. The segment is right; the 45° snap and the arrowheads are the tool.

Sources:

- `https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html` — Shift = multiple of 45°; Shape/Pixels/Path mode and the Weight
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html` — the Arrowheads panel lives in the Contextual Task Bar (Window > Contextual Task Bar)
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar; Corners explicitly not applicable to the Line tool
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — Concavity default 0% (2012 page, unverified); Weight default 1 px
- `https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html` — re-opened 2024-05-23; the 45° sentence and the three-mode Weight split
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — line colour is the stroke; no rounding options

---

## `triangle` — Triangle Tool

Established in the two-premises section above. The `Radius` row matters here: Adobe gives the
Triangle tool a corner-radius control — its click dialog takes "Width, Height, and Corner Radius" —
that rounds all three corners at once, and there are no individual radius handles
(`helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html`; `glensmith.co.uk/photoshop/triangle-tool`;
`jkost.com`: "the Triangle and Polygon tools have a single Corner Radius control point handle which
modifies the roundness of all corners equally" — note that this last quote is the only source for
the _polygon_ half, since no Adobe page listing the polygon bar was found). The app's `drawShape`
builds the triangle inside the branch shared with the polygon
(`src/tools/shape.ts:205-224`), which never reads `cornerRadius`, so even if the field were
rendered it would do nothing. It is not rendered either.

Shift is the other half. The gear menu carries persistent `Equilateral`, `Unconstrained`,
`Fixed Size`, `Proportional` and `From Center` checkboxes, and Shift is the momentary `Equilateral`
(`glensmith.co.uk/photoshop/triangle-tool`). The app's Shift for this figure is the shared
square-the-box branch at `src/tools/shape.ts:103`.

App verdict: **partial**. Both disproved premises land on this figure at once.

Sources:

- `https://helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html` — Shift = equilateral; click dialog with W/H/Corner Radius/Equilateral/From Center; and the bar in the same order as the Rectangle page's
- `https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html` — Adobe's launch announcement, 2020-10-20: "a new Triangle tool" in Photoshop 2021 (v22)
- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — Radius in the bar; Alt = from centre
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — the persistent geometry checkboxes
- `https://helpx.adobe.com/photoshop/using/modify-shapes.html` — the Rectangle bar's shape, for contrast
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the shared bar this entry inherits, including the Path-mode `Operation` row and the gear's contents

**The page moved here too, and the same way.** `https://helpx.adobe.com/photoshop/using/triangle-tool.html`
is not the page; the live one is
`https://helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html`, "Draw shapes with the
Triangle tool", last updated 2023-05-24. It also turned out to be the cheapest second witness for the
bar order, because it enumerates the bar in its own words: "In the shape tool options bar, set Mode,
Fill, Stroke, W, H, Path operation, Path alignment, Path arrangement, and Additional shape and path
options." That is `Shape W&H` sixth from the left end, which is the position the shared table now
gives it.

**The app's click-with-no-drag path is named in this entry's `appNotes` because this is the figure
where it costs the most.** Adobe documents five fields for this figure's click dialog — Width,
Height, Corner Radius, Equilateral and From Center
(`.../using/tool-techniques/triangle-tool.html`) — and the app's Create Triangle dialog has three
of them, so **two are gaps**. Equilateral is absent outright, which is the same gap the Shift row
above reaches from the other direction. Corner Radius is withheld rather than absent, and the reason
is the renderer rather than the dialog: `drawShape` reads `cornerRadius` in its rectangle branch
only (`src/tools/shape.ts:240`), so a triangle field would take a value and round nothing — and the
Radius this tool has is the one the renderer ignores, so this figure's corners cannot be rounded
here either way.

---

## `polygon` — Polygon Tool

The premise correction is already the app's behaviour: `src/tools/shape.ts:205-224` builds a
regular n-gon inscribed in the drag box. Sides defaults to 5 in Photoshop
(`www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/`: "you can leave
these options at their defaults (sides = 5, radius = 0 px)"), and the app hardcodes 5 at
`src/tools/shape.ts:210`. The default matches; nothing else about the control does, because there
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

**The polygon's click dialog is the one field list Adobe published and then stopped publishing, and
the app's is the intersection rather than a subset of a current page.** Adobe's current documentation
of a click dialog is a single sentence for the rectangle (`.../using/modify-shapes.html`), with the
Triangle adding Corner Radius, Equilateral and From Center
(`.../using/tool-techniques/triangle-tool.html`); a January 2021 archive of `drawing-shapes.html` is
the only place the polygon's own list survives, naming Symmetric, Number of Sides, Corner Radius,
Star Ratio and Smooth Star Indents beside Width & Height and From Center, and the current page
carries none of them. So the app's Create Polygon dialog — Width, Height, From Center — cannot be
checked against a live Adobe list, and none of the five archived fields is missing from the app
merely because the dialog omits it: `drawShape` hardcodes five sides at `src/tools/shape.ts:210` and
reads no star or indent argument at all, so every one of them would be inert if a field offered it.
They are gaps, and they are gaps in the renderer first — the dialog is the second place they would
have to be closed, and it is not where they can be.

Modifiers: Shift constrains proportions, off by default; Alt/Option draws from the centre, though a
polygon is already centred in its drag box; Control/Cmd while dragging rotates it; Spacebar
repositions. The app implements Space and the square-box Shift, and neither the from-centre
modifier's distinct meaning nor the Control-drag rotation. **`Control` is therefore absent from the
data file's `modifiers` table**, for the same reason `Shift` is absent from the line tool's: it is
named as a Photoshop modifier and the app implements nothing for it, so listing it would put a row in
a machine-readable table that reads as "this key is in effect during the drag". The Photoshop
behaviour is not lost — it is in the `purpose` and in this paragraph.

**`[` and `]` are gone from the data file for a stronger reason than "not bound".** They are Photoshop
polygon shortcuts, and **the bracket keys are not unbound — the earlier version of this file said they
were, which was false.** `AppKeyboardShortcuts.tsx:539` and `:547` register them, with
`repeat: true` so that holding one scrubs. They are gated on `tipSizeTool(toolName) !== null`, and
`tipSizeField` (`:43-52`) names exactly eight tools: brush, pencil, eraser, color-replacement, smudge,
dodge, burn, clone-stamp. No shape figure is in that map, so for this family the keys are **inert,
not unbound**. What makes them unrecordable here is that they change a side count which does not
exist at runtime: `src/tools/shape.ts:210` is
`const sides = figure === 'triangle' ? 3 : 5`, a literal — and a **two-branch** ternary, not the
three-way one the data file's `appNotes` called it. The substance was right and the description was
not, so `appNotes` now says "two-branch ternary" and quotes the declaration.

**The app has no Star tool, and that is the app's gap rather than a fact about Photoshop.** The
polygon's `appNotes` used to close with "the star is not this tool's to draw in the current release,
so there is nothing here to compare a star Ratio against", which put a missing capability in the
voice of a Photoshop statement — a reader could take it for a claim that 26.10 moved the control and
not for a note that this app cannot draw a star at all. It now says the app has no Star tool. The
absence is recorded on the `shape` entry as well, because that is where the group's membership lives
(`toolbar-mapping.ts:114-121`, six entries against Photoshop's seven); see the `shape` section above.

App verdict: **partial**. The drag-defined model is right; the side count and the rotation are not
there, and the app has no Star tool to compare a star Radius against.

Sources:

- `https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/` — drag-defined; Sides default 5, Radius default 0 px; Shift = symmetrical
- `https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` — polygon always drawn from its centre; Shift limits the angles
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html` — the separate Star tool and its points / Inner Radius / Outer Radius
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html` — the group as a tools table, "Polygon tool | Draw polygonal shapes" next to "Star tool | Draw star shapes"
- `https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html` — `[`/`]` change the side count, by 10 with Shift; Control-drag rotates; star attributes in the Properties panel
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar

---

## `custom-shape` — Custom Shape Tool

**A placeholder, stated as a fact rather than hidden.** `src/tools/toolProcessors.ts:364-368` is
`commit: 'unimplemented'` with the shared `unimplemented` rasterizer (declared at
`toolProcessors.ts:110`, not `:110`, which is a blank line); `src/tools/toolsMap.ts:180-184`
renders `PlaceholderTool` with a TODO badge; `src/tools/settings.ts:336` persists nothing but the
tool name. The panel that does render is a chip list, and the chips are Photoshop's real control
names rather than filler — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:37` reads
`['Tool Mode', 'Fill', 'Stroke', 'W/H', 'Shape Picker', 'Path Operations']`.

**All six `inert` rows cited the wrong line, and the wrong line is in another tool's group.**
`toolbarPlaceholderConfig.ts:28` is `'Fill',` — the second entry of the **`rectangle`** chip list,
which runs from `:26` to `:36` and names `Stroke Width`, `Stroke Style`, `W/H`, `Path Operations`,
`Alignment` and `Radius` as well. The custom-shape list the record quotes verbatim is `:37`. Six
`appRef`s pointed at a line whose text is one of the very chips being cited, inside a list for a
different tool; the constant now points at `:37`.

**The chip list is why nine of this entry's `options` rows were wrong, and the fix is a status, not a
sentence.** This entry had inherited the shared `sharedFigureOptions` consts, which carry the shape
**bar's** statuses and the shape bar's `appRef`s — for a tool that never renders that bar. Six of the
nine rows below were `partial` and three were `missing`; the correct reading is:

| Row               | Was     | Now       | Why                                                                                                               |
| ----------------- | ------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `Mode`            | partial | `inert`   | chip "Tool Mode" is on screen, nothing reads it                                                                   |
| `Fill`            | missing | `inert`   | chip "Fill" is on screen, nothing reads it                                                                        |
| `Stroke`          | partial | `inert`   | chip "Stroke" is on screen, nothing reads it                                                                      |
| `Shape Picker`    | missing | `inert`   | chip "Shape Picker" is on screen, nothing reads it                                                                |
| `Shape W&H`       | partial | `inert`   | chip "W/H" is on screen, nothing reads it; the Create <Figure> dialog the other five figures get never opens here |
| `Path Operations` | missing | `inert`   | chip "Path Operations" is on screen, nothing reads it                                                             |
| `Stroke width`    | partial | `missing` | no chip in this tool's list, and the bar that carries it never renders                                            |
| `Stroke type`     | partial | `missing` | same                                                                                                              |
| `Opacity`         | partial | `missing` | same                                                                                                              |

The `inert` / `missing` split is the whole point of the two statuses, and it is the same split the Pen
family already makes. `inert` is "declared **or displayed**, and nothing is wired behind it", whose
second shape is spelled out in `types.ts` as "a label on a placeholder chip that no component ever
reads" — which is these six exactly. `missing` would deny a fact a screenshot shows. The other three
go the other way: no chip exists, and the real bar does not render, so there is nothing to point at
and no `appRef` is carried. A `missing` row must not carry the key at all, so those three are built
with a rest-destructuring helper (`withoutAppRef` in `shape.ts`) rather than with
`{ ...shared, appRef: undefined }`, which leaves a present, value-less key on the row and
contradicts the contract.

**The row ORDER here now matches the shared list, because the old order was defended by
nothing.** This entry builds its own list instead of taking `sharedFigureOptions`, and it used
to run the shared rows out in a different sequence: `Weight` and the three Pixel-mode rows
came before the Shape Picker, `Shape W&H` and the path rows, where the shared list puts
`Shape W&H` sixth from the left and the Pixel-mode rows last, after the gear. **No page opened
in this pass sources a different order for this bar** — `draw-custom-shapes.html` documents
the tool, the picker and the Define Custom Shape round trip, not the sequence of the bar — so
the earlier sequence was the list the way it happened to be written, which is precisely what
the shared-surface section above rules out. The list is now `sharedFigureOptions` in its
declared order with `Shape Picker` at its head, and **only the `status` and the `appRef` differ
from the shared consts**: those are the chip list's doing, as the table above sets out, and not
a claim about Adobe's order. The one row that is not in the shared list is the picker, and its
position is a **judgment, stated as one**: it leads the bar on the same reasoning the rest of
the list is ordered by — it is the only control that chooses which shape is drawn, and every
row after it modifies that choice. A position in a bar order is a claim like any other, so it
is recorded here rather than left looking sourced.

**The `Fill` row was a hand-copied duplicate of `fillControl.detail` and is now a spread.** The
string was byte-identical to the shared const's, which is the only thing that made it safe, and
a 182-character detail that has to be kept in step by hand is a drift waiting to happen. The row
now reads `{ ...fillControl, status: 'inert', appRef: CUSTOM_SHAPE_CHIPS }` like its `Mode`,
`Stroke` and `Shape W&H` neighbours, which produces the same four keys and the same values.

**The chip list is not the only reason the shape bar does not render.** The canvas dispatch
`src/components/Main/Main.tsx:84-90` names `shape`, `rectangle`, `ellipse`, `triangle`, `polygon` and
`line` and **not** `custom-shape`, so this tool matches no branch: `interactionMode` stays `'zoom'` and
the canvas area is `DummyToolArea`, a `display: none` div
(`src/components/Main/DummyToolArea.tsx:15`). That is why every `appRef` in the nine rows above points
at the chip list and none at `Figures/Shape.tsx` or `src/tools/shape.ts`, and it is also why the three
`modifiers` rows — Shift, Alt and Space — are bound to nothing: there is no drag for them to modify.
The same absence is why the `Shape W&H` chip is `inert` rather than `partial`: the app's
Create <Figure> dialog lives in `ShapeToolArea`, which this tool never mounts, so a click with no drag
does nothing rather than asking for a size.

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
- `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html` — the bar rows this entry shares with the figures, including the Path-mode `Operation` row and the gear's Arrowheads
- `https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` — Subtract Front Shape, Merge Shape Components and its warning, the 1 px default stroke
- `https://www.adobe.com/products/photoshop/shapes.html` — `.csh` via Preset Manager; Define Custom Shape
- `https://tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html` — Cumulus `8BCS` / `8BPF`
- `https://www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/` — the six path operations
- `https://www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html` — the four default groups (2020; no longer current)
- `https://community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992` — Shapes panel and Legacy Shapes and More
- `https://glensmith.co.uk/photoshop/custom-shape-tool` — third party: Shift preserves the preset's own aspect ratio
- `https://trainingonsite.com/images/downloads/Photoshop-2026-tools-modifiers-2026-01-01.pdf` — an Adobe training partner's modifier cheat sheet, re-opened in this pass: "Custom Shape (U) shift constrains ratio", "Line (U) shift constrains to 0°, 45°, 90°", and a six-entry shape-tool list with no Star. It is also where the "Triangle (U) shift drag constrains circle" contradiction in Unverified comes from

---

## Keyboard

| Keys      | Photoshop                                                                | App                                                                                                                       | App site                           |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `U`       | select the shapes tool group                                             | keeps the active figure; only a non-shape tool (including Custom Shape) falls back to `figure: 'rectangle'`               | `AppKeyboardShortcuts.tsx:150-156` |
| `Shift+U` | cycle through the whole group                                            | cycles only `rectangle → oval → line → custom-shape`; `triangle` and `polygon` index to `-1` and restart at the rectangle | `AppKeyboardShortcuts.tsx:137-139` |
| `[` / `]` | Rectangle: radius ∓1 px; Polygon: sides ∓1; Line: weight ∓1; Shift = ×10 | bound, but only for the eight tip-Size tools; every shape figure is outside that map                                      | `AppKeyboardShortcuts.tsx:539`     |
| `Space`   | reposition while drawing                                                 | implemented                                                                                                               | `ShapeToolArea.tsx:52`             |

The `Shift+U` cycle is the gap: `triangle` and `polygon` are absent from the ordered list at
`src/components/Common/AppKeyboardShortcuts.tsx:137`, so `Shift+U` never advances to them even though
both are registered `ToolName`s with their own entries in the tools map. **The failure mode is a
restart, not a freeze**, and the distinction is load-bearing for the row's wording: the branch is
`orderedFigures[(currentIndex + 1) % orderedFigures.length]` with `currentIndex = indexOf(currentFigure)`,
so an unlisted figure gives `-1` and `(-1 + 1) % 4 === 0` — the rectangle. Every data-file row now says
Shift+U from the Triangle or the Polygon "restarts at the rectangle instead of advancing".

**Plain `U` is not "always jumps to the rectangle" either, and that was the other half of the same
mistake.** The five geometric figures in the rail all carry `name: 'shape'` and differ only by
`figure` (`toolbar-mapping.ts:115-119`, applied at `SidebarLeft.tsx:590-605`), so
`toolName === 'shape'` for all five and the early return at `AppKeyboardShortcuts.tsx:150-152` keeps the
figure. The Custom Shape tool is the one entry with its own tool name (`toolbar-mapping.ts:120`), so
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
- **The version that split a dedicated Star tool out of the Polygon tool — now a data-file claim, and
  what kind of claim it is.** Adobe documents a Star tool with Points, Corner radius, Inner Radius
  and Outer Radius
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html`;
  the same content at `https://helpx.adobe.com/photoshop/using/create-star-shape.html`), but neither
  page states which release introduced it. The 26.10 figure has **a page that names the number** — an
  Adobe Community announcement thread, 2025-08-20, "You can now create customizable star polygons
  directly on the canvas using the Star tool, located within the Shapes tool group in the Tools
  panel" (`https://community.adobe.com/questions-712/photoshop-v26-10-create-the-perfect-star-shape-for-your-designs-and-multiple-enhancements-1181840`)
  — and a third-party release report on the same day ("Photoshop 26.10 is a minor update, with the
  only new feature listed being the Star tool",
  `https://www.cgchannel.com/2025/08/adobe-releases-photoshop-26-10/`). Both are now in the `shape`
  entry's `sources`, and the data file says "the Star arrived as a tool of its own in 26.10" on the
  strength of the two together: an Adobe **community announcement**, which is not a release note,
  corroborated by an independent report. It is no longer an unsourced figure, and it is no longer an
  Unverified one either — the honest description is a well-attributed account that two independent
  pages agree on. The star is absent from the `polygon` description for the separate and stronger
  reason that it is documented on another tool.
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
  `https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html` —
  "To draw a shape on the canvas, click and drag any tool from the shapes tool group in the Tools
  panel". The data file keeps the geometry and labels it an inference. (This sentence previously cited
  the Photoshop-on-the-web page, which is a different product and is no longer cited anywhere in this
  family.)
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
  of 5 is corroborated by a 2022 page; the range is not restated on any page of currency. Note that
  the same 2012 source documents a **Star** checkbox with an `Indent Sides By` default of 50% on the
  Polygon tool's own bar — the pre-22.0 arrangement. The current Adobe star page attributes those
  controls to the separate Star tool, so the two cannot both describe 2026, and the data file
  attributes the star to the Star tool throughout.
- **Whether the Star tool's `Points`, `Inner Radius` and `Outer Radius` replaced the pre-22.0
  `Indent Sides By %` and `Smooth Indents`, or coexist with it.** The old labels are sourced to
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html` and to the 2012
  third-party page above; the new ones to the current Adobe star page, which lists "Set number of
  sides (or points on a star)", "Corner radius", "Inner Radius" and "Outer Radius" in the
  Contextual Task Bar and says the same values are adjustable "from the Options panel". No page
  opened states the migration, and none of them dates the star's introduction.
- **Whether Photoshop's Triangle Shift was equilateral at introduction.** Unchanged from the last
  pass and re-checked here: the behaviour is directly sourced to Adobe's current triangle page and
  is asserted, the version of introduction is sourced to the 2020-10-20 launch announcement, and
  what Shift did on day one is still not stated by anyone.
- **Whether the Polygon tool's `Sides` and `Radius` fields are on the bar in 2026, or only in the
  click dialog and the Properties panel.** The third-party pages that document them describe a
  mixture — `photoshopessentials` puts Sides and Radius on the bar, `glensmith` puts them in the
  "Create Polygon" dialog the click opens and shows the corner radius as an on-canvas handle. No
  Adobe page enumerating the Polygon tool's bar has ever been found, so the data file's `Sides` row
  gives the default (5, third-party) without a range, and its `Radius` row says which of the five
  figures Adobe confirms and which it does not.
- **The arrowhead `Width` and `Length` _ranges_, which this list used to state in the wrong unit.**
  The percentages — `Width` 10–1000% of line width, `Length` 10–5000% — came from
  `http://www.underwaterphotography.com/photoshop/photoshop/1_11_3_1.html`, an ImageReady-era page
  describing a pop-up dialog box that is no longer the Photoshop control, and the same figures appear
  in Adobe's Photoshop **Elements** guide ("10% to 1000% for Width, and 10% to 5000% for Length",
  `helpx.adobe.com/photoshop-elements/desktop/adding-shapes-and-text/creating-shapes.html`).
  **Adobe's current desktop page is in pixels and gives no percentage at all**: "Enter values for
  Width and Length (in pixels) of the arrowhead. Enter a value for Concavity, between -50% and +50%,
  to control the curve where the arrowhead meets the line"
  (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html`,
  2026-02-23). So the data file now asserts the three control names, Concavity's −50%…+50% range and
  the fact that Width and Length are pixel values, and asserts no numeric range for Width or Length.
  The 0% Concavity default still appears only on a 2012 page and remains out of the data file.
- **The Line tool's `Weight` default of 1 px in the current release — now answered by a
  measurement rather than by a tutorial, except for the line itself.** The ScriptListener dump in
  the Adobe Community thread above reports `"strokeStyleLineWidth": { "_unit": "pixelsUnit",
"_value": 1 }` for the rectangle tool in shape mode, alongside `strokeStyleAlignCenter`,
  `strokeStyleButtCap` and `strokeStyleMiterJoin`. It reports no `Weight` default for the **line**
  tool, and it is a community thread rather than an Adobe help page, so the 1 px default _stroke_
  now rests on a first-hand dump instead of the 2012 and 2015 third-party pages while the line's own
  `Weight` default stays out of the data file.
- **The default stroke alignment being Centered — now answered twice, once first-hand.**
  `strokeStyleAlignCenter` in that dump, and independently
  `www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/` (2022). Adobe's
  current bar page lists the three alignment values without naming a default. The data file's
  `Stroke type` row now also names the **Butt** default cap, from the same dump. The **Miter** join
  default is in the dump too and is not stated in the data file, because `Stroke type`'s `detail`
  is one sentence and the default a reader is most likely to check first is the width.
- **Whether the Star tool is in the shapes group in a 2024–2026 install — the evidence got
  stronger, and one piece of it cuts the other way.** Two current Adobe help pages put it there and
  give it its own controls: `create-star-shape.html` (2025-08-20) and
  `desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html` (2026-02-23) both open "Select the
  **Star tool** from the shapes tool group in the Tools panel", and both list its Contextual Task
  Bar rows — Fill and Stroke, Stroke width, "Set number of sides (or points on a star)", Corner
  radius, Inner Radius, Outer Radius. The **version** is still a community announcement plus one
  third-party report, both 2025-08-20. **Against it:** Adobe's own training partner cheat sheet,
  `trainingonsite.com/images/downloads/Photoshop-2026-tools-modifiers-2026-01-01.pdf`, dated well
  after the 26.10 release, lists VECTOR SHAPE TOOLS as exactly six — Rectangle, Ellipse, Triangle,
  Polygon, Line, Custom Shape — with no Star. That is a one-page summary, not a specification, and
  two help pages of currency outrank it; but it is a real counter-example, it is recorded here rather
  than dropped, and it is part of why the data file says "the Star arrived as a tool of its own in
  26.10" on the strength of two sources rather than one.
- **`Align Edges` on a shape tool's bar — a control this family never recorded, and it may be
  gone.** Two third-party pages name it: `www.pcworld.com/article/399355/…` (2020) says the shape
  bar ends with "the Align Edges feature, which aligns vector shape edges to the pixel grid", and
  `www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/` (2012) lists Align Edges
  in its bar inventory. **No Adobe page opened in any pass mentions it**, and none of the current
  bar enumerations — `modify-shapes.html`, the Triangle page's own bar sentence, the mode-by-mode
  page — include it. So it is either a control Adobe has since removed or one Adobe's help never
  documented, and nothing available here tells the two apart. It is therefore **not** in the data
  file: adding a row would assert a Photoshop fact the record cannot source, which is the same rule
  that keeps the Concavity default out. **Checked against a running Photoshop before anyone
  decides.**
- **The current default shape groups in the Custom Shape picker.** The four groups
  (Leaf Trees, Wild Animals, Boats, Flowers) are from a 2020 PCWorld article; the 2019–2021 Adobe
  Community threads say the picker changed and those groups moved behind "Legacy Shapes and More",
  and Adobe's own `draw-custom-shapes.html` carries a separate "Add legacy custom shapes" nav item
  (confirmed again in this pass, beside its Select-the-Shape-dropdown and Import-Shapes steps). What
  a given 2024–2026 install shows on first launch was not established. The data file previously
  called those four "the default groups" flatly, which **contradicted this entry**; it now names the
  library's contents, dates the "default" to the 2020 article, and says the current install is
  unestablished.
- **That the Custom Shape tool's Shift preserves the preset's own width-to-height ratio — better
  sourced, still not an Adobe help sentence.** Two tutorial sites carried it and nothing else; the
  Adobe training partner's 2026 modifier sheet now says "Custom Shape (U) shift constrains ratio;
  opt/alt draws from center", which is a second and more institutional witness. The data file's three
  occurrences still say third-party and now name the cheat sheet as the corroboration. The same
  sheet says "**Triangle** (U) shift drag constrains **circle**", which is Adobe's own one-line
  summary contradicting Adobe's dedicated Triangle page — "Hold the Shift key while dragging to
  create an **equilateral triangle**" — and three third parties. The page wins: it is the tool's own
  page, it is specific, and a cheatsheet cell is not a specification. Recorded because the
  contradiction is on Adobe's side of the line and the next session will trip over it.
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
