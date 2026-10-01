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
ToolDescription>` at `src/tools/descriptions/index.ts:37`, where `ToolName = keyof
ToolArgsByName` (`src/contexts/tool-types.ts:81`). A tool the registry has no entry for cannot
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
repository already did — [`../.kilo/plans/ps-research/`](../.kilo/plans/ps-research/), the
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
Artboard — and **Content-Aware Move** (`HANDOFF.md:1807`).

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
  **That 41 is §74's own historical figure, not today's count** — the registry carries 42 now,
  since the Sponge was added to it. The quotation is left as §74 states it rather than
  silently re-derived, because §74 is a record of an exercise and not a live total. So 34 is forced by
  the **70-tool target**, not counted off a roster. A combined list of 35 means either the
  target is 71 or one entry does not belong.
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

## Selection

| Adobe tool                | Group                                                | Shortcut                                                                                                                | Headline options                                                                                                         | Source                                                                                                                                                                                                                                                                               |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Star**                  | Drawing — shapes flyout, seventh entry               | none of its own; reached by cycling the shapes group                                                                    | Point count, plus inner and outer radii — `TOOLS.md` §Polygon Tool records that Sides is _Polygon_’s control, not Star’s | Adobe's drawing-tools overview lists Star; `docs/TOOLS.md` and `src/tools/descriptions/shape.notes.md` §Star carry the two sources (the overview plus the Adobe page "Select the Star tool from the shapes tool group in the Tools panel")                                           |
| **Object Selection**      | Selection                                            | `W`, shared with the colour-based selection family — **third-party only, not confirmed against an Adobe shortcut page** | not researched                                                                                                           | Adobe's selection-tools overview carries the tool and its one-line description; the shortcut is from a third-party toolbar diagram                                                                                                                                                   |
| **Single Row Marquee**    | Selection — marquee flyout, fourth entry             | the marquee letter, cycled — **the specific key is not researched**                                                     | not researched                                                                                                           | Adobe's selection-tools overview tabulates it                                                                                                                                                                                                                                        |
| **Single Column Marquee** | Selection — marquee flyout, fifth entry              | the marquee letter, cycled — **the specific key is not researched**                                                     | not researched                                                                                                           | Adobe's selection-tools overview tabulates it                                                                                                                                                                                                                                        |
| **Selection Brush**       | Selection — **Lasso group**, not a marquee neighbour | none of its own                                                                                                         | not researched                                                                                                           | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance: desktop Photoshop, Adobe-confirmed, "Lasso group". `HANDOFF.md` §74 corrects the earlier claim that it is web-only. Options bar not researched.                                                                     |
| **Content-Aware Move**    | Selection                                            | not researched                                                                                                          | not researched                                                                                                           | **§74 evidence only — no Adobe page was opened for this row**, which is why it is called out rather than quietly folded in. `HANDOFF.md:1807` names it as a large tool needing a generative backend. `grep -rni "content-aware" src toolbar-mapping.ts` finds it nowhere in the app. |

**Star is the notable one**, because it is a missing _entry_ rather than a missing tool. The
shape flyout carries Rectangle, Ellipse, Line, Triangle, Polygon and Custom Shape
(`toolbar-mapping.ts:109-116`) — six of Adobe's seven — and Star is the one it lacks. The
same custom-shape work is filed as too hard in [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md), so a
hardcoded star is exactly what this repository's policy refuses.

**The rest follow from what this app already lacks.** Object Selection needs an
edge-following segmentation comparable to what the Quick Selection entry records as too hard;
Single Row and Single Column are the two cheapest real additions in `HANDOFF.md` §74 — two
lines of geometry reusing the rectangular-selection path.

## Retouch

| Adobe tool             | Group                                                          | Shortcut                                                               | Headline options                                                                     | Source                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spot Healing Brush** | Retouch — healing flyout, first entry                          | `J`, printed on Adobe's own page                                       | Size, Hardness, Spacing, Pressure; Content-Aware variants                            | Adobe: _"Select the Spot Healing Brush (J)"_, and the Options bar named as _"Size, Hardness, and Spacing"_                                                                                                                                                                                                                                    |
| **Healing Brush**      | Retouch — healing flyout, second entry                         | `J`, printed on Adobe's own page                                       | Mode (Normal, Replace, Multiply, Screen, Darken), Source, Aligned, Sample, Diffusion | Adobe's Healing Brush page lists _"Mode, Source, Aligned, Sample, and Diffusion"_                                                                                                                                                                                                                                                             |
| **Patch**              | Retouch — healing flyout, third entry                          | `J`, printed on Adobe's own page                                       | Patch option Normal, then Source or Destination                                      | Adobe's Patch page lists _"Normal"_ and _"Source or Destination"_                                                                                                                                                                                                                                                                             |
| **Remove**             | Retouch                                                        | not researched                                                         | not researched                                                                       | `HANDOFF.md` §74: Adobe-documented, _"In the Tools panel, select Remove tool"_, and absent from the overview tables because it has its own page. Options bar not researched.                                                                                                                                                                  |
| **Red Eye**            | Retouch — healing flyout                                       | the healing family letter — **not researched against a shortcut page** | pupil size and darkness                                                              | Adobe has a page titled _"Remove red eye in flash photos"_, whose summary names pupil size and darkness. Options are one search excerpt deep, not an audited bar.                                                                                                                                                                             |
| **Background Eraser**  | Retouch — **Eraser group**, beside the Eraser and Magic Eraser | `E`, shared with the Eraser family — **third-party**                   | not researched                                                                       | Adobe's page _"Change pixels to transparent with the Background Eraser tool"_ exists; its option list was not read.                                                                                                                                                                                                                           |
| **Adjustment Brush**   | Painting — **Brush flyout sibling**, not a retouch tool        | none of its own                                                        | not researched                                                                       | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance: desktop Photoshop, Adobe-confirmed, _"Select Adjustment Brush Tool from the toolbar"_, and _"a large feature involving an adjustment layer plus a painted mask"_. `HANDOFF.md` §74 is explicit that membership and size are different decisions. Options bar not researched. |

**The Sponge was on this table and is not any more, which is recorded here rather than left as a
quiet deletion.** It was the third member of this table's `O` toning flyout row, and the app now
ships it: `src/tools/sponge.ts` is the tool, `src/components/ToolbarsRight/Sponge/Sponge.tsx` is
its bar, and `docs/TOOLS.md` carries the generated per-tool census at **§Sponge Tool** with the
sources behind it. Deleting the row keeps this file's contract — every row here is absent from
`src/contexts/tool-types.ts` — and it is the reason this file's tables now show 29 of the 30 absent
tools this file attributes to `TOOLS-TOO-HARD.md`: 35 rows across the six Adobe groups, less the six
that group names at the top as coming from `HANDOFF.md` §74 instead. **Two claims the deleted row carried were themselves
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
`HANDOFF.md` §74 lists the Healing Brush, Red Eye and Sponge among the cheapest real
additions because they are geometry and pixel loops rather than new subsystems. **The Sponge was the
one of those three that has actually been built**; the Healing Brush and Red Eye are still absent,
and both are larger than the Sponge was.

## Painting

| Adobe tool            | Group                                                                                               | Shortcut                                                                                                           | Headline options                                                                                                                                           | Source                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mixer Brush**       | Painting                                                                                            | not researched                                                                                                     | Wetness and the paint-loading controls, plus Load and Mix; it is the one painting tool Adobe's own Smoothing page names alongside Brush, Pencil and Eraser | Adobe's painting-tools overview: _"Simulates realistic painting techniques such as blending canvas colors and varying paint wetness"_; the Smoothing membership is from Adobe's Painting-tools page via `docs/TOOLS.md`. Full bar not researched.                                                                                                                                          |
| **History Brush**     | Painting                                                                                            | `Y`, shared with the Art History Brush; `Shift+Y` toggles the pair — **from the CS2 sheet, so the vintage is old** | Source: the selected state or snapshot                                                                                                                     | Adobe's painting-tools overview: _"Paints a copy of the selected state or snapshot into the current image window"_                                                                                                                                                                                                                                                                         |
| **Art History Brush** | Painting                                                                                            | `Shift+Y` toggles it with the History Brush — **CS2 sheet**                                                        | the style picker — a set of named paint styles — plus Area and Tolerance                                                                                   | Adobe's painting-tools overview: _"Paints with stylized strokes that simulate the look of different paint styles, using a selected state or snapshot"_. Style-picker detail not audited against a bar.                                                                                                                                                                                     |
| **Pattern Stamp**     | Painting                                                                                            | `S`, shared with the Clone Stamp; `Shift+S` toggles the pair — **CS2 sheet**                                       | brush preset, Mode, Opacity, **Aligned**, and a pattern picker                                                                                             | Adobe's _"Paint with a pattern"_ page: _"Select Aligned in the options bar to maintain the pattern's continuity with your original start point"_                                                                                                                                                                                                                                           |
| **Color Sampler**     | Painting, in Adobe's own painting table — and the `I` family with Eyedropper, Ruler, Note and Count | `I`, cycled; `Shift+I` cycles the five                                                                             | a sample-size footprint and up to four samples                                                                                                             | Adobe's painting-tools overview: _"Displays color values for up to four areas"_. The `I`-family membership is quoted from Adobe in `src/tools/descriptions/eyedropper-draw.notes.md` — _"Eyedropper, Color Sampler, Ruler, Note, and Count Tool I"_ — and `docs/TOOLS.md` records that **none of the four tools Photoshop cycles to with `Shift+I` exists in this app's registry at all**. |

**History Brush and Art History Brush need the retained-raster history model** that
[`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md) already records as too hard for Erase to History.
They are two tools standing behind one missing architecture, which is why they are cheap to
name and expensive to build.

