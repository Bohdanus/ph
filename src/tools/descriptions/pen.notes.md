# Pen and path family — research notes

Six `ToolName`s: `pen`, `freeform-pen`, `curvature-pen`, `add-anchor-point`, `delete-anchor-point`,
`convert-point`. The file this accompanies is `src/tools/descriptions/pen.ts`; the citations in this
document were re-derived in the `tool-descriptions` worktree and are duplicated there as
`implementationRefs`, which is the machine-readable copy.

## The finding that shapes all six descriptions

**Every tool in this family is a placeholder, and the placeholder is the same placeholder for all six.**
The app lists all six in the left rail, gives all six a `ToolName`, a `ToolProcessorDefinition`, an
icon and a `P`/`Shift+P` binding — and then does nothing at all when you use one.

The three facts that settle it, in the order they matter:

1. **A processor exists for each, and it is the shared no-op stub.** `src/tools/toolProcessors.ts:333-358`
   gives all six `commit: 'unimplemented'`, `replay: replay('unimplemented', false, false)` and
   `imageProcessor: unimplemented`. That `unimplemented` is `() => () => [null as never]`
   (`src/tools/toolProcessors.ts:110`) — a zero-arity function returning a null bitmap, so a drag
   commits no pixels, records no history state and produces no durable operation. None of the six is a
   `creator`. `src/tools/__tests__/tool-processors.test.ts:344-349` pins all six commit kinds, and
   `src/tools/__tests__/tool-processors.test.ts:722-724` pins that all six share the one stub instance.
2. **All six render `PlaceholderTool`, through the same config key.** `src/tools/toolsMap.ts:149-174`
   calls `placeholderTool('<Tool> Tool', 'pen')` for all six — note `'pen'`, not each tool's own key.
   `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8-36` renders an amber dashed panel with a
   `TODO` badge and a row of static `<span>` chips. `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:42-50`
   pins all six to `configKey: 'pen'`.
3. **There is no state behind any of it.** Each tool's args type is literally its own name and nothing
   else — `src/contexts/tool-types.ts:68-73` — and `src/tools/settings.ts:295-300` seeds the same
   `{ toolName }` default. The arm at `src/util/settings.ts:110-118` reduces all six back to
   `{ toolName }` on every save (`:109`), and the comment at `src/util/settings.ts:103-108` names the pen
   family as the group that still does this. `src/tools/__tests__/tool-settings.test.ts:399-405`
   asserts that every `unimplemented` tool's seeded default is a bare tool name.

The substrate is missing too, which is the deeper point: the app has **no Paths panel and no work-path
concept at all**. `grep -rn "workPath|work path" src` returns nothing, and no component under
`src/components` mentions a Paths panel. Every one of these six tools, in Photoshop, is an editor of a
path that lives in that panel. There is nothing for them to edit, which is why a placeholder is the
honest state rather than a gap someone forgot.

## "No processor" is a claim about the pixel-free list, and these six are not on it

The three anchor-point entries used to say each acts "over a tool that has no processor", and that is
the one wording in this family that was strictly false while sounding like a caveat. In this codebase
**no processor** has a precise meaning and it excludes these three: `src/tools/toolsMap.ts:146-148`
uses the phrase for the eyedropper, whose absence is real because the eyedropper is the only tool in
`PIXEL_FREE_TOOLS` and so genuinely carries only an icon and a bar. All six Pen tools are registered
in `toolProcessors`, and all three anchor-point tools are wired to the same `unimplemented` instance
the rest of the family uses — the same one this note's first fact above already names. The file's own
`pen` entry had it right, and it now says so in all three, with
`src/tools/toolProcessors.ts:110` cited in each entry so the "shared" is checkable rather than
asserted.

## The canvas and the keyboard, which are a different axis from the bar

Everything above is about the options bar and the processor. Two further facts are about what a user
can actually do with the tool, and they are the ones that survive a screenshot of the amber panel:

- **No Pen tool has a gesture surface at all.** `src/components/Main/Main.tsx:70-144` turns a tool name
  into an `interactionMode`, and none of the six appears in any branch of that chain, so
  `interactionMode` stays its `'zoom'` default and `EventHandler` stays `DummyToolArea`
  (the default at `src/components/Main/Main.tsx:225`, the fallthrough every Pen tool takes at
  `src/components/Main/Main.tsx:250`), which renders a `display: none` div
  (`src/components/Main/DummyToolArea.tsx:15`). That is why no `modifiers` row in this family is
  backed by anything, and why `Esc` and `Ctrl+Alt` are recorded as absent rather than merely unlisted.
  For the record, the app binds `Escape` in exactly five places and none is a Pen tool:
  `PolygonClickToolArea.tsx:923` and `FeatherMagneticLassoToolArea.tsx:544` (the lasso pair),
  `CropToolArea.tsx:54`, `ToolbarsRight/Text/FontSelect.tsx:55` and
  `ToolbarsRight/Transform/Transform.tsx:37`. The Escape branch in `TextToolArea.tsx:114` is commented
  out, which is why the text tool is not in that list.
