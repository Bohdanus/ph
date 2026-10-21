# Tools inventory: Adobe tools not mapped to the current rail

**This file's one job is to catalogue Adobe tool-panel tools this app does not map to the
rail**, keyed by Adobe's identity for each tool — name, group, shortcut, headline options,
and source. It is not a roadmap or priority list. Every row in the default-mode tables is
absent from `toolbarMap`; the conditional Technology Preview is kept separate because Adobe
says its default state is off.

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

## Current snapshot and evidence boundary

**The current implementation and Adobe's default toolbar are different counts.** `toolbarMap`
contains 50 rendered entries: 49 Adobe-named tool entries and the app-only Draw override
preserved by OVR-2. Those are across 21 flyout groups. `availableTools` has 53 registry IDs
because it also includes shape aliases and the `color`, `levels`, and `transform` menu-command
IDs; `ToolIconName` has 59 icon factories. None of those numbers is a count of Photoshop's
default Tools panel.

The current inventory has **22 documented tool-panel candidates not in the rail**; default visibility
is still unverified for some groups. Four rows
from the older inventory are now implemented and have been removed: Color Sampler, Hand, Rotate
View, and Zoom. The Content-Aware Tracing tool remains a separate conditional entry below because
Adobe documents it as a Technology Preview whose default state is off.

Adobe confirms individual membership and several group locations, but publishes no complete,
numbered enumeration of the default toolbar. Therefore the previous `30 + 6 = 36` combined list
and the historical `70 / 36 / 34` arithmetic are not current verified targets. Do not call 70 or
72 an Adobe-confirmed default count. A restored Photoshop default workspace screenshot, or an
Adobe-published complete default roster, is still needed before the exact target set and total can
be asserted. The remaining placement uncertainties are the Frame separator, Line-vs-Star order,
and Adjustment Brush's default group/visibility. Adobe's pages place Note and Count in the Eyedropper
family; the default visibility of every group member remains unverified.

**This is a sourced inventory, not a full options-bar audit.** It uses the tracked research protocol
(`docs/TOOLS-RESEARCH-BRIEF.md`), the Adobe citations below, and the tracked implementation sources.
The ignored `.kilo/plans/ps-research/` notes are historical background, not current count authority.
The rail count and the Note/Count/Content-Aware Tracing placements were rechecked on 2026-10-19.
**No unimplemented tool's complete option bar was opened and audited**; where a shortcut is
Adobe-published it says so, where it is inferred it says that, and where evidence is absent it says
**not researched**. The goal is an auditable gap, not an invented specification.

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

**Star was on this table and is not any more**, which is recorded here rather than left as a
quiet deletion. It was the sole entry in this table, sourced from Adobe's drawing-tools overview
and Star-tool page (see the Shape-family research in `src/tools/descriptions/shape.notes.md`).
The row documented the unresolved question of Star's exact position relative to Line in the
shape flyout. **Star is now implemented.** Adobe's separate Star-tool page names its points and inner/outer radii,
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

| Adobe tool                                                                                    | Group                                                | Shortcut                                                                    | Headline options                                                                                                          | Source                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Object Selection**                                                                          | Selection                                            | `W` — **Adobe-confirmed** (Adobe: _"Select the Object Selection tool (W)"_) | Object Finder toggle; selection modes (New / Add To / Subtract From / Intersect With); Sample All Layers; Hard Edge       | Adobe's selection-tools overview carries the tool and its one-line description; Adobe's Object Selection page prints `(W)` and names Object Finder, the four selection modes, Sample All Layers and Hard Edge.                                                                                             |
| **Selection Brush**                                                                           | Selection — **Lasso group**, not a marquee neighbour | none of its own                                                             | Hardness, Opacity, Color (gear icon), Add/Subtract brush, selection modes (New / Add To / Subtract From / Intersect With) | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance: desktop Photoshop, Adobe-confirmed, _"Lasso group"_. `HANDOFF.md` §74 corrects the earlier claim that it is web-only. Adobe's _"Selecting with the Lasso tools"_ page names Hardness, Opacity, the selection modes and the Color overlay. |
| **The rest follow from what this app already lacks.** Object Selection needs an               |
| edge-following segmentation comparable to what the Quick Selection entry records as too hard. |