## Type

| Adobe tool               | Group                                      | Shortcut                                               | Headline options                                                              | Source                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vertical Type**        | Type — the second member of the `T` flyout | `T`, cycled; `Shift+T` cycles the pair — **CS2 sheet** | the Horizontal Type bar, with the orientation changed                         | A third-party 2022 course PDF names the pair _"Type Tools Horizontal & Vertical Type"_ and says of the Vertical one _"The Vertical Type Tool will make text write vertically instead."_ Adobe's own page was not opened; `docs/TOOLS.md` §Type covers the shared bar. |
| **Horizontal Type Mask** | Type — the type **mask** flyout            | the type letter, cycled                                | the Type bar plus a mode that makes the result a selection rather than pixels | Same third-party PDF: _"Horizontal and Vertical Type Mask Tools … make whatever you type into a selection behave like any other selection."_ Options not researched against Adobe.                                                                                    |
| **Vertical Type Mask**   | Type — the type **mask** flyout            | the type letter, cycled                                | as above                                                                      | Same third-party PDF. Options not researched against Adobe.                                                                                                                                                                                                           |

**All three are candidates for a different reason than the others.** This app's `text` tool is
raster-at-birth: it is registered `commit: 'source'`, so a text layer is pixels from the
moment it is created, and Photoshop type layers are live editable objects
(`.kilo/plans/ps-research/00-tool-inventory.md` §Structural notes). Adding the three missing
type tools without fixing that adds three ways to create pixels that Photoshop would have
kept editable.