- **The keyboard reaches three of the six.** The rail's Pen flyout lists six tools
  (`toolbar-mapping.ts:106-111`) and `penGroup` holds three
  (`src/components/Common/AppKeyboardShortcuts.tsx:53`), so `Shift+P` never reaches Add Anchor Point,
  Delete Anchor Point or Convert Point — they are reachable from **no** key in the app, which is a
  stronger statement than "they have no shortcut of their own" and the one the data file now makes.

**Plain `P` is not "select the Pen tool", and the data file used to say it was.** `selectPenTool`
(`src/components/Common/AppKeyboardShortcuts.tsx:209-218`) resolves to the already-active member of
`penGroup` when the current tool is in it, and to `'pen'` otherwise. Two consequences the three `P`
rows now state: `P` keeps the Freeform or the Curvature Pen where it is instead of snapping back to
the Pen; and it never selects the Freeform or Curvature Pen from anything else, so the old wording on
those two rows — "Selects the Freeform Pen tool" — was wrong in the same direction as the Pen's. The
binding is also `enabled: hasImage` (`src/components/Common/AppKeyboardShortcuts.tsx:512-517`), so it
does nothing until an image is open.

Two further app facts, both first-class and both test-pinned:

- **The Freeform Pen and the Curvature Pen render the wrong chip list.** `toolbarPlaceholderConfig.ts:24-25`
  defines a `[Tool Mode, Fill, Stroke, Magnetic, Curve Fit]` list for each — and `toolsMap.ts` never asks
  for either key. `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:172` asserts
  `unreachableKeys` is exactly `['freeform-pen', 'curvature-pen', 'rectangle']` (the binding it compares
  is at `:164`), i.e. those two lists are
  dead config that a test now requires to stay dead. So the Freeform Pen's bar names neither `Magnetic`
  nor `Curve Fit` — the two controls that are its entire reason for existing — and the Curvature Pen
  inherits the Freeform Pen's controls rather than its own. The unreachable list is the load-bearing
  evidence; `:128-130` separately pins the dead lists' contents.
- **The durable document refuses the family.** `src/contexts/__tests__/history-adapter.tool-conversion.test.ts:242`
  asserts that converting a history item naming an `unimplemented` tool is rejected with an
  unsupported-feature diagnostic — the rejection itself is the unconditional throw at
  `src/contexts/history-adapter.ts:550`, and that test's worked example happens to name `pen` — and
  `src/contexts/__tests__/history-replay.branches.test.ts:781-800` pins that legacy replay keeps
  authority for `pen` and `freeform-pen` through the injected raster adapter. So even a history item
  that names one of these tools cannot reach the durable path.

Also worth recording: `src/components/SidebarLeft/toolIcons.tsx:80-85` gives the Pen, the Curvature Pen
and all three anchor-point tools the _same_ pen-nib icon; only the Freeform Pen has its own. Five of the
six are visually indistinguishable in the rail.

## Status tally

Across the family: **0 `present`, 0 `partial`, 15 `inert`, 14 `missing`, 29 control rows.** The three
anchor-point tools contribute no rows, for the reason under "Add / Delete / Convert".

| Tool            | Controls | present | partial | inert | missing |
| --------------- | -------- | ------- | ------- | ----- | ------- |
| `pen`           | 12       | 0       | 0       | 7     | 5       |
| `freeform-pen`  | 9        | 0       | 0       | 4     | 5       |
| `curvature-pen` | 8        | 0       | 0       | 4     | 4       |
| the three below | 0        | 0       | 0       | 0     | 0       |

**The `inert` count was 15 until an independent audit recounted it, and this table carried the
error.** The `curvature-pen` row was tallied as three when it is four — it has Mode, Fill, Stroke and
Selection…/Mask/Shape. A later recount found a second error in the same table: `curvature-pen` was
given nine controls and five `missing` where the data file and this file's own Curvature Pen table
both say eight and four, so the family was stated as 30 rows with 14 `missing` when the file holds 29
with 13. Recounted mechanically from `pen.ts`, the family total is now 15 `inert` across 29 control
rows: 16 less the one row that moved from `inert` to `missing` under "Path Operations" below, which is
the only `inert` count this pass changed on purpose. The repository-wide figure in the earlier version
— pen 16, paint 3 (eraser `Flow`, magic-eraser `Anti-aliased`, paint-bucket `Anti-aliased`), draw 1
(`Mode`), and zero in selection, focus, shape, type-crop and transform — is **not** re-derived here:
it was counted in the `tool-descriptions` worktree, and the other tools' description files sit on their
own branches, so this worktree's copies are not the states it was taken from. A hand-maintained tally in
a prose file is the one number in this directory with nothing holding it to the code beside it.

