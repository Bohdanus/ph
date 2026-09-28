# Selection family — research notes

The seven `ToolName`s in this family are the selection tools, and they share a shape that is
worth stating once rather than seven times: in Photoshop every one of them carries the same
four-mode combination control in its options bar, and four of the five that draw a border also
carry the same Feather and Anti-alias pair. The UXP scripting reference makes the reason
explicit — `Selection` is a pixel channel, not a vector, so `selectRectangle`, `selectEllipse`
and `selectPolygon` each take a `feather` (default `0`) and an `antiAlias` (default `true`)
argument, and each takes a `SelectionType` of `REPLACE`, `EXTEND`, `SUBTRACT` or `INTERSECT`
for what to do with an existing selection. The combination modes are therefore per-pixel
boolean operations on a coverage mask, and nothing about them lives on the tool.

Target version: **Photoshop 2025–2026**, with two controls named by their older labels where
Adobe's own documentation is version-split (see the Quick Selection and Magic Wand entries).

Every claim below was re-verified against sources opened during this pass. The research corpus
at `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` was read first and used as a starting
index, but nothing was transcribed from it: where it disagrees with what a live source said
this pass, the source wins, and the two places it loses are recorded at the end.

## What is true of all seven

- **Combination modes.** `New / Add To / Subtract From / Intersect With` appears on the marquee
  tools, the lasso tools and the Magic Wand. The Quick Selection is the exception, with three —
  New, Add to and Subtract from, and no Intersect. That is a real divergence, confirmed twice
  below, and the one place in the family where a selection tool's bar has fewer modes than its
  siblings.
- **The app has no `Select` menu.** There is no `Select All`, `Deselect`, `Inverse`,
  `Color Range`, `Modify > Feather/Expand/Contract/Border/Smooth`, `Grow`, `Similar`,
  `Refine Edge`, `Select and Mask` or `Transform Selection` anywhere in the application. The
  only deselect is the `Clear` button the elliptical, freehand, magnetic, wand and quick-selection
  bars render, bound to `clearSelections`. This removes Photoshop's two most important
  follow-ups for the wand and the quick selection outright.
- **`Select and Mask` is on every bar, not just the wand's.** Adobe's Select-and-Mask tutorial
  puts it this way: "Open the Select and Mask workspace by choosing Select > Select and Mask, or
  by clicking Select and Mask in the Options bar **for any of the selection tools**." It is
  therefore recorded as a `missing` control on all seven tools rather than on the one whose own
  page happens to name it. The workspace it opens is documented by Adobe
  (`refine-your-selection-and-mask.html`, last updated February 2026) as carrying a Refine Edge
  Brush for soft edges, a plain Brush for manual work, View Modes of `On Black`, `On White`,
  `Black and White`, `On Layers` and `Show Edge`, and an `Output To` menu that can produce a
  selection, a layer mask, a new layer or a new document.
- **The app has one active selection.** `committedSelectionUpdate` in
  `src/contexts/useSelectionHistory.ts:42` deactivates every existing selection on a
  `create` commit, so there is no model in which a second selection can be unioned, subtracted
  from or intersected with the first. Every combination mode in this family is therefore
  `missing` for a structural reason, not an oversight in one bar.
- **The selection is a single point path.** `Selection` in `src/contexts/general-types.ts:17`
  carries a `points` polyline and no mask, and `SelectionSourceTool` has no
  `elliptical-selection` or `quick-selection` member. The elliptical marquee and the quick
  selection both commit under a borrowed `'magic-wand'` identifier so that their outlines carry
  neither draggable anchors nor an anchor hit-test.

## Rectangular Marquee Tool — `rectangular-selection`

Photoshop's bar, left to right: the four combination modes, `Feather`, `Style`, and the
`Width`/`Height` fields that `Fixed Ratio` and `Fixed Size` expose. `Normal` takes its
proportions from the drag and greys the numeric fields out. `Fixed Ratio` is documented as
setting "a height-to-width ratio", entered as two decimal fields — the worked example on the
page is 2 in one and 1 in the other for a box twice as wide as it is high — and `Fixed Size`
"specifies set values for the marquee's height and width" in whole pixels. Both styles accept
document units (`in`, `cm`) as well as `px`.

Modifiers: `Shift` constrains to a square, and the page is explicit that "release the mouse
button before you release Shift to keep the selection shape constrained"; `Alt`/`Option` drags
from the center.

### Options table

| Control                                       | Photoshop                                                                 | App status | App ref |
| --------------------------------------------- | ------------------------------------------------------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes, also Shift/Alt/Shift+Alt                                      | `missing`  | —       |
| Feather                                       | pixel radius, default 0, set before the selection                         | `missing`  | —       |
| Style                                         | Normal / Fixed Ratio / Fixed Size                                         | `missing`  | —       |
| Width and Height                              | decimal pair for Fixed Ratio, whole pixels for Fixed Size, units accepted | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar                                             | `missing`  | —       |

**App fidelity: partial.** `RectangularSelectionToolArgs` is `{ rect?, toolName }` and
`defaultSettings['rectangular-selection']` is `{ toolName: 'rectangular-selection' }` — the
tool declares no settings at all, so there is nothing that could be `inert`. Its bar renders a
sentence and three buttons.