## Navigation and measuring

This is **Adobe's least complete overview table**. `docs/PHOTOSHOP-UX.md` records that only
one line of it was retrievable (_"Ruler tool Measures distances, locations, and angles"_), and
that Hand, Rotate View, Zoom, Frame, Slice, Perspective Crop, Slice Select, Path Selection and
Direct Selection are **not Adobe-table-confirmed** — they come from the shortcut PDF and from
individual tool pages. That boundary is preserved here row by row.

| Adobe tool           | Group                                                                                                                                                                  | Shortcut                                                                                                          | Headline options                                                                                                        | Source                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ruler**            | Measurement — the `I` family                                                                                                                                           | `I`, cycled                                                                                                       | X and Y of the start point, W and H, the angle, and both legs of a protractor; a Measurement Scale preference           | Adobe's _"Position with the Ruler tool"_ page: _"The starting location (X and Y) … The horizontal (W) and vertical (H) distances traveled … The angle measured relative to the axis (A) … The total length traveled (D1) … The two lengths traveled (D1 and D2), when you use a protractor"_. **The only tool in this group that is Adobe-table-confirmed.** |
| **Note**             | Measurement — the `I` family                                                                                                                                           | `I`, cycled; a legacy `N` from the CS2 sheet                                                                      | not researched                                                                                                          | Adobe's `I`-family membership, quoted in `src/tools/descriptions/eyedropper-draw.notes.md`. The `N` is the CS2-era _"Notes / Audio Annotation Tool"_ and is **not** a current key. Whether Note is in the default panel at all is unresolved.                                                                                                                |
| **Count**            | Measurement — the `I` family                                                                                                                                           | `I`, cycled                                                                                                       | Count Groups with their own marker, label size and colour; Clear resets the group; counts record to the Measurement Log | Adobe's _"Count objects in an image"_ page: _"The count number is displayed on the item and in the Count tool options bar"_, plus the count-group paragraph. Whether Count is in the default panel at all is unresolved.                                                                                                                                     |
| **Hand**             | Navigation — panning                                                                                                                                                   | `H`, printed on Adobe's own page                                                                                  | Fit On Screen; spacebar is a temporary switch to it                                                                     | Adobe's _"Pan across the canvas with the Hand tool"_ page: _"Select the Hand tool (H) from the toolbar or press and hold the spacebar key"_. Options not researched beyond the Fit On Screen control named on Adobe's viewing-images page.                                                                                                                   |
| **Rotate View**      | Navigation — panning, beside the Hand                                                                                                                                  | `R`, printed on Adobe's own page; `Shift` snaps the drag to 15° steps                                             | a numeric **Rotation Angle** field and **Reset View**; requires OpenGL                                                  | Adobe's _"Use the Rotate View tool"_ page: _"enter rotation numerically in the Rotation Angle field in the Options Bar. Select Reset View … to return to normal orientation"_, and _"Click and hold the Hand tool (H) and select the Rotate View tool (R)"_. The 15° snap is third-party.                                                                    |
| **Zoom**             | Navigation                                                                                                                                                             | `Z` — third-party; **not confirmed against an Adobe shortcut page**                                               | Scrubby Zoom; zoom presets; Fit On Screen; 100% / Actual Pixels                                                         | Adobe's viewing-images page documents the Zoom tool's behaviour and the 100% / Actual Pixels controls. `.kilo/plans/ps-research/03-ui-chrome-spec.md` §4 has the Scrubby Zoom detail. **Not Adobe-table-confirmed.**                                                                                                                                         |
| **Frame**            | Navigation — its **separator is unresolved**: its own tile, but whether it closes the Crop band or opens Measurement is one of `HANDOFF.md` §74's four open placements | `K` — third-party                                                                                                 | not researched                                                                                                          | Adobe's own "Draw frames" section exists in the current help tree. Adobe-table-unconfirmed; the `K` is third-party.                                                                                                                                                                                                                                          |
| **Slice**            | Crop and slice                                                                                                                                                         | `C`, the Crop letter, cycled — third-party; `Shift+K` toggles Slice and Slice Select per the CS2 sheet            | not researched                                                                                                          | Adobe has Slice help pages ("Slice web pages", "Modify slice layout"); the table row was not retrieved. Not Adobe-table-confirmed.                                                                                                                                                                                                                           |
| **Slice Select**     | Crop and slice                                                                                                                                                         | `Shift+K` toggles the pair with Slice — CS2 sheet                                                                 | not researched                                                                                                          | Same as Slice. Not Adobe-table-confirmed.                                                                                                                                                                                                                                                                                                                    |
| **Perspective Crop** | Crop and slice                                                                                                                                                         | `C`, the Crop letter, cycled — third-party                                                                        | the Crop bar's **Perspective Warp** transform work                                                                      | `HANDOFF.md` §74: _"All are in Adobe's own shortcut PDF"_, and Perspective Crop is _"the Crop entry's transform work"_ per [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md). Options not researched.                                                                                                                                                                 |
| **Artboard**         | Layout — placement in the rail is **unresolved**; Adobe treats artboards as a document feature, not a paint operation                                                  | `V` — **third-party, and the weakest letter in this file**: one diagram prints it, another numbers it differently | not researched                                                                                                          | `HANDOFF.md` §74 lists Artboard among the tools absent from the earlier list, present in Adobe's own shortcut PDF. `docs/LAYERS-PANEL.md` records the app side: _"The app has no artboards"_, so one of the Layers panel's nine filter kinds has nothing to filter. Options not researched.                                                                  |