**This family is what the `inert` definition is for.** It originally read "_state_ is declared and
persisted (`src/tools/settings.ts`) but no component renders it", which does not fit here: no state is
declared at all, the args type _is_ the tool name. The definition was widened to "declared **or
displayed**, and nothing is wired behind it", with the second shape spelled out as "a label on a
placeholder chip that no component ever reads" — which is these 15 controls exactly. So `inert` is used
for the controls whose **name is on screen as a chip** and `missing` for the controls with no chip,
because `missing` is defined as "the app does not render this control" and a rendered label is not
that. The alternative — calling all 29 `missing` — loses the fact that seven of the standard Pen's
twelve control names are literally visible in the app's bar, which is the claim most likely to be
mistaken for "the app has it". Those seven are exactly the seven chips the bar renders, one for one.

**`inert` is not `present`, and the reason is worth stating because it is the whole point of the
status.** A screenshot of this bar shows seven of its twelve control names and looks like a working
Pen. Nothing reads any of them. `inert` is the status that survives a screenshot, and `present` is the
only status that does not.

Controls that surprised me, in the order they surprised me:

1. **`Minus Back` is not a Photoshop path operation.** The brief asked for it; it is not in any Adobe
   page. Photoshop has four — Add To Path Area, Subtract From Path Area, Intersect Path Areas, Exclude
   Overlapping Path Areas — plus `Merge Shape Components` on the Path Operations menu. This matches
   correction log entry 6 in the corpus, and I re-derived it rather than taking it.
2. **The Pen's four `Mode` values are Shape / Path / Pixels, not Select / Add / Remove / Free.** Adobe's
   own Pen settings page tabulates exactly three, and a second Adobe page enumerates them again.
   **Adobe documents no Select/Add/Remove/Free Pen mode in any product.** The earlier version of
   this note claimed the quartet "belongs to Illustrator's Pen", and that attribution has been
   dropped: Illustrator's own Pen page shows no `Mode` dropdown at all, and no Adobe page opened
   names a Select/Add/Remove/Free mode for any product. What the evidence does carry is that
   Photoshop's four overlap operations exist under different names and a different control —
   `Add To Path Area`, `Subtract From Path Area`, `Intersect Path Areas` and `Exclude Overlapping
Path Areas` are **Path Operation** controls in the Pen's Path mode, not Pen modes. Note also
   that where Photoshop and Illustrator genuinely do differ, the converter tool has a _different
   name_ in each (`Convert Point` here, `Anchor Point` in Illustrator, `Convert Direction Point` in
   InDesign), which is a reliable tell that the two products' option vocabularies are not
   interchangeable.
3. **There is no `Curvature` slider — stated as a limit, not as an absence.** No control named
   `Curvature` appears in any Adobe page located. The documented bar is the Path Options flyout
   (path thickness — `Weight` in newer releases) and Rubber Band. This was previously written as a
   flat "there is no `Curvature` slider", which rested on absence-of-mention in pages that do not
   enumerate the bar at all — most of what the crawler returns for "Curvature tool" is
   **Illustrator's** tool, and a page that never lists the bar cannot establish what is not in it.
   See `Unverified` for what is still open.
4. **`Magnetic` is a checkbox, not a strength control.** The strength controls are Width /
   Contrast / Frequency, the ones Adobe documents for the Magnetic Lasso; the data file now says the
   Freeform Pen uses "the same Width / Contrast / Frequency / Stylus Pressure controls the Magnetic
   Lasso documents", which stops short of asserting that the two tools share one settings object.
5. **The three anchor-point tools have no options bar of their own at all** — see below. So the brief's
   "for EVERY control in Photoshop's options bar" has an empty subject for one third of the family, and
   that is the finding rather than an omission.

## `pen`

### What Photoshop's tool does

Click to place an anchor point, click again for a straight segment, drag to pull out direction handles
and get a curve. `Mode` decides what the result _is_: `Shape` makes a shape layer with a vector mask,
`Path` makes a work path that can be stroked or filled later, `Pixels` rasterizes onto the current layer
(`overview-of-pen-tool-settings.html`; `shape-path-and-pixel-mode-options.html`). **The group's two
label sets are both real, and the data file states both.** The current Pen settings page tabulates the
values as `Shape` / `Path` / `Pixels`; Adobe's `About drawing` page names the same three buttons
**"Shape Layers"**, **"Paths"** and **"Fill Pixels"**, with the figure caption "A. Shape Layers B. Paths
C. Fill Pixels" (`https://helpx.adobe.com/photoshop/using/drawing.html`). The short forms are what the
current page uses and what most third-party sources repeat; the long forms are what the older
Adobe-authored material uses. Nothing turns on which a user sees — the three modes and their order
are the same — but a description that prints only one set is making a choice the evidence does not
force.