**Single Row and Single Column Marquee were listed here until 2026-10-01 and are now
implemented**, so they have been deleted from that table rather than left in it: this file's
one job is the tools the rail does NOT have, and it became false for both of them. They live
in `src/tools/singleRowColumnMarquee.ts`, share the rectangular-selection commit path, and
are covered by `e2e/single-row-column-marquee.spec.ts`.

## Retouch

| Adobe tool             | Group                                                                 | Shortcut                                                                                                                                             | Headline options                                                                                                                                                                                          | Source                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Remove**             | Retouch — Spot Healing Brush group                                    | not researched — no Adobe shortcut page opened                                                                                                       | Size, Mode dropdown (Generative AI on / off / Auto), Sample All Layers, Remove after each stroke, Output to                                                                                               | Adobe's Remove tool page names all five controls; the shortcut is not confirmed on any Adobe page. The page groups Remove with Spot Healing Brush.                                   |
| **Content-Aware Move** | Retouch — Spot Healing Brush group                                    | `J`, by holding the Spot Healing Brush — **Adobe-confirmed**                                                                                         | Move an existing selection and fill the source area with surrounding content                                                                                                                              | Adobe's _"Content-Aware Patch and Move"_ page: _"In the toolbar, hold down the Spot Healing Brush and select the Content-Aware Move tool."_                                          |
| **Background Eraser**  | Retouch — **Eraser group**, beside the Eraser and Magic Eraser        | `E` — **Adobe-confirmed** (Adobe NZ/AU: _"Select the Background Eraser tool (E)"_); shared with Eraser and Magic Eraser; `Shift+E` cycles the family | Brush Preset (Size, Hardness, Spacing, Angle, Roundness), Sampling (Continuous / Once / Background Swatch), Limits (Discontiguous / Contiguous / Find Edges), Tolerance (0–100), Protect Foreground Color | Adobe's _"Change pixels to transparent with the Background Eraser tool"_ page names every control; Adobe's NZ/AU pages confirm `(E)`.                                                |
| **Adjustment Brush**   | Toolbar tool; group and default visibility **not specified by Adobe** | none of its own                                                                                                                                      | not researched — the options bar and adjustment-layer/mask workflow need a separate feature audit                                                                                                         | Adobe's _"Apply Adjustments with Adjustment Brush tool"_ page says _"Select Adjustment Brush Tool from the toolbar"_ but does not name a group, shortcut, or default-visible status. |

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
`src/contexts/tool-types.ts`.

**The three healing flyout tools — Spot Healing Brush, Healing Brush, and Patch — were on this
table and are not any more, which is recorded here rather than left as a quiet deletion.** All
three share `J` and ship in the app: `src/tools/spotHealing.ts`, `src/tools/healingBrush.ts` and
`src/tools/patch.ts` are the processors, `src/components/ToolbarsRight/SpotHealing/SpotHealing.tsx`,
`src/components/ToolbarsRight/HealingBrush/HealingBrush.tsx` and `src/components/ToolbarsRight/Patch/Patch.tsx`
are their bars, and `docs/TOOLS.md` carries the generated per-tool census at **§Spot Healing Brush Tool**,
**§Healing Brush Tool** and **§Patch Tool** with the sources behind them. Deleting the rows keeps this
file's contract — every row in the default-mode tables is absent from `toolbarMap`. The old
27-row table also contained Color Sampler, Hand, Rotate View, and Zoom, which are now mapped; after
removing those and separating the default-off Content-Aware Tracing preview, the current tables
contain 22 candidates plus one conditional entry.

**Red Eye was on this table and is not any more, which is recorded here rather than left as a
quiet deletion.** It was the fifth member of this table's `J` healing flyout row, and the app now
ships it: `src/tools/redEye.ts` is the tool, `src/components/ToolbarsRight/RedEye/RedEye.tsx` is
its bar, and `docs/TOOLS.md` carries the generated per-tool census at **§Red Eye Tool** with the
sources behind it. The tool uses a bounded connected red-pixel correction as an approximation of
Photoshop's proprietary eye/pupil detector; `docs/TOOLS.md` §Red Eye Tool records that
approximation and the limits Adobe's HelpX page does not document.

**Two claims the Sponge row carried were themselves wrong**, and they are the reason this note
exists rather than a bare `git log` entry:

- It cited "`docs/TOOLS.md` (Sponge section)" as evidence for the `O` cycle. **There was no Sponge
  section in `docs/TOOLS.md`**, and there could not have been: that file is generated from the
  family modules under `src/tools/descriptions/`, and a tool the registry has no entry for cannot be
  given a description in that system at all — the key's absence is a TypeScript error at the merge
  in `src/tools/descriptions/index.ts`, not a gap in a rendered page. The row was citing a document
  that the tooling makes impossible for an unimplemented tool to appear in.
- It read "the cycle is confirmed in this app's own `docs/TOOLS.md`". The cycle is now confirmed
  against **Adobe's own pages** instead, which is where it belonged: Adobe lists the Dodge, the Burn
  and the Sponge as three rows carrying the same `O`, with `Shift+O` cycling the group.

**Healing and Patch are one flyout family, not separate contiguous rail slots.** Adobe groups
Spot Healing Brush, Healing Brush, Patch, Red Eye, Remove, and Content-Aware Move under `J`. The
first four are implemented here; Remove and Content-Aware Move remain unimplemented candidates.
Sponge is implemented in the separate `O` family with Dodge and Burn.

## Painting

| Adobe tool            | Group                                 | Shortcut                                                                                                           | Headline options                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mixer Brush**       | Painting — Brush flyout, fourth entry | none of its own; reached by cycling the Brush slot (`B`/`Shift+B`) — **third-party**                               | Wet, Load, Mix, Sample All Layers, Current Brush Load (Load / Clean), Load Brush after Each Stroke, Clean Brush after Each Stroke, Preset menu (Dry / Moist / Wet / Very Wet × Light / Heavy), plus Brush Preset / Mode / Opacity / Flow / Airbrush | Adobe's _"Paint with the Mixer Brush"_ page lists every control; numeric preset values are community reverse-engineered only. The `B`-family cycle is third-party.                                                                                                                                                       |
| **History Brush**     | Painting                              | `Y` — **Adobe-confirmed** (Adobe: _"Select the History Brush tool (Y)"_); `Shift+Y` toggles with Art History Brush | Brush Preset (Size, Hardness), Mode, Opacity, Flow — **the source is set in the History panel**, not on the options bar                                                                                                                             | Adobe's History Brush page: _"Select the History Brush tool (Y)"_ and _"click the far-left column of the state that you want to use as the source"_. The previous "Source: the selected state or snapshot" headline was a documentation error — the source is set in the History panel, not via an options-bar dropdown. |
| **Art History Brush** | Painting                              | `Shift+Y` toggles with History Brush; not printed on Adobe's own Art History Brush page — **CS2 sheet**            | Brush Preset picker, Mode, Style, Area, Tolerance, Opacity                                                                                                                                                                                          | Adobe's _"Paint stylized strokes with the Art History Brush"_ page names Brush Preset, Mode, Style, Area and Tolerance explicitly; Opacity is confirmed by third-party CS-era and CS6 guides; Style menu items are **not** enumerated on Adobe's page.                                                                   |
| **Pattern Stamp**     | Painting                              | `S`, shared with the Clone Stamp; `Shift+S` toggles the pair — **CS2 sheet**                                       | brush preset, Mode, Opacity, **Aligned**, and a pattern picker                                                                                                                                                                                      | Adobe's _"Paint with a pattern"_ page: _"Select Aligned in the options bar to maintain the pattern's continuity with your original start point"_                                                                                                                                                                         |

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
objects (Adobe's ["Edit text in Photoshop"](https://helpx.adobe.com/photoshop/using/editing-text.html)
guide; summarized in `docs/PHOTOSHOP-UX.md`). Adding the three missing type tools without fixing that
adds three ways to create pixels that Photoshop would have kept editable.

## Navigation and measuring

This is **Adobe's least complete overview table**. The current rail maps Hand, Rotate View, Zoom,
and Ruler. The remaining default-mode candidates in this category are Note, Count, Frame, Slice,
Slice Select, Perspective Crop, and Artboard; Path Selection and Direct Selection are listed under
Path. Membership and group evidence are recorded row by row because the overview alone is incomplete.