**The modifier finding.** The rectangle is drawn through `useRect`, and `useRect` reads
`event.ctrlKey || event.metaKey || event.shiftKey` in one place only: when a **handle of an
already-committed rectangle is being resized**, where it locks the aspect ratio to the one the
rect already has. Nothing reads Shift during the initial drag, so Shift-to-square is not
implemented at all, and what _is_ implemented is a different feature that happens to use the
same key.

## Elliptical Marquee Tool — `elliptical-selection`

Same bar plus `Anti-alias`, and the marquee tools are the only place Adobe offers it: "Turn
anti-aliasing on or off for the Elliptical Marquee tool." Modifiers: `Shift` for a circle,
`Alt`/`Option` from the center.

### Options table

| Control                                       | Photoshop                                          | App status | App ref                       |
| --------------------------------------------- | -------------------------------------------------- | ---------- | ----------------------------- |
| New / Add To / Subtract From / Intersect With | four modes                                         | `missing`  | —                             |
| Feather                                       | pixel radius, default 0                            | `missing`  | —                             |
| Anti-alias                                    | on by default; marquee tools only                  | `missing`  | —                             |
| Style                                         | Normal / Fixed Ratio / Fixed Size                  | `partial`  | `EllipticalSelection.tsx:96`  |
| Width and Height                              | decimal pair (ratio) / whole pixels (size) / units | `partial`  | `EllipticalSelection.tsx:112` |
| Select and Mask                               | on every selection tool's bar                      | `missing`  | —                             |

**App fidelity: partial** — the only tool in the family with any Photoshop control on its bar,
and the geometry is right. The two `partial` verdicts are both about the _shape of the fields_:
Fixed Ratio is a single `Ratio` number (floor `0.05`, ceiling `20`) where Photoshop's is a pair
of decimals, and Fixed Size is a plain pixel `input[type=number]` where Photoshop's accepts
`in` and `cm`. `resolveEllipseRect` does implement `fixed-size` the way Photoshop does —
ignoring the drag, with the press point only supplying the center, so a click is a complete
gesture — and `EllipticalSelectionToolArea` passes `event.shiftKey` as `constrainToCircle` and
`event.altKey` as `fromCentre`, which are exactly Photoshop's two modifiers.

**The tessellation finding.** The committed ellipse is a polygon, not a curve: `ellipseVertexCount`
solves for the vertex count that keeps the chord's sagitta at or under a quarter of a pixel, so
the outline is visually a circle and is not one in the data. Worth stating because a selection
that is a point path cannot be a true curve without this, and because the app's own hit test and
outline renderer agree on the polygon.

## Lasso Tool — `freehand-lasso`

Photoshop's bar is the three controls: the four combination modes, `Feather`, and `Anti-alias`
— and Adobe is explicit that the Anti-alias box is "selected by default" for this tool. Drag
draws the border, release closes it, and Photoshop "will help complete your shape by connecting
small gaps between your end point and starting point".

### Options table

| Control                                       | Photoshop                     | App status | App ref |
| --------------------------------------------- | ----------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes                    | `missing`  | —       |
| Feather                                       | pixel radius, default 0       | `missing`  | —       |
| Anti-alias                                    | on by default                 | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar | `missing`  | —       |

**App fidelity: partial.** No Photoshop control is on this bar. The one control it does render
is labelled `Mode` and toggles between `Outline` and `Fill`; that is the app's own invention
and it changes how the committed border is painted, not how a gesture combines with an existing
selection — so it shares a name with the thing it is not. `LassoToolArgs` carries `alpha`,
`lineWidth`, `color` and `fill`, none of which Photoshop puts on this bar.

**Shortcut gap.** Photoshop binds `Return`/`Enter` to select the tool and focus the `Feather`
field, so a feather can be typed before the next trace. Nothing in the app binds it.

## Polygonal Lasso Tool — `polygonal-lasso`

Identical three-control bar. The gesture is where this tool lives, and Adobe's page is
complete about it: click to set the starting point; `Alt`/`Option`-drag to draw a freehand
segment; `Delete` to erase recently drawn straight segments; and three documented ways to
close — click the starting point (a closed circle appears next to the pointer), `Ctrl`-click
or `Cmd`-click, or double-click / `Enter` / `Return` for a magnetic segment, with
`Alt`-double-click closing on a straight one.

### Options table

| Control                                       | Photoshop                                                         | App status | App ref |
| --------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes                                                        | `missing`  | —       |
| Feather                                       | pixel radius, default 0                                           | `missing`  | —       |
| Anti-alias                                    | on by default; visible effect only on Alt-drawn freehand segments | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar                                     | `missing`  | —       |

**App fidelity: partial**, and this is the most _gesturally_ faithful tool in the family — the
click-to-add-anchor, double-click close, right-click close, `Enter` close, `Backspace`/`Delete`
anchor removal and `Escape` abort are all registered in `PolygonClickToolArea` — against the
least complete bar. The bar is forty lines: one Outline/Fill toggle and a hint. It is also the
only bar in the family with no Copy, Paste or Clear buttons, which the freehand and magnetic
lasso bars beside it both render.