The load-bearing behaviour, and the reason the tool is not a brush: **a Pen path is not a stroke until
you make it one.** In Path mode the tool adds no color to the canvas; what it leaves is vector
geometry in the Paths panel. Adobe's own statement is the one the data file now uses nearly
verbatim, and it is on the `About drawing` page rather than an inference from it: Path mode
"**Draws a work path on the current layer that you can then use to make a selection, create a
vector mask, or fill and stroke with color** to create raster graphics (much as you would using a
painting tool). A work path is temporary unless you save it"
(`https://helpx.adobe.com/photoshop/using/drawing.html`). That sentence is also the correction of
this file's own worst sentence: the earlier data-file wording said a work path "stays invisible
until it is filled, stroked, loaded as a selection, or turned into a vector mask or shape layer",
which (a) is a paraphrase — Adobe never uses the word "hidden" or "invisible" — and (b) mixes
operations **on** a work path with operations **from** one. See `Unverified` item 13, which is now
closed by the same sentence.

Path semantics, all sourced:

- The Paths panel "lists the name and a thumbnail image of each saved path, the current work path, and
  the current vector mask" (`paths.html`).
- A work path is temporary: "If you deselect the work path without saving it and start drawing again, a
  new path will replace the existing one" (`paths.html`). So one unsaved path at a time, and the next
  one clobbers it — which is why the feature page's first instruction for making a selection is to save
  it first.
- Only one path is selected at a time: "Click the path name in the Paths panel. Only one path can be
  selected at a time" (`paths.html`).
- The four overlap modes are named twice by Adobe with two different sets of names — `Add To Path Area`
  and friends in `paths.html`, `Combine Shapes` and friends on the Path Selection tool's `Path Operations`
  menu in `editing-paths.html`. The data file keeps both namings attached to the control each belongs to.