| Adobe tool           | Group                                                                                                                                                                  | Shortcut                                                                                                                                                        | Headline options                                                                                                                | Source                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Note**             | Eyedropper family                                                                                                                                                      | `I`, cycled; a legacy `N` from the CS2 sheet                                                                                                                    | Author (text field), Color (color picker), Clear All                                                                            | Adobe's _"Metadata and notes"_ page names Author, Color and Clear All and says to hold the Eyedropper if Note is not visible. That confirms the family; it does not enumerate complete default-panel visibility. The `N` is a CS2-era key, not current. |
| **Count**            | Eyedropper family                                                                                                                                                      | `I`, cycled                                                                                                                                                     | Count Group (create folder / delete / eye / rename), Color picker, Marker Size (1–10), Label Size (8–72), Clear                 | Adobe's _"Count objects in an image"_ page calls Count a tool located beneath the Eyedropper and confirms the group, color, marker-size, label-size, and clear controls. It does not enumerate the complete default toolbar.                            |
| **Frame**            | Navigation — its **separator is unresolved**: its own tile, but whether it closes the Crop band or opens Measurement is one of `HANDOFF.md` §74's four open placements | `K` — **Adobe-confirmed** (Adobe: _"Select the Frame tool (K)"_)                                                                                                | Frame shape (Rectangular / Elliptical / Triangle / Polygonal / Custom), Stroke color, Stroke width, Stroke alignment            | Adobe's _"Draw frames"_ page confirms the shortcut `(K)` and every options-bar control. Its separator placement in the rail is still one of `HANDOFF.md` §74's four unresolved placements.                                                              |
| **Slice**            | Crop and slice                                                                                                                                                         | `C` — **Adobe-confirmed** (Adobe: _"Press the C key to cycle through tools grouped with the Crop tool"_); `Shift+K` toggles with Slice Select per the CS2 sheet | Style (Normal / Fixed Aspect Ratio / Fixed Size), Slices From Guides, Promote                                                   | Adobe's _"Slice web pages"_ page confirms the `C` cycle and the Style, Slices From Guides and Promote controls. The `Shift+K` toggle is CS2-sheet only — current Adobe pages do not reprint it.                                                         |
| **Slice Select**     | Crop and slice                                                                                                                                                         | `Shift+K` toggles the pair with Slice — **CS2 sheet** (current Adobe pages do not reprint this shortcut)                                                        | Options (Slice Options dialog), Divide (H/V), Stacking order (4), Alignment (6), Distribute (6), Show/Hide Auto Slices, Promote | Adobe's _"Modify slice layout"_ page lists each control; the shortcut is CS2-sheet only. Not Adobe-table-confirmed.                                                                                                                                     |
| **Perspective Crop** | Crop and slice                                                                                                                                                         | `C` — grouped with Crop, **Adobe-confirmed** (Adobe: _"Hold down the Crop tool … then select the Perspective Crop tool"_)                                       | not researched — no Adobe page enumerates a dedicated bar; likely shares the Crop tool's options bar                            | Adobe's _"Transform perspective while cropping"_ page places it in the Crop group. `TOOLS-TOO-HARD.md` §"Crop: Straighten, Content-Aware and Generative Expand" records it as _"the Crop entry's transform work"_. Options bar not researched.          |
| **Artboard**         | Move tool group                                                                                                                                                        | `V` — **Adobe-confirmed**                                                                                                                                       | not researched                                                                                                                  | Adobe's _"Work with the Artboard tool"_ page says to select it from the toolbar and, if it is not visible, hold the Move tool to reveal related tools. `docs/LAYERS-PANEL.md` records that the app has no artboards. Options not researched.            |

**Zoom is implemented as a dedicated toolbar tool**, not merely as a canvas interaction mode. Its
presentation state and gesture limits are documented with the Zoom tool in `docs/TOOLS.md`.

## Path

| Adobe tool           | Group | Shortcut                                     | Headline options                                                                                                                                                  | Source                                                                                                                                                                                                                                   |
| -------------------- | ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path Selection**   | Path  | `A`, shared with Direct Selection            | Combine Shapes, Subtract From Shape Area, Intersect Shape Areas, Exclude Overlapping Shape Areas, **Merge Shape Components**; plus path alignment and arrangement | The five operation names are recorded in `docs/TOOLS.md` §Pen as _"The Path Selection tool's drop-down"_, which marks them `missing` in this app. The `A` is the CS2 sheet and an older Adobe reference card. Not Adobe-table-confirmed. |
| **Direct Selection** | Path  | `A`, shared; the CS2-era toggle is `Shift+A` | as above — it acts on individual anchor points and segments rather than whole components                                                                          | `docs/TOOLS.md` §Pen records that `Ctrl+Alt` activates the Convert Point tool _"while the Direct Selection tool is selected"_, which is evidence the tool is absent from this app. Not Adobe-table-confirmed.                            |