**Zoom deserves one note of accuracy, because it is the entry most likely to be
mis-catalogued.** The app has a zoom **interaction mode** on the canvas and **no Zoom tool**:
the registry at `src/contexts/tool-types.ts:28-78` has no entry for it and the rail has none
either. A zoom mode is not a tool.

## Path

| Adobe tool                | Group                                                                                          | Shortcut                                     | Headline options                                                                                                                                                  | Source                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Path Selection**        | Path                                                                                           | `A`, shared with Direct Selection            | Combine Shapes, Subtract From Shape Area, Intersect Shape Areas, Exclude Overlapping Shape Areas, **Merge Shape Components**; plus path alignment and arrangement | The five operation names are recorded in `docs/TOOLS.md` §Pen as _"The Path Selection tool's drop-down"_, which marks them `missing` in this app. The `A` is the CS2 sheet and an older Adobe reference card. Not Adobe-table-confirmed.                                                                                  |
| **Direct Selection**      | Path                                                                                           | `A`, shared; the CS2-era toggle is `Shift+A` | as above — it acts on individual anchor points and segments rather than whole components                                                                          | `docs/TOOLS.md` §Pen records that `Ctrl+Alt` activates the Convert Point tool _"while the Direct Selection tool is selected"_, which is evidence the tool is absent from this app. Not Adobe-table-confirmed.                                                                                                             |
| **Content-Aware Tracing** | **Pen tool group** — its page names the group, which is why it is here and not under Selection | not researched                               | detects object edges and produces a vector path or a selection; gated behind `Preferences > Technology Previews`                                                  | Adobe's _"Trace images with Content-Aware Tracing"_ page: _"Select Content-Aware Tracing tool from the Pen tool group in the toolbar"_, and _"To enable it, select Preferences > Technology Previews and restart Photoshop"_. Its **slot inside the Pen flyout is one of `HANDOFF.md` §74's four unresolved placements.** |

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
- Painting tools overview —
  <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html>