- Loading a selection is `Ctrl+Enter` / `Cmd+Return`, or the Load-path-as-selection button at the bottom
  of the Paths panel (Adobe's pen-tool feature page).

### Options bar

| Control                     | Photoshop detail                                                                                                                                    | Status    | appRef                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------- |
| `Mode`                      | Shape / Path / Pixels three-button group — named Shape Layers / Paths / Fill Pixels on Adobe's older drawing page; gates which other controls exist | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Tool Mode")       |
| `Fill`                      | Fill color; Shape mode                                                                                                                              | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Fill")            |
| `Stroke`                    | Stroke color, width, type; Shape mode                                                                                                               | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Stroke")          |
| `Operation`                 | Path mode: Add To / Subtract From / Intersect / Exclude Overlapping Path Area                                                                       | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Path Operations") |
| `Path Operations`           | Path Selection tool's menu: Combine Shapes … + Merge Shape Components                                                                               | `missing` | —                                                         |
| `Path alignment`            | Align and distribute path components                                                                                                                | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Alignment")       |
| `Path arrangement`          | Stacking order of multiple paths                                                                                                                    | `missing` | —                                                         |
| `Path thickness (Weight)`   | On-canvas path line width; display only, lives in the additional-options flyout                                                                     | `missing` | —                                                         |
| `Path color`                | The other half of the same Path Options panel — "Path options: Thickness and Color"; display only                                                   | `missing` | —                                                         |
| `Selection… / Mask / Shape` | Converts the _already drawn_ path to a selection, a vector mask, or a shape layer                                                                   | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Make Selection")  |
| `Auto Add/Delete`           | On by default; Pen morphs to Add/Delete Anchor over an existing path                                                                                | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Auto Add/Delete") |
| `Rubber Band`               | Live segment preview; in the additional-options flyout                                                                                              | `missing` | —                                                         |

**The two rows are not one chip, and an earlier version of this file said they were.** `Operation` and
`Path Operations` are two different Adobe controls: `Operation` is the Pen's own Path-mode area control
(`Add To Path Area` and friends), and `Path Operations` is the Path Selection tool's drop-down over a
component that already exists. The app renders **one** chip of that name — the fourth of seven on
`toolbarPlaceholderConfig.ts:23`, after `Make Selection` — and it is `Operation`'s, because the app
labels the Pen's own control "Path Operations" and because a chip on the Pen's bar can only stand for a
control the Pen owns. So `Operation` stays `inert` with that `appRef`, and `Path Operations` is
`missing` with no `appRef` at all: the app's bar does not carry it, and its row now says so in those
words. That is the same call `descriptions/shape.ts` makes, where `pathOperationsControl` is declared
`missing` (`descriptions/shape.ts:98-103`) and only overridden to `inert` for `custom-shape`, whose own
chip list names the control (`descriptions/shape.ts:524`). The earlier wording here — "That is honest —
the app has one `Path
Operations` label standing in for two distinct Adobe controls on two distinct tools" — is what let two
rows claim one rendering, and it is withdrawn: one chip cannot be the rendering of two controls the same
record insists are different, so the record now claims the rendering only where it happens.

### Modifiers, shortcuts, cursor

- `Shift` constrains the segment to 45° (`draw-paths-with-the-pen-tool.html`).
- `Alt` both converts a smooth point to a corner point on click and unhinges a direction handle from
  its opposite while dragging — the same page's tip and its "curve to a straight segment" note.
- `Ctrl` / `Command` while drawing temporarily activates the Direct Selection tool, so you can adjust
  segments you have already drawn (`editing-paths.html`). This row was **missing** and is now the third
  modifier on the `pen` record.
- `P`; `Shift+P` cycles the nested group. Adobe's own pages only ever state `P`
  (`tool-techniques/pen-tool.html`); `Shift+P` is a third-party and app fact, and the app implements it
  at `src/components/Common/AppKeyboardShortcuts.tsx:53` for exactly the three pens — which matches
  Photoshop, which gives the three anchor-point tools no shortcut of their own.
- `Ctrl+Enter` loads the path as a selection; `Ctrl+Alt` / `Cmd+Option` over an anchor point reaches the
  Convert Point tool from the Direct Selection tool (`editing-paths.html`). **Neither is bound.** There
  is no `Enter` keybinding for any path in the app, and the shortcut matcher can express an `alt` guard
  (`src/hooks/useKeyboardEvents.tsx:76`) that no registration uses.
- **The cursor is the mode display, and Photoshop's own documentation says so.** The Pen becomes the Add
  or Delete Anchor Point tool as you move over a selected path, and Adobe's InDesign page for the same
  Pen spells out where Photoshop differs from its siblings: "In Photoshop, the pointer changes only
  after you've started dragging", and over an endpoint "In Photoshop, a small diagonal line, or slash,
  appears next to the Pen tool" where Illustrator and InDesign show a convert-point icon. Sourced.

### Sources

- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-paths-with-the-pen-tool.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html
- https://helpx.adobe.com/photoshop/using/editing-paths.html
- https://helpx.adobe.com/photoshop/using/paths.html
- https://helpx.adobe.com/photoshop/using/tool-techniques/pen-tool.html
- https://helpx.adobe.com/photoshop/using/drawing.html _(the three drawing modes under their older Adobe names, Shape Layers / Paths / Fill Pixels; and the sourced statement of what a work path is for)_
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html
- https://www.adobe.com/products/photoshop/pen-tool.html

## `freeform-pen`

### What Photoshop's tool does

One drag becomes a path. Adobe's feature page: "Use the Freeform Pen tool to draw freehand and anchor
points will automatically appear", with `Curve Fit` set "between 0.5 and 10.0 pixels". `Magnetic` turns
the trace into an edge-following one — the Freeform Pen is the Pen-family member with a
`Magnetic` checkbox in its bar, and its snapping strength uses the same Width / Contrast /
Frequency / Stylus Pressure controls the Magnetic Lasso documents. That last clause was previously
written as "sharing the Magnetic Lasso's snapping machinery", which claimed more than the evidence
carries: no Adobe page documents the Freeform Pen's own `Magnetic` flyout, so what can be said is
which controls it uses, not that it shares one settings object with another tool. The Magnetic Lasso
page that establishes those four control names is now **in the record's `sources` array** — the claim
was already in the data file, and an unsourced claim belongs in `Unverified` instead
(`types.ts:140-141`), so the fix was to cite the page rather than to delete the sentence.

Introduced in **Photoshop 5.0 (May 1998)**, alongside the Magnetic Lasso and the Magnetic Pen. Two
independent sources agree and the corpus's "5.5" is wrong: the Photoshop release history lists 5.0
"Strange Cargo", May 1998, with "Magnetic Lasso and Pen" and "Freeform Pen", and the Centre for
Computing History's 5.0 record lists "magnetic lasso and pen, freeform pen" among that release's new
features. The Freeform Pen is therefore only slightly younger than the Pen family itself.

### Options bar

| Control                     | Photoshop detail                                              | Status    | appRef                                                   |
| --------------------------- | ------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `Mode`                      | Shape / Path / Pixels                                         | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Tool Mode")      |
| `Fill`                      | Fill color; Shape mode                                        | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Fill")           |
| `Stroke`                    | Stroke color; Shape mode                                      | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Stroke")         |
| `Curve Fit`                 | Single numeric field, 0.5–10 px, the simplification tolerance | `missing` | —                                                        |
| `Magnetic`                  | Checkbox: snap the live segment to the strongest image edge   | `missing` | —                                                        |
| `Align Edges`               | Straighten a snapped segment; unavailable for this tool       | `missing` | —                                                        |
| `Selection… / Mask / Shape` | Convert the already drawn path                                | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Make Selection") |
| `Path color`                | Path Options panel: on-canvas path line color, display only   | `missing` | —                                                        |
| `Rubber Band`               | Live path preview                                             | `missing` | —                                                        |

`modifiers` is empty. Every Freeform Pen modifier I could find — `Alt` as a temporary standard Pen,
releasing `Alt` mid-drag to resume freeform, `Enter` to end an open path, `Alt`+double-click to close
with a straight segment — is corpus-and-third-party only. See `Unverified`. I did not put an unsourced
gesture in the data file to fill the array.

### Sources

- https://www.adobe.com/products/photoshop/pen-tool.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html
- https://helpx.adobe.com/photoshop/using/paths.html
- https://helpx.adobe.com/photoshop/using/editing-paths.html _(the `Path color` half of the Path Options panel)_
- https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/snap-to-image-edges-using-magnetic-lasso-tool.html _(the Width / Contrast / Frequency / Stylus Pressure controls the `Magnetic` row names)_
- https://adobe.fandom.com/wiki/Adobe_Photoshop_release_history
- https://www.computinghistory.org.uk/det/55601/Adobe-Photoshop-5-0

## `curvature-pen`

### What Photoshop's tool does

Click to place points; Photoshop fits the curve through them and keeps refitting as you add more, and
you push and pull whole segments to reshape it. "This tool makes curves with no bezier handles" — the
CC 2018 roundup's own summary, and the reason the tool exists. It is Illustrator's Curvature tool
brought into Photoshop, and the _Draw and edit vector paths and curves_ page is Adobe's own how-to for
it.

Introduced in **Photoshop CC 2018 (19.0)**, and this one is solid. Announced in September 2017 as a
sneak peek for the next release, shipped in CC 2018, and every tutorial published since says CC 2018 or
newer. The research corpus already had this right (it corrects an original claim of CC 2020) and I
re-derived it from four independent sources. The `Path Options` flyout — path thickness and color — is
the same CC 2018 release feature, and Adobe's forum has a user reporting that it is "not available in
previous releases", which dates it to CC 2018 as well.

The gesture set Adobe documents: double-click a point to switch it between corner and smooth, on a new
path or on one already drawn; click a point and press Delete to remove it; click anywhere on the curve to
add a point; `Esc` stops drawing.

Adobe documents **two modifiers** for this tool, and the data file's `modifiers` array was **empty**:
`Shift`-click constrains the path to 90° and 45° angles, and `Alt`/`Option` while clicking creates a
corner point — the same result as the documented double-click, which is why the second row is worded as
an equivalent rather than as a separate gesture
(`https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html`). Both are now
rows, and `Unverified` item 7 below is updated with the new sourcing rather than left to contradict it.

### Options bar

| Control                     | Photoshop detail                                        | Status    | appRef                                                   |
| --------------------------- | ------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `Mode`                      | Shape / Path / Pixels                                   | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Tool Mode")      |
| `Fill`                      | Fill color; Shape mode                                  | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Fill")           |
| `Stroke`                    | Stroke color; Shape mode                                | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Stroke")         |
| `Path thickness (Weight)`   | Path Options flyout: on-canvas path width               | `missing` | —                                                        |
| `Path color`                | The other half of the same flyout: on-canvas path color | `missing` | —                                                        |
| `Align Edges`               | Unavailable for this tool                               | `missing` | —                                                        |
| `Selection… / Mask / Shape` | Convert the already drawn path                          | `inert`   | `toolbarPlaceholderConfig.ts:23` (chip "Make Selection") |
| `Rubber Band`               | Live path preview                                       | `missing` | —                                                        |

No `Magnetic` and no `Curve Fit`: those are the Freeform Pen's, and the app's dead config entry for the
Curvature Pen lists them anyway (`toolbarPlaceholderConfig.ts:25`).

### Sources

- https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html
- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html
- https://helpx.adobe.com/photoshop/using/editing-paths.html
- https://www.photoshopessentials.com/basics/use-curvature-pen-tool-photoshop-cc-2018
- https://photoshoptrainingchannel.com/photoshop-cc-2018-tutorials
- https://www.creativebloq.com/news/photoshop-to-launch-new-curvature-pen-tool
- https://www.adobe.com/products/photoshop/pen-tool.html

## `add-anchor-point`, `delete-anchor-point`, `convert-point`

### What Photoshop's tools do

Adobe's `Drawing tools overview` gives the one-line definition of each, and the point worth keeping is
that all three are phrased against an _existing_ path: "Add anchor points to **existing** paths",
"Delete anchor points from **existing** paths", "Convert straight anchor point to curved and vice
versa". `editing-paths.html` states the precondition explicitly for all three — every procedure opens
with "Select the path you want to modify" — which is the whole reason they are separate Tools-panel
entries rather than modes of the Pen: with no path selected in the Paths panel they have no subject.
`editing-paths.html` also records that the Pen performs both of the first two on its own when Auto
Add/Delete is on, and that all three are reachable from the Pen with `Alt` held.

`convert-point`'s three-way gesture is Adobe's own, in full: corner → smooth by dragging away to make
direction lines appear; smooth → corner without direction lines by clicking; smooth → corner with
independent direction lines by dragging either direction point. "The smooth point becomes a corner
point" when you click the anchor point of a direction line.

### Why their options tables are empty

`editing-paths.html` and `drawing-tools-overview.html` between them document **no options-bar control
belonging to any of the three.** Selecting one of them shows the Pen group's bar, so every control
visible is the Pen's and none is these tools' own — which is exactly the case `types.ts:116-120` sanctions
an empty array for, and why the brief says an empty array "means so only with a one-line reason". The
reason is recorded there and the rows are inherited from the `pen` table above, where every control is
`inert` or `missing`; there is no control in this family that is `present`.

The app nonetheless renders the standard Pen's full seven-chip list on all three (`toolsMap.ts:163-173`),
so the app shows these tools options that are not theirs and lacks the one thing they do need: a Paths
panel to select a path in.

### Sources

- https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html
- https://helpx.adobe.com/photoshop/using/editing-paths.html
- https://helpx.adobe.com/illustrator/using/tool-techniques/pen-tool.html (for the Photoshop-vs-Illustrator converter-tool naming contrast)

## Unverified

Verbatim, and none of it is in the data file.

1. **The Pen tool's four `Mode` values as `Select / Add / Remove / Free`.** The brief asserted these.
   **Adobe documents no Select/Add/Remove/Free Pen mode in any product** — not Photoshop, and not
   Illustrator either, whose Pen page shows no `Mode` dropdown at all. Adobe's Pen settings page
   tabulates `Mode` as `Shape` / `Path` / `Pixels`, and a second Adobe page enumerates the same
   three. Add, Subtract, Intersect and Exclude do exist in Photoshop, but as **Path Operation**
   controls in the Pen's Path mode (`Add To Path Area`, `Subtract From Path Area`, `Intersect Path
Areas`, `Exclude Overlapping Path Areas`), not as a Pen `Mode`. An earlier version of this item
   attributed the quartet to Illustrator's Pen; that attribution is withdrawn, because it was
   itself unsourced in the same way the brief's version is. What is still genuinely unknown is
   where the quartet came from. Closest URLs:
   https://helpx.adobe.com/illustrator/using/tool-techniques/pen-tool.html (no modes listed) and
   https://helpx.adobe.com/ca/illustrator/desktop/draw-shapes-and-paths/learn-drawing-basics/drawing-modes-overview.html
   (turned out to document Illustrator's three _toolbar_ drawing modes, not the Pen's).
2. **`Minus Back` as a Photoshop path operation.** Not present in any Adobe page opened. Where the name
   comes from — the research corpus attributes it to Illustrator's Pathfinder, which I did not verify —
   is unverified. Closest: https://helpx.adobe.com/photoshop/using/paths.html, which lists the four
   operations Photoshop does have.
3. **A `Curvature` slider on the Curvature Pen.** **No control named `Curvature` appears in any
   Adobe page located**, and the documented bar is the Path Options flyout (path `Thickness` and
   `Color`, the thickness later named `Weight`) plus `Rubber Band`. That is a statement about what
   the sources contain, and it is deliberately weaker than "there is no `Curvature` slider",
   because it rests on absence-of-mention in pages that mostly do not enumerate the bar: nearly
   every "Curvature tool" page the crawler returns is **Illustrator's** tool, and a page that never
   lists a bar cannot establish what is not on it. Establishing the negative properly needs one
   Adobe page that enumerates the Curvature Pen's whole bar, and none was found. Closest:
   https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html and
   https://photoshoptrainingchannel.com/photoshop-cc-2018-tutorials.
   The **CC 2018 (19.0) introduction date is not part of this item** and remains properly sourced
   from four independent sources; it is untouched.
4. **`Magnetic` as a snapping-_strength_ control on the Freeform Pen.** It is a checkbox. The
   strength controls are the same `Width` / `Contrast` / `Frequency` / `Stylus Pressure` that
   Adobe documents for the Magnetic Lasso, and the data file says exactly that — that the
   Freeform Pen uses those same controls — rather than asserting that the two tools share one set
   of settings, which is an inference from the Lasso's documentation rather than a statement about
   the Freeform Pen's own flyout. The Lasso page that names those four controls is now in the
   record's `sources`, which settles the **provenance** of the claim; what is still unverified is
   the flyout itself, because no Adobe page documents the Freeform Pen's own `Magnetic` flyout.
   Closest: https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/snap-to-image-edges-using-magnetic-lasso-tool.html.
5. **`Align Edges` for the Freeform Pen and the Curvature Pen.** Listed as a control with status
   `missing` in both tables, so no status depends on the behaviour — but the behaviour itself is
   third-party only for the Freeform Pen
   (https://glensmith.co.uk/photoshop/freeform-pen-tool: "This option is not available while using the
   Freeform Pen Tool") and corpus-only for the Curvature Pen. No Adobe page opened names `Align Edges`
   in the pen family's bar at all.
6. **Every Freeform Pen modifier.** `Alt` as a temporary standard Pen, releasing `Alt` mid-drag to
   resume freeform, `Enter` ending an open path, `Alt`+double-click closing with a straight segment,
   double-click closing with a magnetic segment, and dragging back to the start point to close. All
   corpus-and-third-party; none appears on an Adobe page I opened, and the corpus's own citation [93] is
   a third-party tutorial. `modifiers` is therefore empty rather than populated with folklore.
7. **The Curvature Pen's `Shift` behaviour** — the exact constraint it applies. The **row** is no
   longer corpus-only: the `Shift` and `Alt`/`Option` modifiers on the `curvature-pen` record are
   carried by Adobe's own curvature-tool page
   (`https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html`, cited
   verbatim in the finding this revalidation applied), and that page is already in
   `CURVATURE_SOURCES`. What is still open is the _detail_ — whether the constraint is 90°/45° exactly
   as stated, or Adobe's shorthand — because that page could not be re-opened during this pass
   (Adobe returns 403 to this fetcher) and the sentence is carried on the citation rather than on a
   fresh reading.
8. **The Pen tool's introduction version.** It is present in every Photoshop release list opened, back
   to 1.0 (February 1990), but no Adobe page states that it shipped in 1.0. Not established.
9. **The Add / Delete / Convert Anchor Point tools' introduction version.** Not established. No Adobe
   or third-party source found; they predate Creative Cloud but I cannot date them.
10. **The Pen `Mode` group's default.** Adobe's Pen settings page does not state one. Third-party
    tutorials say the Pen defaults to `Shape`. Omitted from the data file rather than attributed.
11. **The 2026 pixel order of the Pen family's bar.** Every control's existence is sourced; the exact
    left-to-right sequence is not, the same gap the research corpus records for the Type tool. The data
    file lists controls in the order Adobe's own mode-by-mode documentation gives, not in bar order.
12. **Whether the two handles a `corner → smooth` drag produces are exactly collinear and equal at the
    moment of the drag.** Adobe states only that dragging away from a corner point "make[s] direction
    lines appear". The brief's phrase "the Convert Point Tool's automatic handles" is therefore rendered
    as the sourced gesture, not as a claim about handle geometry.
13. **That a path is "hidden" from the canvas — now closed, do not re-raise it.** This item used to
    warn that the data file's "stays invisible until…" was a paraphrase, because Adobe never uses
    the word hidden. Both halves of that are now settled: the paraphrase is **gone** from the data
    file, and the sourced statement has been found. `https://helpx.adobe.com/photoshop/using/drawing.html`
    says what Path mode produces and what it is for: "Draws a work path on the current layer that you
    can then use to make a selection, create a vector mask, or fill and stroke with color to create
    raster graphics (much as you would using a painting tool). A work path is temporary unless you
    save it." Adobe never needed the word "hidden" — a work path drawing nothing on the canvas is
    what "a work path" means, and the page says what the work path does instead. The data file now
    reads "Path mode creates a work path in the Paths panel, which draws nothing on the canvas and
    can be stroked, filled or loaded as a selection later", which is that sentence rendered, and no
    longer mixes operations on a work path with operations from one.
14. **Pen history granularity** — one history state per completed path rather than per anchor. A corpus
    claim I did not re-verify. Deliberately not in the data file.
15. **The Pen's Pixels-mode options bar.** The `pen` record reaches Pixels mode and says what it
    produces, but no Adobe page enumerates the controls that mode's bar contains. Adobe's one
    enumeration of Pixel-mode options — `Mode` (blend mode), `Opacity` (1–100%) and `Anti-alias` —
    carries the scope line "When using the Line tool or other shape tools"
    (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html`),
    and the Pen settings page
    (`https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html`)
    confirms the Pen _has_ a Pixels mode without ever listing what that mode's bar holds. So the three
    controls are **not** invented as rows, and `pen`'s `appNotes` now states in prose that the options
    table is the Shape and Path mode bar and that nothing above describes Pixels mode. Closing this needs
    an Adobe page that enumerates the Pen's whole Pixels-mode bar.
