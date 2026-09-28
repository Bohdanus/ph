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
`docs/TOOLS.md` prints them verbatim, and
`scripts/__tests__/tool-descriptions.test.mjs:111` byte-compares that file against the generator's
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
- **Free Transform is reached as a command (`Edit > Transform > Free Transform`, `Cmd+T`).**
  `https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html` — "Choose
  Edit > Free Transform." and, in the very next bullet, "If you are transforming a selection,
  pixel-based layer, or selection border, choose the **Move tool**. Then select Show Transform
  Controls in the options bar." Adobe's own routing sends a pixel layer to the **Move** tool, which
  is the strongest available positive evidence that the transform state has no tool of its own.
  Corroborated by `https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html`, which
  does say "Select the Move tool (V)" — the Tools-panel phrasing Free Transform never gets.
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

**The app matches Photoshop on the stickiness.** `useCurrentTool.tsx:62` calls `saveLastSettings`
on every argument write and `useCurrentTool.tsx:32-34` reads `lastSavedSettings[toolName]` back,
so a tool's sliders are exactly where you left them when you switch away and return. That is a
genuine match, and it is worth saying so rather than only listing absences. What the app lacks is
the _reset hatch_: there is no Tool Preset Picker, and no per-tool reset outside the three
adjustment panels that carry their own Reset button. So a tool can get into a state Photoshop would
let you escape in one click, and the app offers no equivalent.

The related keyboard fact belongs to `reposition` and is recorded there, not here: Photoshop's tool
letters are **spring-loaded** — `Preferences ▸ Tools ▸ Spring-loaded Tool Shortcuts`, on by
default, and holding `V` borrows the Move tool for one gesture before releasing returns
(`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html`,
last updated Feb 23 2026). In this app the `shortcut` field on a toolbar entry is **display-only and
binds nothing**: its only two consumers in all of `src/` are `SidebarLeft.tsx:258`, which passes
it to `ToolTooltip`, and `SidebarLeft.tsx:431`, which renders it as a `<kbd>` badge. The app does
implement letter-key activation, but from a separate hand-written table in
`AppKeyboardShortcuts.tsx` where `V` is at `:216-221` — and that handler has no keyup half, so
there is no spring-loaded behaviour to have.

## `ctx.filter` — the string, and which canvas it lands on

The research corpus dated 2026-09-26 called a `ctx.filter` implementation a shipping blocker.
**One thing about it changed, one thing was never true, and one is unchanged.**

Changed: the template is not copied. `src/tools/functions.ts:60` and `:66` own the two filter
strings, and every consumer routes through them, so there is one string per tool rather than
several that could drift.

**Never true, and this is the correction that matters: the `OffscreenCanvas` processors are not on
the editing, preview or commit path for `levels` or `color`.** Both are registered
`commit: 'layer-operation'` (`src/tools/toolProcessors.ts:125` and `:131`), and
`src/contexts/useLayer.ts:536-545` handles that kind by appending an operation to the layer's
`operations` array, nulling `tmpCanvas` and **returning** — the `processor.imageProcessor(...)`
call is at `:571`, past that return, and nothing in the editing path reaches it. Undo and redo
take the same route (`src/contexts/history-replay.ts:152-160`, which appends the same operation
and continues), so a committed Levels or Colors adjustment is **retained, not destroyed**: the
layer's own bitmap is never touched, the renderer re-derives the filter from the operations array
on every frame (`src/contexts/layer-renderer.ts:77`), and no raster of the adjustment is stored
anywhere. The earlier text in this file called this "the destructive half (research decision D3)"
and described a Safari-inert write on the editing path; both were wrong, and the destructive claim
was the most user-damaging sentence in the family — it told a user their pixels were gone when
they are not.

**What the editing path actually uses is an ordinary canvas element.** `drawLayersToCanvas`
builds a staging canvas with `document.createElement('canvas')`
(`src/contexts/layer-renderer.ts:120`) and `drawLayerSource` assigns `ctx.filter` from
`getLayerFilter(layer.operations)` at `:77`, on that `HTMLCanvasElement`'s 2D context. The
document canvas itself is an `HTMLCanvasElement` (`src/contexts/StoreContext.tsx:84`,
`useRef<HTMLCanvasElement | null>` at `:771`).