- Drawing tools overview —
  <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- Spot Healing Brush — <https://helpx.adobe.com/photoshop/using/tool-techniques/spot-healing-brush.html>
  and <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/spot-healing-brush-tool.html>
- Healing Brush — <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/healing-brush-tool.html>
- Patch — <https://helpx.adobe.com/photoshop/using/tool-techniques/patch-tool.html>
- Red Eye — <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-red-eye-in-flash-photos.html>
- Count — <https://helpx.adobe.com/photoshop/using/counting-objects-image.html>
- Ruler — <https://helpx.adobe.com/photoshop/using/positioning-ruler-tool.html>
- Hand — <https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html>
- Rotate View — <https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html>
- Viewing images, Zoom and the 100% / Actual Pixels controls — <https://helpx.adobe.com/photoshop/using/viewing-images.html>
- Pattern Stamp — <https://helpx.adobe.com/photoshop/using/painting-pattern.html>
- Painting tools (the Smoothing membership) — <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- Content-Aware Tracing —
  <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/trace-images-easily-with-the-content-aware-tracing-tool.html>
- Customize the toolbar — <https://helpx.adobe.com/photoshop/using/tools.html>

**Adobe tools named on the pages above but not separately opened:** Remove, Background Eraser,
Artboard, Frame, Slice, Slice Select, Perspective Crop, Object Selection. Their membership is
established by `HANDOFF.md` §74 quoting Adobe's own pages; this file did not open them.

**Third-party, and labelled as such wherever it is relied on**

- 2026 toolbar diagrams used for group order: `glensmith.co.uk` and `panosfx.com`, per
  [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) §Confidence and provenance. The third-party letters
  attributed above (`K` for Frame, `V` for Artboard, `Z` for Zoom, `C` for Slice and
  Perspective Crop, `W` for Object Selection, `E` for Background Eraser) come from this class
  of source, not from Adobe.
- Photoshop CS2 keyboard-shortcut sheet, third-party PDF of an Adobe sheet —
  <https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS2_Keyboard_Shortcuts_Mac.pdf>.
  Source of `Shift+Y`, `Shift+S`, `Shift+K`, `Shift+T`, `A`/`Shift+A`, and the legacy `N` for
  Note. **The vintage matters and is stated at each use.**