**Path Selection and Direct Selection are the work-path object the Pen family would edit.**
`docs/TOOLS.md` §Pen documents that this app's Pen draws no pixels and has no anchor points to
select — all six Pen-family tools mount a dummy tool area — so these two are not two tools
added to a working foundation. They are the editing half of a family that is currently a stub.

## Conditional: Content-Aware Tracing

This Technology Preview is not part of the default-mode candidate count above: Adobe documents its
default state as off and requires enabling it in Preferences. When enabled, Adobe places it in the
Pen group; its exact slot in that flyout is not published.

| Adobe tool                | Group                        | Default state           | Headline options                                                                                                       | Source                                                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Content-Aware Tracing** | Pen tool group, when enabled | Technology Preview, off | Detail slider; Create paths from detected edges; Extend currently selected path with detected edges; Trim traced paths | Adobe's _"Trace images with Content-Aware Tracing"_ page names the Pen group, Detail slider, and three path-generation buttons; the Technology Preview page says the default state is off and requires Preferences to enable it. The slot within the Pen flyout is unresolved. |

---

## Sources

Everything in this file is attributable to one of the following. Adobe pages were reached
through the web search live crawler, not `webfetch` — the latter returns HTTP 403 on many
`helpx.adobe.com` paths. The tracked research protocol and source links are in
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
- Content-Aware Move — <https://helpx.adobe.com/photoshop/using/content-aware-patch-move.html>
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
- Artboard tool — <https://helpx.adobe.com/photoshop/using/tool-techniques/artboard-tool.html>
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
- Technology Previews — <https://helpx.adobe.com/photoshop/using/technology-previews.html>
- Customize the toolbar — <https://helpx.adobe.com/photoshop/using/tools.html>

All currently listed Adobe tool-panel candidates have a dedicated Adobe page or overview cited above.

**Adobe shortcuts confirmed via web search snippets** (not `webfetch`, which returns 403 on
`helpx.adobe.com`): Object Selection `(W)`, Spot Healing Brush `(J)`, History Brush `(Y)`,
Background Eraser `(E)`, Frame `(K)`, Slice `(C)`, Perspective Crop (grouped with Crop).
These are the Adobe-printed letters that replaced the third-party attributions in prior
versions of this file.

**Third-party, and labelled as such wherever it is relied on**

