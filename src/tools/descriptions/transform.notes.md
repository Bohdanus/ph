# TRANSFORM family — research notes

`reposition`, `transform`, `levels`, `color`. Data half: `src/tools/descriptions/transform.ts`.

## What this family is

Three of these four are Photoshop **tools** in the sense the rest of this file assumes, and
three of these four are not. The `transform`, `levels` and `color` registrations occupy toolbar
slots that Photoshop's toolbar does not have. That is not an error in this app — a browser
editor with no menu bar needs somewhere to hang a command — but it does mean three of the four
`photoshopName` values are not "Adobe's name for the tool, verbatim from the Tools panel",
because there is no Tools-panel entry to quote. They say so in the string itself rather than
papering over it, which is why they read the way they do.

**The trailing "Tool" in those three strings is a historical constraint, not a style choice, and
an adversarial review asked for it to be removed. It was left in place, deliberately.** The
premise is correct — the assertion that forced the ending has gone, and
`src/tools/descriptions/__tests__/toolDescriptions.test.ts` no longer constrains the string in any
way. Three reasons not to change it here. The strings are not contortions: "Levels — the
`Image > Adjustments` command, not a Tools panel Tool" is an accurate, informative sentence, and
the capital `T` is what distinguishes Photoshop's own "Tool" from the app's generic tile label. And
the three strings are **consumed by a generated artifact outside this family's ownership**:
`docs/TOOLS.md` prints them verbatim, and the
`it('writes docs/TOOLS.md exactly as the generator produces it')` case in
`scripts/__tests__/tool-descriptions.test.mjs` byte-compares that file against the generator's
output, so editing the string without regenerating the doc is a failing test rather than a tidy-up.
`docs/TOOLS.md` has to be regenerated for the substantive edits in this pass anyway, so if the
coordinator wants the wording changed it should be changed there, once, deliberately — not as a
side effect of a prose fix.

The two command-not-tool claims, verified independently. **Both are now led by a negative, and a
complete version-stamped Tools-panel enumeration is a far better citation for a negative than a
menu-path argument**, so each is stated from the inventory first and the menu routing second.

- **Two complete Tools-panel inventories contain no Free Transform tool.** `https://glensmith.co.uk/photoshop/tools`
  is stamped twice — "every tool in the Photoshop 2026 toolbar" and a "Page updated: 21 September
  2026" line — and enumerates the whole bar in toolbar order (Move, Artboard, the marquees,
  Selection Brush, the lassos, Object Selection, Quick Selection, Magic Wand, Crop, Perspective
  Crop, Slice, Slice Select, Frame, Eyedropper, Color Sampler, Ruler, Note, Count, the retouching and
  painting group, the pen family, the type tools, Path Selection, Direct Selection, the shape tools,
  Hand, Rotate View, Zoom). There is no Transform entry, and no Transform-derived entry under any
  other name. `https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview` is the
  second, and says of itself that it is "a complete summary of the nearly 70 tools available in
  Photoshop"; it also has none.
- **Free Transform is reached as a command (`Edit > Free Transform`, `Cmd+T`).**
  `https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html` — "Choose
  Edit > Free Transform." and, in the very next bullet, "If you are transforming a selection,
  pixel-based layer, or selection border, choose the **Move tool**. Then select Show Transform
  Controls in the options bar." Adobe's own routing sends a pixel layer to the **Move** tool, which
  is the strongest available positive evidence that the transform state has no tool of its own.
  Corroborated by `https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html`, which
  does say "Select the Move tool (V)" — the Tools-panel phrasing Free Transform never gets.

  **The menu path was wrong in the data file and is corrected in this pass: Free Transform is a
  top-level `Edit` item, not an entry under `Edit > Transform`.** The two are different items and
  Adobe's Feb 2026 reference point page keeps them apart in one sentence: "Select **Edit >
  Transform** and select a transformation type, or select **Edit > Free Transform** to apply
  multiple transformations"
  (`https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html`).
  `Edit > Transform` is the submenu of the six **single** modes — "Scale to resize, Rotate to turn,
  Skew to slant, Distort to stretch, Perspective to shift depth, Warp to bend and curve freely"
  (`.../apply-transformations.html`) — and only the last sentence of that list overlaps Free
  Transform. The data file's `photoshopName` and `appNotes` both said `Edit > Transform > Free
Transform`, a path Adobe does not have.
  - **The counter-sentence, and why it does not carry.** Adobe's own marketing copy on
    `https://www.adobe.com/products/photoshop/resize-image.html` says "Select the Transform tool by
    pressing Ctrl + T (Cmd + T for Mac)." That is the sentence a hostile reviewer will find, so it
    is named in `appNotes` rather than left for them. It does not survive the same paragraph: the
    next clause of the same page is "You can also go to Edit > Free Transform." The page names the
    menu route itself, uses "tool" for the interactive state rather than for a Tools-panel entry,
    and is marketing copy rather than an enumeration. The enumeration is the primary citation
    because it is the one that can be wrong; a sentence about a shortcut is not.

- **Levels and Black and White are `Image > Adjustments` commands (or adjustment layers), not
  tools.** The same two inventories carry the negative, which is what a negative needs:
  `https://glensmith.co.uk/photoshop/tools` and
  `https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview` each list every
  Tools-panel entry and neither has a Levels or a Black and White tool in it. The positive half is
  `https://helpx.adobe.com/photoshop/using/color-adjustments.html`, which enumerates them under
  the heading "Color adjustment commands" — "Levels command", "Color Balance command",
  "Hue/Saturation command" — and says presets are applied "using an adjustment layer";
  `https://helpx.adobe.com/photoshop/using/levels-adjustment.html` gives the two routes: "In the
  Adjustments panel, click the Levels icon or choose Levels from the panel menu", and
  `https://www.adobe.com/learn/photoshop/web/photoshop-improve-tones-levels` gives the other
  half: "The first step is to add a Levels adjustment layer so you can apply levels
  nondestructively."

A fifth correction fell out of this pass and is folded into the data file: **`X` is not the reset
key for Black and White.** Adobe's documented route is a control: "To return the adjustment to its
original settings, click the Reset button"
(`https://helpx.adobe.com/photoshop/using/color-adjustments.html`), and the Black and White page
names "reset icon" as the way back to the sextant defaults
(`https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html`).
`X` in Photoshop's default key map swaps foreground and background colors. The brief's request to
describe "how the preview and the `X` reset work" therefore produced a `Reset` row instead, and
the `X` claim is in `## Unverified`.

A sixth: **the Move tool's duplicate modifier is one key, not two.** The brief asked about
"`Cmd`-dragging to duplicate (and the difference between it and `Alt`-dragging on the Windows
convention)". Adobe prints a single modifier as a Windows/macOS pair — "Move copy of selection —
Move tool + Alt-drag selection / Move tool + Option-drag selection" — so it is Alt on Windows and
the same physical key, Option, on macOS; there is no separate `Cmd` form. In Free Transform the
duplicate is a command, `Cmd+Option+T` / `Ctrl+Alt+T`
(`https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html`,
last updated Feb 2026). The `Cmd`-drag form was not found in current Adobe documentation and is
in `## Unverified`.

## Cross-cutting, stated once: tool options are sticky, not factory

Every one of these four tools in Photoshop keeps whatever options you last left it with. Selecting
the Move tool after the Brush tool does not give you the Move tool's shipped options; it gives you
the Move tool's options as you last left them, per tool, which is why Photoshop needs an escape
hatch at all. The escape hatch is the **Tool Preset Picker** at the far left of the options bar —
the tool icon and its flyout arrow. Clicking it lists that tool's saved presets;
Control-clicking it (Command-clicking on macOS) opens a two-item menu, **Reset Tool** and
**Reset All Tools**, which return one tool's or every tool's options to their defaults
(`https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html`,
which names the control "officially called the Tool Preset Picker"; the Reset All Tools wording is
Scott Kelby's and HowToGeek's). Julieanne Kost's framing of the same fact is the most useful
sentence anyone has written about it: the spring-loaded trick "is a great way to trouble-shoot and
reset a tool if perhaps the tool's blend mode, feather, or other option was changed the last time
you used it" — which only makes sense if the state is per-tool and persistent.

**The app matches Photoshop on the stickiness.** `_setToolArgs()` in `useCurrentTool.tsx` calls
`saveLastSettings` on every argument write and `cloneSavedToolArgs()` in the same file reads
`lastSavedSettings[toolName]` back, so a tool's sliders are exactly where you left them when you
switch away and return. That is a genuine match,
and it is worth saying so rather than only listing absences. What the app lacks is
the _reset hatch_: there is no Tool Preset Picker, and no per-tool reset outside the three
adjustment panels that carry their own Reset button. So a tool can get into a state Photoshop would
let you escape in one click, and the app offers no equivalent.

The related keyboard fact belongs to `reposition` and is recorded there, not here: Photoshop's tool
letters are **spring-loaded** — `Preferences ▸ Tools ▸ Spring-loaded Tool Shortcuts`, on by
default, and holding `V` borrows the Move tool for one gesture before releasing returns
(`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html`,
last updated Feb 23 2026). **That page also prints the timing, which an earlier version of this
file said it did not**: "Drag the slider to adjust the delay time. A shorter delay means the tool
switches faster when you press the key. **The default is 200 milliseconds.**" So the 200 ms is
Adobe's, not the third-party figure it was previously filed as
(`https://photoshopguides.github.io/Tools`, "Leaving the sensitivity at the default 200
milliseconds"). **The number still is not in the data file**, and that is a separate decision from
whether it is sourced: the `V` row describes the gesture, and a preference's delay is not part of
what the key does. In this app the `shortcut` field on a toolbar entry is **display-only and
binds nothing**: its only two consumers in all of `src/` are both inside `renderToolGroup()` in
`SidebarLeft.tsx` — the `shortcut` prop it passes to `ToolTooltip`, and the `<kbd>` badge it
renders on the flyout row. (Both citations were wrong in the previous version of this file — the
first was a comment inside the `railLayout` block and the second the start of `closeFlyout`; a
`grep -rn "\.shortcut\b"` over `src`, `e2e` and `toolbar-mapping.ts` confirms those two are the
whole set.) The app does implement letter-key activation, but from a separate hand-written table in
`AppKeyboardShortcuts.tsx` where `V` is a `useKeyDownShortcut` registration whose handler is
`() => goToTool('reposition')` — and that registration has no keyup half, so
there is no spring-loaded behaviour to have, and therefore no delay to configure.

## `ctx.filter` — the string, and which canvas it lands on

The research corpus dated 2026-09-26 called a `ctx.filter` implementation a shipping blocker.
**One thing about it changed, one thing was never true, and one is unchanged.**

Changed: the template is not copied. `buildColorsFilter()` and `buildLevelsFilter()` in
`src/tools/functions.ts` own the two filter strings, and every consumer routes through them, so
there is one string per tool rather than several that could drift.

**Never true, and this is the correction that matters: the `OffscreenCanvas` processors are not on
the editing, preview or commit path for `levels` or `color`.** Both are registered
`commit: 'layer-operation'` (the `color` and `levels` entries of `toolProcessors` in
`src/tools/toolProcessors.ts`), and the `commit: 'layer-operation'` branch of `tempUpdateLayer()`
in `src/contexts/useLayer.ts` handles that kind by appending an operation to the layer's
`operations` array, nulling `tmpCanvas` and **returning** — the append being that branch's
`createLayerOperation` spread — while the `processor.imageProcessor(...)` call further down the
same function is past that return, and nothing in the editing path reaches it. Undo and redo
take the same route (the `commit: 'layer-operation'` branch of `replayHistory()` in
`src/contexts/history-replay.ts`, which appends the same operation
and continues), so a committed Levels or Colors adjustment is **retained, not destroyed**: the
layer's own bitmap is never touched, the renderer re-derives the filter from the operations array
on every frame (`drawLayerSource()` in `src/contexts/layer-renderer.ts`), and no raster of the
adjustment is stored anywhere. The earlier text in this file called this "the destructive half (research decision D3)"
and described a Safari-inert write on the editing path; both were wrong, and the destructive claim
was the most user-damaging sentence in the family — it told a user their pixels were gone when
they are not. **Every `useLayer.ts` line number in the previous version of this paragraph was
drifted**: it cited the wrong place for the `commit: 'layer-operation'` branch, and the wrong place
for the `imageProcessor` call.

**What the editing path actually uses is an ordinary canvas element.** `drawLayersToCanvas()` in
`src/contexts/layer-renderer.ts` builds a staging canvas with `document.createElement('canvas')`
and `drawLayerSource()` in the same file assigns `ctx.filter` from `getLayerFilter(layer.operations)`
on that `HTMLCanvasElement`'s 2D context. The document canvas itself is an `HTMLCanvasElement` (the
`canvasRef: RefObject<HTMLCanvasElement | null>` field of the context value in
`src/contexts/StoreContext.tsx`, declared as `useRef<HTMLCanvasElement | null>`).

