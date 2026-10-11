# Tools inventory: the Adobe tools the rail does not have

**This file's one job is to catalogue the Photoshop Tools-panel tools this app does not
have**, keyed by Adobe's identity for each tool — Adobe's name, its group, its shortcut
letter, its headline options, and a source — so that the gap is documented once and nobody
re-audits Adobe's Tools panel to rediscover it. It is not a roadmap, a plan, a priority
list, or a claim that any of these tools is built. Nothing here implies any of them exists
in the app; every one of them is absent from `src/contexts/tool-types.ts` and therefore
absent from the rail.

There is no per-tool home for these tools inside the app's own description system. The eight
family modules under `src/tools/descriptions/` merge into a `Record<ToolName,
ToolDescription>` — the `toolDescriptions` record in `src/tools/descriptions/index.ts` — where
`ToolName = keyof ToolArgsByName` (the `ToolName` type in
`src/contexts/tool-types.ts`). A tool the registry has no entry for cannot
be given a description in that system at all: adding the key is a TypeScript error at the
merge, not a tooltip that renders `undefined`. `docs/TOOLS.md` is generated from those
modules, so it cannot carry them either. This file is the substitute, and it is prose, so it
carries the discipline the data files carry in a `sources` array — **a description without a
source is a rumour** ([`TOOLS-RESEARCH-BRIEF.md`](TOOLS-RESEARCH-BRIEF.md),
[`DOCUMENTATION.md`](DOCUMENTATION.md) §Citations).

## Two boundaries, stated up front