**Correction to the research corpus.** `01-photoshop-reference.md` §1.5 attributes to this tool
a click-and-drag that produces a _smooth anchor with drag-set tangent handles_, cited to [8][9].
The current Adobe page does not say that: it says to hold `Alt`/`Option` **and drag** to draw a
freehand **segment**, and to hold `Alt`/`Option` and double-click to close with a **straight
segment**. The drag-handle claim was not re-established from a live source and has been left
out of the data file. The corpus's own `Alt` + drag freehand-segment claim, its three closing
gestures and its `Backspace` claim all survived re-verification.

## Magnetic Lasso Tool — `feather-magnetic-lasso`

The most densely specified bar in the family. Adobe's page gives `Width` as a pixel value
("The Magnetic Lasso tool detects edges only within the specified distance from the pointer"),
`Contrast` as a percentage, and `Frequency` as a rate:

> To specify the rate at which the lasso sets fastening points, enter a value between 0 and 100
> for Frequency. **A higher value anchors the selection border in place more quickly.**

Two third-party sources agree on the direction and add the defaults: `photoshopessentials.com`
gives a default Frequency of 57 and states "The higher the value, the more anchor points will be
added"; `lifewire.com` documents the same `Feather / Width / Contrast / Frequency` set and the
`[`/`]` width keys. `Stylus Pressure` is documented on Adobe's page as a fourth edge-detection
option. The tool is "not available for 32-bits-per-channel images".

### Options table

| Control                                       | Photoshop                                                                | App status | App ref                        |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------- | ------------------------------ |
| New / Add To / Subtract From / Intersect With | four modes                                                               | `missing`  | —                              |
| Feather                                       | pixel radius, default 0                                                  | `partial`  | `FeatherMagneticLasso.tsx:252` |
| Anti-alias                                    | on by default                                                            | `present`  | `FeatherMagneticLasso.tsx:331` |
| Width                                         | pixel detection radius; `[`/`]` adjust; `Caps Lock` shows it as a circle | `present`  | `FeatherMagneticLasso.tsx:265` |
| Contrast                                      | 1%–100%                                                                  | `partial`  | `FeatherMagneticLasso.tsx:278` |
| Frequency                                     | 0–100 rate; **higher = more fastening points**                           | `partial`  | `FeatherMagneticLasso.tsx:291` |
| Stylus Pressure                               | checkbox; narrows Width under stylus pressure                            | `missing`  | —                              |
| Select and Mask                               | on every selection tool's bar                                            | `missing`  | —                              |

**App fidelity: partial.**

**The Frequency inversion — the finding most likely to be wrong, and the one worth a second
look.** The app stores `frequency` as a maximum path length in pixels and uses it as
`if (pathLength(segment.path) < args.frequency) return false;` in the auto-fastening-point
predicate: longer spacing means _fewer_ anchors. Its own options-bar help text says "Lower
values add more anchors and track detailed edges more tightly." Adobe's `Frequency` is a rate
on 0–100 where a higher value lays fastening points down more densely. Both readings are
internally consistent; they are not the same control, and a user who transfers a muscle memory
from one slider to the other gets the opposite result. This is marked `partial` rather than
`missing` because the control is rendered and genuinely wired — it just means something else.

**The other two `partial` verdicts.** `Contrast` allows 0% where Adobe's documented range
starts at 1%. `Feather` is the same _meaning_ as the marquee Feather but is capped at 100
pixels, is applied to the copied alpha mask rather than to the selection, and has no
`Select > Modify > Feather` behind it — and because `copySelectionToCanvas` routes only this
tool through the feathered path, it is the only tool in the family where a feather control does
anything at all.