Unchanged, and now correctly scoped: the `OffscreenCanvas` surface is the **durable materializer**
only. `createCanvas()` in `src/contexts/materialization.ts` prefers `new OffscreenCanvas(...)`
wherever one exists, and `filterForOperation()` applies the same string there — the materializer
reaches it through `evaluatePresentation()` in `src/contexts/presentation-evaluator.ts`. The
`OffscreenCanvasRenderingContext2D.filter` support Safari has never shipped is therefore a property
of that surface, not of the canvas the user is editing on. Note also that **no module outside
`src/contexts/__tests__/` imports `materialization.ts`** — the durable document is a shadow, and
that materializer is currently reached by its own tests only. The `levels` processor in
`src/tools/levels.ts` and the `colors` processor in `src/tools/colors.ts` still build the same
string into an `OffscreenCanvas` 2D context, and both are unreached processors for these two
commit kinds; they are cited in the data file because
they are the registered processors, not because editing runs them.

**The Brightness mapping, stated exactly, because the old note had it inverted.** The re-anchored
exponential in `expAdjustment()` (`src/tools/functions.ts`) is a table, and the table is:

| `val`  | factor | emitted  |
| ------ | ------ | -------- |
| `-100` | `0`    | `0%`     |
| `0`    | `1`    | `100%`   |
| `+100` | `> 1`  | `> 100%` |

So **0 is the neutral**, emitting exactly `brightness(100%) contrast(100%)`, and it is the
**minimum** of −100 that emits `brightness(0%)`. The
`it('emits the neutral as brightness(100%) contrast(100%)')` and
`it('reaches black: -100 brightness emits brightness(0%)')` cases in
`src/tools/__tests__/functions.test.ts` pin both literals by name. `defaultSettings.levels` is
`{ brightness: 0, contrast: 0 }` (the `levels` entry of `defaultSettings` in
`src/tools/settings.ts`), so the panel at rest applies nothing.

The test harness defect the corpus also flagged **is** fixed. The `filter` data property in
`createMockCanvasContext()` (`src/test/setup.ts`) replaces
the old swallowing setter with a real data property, with the reason in the comment — a getter
that always returned `''` made every assertion about filter application assert nothing. The
emitted string is now observable, and `src/tools/__tests__/functions.test.ts` pins the exact
literals for both tools. What the mock still cannot do is rasterize: the globally installed
context has no read-back at all (the `createPixelCanvasContext()` doc comment in
`src/test/setup.ts`), and that opt-in pixel context's `getImageData` returns a zero-filled array.
So the string is pinned and the pixels are not.

Net for the descriptions: `levels` and `color` are `partial`, and the divergence recorded for each
is not "the app has fewer controls" but "the app has a different engine in a different color
space, on a surface that is a plain canvas element rather than the `OffscreenCanvas` the durable
shadow would use".

## Census

| tool         | options rows | present | partial | inert | missing |
| ------------ | ------------ | ------- | ------- | ----- | ------- |
| `reposition` | 9            | 0       | 2       | 0     | 7       |
| `transform`  | 13           | 0       | 6       | 0     | 7       |
| `levels`     | 12           | 0       | 1       | 0     | 11      |
| `color`      | 7            | 0       | 1       | 0     | 6       |

**No status changed in this pass, and three summaries did.** `reposition` keeps 9 rows at 2
`partial`, `transform` 13 at 0 `present` / 6 `partial` / 7 `missing`, `levels` 12 at 1 `partial`,
`color` 7 at 1 `partial`; every `partial` and `missing` was re-derived against
`src/tools/settings.ts` and the four `ToolbarsRight` panels rather than carried over, and none of
them moved. The summaries were rewritten because each asserted something the source does not say.
`transform`'s read "scales, rotates, skews, distorts, **warps or tilts** a layer in one continuous
**drag** on its bounding box": "tilts" is not a Photoshop transform term (the six are Scale, Rotate,
Skew, Distort, Perspective, Warp), a Free Transform is one continuous **operation** and not one
drag, and perspective was missing. `color`'s said "six **independent** hue-sextant sliders" —
Photoshop's mix is a weighted mix, and "independent" reads as mutually exclusive; and `levels`'
buried the output levels, which are two of its twelve rows. All three are now inside 140 characters.

`reposition` is 9 rows again: the `Align to` row was removed in an earlier pass and is **back**.
The removal was made on a false negative — the `Align` row carried the claim that "no Adobe page
names a bar control for making it", and that is exactly what this pass falsified. See "The align
buttons" below for the three sources that put the control in the bar, and for why the row now
describes two targets rather than the four the removed version claimed.

**`reposition` has two `partial` rows, and they are `partial` on a behaviour, not on a control.**
`Auto-Select` and `Show Transform Controls` have been through both wrong answers. The first pass
filed them `partial` on the strength of the _behaviour_ each describes — the tool does hit-test to
the layer under the pointer, and the shared `useRect` overlay does draw corner handles on the
active layer — without noticing that the behaviour is _unconditional_, which is the whole point.
A later pass then swung both to `missing` on the reading that the app does not render them. That
is the opposite error, and the contract settles it: `types.ts` names "a control welded to one of its
states" as an explicit marker of `partial` on the `implementation` value, and the
`it('describes every control with a real status and a reference wherever one exists')` case in
`src/tools/descriptions/__tests__/toolDescriptions.test.ts` only withholds the `appRef`
requirement from a `missing` row. A checkbox that is permanently on is a behaviour the app has and
the user cannot turn off, which is a divergence from Photoshop's default, not a capability the app
lacks. Both rows are therefore `partial` again.

The Move options bar renders three items (`src/components/ToolbarsRight/Move/Reposition.tsx`: the
active layer's name, a Merge all button and a hint), and a search of `src/` and `e2e/` for
`auto-select` / `autoSelect` / `showTransformControls` finds no control anywhere — the only matches
are this family's own prose. So there is no _control_ to cite, and the `appRef` on each row is the
behaviour the app performs instead: `MoveToolArea.tsx` — `handlePointerDown()`, at the
`layerUnderPointerId` hit test that resolves and activates the layer under the pointer, and
`MoveToolArea.tsx` — at the `useRect({ isMoveTool: true })` call that draws
the handles. `appNotes` says so on the record, because an `appRef` that is not a rendering of a
control is otherwise indistinguishable from a mis-derived one.

**`levels` lost two `partial` rows in this pass too, and the census above follows the data file.**
The per-tool table in "## `levels`" below previously marked `Input Levels: black point` and
`Input Levels: white point` as `partial` against the Brightness and Contrast sliders. The data file
has both as `missing`, which is the correct reading — the app's Brightness slider is not Photoshop's
black point, and its Contrast slider is not the white point, so neither row is a control that exists
and diverges. The table below is corrected to match.

No row is `inert`. `inert` is for state declared in `src/tools/settings.ts` and rendered by no
component, and all four of these tools' declared state is read by a component that renders it — the
`color`, `levels`, `transform` and `reposition` entries of `defaultSettings` in
`src/tools/settings.ts` each back a control that exists.
The interesting result is the other direction: `levels` and `color` have
**zero** `present` rows, which is the honest reading — the app's Levels panel shares no control
with Photoshop's Levels, and its Colors panel shares none with Black and White.

## `reposition` — Move Tool

The one real tool in this family, and the one where the app is closest on the thing that matters
(dragging content) and furthest on everything the bar exists for. Adobe's own page for the tool is
five lines long and names three things: `V`, "Click on an element—like a layer, selection or
artboard—to move it", and "Use the Options bar to customize tool settings, like **Alignment and
Distribution**, to get the effect you want." Everything else in the bar has to be read out of the
align, transform and keyboard pages, which is why half of this tool's rows are sourced from pages
about other features.

| control                    | what it is in Photoshop                                                                                                                       | status  | appRef                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------ |
| Tool Preset Picker         | Tool icon + flyout at the far left; Control-click for Reset Tool / Reset All Tools. The escape hatch from per-tool stickiness                 | missing |                                                                                |
| Auto-Select                | Checkbox; resolves the target by hit test to the topmost layer with pixels under the cursor, rather than moving the active layer              | partial | `MoveToolArea.tsx` — `handlePointerDown()`, the `layerUnderPointerId` hit test |
| Auto-Select: Group / Layer | Menu beside the checkbox: Layer takes the individual layer, Group takes the whole group it belongs to                                         | missing |                                                                                |
| Show Transform Controls    | Checkbox that puts the transform box and handles on the selected layer _without_ entering transform mode; dragging a handle is what starts it | partial | `MoveToolArea.tsx` — the `useRect({ isMoveTool: true })` call                  |
| Align                      | Six buttons at 2+ selected: Top Edges, Vertical Centers, Bottom Edges, Left Edges, Horizontal Centers, Right Edges                            | missing |                                                                                |
| Distribute                 | The distribute row at 3+ selected: the same six commands to space layers evenly, plus the Horizontally and Vertically spacing buttons         | missing |                                                                                |
| Align to                   | Selection or Canvas — the control that chooses what the six align buttons align to, reached from the three-dot More control                   | missing |                                                                                |
| Width                      | Numeric percent text box for layer width, with the Link icon on by default since 21.0                                                         | missing |                                                                                |
| Height                     | Numeric percent text box for layer height, linked to Width                                                                                    | missing |                                                                                |

**Show Transform Controls** is the row that is easiest to get backwards, and the row that this pass
corrected. The _Photoshop_ formulation is the one to keep: checking the box does _not_ start a
transform, it puts the handles on the layer, and the transform starts when a handle is dragged.
That is exactly why it exists — it is how you scale and rotate a layer without entering `Cmd+T`,
and Adobe's Free Transform page reaches the same state the long way round ("choose the Move tool.
Then select Show Transform Controls in the options bar").

The **app** renders no such checkbox, so the behaviour is welded on and the row is `partial` on
that, not on a control it can point at. It was previously `partial` on the reasoning that "the
overlay and its handles do render (`MoveToolArea.tsx` — the `useRect({ isMoveTool: true })` call)"
— which conflates the control with the overlay,
and then a later pass swung it to `missing`, which is the opposite error: `types.ts` names
"a control welded to one of its states" as a `partial` marker, and a row whose behaviour is
permanently on is not a capability the app lacks. What renders in that same place
(`MoveToolArea.tsx` — the `useRect({ isMoveTool: true })` call) is a **plain resize rectangle** on
whichever layer is active, unconditionally: no checkbox gates it, so the citation is the behaviour
and not a control, and that is what the row's `appRef` names. It is a resize rect — no rotation outside the box, no
numeric W/H, no reference point. The geometric half of the tool is gone, and with it the two
things `Cmd+T` and Move are supposed to share. **Auto-Select** is the same shape and is argued at
length further down: the `layerUnderPointerId` hit test in `handlePointerDown()` always runs, and
its `appRef` is that call for the same reason.

**The align buttons** are where the pre-existing corpus had a single row of widget names and no
behaviour, and the behaviour is the interesting part:

- They are **the same commands as the `Layer > Align` submenu**, in the same order, with the same
  per-command semantics: "Left Edges aligns the left pixel on the selected layers to the left pixel
  on the leftmost layer", "Vertical Centers aligns the vertical center pixel on each selected layers
  to the vertical center pixel of all the selected layers", and so on for the six
  (`https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html`).
- They are **gated on selection count**: two or more for align, three or more for distribute, which
  is why the row is greyed out with a single layer — "there's not much point trying to align or
  distribute a layer with itself"
  (`https://www.photoshopessentials.com/basics/layers/align-layers`, third party).
- The distribute row has **two members beyond the six**, Horizontally and Vertically, which space
  the gaps rather than the centres (same Adobe page; the two-button current form is described at
  `https://design.tutsplus.com/tutorials/how-to-auto-align-in-photoshop--cms-40982`, third party).
- The **target is separate from the command, and the bar DOES express the choice**. Adobe splits it
  as two submenus, `Layer > Align` (align to the selected layers) and `Layer > Align Layers To
Selection` (align to a selection border), and then says "These same commands are available as
  Alignment buttons in the Move tool options bar" — which is the sentence that ties the menu to the
  bar. **An earlier pass in this file read that sentence as saying the opposite and removed the
  `Align to` row on the strength of it. That reading was wrong, and four sources now name the bar
  control outright:**
  - Julieanne Kost's Adobe blog, with the Move tool active: "To align layers based on the canvas,
    click the More icon (the three dots) to choose Canvas" — More is in the options bar and the thing
    it opens is the target.
    `https://jkost.com/blog/2021/10/align-and-distribute-layers-in-photoshop.html`
  - The same post shows the target control being shared with distribute: "click the More icon (the
    three dots) in the Options bar and click the Distribute Horizontal Centers icon".
  - A second, independent walkthrough names the control in both of its states: "click on the three
    dots found in the Options Bar … That is until you change the **Align To** option to Canvas",
    and "leave the **Align To** option set to **Selection**".
    `https://www.bwillcreative.com/the-move-tool-in-photoshop/`
  - An Adobe Community thread reports the Selection default as a user-visible fact rather than as a
    documented one: "the alignment is set to 'Selection' and not 'Canvas'".
    `https://community.adobe.com/questions-712/move-tool-align-to-canvas-by-default-1171406`

  **The row names two targets, Selection and Canvas, not the four the removed version listed.** The
  four-way version (Selection / Canvas / Layer / Group) came from the third-party
  `https://www.photoshopbuzz.com/how-to-align-layers`, which is not among the four sources above and
  which no Adobe page corroborates; Selection and Canvas are what all four do name, so that is what
  the row says. **Bar position is a judgement call and is labelled as one:** the sources put the
  target behind the three-dot More control at the right of the alignment group, and the row is
  written there. What none of them settles is whether More is a single shared control or one per
  group, so do not re-derive an exact position from this paragraph.