- A 2022 course PDF naming the type and path tools —
  <https://sf.massart.edu/wp-content/uploads/2022/10/Photoshop-03_The-Photoshop-Toolbar.pdf>.

**This repository**

- `.kilo/plans/ps-research/00-tool-inventory.md` — the registered-tool audit. **Its line 15
  reads "all 29 in `availableTools`" and that is stale: the registry now carries 42**
  (`src/contexts/tool-types.ts`, counted at the `ToolArgsByName` block). Its **Note A**
  (`color` has no determinate Photoshop identity) and **Note B** (`levels` is actually
  Brightness/Contrast) describe tools this app _has_, so they do not bear on this roster, and
  neither do they change the count.
- `.kilo/plans/ps-research/01-photoshop-reference.md` — the behaviour reference. **§10
  (`:888-955`) is a corrections log of 17 disproved premises and 18 unresolved items and must
  be read before trusting any Photoshop claim in the document.** Nothing in this file rests on
  a premise §10 lists as disproved.
- `.kilo/plans/ps-research/03-ui-chrome-spec.md` — options-bar contents per tool at `:175`,
  and an explicit _"Unverified — do not present as fact"_ section at `:333` which this file
  respects.
- `docs/PHOTOSHOP-UX.md` — which tools are Adobe-table-confirmed and which are not
  (`:113-143`); the trap list and the naming quirks.
- `HANDOFF.md` §74 (`:1745`) — the 41 → 70 target, the four inventory corrections, the four
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
- `toolbar-mapping.ts:109-116` — the shape flyout's six entries, and the missing seventh.
- `docs/LAYERS-PANEL.md` — the app side of the Artboard gap.

## Unverified

**This list is deliberately not empty, and a row here is a statement about the state of the
research rather than about Photoshop.** Per-tool option bars were not audited for any tool in
this file; the "not researched" cells in the tables above are the same fact at row level.

**Not researched at all — no options bar, no source opened**

- **Object Selection** options
- **Single Row Marquee** and **Single Column Marquee** options, and their cycling keys
- **Selection Brush** options
- **Remove** options, and its shortcut
- **Background Eraser** options
- **Adjustment Brush** options
- **Mixer Brush** options beyond the wetness/load/mix description
- **History Brush** and **Art History Brush** option names
- **Vertical Type**, **Vertical Type Mask**, **Horizontal Type Mask** options
- **Note** options
- **Frame**, **Slice**, **Slice Select**, **Perspective Crop**, **Artboard** options
- **Content-Aware Tracing** options and shortcut
- **Object Selection**, **Single Row**, **Single Column**, **Frame**, **Artboard** placements
  in the rail

**Third-party only — membership may be confirmed, the shortcut is not**

- `K` (Frame), `V` (Artboard), `Z` (Zoom), `C` (Slice, Perspective Crop), `W` (Object
  Selection), `E` (Background Eraser). Adobe's own pages were not opened for the letters.
- `Shift+Y`, `Shift+S`, `Shift+K`, `Shift+T`, `Shift+A`, `N` are from a **CS2** sheet. They
  are recorded because they are the best available evidence, not because a 2026 Adobe page
  confirms them.
- Red Eye's letter is inferred from the healing family, not read off a shortcut page.

**Group order and separators — hypothesis, not fact**

- The whole ordering of every table above, and where each tool sits relative to its
  neighbours. Membership is Adobe-confirmed; order is not.
- The **Frame** separator, **Content-Aware Tracing**'s slot, **Line vs Star** in the Shape
  flyout, and **Note**/**Count** in the default panel vs Extra Tools.

**Open questions this file deliberately did not answer**

- **The 30-vs-34 roster discrepancy.** Which entry is spurious, or whether the 70-tool target
  should be 71. An operator's call.
- **Note** and **Count** are the two entries most likely to be spurious: `HANDOFF.md` §74
  records their default-panel placement as unresolved.
- Whether **Content-Aware Tracing** counts toward a Tools-panel roster at all, given that
  Adobe gates it behind `Preferences > Technology Previews`.
- **Star's** `Ratio` → inner-radius mapping, which `01-photoshop-reference.md` §10 records as
  undocumented, and which this file does not restate as fact.