**Membership is Adobe-confirmed; group order and separator placement are a hypothesis.**
Adobe publishes **no page that enumerates the Tools panel top to bottom**. It publishes five
topical overview tables — selection, retouch, painting, drawing, navigation-and-measuring —
plus a Customize-toolbar page. Every Adobe tool name below is confirmed from one of those
tables or from an Adobe page about that tool. The **order and the separators are not**:
they are a reconstruction from two independent third-party 2026 toolbar diagrams,
cross-checked against Adobe for membership only. Treat the grouping as a good hypothesis and
prefer a grouping a user recognises over one a source asserts
([`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance; `HANDOFF.md` §74). Four
placements remain unresolved and a screenshot of a restored PS 27.x default workspace settles
all four: the **Frame** tool's separator, **Content-Aware Tracing**'s slot inside the Pen
flyout, **Line before Star or Star before Line** in the Shape flyout, and whether **Note** and
**Count** sit in the default panel or in Extra Tools.

**This is a compilation, not fresh verification.** Everything here is drawn from research the
repository already did — `.kilo/plans/ps-research/` (gitignored; read it from the main checkout, as
`TOOLS-RESEARCH-BRIEF.md` records), the
`.notes.md` files beside `src/tools/descriptions/`, `docs/PHOTOSHOP-UX.md`, and
`docs/TOOLS.md` — plus six web searches against Adobe's help pages for the tools the repo had
nothing on. **No tool's option bar was opened and audited**, and the shortcuts are the
weakest part of this file: where a letter is Adobe-published it says so, where it is
inferred from the flyout family it says that instead, and where nothing is known it says
**not researched**. The effort spent on unimplemented tools is deliberately small; an honest
gap is worth more here than an invented sentence.

## The roster: two sources, and a discrepancy that is not resolved here

This list took the roster over from `docs/TOOLS-TOO-HARD.md` §"The Adobe tools the rail omits",
which carried **30** absent tools in six Adobe groups and no longer names them.
`HANDOFF.md` §74 records the same exercise as **"36 present, 34 to add, 5 to
delete"** out of a 41-`ToolName` → 70 target, and names absent tools the first list omits.
**Six of them, not five:** Selection Brush, Adjustment Brush, Remove, Content-Aware Tracing,
Artboard — and **Content-Aware Move** (`HANDOFF.md` §74).

**30 + 6 = 36 against a stated 34** — the combined list is two over, not one.
**This file does not resolve it.** An operator should, and this is deliberately left visible
rather than silently merged — a quietly reconciled roster is a roster nobody can audit.

Content-Aware Move was added to the Selection group below on the evidence of §74 alone, and is
flagged there as **the one row whose Adobe source has not been opened**. `grep -rni
"content-aware" src toolbar-mapping.ts` finds it nowhere in the app, so it is absent in fact as
well as undocumented; a sweep of Adobe's own _overview tables_ misses it, because like Remove and
Content-Aware Tracing it has its own page instead of appearing in the topical tables.

What makes it unresolvable from the documents alone:

- The **34 is arithmetic, not an observation.** `HANDOFF.md` §74 states the shape as
  "41 `ToolName`s → 70, in 21 tiles. 36 present, 34 to add, 5 to delete", and
  `41 − 5 = 36` and `70 − 36 = 34` are the only two derivations available.
  **That 41 is §74's own historical figure, not today's count** — the registry carries 44 now,
  since the Sponge and the two 1-pixel marquees were added to it. The quotation is left as §74 states it rather than
  silently re-derived, because §74 is a record of an exercise and not a live total. So 34 is forced by
  the **70-tool target**, not counted off a roster. A combined list of 36 means either the
  target is 72 or two entries do not belong.
- Three combined-list entries are **documented as unsettled**, so any of them could be the
  spurious one. **Note** and **Count** may sit in Extra Tools rather than the default panel
  (`HANDOFF.md` §74, fourth unresolved placement). **Content-Aware Tracing** is gated behind
  `Preferences > Technology Previews` — Adobe's own page says so, so it is a real tool with a
  release caveat rather than a phantom. **Adjustment Brush** is a large _feature_ as much as a
  tool (an adjustment layer plus a painted mask), so "34 tools" and "34 entries" are not the
  same quantity.
- No source in the repository enumerates the roster as a list, so there is nothing to
  recount.

## What is deliberately NOT on this list

These four appeared in the shortcut PDF or a third-party toolbar diagram and are **not**
candidates. Recording them here is the point: they are the ones that get "fixed" later by
someone who trusts the source material.

- **3D Material Eyedropper** and **3D Material Drop** — the removed 3D feature. They appear
  in third-party toolbar diagrams because those diagrams were written when 3D existed.
- **Rounded Rectangle** — absent. It is in neither 2026 enumeration, and Adobe's Rectangle
  tool carries a **Radius** field that subsumes it; `docs/TOOLS.md` §Rectangle Tool records the
  removal and names the release, and is the authority for that date.
- **Clone Source** is **a panel**, `Window ▸ Clone Source`, not a Tools-panel entry. A name
  appearing in a panel's title is how a tool gets miscounted, and it is the specific trap
  `HANDOFF.md` §74 names.
- **Generate Image** is a real feature with **unconfirmed panel placement**. Two 2026
  candidates are not Adobe-confirmed: Clone Source and Generate Image
  ([`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance).

---

## Drawing

| Adobe tool | Group                                                                  | Shortcut                                             | Headline options                             | Source                                                                                                                              |
| ---------- | ---------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Star**   | Drawing — shapes flyout; exact position relative to Line is unresolved | none of its own; reached by cycling the shapes group | Points, corner radius, inner and outer radii | Adobe's drawing-tools overview and Star-tool page; see the sourced Shape-family research in `src/tools/descriptions/shape.notes.md` |

**Star is now implemented.** Adobe's separate Star-tool page names its points and inner/outer radii,
and the sourced Shape-family research records its options and the app-side implementation
(`src/tools/descriptions/shape.notes.md`, Star-tool research). Star renders via the `shape` tool with
`figure: 'star'`, and `FigureType` in `src/tools/shape.ts` includes `'star'`.

**Star is not Custom Shape.** Adobe documents Star as its own shapes-group tool
(Star tool); Custom Shape draws
reusable vector graphics from a built-in or imported library
(Custom Shape tool).
The `.csh` parser and preset manager documented as blockers in
[`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md) apply to Custom Shape, not to a parameterized Star tool.
A canned star preset would not implement Custom Shape, but that is not a reason to treat Star
itself as blocked by the preset format.

## Selection

| Adobe tool             | Group                                                | Shortcut                                                                    | Headline options                                                                                                          | Source                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Object Selection**   | Selection                                            | `W` — **Adobe-confirmed** (Adobe: _"Select the Object Selection tool (W)"_) | Object Finder toggle; selection modes (New / Add To / Subtract From / Intersect With); Sample All Layers; Hard Edge       | Adobe's selection-tools overview carries the tool and its one-line description; Adobe's Object Selection page prints `(W)` and names Object Finder, the four selection modes, Sample All Layers and Hard Edge.                                                                                                                                                  |
| **Selection Brush**    | Selection — **Lasso group**, not a marquee neighbour | none of its own                                                             | Hardness, Opacity, Color (gear icon), Add/Subtract brush, selection modes (New / Add To / Subtract From / Intersect With) | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance: desktop Photoshop, Adobe-confirmed, _"Lasso group"_. `HANDOFF.md` §74 corrects the earlier claim that it is web-only. Adobe's _"Selecting with the Lasso tools"_ page names Hardness, Opacity, the selection modes and the Color overlay.                                                      |
| **Content-Aware Move** | Selection                                            | not researched                                                              | not researched                                                                                                            | **§74 evidence only — no Adobe page was opened for this row**, which is why it is called out rather than quietly folded in. `HANDOFF.md` §74 names it, in the list headed "Largest, and they need a primitive the app does not have", beside Remove and its generative backend. `grep -rni "content-aware" src toolbar-mapping.ts` finds it nowhere in the app. |

**The rest follow from what this app already lacks.** Object Selection needs an
edge-following segmentation comparable to what the Quick Selection entry records as too hard.

**Single Row and Single Column Marquee were listed here until 2026-10-01 and are now
implemented**, so they have been deleted from that table rather than left in it: this file's
one job is the tools the rail does NOT have, and it became false for both of them. They live
in `src/tools/singleRowColumnMarquee.ts`, share the rectangular-selection commit path, and
are covered by `e2e/single-row-column-marquee.spec.ts`.

## Retouch

| Adobe tool             | Group                                                                                    | Shortcut                                                                                                                                                                  | Headline options                                                                                                                                                                                          | Source                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spot Healing Brush** | Retouch — healing flyout, first entry                                                    | `J` — **Adobe-confirmed** (Adobe: _"Select the Spot Healing Brush (J)"_)                                                                                                  | Brush Preset (Size, Hardness, Spacing), Mode, Type (Content-Aware / Proximity Match / Create Texture), Sample All Layers                                                                                  | Adobe: _"Select the Spot Healing Brush (J)"_, and the Options bar names Brush Preset, Mode, Type and Sample All Layers — **no Pressure control exists** on this tool.                                                                                                                                                                           |
| **Healing Brush**      | Retouch — healing flyout, second entry                                                   | `J`, printed on Adobe's own page                                                                                                                                          | Mode (Normal, Replace, Multiply, Screen, Darken), Source, Aligned, Sample, Diffusion                                                                                                                      | Adobe's Healing Brush page lists _"Mode, Source, Aligned, Sample, and Diffusion"_                                                                                                                                                                                                                                                               |
| **Patch**              | Retouch — healing flyout, third entry                                                    | `J`, printed on Adobe's own page                                                                                                                                          | Patch option Normal, then Source or Destination                                                                                                                                                           | Adobe's Patch page lists _"Normal"_ and _"Source or Destination"_                                                                                                                                                                                                                                                                               |
| **Remove**             | Retouch — healing flyout                                                                 | not researched — no Adobe shortcut page opened                                                                                                                            | Size, Mode dropdown (Generative AI on / off / Auto), Sample All Layers, Remove after each stroke, Output to                                                                                               | Adobe's Remove tool page names all five controls; the shortcut is not confirmed on any Adobe page. `HANDOFF.md` §74 established Adobe-documented membership.                                                                                                                                                                                    |
| **Red Eye**            | Retouch — healing flyout, fifth entry                                                    | `J` — **Adobe-confirmed** via the Spot Healing Brush page (Adobe: _"Select the Spot Healing Brush (J)"_); Red Eye is the fifth member of the `J` flyout; `Shift+J` cycles | Pupil Size and Darken Amount (sliders; range 1–100, default 50 — third-party; Adobe names both but gives no range or default)                                                                             | Adobe's _"Remove red eye in flash photos"_ page names both sliders; the `J` shortcut is confirmed on Adobe's Spot Healing Brush page (Adobe prints `(J)`). Adobe does not publish the detection algorithm or the slider ranges/defaults.                                                                                                        |
| **Background Eraser**  | Retouch — **Eraser group**, beside the Eraser and Magic Eraser                           | `E` — **Adobe-confirmed** (Adobe NZ/AU: _"Select the Background Eraser tool (E)"_); shared with Eraser and Magic Eraser; `Shift+E` cycles the family                      | Brush Preset (Size, Hardness, Spacing, Angle, Roundness), Sampling (Continuous / Once / Background Swatch), Limits (Discontiguous / Contiguous / Find Edges), Tolerance (0–100), Protect Foreground Color | Adobe's _"Change pixels to transparent with the Background Eraser tool"_ page names every control; Adobe's NZ/AU pages confirm `(E)`.                                                                                                                                                                                                           |
| **Adjustment Brush**   | Painting — **Brush flyout sibling**; placement (standalone vs. flyout) is **unresolved** | none of its own                                                                                                                                                           | not researched — third-party only; options bar contents from glensmith + creativepro, not Adobe-confirmed                                                                                                 | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance: desktop Photoshop, Adobe-confirmed membership via the dedicated Adjustment Brush page. Toolbar placement is contradictory: `glensmith.co.uk` (2026-08-14) says standalone, `photoshopessentials.com` (2024-02-16) says Brush flyout. Options bar not researched against Adobe. |

**The Ruler was on this table and is not any more**, which is recorded here rather than left as a
quiet deletion for the same reason the Sponge is below. It was the only row in
"Navigation and measuring" that Adobe's own overview table confirms, and it is the first member of
the measurement band `HANDOFF.md` §74 named as cheapest architecturally: `src/tools/ruler.ts` is the
arithmetic, `src/components/Main/RulerToolArea.tsx` is the gesture and the nonprinting overlay,
`src/components/ToolbarsRight/Ruler/Ruler.tsx` is the readout bar, and the tool commits no pixels
and records no history state — it is the second member of `PIXEL_FREE_TOOLS` beside the
Eyedropper. Two claims the deleted row carried were wrong: its shortcut read as `I` on its own,
which is true only as the tile's letter and not as a binding the Ruler owns, and its options were
recorded as unread when Adobe's page names every readout.

**The Sponge was on this table and is not any more, which is recorded here rather than left as a
quiet deletion.** It was the third member of this table's `O` toning flyout row, and the app now
ships it: `src/tools/sponge.ts` is the tool, `src/components/ToolbarsRight/Sponge/Sponge.tsx` is
its bar, and `docs/TOOLS.md` carries the generated per-tool census at **§Sponge Tool** with the
sources behind it. Deleting the row keeps this file's contract — every row here is absent from
`src/contexts/tool-types.ts` — and the seven Adobe-group tables below hold **32 rows** in total
(Drawing 1, Selection 3, Retouch 7, Painting 5, Type 3, Navigation and measuring 10, Path 3), which is
neither 29 nor the 30 this file attributes to `TOOLS-TOO-HARD.md`: the two lists are counted
separately and are not reconciled here. **Two claims the deleted row carried were themselves
wrong**, and they are the reason this note exists rather than a bare `git log` entry:

- It cited "`docs/TOOLS.md` (Sponge section)" as evidence for the `O` cycle. **There was no Sponge
  section in `docs/TOOLS.md`**, and there could not have been: that file is generated from the
  family modules under `src/tools/descriptions/`, and a tool the registry has no entry for cannot be
  given a description in that system at all — the key's absence is a TypeScript error at the merge
  in `src/tools/descriptions/index.ts`, not a gap in a rendered page. The row was citing a document
  that the tooling makes impossible for an unimplemented tool to appear in.
- It read "the cycle is confirmed in this app's own `docs/TOOLS.md`". The cycle is now confirmed
  against **Adobe's own pages** instead, which is where it belonged: Adobe lists the Dodge, the Burn
  and the Sponge as three rows carrying the same `O`, with `Shift+O` cycling the group.

**Healing and Patch are one flyout, not three tools in a row.** All three share `J`, and
`HANDOFF.md` §74 lists **Red Eye and the Sponge** among its cheapest real additions
because they are geometry and pixel loops rather than new subsystems. **It does not list
the Healing Brush** — `grep -n "Healing Brush" HANDOFF.md` returns nothing, and §74 puts
**Spot Healing** in the opposite list, the one headed "Largest, and they need a primitive
the app does not have". **The Sponge was the one of those two that has actually been
built**; Red Eye is still absent, and so is the Healing Brush.

## Painting

| Adobe tool            | Group                                                                                               | Shortcut                                                                                                           | Headline options                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mixer Brush**       | Painting — Brush flyout, fourth entry                                                               | none of its own; reached by cycling the Brush slot (`B`/`Shift+B`) — **third-party**                               | Wet, Load, Mix, Sample All Layers, Current Brush Load (Load / Clean), Load Brush after Each Stroke, Clean Brush after Each Stroke, Preset menu (Dry / Moist / Wet / Very Wet × Light / Heavy), plus Brush Preset / Mode / Opacity / Flow / Airbrush | Adobe's _"Paint with the Mixer Brush"_ page lists every control; numeric preset values are community reverse-engineered only. The `B`-family cycle is third-party.                                                                                                                                                                                                                                                                                                                                                     |
| **History Brush**     | Painting                                                                                            | `Y` — **Adobe-confirmed** (Adobe: _"Select the History Brush tool (Y)"_); `Shift+Y` toggles with Art History Brush | Brush Preset (Size, Hardness), Mode, Opacity, Flow — **the source is set in the History panel**, not on the options bar                                                                                                                             | Adobe's History Brush page: _"Select the History Brush tool (Y)"_ and _"click the far-left column of the state that you want to use as the source"_. The previous "Source: the selected state or snapshot" headline was a documentation error — the source is set in the History panel, not via an options-bar dropdown.                                                                                                                                                                                               |
| **Art History Brush** | Painting                                                                                            | `Shift+Y` toggles with History Brush; not printed on Adobe's own Art History Brush page — **CS2 sheet**            | Brush Preset picker, Mode, Style, Area, Tolerance, Opacity                                                                                                                                                                                          | Adobe's _"Paint stylized strokes with the Art History Brush"_ page names Brush Preset, Mode, Style, Area and Tolerance explicitly; Opacity is confirmed by third-party CS-era and CS6 guides; Style menu items are **not** enumerated on Adobe's page.                                                                                                                                                                                                                                                                 |
| **Pattern Stamp**     | Painting                                                                                            | `S`, shared with the Clone Stamp; `Shift+S` toggles the pair — **CS2 sheet**                                       | brush preset, Mode, Opacity, **Aligned**, and a pattern picker                                                                                                                                                                                      | Adobe's _"Paint with a pattern"_ page: _"Select Aligned in the options bar to maintain the pattern's continuity with your original start point"_                                                                                                                                                                                                                                                                                                                                                                       |
| **Color Sampler**     | Painting, in Adobe's own painting table — and the `I` family with Eyedropper, Ruler, Note and Count | `I`, cycled; `Shift+I` cycles the five                                                                             | a sample-size footprint and up to four samples                                                                                                                                                                                                      | Adobe's painting-tools overview: _"Displays color values for up to four areas"_. The `I`-family membership is quoted from Adobe in `src/tools/descriptions/eyedropper-draw.notes.md` — _"Eyedropper, Color Sampler, Ruler, Note, and Count Tool I"_ — and `docs/TOOLS.md` records that **three of the four tools Photoshop cycles to with `Shift+I` are still outside this app's registry** — the Ruler joined the Eyedropper on that tile, so only the Color Sampler, the Note tool and the Count tool remain absent. |

**History Brush and Art History Brush need the retained-raster history model** that
[`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md) already records as too hard for Erase to History.
They are two tools standing behind one missing architecture, which is why they are cheap to
name and expensive to build.

## Type

| Adobe tool               | Group                                      | Shortcut                                                                                                           | Headline options                                                                                                          | Source                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vertical Type**        | Type — the second member of the `T` flyout | `T` — Adobe-confirmed (Adobe: _"Select the Horizontal Type tool (T)"_); `Shift+T` toggles the pair — **CS2 sheet** | Font Family, Font Style, Font Size, Anti-aliasing, Text Alignment, Text Color, Text Orientation, Warp Text, Commit/Cancel | Adobe's _"Edit text"_ page confirms the Text Orientation button (_"click the Text Orientation button in the options bar"_); the rest is the standard Type bar covered in `docs/TOOLS.md` §Type. `T` confirmed on Adobe's Horizontal Type page; `Shift+T` is CS2-sheet.               |
| **Horizontal Type Mask** | Type — the type **mask** flyout            | the type letter, cycled — **third-party / flyout-derived**                                                         | Same as Vertical Type, plus a result mode that makes the outcome a selection rather than pixels                           | Adobe's _"Create text selection borders"_ page: _"Type your text and adjust the font, size, and other text attributes in the Options bar … as needed"_, confirming the full Type bar; the mask result is a selection, not a type layer. `docs/TOOLS.md` §Type covers the shared bar. |
| **Vertical Type Mask**   | Type — the type **mask** flyout            | the type letter, cycled — **third-party / flyout-derived**                                                         | Same as Horizontal Type Mask                                                                                              | Adobe's _"Create text selection borders"_ page names both mask tools and confirms the shared Type bar. `docs/TOOLS.md` §Type covers the shared bar.                                                                                                                                  |

**All three are candidates for a different reason than the others.** This app's `text` tool is
raster-at-birth: it is registered `commit: 'source'` (the `text` entry of `toolProcessors`, in
`src/tools/toolProcessors.ts`), so a
text layer is pixels from the moment it is created, and Photoshop type layers are live editable
objects (`.kilo/plans/ps-research/00-tool-inventory.md` §Structural notes). Adding the three missing
type tools without fixing that adds three ways to create pixels that Photoshop would have
kept editable.

## Navigation and measuring

This is **Adobe's least complete overview table**. `docs/PHOTOSHOP-UX.md` records that only
one line of it was retrievable (_"Ruler tool Measures distances, locations, and angles"_) — and
that line was retrievable **because this app built the tool**, so it is no longer a row here.
Hand, Rotate View, Zoom, Frame, Slice, Perspective Crop, Slice Select, Path Selection and Direct
Selection are **not Adobe-table-confirmed**: they come from the shortcut PDF and from individual tool
pages. That boundary is preserved here row by row.

| Adobe tool           | Group                                                                                                                                                                  | Shortcut                                                                                                                                                        | Headline options                                                                                                                | Source                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Note**             | Measurement — the `I` family                                                                                                                                           | `I`, cycled; a legacy `N` from the CS2 sheet                                                                                                                    | Author (text field), Color (color picker), Clear All                                                                            | Adobe's _"Metadata and notes"_ page names Author, Color and Clear All as the options-bar controls. `I`-family membership is Adobe-confirmed (quoted in `src/tools/descriptions/eyedropper-draw.notes.md`). The `N` is the CS2-era _"Notes / Audio Annotation Tool"_ and is **not** a current key. Whether Note is in the default panel at all is unresolved. |
| **Count**            | Measurement — the `I` family                                                                                                                                           | `I`, cycled                                                                                                                                                     | Count Group (create folder / delete / eye / rename), Color picker, Marker Size (1–10), Label Size (8–72), Clear                 | Adobe's _"Count objects in an image"_ page confirms every control: the count-group folder/delete/eye/rename icons, the color picker, Marker Size range 1–10, and Label Size range 8–72. Whether Count is in the default panel at all is unresolved.                                                                                                          |
| **Hand**             | Navigation — panning                                                                                                                                                   | `H`, printed on Adobe's own page                                                                                                                                | Fit On Screen; spacebar is a temporary switch to it                                                                             | Adobe's _"Pan across the canvas with the Hand tool"_ page: _"Select the Hand tool (H) from the toolbar or press and hold the spacebar key"_. Options not researched beyond the Fit On Screen control named on Adobe's viewing-images page.                                                                                                                   |
| **Rotate View**      | Navigation — panning, beside the Hand                                                                                                                                  | `R`, printed on Adobe's own page; `Shift` snaps the drag to 15° steps                                                                                           | a numeric **Rotation Angle** field and **Reset View**; requires OpenGL                                                          | Adobe's _"Use the Rotate View tool"_ page: _"enter rotation numerically in the Rotation Angle field in the Options Bar. Select Reset View … to return to normal orientation"_, and _"Click and hold the Hand tool (H) and select the Rotate View tool (R)"_. The 15° snap is third-party.                                                                    |
| **Zoom**             | Navigation                                                                                                                                                             | `Z` — third-party; **not confirmed against an Adobe shortcut page**                                                                                             | Scrubby Zoom; zoom presets; Fit On Screen; 100% / Actual Pixels                                                                 | Adobe's viewing-images page documents the Zoom tool's behaviour and the 100% / Actual Pixels controls. `.kilo/plans/ps-research/03-ui-chrome-spec.md` §4 has the Scrubby Zoom detail. **Not Adobe-table-confirmed.**                                                                                                                                         |
| **Frame**            | Navigation — its **separator is unresolved**: its own tile, but whether it closes the Crop band or opens Measurement is one of `HANDOFF.md` §74's four open placements | `K` — **Adobe-confirmed** (Adobe: _"Select the Frame tool (K)"_)                                                                                                | Frame shape (Rectangular / Elliptical / Triangle / Polygonal / Custom), Stroke color, Stroke width, Stroke alignment            | Adobe's _"Draw frames"_ page confirms the shortcut `(K)` and every options-bar control. Its separator placement in the rail is still one of `HANDOFF.md` §74's four unresolved placements.                                                                                                                                                                   |
| **Slice**            | Crop and slice                                                                                                                                                         | `C` — **Adobe-confirmed** (Adobe: _"Press the C key to cycle through tools grouped with the Crop tool"_); `Shift+K` toggles with Slice Select per the CS2 sheet | Style (Normal / Fixed Aspect Ratio / Fixed Size), Slices From Guides, Promote                                                   | Adobe's _"Slice web pages"_ page confirms the `C` cycle and the Style, Slices From Guides and Promote controls. The `Shift+K` toggle is CS2-sheet only — current Adobe pages do not reprint it.                                                                                                                                                              |
| **Slice Select**     | Crop and slice                                                                                                                                                         | `Shift+K` toggles the pair with Slice — **CS2 sheet** (current Adobe pages do not reprint this shortcut)                                                        | Options (Slice Options dialog), Divide (H/V), Stacking order (4), Alignment (6), Distribute (6), Show/Hide Auto Slices, Promote | Adobe's _"Modify slice layout"_ page lists each control; the shortcut is CS2-sheet only. Not Adobe-table-confirmed.                                                                                                                                                                                                                                          |
| **Perspective Crop** | Crop and slice                                                                                                                                                         | `C` — grouped with Crop, **Adobe-confirmed** (Adobe: _"Hold down the Crop tool … then select the Perspective Crop tool"_)                                       | not researched — no Adobe page enumerates a dedicated bar; likely shares the Crop tool's options bar                            | Adobe's _"Transform perspective while cropping"_ page places it in the Crop group. `TOOLS-TOO-HARD.md` §"Crop: Straighten, Content-Aware and Generative Expand" records it as _"the Crop entry's transform work"_. Options bar not researched.                                                                                                               |
| **Artboard**         | Layout — placement in the rail is **unresolved**; Adobe treats artboards as a document feature, not a paint operation                                                  | `V` — **third-party, and the weakest letter in this file**: one diagram prints it, another numbers it differently                                               | not researched                                                                                                                  | `HANDOFF.md` §74 lists Artboard among the tools absent from the earlier list, present in Adobe's own shortcut PDF. `docs/LAYERS-PANEL.md` records the app side: _"The app has no artboards"_, so one of the Layers panel's nine filter kinds has nothing to filter. Options not researched.                                                                  |

**Zoom deserves one note of accuracy, because it is the entry most likely to be
mis-catalogued.** The app has a zoom **interaction mode** on the canvas and **no Zoom tool**:
the registry — the `ToolArgsByName` block in `src/contexts/tool-types.ts` — has no entry for it
and the rail has none
either. A zoom mode is not a tool.

## Path

| Adobe tool                | Group                                                                                          | Shortcut                                      | Headline options                                                                                                                                                         | Source                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Path Selection**        | Path                                                                                           | `A`, shared with Direct Selection             | Combine Shapes, Subtract From Shape Area, Intersect Shape Areas, Exclude Overlapping Shape Areas, **Merge Shape Components**; plus path alignment and arrangement        | The five operation names are recorded in `docs/TOOLS.md` §Pen as _"The Path Selection tool's drop-down"_, which marks them `missing` in this app. The `A` is the CS2 sheet and an older Adobe reference card. Not Adobe-table-confirmed.                                                                                       |
| **Direct Selection**      | Path                                                                                           | `A`, shared; the CS2-era toggle is `Shift+A`  | as above — it acts on individual anchor points and segments rather than whole components                                                                                 | `docs/TOOLS.md` §Pen records that `Ctrl+Alt` activates the Convert Point tool _"while the Direct Selection tool is selected"_, which is evidence the tool is absent from this app. Not Adobe-table-confirmed.                                                                                                                  |
| **Content-Aware Tracing** | **Pen tool group** — its page names the group, which is why it is here and not under Selection | not researched — no Adobe shortcut page opens | Detail slider; Create paths from detected edges; Extend currently selected path with detected edges; Trim traced paths; gated behind `Preferences > Technology Previews` | Adobe's _"Trace images with Content-Aware Tracing"_ page names the Pen tool group, the Detail slider, and the three path-generation buttons, and _"To enable it, select Preferences > Technology Previews and restart Photoshop"_. Its **slot inside the Pen flyout** is one of `HANDOFF.md` §74's four unresolved placements. |

**Path Selection and Direct Selection are the work-path object the Pen family would edit.**
`docs/TOOLS.md` §Pen documents that this app's Pen draws no pixels and has no anchor points to
select — all six Pen-family tools mount a dummy tool area — so these two are not two tools
added to a working foundation. They are the editing half of a family that is currently a stub.

---

## Sources

Everything in this file is attributable to one of the following. Adobe pages were reached
through the web search live crawler, not `webfetch` — `webfetch` returns HTTP 403 on
essentially every `helpx.adobe.com` path, which is recorded as a research-method fact in
`.kilo/plans/ps-research/00-tool-inventory.md` §Research method note and in
`docs/TOOLS-RESEARCH-BRIEF.md`.

**Adobe pages cited above**

- Selection tools overview —
  <https://helpx.adobe.com/uk/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html>
- Object Selection —
  <https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/select-objects-with-object-selection-tool.html>
- Selecting with the Lasso tools (Selection Brush) —
  <https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html>
- Remove tool —
  <https://helpx.adobe.com/photoshop/using/tool-techniques/remove-tool.html>
- Painting tools overview —
  <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html>
- Drawing tools overview —
  <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- Spot Healing Brush — <https://helpx.adobe.com/photoshop/using/tool-techniques/spot-healing-brush.html>
  and <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/spot-healing-brush-tool.html>
- Healing Brush — <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/healing-brush-tool.html>
- Patch — <https://helpx.adobe.com/photoshop/using/tool-techniques/patch-tool.html>
- Red Eye — <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-red-eye-in-flash-photos.html>
- Background Eraser —
  <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/change-pixels-to-transparent-with-the-background-eraser-tool.html>
  (NZ/AU variant confirms `(E)`: <https://helpx.adobe.com/nz/photoshop/using/tool-techniques/background-eraser-tool.html>)
- Mixer Brush — <https://helpx.adobe.com/photoshop/using/painting-mixer-brush.html>
- History Brush — <https://helpx.adobe.com/photoshop/using/tool-techniques/history-brush-tool.html>
- Art History Brush — <https://helpx.adobe.com/photoshop/using/painting-stylized-strokes-art-history.html>
- Paint with image states from the History panel —
  <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/paint-image-states.html>
- Adjustment Brush —
  <https://helpx.adobe.com/photoshop/using/tool-techniques/adjustment-brush-tool.html>
- Count — <https://helpx.adobe.com/photoshop/using/counting-objects-image.html>
- Note and metadata — <https://helpx.adobe.com/photoshop/using/metadata-notes.html>
- Ruler — <https://helpx.adobe.com/photoshop/using/positioning-ruler-tool.html>
- Hand — <https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html>
- Rotate View — <https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html>
- Viewing images, Zoom and the 100% / Actual Pixels controls — <https://helpx.adobe.com/photoshop/using/viewing-images.html>
- Pattern Stamp — <https://helpx.adobe.com/photoshop/using/painting-pattern.html>
- Painting tools (the Smoothing membership) — <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- Frame tool — <https://helpx.adobe.com/photoshop/using/tool-techniques/frame-tool.html>
  and <https://helpx.adobe.com/photoshop/desktop/create-manage-layers/layout-design-tools/draw-frames.html>
- Slice web pages — <https://helpx.adobe.com/photoshop/using/slicing-web-pages.html>
- Modify slice layout — <https://helpx.adobe.com/photoshop/using/modifying-slice-layout.html>
- Transform perspective while cropping —
  <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html>
- Crop tool options —
  <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html>
- Type tools (Horizontal Type) —
  <https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html>
- Edit text (Text Orientation) — <https://helpx.adobe.com/photoshop/using/editing-text.html>
- Create text selection borders (Type Mask tools) —
  <https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/create-text-selection-borders.html>
- Content-Aware Tracing —
  <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/trace-images-easily-with-the-content-aware-tracing-tool.html>
- Customize the toolbar — <https://helpx.adobe.com/photoshop/using/tools.html>

**Adobe tools named on the pages above but not separately opened:** Artboard. Its
membership is established by `HANDOFF.md` §74 quoting Adobe's own pages; this file did not
open it. All other tools in this file now have a dedicated Adobe page cited above.

**Adobe shortcuts confirmed via web search snippets** (not `webfetch`, which returns 403 on
`helpx.adobe.com`): Object Selection `(W)`, Spot Healing Brush `(J)`, History Brush `(Y)`,
Background Eraser `(E)`, Frame `(K)`, Slice `(C)`, Perspective Crop (grouped with Crop).
These are the Adobe-printed letters that replaced the third-party attributions in prior
versions of this file.

**Third-party, and labelled as such wherever it is relied on**

- 2026 toolbar diagrams used for group order: `glensmith.co.uk` and `panosfx.com`, per
  [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance. These diagrams are the
  source for the group **order** and **separator** placement, and for the letters this file
  does not otherwise attribute to Adobe: `V` for Artboard and `Z` for Zoom still come from
  this class of source. `K` (Frame), `C` (Slice, Perspective Crop), `W` (Object Selection)
  and `E` (Background Eraser) **were** listed here in prior versions but are now
  Adobe-confirmed — see the note above.
- Photoshop CS2 keyboard-shortcut sheet, third-party PDF of an Adobe sheet —
  <https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS2_Keyboard_Shortcuts_Mac.pdf>.
  Source of `Shift+Y`, `Shift+S`, `Shift+K`, `Shift+T`, `A`/`Shift+A`, and the legacy `N` for
  Note. **The vintage matters and is stated at each use.**
- A 2022 course PDF naming the type and path tools —
  <https://sf.massart.edu/wp-content/uploads/2022/10/Photoshop-03_The-Photoshop-Toolbar.pdf>.

**This repository**

- `.kilo/plans/ps-research/00-tool-inventory.md` — the registered-tool audit. **Its line 15
  reads "all 29 in `availableTools`" and that is stale: the registry now carries 53**
  (`src/contexts/tool-types.ts`, counted at the `ToolArgsByName` block). Its **Note A**
  (`color` has no determinate Photoshop identity) and **Note B** (`levels` is actually
  Brightness/Contrast) describe tools this app _has_, so they do not bear on this roster, and
  neither do they change the count.
- `.kilo/plans/ps-research/01-photoshop-reference.md` — the behaviour reference. **§10
  is a corrections log of 17 disproved premises and 18 unresolved items and must
  be read before trusting any Photoshop claim in the document.** Nothing in this file rests on
  a premise §10 lists as disproved.
- `.kilo/plans/ps-research/03-ui-chrome-spec.md` — options-bar contents per tool (§5),
  and an explicit _"Unverified — do not present as fact"_ section (§10) which this file
  respects.
- `docs/PHOTOSHOP-UX.md` — which tools are Adobe-table-confirmed and which are not
  (§"Open violations"); the trap list and the naming quirks.
- `HANDOFF.md` §74 — the 41 → 70 target, the four inventory corrections, the four
  unresolved placements, and the excluded candidates.
- `docs/TOOLS-TOO-HARD.md` §"The Adobe tools the rail omits" — the 30-entry roster this file
  takes over, and the dependencies the absent tools follow from.
- `docs/TOOLS.md` and `src/tools/descriptions/*.notes.md` — per-tool option censuses and the
  shortcut citations for the families that overlap this roster (Star, Path Selection,
  Direct Selection, Color Sampler). **`docs/TOOLS.md` only carries a tool that is implemented**,
  so its Sponge section appeared with the tool rather than before it; see the note in §Retouch for
  what the deleted row got wrong by citing it as though it already existed.
- `docs/TOOLS-RESEARCH-BRIEF.md` — the protocol this repository runs research under, including
  the rule that an unsourceable claim goes in an Unverified list rather than into the data.
- `toolbarMap`'s shape flyout, in `toolbar-mapping.ts` — its six entries, and the missing
  seventh.
- `docs/LAYERS-PANEL.md` — the app side of the Artboard gap.

## Unverified

**This list is deliberately not empty, and a row here is a statement about the state of the
research rather than about Photoshop.** Per-tool option bars were not audited for any tool in
this file; the "not researched" cells in the tables above are the same fact at row level.

### Still not researched at all — no options bar, no source opened

- **Adjustment Brush** options (third-party only; toolbar placement is contradictory)
- **Artboard** options
- **Adjustment Brush**, **Artboard** placements in the rail
- **Content-Aware Tracing** shortcut (options bar now researched)
- **Remove** shortcut (options bar now researched)
- **History Brush** numeric defaults (Mode, Opacity, Flow ranges — options bar names confirmed, ranges not audited against Adobe)

### Settled since — researched, and no longer "not researched"

- **Object Selection** shortcut and options bar. Adobe's own page confirms `(W)` and names Object Finder, the four selection modes, Sample All Layers and Hard Edge.
- **Selection Brush** options bar. Adobe's _"Selecting with the Lasso tools"_ page names Hardness, Opacity, Color overlay, Add/Subtract brush and selection modes.
- **Remove** options bar. Adobe's Remove tool page names Size, Mode (Gen AI on/off/Auto), Sample All Layers, Remove after each stroke, Output to.
- **Spot Healing Brush** options bar. Adobe's 2025 page confirms Brush Preset, Mode, Type (Content-Aware / Proximity Match / Create Texture) and Sample All Layers; **Pressure is not a control** on this tool.
- **Red Eye** shortcut and options bar. `J` confirmed via Adobe's Spot Healing Brush page; Adobe's Red Eye page names Pupil Size and Darken Amount.
- **Background Eraser** shortcut and options bar. Adobe's NZ/AU pages confirm `(E)`; Adobe's main page names Brush Preset, Sampling, Limits, Tolerance and Protect Foreground Color.
- **Mixer Brush** options bar. Adobe's _"Paint with the Mixer Brush"_ page lists Wet, Load, Mix, Sample All Layers, Current Brush Load (Load / Clean), Load/Clean after each stroke, Preset menu, plus Brush Preset / Mode / Opacity / Flow / Airbrush.
- **History Brush** shortcut and options bar. Adobe confirms `(Y)`; options bar carries Brush Preset, Mode, Opacity, Flow; **Source is set in the History panel**, not the options bar.
- **Art History Brush** options bar. Adobe's page names Brush Preset, Mode, Style, Area and Tolerance; Opacity confirmed by third-party guides.
- **Note** options bar. Adobe's _"Metadata and notes"_ page names Author, Color, Clear All.
- **Count** options bar. Adobe's _"Count objects in an image"_ page confirms every control: Count Group icons, Color picker, Marker Size (1–10), Label Size (8–72), Clear.
- **Frame** shortcut and options bar. Adobe's own page confirms `(K)` and names Frame shape, Stroke color, Stroke width, Stroke alignment.
- **Slice** shortcut and options bar. Adobe's _"Slice web pages"_ page confirms `(C)` and names Style, Slices From Guides, Promote.
- **Slice Select** options bar. Adobe's _"Modify slice layout"_ page lists Options, Divide, Stacking order, Alignment, Distribute, Show/Hide Auto Slices, Promote.
- **Perspective Crop** shortcut. Adobe's _"Transform perspective while cropping"_ page places it in the Crop group, confirming `C`.
- **Content-Aware Tracing** options bar. Adobe's page names Detail slider, Create paths, Extend path, Trim traced paths.
- **Vertical Type**, **Horizontal Type Mask**, **Vertical Type Mask** options. Adobe's pages confirm the full Type bar (Font Family, Font Style, Font Size, Anti-aliasing, Text Alignment, Text Color, Orientation, Warp) and the mask result mode.

**Single Row Marquee** and **Single Column Marquee** options. Adobe scopes `Anti-alias` to
the Elliptical Marquee and `Style`, `Fixed Ratio` and `Fixed Size` to the Rectangular and
Elliptical Marquees **by name**
(`helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`), so neither 1-pixel tool has
any of them. What is left on **Adobe's** bar for each is the four selection modes, `Feather`
and `Select and Mask` — and **this app renders none of those three either**, which is why they
are `missing` in `docs/TOOLS.md` rather than absent from this file: the tools exist, so their
gaps belong to the description system, not here. The scripting API is the sharper evidence on
the first two, since `selectRow`/`selectColumn` take neither a `feather` nor an `antiAlias`
parameter where `selectRectangle` takes both. Their cycling key is still unverified — see the
`M` group section of `src/tools/descriptions/selection.notes.md`.

**Third-party only — membership may be confirmed, the shortcut is not or is CS2-sheet**

- `Z` (Zoom), `V` (Artboard). Adobe's own pages were not opened for these letters.
- `W` for Object Selection, `E` for Background Eraser, `K` for Frame, `C` for Slice and Perspective Crop — **upgraded from third-party to Adobe-confirmed**: Adobe's own tool pages now print these letters. See the Adobe shortcuts confirmed via web search snippets note above.
- `Shift+Y`, `Shift+S`, `Shift+K`, `Shift+T`, `Shift+A`, `N` are from a **CS2** sheet. They
  are recorded because they are the best available evidence, not because a 2026 Adobe page
  confirms them.
- Red Eye's letter `J` is confirmed for the healing family via Adobe's Spot Healing Brush page, but Red Eye's own shortcut page was not opened.
- `Shift+B` for the Mixer Brush is third-party; Adobe does not print a dedicated Mixer Brush letter on its current shortcut reference.

**Group order and separators — hypothesis, not fact**

- The whole ordering of every table above, and where each tool sits relative to its
  neighbours. Membership is Adobe-confirmed; order is not.
- The **Frame** separator, **Content-Aware Tracing**'s slot, **Line vs Star** in the Shape
  flyout, and **Note**/**Count** in the default panel vs Extra Tools.

**Open questions this file deliberately did not answer**

- **The 30-vs-34 roster discrepancy.** Which two entries are spurious, or whether the 70-tool
  target should be 72. An operator's call.
- **Note** and **Count** are the two entries most likely to be spurious: `HANDOFF.md` §74
  records their default-panel placement as unresolved.
- Whether **Content-Aware Tracing** counts toward a Tools-panel roster at all, given that
  Adobe gates it behind `Preferences > Technology Previews`.
- **Star's** `Ratio` → inner-radius mapping, which `01-photoshop-reference.md` §10 records as
  undocumented, and which this file does not restate as fact.