- **The Alignment-buttons sentence was read on mirrors, not on Adobe's own host, and the omission
  of the modifier bindings is deliberate.** `https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html`
  answers `webfetch` with HTTP 403. The verbatim sentence "These same commands are available as
  Alignment buttons in the Move tool options bar" was read on five independent mirrors of that
  localized page, which is why it is quoted at all; the `Layer > Align` / `Layer > Align Layers To
Selection` split comes from the same source. Because the page is Adobe-authored but unreadable at
  its Adobe URL, nothing on it is treated as establishing a **binding**: `modifiers` carries no
  `Shift` and no `Alt` row for the align buttons, and that absence is a sourcing decision, not an
  oversight. Do not "fix" it by guessing a modifier.
- **A group aligns as a single object.** Selecting three layers and aligning their horizontal
  centers stacks them on one axis and destroys the spacing you built; grouping first is what
  preserves it, because a group aligns as one unit. This is the most common way the align buttons
  are used wrongly, and it is why the `Group` mode of Auto-Select matters more than it looks.
- **A locked layer greys the row out** rather than moving: "if I select the background layer which
  is locked the align and distribute options are greyed out"
  (`https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignment-with-a-reference-layer`,
  third party, a direct observation). Adobe's own statement of the constraint is "Lock Position:
  Prevents the layer's pixels from being moved"
  (`https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html`). The app's
  `locked` flag is never consulted by the Move path at all.

**Auto-Align is not this tool's control.** The corpus listed an "Auto-Align dropdown" in the Move
bar, and there is a real Auto-Align in Photoshop, but it is `Edit > Auto-Align Layers` — a
**command** with a dialog, not a dropdown in the options bar. It aligns layers by **content**:
"Use Auto-Align Layers to automatically align multiple layers based on similar content in different
layers, such as corners and edges", with a Projection choice of Auto, Perspective, Cylindrical,
Collage and Reposition Only, and either a reference layer you nominate — **created by locking it** —
or one Photoshop picks for you ("the one at the center of the final composition"). That is
panorama and stack-stitching technology, and it is a categorically different operation from the
geometric align buttons that share the Move bar. The app has no equivalent of the command, so the
row is neither present nor missing in the bar: it does not exist there to miss.

**History grain.** One completed move is one history state, by the general rule: "Each change you
make, like selecting, painting, or rotating, is recorded separately" and "Each change is
automatically recorded as a separate history state". The data file says "a single drag is a single
undo step" and stops short of naming the state, because the specific label is unsourced. What
happens on a refusal is the better-sourced half: the layer does not move and the align and
distribute controls go grey rather than Photoshop attempting the move and raising a dialog. **That
last half is the one that is wrong in this app**, and it is what the section below corrects: the
layer does not move, but nothing raises a dialog either.

**The keyboard.** `V` is a Photoshop tool shortcut and it is spring-loaded, so it is two behaviours
in one key: tap to select, hold to borrow the tool until you release. The app binds `V` for
selection only, and has no keyup handler to return from. The badge is not what binds it either —
`shortcut` is display-only in both the tooltip and the `<kbd>`, and the real binding is the
hand-written table. Modifiers, all sourced:

| keys                           | action                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `Alt` (Win) / `Option` (macOS) | drag a duplicate of the layer or selection, leaving the source in place                                           |
| `Shift`                        | constrain the drag to one axis                                                                                    |
| `Shift`                        | click a layer to add it to the selection; adjacent layers need Shift-click, noncontiguous need Ctrl/Command-click |
| `Arrow keys`                   | nudge the active layer 1 px when nothing is selected on it, or the selection 1 px when there is                   |
| `Shift+Arrow keys`             | nudge 10 px                                                                                                       |