Unchanged, and now correctly scoped: the `OffscreenCanvas` surface is the **durable materializer**
only. `src/contexts/materialization.ts:52-63` prefers `new OffscreenCanvas(...)` wherever one
exists, and `filterForOperation` at `:73-89` applies the same string there. The
`OffscreenCanvasRenderingContext2D.filter` support Safari has never shipped is therefore a property
of that surface, not of the canvas the user is editing on. Note also that **no module outside
`src/contexts/__tests__/` imports `materialization.ts`** — the durable document is a shadow, and
that materializer is currently reached by its own tests only. `src/tools/levels.ts:12` and
`src/tools/colors.ts:12` still build the same string into an `OffscreenCanvas` 2D context, and
both are unreached processors for these two commit kinds; they are cited in the data file because
they are the registered processors, not because editing runs them.

**The Brightness mapping, stated exactly, because the old note had it inverted.** The re-anchored
exponential in `src/tools/functions.ts:36-39` is a table, and the table is:

| `val`  | factor | emitted  |
| ------ | ------ | -------- |
| `-100` | `0`    | `0%`     |
| `0`    | `1`    | `100%`   |
| `+100` | `> 1`  | `> 100%` |

So **0 is the neutral**, emitting exactly `brightness(100%) contrast(100%)`, and it is the
**minimum** of −100 that emits `brightness(0%)`. `src/tools/__tests__/functions.test.ts:31-36`
pins both literals by name ("emits the neutral as brightness(100%) contrast(100%)", "reaches black:
-100 brightness emits brightness(0%)"). `defaultSettings.levels` is `{ brightness: 0, contrast: 0 }`
(`src/tools/settings.ts:49`), so the panel at rest applies nothing.

The test harness defect the corpus also flagged **is** fixed. `src/test/setup.ts:317-320` replaces
the old swallowing setter with a real data property, with the reason in the comment — a getter
that always returned `''` made every assertion about filter application assert nothing. The
emitted string is now observable, and `src/tools/__tests__/functions.test.ts` pins the exact
literals for both tools. What the mock still cannot do is rasterize: the globally installed
context has no read-back at all (`src/test/setup.ts:327-331`), and the opt-in pixel context
returns a zero-filled array (`:337`). So the string is pinned and the pixels are not.

Net for the descriptions: `levels` and `color` are `partial`, and the divergence recorded for each
is not "the app has fewer controls" but "the app has a different engine in a different color
space, on a surface that is a plain canvas element rather than the `OffscreenCanvas` the durable
shadow would use".

## Census

| tool         | options rows | present | partial | inert | missing |
| ------------ | ------------ | ------- | ------- | ----- | ------- |
| `reposition` | 8            | 0       | 0       | 0     | 8       |
| `transform`  | 10           | 1       | 6       | 0     | 3       |
| `levels`     | 12           | 0       | 1       | 0     | 11      |
| `color`      | 7            | 0       | 1       | 0     | 6       |

`reposition` was 9 rows and is 8: the `Align to` row was removed, not downgraded. It is recorded
under "The align buttons" below — there is no Adobe page naming a bar control for the align target,
and the menu sentence does not imply one.

**`reposition` has two `partial` rows, and they are `partial` on a behaviour, not on a control.**
`Auto-Select` and `Show Transform Controls` have been through both wrong answers. The first pass
filed them `partial` on the strength of the _behaviour_ each describes — the tool does hit-test to
the layer under the pointer, and the shared `useRect` overlay does draw corner handles on the
active layer — without noticing that the behaviour is _unconditional_, which is the whole point.
A later pass then swung both to `missing` on the reading that the app does not render them. That
is the opposite error, and the contract settles it: `types.ts` names "a control welded to one of its
states" as an explicit marker of `partial` on the `implementation` value, and
`src/tools/descriptions/__tests__/toolDescriptions.test.ts:86` only withholds the `appRef`
requirement from a `missing` row. A checkbox that is permanently on is a behaviour the app has and
the user cannot turn off, which is a divergence from Photoshop's default, not a capability the app
lacks. Both rows are therefore `partial` again.

The Move options bar renders three items (`src/components/ToolbarsRight/Move/Reposition.tsx`: the
active layer's name, a Merge all button and a hint), and a search of `src/` and `e2e/` for
`auto-select` / `autoSelect` / `showTransformControls` finds no control anywhere — the only matches
are this family's own prose. So there is no _control_ to cite, and the `appRef` on each row is the
behaviour the app performs instead: `MoveToolArea.tsx:176` for the hit test that resolves and
activates the layer under the pointer, and `MoveToolArea.tsx:117` for the `useRect` call that draws
the handles. `appNotes` says so on the record, because an `appRef` that is not a rendering of a
control is otherwise indistinguishable from a mis-derived one.

**`levels` lost two `partial` rows in this pass too, and the census above follows the data file.**
The per-tool table in "## `levels`" below previously marked `Input Levels: black point` and
`Input Levels: white point` as `partial` against the Brightness and Contrast sliders. The data file
has both as `missing`, which is the correct reading — the app's Brightness slider is not Photoshop's
black point, and its Contrast slider is not the white point, so neither row is a control that exists
and diverges. The table below is corrected to match.

No row is `inert`. `inert` is for state declared in `src/tools/settings.ts` and rendered by no
component, and all four of these tools' declared state is read by a component that renders it —
`settings.ts:48` (color), `:49` (levels), `:50-61` (transform) and `:90` (reposition) each back a
control that exists. The interesting result is the other direction: `levels` and `color` have
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

| control                    | what it is in Photoshop                                                                                                                       | status  | appRef                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------ |
| Tool Preset Picker         | Tool icon + flyout at the far left; Control-click for Reset Tool / Reset All Tools. The escape hatch from per-tool stickiness                 | missing |                                            |
| Auto-Select                | Checkbox; resolves the target by hit test to the topmost layer with pixels under the cursor, rather than moving the active layer              | partial | `src/components/Main/MoveToolArea.tsx:176` |
| Auto-Select: Group / Layer | Menu beside the checkbox: Layer takes the individual layer, Group takes the whole group it belongs to                                         | missing |                                            |
| Show Transform Controls    | Checkbox that puts the transform box and handles on the selected layer _without_ entering transform mode; dragging a handle is what starts it | partial | `src/components/Main/MoveToolArea.tsx:117` |
| Align                      | Six buttons at 2+ selected: Top Edges, Vertical Centers, Bottom Edges, Left Edges, Horizontal Centers, Right Edges                            | missing |                                            |
| Distribute                 | The distribute row at 3+ selected: the same six commands to space layers evenly, plus the Horizontally and Vertically spacing buttons         | missing |                                            |
| Width                      | Numeric percent text box for layer width, with the Link icon on by default since 21.0                                                         | missing |                                            |
| Height                     | Numeric percent text box for layer height, linked to Width                                                                                    | missing |                                            |

**Show Transform Controls** is the row that is easiest to get backwards, and the row that this pass
corrected. The _Photoshop_ formulation is the one to keep: checking the box does _not_ start a
transform, it puts the handles on the layer, and the transform starts when a handle is dragged.
That is exactly why it exists — it is how you scale and rotate a layer without entering `Cmd+T`,
and Adobe's Free Transform page reaches the same state the long way round ("choose the Move tool.
Then select Show Transform Controls in the options bar").

The **app** renders no such checkbox, so the behaviour is welded on and the row is `partial` on
that, not on a control it can point at. It was previously `partial` on the reasoning that "the
overlay and its handles do render (`MoveToolArea.tsx:117`)" — which conflates the control with the
overlay, and then a later pass swung it to `missing`, which is the opposite error: `types.ts` names
"a control welded to one of its states" as a `partial` marker, and a row whose behaviour is
permanently on is not a capability the app lacks. What renders at `MoveToolArea.tsx:117` is the
`useRect({ isMoveTool: true })` call that draws a **plain resize rectangle** on whichever layer is
active, unconditionally: no checkbox gates it, so the citation is the behaviour and not a control,
and that is what the row's `appRef` names. It is a resize rect — no rotation outside the box, no
numeric W/H, no reference point. The geometric half of the tool is gone, and with it the two
things `Cmd+T` and Move are supposed to share. **Auto-Select** is the same shape and is argued at
length further down: the hit test at `MoveToolArea.tsx:176` always runs, and its `appRef` is that
line for the same reason.

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
- The **target is separate from the command, and the bar does not express the choice**. Adobe
  splits it as two submenus, `Layer > Align` (align to the selected layers) and `Layer > Align
Layers To Selection` (align to a selection border), and then says "These same commands are
  available as Alignment buttons in the Move tool options bar" — which is the sentence that ties
  the menu to the bar. That sentence names the two targets as **menu** submenus and says nothing
  about a bar control for choosing between them. **There was an `Align to` row here and it was
  removed**: it described a four-way target menu (Selection / Canvas / Layer / Group) whose only
  source is the third-party `https://www.photoshopbuzz.com/how-to-align-layers`, which names an
  `Align To:` setting in the bar as a selection rather than as a modifier. One third-party page is
  not enough to put a control in the data file, and no Adobe page corroborates it. The content is
  folded into the `Align` row as the fact it actually is — two targets, chosen in the menu — and
  the data file records that no Adobe page names a bar control for it. Do not re-add the row
  without an Adobe page.
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
distribute controls go grey rather than Photoshop attempting the move and raising a dialog. The
app's behaviour is neither — the layer moves, because nothing reads `locked`.

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

The refusal divergence is worth stating precisely because it is easy to get backwards.
`Layer` carries a `locked` flag (`src/contexts/layer-types.ts:59`) and the app imports PSD lock
state into it, but the Move tool never reads it. The only layer the tool refuses is a bedrock one
(`src/components/Main/MoveToolArea.tsx:197-204`), so a layer the user has locked is still
draggable, and the app's lock is a PSD round-trip field rather than an editing constraint.

**Implementation: `partial`.** This section previously said `implemented` and the data file says
`partial`; the data file is the contract and the note was stale. The gesture itself is a single
committed history entry — `MoveToolArea.tsx:132` calls `updateLayerByTool` once on change-end, and
`src/tools/reposition.ts:12` returns `[bitmap, move]` without rasterizing, so a move is a position
patch and nothing is resampled. `src/tools/toolProcessors.ts:113` declares `commit: 'geometry'`,
which is the right kind for a tool whose output is a rectangle. What holds it back from
`implemented` is the one overlay the app does draw: it renders a resize rect where Photoshop renders
a transform box, which is a control that contradicts Photoshop rather than one that is merely
absent. Every _absent_ control on its own is a gap, and gaps do not make a tool `partial`.

### reposition sources

- https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html _(the tool page: `V`, element drag, and "Alignment and Distribution" as the bar's two named groups)_
- https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html _(Lock Position; Auto Select in the Move bar)_
- https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html _(Show Transform Controls as the route to the transform state)_
- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-content-of-layers-and-groups.html _(the six align commands and their per-command semantics, 2026)_
- https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html _(Auto-Align as the `Edit > Auto-Align Layers` command; the Projection section; the locked reference layer)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html _(spring-loaded tool shortcuts, Feb 23 2026)_
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html
- https://helpx.adobe.com/photoshop-elements/desktop/keyboard-shortcuts/keys-selecting-moving-objects.html _(Adobe, but a different product: the arrow-key nudge and the Alt-drag duplicate)_
- https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html
- https://helpx.adobe.com/photoshop-elements/using/moving-copying-selections.html _(Adobe Elements; Auto Select Layer, Show Bounding Box, the Align and Distribute menus and their 3-layer minimum)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html
- https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html _(the localized page that carries the older and fuller text: `Layer > Align` vs `Layer > Align Layers To Selection`, "These same commands are available as Alignment buttons in the Move tool options bar", the distribute commands, Horizontally/Vertically, the 3+ minimum, and the Shift-click / Ctrl-click selection rules)_
- http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Move_tool.html _(third party, CS6-era: the Group/Layer menu, and the bar swapping to numeric transform fields on a handle press)_
- https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html _(Adobe blog: the Tool Preset Picker by name, Reset Tool / Reset All Tools, spring-loaded cursors)_
- https://www.photoshopessentials.com/basics/layers/align-layers _(third party: the greyed-out row at one layer, the six align buttons in bar order, group-as-one-unit alignment)_
- https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignment-with-a-reference-layer _(third party, direct observation: a locked layer greys out align and distribute)_
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

| control                                      | what it is in Photoshop                                                                      | status  | appRef                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| Width                                        | Numeric percent text box                                                                     | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:253` |
| Height                                       | Numeric percent text box, linked to Width                                                    | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:268` |
| Maintain Aspect Ratio (Link)                 | Proportional-scaling toggle, on by default since 21.0; Shift is bound to the same state      | missing |                                                            |
| Reference point location                     | 3×3 pivot grid, hidden by default; transforms start from the object center                   | missing |                                                            |
| Rotation                                     | Numeric degrees text box; the same angle comes from dragging outside the box                 | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:182` |
| Skew H                                       | Numeric degrees text box                                                                     | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:202` |
| Skew V                                       | Numeric degrees text box                                                                     | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:218` |
| Switch Between Free Transform And Warp Modes | Button that swaps the box for a warp mesh, plus the Warp pop-up of predefined styles         | missing |                                                            |
| Commit                                       | The checkmark; also Enter, another tool, a layer click, or a click outside the canvas or box | partial | `src/components/ToolbarsRight/Transform/Transform.tsx:303` |
| Cancel                                       | The cancel button; also Esc                                                                  | present | `src/components/ToolbarsRight/Transform/Transform.tsx:306` |

Every numeric control is `partial` for the same reason: the app renders a **range slider**, not a
text box, and the ranges are the app's own. Rotation is clamped to ±90° with 90/180/360 reachable
only through three separate buttons, skew to ±45°, scale to 10–300%. Photoshop's fields accept
any value in those units, and the Link icon that couples Width and Height has no counterpart at
all, so the app can scale a layer non-proportionally by dragging one slider and cannot be
coupled. `Cancel` is the single `present` in the family because the app binds both the button and
Escape, which is exactly Photoshop's pair.

The `Trapezoid` slider is the app's own addition and has no Photoshop options-bar counterpart.
Its nearest Photoshop relative is Free Transform's Perspective mode, which is reached by
`Cmd+Option+Shift`-drag, not by a percentage, and the two are not interchangeable: `Trapezoid` is
a projective taper about the horizontal centerline, and the app makes it **mutually exclusive**
with everything else — moving it resets rotation, both skews and both scales to their defaults
(`Transform.tsx:128-141`), and the processor refuses a trapezoid combined with a retained affine
transform rather than composing them (`src/tools/transform.ts:153`,
`src/contexts/affine-transform.ts:216`). It is also the one path that rasterizes, by solving a
homography, while every other parameter stays a retained affine
(`src/contexts/affine-transform.ts:173`).

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
(`src/components/Common/AppKeyboardShortcuts.tsx:277-282`) and there is no `Cmd+T` registration
anywhere; the tool has no accelerator at all in `toolbar-mapping.ts:64`.

**The commit routes are Apply, tool switch and export — Escape is not one of them, and an earlier
version of this file said it was.** The `Escape` handler at
`src/components/ToolbarsRight/Transform/Transform.tsx:35-43` calls the same `cancel` the Cancel
button calls (`:30-33`), and `cancel` runs `cancelLayerPreview?.()` and resets the panel args. It
dispatches nothing: it deletes the pending preview, so what survives is the last committed state.
That is the discard route, and it is the exact counterpart of the commit route —
`commitDirtyTool` (`src/contexts/useLayer.ts:345`) is what bakes the preview into a layer plus one
history entry, and its callers are the Apply button (`Transform.tsx:303`), `goToTool`
(`src/hooks/useApp.ts:167-169`, which is the tool-switch path every toolbar click and letter
shortcut runs through) and the export handlers (`src/components/DesktopHeader/DesktopHeader.tsx:234`,
`src/components/Mobile/MobileHeader.tsx:70`, `src/components/Mobile/MobileMenuDrawer.tsx:71`).
There is no intra-transform undo, which is a real omission: Photoshop can step back and forth
inside a live transform.

**Implementation: partial.** The declared composite order is fixed — scale, then rotation, then
skew, all about the untransformed layer center (`src/contexts/affine-transform.ts:171-173`) —
where Photoshop composes handle drags in the order they happen. Nothing in the panel is
handle-driven, so the app's transform is a parameter set applied at once rather than a continuous
operation, which is the property the command exists for.

### transform sources

- https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/adjust-scale-rotation-and-perspective.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/apply-transformations.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html
- https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html _(Adobe, but a different product; used for the modifier table, whose Photoshop equivalent is stated verbatim on the Free Transform page for all but the skew row)_
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html
- https://jkost.com/blog/2019/06/new-free-transform-preference-in-photoshop.html _(Adobe blog)_
- https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf _(third-party mirror of Adobe's shipped shortcut sheet; the only route to `Cmd+T` / `Cmd+Option+T` / `Enter`, since Adobe's own default-shortcuts page describes the dialog rather than listing the bindings)_
- https://glensmith.co.uk/photoshop/tools _(third party, but the load-bearing citation for the command-not-tool claim: a complete, version-stamped — "every tool in the Photoshop 2026 toolbar", page updated 21 September 2026 — enumeration of the whole Tools panel in toolbar order, containing no Transform entry under any name)_
- https://www.adobe.com/products/photoshop/resize-image.html _(Adobe marketing copy, and the source of the counter-sentence "Select the Transform tool by pressing Ctrl + T (Cmd + T for Mac)" — the same paragraph's next clause is "You can also go to Edit > Free Transform", which is why the sentence does not carry a Tools-panel claim)_

## `levels` — Levels

Levels is the tonal tool, and the app's `levels` is Brightness/Contrast under its name. That is
the corpus's Note B and it survives inspection of the current tree unchanged: two sliders, no
histogram, and a filter string of `brightness() contrast()`.

| control                     | what it is in Photoshop                                                                                                                                           | status  | appRef                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
| Preset                      | Menu of saved settings, with Save Preset beside it                                                                                                                | missing |                                                      |
| Channel                     | RGB, or an individual Red / Green / Blue channel, or a combination selected in the Channels panel. Defaults to RGB                                                | missing |                                                      |
| Histogram                   | The distribution graph drawn behind the three input sliders; the guide you read to decide where the points belong                                                 | missing |                                                      |
| Input Levels: black point   | Left slider on the 0–255 domain, at 0 — a default Adobe does not state. At level 5, everything at 5 and below maps to 0 (this description's own case)             | missing |                                                      |
| Input Levels: midtone gamma | Middle slider, "adjusts the gamma in the image"; at 1.00, a default Adobe does not state; left lightens, right darkens                                            | missing |                                                      |
| Input Levels: white point   | Right slider, at 255 — a default Adobe does not state. Adobe's own case: at 243, everything at 243 and above maps to 255                                          | missing |                                                      |
| Output Levels: black        | Left output slider, default 0 — Adobe's stated Output-slider default; the level the black point maps to                                                           | missing |                                                      |
| Output Levels: white        | Right output slider, default 255 — the other half of Adobe's stated Output-slider defaults                                                                        | missing |                                                      |
| Auto                        | Clips a small fraction of shadows and highlights per channel and maps the remaining extremes to pure black and white. Adobe: 0.1% clipping, 0–255 domain          | missing |                                                      |
| Auto Options                | Opens Auto Color Correction Options: chooses the algorithm and sets the clipping percentages. Adobe recommends 0.0%–1%. Three of four algorithm names are Adobe's | missing |                                                      |
| Eyedroppers                 | Set Black Point, Set Gray Point, Set White Point. Using them discards any adjustment already made, so Adobe advises using them first                              | missing |                                                      |
| Reset                       | Returns the adjustment to its original settings                                                                                                                   | partial | `src/components/ToolbarsRight/Levels/Levels.tsx:138` |

Every one of those eleven rows is `missing`, and the two that were `partial` until this pass were
`partial` by association rather than by resemblance. The app's nearest analogue to the black point
is its **Brightness** slider, which is a flat linear multiply with a re-anchored exponential
response (`src/tools/functions.ts:14-16`, `:36-39`, `:66-70`), and the nearest analogue to the white
point is its **Contrast** slider, which pivots around mid-gray in encoded space where Photoshop's
curve is piecewise-linear through three control points with its midpoint fixed at level 128.
**Neither app slider is a Photoshop Levels control.** An association between two things is not a
control that exists and diverges, which is what `partial` means, so the count of `present` rows here
is zero and the count of `partial` rows is one: the table describes Photoshop's panel, and the app's
panel and Photoshop's share no rows in it.

**And the mapping, which this file previously had inverted.** 0 on the Brightness slider is the
**neutral** — the re-anchoring makes it emit exactly `brightness(100%) contrast(100%)`, so the panel
at its defaults (`src/tools/settings.ts:49`) applies nothing at all. It is the **minimum**, −100,
that emits `brightness(0%)` and multiplies the layer to black. The earlier sentence here said "at
zero it makes the image darker without clipping anything"; that is false, and the table in
`src/tools/functions.ts:22-30` and the two named literals in
`src/tools/__tests__/functions.test.ts:31-36` are the correction.

Two version- and space-dependent facts are load-bearing and are in the prose. Levels operates on
the document profile's **encoded** values; Adobe draws the contrast with Exposure, which
"performs calculations in a linear color space"
(`https://helpx.adobe.com/photoshop/using/color-adjustments.html`).

**And the destructive / non-destructive split, which this file also previously had backwards.**
`Image > Adjustments > Levels` discards image information, while the adjustment layer stays
editable — and **this app is the non-destructive half, not the destructive one** (the earlier
"research decision D3" said the opposite, and was wrong). A committed adjustment is a retained
layer operation: `useLayer.ts:536-545` appends it to `layer.operations` and returns before any
pixel is produced, `useLayer.ts:345` publishes that layer plus one `TOOL_ACTION` history entry, and
`history-replay.ts:152-160` replays the operation rather than a stored raster, so undo and redo
both work. What the app does not have is the _re-editability_ half: a committed adjustment cannot
be reopened, so it can only be taken back with undo. That is also what the Reset button is not —
it is disabled unless an uncommitted preview is live (`Levels.tsx:63`, `:141`) and restores the
panel's own defaults, so it is a preview cancel and not an adjustment reset.

| keys                           | action                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `Alt` (Win) / `Option` (macOS) | hold while dragging the black or white input slider to preview clipping |

| keys    | action                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------- |
| `Cmd+L` | apply Levels; `Cmd+Shift+L` re-applies with the previous settings, `Cmd+Option+L` with the last settings used |

The app binds no shortcut for `levels` (`toolbar-mapping.ts:63`).

**Implementation: partial.** Zero of twelve rows are `present` and one is `partial`. See the
`ctx.filter` section above for the engine — and note that the engine claim it used to end on, an
`OffscreenCanvas` context on the editing path, was wrong: these two tools commit as retained layer
operations and never reach their `OffscreenCanvas` processors.

### levels sources

- https://helpx.adobe.com/photoshop/using/levels-adjustment.html
- https://helpx.adobe.com/photoshop/using/adjust-color-tone-levels-curves.html
- https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html _(the 0–255 domain verbatim; the 0.1% clipping default, twice; the 0.0%–1% recommendation for the Clip boxes)_
- https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
- https://helpx.adobe.com/photoshop/using/color-adjustments.html
- https://helpx.adobe.com/ca/photoshop/web/edit-images/color--tone--and-lighting/modify-tones-with-levels-adjustment.html _(localized mirror; the `RGB, Red, Green, or Blue` channel list)_
- https://www.adobe.com/learn/photoshop/web/photoshop-improve-tones-levels _(Adobe Learn; the non-destructive adjustment-layer half)_
- https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf _(third-party mirror of Adobe's shipped shortcut sheet; `Cmd+L`)_
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

| control                  | what it is in Photoshop                                                                                                   | status  | appRef                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| Preset                   | Menu of predefined grayscale mixes and saved custom mixes, with Save Black & White Preset beside it                       | missing |                                                     |
| Auto                     | Sets a grayscale mix based on the image's own color values                                                                | missing |                                                     |
| Tint                     | Checkbox that lays a uniform tone color over the monochrome result                                                        | missing |                                                     |
| Tint Color               | The swatch beside Tint; opens the Color Picker, and the tone it applies is called Tint Color                              | missing |                                                     |
| Color sliders            | Six sliders, in bar order: Reds, Yellows, Greens, Cyans, Blues, Magentas. Adobe ships them at 40 / 60 / 40 / 60 / 20 / 80 | missing |                                                     |
| Reset                    | The reset icon that returns the sliders to their defaults                                                                 | partial | `src/components/ToolbarsRight/Colors/Color.tsx:183` |
| On-image adjustment icon | The icon dragged off the panel onto the image, dropping a target marker so one sextant can be adjusted on the picture     | missing |                                                     |

The app's Grayscale, Sepia and Saturation sliders are **not** in this table, and that is the whole
finding rather than an omission from it. The types contract requires each row to be named in
Photoshop's options bar, and none of the three is a Black and White control. Grayscale is the
nearest thing to the sextant block as a whole and cannot stand in for it, because a hue-weighted
mix and a luminance average diverge the moment any family is pushed. Sepia is not Tint: Tint is a
uniform tone color laid over a conversion whose mix you still control, whereas Sepia is a second
filter stage applied to the whole image, so the two compose into a look neither produces alone.
Saturation belongs to no part of Black and White at all — it is a Hue/Saturation control, and its
presence is a leftover from the identity question D1 settled. All three start at 0
(`src/tools/settings.ts:48`), which is a true no-op: the neutral emits
`grayscale(0%) sepia(0%) saturate(100%)` and that literal is pinned by test.

Black and White binds no modifier and no keyboard shortcut in the data file, because none was
found in any source. That is a finding, not a gap in the research — see `## Unverified`.

**Implementation: partial.** Zero of seven rows are `present`. The engine is the shared CSS filter
string, applied to a plain canvas element on the editing path and to an `OffscreenCanvas` only in
the durable materializer — see the `ctx.filter` section above.

### color sources

- https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html _(Preset, Auto, Tint, Tint Color, color sliders, on-image adjustment icon, reset icon)_
- https://helpx.adobe.com/photoshop/using/color-adjustments.html _(Black & White as a color adjustment command; the Reset button; presets)_
- https://helpx.adobe.com/photoshop/using/color-monochrome-adjustments-using-channels.html _(the contrast case — monochrome via Channel Mixer presets, not Black & White)_
- https://www.photoshopessentials.com/photo-editing/black-and-white-cs3 _(third party; the sextant order and the 40 / 60 / 40 / 60 / 20 / 80 defaults, which Adobe's own page does not print)_
- https://www.photoshopessentials.com/photo-effects/easy-selective-color-effect-with-photoshop _(third party; the six sliders named as three primaries plus three secondaries)_
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
   `Align To:` setting in the bar as a selection, not as a modifier, and which is the only page
   anywhere that names that control — which is why the `Align to` row was removed rather than
   kept.
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
4. **The 200 ms default for spring-loaded tool shortcuts.** The mechanism and the preference are
   sourced — `Preferences ▸ Tools ▸ Spring-loaded Tool Shortcuts`, on by default, hold the key to
   borrow the tool and release to get it back
   (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html`,
   `https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html`).
   The **number** is third-party only ("Leaving the sensitivity at the default 200 milliseconds",
   `https://photoshopguides.github.io/Tools`), and Adobe's page does not print a default. The
   figure is therefore not in the data file; the data file says the preference is on by default
   and does not give a timing.
5. **A Move drag appearing in the History panel as a single entry named `Move`.** The general
   rule is sourced — "Each change you make, like selecting, painting, or rotating, is recorded
   separately" (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html`)
   and "Each change is automatically recorded as a separate history state"
   (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html`)
   — but the specific claim that one drag of a layer produces exactly one state and that the
   state is labelled `Move` is not. The data file's prose says "a single drag is a single undo
   step", which is the sourced general rule applied to a drag, and stops short of the label.
6. **The specific error Photoshop raises when a move targets a locked layer** (the "could not
   complete your request because the layer is locked" string). The _behavior_ is sourced on two
   pages and in two forms: "Lock Position: Prevents the layer's pixels from being moved", and
   "When a layer is locked, a lock icon appears to the right of the layer name"
   (`https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html`); and the
   align/distribute row greying out rather than raising anything, observed directly at
   `https://graphicdesign.stackexchange.com/questions/16757/how-to-control-alignment-with-a-reference-layer`.
   The dialog text is not, so the data file describes the refusal without quoting it. Also
   unverified: whether a **full** lock (as opposed to Lock Position specifically) blocks a move in
   current Photoshop, since the same page describes full and partial locks separately.
7. **`Cmd`-dragging to duplicate during a Free Transform.** The brief asked for this and the
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
8. **Photoshop's `Cmd+T`, `Cmd+L` and `Enter` bindings, from Adobe.** Adobe's
   default-keyboard-shortcuts page describes the Keyboard Shortcuts dialog rather than listing
   the bindings (`https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html`), and
   the Free Transform page says "Choose Edit > Free Transform" without the shortcut. The
   shortcuts in the data file come from a third-party mirror of Adobe's shipped Mac shortcut
   sheet, plus an Adobe blog post and a Peachpit excerpt that agree with it. They are
   version-stable in practice — the 2026 duplicate-and-transform page only makes sense if
   `Cmd+T` still exists — but they are not read off an Adobe page in this pass.
9. **`X` as the reset key for Black and White.** Not found, and contradicted: `X` swaps
   foreground and background colors in Photoshop's default key map, and Adobe's own route back
   from an adjustment is the Reset control
   (`https://helpx.adobe.com/photoshop/using/color-adjustments.html`). A **Preview** checkbox in
   the Black and White panel was also not found — the panel has a Reset and a Preset, and the
   current form is Properties-panel-based, where the equivalent of an old modal Preview checkbox
   is the Toggle Layer Visibility button. Closest URL:
   `https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html`.
10. **The four `Auto Options` algorithm names, and the input-slider defaults — not the 0.1%
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
    the pixels are white." The `0.1%` figure and the recommended `0.0%`–`1%` range are Adobe's;
    the black-point worked example at level 5 is this description's own, mirroring Adobe's own
    level-243 example on the white point.
11. **The 0 to 255 domain sentence attributes to the Auto option what the row needs for the
    sliders.** Adobe's wording — "This clips a portion of the shadows and highlights in each
    channel and maps the lightest and darkest pixels in each color channel to pure white (level 255) and pure black (level 0)" — is written about the Auto option for Levels and Curves and
    the Auto Tone command, not about the input sliders' resting positions. It establishes the
    **domain**; it does not establish a default. The rows were rewritten to keep those two apart
    rather than to attribute the sentence to the sliders wholesale.