**Three app-only controls.** `Snap` (0–1, described by the bar's own help text as "how
strongly the cursor is pulled toward detected edges"), `Smooth` (0–10 px path simplification),
and the `Preview feather` outline. None has a Photoshop counterpart, so none appears in the
`options` array; they are recorded here and in `appNotes`.

**Shortcut gap.** `[`/`]`, `,`/`.`, `Caps Lock`, `Return` and `Delete` are all documented by
Adobe or by two independent third parties; none is bound in the app.

## Magic Wand Tool — `magic-wand`

This is the tool whose bar changed most in the corpus's window and where the current Adobe page
is the better source. The 2025-11-04 page lists the bar in full — `Sample Size`, `Tolerance`
("from 0 (narrow) to 255 (broad)"), `Anti-alias`, `Contiguous`, `Sample All Layers` — while the
2023 how-to page lists only `Tolerance`, `Anti-aliased`, `Sample All Layers` and `Contiguous`
alongside the four combination modes. The defaults come from `photoshopessentials.com` and
Adobe's Photoshop Elements page, which agree: `Tolerance` 0–255 defaulting to 32, `Contiguous`
on, `Anti-alias` on, `Sample All Layers` off.

### Options table

| Control                                       | Photoshop                                             | App status | App ref            |
| --------------------------------------------- | ----------------------------------------------------- | ---------- | ------------------ |
| New / Add To / Subtract From / Intersect With | four modes; `Shift`-click adds, `Alt`-click subtracts | `missing`  | —                  |
| Sample Size                                   | how much image is sampled for sensitivity             | `missing`  | —                  |
| Tolerance                                     | 0–255, default 32                                     | `partial`  | `MagicWand.tsx:54` |
| Anti-alias                                    | on by default                                         | `missing`  | —                  |
| Contiguous                                    | on by default; off = same colors throughout the image | `missing`  | —                  |
| Sample All Layers                             | off by default                                        | `missing`  | —                  |
| Select and Mask                               | on every selection tool's bar                         | `missing`  | —                  |

**App fidelity: partial.**

**`Contiguous` is the finding here, and it is not `inert`.** It is absent from
`MagicWandToolArgs` entirely, so it is neither declared nor rendered and the honest status is
`missing`. But the behaviour is not absent: `MagicWandSelectionOptions` carries a
`contiguous?: boolean`, and the util takes the contiguous branch unless the value is
_explicitly_ `false`. The tool area constructs its options from `tolerance` and `smoothing`
alone, so the global branch is unreachable from the toolbar. The non-contiguous selection — the
one that makes the wand useful on a repeated sky or a duplicated product shot — cannot be made
at all.

**`Sample All Layers` is missing in the worst way: it is permanently on.** The tool area passes
`canvasRef.current` to `createMagicWandSelectionFromCanvas`, i.e. the merged document canvas, so
the app behaves as though the box were always ticked while the bar shows no box.

**`Smooth` is not `Anti-alias`.** The bar's second slider has no Photoshop counterpart: it is
passed through as `smoothing` and consumed by `simplifyClosedPath`, which removes boundary
vertices. Anti-aliasing blends coverage at the staircase; simplification deletes the staircase.
The tool also reports a live selected-pixel count in its hint box, which Photoshop's bar does
not, and which is worth knowing is the mask's count rather than the committed polygon's — the
commit refuses a region with an enclosed hole, so the two can disagree.

**`Refine Edge`.** Documented on Adobe's own product page, reached from the options bar's
`Select and Mask` and carrying `Radius`, `Smart Radius`, `Smooth`, `Feather`, `Contrast`,
`Shift Edge`, `Decontaminate Colors` and `Output To`. None of it exists in the app, and neither
does the `Select and Mask` workspace it opens.

## Quick Selection Tool — `quick-selection`

The thinnest-covered tool in the corpus, researched from scratch, then researched again after the
mined corpus row for it was recovered. That row is confirmed on both of its load-bearing points
and is contradicted on nothing.

### Three modes, not four

This is real, and it is the one place in the family where a selection tool's bar has **fewer**
combination modes than its siblings. Adobe's 2025-11-04 desktop page lists the control as "New
selection, Add to selection, or Subtract from selection" — three, with no fourth item anywhere in
the list. The second source agrees and is explicit about the count: `photoshopessentials.com`
describes "a series of three icons which let us switch between the tool's three selection modes
(from left to right - New selection, Add to selection and Subtract from selection)". Every other
tool in this family is documented by Adobe with four: "New Selection, Add to Selection, Subtract
from Selection, or Intersect with Selection" appears verbatim on the marquee, lasso, magnetic
lasso, polygonal lasso, wand and quick-selection how-to pages — the quick-selection page
included, which is why the divergence is worth stating rather than inferring.

The likely source of the "four modes" misconception is a general options-bar diagram in a
textbook that lists `New/Add/Subtract/Intersect` for selection tools collectively, immediately
before a separate section headed "The Quick Selection Tool Options" that lists only brush options
and `Enhance Edge` (`cod.pressbooks.pub/photoshopmastery1250`). The four-mode list is not
attributed to this tool on that page.

### `W`, and the `Shift+L` badge

`W` is correct for the Quick Selection — Adobe's own how-to page opens with "Select the Quick
Selection tool (W)" — and it is the same key as the Magic Wand because the two share one Tools-panel
flyout and are cycled by repeated presses; Adobe's wand page likewise opens "Select the Magic Wand
tool (W)". The app binds `W` to the Magic Wand tile (`toolbar-mapping.ts:52`) and gives the Quick
Selection tile no badge of its own (`:53`), which puts the badge on the flyout's primary rather
than on the second item. That is a presentation difference, not a wrong key.

The app's `Shift+L` badge on the Magnetic Lasso is a different matter and is **not** carried over
as a Photoshop fact anywhere in the data file. In Photoshop all three lasso tools share `L`, and
repeated presses cycle between them. `Shift+L` is the app's own binding for one item in its
flyout; the data file's `shortcuts` field records app bindings, and the magnetic lasso's
`appNotes` now says explicitly that this is the app's binding and not Photoshop's.

### Edge detection, and why a small brush

The mechanism, in Adobe's words:

- "Click and drag the brush across the area you want to select. **As you drag, the tool
  automatically detects image edges to create a selection for you.**" —
  `tool-techniques/quick-selection-tool.html` (Adobe, 2023-05-24)
- "This tool tries to find image edges and **automatically stops the selection there.**" —
  Adobe Learn, _Make selections_
- "The Quick selection tool will automatically detect the image edges as you drag, to create a
  selection." — `automate-selections-with-quick-selection-tool.html` (Adobe, 2025-10-29; this one
  is Photoshop _on the web_)