The Shift modifier on the **align buttons** — the one the addendum flags as most commonly
mis-described — is **not** asserted in the data file. Adobe sources the two _commands_
(`Layer > Align` and `Layer > Align Layers To Selection`, same page, and the same sentence saying
they are the bar's buttons) but never says which modifier selects which. The `Alt`-duplicates-the-
layer variant on the align buttons is likewise unsourced. Both are in `## Unverified` with the URLs
that come closest.

**The locked-layer claim was inverted, and this is the correction that matters most in this file.**
It previously said the app "does not consult the locked flag that its own layer model carries, so a
layer marked locked is still draggable", and called the flag "a PSD round-trip field rather than an
editing constraint". **Both sentences are false against the current tree.** `isLayerLocked()`
(`src/contexts/useLayer.ts`) is the guard, its own doc comment states what the flag means —
"this layer's PIXELS and POSITION may not change" — and it is checked in `updateLayerByTool()`,
above every commit kind, on the commit path, and in `tempUpdateLayer()`, above every commit kind,
on the preview path.
`savePsd()` in `src/contexts/psd-utils.ts` writes `locked` back out as composite **and position**
protection, so a layer a PSD protected cannot be dragged or resized by the Move tool. **The app
refuses exactly what Photoshop refuses.** The guard's own sentence "Nothing consulted it" is the
historical note of the bug the guard was added to fix; the guard is there now.

What survives, and is the real (smaller) divergence, is **reachability and feedback** rather than the
refusal. **No panel renders a lock control**, so the flag only ever arrives on a layer imported from
a PSD — the user cannot set it in the app. And the refusal is **silent**, where Photoshop names the
lock (see Unverified #8). The Move path's second refusal is unrelated to `locked`: a press on a
bedrock layer is dropped and the selection cleared (the `layer.isBedrock` branch of
`handlePointerDown()` in `MoveToolArea.tsx`), which is the app's
stand-in for the background layer Photoshop will not move.

**Implementation: `partial`.** This section previously said `implemented` and the data file says
`partial`; the data file is the contract and the note was stale. The gesture itself is a single
committed history entry — the `onChangeEnd` callback in `MoveToolArea.tsx` calls
`updateLayerByTool` once on change-end (the `tempUpdateLayer` call an earlier version of this file
cited is the transient preview, and the two are not the same call), and `reposition` in
`src/tools/reposition.ts` returns `[bitmap, move]` without rasterizing, so a move is a position
patch and nothing is resampled. The `reposition` entry of `toolProcessors` in
`src/tools/toolProcessors.ts` declares `commit: 'geometry'`, which is the right kind for a tool
whose output is a rectangle. What holds it back from
`implemented` is the one overlay the app does draw: it renders a resize rect where Photoshop renders
a transform box, which is a control that contradicts Photoshop rather than one that is merely
absent. Every _absent_ control on its own is a gap, and gaps do not make a tool `partial`.

### reposition sources

- https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html _(the tool page: `V`, element drag, and "Alignment and Distribution" as the bar's two named groups)_
- https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html _(Lock Position; Auto Select in the Move bar)_
- https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html _(Show Transform Controls as the route to the transform state)_
- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-content-of-layers-and-groups.html _(the six align commands and their per-command semantics, 2026)_
- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html _(Auto-Align as the `Edit > Auto-Align Layers` command; the Projection section; the locked reference layer)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html _(spring-loaded tool shortcuts, Feb 23 2026 — the mechanism, the preference being on by default, **and the 200 ms default**)_
- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/display-layer-edges-and-handles.html _(Feb 23 2026; the whole body is three sentences about Show Transform Controls and the handles)_
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html
- https://helpx.adobe.com/photoshop-elements/desktop/keyboard-shortcuts/keys-selecting-moving-objects.html _(Adobe, but a different product: the arrow-key nudge and the Alt-drag duplicate)_
- https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html
- https://helpx.adobe.com/photoshop-elements/using/moving-copying-selections.html _(Adobe Elements; Auto Select Layer, Show Bounding Box, the Align and Distribute menus and their 3-layer minimum)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html
- https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html _(the localized page that carries the older and fuller text: `Layer > Align` vs `Layer > Align Layers To Selection`, "These same commands are available as Alignment buttons in the Move tool options bar", the distribute commands, Horizontally/Vertically, the 3+ minimum, and the Shift-click / Ctrl-click selection rules)_
- http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Move_tool.html _(third party, CS6-era: the Group/Layer menu, and the bar swapping to numeric transform fields on a handle press)_
- https://photoshoptrainingchannel.com/tips/show-transform-controls _(third party; the one place that states the box surrounds **every selected object** when several are selected, which is what makes the missing align row matter rather than merely being absent)_
- https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html _(Adobe blog: the Tool Preset Picker by name, Reset Tool / Reset All Tools, spring-loaded cursors)_
- https://jkost.com/blog/2021/10/align-and-distribute-layers-in-photoshop.html _(Adobe blog: the Move bar's three-dot More control, "click the More icon (the three dots) to choose Canvas", and the Distribute Horizontal Centers icon behind the same More control)_
- https://www.bwillcreative.com/the-move-tool-in-photoshop/ _(third party; the only page that spells the control as `Align To` and gives both of its states, Canvas and Selection)_
- https://community.adobe.com/questions-712/move-tool-align-to-canvas-by-default-1171406 _(Adobe Community; the Selection-is-the-default report, with an expert noting canvas/selection is not recorded in an alignment action step)_
- https://www.photoshopessentials.com/basics/layers/align-layers _(third party: the greyed-out row at one layer, the six align buttons in bar order, group-as-one-unit alignment)_
- https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignation-with-a-reference-layer _(third party, direct observation: a locked layer greys out align and distribute)_
- https://design.tutsplus.com/tutorials/how-to-auto-align-in-photoshop--cms-40982 _(third party: the two Distribute Spacing buttons as the current form)_

## `transform` — Free Transform

Free Transform is a command, and the app's panel is not its bar. The most useful way to describe
the difference is that the app built the **`Image > Transform`** panel, not the Free Transform
panel: rotate 90 left / 180 / 90 right, a continuous rotation slider, skew X and skew Y, scale X
and Y, and flip H and V — which is `https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/adjust-scale-rotation-and-perspective.html`'s
list of "Scale to resize, Rotate to turn, Skew to slant, Distort to stretch, Perspective to shift
depth, Warp to bend and curve freely" minus the three that need a live box. Flip is a menu
command rather than an options-bar control, so it is recorded in `appNotes` and not in the table,
per the type contract's rule that `options` holds Photoshop's options bar and nothing else.

**`Image > Transform` in that sentence is a category error and is corrected to `Edit > Transform`
here and in the data file.** Adobe's `Image` menu has no Transform submenu; the six single modes
live under `Edit > Transform` (`.../apply-transformations.html`, "Go to **Edit > Transform**, then
select a transformation type"), and `Edit > Free Transform` is a **separate top-level Edit item**
that applies several at once. The app's own grouping is the same idea with a different name — it is
a set of fixed parameters for the six modes, and the label it happens to carry is not a Photoshop
menu path.

| control                                      | what it is in Photoshop                                                                     | status  | appRef                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- |
| Width                                        | Numeric percent text box                                                                    | partial | `Transform.tsx` — the `resize-x-slider` input   |
| Height                                       | Numeric percent text box, linked to Width                                                   | partial | `Transform.tsx` — the `resize-y-slider` input   |
| Maintain Aspect Ratio (Link)                 | Proportional-scaling toggle, on by default since 21.0; Shift is bound to the same state     | missing |                                                 |
| Reference point location                     | 3×3 pivot grid, hidden by default; transforms start from the object center                  | missing |                                                 |
| Rotation                                     | Numeric degrees text box; the same angle comes from dragging outside the box                | partial | `Transform.tsx` — the `rotate-slider` input     |
| H                                            | Adobe's H (horizontal skew) degrees text box                                                | partial | `Transform.tsx` — the `skew-x-slider` input     |
| V                                            | Adobe's V (vertical skew) degrees text box                                                  | partial | `Transform.tsx` — the `skew-y-slider` input     |
| Switch Between Free Transform And Warp Modes | Button that swaps the box for a warp mesh, plus the Warp pop-up of predefined styles        | missing |                                                 |
| X                                            | Numeric text box for the horizontal position of the transform reference point               | missing |                                                 |
| Y                                            | Numeric text box for the vertical position of that same reference point                     | missing |                                                 |
| Relative Positioning                         | Button that makes X and Y a displacement from the current position rather than a coordinate | missing |                                                 |
| Commit                                       | The checkmark; Adobe also prints Enter, and the single-mode bar prints `Done`               | missing |                                                 |
| Cancel                                       | The cancel button; also Esc                                                                 | partial | `Transform.tsx` — the Escape `keydown` listener |

**`Maintain Aspect Ratio` is now named by Peachpit as well as by the Adobe blog, and the "on by
default since 21.0" reading survives.** Julieanne Kost's 2019 post is the source for the version —
Shift inverts the link from 21.0 onward — and Peachpit states the resulting behaviour in the
product's own terms: "**By default, the item will be scaled proportionally. Hold the Shift key as
you drag to distort the item**", and names the button in the row below, "Click the **Maintain
Aspect Ratio** button to link the Width and Height values". A third page agrees on the default and
inverts it the same way (`https://www.howtogeek.com/700400/how-to-bring-back-photoshops-old-free-transform-controls`,
"the proportions are locked by default and, instead, you hold down 'Shift' to distort things"), and
the Free Transform page's own `Legacy Free Transform` preference exists to undo exactly that, which
is the strongest corroboration that the default is the post-21.0 one. The row is `missing` and stays
`missing`: the app has two independent scale sliders and nothing coupling them.

**The last three rows were missing from the table and are added here; the first two had the wrong
names.** Adobe's Free Transform page enumerates the bar control by control, and three of them were
simply not in this table at all:

- "To move an item, enter values for the new location of the reference in the **X (horizontal
  position)** and **Y (vertical position)** text boxes in the options bar. Click the **Relative
  Positioning** button to specify the new position in relation to the current position."
  (`https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html`)
- **Position within the bar is taken from that same enumeration**, which runs … rotation, H and V
  skew, the warp-mode switch, the reference-point locator, X / Y / Relative Positioning, Commit,
  Cancel. The three rows are therefore written after the warp switch and before `Commit`. That is
  Adobe's prose order, not a reading of the on-screen bar, and the page's own ordering does not
  settle where the locator sits relative to the warp switch — which is why `Reference point
location` keeps its existing position above `Rotation` and was not moved.
- **The two skew rows were renamed from `Skew H` / `Skew V` to `H` / `V`,** because `types.ts`
  requires the control's name verbatim and Adobe's string is "enter degrees in the **H (horizontal
  skew) and V (vertical skew)** text boxes in the options bar". `Skew H` is this file's own
  abbreviation, not Photoshop's.

**The H/V pair is not always in the bar, and that is sourced.** An Adobe Community thread records it
missing when the thing being transformed is a Smart Object: "The options bar (with skew missing) in
your first image shows the options bar for transforming a smart object. You can still Skew but the
boxes are not in the options bar. I just checked and CC2018 was the same. The skew boxes do appear
though, in both versions, when transforming pixels, paths and shapes"
(`https://community.adobe.com/questions-712/horizontal-h-and-vertical-v-skew-fields-are-missing-in-the-options-bar-on-photoshop-cc-2019-1078402`).
The data file records the absence in the `H` row. **Note the dates: the thread is titled CC 2019 and
the answer goes back one version to CC 2018**, so "absent for Smart Objects" is stated here and
"absent from CC 2019 onward" is not — that narrower form would claim the fields were present
earlier, which nothing here supports.

Every numeric control is `partial` for the same reason: the app renders a **range slider**, not a
text box, and the ranges are the app's own. Rotation is clamped to ±90° with 90/180/360 reachable
only through three separate buttons, skew to ±45°, scale to 10–300%. Photoshop's fields accept
any value in those units, and the Link icon that couples Width and Height has no counterpart at
all, so the app can scale a layer non-proportionally by dragging one slider and cannot be
coupled. `Cancel` is the only control in the family with a partial app verdict, and the partial is
the button: the app binds Escape alone, so the discard route exists and is invisible. Adobe's bar
pairs that Cancel with a Commit; the app's Commit row is `missing` for the separate reason recorded
below — there is no commit control, because a finished gesture commits itself.

The `Trapezoid` slider is the app's own addition and has no Photoshop options-bar counterpart.
Its nearest Photoshop relative is Free Transform's Perspective mode, which is reached by
`Cmd+Option+Shift`-drag, not by a percentage, and the two are not interchangeable: `Trapezoid` is
a projective taper about the horizontal centerline, and the app makes it **mutually exclusive**
with everything else — moving it resets rotation, both skews and both scales to their defaults
(`Transform.tsx` — `handleTrapezoidChange()`), and the processor refuses a trapezoid combined with
a retained affine transform rather than composing them (the `isTrapezoidOnlyTransform()` refusal
in `transform()` in `src/tools/transform.ts`, and `isTrapezoidOnlyTransform()` in
`src/contexts/affine-transform.ts`). It is also the one path that rasterizes, by solving a
homography and resampling through it (`renderTrapezoid()` in `src/tools/transform.ts`, at its
`resampleThroughHomographyRowByRow` call and fed the `solveHomography` result beside it), while
every other parameter stays a retained affine. **The earlier citation for that solve was
`transformToolArgsToAffine()` in `src/contexts/affine-transform.ts` — the function that builds the
_retained affine_ and the exact opposite of the rasterizing path.**

Modifiers, all six from Adobe's Free Transform page except the last, which is the Adobe Elements
modifier table:

| keys                           | action                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Shift`                        | with a rotate drag, snap to 15° increments; with a handle drag, toggle proportional scaling (this is what Shift means since 21.0) |
| `Alt` (Win) / `Option` (macOS) | distort relative to the center of the bounding box                                                                                |
| `Cmd` (macOS) / `Ctrl` (Win)   | distort freely                                                                                                                    |
| `Cmd+Shift`                    | skew a side handle                                                                                                                |
| `Cmd+Option+Shift`             | perspective from a corner handle                                                                                                  |

| keys           | action                                              |
| -------------- | --------------------------------------------------- |
| `Cmd+T`        | Free Transform                                      |
| `Cmd+Option+T` | duplicate and enter Free Transform on the duplicate |
| `Enter`        | commit                                              |

The app binds none of the three. `t` alone selects the Text tool
(the `t` registration in `AppKeyboardShortcuts.tsx`; what an earlier version cited is inside the
`Cmd+C` copy handler) and there is no `Cmd+T` registration
anywhere; the tool has no accelerator at all, and no rail entry to declare one on —
`extraTools` in `toolbar-mapping.ts` is where `color`, `levels` and `transform` are recorded as
carrying no Tools-rail entry, and `Edit ▸ Free Transform` in the header is what reaches the id
instead (the `Edit` menu's `Free Transform` item in `DesktopHeader.tsx`).

**`Enter` is now Adobe's, and it was third-party before this pass.** Adobe's Free Transform page
does not print it, but the Feb 23 2026 reference-point page does, in the imperative: "Press **Enter
(Windows) or Return (macOS)** to apply the transformation"
(`.../move-reference-point-for-transformations.html`, already in `sources`). The same page supplies
the in-transform undo the app lacks: "**To undo the last handle adjustment, choose Edit > Undo**" is
printed as a `Note` on the Free Transform page itself, so "Photoshop can step back and forth inside
a live transform" is now a quoted Adobe claim rather than an inference, and `appNotes` quotes it.

**`Commit` is the right name for the Free Transform bar's button and the wrong one for the other
bar, which is a distinction worth keeping rather than flattening.** Adobe's Feb 2026
`apply-transformations.html` — the page for the six **single** `Edit > Transform` modes — says "Press
Enter (Windows), Return (macOS), or select **Done** to confirm the transformation". So the two
Photoshop bars print different labels for the same gesture, and **no Adobe page names the Free
Transform bar's two buttons at all**; "Commit" for that pair comes from Peachpit ("press Enter/Return,
click the **Commit button** in the Options bar") and from the glyphs Photoshop actually shows, which
have been a checkmark and a cancel cross since 22.0. The `Commit` and `Cancel` row names are kept,
and `Commit`'s detail now says which routes are Adobe's and which is not.

**The commit route is the end of a gesture, and the discard route is Escape.** A drag PREVIEWS
while the pointer is down and commits as exactly one history entry when the pointer is released.
The commit signal is the browser's native `change` event on the range input, bound as a plain
listener on the bar (the `onValueCommitted` listener in `Transform`,
`src/components/ToolbarsRight/Transform/Transform.tsx`) — React's own
`onChange` cannot be used for it, because React binds `onChange` to the native `input` event,
which fires on every frame of a drag. That distinction is the whole feature: binding the commit to
the input stream would write one history entry per frame. The five discrete controls — three
rotate buttons, two mirror toggles — call the same commit from their `onClick` (`commitPreview()`,
same component), because a button press is a finished gesture too and a panel where a slider lands
in history but a mirror flip does not is a panel whose history nobody can reason about.

`commitDirtyTool()` (`src/contexts/useLayer.ts`) is what bakes the preview into a layer plus one
history entry. It consumes the pending preview out of `previewLayersRef.current`, so it is a no-op
when there is nothing pending, and `normalizeCommittedToolArgs()` drops an identity transform
before the args reach history, so a release that moved nothing writes nothing. Those two are why a
second release cannot double-write and why a click that lands where it started costs no history
entry.

The other commit routes still exist: `goToTool()` (`src/hooks/useApp.ts`), which every
toolbar click and letter shortcut runs through, and the export handlers
(the header's save handler in `src/components/DesktopHeader/DesktopHeader.tsx`, `handleExport` in
`src/components/Mobile/MobileHeader.tsx`, `handleSave` in
`src/components/Mobile/MobileMenuDrawer.tsx`). Escape is the only route that goes the other way,
and it is the ONLY caller of `cancel()` (in `Transform`,
`src/components/ToolbarsRight/Transform/Transform.tsx`), whose listener is the `keydown` effect in
that same component: it runs `cancelLayerPreview?.()` and resets the panel args, and
dispatches nothing, so what survives is the last committed state.

**An earlier version of the app had four children stacked in that column — the mirror-toggle pair and
three text links — and it now has two buttons and nothing else.** The column used to be `Reset All`,
`Apply` and `Cancel` under the mirror toggles. All three were removed across two steps, `Cancel`
last, which leaves the bar with no text control at all — no commit, no discard, no reset.

**The reason was HEIGHT, and the first version of this entry said width, which is wrong in a way
that sends the next session after a defect that does not exist.** The column is a `flex flex-col`
under the mirror toggles, so those controls were stacked rather than laid out across. Measured
headlessly in Chromium at 1280x800 with `Edit > Free Transform` open: with all four children the
column was **85px** inside the strip's fixed `h-[50px]`
(`TOOLBAR_BASE_CLASS` in `src/components/ToolbarHorizontal/ToolbarHorizontal.tsx`), spilling ~35px
above and below the bar — and `overflow-y` is `visible` from 1024px up, so the spill painted over
the header and the workspace rather than scrolling. The bar's **width never changed by a pixel** through any of it:
548px before and after, and no horizontal overflow at any viewport width from 769 to 1440. The
column was always 68px wide because the mirror row's two `w-8` buttons and their `gap-1` set it and
every text link stretched to that width rather than sizing itself by its glyphs. So the number of
links was never a width lever; `w-24`, `w-10` and `gap-4` are. With the last text control gone the
column is `flex flex-1 items-center justify-center` (the mirror-toggle column in `Transform.tsx`),
so it absorbs the slack the removed links left behind and centers the two mirror toggles in it.

`Reset All` was redundant in a second way: its handler was `cancel` verbatim (the `Reset All`
link's own handler, since removed from `Transform.tsx`), so it was a second name for the button
below it.
`Apply` was not redundant in the same way, which is why removing it without replacing it lost the
only in-bar commit; that is what the gesture commit above restores, and it restores it where the
value is edited rather than on a separate control. The `Commit` row above is `missing` because there
is no checkmark on the bar, and its citation is gone rather than repointed, since there is nothing
left to point at; `Cancel`'s is repointed to the Escape listener, which is now the whole of it.

**Implementation: partial.** The declared composite order is fixed — scale, then rotation, then
skew, all about the untransformed layer center (the `multiplyAffineTransforms` composition inside
`transformToolArgsToAffine()` in `src/contexts/affine-transform.ts`, whose own doc comment is the
declaration) —
where Photoshop composes handle drags in the order they happen. Nothing in the panel is
handle-driven, so the app's transform is a parameter set applied at once rather than a continuous
operation, which is the property the command exists for.

### transform sources

- https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html _(the bar enumerated control by control: H and V skew, the warp-mode switch, the reference point locator, X / Y / Relative Positioning, and the `Edit > Undo` note; and "Choose Edit > Free Transform" plus the routing of a pixel layer to the Move tool with Show Transform Controls)_
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/adjust-scale-rotation-and-perspective.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/apply-transformations.html _(the six single `Edit > Transform` modes, and **"select Done"** — the other bar's label for the commit button)_
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html _(Feb 23 2026: "Select Edit > Transform and select a transformation type, or select **Edit > Free Transform** to apply multiple transformations"; the Reference point location icon; "Press Enter (Windows) or Return (macOS) to apply the transformation")_
- https://www.peachpit.com/articles/article.aspx?p=3150375 _(Adobe's own book authors; `Ctrl/Command+T`; the **Commit** button by name; clicking away from the transform controls; `Maintain Aspect Ratio` linking Width and Height; "enter 100 px in the X value"; Shift distorting a proportional-by-default scale)_
- https://www.photoshopessentials.com/basics/free-transform _(third party; the context menu as the third way to choose a mode, and the Skew/Alt-from-centre behaviour)_
- https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html _(Adobe, but a different product; used for the modifier table, whose Photoshop equivalent is stated verbatim on the Free Transform page for all but the skew row)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html
- https://jkost.com/blog/2019/06/new-free-transform-preference-in-photoshop.html _(Adobe blog)_
- https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf _(third-party mirror of Adobe's shipped shortcut sheet; the only route to `Cmd+T` / `Cmd+Option+T` / `Enter`, since Adobe's own default-shortcuts page describes the dialog rather than listing the bindings)_
- https://glensmith.co.uk/photoshop/tools _(third party, but the load-bearing citation for the command-not-tool claim: a complete, version-stamped — "every tool in the Photoshop 2026 toolbar", page updated 21 September 2026 — enumeration of the whole Tools panel in toolbar order, containing no Transform entry under any name)_
- https://www.adobe.com/products/photoshop/resize-image.html _(Adobe marketing copy, and the source of the counter-sentence "Select the Transform tool by pressing Ctrl + T (Cmd + T for Mac)" — the same paragraph's next clause is "You can also go to Edit > Free Transform", which is why the sentence does not carry a Tools-panel claim)_
- https://community.adobe.com/questions-712/horizontal-h-and-vertical-v-skew-fields-are-missing-in-the-options-bar-on-photoshop-cc-2019-1078402 _(Adobe Community; the H/V fields absent from the bar for a Smart Object, observed in CC 2018 and CC 2019, and present for pixels, paths and shapes)_

## `levels` — Levels

Levels is the tonal tool, and the app's `levels` is Brightness/Contrast under its name. That is
the corpus's Note B and it survives inspection of the current tree unchanged: two sliders, no
histogram, and a filter string of `brightness() contrast()`.

| control                     | what it is in Photoshop                                                                                                                                                   | status  | appRef                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| Preset                      | Menu of saved settings, with Save Preset beside it. Adobe states the round trip and no count: "You can save Levels settings as a preset, then apply them to other images" | missing |                                                                 |
| Channel                     | RGB, or an individual Red / Green / Blue channel, or a combination selected in the Channels panel. Defaults to RGB                                                        | missing |                                                                 |
| Histogram                   | The distribution graph drawn behind the three input sliders; the guide you read to decide where the points belong                                                         | missing |                                                                 |
| Input Levels: black point   | Left slider on the 0–255 domain, at 0 — a default Adobe does not state. **Adobe prints the level-5 case itself**: at that setting everything at 5 and below maps to 0     | missing |                                                                 |
| Input Levels: midtone gamma | Middle slider, "adjusts the gamma in the image" and "moves the midtone (level 128)"; at 1.00, a default Adobe does not state; left lightens, right darkens                | missing |                                                                 |
| Input Levels: white point   | Right slider, at 255 — a default Adobe does not state. Adobe's own case: at 243, everything at 243 and above maps to 255                                                  | missing |                                                                 |
| Output Levels: black        | Left output slider, default 0 — Adobe's stated Output-slider default; the level the black point maps to                                                                   | missing |                                                                 |
| Output Levels: white        | Right output slider, default 255 — the other half of Adobe's stated Output-slider defaults                                                                                | missing |                                                                 |
| Auto                        | Clips a small fraction of shadows and highlights per channel and maps the remaining extremes to pure black and white. Adobe: 0.1% clipping, 0–255 domain                  | missing |                                                                 |
| Auto Options                | Opens Auto Color Correction Options: chooses the algorithm and sets the clipping percentages. Adobe recommends 0.0%–1%. Three of four algorithm names are Adobe's         | missing |                                                                 |
| Eyedroppers                 | Set Black Point, Set Gray Point, Set White Point. Using them discards any adjustment already made, so Adobe advises using them first                                      | missing |                                                                 |
| Reset                       | Returns the adjustment to its original settings                                                                                                                           | partial | `Levels.tsx` — the `Reset` button's `discardAdjustment` handler |

Every one of those eleven rows is `missing`, and the two that were `partial` until this pass were
`partial` by association rather than by resemblance. The app's nearest analogue to the black point
is its **Brightness** slider, which is a flat linear multiply with a re-anchored exponential
response (`BRIGHTNESS_EXPONENT` in `src/tools/functions.ts`, the `expAdjustment()` it is fed
through, and `buildLevelsFilter()` which emits the string), and the nearest analogue to the white
point is its **Contrast** slider, which pivots around mid-gray in encoded space where Photoshop's
curve is piecewise-linear through three control points with its midpoint fixed at level 128.
**Neither app slider is a Photoshop Levels control.** An association between two things is not a
control that exists and diverges, which is what `partial` means, so the count of `present` rows here
is zero and the count of `partial` rows is one: the table describes Photoshop's panel, and the app's
panel and Photoshop's share no rows in it.

**And the mapping, which this file previously had inverted.** 0 on the Brightness slider is the
**neutral** — the re-anchoring makes it emit exactly `brightness(100%) contrast(100%)`, so the panel
at its defaults (the `levels` entry of `defaultSettings` in `src/tools/settings.ts`) applies nothing
at all. It is the **minimum**, −100,
that emits `brightness(0%)` and multiplies the layer to black.
The earlier sentence here said "at
zero it makes the image darker without clipping anything"; that is false, and the contract table on
`expAdjustment()` in `src/tools/functions.ts` and the two named literals in the
`it('emits the neutral as brightness(100%) contrast(100%)')` and
`it('reaches black: -100 brightness emits brightness(0%)')` cases in
`src/tools/__tests__/functions.test.ts` are the correction.

Two version- and space-dependent facts are load-bearing and are in the prose. Levels operates on
the document profile's **encoded** values; Adobe draws the contrast with Exposure, which
"performs calculations in a linear color space"
(`https://helpx.adobe.com/photoshop/using/color-adjustments.html`).

**And the destructive / non-destructive split, which this file also previously had backwards.**
`Image > Adjustments > Levels` discards image information — Adobe verbatim, "Choosing Image >
Adjustments > Levels makes direct adjustments to the image layer and discards image information" —
while the adjustment layer stays editable,
and **this app is the non-destructive half, not the destructive one** (the earlier
"research decision D3" said the opposite, and was wrong). A committed adjustment is a retained
layer operation: the `commit: 'layer-operation'` branch of `tempUpdateLayer()` in `useLayer.ts`
appends it to `layer.operations` and returns before any pixel is produced, `updateLayerByTool()` in
the same file publishes that layer plus one `TOOL_ACTION` history entry, and the
`commit: 'layer-operation'` branch of `replayHistory()` in `history-replay.ts` replays the
operation rather than a stored raster, so undo and redo both work. What the app does not have is
the _re-editability_ half: a committed adjustment cannot
be reopened, so it can only be taken back with undo. That is also what the Reset button is not —
it is disabled unless an uncommitted preview is live (the `hasLivePreview` guard in `Levels.tsx`)
and restores the panel's own defaults, so it is a preview cancel and not an adjustment reset.

**Four rows of the table above are now fully Adobe-sourced, which the table did not say.** The
`levels-adjustment.html` page (2023-05-24) prints, in order: the Channel route ("choose an option
from the **Channel menu**"), the combined-channel route and its adjustment-layer exception, the
`Alt`/`Option` clipping preview, the gray-point eyedropper, `Auto`, and the `Auto Options` menu
entry with the dialog it opens. That last one is now quoted in the row: "To experiment with other
automatic adjustment options, **choose Auto Options from the Properties panel menu**, then change
Algorithms in the **Auto Color Corrections Options** dialog box" — so `Auto Options` is a
**Properties-panel menu item**, which the previous version of the row got right by accident when it
called it a "menu command", and Alt/Option-clicking the `Auto` button reaches the same dialog
(`making-quick-tonal-adjustments.html`, "Alt-click (Windows) or Option-click (Mac OS) the Auto
button"). The dialog also has a **Snap Neutral Midtones** checkbox, which Adobe names on that page
and the row now carries. The three eyedroppers are named by
`adjust-color-tone-levels-curves.html` — "**Set Black Point**", "**Set Gray Point**", "**Set White
Point**" — along with the two behaviours the row already claimed: "using the eyedroppers undoes any
previous adjustment you made in Levels or Curves… it's best to use them first", and "The eyedropper
tool that sets the gray point is used primarily for color correction and is **unavailable when you
work with grayscale images**". Both rows were already right; they are now right with the citation.

| keys                           | action                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `Alt` (Win) / `Option` (macOS) | hold while dragging the black or white input slider to preview clipping |

| keys    | action                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- |
| `Cmd+L` | apply Levels; `Cmd+Option+L` re-applies with the last settings used; `Cmd+Shift+L` is Auto Tone |

The app binds no shortcut for `levels`. The id has no Tools-rail entry to badge one on —
`extraTools` in `toolbar-mapping.ts` is where `color`, `levels` and `transform` are recorded as
carrying none — and `Image ▸ Adjustments` in the header is what reaches it
(the `ADJUSTMENTS_ITEMS` submenu in `DesktopHeader.tsx`).

**The `Cmd+Shift+L` claim in that row was wrong and is corrected above.** Adobe's shipped sheets do
not put Levels on `Shift+Cmd`; see `## Unverified` #15. This is the one place in this family where
a shortcut in the data file was contradicted rather than merely unsourced, and it is also the one
that would have taught a user the wrong key for the wrong command.

**Implementation: partial.** Zero of twelve rows are `present` and one is `partial`. See the
`ctx.filter` section above for the engine — and note that the engine claim it used to end on, an
`OffscreenCanvas` context on the editing path, was wrong: these two tools commit as retained layer
operations and never reach their `OffscreenCanvas` processors.

### levels sources

- https://helpx.adobe.com/photoshop/using/levels-adjustment.html _(the Output-slider defaults, the level-5 black and level-243 white worked cases, the Channel menu and its adjustment-layer exception, the level-128 midtone, the Alt/Option clipping preview, the gray-point eyedropper, `Auto`, the `Auto Options` panel-menu entry, the Save Preset round trip, and the destructive half)_
- https://helpx.adobe.com/photoshop/using/adjust-color-tone-levels-curves.html _(the three eyedropper names, "using the eyedroppers undoes any previous adjustment", and the gray point being unavailable on grayscale images)_
- https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html _(the 0–255 domain verbatim; the 0.1% clipping default, twice; the 0.0%–1% recommendation for the Clip boxes; the three algorithm names and Snap Neutral Midtones; Alt/Option-click on Auto)_
- https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
- https://helpx.adobe.com/photoshop/using/color-adjustments.html
- https://helpx.adobe.com/ca/photoshop/web/edit-images/color--tone--and-lighting/modify-tones-with-levels-adjustment.html _(localized mirror; the `RGB, Red, Green, or Blue` channel list)_
- https://www.adobe.com/learn/photoshop/web/photoshop-improve-tones-levels _(Adobe Learn; the non-destructive adjustment-layer half)_
- https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf _(third-party mirror of Adobe's shipped shortcut sheet; `Cmd+L`)_
- https://training-nyc.com/legacy/photoshop_cs6_all_keyboard_shortcuts_sheet.pdf _(third-party mirror of Adobe's shipped CS6 sheet; `Cmd+L`, and `Shift+Cmd+L` as **Auto Tone**, which is what corrects the data file)_
- https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS2_Keyboard_Shortcuts_Mac.pdf _(the earlier sheet, printing the same shape with `Shift+L` for Auto Levels and "Levels (last settings)" as a binding of L)_
- https://glensmith.co.uk/photoshop/tools _(third party; the negative — a complete Photoshop 2026 Tools-panel enumeration with no Levels tool in it)_
- https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview _(third party; the second negative — "nearly 70 tools", also with no Levels tool)_

Note on `levels-adjustment.html`, which carries more of the table than the other Adobe pages: "The
outer two Input Levels sliders map the black point and white point to the settings of the Output
sliders. By default, the Output sliders are at level 0, where the pixels are black, and level 255,
where the pixels are white… if you move the white point slider to the left at level 243, Photoshop
maps all pixels at level 243 and higher to level 255", and "The middle Input slider adjusts the
gamma in the image." It states the **Output** defaults and the level-243 case, and states no
default for the three **input** sliders.

## `color` — Black and White

The corpus left this tool's identity open and the research corpus README records the decision:
**D1, `color` = Black & White + Tint.** The description is written against that decision, and the
fourth correction already folded into the brief is respected throughout — **six sextants, not ten**
— with the 9-range CMYK model attributed to Selective Color rather than here.

| control                  | what it is in Photoshop                                                                                                 | status  | appRef                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| Preset                   | Menu of predefined grayscale mixes and saved custom mixes, with Save Black & White Preset beside it                     | missing |                                                                |
| On-image adjustment icon | The Targeted Adjustment tool, directly under Preset at the top of the panel; select it and drag onto the image          | missing |                                                                |
| Auto                     | Sets a grayscale mix based on the image's own color values                                                              | missing |                                                                |
| Tint                     | Checkbox that lays a uniform tone color over the monochrome result                                                      | missing |                                                                |
| Tint Color               | The swatch beside Tint; opens the Color Picker, and the tone it applies is called Tint Color                            | missing |                                                                |
| Color sliders            | Six sliders, in bar order: Reds, Yellows, Greens, Cyans, Blues, Magentas. Names, order and defaults are all third-party | missing |                                                                |
| Reset                    | The reset icon that returns the sliders to their defaults                                                               | partial | `Color.tsx` — the `Reset` button's `discardAdjustment` handler |

**The name is `Black & White`, with the ampersand, and the data file said `Black and White`.** Adobe
writes the command, the panel and the adjustment layer with an ampersand — `Image > Adjustments >
Black & White`, the Properties icon, `Layer > New Adjustment Layer > Black & White` — and its own
help text says "choose **Black & White** from the list". The phrase without the ampersand is prose
English, not a product name, and `types.ts` requires the name verbatim, so `photoshopName`, the
`summary` and `purpose` now use the ampersand. **`Colors` was this app's own tile label and was not
an Adobe name at all** — and the label went out with the entry. The flyout that carried `color`,
`levels` and `transform` is gone from `toolbarMap`; `extraTools` in `toolbar-mapping.ts` is
where the three ids are recorded as carrying no Tools-rail entry, and `color` is reached now from
`Image ▸ Adjustments ▸ Photo Filter` (the `Photo Filter` entry of `ADJUSTMENTS_ITEMS` in
`DesktopHeader.tsx`). Nothing in `src/` spells it
"Colors" any more, so `appNotes` records the rail absence and the Photo Filter host rather than the
old name.

**The `On-image adjustment icon` row moved up two positions, and its detail was wrong about the
mechanism while it was wrong about the position.** It was listed last, after `Reset`; the control
sits at the **top** of the panel, under the Preset menu:

- "…there's an even easier way to customize your black and white version, and that's by using the
  Targeted Adjustment Tool. **You'll find it directly under the Preset option.**"
  `https://www.photoshopessentials.com/photo-editing/converting-color-photos-to-black-and-white-in-photoshop`
- "To adjust a specific color in your photo, you can **select the On-image Adjustment Tool found on
  the top left of the properties panel**."
  `https://photoshoptrainingchannel.com/black-white-photos-photoshop/`
- **Adobe's own page, last updated Feb 23 2026, and it says the icon is dragged:** "Color sliders:
  Drag sliders to adjust gray tones for specific colors. **Select and drag On-image adjustment icon
  onto the image to adjust tones.** Select reset icon to return to defaults."
  `https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html`

Both pages also settle where the `Auto` button sits relative to it — "the Auto button, **located
above the sliders**" — which is consistent with the On-image tool being above `Auto`, so the row
goes between `Preset` and `Auto` and nothing else in the block moves. **The old detail described a
different gesture,** and the correction recorded here last pass went too far in the other
direction: it said "**Neither source describes dragging the icon anywhere**; both describe selecting
the tool and then dragging on the image", which was true of the two third-party pages and false of
**Adobe's**, whose wording is the drag form. The row now quotes Adobe. The consequence for the
third-party pages is only that they describe the same gesture in different words, not that Adobe is
contradicting them.

**And Adobe's page names four of the seven controls verbatim, which sharpens the table.** It gives
"Preset : Select a predefined grayscale mix or a saved custom mix. Select the menu icon > **Save
Black & White Preset** to save the preset", "Auto : Set a grayscale mix based on your image's color
values", "Tint : Select the checkbox and then the color swatch to choose a subtle tone color from
the Color Picker (**Tint Color**)", and "Select **reset icon** to return to defaults". It also opens
the adjustment with the sentence the `purpose` row now leans on: "Photoshop applies a **default
grayscale conversion** to your image", which is what lets `purpose` say every slider starts at a
conventional value without it being a third-party claim.

**And the sextant defaults were attributed to Adobe, which does not print them.** The row read
"Adobe ships them at 40 / 60 / 40 / 60 / 20 / 80". Adobe's Black and White page names the block
("Color sliders: Drag sliders to adjust gray tones for specific colors") and stops there — **it
does not name the six families or their order either**; both of those are third-party, and the row
now says so rather than presenting the order as Adobe's. The figure is the documented default, but
the _pages that print it_ print only the first three:

- "each slider is already set to a certain value, with **Reds set to 40%, Yellows set to 60%, and
  so on**"
  `https://www.photoshopessentials.com/photo-editing/black-and-white-cs3`
- "Photoshop has already gone ahead and set the sliders to specific values (**Reds are set to 40,
  Yellows to 60, Greens to 40, and so on**)"
  `https://www.photoshopessentials.com/photo-editing/converting-color-photos-to-black-and-white-in-photoshop`

**Blues 20 and Magentas 80 appear in neither**, and the only places this pass found them are a
StackOverflow reproduction and third-party prose. So the number is kept — it is the real default and
dropping it would make the row less useful — and the attribution is fixed instead: the data file now
says the values are third-party and quotes the two that are actually printed. A page that prints
"Reds set to 40%, Yellows set to 60%, and so on" is a page that has **not** printed 20 and 80.

The app's Grayscale, Sepia and Saturation sliders are **not** in this table, and that is the whole
finding rather than an omission from it. The types contract requires each row to be named in
Photoshop's options bar, and none of the three is a Black and White control. Grayscale is the
nearest thing to the sextant block as a whole and cannot stand in for it, because a hue-weighted
mix and a luminance average diverge the moment any family is pushed. Sepia is not Tint: Tint is a
uniform tone color laid over a conversion whose mix you still control, whereas Sepia is a second
filter stage applied to the whole image, so the two compose into a look neither produces alone.
Saturation belongs to no part of Black and White at all — it is a Hue/Saturation control, and its
presence is a leftover from the identity question D1 settled. All three start at 0
(the `color` entry of `defaultSettings` in `src/tools/settings.ts`), which is a true no-op: the
neutral emits `grayscale(0%) sepia(0%) saturate(100%)` and that literal is pinned by test.

Black & White binds no modifier, and **it does have a keyboard shortcut** —
`Opt+Shift+Cmd+B` — which the data file used to deny outright because "none was found in any
source". That was a gap in the research, not a finding: Adobe's own shipped CS6 shortcut sheet
prints it in the Image Adjustments block, and a third-party page gives the same four keys. The row
is added and the app's lack of a binding is stated inside it. No current Adobe page confirms the
binding, and the app binds nothing, so nothing turns on it — see `## Unverified` #16.

**Implementation: partial.** Zero of seven rows are `present`. The engine is the shared CSS filter
string, applied to a plain canvas element on the editing path and to an `OffscreenCanvas` only in
the durable materializer — see the `ctx.filter` section above.

### color sources

- https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html _(last updated Feb 23 2026: Preset, Save Black & White Preset, Auto, Tint, Tint Color, the Color sliders block, "Select and drag On-image adjustment icon onto the image", the reset icon, and the "default grayscale conversion" the adjustment opens with)_
- https://helpx.adobe.com/photoshop/using/color-adjustments.html _(Black & White as a color adjustment command; the Reset button; presets; the Toggle Layer Visibility icon that replaces a Preview checkbox)_
- https://helpx.adobe.com/photoshop/using/color-monochrome-adjustments-using-channels.html _(the contrast case — monochrome via Channel Mixer presets, not Black & White)_
- https://training-nyc.com/legacy/photoshop_cs6_all_keyboard_shortcuts_sheet.pdf _(third-party mirror of Adobe's shipped CS6 sheet; `Opt+Shift+Cmd+B` for Black & White)_
- https://www.photoshopessentials.com/photo-editing/black-and-white-cs3 _(third party; the sextant order, and the 40 / 60 opening of the defaults, which Adobe's own page does not print)_
- https://www.photoshopessentials.com/photo-editing/converting-color-photos-to-black-and-white-in-photoshop _(third party; the Properties-panel form of the panel, the Targeted Adjustment Tool "directly under the Preset option", the Auto button "above the sliders", and the same 40 / 60 / 40 opening of the defaults)_
- https://www.photoshopessentials.com/photo-effects/easy-selective-color-effect-with-photoshop _(third party; the six sliders named as three primaries plus three secondaries)_
- https://photoshoptrainingchannel.com/black-white-photos-photoshop/ _(third party; the same control under Adobe's own bar name, "select the On-image Adjustment Tool found on the top left of the properties panel")_
- https://glensmith.co.uk/photoshop/tools _(third party; the negative — a complete Photoshop 2026 Tools-panel enumeration with no Black and White tool in it)_
- https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview _(third party; the second negative — "nearly 70 tools", also with no Black and White tool)_

## Unverified

1. **The `Shift` and `Alt` modifier variants on the Move tool's align buttons.** The addendum
   flags these as the most commonly mis-described part of the tool, and the research confirmed the
   two _behaviours_ while failing to confirm the two _bindings_. Adobe documents both targets as
   menu commands on one page — `Layer > Align` and `Layer > Align Layers To Selection` — and then
   makes the tie to the bar explicit: "These same commands are available as Alignment buttons in
   the Move tool options bar"
   `https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html`). **That page is unread at its
   Adobe URL — `webfetch` returns HTTP 403 — and the sentence was read on five independent mirrors
   of it.** Adobe's own routing, from a page that does open, sends a pixel layer to the Move tool
   with Show Transform Controls rather than to any transform tool
   (`https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html`), so
   the counter-argument is recorded there rather than left to be found. The quoted sentence
   establishes that the buttons have two targets, and that the second one is the active selection
   border. It does not say which modifier selects which, and no page opened in this pass says that
   `Shift` picks Align-Layers-To-Selection. The `Alt`-click-duplicates-the-layer variant is likewise
   unsourced; Adobe's `Alt`-drag duplicate on the canvas is a different control and is asserted in
   the data file, not this. Both are omitted from `modifiers` rather than guessed, and that
   omission is deliberate — see "The align buttons" above. Closest URL for the binding itself:
   `https://www.photoshopbuzz.com/how-to-align-layers` (third party), which describes the
   `Align To:` setting in the bar as a selection rather than as a modifier. **That page is no
   longer the only page that names the control** — see "The align buttons" above for the four that
   are, which is why the `Align to` row is back. The modifier bindings are still not among them:
   none of the four says which modifier picks which target.
2. **The "Auto-Align dropdown" as a control in the Move tool's options bar.** Named in the
   addendum and in the corpus's pre-existing Move row, and not confirmed. What is confirmed is that
   Photoshop's Auto-Align is `Edit > Auto-Align Layers` — a **command** with a dialog, not a
   dropdown in the bar: "Select Edit > Auto-Align Layers and select an alignment option in the
   Auto-Align Layers dialog", with Projection set to Auto, Perspective or Collage, and Cylindrical
   and Reposition Only on the fuller localized page
   (`https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html`,
   `https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html`). The semantics are therefore
   sourced and are in the notes — it aligns layers by **content similarity** (corners, edges), to
   either a reference layer you nominate or one Photoshop picks, with a locked layer serving as the
   reference — but whether a dropdown of that command appears in the Move bar in any version was
   not confirmed, so no row was added for it. The app has no equivalent of the command either way.
3. **The Move tool's own `Transform controls` group: the `Auto-Transform` toggle, the `0 W` / `0 H`
   numeric readouts, and the 3D-mode toggle.** Named in the addendum as one of two items the
   corpus could not confirm from two independent sources, and it did not confirm in this pass
   either. Adobe establishes that the bar _swaps_ to numeric transform fields when a bounding-box
   handle is grabbed (`https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html`
   for the fields and the Link icon; the swap is third-party at
   `http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Move_tool.html`), and that
   there is a reference-point location icon
   (`https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html`),
   but the group's exact membership and the `Auto-Transform` name are not sourced. They are
   omitted from the table rather than asserted. Note also that
   `https://community.adobe.com/questions-712/move-tool-show-transform-controls-option-1171291`
   records Show Transform Controls being moved behind a gear icon in 25.11 and restored in 25.12,
   so the bar's composition is version-dependent and any claim about it needs a stated version.
4. **Which layers still get the transform box when Show Transform Controls is on.** The data file
   used to assert that "a layer with no pixels, an artboard or a text layer are the cases where
   Photoshop shows the box anyway", and that sentence is **removed**: no Adobe page states it. The
   nearest page this pass opened is three sentences long and says nothing about layer content —
   `https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/display-layer-edges-and-handles.html`
   (last updated Feb 23 2026) is "Select the Move tool. In the Options bar, select Show Transform
   Controls. You can then resize or rotate the layer content using the transform handles." The
   nearest constraint that _is_ sourced runs the other way — a LOCKED layer shows no box, via
   "Lock Position: Prevents the layer's pixels from being moved"
   (`https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html`) and the
   third-party observation that a locked background layer greys the align and distribute rows out
   (`https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignment-with-a-reference-layer`).
   The claim may well be true of the empty-layer case; nothing found here establishes it, and an
   artboard or a text layer is a different question again. Do not restore the sentence without a
   page that says it.
5. **The tools excluded from spring-loaded switching.** The `V` row used to end "The exception list
   is the Hand, Slice, Slice Select, Pen and Path Selection tools, which never spring-load", and
   that sentence is **removed as a conflation**. Adobe's spring-loaded page
   (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html`,
   the only Adobe page behind the shortcut) contains no exception list at all. The nearest Adobe
   list is the CS3 manual's "Keys for editing paths" table — "Control (except when Hand, Slice,
   Path, Shape, or any Pen tool is selected)" — and that is a **different behaviour**: it is about
   what the Control modifier does while transforming, not about which tools spring-load. The two
   lists overlap on Hand, Slice and the Pen tools, which is exactly why merging them is tempting
   and exactly why it is wrong. The count is not in the data file; the data file says the
   preference is on by default and does not name an exception.
6. **The exact position of the Move bar's three-dot More control, and whether it is one control or
   two.** See "The align buttons" above. The target control is sourced and the row exists; where it
   sits in the bar is a reading of four pages that all say "the More icon" without pinning its
   place or saying whether the align and distribute groups share it.
7. **A Move drag appearing in the History panel as a single entry named `Move`.** The general
   rule is sourced — "Each change you make, like selecting, painting, or rotating, is recorded
   separately" (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html`)
   and "Each change is automatically recorded as a separate history state"
   (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html`)
   — but the specific claim that one drag of a layer produces exactly one state and that the
   state is labelled `Move` is not. The data file's prose says "a single drag is a single undo
   step", which is the sourced general rule applied to a drag, and stops short of the label.
8. **The specific error Photoshop raises when a move targets a locked layer** (the "could not
   complete your request because the layer is locked" string). The _behavior_ is sourced on two
   pages and in two forms: "Lock Position: Prevents the layer's pixels from being moved", and
   "When a layer is locked, a lock icon appears to the right of the layer name"
   (`https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html`); and the
   align/distribute row greying out rather than raising anything, observed directly at
   `https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignment-with-a-reference-layer`.
   The dialog text is not, so the data file describes the refusal without quoting it. Also
   unverified: whether a **full** lock (as opposed to Lock Position specifically) blocks a move in
   current Photoshop, since the same page describes full and partial locks separately.
9. **`Cmd`-dragging to duplicate during a Free Transform.** The brief asked for this and the
   difference between it and the Windows `Alt` convention. Current Adobe documentation gives the
   duplicate as a _command_, `Ctrl+Alt+T` / `Cmd+Option+T`
   (`https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html`,
   last updated Feb 23 2026), and the Move tool's duplicate as one modifier printed as a
   Windows/macOS pair (`https://helpx.adobe.com/photoshop-elements/desktop/keyboard-shortcuts/keys-selecting-moving-objects.html`
   — "Move copy of selection — Move tool + Alt-drag selection / Move tool + Option-drag
   selection"). The data file asserts the sourced forms. A `Cmd`-drag-inside-the-box duplicate was
   not found in any Adobe page opened in this pass. Closest URL:
   `https://community.adobe.com/questions-712/alt-drag-to-duplicate-not-working-in-photoshop-1091259`,
   which is about the Alt form and is not evidence for a Cmd form.
10. **Photoshop's `Cmd+T`, `Cmd+L` and `Enter` bindings, from Adobe.** Adobe's
    default-keyboard-shortcuts page describes the Keyboard Shortcuts dialog rather than listing
    the bindings (`https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html`), and
    the Free Transform page says "Choose Edit > Free Transform" without the shortcut. The
    shortcuts in the data file come from a third-party mirror of Adobe's shipped Mac shortcut
    sheet, plus an Adobe blog post and a Peachpit excerpt that agree with it. They are
    version-stable in practice — the 2026 duplicate-and-transform page only makes sense if
    `Cmd+T` still exists — but they are not read off an Adobe page in this pass.
11. **`X` as the reset key for Black and White.** Not found, and contradicted: `X` swaps
    foreground and background colors in Photoshop's default key map, and Adobe's own route back
    from an adjustment is the Reset control
    (`https://helpx.adobe.com/photoshop/using/color-adjustments.html`). A **Preview** checkbox in
    the Black and White panel was also not found — the panel has a Reset and a Preset, and the
    current form is Properties-panel-based, where the equivalent of an old modal Preview checkbox
    is the Toggle Layer Visibility button. Closest URL:
    `https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html`.
12. **The four `Auto Options` algorithm names, and the input-slider defaults — not the 0.1%
    clipping default, which is confirmed.** An earlier version of this list called the whole
    `Auto` row single-sourced and stale, including the `0.1%`. That was wrong and is now corrected.
    Adobe states the clipping default **twice on one page**
    (`https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html`): once for
    Auto Color — "By default, Photoshop clips the black and white pixels by 0.1%—that is, it
    ignores the first 0.1% of either extreme when identifying the lightest and darkest pixels in
    the image" — and once for the command the `Auto` button belongs to — "By default, the Auto
    option and the Auto Tone command clip the white and black pixels by 0.1%—that is, it ignores
    the first 0.1% of either extreme when identifying the lightest and darkest pixels in the
    image. The default settings for the Auto option can be changed in the Auto Color Correction
    Options dialog box." Both sentences are in the data file's `Auto` row. What is still
    third-party is the **fourth algorithm name, Enhance Brightness and Contrast**, which Adobe's
    page does not name, and it is marked inline in that row as well as here. What Adobe does not
    state anywhere is the **default position of the three input sliders** (0, 1.00, 255); the rows
    now say so rather than presenting the defaults as Adobe's. The `Output` slider defaults _are_
    Adobe's, verbatim, from `https://helpx.adobe.com/photoshop/using/levels-adjustment.html`: "By
    default, the Output sliders are at level 0, where the pixels are black, and level 255, where
    the pixels are white." The `0.1%` figure and the recommended `0.0%`–`1%` range are Adobe's.
    **What changed in this pass is the black-point example: the level-5 case is ADOBE'S, not this
    description's.** `levels-adjustment.html` prints both worked cases side by side — "if you move
    the black point slider to the right at level 5, Photoshop maps all the pixels at level 5 and
    lower to level 0" and "if you move the white point slider to the left at level 243, Photoshop
    maps all pixels at level 243 and higher to level 255" — and the data file had disclaimed the
    black one as its own symmetric invention, which misstated the evidence twice over: it was
    neither Adobe's invention nor a mirror of the other. **The same page also names the Channel
    menu's abbreviations ("CM for cyan and magenta"), notes that the combined-channel route does
    not work in a Levels adjustment layer, and prints the level-128 midtone directly** ("It moves
    the midtone (level 128)") — all three are now in the data file. It also states the destructive
    half verbatim, which `purpose` now quotes: "Choosing Image > Adjustments > Levels makes direct
    adjustments to the image layer and discards image information."
13. **The 0 to 255 domain sentence attributes to the Auto option what the row needs for the
    sliders.** Adobe's wording — "This clips a portion of the shadows and highlights in each
    channel and maps the lightest and darkest pixels in each color channel to pure white (level 255) and pure black (level 0)" — is written about the Auto option for Levels and Curves and
    the Auto Tone command, not about the input sliders' resting positions. It establishes the
    **domain**; it does not establish a default. The rows were rewritten to keep those two apart
    rather than to attribute the sentence to the sliders wholesale.
14. **How many adjustment types Photoshop can save a preset for — the number is Adobe's after all,
    and it is still not restored, for a different reason than the one recorded here before.** This
    item previously said the figure was CS4-era and that "no page in this tool's `sources` supports
    it at all". **That is now false**:
    `https://helpx.adobe.com/photoshop/using/color-adjustments.html` prints the list **twice** and
    in the second printing it is explicitly a count of which adjustments can store one — "To save a
    setting in the Preset menu, choose the Save Preset option from the panel menu. **This option is
    only available for Levels, Curves, Exposure, Hue/Saturation, Black & White, Channel Mixer, and
    Selective Color.**" So "seven" is Adobe's, quoted from a page already in `sources`.

    The number is still not put back in the `Preset` row, and the reason is that it answers a
    question the row does not ask. Adobe's seven is a list of adjustment _types that can store a
    preset_; the separate figure people remember — "over 30 Adjustment Presets"
    (`https://www.adobe.com/products/photoshop/presets.html`) — is how many _named_ presets ship.
    Conflating them is how the CS4-era error happened. The row therefore keeps the round trip and
    no count: "You can save Levels settings as a preset, then apply them to other images"
    (`https://helpx.adobe.com/photoshop/using/levels-adjustment.html`). **Restoring "seven" is now
    defensible from Adobe; it is simply not the number that belongs on that row.** Do not restore it
    from the CS4 manual.

15. **`Cmd+Shift+L` is not a second Levels binding, and the data file used to say it was.** The
    `Cmd+L` shortcut row claimed "Cmd+Shift+L applies it again with the previous settings". Two
    independent third-party mirrors of Adobe's own shipped sheets contradict it and agree with each
    other on what the key is: `Cmd+Shift+L` is **Auto Tone** (`Opt+Shift+Cmd+L` on the CS6 sheet,
    `https://training-nyc.com/legacy/photoshop_cs6_all_keyboard_shortcuts_sheet.pdf`, whose
    adjacent rows are `Auto Contrast` = `Opt+Shift+Cmd+L` and `Auto Color` = `Shift+Cmd+B`), and the
    CS2 sheet prints the same shape with `Shift+L` for Auto Levels
    (`https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS2_Keyboard_Shortcuts_Mac.pdf`).
    `Cmd+L` for Levels is on both sheets and on a third page, and "Levels (last settings)" is
    Adobe's own name for the repeat form, which is the `Cmd+Option+L` the row now states. **No
    current Adobe page was found for any of these bindings** (see #10), so the row attributes
    nothing beyond the two forms it asserts.
16. **Black & White does have a keyboard shortcut, and the data file used to carry an empty
    `shortcuts` array on the strength of "none was found in any source".** Adobe's shipped CS6
    shortcut sheet prints it in the Image Adjustments block — "Black & White... **Opt+Shift+Cmd+B**"
    (`https://training-nyc.com/legacy/photoshop_cs6_all_keyboard_shortcuts_sheet.pdf`) — and an
    independent third-party page gives the same four-key form
    (`https://www.creativebloq.com/photoshop/shortcuts-1012966`, "MAC: Shift+Cmd+Opt+B"). The row
    is added, with the app's own lack of a binding stated in it. **This is still CS-era sourcing and
    no current Adobe page confirms it**; the app binds no shortcut for it either way, so the claim
    costs the user nothing if it is stale.
17. **The unit of the Move bar's and Free Transform's W/H fields, and whether they are percentages at
    all.** Both rows say "in percent". That is what the app's own sliders are and what a third-party
    walkthrough of the Move bar shows, but **no Adobe page opened in this pass states the unit** for
    either field, and Adobe documents a measurement-unit preference that presumably governs them.
    The `X`/`Y` row is safe because Peachpit prints its unit instead — "enter 100 px in the X value
    to move the item 100 pixels to the right" — and pixels are what the row's own prose implies.
    Levels' numeric domain is a different matter and is Adobe's: 0 to 255.
18. **Levels' clipping markers — the small triangles under the histogram that mark the black, gray
    and white input points and the two output points.** The brief asks for them and the data file
    has no row for them, which is the right call: **they are part of the histogram's backing track,
    not a control, and no Adobe page opened here names them.** The nearest labelled figure Adobe
    publishes is Curves', not Levels' — "H. Set black point. I. Set gray point. J. Set white point.
    K. Show clipping" (`https://helpx.adobe.com/photoshop/using/curves-adjustment.html`) — and
    Levels' own page documents the _behaviour_ behind them (Alt-drag, and "Choose Show Clipping
    For Black/White Points from the panel menu") without naming a marker. **Do not add a row without
    a Levels page that names it.** The `Histogram` row now carries the guide's own quoted
    instruction instead.
19. **Levels has no Preview checkbox, and neither does the current Black and White panel.** The
    brief asks about a Levels `Preview` checkbox and the data file correctly has no such row; the
    reason is worth writing down so the next pass does not add one. Both adjustments are
    Properties-panel-based since CS3, and the equivalent of the old modal Preview checkbox is the
    **Toggle Layer Visibility** icon — "To toggle the view of your image with and without
    adjustments, click the Toggle Layer Visibility icon in the Properties"
    (`https://helpx.adobe.com/photoshop/using/color-adjustments.html`). The current Black and White
    page lists its controls as Preset, Auto, Tint, Tint Color, the Color sliders, the On-image
    adjustment icon and the reset icon — **no Preview** — which is why the `color` table has seven
    rows and not eight.

## A fourth rail finding this pass turned up — resolved, kept because it shaped the fix

The same three were **also** live _Tools menu_ entries, in a second surface, which is the half of
the problem that made a menu rename necessary rather than a row deletion. `TOOL_MENU_ITEMS` in
`src/components/DesktopHeader/DesktopHeader.tsx` listed all three beside the comment "**a tool
missing from the Tools menu is a visible inconsistency the user has to notice and work around.**"
— so a non-tool in that list is the same defect one level up, and the inverse of the comment's
invariant, which is why both surfaces had to change together.

Two conclusions in the original finding were **wrong and did not survive**: that `Edit` was not a
menu, and that extraction had to build a menu bar. `Edit` existed and already dispatched all three
through the same handler the rail calls; it was simply carrying tool switches under a command
menu's name. The extraction added an `Image ▸ Adjustments` submenu and reshaped `Edit` to Adobe's
own single `Free Transform` item, and it removed `color`, `levels` and `transform` from the Tools
menu in the same change. A test now pins that absence.

What did survive is the reason the first surface was not the only one: a tool list is not a single
surface, and "delete three rows from `toolbarMap`" was never going to be sufficient on its own.

The same list also names the Move tool **"Reposition"** (the `Reposition` entry of
`TOOL_MENU_ITEMS` in `DesktopHeader.tsx`) where `toolbarMap`'s `Move Tool` entry in
`toolbar-mapping.ts` names it **"Move Tool"**, so the app already disagrees with itself about one
of this family's names. Not corrected here — `toolbar-mapping.ts` and the header are other people's
files.

`HANDOFF.md` §120 ("The Move tool has nine documented missing controls") is **stale against the file
it cites** in two ways, and both were introduced before this pass. First, the nine it enumerates
are **ten** names — it lists "Tool Preset Picker, Auto-Select, Auto-Select: Group, Auto-Select:
Layer, Show Transform Controls, Align, Distribute, Align to, Width, Height" — because
`Auto-Select: Group` and `Auto-Select: Layer` are now **one** row, `Auto-Select: Group / Layer`.
Second, its file list carries `src/components/ToolbarsRight/Reposition/Reposition.tsx`, and the
path is wrong: the file is `src/components/ToolbarsRight/Move/Reposition.tsx`, and the `Merge all`
button it pointed at is right inside it. The **real** list, re-derived from Adobe and the tree in
this pass, is the nine rows in the `reposition` table below — Tool Preset Picker, Auto-Select,
Auto-Select: Group / Layer, Show Transform Controls, Align, Distribute, Align to, Width, Height —
of which **seven are `missing` and two are `partial`**, the two partials being the behaviours welded
on, plus the four absent modifiers. `reposition` also has no entry in `HANDOFF.md` or
`e2e/OPEN_PROBLEMS.md` tracking any of it, which is §120's actual complaint and is still true.