- 2026 toolbar diagrams used for group order: `glensmith.co.uk` and `panosfx.com`, per
  [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance. These diagrams are the
  source for the group **order** and **separator** placement, and for the letters this file
  does not otherwise attribute to Adobe: `Z` for Zoom still comes from
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

- `toolbar-mapping.ts` and `src/contexts/tool-types.ts` — the current rail map and registry IDs;
  these are the source of the implementation counts above.
- `src/components/SidebarLeft/types.ts` and `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`
  — the `ToolIconName` union and its exact 59-name assertion.
- `docs/PHOTOSHOP-UX.md` — current Adobe-backed behavior claims and explicitly unverified
  placements.
- Local `.kilo/plans/ps-research/` notes — historical research only. In particular,
  `00-tool-inventory.md` still says `availableTools` has 29 entries and cites source paths that have
  moved; do not use it for current counts or file locations.
- `docs/PHOTOSHOP-UX.md` — which tools are Adobe-table-confirmed and which are not
  (§"Open violations"); the trap list and the naming quirks.
- `HANDOFF.md` §74 — the current rail requirement, rederived implementation counts, remaining
  source gaps, and unresolved default-roster facts.
- `docs/TOOLS-TOO-HARD.md` §"The Adobe tools the rail omits" — the historical 30-entry roster this
  file took over, and the dependencies the absent tools follow from.
- `docs/TOOLS.md` and `src/tools/descriptions/*.notes.md` — per-tool option censuses and the
  shortcut citations for the families that overlap this roster (Star, Path Selection,
  Direct Selection, Color Sampler). **`docs/TOOLS.md` only carries a tool that is implemented**,
  so its Sponge section appeared with the tool rather than before it; see the note in §Retouch for
  what the deleted row got wrong by citing it as though it already existed.
- `docs/TOOLS-RESEARCH-BRIEF.md` — the protocol this repository runs research under, including
  the rule that an unsourceable claim goes in an Unverified list rather than into the data.
- `toolbarMap`'s shape flyout, in `toolbar-mapping.ts` — its seven entries: Rectangle, Ellipse, Line, Triangle, Polygon, Star and Custom Shape, all present.
- `docs/LAYERS-PANEL.md` — the app side of the Artboard gap.

## Unverified

**This list is deliberately not empty, and a row here is a statement about the state of the
research rather than about Photoshop.** Per-tool option bars were not audited for any tool in
this file; the "not researched" cells in the tables above are the same fact at row level.

### Still not fully audited

- **Adjustment Brush** group/default visibility and complete options; Adobe confirms toolbar
  membership but does not name its group or restored-default status.
- **Artboard** options and default visibility; Adobe places it in the Move group.
- **Content-Aware Tracing** shortcut and exact Pen-flyout slot if the default-off preview is enabled.
- **Remove** shortcut (options bar now researched)
- **History Brush** numeric defaults (Mode, Opacity, Flow ranges — options bar names confirmed, ranges not audited against Adobe)

### Settled since — researched, and no longer "not researched"

- **Object Selection** shortcut and options bar. Adobe's own page confirms `(W)` and names Object Finder, the four selection modes, Sample All Layers and Hard Edge.
- **Selection Brush** options bar. Adobe's _"Selecting with the Lasso tools"_ page names Hardness, Opacity, Color overlay, Add/Subtract brush and selection modes.
- **Remove** options bar. Adobe's Remove tool page names Size, Mode (Gen AI on/off/Auto), Sample All Layers, Remove after each stroke, Output to.
- **Spot Healing Brush** options bar. Adobe's 2025 page confirms Brush Preset, Mode, Type (Content-Aware / Proximity Match / Create Texture) and Sample All Layers; **Pressure is not a control** on this tool. Now implemented — `src/tools/spotHealing.ts` ships it.
- **Healing Brush** options bar. Adobe's Healing Brush page names Mode (Normal, Replace, Multiply, Screen, Darken), Source, Aligned, Sample and Diffusion. Now implemented — `src/tools/healingBrush.ts` ships it.
- **Patch** options bar. Adobe's Patch page names the single Patch option (Normal, then Source or Destination). Now implemented — `src/tools/patch.ts` ships it.
- **Red Eye** shortcut and options bar. `J` confirmed via Adobe's Spot Healing Brush page; Adobe's Red Eye page names Pupil Size and Darken Amount. Now implemented — `src/tools/redEye.ts` ships it.
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

- `Z` (Zoom) remains third-party; Adobe's current Zoom pages do not print a shortcut. `V` for
  Artboard is Adobe-confirmed by its tool page.
- `W` for Object Selection, `E` for Background Eraser, `K` for Frame, `C` for Slice and Perspective Crop — **upgraded from third-party to Adobe-confirmed**: Adobe's own tool pages now print these letters. See the Adobe shortcuts confirmed via web search snippets note above.
- `Shift+Y`, `Shift+S`, `Shift+K`, `Shift+T`, `Shift+A`, `N` are from a **CS2** sheet. They
  are recorded because they are the best available evidence, not because a 2026 Adobe page
  confirms them.
- `Shift+B` for the Mixer Brush is third-party; Adobe does not print a dedicated Mixer Brush letter on its current shortcut reference.

**Group order and separators — hypothesis, not fact**

- The whole ordering of every table above, and where each tool sits relative to its
  neighbours. Membership is Adobe-confirmed; order is not.
- The **Frame** separator, **Line vs Star** order in the Shape flyout, and **Adjustment Brush**
  default group. Content-Aware Tracing's Pen-flyout slot matters only when the default-off preview
  is enabled.

**Open questions this file deliberately did not answer**

- **The exact default roster and its total.** Adobe publishes no complete enumeration, so the
  historical 70/72 alternatives are not an Adobe-verified target. Keep the current code/inventory
  counts explicit, but do not resolve the default list by arithmetic.
- **Adjustment Brush default visibility and grouping.** Adobe confirms a toolbar tool but does not
  name its group or whether it appears in the restored default toolbar.
- **Note and Count visibility in a restored default toolbar.** Adobe places both in the Eyedropper
  family; the docs do not establish whether every family member is visible in the default layout.
- **Content-Aware Tracing** is default-off; it is not included in the default-mode candidate count.
- **Star's** `Ratio` → inner-radius mapping, which `01-photoshop-reference.md` §10 records as
  undocumented, and which this file does not restate as fact.