- "**Use the Quick Selection tool to select automatically based on similar tones and image
  edges.**" — `make-precise-selections-in-select-mask.html` (Adobe, 2022-12-28)

That last sentence is the reason the data file's `purpose` does not describe the tool as a pure
boundary tracer. Adobe's dominant framing is edge following, but Adobe also states a color prior
alongside it, so "edge following with a color prior" is the accurate description and "purely
edge following" would overstate it.

**Why a small brush at a soft edge** is the second-order fact, and it follows from the first: the
selection grows outward from under the cursor, so the brush diameter is how much of the image the
tool is allowed to reason about at any one moment. `photoshopessentials.com` states the
consequence directly — "Typically, a smaller cursor will give you more accurate results" — and
`businessinsider.com` gives the operational form of it: "You want to make the brush smaller than
the region or object you're trying to select, because if it's too large, it'll select parts you
don't want too." Adobe's own `Size` description ("Make the brush sensitive to pen pressure or
stylus wheel") and its Learn tutorial's "Experiment with adjusting the size and hardness of the
Quick Selection tool in the options bar" complete the chain. The cursor is resized with `[` and
`]`, "the same way we'd resize a brush" (`photoshopessentials.com`) — a second, independent
confirmation that the brush model is real rather than nominal.

### The sentence that distinguishes it from the Magic Wand

`photoshopessentials.com` puts it more plainly than Adobe does:

> the Quick Selection Tool is somewhat similar to the Magic Wand in that it also selects pixels
> based on tone and color. But the Quick Selection Tool goes far beyond the Magic Wand's limited
> abilities by also looking for similar textures in the image, which makes it great at detecting
> the edges of objects. And unlike the Magic Wand where we click on an area and hope for the
> best, the Quick Selection Tool works more like a brush, allowing us to select areas simply by
> "painting" over them!

Compressed: both take a contiguous region; the Wand takes it by **colour similarity from a
single click**, the Quick Selection by **following an image edge with a brush**. That sentence is
now in the Quick Selection's `purpose` and reciprocally in the Magic Wand's.

Worth noting against it: Adobe's own selection-tools overview page describes both tools
identically — "Quick Selection tool | Select specific areas of an image" and "Magic Wand tool |
Select specific areas of an image" (`selection-tools-overview.html`, 2025-11-04) — so the
distinction lives in the how-to pages, not the overview.

### `Sample All Layers`

"**Sample All Layers: Create a selection based on all the layers instead of just the currently
selected layer.**" — Adobe, 2025-11-04. The second source is `photoshopessentials.com`: "If your
document contains multiple layers and you want Photoshop to analyze all the layers when making
the selection, check the Sample All Layers option. Leaving it unchecked tells Photoshop to include
only the layer that's currently active." Its default is still not stated by either — see
`## Unverified` item 7.

### `Enhance Edge` / `Auto-Enhance`, and where the older label appears

Two names for one checkbox, and this is the one place where the addendum's framing needed
correcting rather than confirming.

- **2025, `Enhance Edge`:** "Automatically improve the edges by making them smoother and more
  refined." — Adobe, 2025-11-04.
- **2022, `Auto-Enhance`:** "**Add a checkmark to the Auto-Enhance option in the Options bar.**" —
  `use-quick-selection-tool.html` (Adobe, 2022-12-28). **This is where the `Auto Enhance` label
  appears**: an Adobe user-guide page, a beginner tutorial, and the only Adobe page found that
  uses the older name.
- **What it does**, from the one source detailed enough to say: "Checking this option will reduce
  roughness and blockiness in the selection area. **Enhance Edge automatically flows the
  selection further toward image edges and applies some of the edge refinement you can apply
  manually in the Select and Mask workspace.**" — `cod.pressbooks.pub/photoshopmastery1250`. This
  is a third-party textbook, and it is the load-bearing source for the mechanism.
- **The cost**, from two independent third parties: "selecting the Auto-Enhance option can
  produce smoother, higher quality selection edges (they tend to look a bit blocky on their own),
  but you may find the Quick Selection Tool takes slightly longer to do its thing with
  Auto-Enhance enabled" — `photoshopessentials.com`; `photoshopbuzz.com` says the same.

**A correction to my own earlier pass.** The first version of this file stated that `Auto-Enhance`
is "off by default". That was an inference from a checkbox being drawn unticked, not a sourced
default, and it is now removed from the data file. What the sources support is narrower and is what
the data file says: Adobe's 2022 tutorial instructs the user to _add_ a checkmark to it, which is
evidence it does not start enabled. The default state itself is in `## Unverified` item 7, and
**no source found in this pass — Adobe or otherwise — says `Auto-Enhance` is on by default.**

### `Select and Mask` and `Mask`

**`Select and Mask`** is sourced by Adobe twice and is on every selection tool's bar, so it is
recorded on all seven:

- "Open the Select and Mask workspace by choosing Select > Select and Mask, or by clicking
  Select and Mask in the Options bar **for any of the selection tools**." — Adobe, 2022-12-28.
- "In the options bar, click Select and Mask to open the Select and Mask workspace." — Adobe
  Learn, _Make selections_.

The workspace it opens is the refinement surface the quick selection feeds: "Use the Quick
Selection tool to select automatically based on similar tones and image edges. Use the **Refine
Edge Brush** tool for more precise selection of soft edges, like hair or fur. Use the **Brush**
tool to paint selections where you want them." Same page, for the Properties panel: `Smooth` for
smoother edges, `Contrast` for crisper ones, `Decontaminate Colors` plus `Amount` for a fringe of
unwanted color at a soft edge, and an `Output To` menu. Adobe's current page for the workspace
(`refine-your-selection-and-mask.html`, last updated February 2026) supplies the View Modes —
`On Black`, `On White`, `Black and White`, `On Layers`, `Show Edge` — which is the current
replacement for the old Refine Edge dialog.

**`Mask`** — the button that converts the selection to a layer mask — is the weakest claim in this
addendum. It is in the mined bar row, and a layer mask is certainly an output of this workflow
(Adobe documents `Output To > Layer Mask`, and the Layers-panel `Add layer mask` button in
`fine-tune-layer-masks.html`: "The resulting layer mask is black where there was no selection,
hiding the background around the subject"). But **no Adobe page opened in this pass documents a
`Mask` button on a selection tool's options bar**, and the Outputs enumerated by the third-party
Select-and-Mask guides are the workspace's `Output To` menu, not an options-bar button. The row is
in the data file on the strength of the mined bar row alone and is listed in `## Unverified` item 10.

### Quick Mask

Quick Mask is a mode rather than a control, so it is not an `options` row. Adobe documents it as
the other way to turn a selection into something you can edit, and it is the one route from a
selection to a mask that does not go through Select and Mask:

- "Use Quick Mask mode to convert a selection to a temporary mask for easier editing. The Quick
  Mask appears as a colored overlay with adjustable opacity. You can edit the Quick Mask using any
  painting tool or modify it with a filter. Once you exit Quick Mask mode, the mask is converted
  back to a selection on the image." — `saving-selections-alpha-channel-masks.html` (Adobe)
- "By default, Quick Mask mode colors the protected area using a red, 50% opaque overlay"; "Paint
  with white to select more of an image"; "To deselect areas, paint over them with black"; "**If a
  feathered mask is converted to a selection, the boundary line runs halfway between the black
  pixels and the white pixels of the mask gradient.**" — `create-temporary-quick-mask.html`
  (Adobe, 2023-05-24)

Two consequences for this app are recorded in the Quick Selection's `appNotes`: a feathered
selection's visible border is a 50% threshold, so a user comparing the app's ants against
Photoshop's is comparing two different things, and the app has no Quick Mask mode at all, so its
only mask is the bitmap the `Copy` button renders. Adobe's own alpha-channel page makes the
durable counterpart explicit — a mask saved as an alpha channel is the persistent form, and it is
editable grayscale in the Channels panel — which the app also does not have.

The `Q` key for Quick Mask is third-party only (`photoshoptrainingchannel.com`,
`akvis.com`) and is not in the data file, whose `shortcuts` field records app bindings and where
the app binds nothing.

### Options table

| Control                      | Photoshop                                                                           | App status | App ref                  |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------- | ------------------------ |
| Tool presets                 | leftmost item; saves and recalls the tool's whole bar state                         | `missing`  | —                        |
| New / Add to / Subtract from | **three** modes, no Intersect; auto-switches to Add after the first stroke          | `partial`  | `QuickSelection.tsx:138` |
| Size                         | brush diameter, from the preset picker, with Hardness / Spacing / Angle / Roundness | `partial`  | `QuickSelection.tsx:104` |
| Select and Mask              | opens the Select and Mask workspace to refine the result                            | `missing`  | —                        |
| Mask                         | converts the selection to a layer mask on the active layer                          | `missing`  | —                        |
| Sample All Layers            | makes the selection from all visible layers, not just the current one               | `missing`  | —                        |
| Auto-Enhance (Enhance Edge)  | smoother, more refined edges; flows toward image edges; slower                      | `missing`  | —                        |

**App fidelity: partial**, and the gap is the algorithm, not the bar.

**The `Tolerance` slider is not a Photoshop control.** This remains the single most important
correction in this pass. Photoshop's Quick Selection has **no** `Tolerance`; Tim Grey's
controlling-the-tool article states it directly — "the Quick Selection tool does not include a
setting such as the Tolerance control for the Magic Wand tool" — and no Adobe page for the tool
lists one, across the 2022, 2023 and 2025 versions. The app's slider is passed straight to
`floodFill` as a per-channel distance, which makes it the Magic Wand's `Tolerance` wearing the
Quick Selection's name, and it is the mechanism by which this tool's selections differ from
Photoshop's at all.

**The consequence, which is the real finding.** `growAlongStroke` re-seeds a region grow at
every dab along the stroke, using `floodFill(imageData, seed, { tolerance, contiguous: true })`.
Photoshop's tool "tries to find image edges and automatically stops the selection there" and
"automatically detects image edges as you drag". A flood fill stops at a _color_ boundary, not
at an _edge_, so the app's region grow will run through a soft, continuous gradient that
Photoshop would stop at, and will stop short of a hard edge between two colors that differ more
than the tolerance. It is a region-growing brush, not an edge detector, and the `Tolerance`
slider is what a user reaches for when it goes wrong — the one control that would fix it is the
one Photoshop does not have. Because the control is not a Photoshop control it does not appear
in the `options` array; it is recorded here and in `appNotes`.

**Also divergent.** The `Mode` dropdown offers only `Add` and `Subtract`, so there is no way to
start a fresh selection and no `Intersect`. `Sample All Layers` is absent and the stroke reads
the merged composite canvas. `Select and Mask`, `Mask`, `Auto-Enhance` and the tool-preset picker
are absent. The brush is flat — no hardness, spacing, angle or roundness — and `[`/`]`, the
Alt-drag size gesture and the live size/opacity readout are not bound. The committed region is one
traced contour, so a grown region containing an enclosed hole is refused outright rather than
committed, and a `Selection` cannot express the hole.

### Sources

- `https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html` (2025-11-04) — three modes, `Size`, `Sample All Layers`, `Enhance Edge`
- `https://helpx.adobe.com/photoshop/using/tool-techniques/quick-selection-tool.html` (2023-05-24) — `(W)`, edge detection on drag
- `https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html` (2022-12-28) — the `Auto-Enhance` label, auto-switch to Add, Option/Alt subtract
- `https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html` (2022-12-28) — `Select and Mask` on every selection tool's bar, "similar tones and image edges", Refine Edge Brush, Properties panel
- `https://helpx.adobe.com/photoshop/using/create-temporary-quick-mask.html` (2023-05-24) — Quick Mask mode
- `https://helpx.adobe.com/photoshop/using/saving-selections-alpha-channel-masks.html` — Quick Mask to mask to selection, alpha channels
- `https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html` (updated 2026-02-23) — View Modes
- `https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html` (2025-11-04) — the overview that describes both tools identically
- `https://helpx.adobe.com/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html` (2025-10-29) — Photoshop **on the web**; brush `Spacing`/`Angle`/`Roundness`
- `https://www.adobe.com/learn/photoshop/web/selection-tools-basics` — "automatically stops the selection there", size and hardness, auto-switch to Add, `Select and Mask`
- `https://asktimgrey.com/2021/04/07/controlling-the-quick-selection-tool` — third party: no `Tolerance` on this tool
- `https://www.photoshopessentials.com/basics/selections/quick-selection-tool` — third party: three mode icons, `W`, smaller cursor accuracy, `Auto-Enhance` cost, the Wand/brush distinction
- `https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections` — third-party textbook: what `Enhance Edge` does; the general four-mode diagram that is _not_ this tool's

## Unverified

Claims this pass could not establish from a source that was actually opened. Each is either
absent from the data file or hedged inside it, and each names the URL that came closest.

1. **The maximum value of the marquee tools' options-bar `Feather` field.** Adobe documents the
   control and its effect but never states the field's bound. The UXP API takes
   `feather` as a decimal on 0–1000 for `selectRectangle` / `selectEllipse` / `selectPolygon`,
   and `Select > Modify > Feather` is documented at 0.1–1000 in the same reference — but a
   scripting argument's range is not the same claim as a UI field's range, and the widely
   repeated "0–250" figure appears only in Adobe's **Elements** documentation, which is a
   different product. Closest:
   `https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/` and
   `https://helpx.adobe.com/uk/photoshop-elements/mac-app-store/smoothing-selection-edges-anti-aliasing1.html`.
   The data file therefore states the default and the API range and no UI maximum.

2. **The Magnetic Lasso's two-slider `Smoothing` group (`Feather` + `Width` smoothers).** The
   brief asked for this specifically. No current Adobe page documents it: the 2023-12 and
   2024-12 `selecting-lasso-tools` pages and the 2023 `tool-techniques/magnetic-lasso-tool` page
   list `Feather` and `Anti-alias` as the feathering pair and `Width`, `Contrast`, `Frequency`
   and `Stylus Pressure` as the edge-detection group, and nothing else. It may be a legacy
   Photoshop CS-era bar, or a mis-remembering of `Select > Modify > Smooth`. The data file
   lists only the documented controls, and the app's `Smooth` slider is described as an
   app-only control with the nearest Photoshop analogue left unclaimed. Closest:
   `https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html`.

3. **`Select > Similar`, and `Select > Grow` in its current form.** Both are the wand's
   follow-ups and neither was established from an opened Adobe page. The closest is the
   Photoshop **CS3** manual's table of contents, which carries the entry "Expand a selection to
   include areas of similar color" (the pre-CS4 name of `Similar`) and, in the same list,
   "Refine selection edges":
   `http://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html`. `Grow` is documented
   in the UXP reference with its tolerance range and its Bitmap/32-bit exclusions, but no
   current user-guide page was opened for either command, so the data file's `appNotes` mention
   their absence without describing what they do in detail.

4. **The `Polygonal Lasso`'s click-and-drag smooth anchor.** Asserted by the research corpus
   (a drag setting both tangent handles) and not re-established here; Adobe's current page
   describes `Alt`/`Option`-drag as a freehand _segment_ and `Alt`+double-click as a _straight_
   close. Closest: `https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html` and
   `https://helpx.adobe.com/photoshop/using/tool-techniques/polygonal-lasso-tool.html`. Left
   out of the data file.

5. **The Magnetic Lasso's fallback on a flat or uniform region**, where there is no gradient to
   snap to. The only statement found is a community wiki ("If no such region can be found, the
   next fastening point will be at the cursor",
   `https://photoshop.fandom.com/wiki/Magnetic_Lasso_tool`), which is below the brief's trust
   threshold on its own and has no Adobe counterpart. Unresolved, as it was in the corpus.

6. **The `Frequency` default of 57 and the `.`/`,` contrast keys.** Both come from
   third-party sources only —
   `https://www.photoshopessentials.com/basics/selections/magnetic-lasso-tool` for the 57, and
   `https://www.lifewire.com/magnetic-lasso-tool-in-adobe-photoshop-4077747` plus a CS3-era
   `http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf` for the keys. Adobe documents the
   keys' existence nowhere in a page this pass opened. The direction of `Frequency` is Adobe's
   own and is the load-bearing half of the inversion finding; the default value is not, and the
   data file states neither.

7. **The default state of `Sample All Layers` on the Magic Wand and the Quick Selection, and of
   `Auto-Enhance` / `Enhance Edge` on the Quick Selection.** None of the three is given a default
   by any Adobe page this pass opened. What the sources support is narrower and is what the data
   file now says: Adobe's 2022 tutorial instructs the user to _add_ a checkmark to
   `Auto-Enhance`, which is evidence it does not start enabled but is not a statement of its
   default; "unchecked by default" for the wand's `Sample All Layers` is
   `photoshopessentials.com`'s claim alone (CS5-era). **No source found in this pass — Adobe or
   otherwise — says `Auto-Enhance` is on by default**, which is the premise the addendum asked
   about and which this pass could not confirm. My first version of this file asserted "off by
   default" for all of these from an inference about a drawn-unticked checkbox; that inference is
   withdrawn. Closest: `https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html`
   and `https://www.photoshopessentials.com/basics/selections/quick-selection-tool`.

8. **Quick Selection brush `Size` / `Hardness` and the `Spacing` / `Angle` / `Roundness` flyout
   in _desktop_ Photoshop.** The page that enumerates `Spacing`, `Angle` and `Roundness` is
   Adobe's **Photoshop on the web** page, not the desktop one
   (`https://helpx.adobe.com/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html`).
   Adobe Learn's desktop tutorial does say to "adjust the size and hardness of the Quick
   Selection tool in the options bar", which is why `Size` is scored `partial` rather than
   `missing`, but the hardness control itself is not documented in a desktop page this pass
   opened.

9. **Photoshop's default `Frequency` semantics of the _magnetic_ lasso versus its `Feather`
   being a _smoother_ rather than a selection feather.** Adobe's current page describes
   `Feather` purely as the feathering width, and every third-party account read agrees. The
   older characterisation of the magnetic `Feather` as a path-smoothing radius could not be
   confirmed from any opened source, and the data file treats it as a selection feather
   accordingly.

10. **The `Mask` button on a selection tool's options bar.** The `Mask` row in the quick
    selection's table rests on the recovered corpus bar row and on the general fact that a layer
    mask is an output of this workflow, not on an opened Adobe page. No Adobe page found in this
    pass documents a `Mask` button on a selection tool's options bar; what Adobe documents is the
    **Layers panel's** `Add layer mask` button ("The resulting layer mask is black where there was
    no selection, hiding the background around the subject" —
    `https://helpx.adobe.com/ph_fil/photoshop/how-to/fine-tune-layer-masks.html`) and the Select
    and Mask workspace's `Output To` menu, which the third-party guides enumerate as `Selection`,
    `Layer Mask`, `New Layer`, `New Layer with Layer Mask`, `New Document`, `New Document with
Layer Mask`
    (`https://www.howtogeek.com/289255/how-to-make-more-precise-selections-with-photoshops-select-and-mask`).
    The `Select and Mask` row beside it is solidly Adobe-sourced; this one is not. For the same
    reason the `Mask` row appears only on the quick selection and not on the other six tools,
    even though the bar is almost certainly identical.

11. **A `Tool presets` picker as a per-tool options-bar control.** The recovered corpus row
    opens with `[Tool presets]`, and a preset picker is present on every Photoshop tool bar, but
    no Adobe page this pass opened documents it as a control on a selection tool's bar. The only
    description found is a third-party textbook: "Presets: Use this option to save Presets
    specific to the tool being used."
    (`https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections`). The row is in the data
    file on that source alone.
