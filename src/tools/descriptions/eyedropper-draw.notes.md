# Eyedropper and Draw — research notes

Family: `eyedropper`, `draw`. Data: `src/tools/descriptions/eyedropper-draw.ts`. Every source
reference below names a unit — a declaration, a field, an `it(...)` title, a section — and each was
re-derived against the tree in this worktree, not copied from the research corpus.

**Two passes, two verdicts, and the second one moved three of this file's load-bearing facts.** The
first pass found the Eyedropper's Sample Size truncated to three entries and its `Sample All Layers`
checkbox rendered but disabled, and recorded both as `partial` and `inert` on that reading. Neither
is true of the tree any more: the Sample Size list is now all seven of Adobe's entries, and the
checkbox has been deleted outright. A later pass also found the `Alt` modifier fully implemented
while this file listed it among the divergences. Both corrections are below, and both were verified
against the code before any prose moved.

## What this pass found

Four of the four divergence claims the `eyedropper` record asserted were checked against the code,
and **two are false, one is true, and one is true**:

| Claim                                                             | Verdict   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sample is taken at pointer-down alone; no move or up handler      | **TRUE**  | `EyedropperToolArea.tsx` — `handlePointerDown()` is the only handler in the file, wired as `onPointerDown` on the root `<div>`; a grep for `onPointerMove`/`onPointerUp`/`onPointerCancel` in the file finds nothing                                                                                                                                                                                                                  |
| `Sample All Layers` is a permanently unchecked, disabled checkbox | **FALSE** | The bar renders one `<select>`. `Eyedropper.test.tsx` — the `it('renders no Sample All Layers control at all, disabled or otherwise')` title — pins the absence                                                                                                                                                                                                                                                                       |
| No modifier can redirect the sample to the background swatch      | **FALSE** | The `dispatch()` inside `EyedropperToolArea.tsx` — `handlePointerDown()` reads `event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR'`. Only the **layer** half of the claim survives                                                                                                                                                                                                                                                   |
| `I` selects outright and `Shift+I` re-selects                     | **TRUE**  | Two plain `i` registrations in `AppKeyboardShortcuts.tsx` — the one beside the `v` registration, and the second under the comment explaining that the three single-tool tiles get one plain registration each — with no `shift: true`; `useKeyboardEvents.tsx` — the `shift` arm of `matchesShortcut()` — skips the matcher when `shift` is undeclared, and the hook has no key-up listener at all, so there is no spring-load either |

Two of those are the shape this review exists to catch: an unverified divergence claim is as wrong as
an unverified fidelity claim, and both of the false ones were pointing at a **working** feature (a
seven-entry Sample Size list that was recorded as three entries, an Alt modifier recorded as absent)
while a third pointed at a defect that had already been fixed in the tree.

`Sample Size` moved `partial` → **`present`** on that first finding, and the whole family's source
citations were re-derived rather than nudged — thirty-one of them were stale, and the drift table at
the end lists each with the unit it points at now.

## What the corpus already had: nothing

Searched `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/01-photoshop-reference.md` for
`Eyedropper|eyedropper|Draw Tool`. Two hits, neither a section on either tool: line 176 records
`Alt/Option = temporary Eyedropper` as a Brush modifier, and line 624 counts three eyedroppers in
an unrelated list. There is **no Eyedropper Tool section and no Draw Tool section in the corpus**.

`03-ui-chrome-spec.md` is the options-bar contents table. It has rows for Move, Rect. Marquee,
Lasso, Magic Wand, Crop, Brush, Pencil, Color Replacement, Blur, Shape, Pen, Horizontal Type and
Adjustments. **Neither the Eyedropper nor the Draw appears as a row**, so the table gave no control
list for this family either. This family is 100% fresh research, on both the Photoshop side and the
control census.

One correction to the brief: the mapping file is `toolbar-mapping.ts` at the **repository root**,
not under `src/`. The test that imports it reaches it as `../../../../toolbar-mapping.ts`. Its
Eyedropper entry is the tile the brief names, `[{ label: 'Eyedropper Tool', name: 'eyedropper',
shortcut: 'I' }]`, and its Draw entry is the Draw Tool tile at the end of the tonal group.

## Eyedropper Tool

### The name, settled

`photoshopName` is `Eyedropper Tool`, and the brief's three candidate names resolve as follows.

- **It is the Tools-panel name.** Adobe's own help writes it in prose as "the Eyedropper tool"
  (`https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html`, page title "Sample
  image colors with the Eyedropper tool", last updated Mar 22, 2024), and Adobe's Tools-panel-level
  references capitalize it as a tool label — "Eyedropper Tool" is how `I` is labelled in the modern
  Tools-panel inventory at `https://video.pie-menu.com/adobe-photoshop-cheat-sheet.pdf` (2024-08-18),
  in the same line that names the group: "Eyedropper, Color Sampler, Ruler, Note, and Count Tool I".
  Adobe's own page for the tool's controls uses the same capital-T form: "Use the **Options Bar** to
  customize tool settings, like **Sample Size** and **Sample**".
- **"Color Picker Tool" is not Adobe's name for this tool.** The string appears in Adobe's own copy
  only for the **Color Picker dialog**, and in one Photoshop _Elements_ page that reuses
  "color picker tool" loosely for the Eyedropper
  (`https://helpx.adobe.com/photoshop-elements/using/choosing-colors.html`: "select where the color
  picker tool must sample from"). That is a different product, and it is a page about the Color
  Picker, so it does not move the desktop Tools-panel name. It is not in `sources`.
- **The Color Sampler Tool is a separate tool, not a bar-sharing sibling.** Adobe's histogram page
  says "Choose (then Shift-click) the **Eyedropper tool or Color Sampler tool**, and if necessary,
  choose a sample size in the options bar"
  (`https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html`). "Shift-click to
  choose" is the flyout-cycling gesture between two **tools**, so the two share a letter and a
  tile, not an options bar — and the current-version inventory confirms the Color Sampler is in the
  `I` group rather than in the Eyedropper's bar. **The app has no Color Sampler at all**, which
  `appNotes` records and `docs/TOOLS.md` inherits; see the tool-union evidence in the census below.

### Prose

**The drag is real, and an earlier pass of this file denied it.** This section used to open
"Photoshop's Eyedropper is a click, not a drag", and that claim then propagated into three places
in the data file: a `summary` ending "on a click rather than a drag", a `purpose` sentence "A click
is the whole gesture — there is nothing to drag", and an `Alt` modifier row asserting "These are
click modifiers, not drag modifiers: the Eyedropper has no drag". All three are false about
Photoshop. Adobe's **current** set-colors page carries the drag in a Tip on the same page that
sources the rest of this family's controls: "**You can drag the Eyedropper tool along an area of the
image and release once you get the desired color to confirm selection. The foreground or background
color box will change dynamically as you drag along.**"
(`https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`).
The Alt half is a **drag** modifier for the same reason, and the sentence claiming otherwise is
deleted rather than hedged: held through a drag, it is the _background_ color box that changes
dynamically, and the release confirms the sample. Adobe's own CS5 Elements help says the same in
starker form — "As you select and drag the Eyedropper tool, the foreground color box changes" and
"Release the mouse button to pick the new color" — so the behaviour is not a 2026 addition.

The app really is click-only, and that is now a divergence rather than agreement: see the
`appNotes` sentence citing `EyedropperToolArea.tsx` — `handlePointerDown()`, and the only pointer
handler in the file is the `onPointerDown` on its root `<div>`. Nothing above is a claim about the
app.

**The Alt half is implemented in the app, and the first pass of this file listed it as a divergence.**
That was wrong, and it was wrong in the direction an unverified divergence claim hides a working
feature: the `dispatch()` inside `EyedropperToolArea.tsx` — `handlePointerDown()` — reads
`dispatch({ type: event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR', payload: sampledColor })`. Alt
(Windows) or Option (macOS) therefore reaches the background swatch here exactly as Adobe specifies,
with no platform branch because `altKey` carries Option in the DOM on macOS too. The claim it was
folded into — "the sample is always read from the composited canvas, with no modifier that can
redirect it to the background swatch or to a single layer" — is now split, because only the second
half survives: the **read** is composited-only and nothing can narrow it to one layer, while the
**write target** is switchable. The `modifiers` array needed no change, since it is a
Photoshop-claim field and the app matches Photoshop here.

One thing the split exposed, which is a defect in the tree and not in the docs: the comment above
that same `dispatch()` in `EyedropperToolArea.tsx` — `handlePointerDown()` — cites "Alt-click
(Windows) / Command-Option-click (Mac) to sample to the background color" against Adobe's
tool-techniques URL. Adobe's **current** set-colors page says "Alt (Windows) or Option (macOS)"
with no Command, and Adobe's own Photoshop Elements shortcuts page gives the same pair in a table —
"Select background color | Eyedropper tool + Alt-click | Eyedropper tool + Option-click"
(`https://helpx.adobe.com/photoshop-elements/using/keys-painting-brushes.html`). The Command-Option
form is the older CS-era binding and the code comment inherits it. Product code is out of this
family's scope, so the comment is **not** edited; it is flagged in the report, and the data file
carries the current Adobe wording.

Photoshop's Eyedropper reads pixels under the pointer and writes the result into the app's color
controls. A plain click sets the foreground color; Alt-click (Windows) / Option-click (macOS) sets
the background color. Adobe's own page states the two headline halves — "Select the Eyedropper tool
(I)", "Use the Options Bar to customize tool settings, like Sample Size and Sample", "The sampled
color will become the foreground color and be added to your Swatches panel" — and Adobe's **current**
set-colors page states the background half as a rule of the tool, and replaces the CS4 mirror this
file used to lean on: "**Select a new background color by holding Alt (Windows) or Option (macOS) and
clicking the desired area in the image**"
(`https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`).
The Adobe-authored _Photoshop CS5 On Demand_ text says it the same way, and that source is kept.

**The temporary switch is a separate fact and no longer runs on from the gesture shape.** The
`purpose` sentence that carried it also carried the false gesture claim, and joining the two is what
made both harder to read. It is now: "Separately, and not as part of that gesture shape, holding Alt
or Option from any painting tool reaches the Eyedropper temporarily and samples the foreground color
at the Eyedropper's current Sample Size."

Sample Size is the footprint, and **the claim here is better sourced than this file used to admit.**
Adobe's current page enumerates the entire menu, and enumerates it with **no Median entries at
all**: "Select a sample size from the Sample Size menu in the Options bar: **Point Sample : Reads
the exact value of the clicked pixel. / 3 by 3 Average , 5 by 5 Average , 11 by 11 Average , 31 by 31
Average , 51 by 51 Average , 101 by 101 Average : Reads the average color value within the selected
pixel area**" (same page as above). So a point sample is one pixel and every other entry is a
neighbourhood mean — which is the distinction the app's own comment on the field is making — and
the full list is Adobe's rather than assembled out of an older mirror plus a blog. The narrowing
that used to be necessary here is gone; see `Unverified` item 1 for what is now closed.

**And the app now matches that list exactly, which this file's census said it did not.** The census
recorded `partial` on the grounds that "the list is three entries long: Point Sample, 3 by 3 Average,
5 by 5 Average". That was true of an older tree. `EYEDROPPER_SAMPLE_SIZE_OPTIONS`
(`src/tools/eyedropper.ts`) now carries **all seven** of Adobe's values with Adobe's own labels in
Adobe's order, the union at `src/tools/eyedropper.ts` — `EyedropperSampleSize` — is `1 | 3 | 5 | 11 |
31 | 51 | 101`, and `src/components/ToolbarsRight/Eyedropper/__tests__/Eyedropper.test.tsx` — the
`it('offers Photoshop all seven Sample Size options in Photoshop order')` title — pins all seven
labels and all seven values plus the fact that none is disabled. The sampling arithmetic matches
Photoshop too: odd-sided square, centred on the click (`EyedropperToolArea.tsx` — the `half`
computation in `handlePointerDown()`), clipped at the canvas edge rather than shifted inward (the
`left`/`top`/`right`/`bottom` clamp beside it), reduced by an arithmetic mean (the `red`/`green`/`blue`
accumulation loop further down the same handler). `status` is therefore **`present`**, the only one in
this description, and the `appNotes` sentence asserting a truncated list is deleted rather than
softened — it was naming a defect that had already been fixed in the tree the description describes.

The same page also settles the `Sample` menu's membership: "Select a sampling option from the Sample
menu in the Options bar: **All Layers : Sample color from all layers.**" and so on through Current
Layer, Current & Below and the two No Adjustments variants. **It states no default**, which is the
whole of the problem with that row — see `Unverified` item 10. It also matters for the row's precision:
of the five values, **only `All Layers` is verbatim from an Adobe page this pass opened.** The other
four names come from `jkost`'s Adobe-expert blog ("Current Layer, Current & Below, All Layers, All
Layers No Adjustments, and Current and Below No Adjustments") and from the Action Manager enum keys
that a third party reproduces (`eyeDropperSampleSheet`, values `0` All / `1` Current / `3` Current &
Below / `6` All no adjustments / `8` Current & Below no adjustments —
`https://qiita.com/yamo74/items/cc9d25b375bdfd020ce9`). The count of five is firm; the exact
capitalisation of the last two is not Adobe-verified. I checked Adobe's own VBScript and JavaScript
scripting references (`photoshop-vbs-ref-2020.pdf`, `photoshop-javascript-ref-2020.pdf`, both on
Adobe's CEP-Resources mirror) for an `eyeDropperSampleSheet` enumeration and **neither document
contains one** — the eyedropper sample settings are not in either dictionary — so the enum is
documented nowhere Adobe publishes, and this is item 13 under `Unverified`.

Holding Alt/Option from **any** painting tool reaches the Eyedropper temporarily and samples the
foreground color, at the eyedropper's current Sample Size. That is on Adobe's painting-tools page,
not a third-party inference. The last clause — that the temporary switch carries over the Sample Size
that is currently selected — is **third-party**, on `phlearn` ("Remember that the sample size chosen
for the Eyedropper tool will carry over when using this shortcut"), and it is kept in `purpose`
because it is a true and useful statement on a third-party source rather than a contested one.

### The letter, and the temporary switch

Adobe's own page for the spring-loaded feature states the whole rule and its default: "Spring-loaded
tool shortcuts in Photoshop let you temporarily switch to a tool by holding its shortcut key. When
you release the key, Photoshop automatically returns to your previous tool." Its worked example is
exactly the eyedropper's neighbour: "For example, hold V while using the Brush tool to temporarily
switch to the Move tool, and release it to return to the Brush tool." The preference is under
Edit/Photoshop > Preferences > Tools, and the page says it "is turned on by default" with "The
default is 200 milliseconds" for the delay slider.

`I` selects the Eyedropper; `Shift+I` cycles the tools that share the letter. The group is five tools
— Eyedropper, Color Sampler, Ruler, Note, Count — and the consolidated CS3 shortcut table names them
in one line: "I, Shift-I Eye dropper, color sampler, ruler, and count tools", with the rule stated
generally just above it: "The letter keys are used to select a group of tools. The letter key alone
will select the most recently used tool listed for that key. Using the Shift key with the letter key
will cycle through the tools." That CS3 table is twenty years old and its group was smaller then —
the CS2 and CS3 sheets say "Eyedropper / Sampler / **Measure**", because Ruler, Note and Count were
not in it yet — so the five-tool membership is carried by a **2024** inventory instead:
`https://video.pie-menu.com/adobe-photoshop-cheat-sheet.pdf` (2024-08-18) reads "Eyedropper, Color
Sampler, Ruler, Note, and Count Tool I", and Adobe's own histogram page independently puts the
Eyedropper and the Color Sampler on the same letter with Shift-click between them. That page is now
in `sources`; it is the only **Adobe** evidence in this file that the cycle exists at all, and it
establishes two members of the group rather than five.

**`I` does spring-load, and this is now sourced to the specific letter.** Adobe's page gives the
general rule ("let you temporarily switch to a tool by holding its shortcut key. When you release the
key, Photoshop automatically returns to your previous tool"), which is what the `shortcuts` row for
`I` claims. The row's second half — that this letter specifically does it — rests on an Adobe
Community Expert, D Fosse, answering "How do I change the eye dropper shortcut?"
(`https://community.adobe.com/t5/photoshop-ecosystem-discussions/how-do-i-change-the-eye-dropper-shortcut/m-p/13376888`):
"The ordinary I-shortcut works the same way if you hold the key for a specified time, which you set
in Preferences > Tools", and "All the tool shortcuts work this way as standard. Tap the key, and it
switches permanently. Hold the key for a little longer, and it returns to the previous tool when you
release it." That is an Adobe community answer rather than an Adobe documentation page, so it is
cited here and not added to `sources`; the `sources` entry for the general rule stands on its own,
and the `I` row is a general rule plus a letter that Adobe's own expert applies to it.

### A click that changes no pixel is not an edit

The recovered audit finding is the load-bearing one, and it is **derived from the governing rule
rather than quoted**: a history state comes from a change to pixels, sampling changes only the
application foreground color, so a sample belongs in the same class as a zoom, a panel move or a tool
switch — nothing that records history. A second audit reached the same conclusion from the same
rule.

**No single Adobe sentence stating this was found**, and the two audits' agreement is agreement on a
deduction, not on a quotation. `purpose` is a Photoshop-claim field per
`src/tools/descriptions/types.ts` — `ToolDescription.purpose` — it "describes _Photoshop's_ tool" —
and an unsourced deduction about Adobe's history panel does not belong there, so **it has been
removed from `purpose` outright rather than hedged.** It survives in `appNotes`, where it is a
statement about what this app does and the reason is in the tree: "A click dispatches a color change
and nothing else, so the app records no history entry for a sample and a sample is not undoable — the
same class as a zoom, a panel move or a tool switch." Nothing was lost by the move — the second half of
the same sentence pair was always about the app — and it is item 4 in `Unverified`.

The app implements exactly that: the `dispatch()` inside
`src/components/Main/EyedropperToolArea.tsx` — `handlePointerDown()` — is the only dispatch in the
file, and it is a `SET_COLOR` or a `SET_BACKGROUND_COLOR` depending on `altKey` — neither of which
touches a pixel, a layer or a history entry. The reason is written down in the tree in the doc
comment above `PIXEL_FREE_TOOLS` in `src/tools/toolProcessors.ts` and again in the doc comment above
`EyedropperToolArea` in `src/components/Main/EyedropperToolArea.tsx`, and both attribute it to
Adobe's rule.

### Options bar — control census

| #   | Photoshop control | Status    | App rendering                                                                                                                                                                                                                                           | Note                                                                                                                                                                                                                                                                          |
| --- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Sample Size`     | `present` | `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx` — the Sample Size `<select>` in `Eyedropper`, list at `src/tools/eyedropper.ts` — `EYEDROPPER_SAMPLE_SIZE_OPTIONS`                                                                             | All seven of Adobe's entries, Adobe's labels, Adobe's order; odd-sided square centred on the click, clipped at the border, arithmetic mean. Was `partial` on a three-entry list that no longer exists.                                                                        |
| 2   | `Sample`          | `inert`   | **no control rendered**; field at `src/tools/settings.ts` — the `eyedropper` block of `defaultSettings` (`sampleAllLayers: false`), refusal at `src/components/Main/EyedropperToolArea.tsx` — the `args.sampleAllLayers` guard in `handlePointerDown()` | The checkbox is **gone from the bar**, not rendered-but-disabled. The field persists, no writer exists, and a click that found it set refuses loudly. Pinned by `Eyedropper.test.tsx` — the `it('renders no Sample All Layers control at all, disabled or otherwise')` title. |

**Counts: present 1 · partial 0 · inert 1 · missing 0.**

**The `Sample` status is `inert` rather than `missing`, and that is the one judgement in this
description worth re-deriving.** `src/tools/descriptions/types.ts` — the `'missing'` member of
`ToolControlStatus` — defines `missing` as "The app does not render this control", which is now
literally true — the bar renders one `<select>` and nothing else. But `src/tools/descriptions/types.ts`
— the `'inert'` member of the same union — defines `inert` as "declared **or** displayed, and
nothing is wired behind it", naming "state in `src/tools/settings.ts` that persists and drives
nothing" as a qualifying shape, and that shape is exact here: `sampleAllLayers: false` is seeded in
the `eyedropper` block of `defaultSettings` in `src/tools/settings.ts`, a grep of `sampleAllLayers`
across `src/` and `e2e/` finds no writer anywhere (only the seed, the type declaration, the refusal
read, and tests), and the only `patchToolArgs` call in the bar writes `sampleSize`
(`src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx` — `handleSampleSizeChange()`). The
`src/tools/descriptions/types.ts` rationale for preferring `inert` — "the control is on screen, which
is exactly what makes it dangerous" — no longer applies, because it is not on screen. **If the
operator prefers `missing` here, the only thing lost is the pointer at the unwritten field**, and the
status is a one-word change. It is left `inert` because the brief's own instruction for this pass was
"`inert` = declared in `src/tools/settings.ts` or displayed with NOTHING wired behind it … Check BOTH
before declaring anything `missing`", and the settings declaration is there. The `appRef` was
repointed at that declaration for the same reason: the site the previous pass cited, the end of the
`Eyedropper` component in `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx`, is a `};` and
never contained the control.

**The first pass asserted a rendered, permanently-disabled checkbox, and that is refuted.** It is
worth stating plainly because the sentence had three components and all three are false of the tree:
the bar does not render a `Sample All Layers` control, there is no `checked={false}` node to be
disabled, and there is no placeholder for one. `Eyedropper.tsx` is 39 lines and renders a single
labelled `<select>`; `Eyedropper.test.tsx` — the
`it('renders no Sample All Layers control at all, disabled or otherwise')` title — exists specifically
to pin the absence and says why in its own comment — "The checkbox used to sit on the bar permanently
`disabled` and unchecked. It needs a composite read of every visible layer and the tool area only has
the composited canvas, so it was a promise the app could not keep on screen". The refusal survived the
deletion on purpose, which is why the field is still seeded and still read.

**The sampling ring is omitted on purpose, and the decision is recorded in `appNotes` so it is not
silently missing.** Adobe's current page names only `Sample Size` and `Sample`, so the ring is **not
a proven gap** and is not filed as `missing` — that status would assert a control Adobe's own page
does not show. The 27.x _name_ is unconfirmed as well: no Adobe page carrying `"Show color overlay"`
was found on the first pass's five searches, and this pass's sixth and seventh searches for the
current name found nothing on Adobe either — the only names anyone sources are third-party — "Show Sampling
Ring" (`jkost`, an Adobe expert's blog, and `enviragallery`) and an Adobe Community Expert's "Show
Sampling Circle". The one Adobe-authored sighting is Adobe's own CS5 help, which says only "a color
sampler ring for the Eyedropper tool" and names no control. Putting an unverified third-party string
in `control` would break the field's own contract ("The control's name in Photoshop's options bar,
verbatim"), so the row is left out and the reason is stated in `appNotes` instead, together with the
fact that the app has no ring either way — the ring is a cursor, and this repo has no cursor registry
at all. This is item 7 in `Unverified`, which stays open.

Three judgement calls worth stating, because each could reasonably have gone the other way:

- **`Sample` is one row, not two.** `Sample All Layers` and the modern `Sample` dropdown are the
  same control in two forms, and the corpus brief names the checkbox. Counting them separately
  would double-count one Photoshop control. The row carries Adobe's current verbatim name
  (`Sample`, from Adobe's own page) and its `detail` records the historical checkbox form, so the
  census the brief asked for is answered without inflating the count.
- **`Sample` is `inert`, and an earlier pass had this wrong twice over.** It was filed `partial` on the
  reading that `inert` meant "rendered by no component", which is not what the contract says, and then
  filed `inert` on the further reading that the checkbox was on the bar. It is now `inert` for the
  reason the contract gives and the rendering no longer contradicts: `sampleAllLayers` has state in
  the `eyedropper` block of `defaultSettings` in `src/tools/settings.ts` that persists and drives
  nothing, and no writer exists. The defence for the refusal path is the `args.sampleAllLayers` guard
  in `handlePointerDown()` in `src/components/Main/EyedropperToolArea.tsx`, which reports a named
  reason instead of quietly sampling the active layer, and a test drives the field true to prove that
  path (`src/components/Main/__tests__/EyedropperToolArea.test.tsx` — the
  `it('refuses loudly instead of silently ignoring a Sample All Layers value')` title).
- **The tool-preset picker is not a row.** Every bar in the corpus's own table leads with
  `tool-preset`, and tool presets are a real Photoshop feature, but the Adobe page that was opened
  does not establish that a preset picker leads _this_ bar, so the row would be an unsourced claim.
  It is in `Unverified` instead.

### App-side facts the census depends on

- **No processor, by design.** `src/tools/toolProcessors.ts` — `PIXEL_FREE_TOOLS` —
  `export const PIXEL_FREE_TOOLS = ['eyedropper'] as const satisfies readonly ToolName[]`. The
  doc comment above it states the reason: rasterizes nothing, commits no pixels, records no
  history state. `src/tools/toolsMap.ts` — the `eyedropper` map entry — is the consequence —
  `eyedropper: { icon: 'eyedropper', toolboxComponent: Eyedropper }`, no
  `...toolProcessors.eyedropper` spread, and the comment above that entry says why.
- **The click.** In `src/components/Main/EyedropperToolArea.tsx`, `handlePointerDown()` reads the
  pixels with `ctx.getImageData()` and then dispatches the result
  (`dispatch({ type: event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR', … })`). Sample All Layers
  is refused by the `args.sampleAllLayers` guard at the top of the same handler. The sample block is
  built and clipped by the `half`/`left`/`top`/`right`/`bottom` statements, read by
  `ctx.getImageData()`, and averaged by the `red`/`green`/`blue` accumulation loop. A fully
  transparent center pixel returns without dispatching on the alpha check. The handler is wired as
  `onPointerDown` on the root `<div>` and nowhere else — a grep for `onPointerMove`, `onPointerUp`
  and `onPointerCancel` in the file returns nothing, which is what settles the drag divergence.
- **The accelerator.** `toolbar-mapping.ts` — the
  `{ label: 'Eyedropper Tool', name: 'eyedropper', shortcut: 'I' }` tile, its own single-tool tile.
  The runtime binding is the `key: 'i'` registration beside the `v` one in
  `src/components/Common/AppKeyboardShortcuts.tsx` and again the second `key: 'i'` registration under
  the comment explaining that the three single-tool tiles get one plain registration each rather than
  a `shift: true` twin, and
  `src/components/Common/__tests__/AppKeyboardShortcuts.test.tsx` — the
  `it('selects %s with a bare %s and with Shift+%s')` case inside
  `describe('AppKeyboardShortcuts tool cycling')` — pins that a shifted `I` still selects the
  eyedropper. **The mechanism behind that is the matcher, not the omission**: the `shift` arm of
  `matchesShortcut()` in `src/hooks/useKeyboardEvents.tsx` is
  `if (shortcut.shift !== undefined && event.shiftKey !== shortcut.shift) return false;` — an
  undeclared `shift` skips the test entirely rather than requiring Shift to be up, so Shift+I falls
  through to the plain registration. And there is no key-up listener anywhere in
  `useKeyboardEvents.tsx` (grep for `keyup` / `onKeyUp` returns nothing), which is the mechanical
  reason the app cannot spring-load: the hook is key-down only. **The app therefore has no `Shift+I`
  cycle and no spring-loaded temporary `I`** — both are divergences, and both are stated in
  `appNotes`. The `Shift+I` row is **kept** in `shortcuts`: the binding is real in Photoshop, and
  this file's rule is to record Photoshop's behaviour and disclose the app's divergence in
  `appNotes` rather than delete the claim. The same check applies to the four tools Photoshop cycles
  to — Color Sampler, Ruler, Note and Count are in none of the `ToolName` union
  (`src/contexts/tool-types.ts`), so the group has no members in the app to cycle through.
- Defaults: `sampleSize: 1`, `sampleAllLayers: false` in the `eyedropper` block of `defaultSettings`
  in `src/tools/settings.ts`, pinned by `src/tools/__tests__/eyedropper.test.ts` — the
  `it('seeds the Photoshop defaults: a point sample, and every layer off')` title. **The app's
  defaults are not claimed to be Photoshop's.** This line previously read "Defaults match Photoshop's",
  which was a claim about Photoshop that nothing sourced — Adobe states the `Sample` menu but no
  default for it (item 10), and states no default for `Sample Size` either (item 12, now closed).
  What is true and is what the line now says is that the app's two defaults are these values.

### Sources — Eyedropper

The four Adobe entries below were re-opened this pass through the live search crawler, which is the
route the research brief prescribes for `helpx.adobe.com` (`webfetch` returns 403 on that host). The
third-party entries were carried over on the first pass's record of having opened them; two of them
were re-opened this pass as well and are marked.

- https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html — Adobe, page last
  updated **Mar 22, 2024**. The `I` accelerator, the `Sample Size` and `Sample` control names,
  foreground on click, added to Swatches: "The Eyedropper tool can sample colors from anywhere in an
  image and add them to your Swatches panel… Select the Eyedropper tool (I)… Use the Options Bar to
  customize tool settings, like Sample Size and Sample… The sampled color will become the foreground
  color and be added to your Swatches panel." **This page enumerates only those two controls**, which
  is the basis for leaving the sampling ring out of the census rather than filing it `missing`.
- https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html
  — Adobe, current (page dated Oct 28, 2025). The **complete** `Sample Size` menu, with no Median
  entries in it; the `Sample` menu's opening entry; the drag Tip, "You can drag the Eyedropper tool
  along an area of the image and release once you get the desired color to confirm selection. The
  foreground or background color box will change dynamically as you drag along."; and the
  background-color rule, "Select a new background color by holding Alt (Windows) or Option (macOS)
  and clicking the desired area in the image". This is the primary citation for the `Sample Size` row,
  the `Alt` modifier and the drag, and it supersedes the CS4 mirrors that used to carry all three.
  **It states no default for either `Sample Size` or `Sample`.**
- https://helpx.adobe.com/photoshop/using/painting-tools.html — Adobe. Alt/Option held from a
  painting tool reaches the Eyedropper temporarily.
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html
  — Adobe, page last updated **Feb 23, 2026**. Spring-loaded tool shortcuts: temporary switch on hold,
  return on release, on by default, 200 ms default delay, with the hold-`V`-while-brushing example.
  This page carries the **rule**; it does not name the Eyedropper, so the `I` row's second half rests
  on the Community Expert answer cited in the letter section above.
- https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html — Adobe. "Choose (then
  Shift-click) the Eyedropper tool or Color Sampler tool, and if necessary, choose a sample size in the
  options bar. Point Sample reads the value of a single pixel, other options read the average of a
  pixel area." **Added this pass.** The only Adobe evidence that the Eyedropper and the Color Sampler
  are Shift-click siblings, which is what makes them two tools on one letter rather than two controls
  on one bar.
- https://video.pie-menu.com/adobe-photoshop-cheat-sheet.pdf — third party, dated **2024-08-18**.
  "Eyedropper, Color Sampler, Ruler, Note, and Count Tool I". **Added this pass**, and it is the
  reason the five-member `Shift+I` group rests on something recent: the CS3 table this file used to
  cite names a smaller group, because Ruler, Note and Count were not in it in 2004.
- https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=126 — Adobe Photoshop
  CS4 User Manual, mirrored. The Sample Size semantics quoted above and the Sample menu.
- https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/127 — Adobe CS4 user
  manual, mirrored. Alt-click/Option-click sets the background color; the temporary eyedropper.
- https://ptgmedia.pearsoncmg.com/images/9780789744470/samplepages/0789744473.pdf — Adobe-authored
  _Photoshop CS5 On Demand_ text, in a Pearson-hosted sample. "Select the Eyedropper tool on the
  toolbox, and then click anywhere in the active document to change the foreground color. Hold down
  the Alt (Win) or Option (Mac) key, and then click to change the background color."
- https://photogravity.eu/wp-content/uploads/2018/02/Photoshop-CS5-Help.pdf — Adobe's own CS5 help,
  mirrored. "a color sampler ring for the Eyedropper tool" — the only Adobe-text sighting of the
  sampling ring, and it names no control.
- https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf — third party (a photographer's
  consolidated CS3 shortcut table). "I, Shift-I Eye dropper, color sampler, ruler, and count tools",
  the letter-selects-the-group / Shift-cycles rule, and `[` / `]` for brush size. Note that the CS2 and
  CS3 sheets give the same letter to "Eyedropper / Sampler / **Measure**", so this source's
  five-member list is either a later revision or a merge of two eras; it is kept for the **rule**,
  which is stated generally, and not relied on for the membership.
- https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Eyedropper_tool.html — third
  party (course notes). The CS3 sample-size list, and Alt as a temporary eyedropper over the brush,
  pencil, type, gradient, bucket and shape tools.
- https://enviragallery.com/guide-to-the-eyedropper-tool-in-photoshop/ — third party. The sample
  source defaults to every layer, and can be narrowed to active layers only; also "By default, the
  Eyedropper tool samples 1 pixel", the one third-party source for the `Sample Size` default this
  family has, and "Show Sampling Ring" as the ring toggle's name.
- https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html —
  Adobe expert blog (not an Adobe page). The five `Sample` values, the sampling ring toggle,
  "Choose a sample size from the list in the Options bar from Point Sample to 101 by 101 Average",
  "Option-click (Mac) | Alt-click (Win) … to select the background color", and the note that "with a
  Painting tool selected, holding Option (Mac) | Alt (Win) temporarily enables the Eyedropper tool".
- https://editpsdfile.com/blog/photoshop-keyboard-shortcuts — third party. "Sample color while
  painting: Hold Alt" in a modern shortcut reference.
- https://www.oreilly.com/library/view/photoshop-r-cs4-bible/9780470345177/9780470345177_tools.html
  — third-party book. Shift plus a tool's letter cycles the tools behind it.
- https://clippingpathstudio.com/photoshop-toolbar/ and
  https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/ — third party. The five-tool
  measurement group on `I`, and the tool/shortcut tables.

**Four URLs that were opened this pass and deliberately kept OUT of `sources`.** Adobe's Photoshop
_Elements_ keyboard page
(`https://helpx.adobe.com/photoshop-elements/using/keys-painting-brushes.html`) corroborates both
Alt/Option halves in a table, and Adobe's Photoshop Elements color page uses "color picker tool" for
the Eyedropper, but both are a different product and neither is evidence about Photoshop desktop.
The Adobe Community Expert thread on the `I` spring-load is an Adobe answer, not an Adobe page. The
Adobe VBScript and JavaScript scripting references were checked and **do not contain** an
`eyeDropperSample`/`eyeDropperSampleSheet` enumeration, so citing them for the `Sample` menu would
have been citing an absence.

## Draw Tool

### What it actually is

**A hard-tipped freehand path tool that rasterizes each stroke onto a new layer.** Not a vector path
or annotation tool, not a distinct painting mode, and not a pen in the Photoshop sense. The chain
that settles it, in order:

1. `toolbar-mapping.ts` — the `[{ label: 'Draw Tool', name: 'draw', shortcut: 'B' }]` tile, its own
   single-tool tile, at the end of the tonal group after Dodge, Burn and the Sponge. (The
   `{ label: 'Burn Tool', name: 'burn' }` entry is in that same group, and the group closes just after
   the `{ label: 'Sponge Tool', name: 'sponge' }` entry, so the closing bracket this file used to
   cite is the one after the Sponge.)
2. `src/contexts/tool-types.ts` — `ToolArgsByName` maps `draw: DrawToolArgs`, and the file imports
   both `DrawToolArgs` and `PaintToolArgs`, so the two are separate arg types rather than one shared
   paint type. The split is real: `PaintToolArgs` in `src/tools/draw.ts` is
   `Omit<DrawToolArgs, 'toolName' | 'smoothing' | 'blendMode'> & PaintSettings`, i.e. the paint tools
   are the draw args plus required paint settings, and `smoothing`/`blendMode` are exactly what they
   add.
3. `src/tools/draw.ts` — `PenType`, `export type PenType = 'pen' | 'pen-dashed' | 'spray';`. Three
   renderers, selected by a dropdown, not a brush tip.
4. `src/util/draw.ts` — `drawLine()` smooths the sampled path once and dispatches: `pen` and
   `pen-dashed` to `drawPen()` (a `beginPath`/`moveTo`/bezier/`stroke` of the path), `spray` to
   `drawSpray()` (a radial gradient per sampled point). There are no anchors, no handles and no fill,
   so it is not a path tool; and there is no tip, no hardness and no flow, so it is not a brush. **The
   path is not resampled.** `drawLine()` reads `args.points` and hands it to `smoothStrokePoints()`
   (`src/tools/brush.ts`), which returns _the same array instance_ whenever the pull is zero and
   otherwise emits exactly one output point per input point. For the legacy draw tool it always returns
   the same array: `defaultSettings.draw` (`src/tools/settings.ts`) carries no `smoothing` key, so
   the argument is `0`. The raw samples are whatever `handlePointerMove()` pushed
   (`src/components/Main/DrawToolArea.tsx`), and the curve through them is drawn by
   `bezierSmoothedLine()` (`src/util/draw.ts`), called from `drawPen()`. The data file's `purpose` used
   to say "a drag is resampled as a path, bezier-smoothed, and stroked" — the bezier half is real, the
   resampling half was not, and it has been corrected.
5. `src/tools/toolProcessors.ts` — the `draw` entry in `toolProcessors`:
   `draw: { commit: 'source', creator: true, ... }`. The `creator: true` is the decisive flag:
   **every stroke creates a layer.** Compare the `brush` entry (`commit: 'raster'`, no `creator`) and
   the `pencil` entry (`commit: 'raster'`), which composite onto the active layer. The commit happens
   in `src/components/Main/DrawToolArea.tsx` — the `createLayerFromTool(fullArgs)` call in
   `handlePointerUp()` — with the points accumulated in `handlePointerDown()` and
   `handlePointerMove()` and the bounding box computed by `pointsBoundingPos()`.
6. `src/components/ToolbarsRight/Draw/Draw.tsx` — `Draw`, the options bar. In bar order it renders
   **Pen Type** (the `#pen-type` `<select>` with its three `<option>`s), **Size** (the `#size-slider`
   range, 0.5–500 px, step 0.5), **Dash** and **Gap** (the `#dash-size` and `#gap-size` ranges,
   1–100 px each, rendered only when the pen is `pen-dashed`), and **Opacity** (the `#alpha-slider`
   range, 0–100%), then a live 96×48 stroke preview (the `<canvas ref={previewRef}>` at the end of
   the bar, the file's last lines). Per-pen settings are remembered in `savedDrawPerPen`
   (`src/tools/settings.ts`), keyed by `PenType`, written by `handleChange()` in `Draw.tsx`.

So: a drag becomes a path, the path becomes ink, the ink becomes a layer. It is a **freehand stroke
tool this app owns**, and the phrase is not a hedge.

**The ink is the foreground colour, and that half of the old claim survived re-derivation.** It was
worth checking rather than assuming, because the paint family records the same-sounding claim as
false for Color Replacement. Here it is true, and two independent lines decide it: the bar reads the
store's foreground out of `useStore()` (in `src/components/ToolbarsRight/Draw/Draw.tsx` — `Draw`) and
writes it into the tool args in an effect whenever the two disagree (the foreground-colour sync
`useEffect()` in the same component), and the renderers consume `args.color` — `ctx.strokeStyle =
color` for the two pen types (`src/tools/draw.ts` — `setupDrawCtx()`) and `hexToRgb(args.color)`
inside `drawSpray()` (`src/util/draw.ts`). So `appNotes` and `purpose` keep the foreground-colour
statement and only the resampling clause was cut.

**One consequence of the one-stroke-per-layer design, which the data file now records.** The
renderers issue a single `beginPath`/`moveTo`/`stroke()` per stroke at the tool's `globalAlpha`
(`src/util/draw.ts` — `drawPen()`, and `src/tools/draw.ts` — `setupDrawCtx()`), so a stroke that
crosses itself does not compound within that stroke. That is the whole of the `Opacity` divergence,
and it is the one an earlier pass stated wrongly: it also claimed that "a second stroke lays a second
semi-transparent layer over the first rather than adding to the same one", and a second Photoshop
stroke is _also_ a separate compositing pass over the same pixels that reaches the same value, so
that clause named a difference that is not one. The `Opacity` row's build-up sentence is Photoshop's,
and `appNotes` is where the divergence is stated. **The row's status was `present` while this
paragraph said the behaviour diverges, and that contradiction is now closed in the direction the
paragraph already picked**: `partial`, because Adobe states the build-up rule as part of what the
control does — "the opacity does not exceed the set level no matter how many times you move the
pointer over the area, until you release the mouse button" — and a single `stroke()` over the whole
path does not hold that within a self-crossing stroke.

### Modifiers, and the bracket keys that are bound but inert

Two Photoshop bindings this file used to assert as app behaviour are not implemented, and the data
file no longer asserts either.

- **`Shift` constraining a freehand stroke to a straight line.** `src/components/Main/DrawToolArea.tsx`
  reads no modifier of any kind — a grep for `shiftKey`, `altKey`, `metaKey` and `ctrlKey` across
  the file returns nothing — so a Shift-held drag produces the identical freehand path. The row has
  been **removed from `modifiers`**, which is the field for what holding a key changes about _this
  app's_ drag, and the absence is stated in `appNotes`. The claim survives as a Photoshop claim in
  Adobe's painting-tools page (the source list records it, and the Sources section below attributes
  "Shift-click for a straight line" to that page), which is the same split the sibling selection
  family uses for its unbound keys.
- **`[` and `]` for brush size.** These are real Photoshop bindings and the rows are kept, with the
  absence disclosed in `appNotes`. **This file previously claimed the brackets were unbound anywhere
  in `src/`, and that is refuted.** `src/components/Common/AppKeyboardShortcuts.tsx` registers
  `key: '['` and `key: ']'`, both `mod: false` and `repeat: true`, each gated on
  `enabled: hasImage && tipSizeTool(toolName) !== null`. The gates are two
  `Partial<Record<ToolName, …>>` tables — `tipSizeField` (naming brush, pencil, eraser,
  color-replacement, smudge, dodge, burn and clone-stamp) and `opacityField` — and **`draw` is in
  neither.** So the
  correct statement is not "no bracket key is bound" but "`[` and `]` are inert for this tool". The
  `appNotes` sentence is corrected to that, and it names the sharper fact underneath: draw's Size
  control writes the same `lineWidth` field the brush's does
  (`src/components/ToolbarsRight/Draw/Draw.tsx` — `handleSizeChange()` → `args.lineWidth`), so one
  entry in `tipSizeField` would have made the keys work here. The same
  holds for Adobe's `0`/`1` opacity keys, which are gated on `opacityField` and are likewise inert
  for draw despite draw carrying an `alpha`. Both are reported to the operator as gaps rather than
  changed: `tipSizeField` and `opacityField` are product code.

### Photoshop provenance: there is none

**Photoshop has no tool called Draw.** Adobe's painting-tools page covers the Brush, Pencil, Eraser,
Blur, Smudge, Mixer Brush, Color Replacement and the paint bar's Mode/Opacity/Flow/Airbrush options
plus the brush bar's Smoothing field,
and names no Draw tool. Two independent third-party inventories of the whole Tools panel
(`clippingpathstudio.com/photoshop-toolbar/`,
`offshoreclipping.com/blog/photoshop-cc-toolbar-tools/`) list every group, both give `B` to the Brush
Tool, and neither contains a Draw tool. The app's Draw tile also occupies a slot Photoshop does not
have: the tonal group in `toolbar-mapping.ts` continues from Dodge/Burn straight to the Pen family,
where Photoshop has the Blur/Sharpen/Smudge group.

The recovered audits sharpen this from "not yet found" to "nobody has ever found one": a dedicated
audit of all 40 registered tools against Photoshop listed Draw as a **ph-invented** tool, and a
separate keyboard/UX audit recorded the badged `B` as wrong precisely because `B` selects the Brush
in Photoshop. Those are internal audits and carry no URL, so the data file's provenance rests on the
web evidence above; the audits are what make the _tone_ right, and the tone is now unqualified.

`photoshopName` therefore names no Adobe tool. It is `No Photoshop tool — this app's own tool
(nearest Photoshop: Brush tool)`, and `summary` and `purpose` are written from the app's own
semantics and say in the first sentence that there is no Photoshop tool. They name what a user
should reach for instead: the **Brush tool** for the solid stroke, and the **Pen tool family** if
what is wanted is path work rather than freehand paint. There is no Photoshop equivalent to a dashed
freehand ink stroke, and the file says so.

**The airbrush recommendation was a false pointer and has been cut.** This paragraph used to tell a
user to reach for "the **Brush's airbrush option** for the spray". A grep for `airbrush` across
`src/components` and `src/tools` returns nothing outside this directory's own files: the app renders
no airbrush control on the Draw bar or on the Brush bar, which is the same finding the sibling paint
family records as `Airbrush` `missing` on the brush. So the sentence pointed at a control that does
not exist, in the one field a user reads first. `purpose` now says that the app renders no airbrush
control on any tool and that the Spray pen is the nearest thing here, which is the same fact the
airbrush row's `missing` status carries.

The `options` array is a census of **the Brush Tool's bar against the app's Draw bar**, and is
labelled as such here and in `appNotes` — so `control` holds Brush-bar names verbatim, and a
`present` on that table means "the Draw bar offers the Brush bar's control with the Brush bar's
behavior", never "Photoshop's Draw tool has this".

### Options-bar control census (reference bar: the Photoshop Brush Tool)

| #   | Brush bar control     | Status    | App rendering                                                                                           | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | --------------------- | --------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Brush Preset picker` | `missing` | —                                                                                                       | No tip, no hardness, no presets. The per-pen records in `savedDrawPerPen` (`src/tools/settings.ts`) are three hardcoded strokes, not a preset system.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `Size`                | `partial` | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#size-slider` range, handler `handleSizeChange()`   | Wired and applied verbatim (`src/tools/draw.ts` — `setupDrawCtx()`), but the range diverges at **both** ends: 0.5–500 px, step 0.5, against Photoshop's 1–5000.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | `Mode`                | `inert`   | declared `src/tools/draw.ts` — `DrawToolArgs.blendMode`                                                 | Declared on the args, set by no Draw-bar control, absent from `defaultSettings.draw` (`src/tools/settings.ts`) — **and refused even if set**: `src/contexts/layer-utils.ts` — `toolLayerBlendMode()` — returns `source-over` for any `toolName` other than `brush`/`pencil`/`color-replacement`, so a draw stroke's layer is forced to Normal.                                                                                                                                                                                                                                                                                                      |
| 4   | `Opacity`             | `partial` | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#alpha-slider` range, handler `handleAlphaChange()` | 0–100% on `args.alpha`, applied as `ctx.globalAlpha` (`src/tools/draw.ts` — `setupDrawCtx()`). Default 90% for `pen`/`pen-dashed`, 50% for `spray` (`savedDrawPerPen` in `src/tools/settings.ts`). The build-up behavior Adobe documents for this control is not reproduced, so the row is `partial` and not `present`: see the one-stroke, one-layer paragraph above.                                                                                                                                                                                                                                                                              |
| 5   | `Flow`                | `missing` | —                                                                                                       | The app has a single `alpha` and no flow concept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | `Airbrush`            | `missing` | —                                                                                                       | The bar renders Pen Type, Size, Dash, Gap, Opacity and a preview, and nothing else. The `spray` pen is the nearest thing and it diverges twice: it is reached from a Pen Type dropdown rather than a toggle, and it stamps one soft gradient per sampled point along the drag, so it builds while the pointer moves and a held press adds nothing after the single dot it laid. The old `partial` here carried an `appRef` into the Pen Type `<select>`'s `<option>`s in `src/components/ToolbarsRight/Draw/Draw.tsx`, not an airbrush control — a citation to a site that does not contain the control the row is about.                           |
| 7   | `Smoothing`           | `inert`   | declared `src/tools/draw.ts` — `DrawToolArgs.smoothing`                                                 | The seventh row, and the one this table was missing. Adobe's stroke-smoothing page puts the control on the options bar for "the Brush, Pencil, Mixer Brush, and Eraser" and gives its range: "Smoothing amount: Set a value between 0 and 100"; higher values "may slightly delay the stroke preview". Declared on the draw args, written by no Draw-bar control, absent from `defaultSettings.draw` (`src/tools/settings.ts`), and `PaintToolArgs` in `src/tools/draw.ts` exists precisely by `Omit`-ing `smoothing` out — so the field is the paint family's and this bar never exposes it. `inert` for the same reason as `Mode`, one row above. |

**Counts: present 0 · partial 2 · inert 2 · missing 3.**

`Size` and the airbrush toggle were both `present`/`partial` on the strength of "it does something
nearby". Neither is that any more. `Size` is `partial` because `src/tools/descriptions/types.ts` — `ToolControlStatus` — defines the status as
"its behaviour **or range** diverges", and both of this control's bounds diverge from Photoshop's
1–5000; the sibling paint family files the same control `partial` for the same class of reason. The
airbrush toggle is `missing` because the Draw bar contains no control that answers to it at all, and
the nearest neighbour — the Spray pen — is a different Photoshop control reached a different way.
Its old `detail` was the sharper defect: it ended "Click the button to toggle it", which would have
told a user to click a control that does not exist.

`Opacity` was `present` and was **also** wrong, in the direction `present` most easily hides: it
contradicted this file's own `appNotes`, which said the build-up story diverges.
`src/tools/descriptions/types.ts` — `ToolControlStatus` — defines
`present` as "The app renders this control and it does what Photoshop's does", and Adobe's Opacity
text makes the build-up rule part of the control rather than an extra: "As you paint over an area,
the opacity does not exceed the set level no matter how many times you move the pointer over the
area, until you release the mouse button." A single `beginPath`/`stroke()` over the whole path at
`globalAlpha` (`src/util/draw.ts` — `drawPen()`, and `src/tools/draw.ts` — `setupDrawCtx()`) does not hold that within a
self-crossing stroke, so the behaviour diverges and the status is `partial`.

**`Smoothing` was absent from a table that declares itself the Brush-bar census, and its own
`appNotes` named it.** The sentence "The two fields the Photoshop paint bar exposes as Mode and
Smoothing are declared on the draw args but unreachable from this bar" was true while the census
listed only `Mode`. Both halves of that sentence now have a row, and both are `inert` for the same
reason: declared, written by nothing. Bar order puts `Smoothing` last, after `Airbrush`, which is
where Adobe's Brush bar puts it and where the sibling paint family puts it (the `Smoothing` row of the
Brush's `options` in `src/tools/descriptions/paint.ts`, after its `Airbrush` row).

**Two defaults were removed rather than sourced (`Opacity` and `Flow`).** Both rows ended
"Default: 100%." Adobe's page says "Opacity of 100 percent is opaque" — a value, not a default — and
states **no default for Flow at all**. This file's own `Unverified` item 10 says a default "is the
cheapest claim in the file for anyone to disprove", and these two were exactly that, so removing them
costs nothing: the `Opacity` row now quotes the value sentence and says outright that Adobe states no
default, and `Flow` says the same. The app's own per-pen defaults stay, because those are verifiable
in the tree. Note the sibling `src/tools/descriptions/paint.ts` — the Brush's `appNotes` — still says the bar "seeds it at 90 percent where
Photoshop's is 100" — **that half is the same unsourced default and is out of this family's scope to
change**; flagged here so a later pass does not treat the two files as agreeing.

**`Airbrush` is Adobe's own name, and the longer string this file used was not.** The row was
`Enable airbrush-style build-up effects`. Adobe's painting-tools page heads the section "Airbrush"
and describes it as "Simulates painting with an airbrush… Click the button to turn on or off this
option." No Adobe page carrying the longer string could be opened, and the sibling
`src/tools/descriptions/paint.ts` — the Brush's `Airbrush` row — records the same control as
`Airbrush`, so this file was the outlier and is now aligned with both.
The longer form reads as a description of what the toggle does rather than as a label printed on the
bar, which is the likeliest route by which it entered the file; that is an inference and is recorded
as one.

**One control name in this table is Adobe-verbatim while the sibling family capitalises it, and it is
this file that is right.** `Brush Preset picker` here, `Brush Preset Picker` in the sibling
`src/tools/descriptions/paint.ts` — the `Brush Preset Picker` row of the Brush's `options` and of the
Pencil's `options`. Adobe's own sentence is "You can quickly choose presets from the **Brush Preset picker** in
the options bar, which lets you temporarily modify the size and hardness of a brush preset", so the
lower-case `p` is Adobe's and the sibling is the outlier. Deliberately **not** changed, and flagged so
a future pass harmonises in this direction rather than the other.

`Mode` is the one row where `inert` and `missing` were genuinely contestable. `inert` was chosen
because the field exists on the args type and is read on the commit path, so the app _has_ the
control and this bar simply does not expose it — which is what `inert` exists to name. It is
reproduced correctly: the app's own paint bar renders a working `Mode` `<select>` (the
`${toolName}-mode` select in `PaintToolbar`, `src/components/ToolbarsRight/Paint/Paint.tsx`), and the
brush family in this same repo
therefore has the control the Draw bar lacks. The qualification recorded here is now settled rather
than open: `src/tools/descriptions/types.ts` — the `'inert'` member of `ToolControlStatus` — words
`inert` as "declared **or displayed**, and nothing is wired behind it",
and names two qualifying shapes, so a field that is neither persisted in `src/tools/settings.ts`
(`defaultSettings.draw` there has neither `blendMode` nor `smoothing`) nor rendered
by this bar still qualifies on the display side — the declared `blendMode` is the paint family's
control, and the blend-mode gate refuses it for this tool anyway
(`src/contexts/layer-utils.ts` — `toolLayerBlendMode()`). The row stays `inert`.

The tablet-pressure toggles that the corpus's Brush row lists are **not** enumerated. The Adobe
page that was opened does not name them, so a row asserting them would be an unsourced claim. They
are in `Unverified`.

App-only controls with no Photoshop counterpart in the paint bar, listed here because they are part
of what the bar actually renders: **Pen Type** (three pens), **Dash** and **Gap**, and the live stroke
preview — all in the `Draw` options bar in `src/components/ToolbarsRight/Draw/Draw.tsx`.

### The `B` badge — and what the `shortcut` field actually does

Two separate facts, and the second is sharper than the first.

**The `shortcut` field on a toolbar entry is display-only.** Its only two consumers in the whole of
`src/` are the `shortcut={identity === undefined ? primaryTool.shortcut : undefined}` prop handed to
`ToolTooltip`, and the `{tool.shortcut && <kbd …>}` element inside the flyout item, both in
`src/components/SidebarLeft/SidebarLeft.tsx`. Nothing
derives a key binding from it. **This file has now carried two wrong pairs for these two sites** — the
`ToolTooltip` prop and the flyout `<kbd>` — both moved, and the current pair was re-derived from the
`shortcut` property with `grep -n shortcut src/components/SidebarLeft/SidebarLeft.tsx` rather than
nudged. It is the second time a `SidebarLeft` citation in this file has been wrong by more than 350
lines, which is worth knowing about the file as a whole rather than about these two sites.

**One correction to the addendum's framing, verified against the tree.** The app _does_ implement
single-letter tool activation, and it does not implement the spring-loaded _temporary_ switch. The
bindings are a separate hand-written table in `src/components/Common/AppKeyboardShortcuts.tsx`, not
derived from the map: the `key: 'b'` registration and its `shift: true` twin, the `key: 'i'`
registration and the second one further down, and so on. The table's own header — the comment above
`brushGroup` — says the group arrays are "the mapping's groups, not a guess", which is the intent
— but the binding is a hand copy, so the map and the table
can disagree, and here they do. The precise, verifiable statement is therefore not "the letter binds
nothing"; it is **"the letter is taken by the Brush"**.

**`B` is bound to the brush group** — `src/components/Common/AppKeyboardShortcuts.tsx` —
`brushGroup`: `const brushGroup = ['brush', 'pencil', 'color-replacement', 'eraser']` — and `draw` is
not in it. `selectBrushTool` (in the same file) resolves a plain `B` to the Brush and a `Shift+B` to
the next member of that group. **A grep of `goToTool(` across `src/` finds no call with `'draw'`**,
so no key anywhere selects this tool. The `B` badged on the Draw Tool is therefore wrong twice over,
which is what the keyboard/UX audit recorded: in Photoshop `B` is the Brush, and in this app the
letter is bound to the Brush as well, leaving the Draw Tool reachable by pointer only. Because no key
reaches it, Photoshop's spring-loaded hold-and-switch cannot reach it either.

The collision the brief asked about is still real and still in the data: the
`{ label: 'Brush Tool', name: 'brush', shortcut: 'B' }` tile and the Draw tile (`'B'`) in
`toolbar-mapping.ts`, two different tiles in the same
`toolbarMap`. `bruceblinn`'s CS3 table gives `B, Shift-B` to "Brush,
pencil, and color replacement tools", and `thedigitalprocess` says the same in prose: "You can
activate the brush, pencil or replacement brush at any time by pressing the letter B, and cycle
through these tools by pressing Shift+B."

### Sources — Draw

- https://helpx.adobe.com/photoshop/using/painting-tools.html — Adobe. "The Brush tool and the
  Pencil tool work like traditional drawing tools applying color with brush strokes"; the Brush
  Preset picker "lets you temporarily modify the size and hardness of a brush preset"; Mode;
  Opacity, with its build-up rule "As you paint over an area, the opacity does not exceed the set
  level no matter how many times you move the pointer over the area, until you release the mouse
  button" and the value sentence "Opacity of 100 percent is opaque"; Flow, with no default; the
  section headed **Airbrush** — "Simulates painting with an airbrush… Click the button to turn on or
  off this option", which is the verbatim name the row now carries; and Shift-click for a straight
  line. The source for every Brush-bar row in the table above except `Smoothing`, and for no default
  anywhere on that bar.
- https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html
  — Adobe, last updated Feb 23, 2026. The `Smoothing` row, on one page that carries **both** halves
  the row needs: the tools it applies to — "supported tools like the Brush, Pencil, Mixer Brush, and
  Eraser" — and the range, "**Smoothing amount: Set a value between 0 and 100** to control how much
  smoothing is applied. Lower values apply minimal correction. Higher values result in stronger
  smoothing but may slightly delay the stroke preview." It states **no default**, and none is claimed.
  (The brief for this pass offered an Adobe Community thread for the 0–100 range instead; this page
  carries the range as Adobe prose and removes the need for the community source.)
  https://helpx.adobe.com/uk/photoshop/using/painting-tools.html — Adobe's UK mirror of the
  painting-tools page, which corroborates both halves in one sentence: "enter a value (0-100) for
  Smoothing in the options bar when working with any of these tools: Brush, Pencil, Mixer Brush, or
  Eraser." Not in the data file's `sources`, because the page above is the primary.
- https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html — Adobe, South Asia
  edition of the color-management article. The Brush picker carrying Size and Hardness, and `[` / `]`
  growing and shrinking the tip.
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html
  — Adobe. The temporary-switch rule the app omits.
- https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf — third party. `B, Shift-B` on the
  brush group; `[` / `]` for brush size.
- https://www.thedigitalprocess.com/selecting-color-in-photoshop/ — third party. The Brush/Pencil/
  Color Replacement group on `B`, cycled with `Shift+B`.
- https://clippingpathstudio.com/photoshop-toolbar/ and
  https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/ — third party, used for the
  negative: two complete Tools-panel inventories that contain no Draw tool, and a shortcut table
  giving `B` to the Brush.

## Unverified

Claims the research could not source. None of these appear in the data file as sourced fact, and each
is listed with the URL that came closest.

1. **CLOSED, and the `Median` entries are REFUTED rather than unverified — do not re-raise them.**
   This item used to say that the exact current `Sample Size` list could not be sourced and that
   no source was found for `3 by 3 Median` or `5 by 5 Median`. Both halves were wrong, because the
   search had been aimed at the wrong place: Adobe's **current** set-colors page enumerates the
   whole menu
   (`https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`):
   "**Point Sample : Reads the exact value of the clicked pixel.** / **3 by 3 Average , 5 by 5
   Average , 11 by 11 Average , 31 by 31 Average , 51 by 51 Average , 101 by 101 Average : Reads
   the average color value within the selected pixel area.**"
   - **The claim has moved out of this file and into the data file's citations.** The `Sample Size`
     row now quotes that enumeration, and
     `https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`
     is in the data file's `sources` array.
   - **`3 by 3 Median` and `5 by 5 Median` are refuted.** The brief supplied them; Adobe's
     enumeration of the entire menu contains no Median entry of any size. That is an enumeration
     of the control's contents, not a passing mention, so the absence carries real weight here —
     which is exactly the reasoning that was refused for the Curvature Pen's `Curvature` slider in
     `pen.notes.md`, and the distinction is the presence or absence of an enumeration, not how the
     claim is worded.
   - What is **not** thereby established is Photoshop's default for `Sample Size`. Adobe's page
     lists the menu, not which entry ships selected. **That claim is now out of the data file too** —
     see item 12, which this pass closed.
2. **`Cmd`-click to sample the background layer, and `Alt`-click to sample a layer's composite.**
   Neither could be sourced, and both conflict with what every source says: Alt/Option-click sets
   the **background color**, not a layer's composite. The data file records Alt-click as the
   background-color modifier and makes no claim about `Cmd` at all. It is possible the brief means
   `Option` where it writes `Alt`, in which case the two claims collapse into the one that is
   sourced. The Alt/Option half is now carried by Adobe's **current** page rather than the CS4
   mirror this item used to point at: "Select a new background color by holding Alt (Windows) or
   Option (macOS) and clicking the desired area in the image"
   (`https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`).
   The `Cmd` half stays unverified.
3. **A `Cmd`-click that opens the Sample Size list, or any other eyedropper click modifier beyond
   Alt/Option.** Several third-party pages mention holding Ctrl/Cmd to reach sample-size options,
   but none is Adobe's and none was corroborated twice, so the data file's `modifiers` array holds
   `Alt` alone. Closest: https://phlearn.com/tutorial/photoshop-basics-how-to-use-the-eyedropper-tool/
4. **That Photoshop's eyedropper records no history state — derived from the rule, not quoted.** The
   recovered audit finding is that a sample mutates no pixel and therefore needs no durable history
   entry, belonging with a zoom, a panel move or a tool switch; a second audit reached the same
   conclusion from the governing rule. The tree asserts the rule in the doc comment above `PIXEL_FREE_TOOLS`
   in `src/tools/toolProcessors.ts` and in the doc comment above `EyedropperToolArea` in
   `src/components/Main/EyedropperToolArea.tsx`, but **no single Adobe sentence stating it
   was found**, and two audits agreeing on a deduction is not a citation. **It is now recorded in
   `appNotes` only** — removed from `purpose` outright, because `purpose` is a Photoshop-claim field
   per `src/tools/descriptions/types.ts` and an unsourced deduction about Adobe's history panel does
   not belong in one. It
   is not dressed as a sourced claim anywhere. Closest:
   https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html
5. **That the Tools panel has no freehand-annotation or pen-stroke tool "in any released version."**
   The universal negative is not sourceable. The _current-version_ negative is well supported —
   Adobe's painting-tools page plus two complete third-party Tools-panel inventories that contain no
   such tool — and the two recovered audits both found none either, but "in any released version"
   covers two decades of Photoshop that no page read here enumerates. The data file says only that
   there is no Photoshop tool called Draw, which the evidence carries.
   Closest: https://helpx.adobe.com/photoshop/using/painting-tools.html
6. **The exact current membership of Photoshop's `Shift+B` group.** `bruceblinn`'s CS3 table and
   `thedigitalprocess` both say Brush, Pencil, Color Replacement; a 2026 third-party reference adds
   the Mixer Brush; this app's own `brushGroup` adds the Eraser instead. The data file says only
   that `B` selects the Brush and `Shift+B` cycles the brush group, which every version agrees on.
   Closest: https://www.thedigitalprocess.com/selecting-color-in-photoshop/
7. **`Show Sampling Ring` as a control on the eyedropper's bar in Photoshop 2024–2026 — still open,
   and now a recorded decision rather than a silence.** Two sources place it on the CC-era bar, and
   Adobe's own CS5 help mentions "a color sampler ring for the Eyedropper tool", but nothing
   establishes that the toggle is still there, and the 27.x **name** is unconfirmed: five searches for
   `"Show color overlay"` and two more this pass for the current name returned nothing on any Adobe
   page, and the only names anyone sources are
   third-party "Show Sampling Ring" and an Adobe Community Expert's "Show Sampling Circle". It is left
   out of the census rather than filed as `missing` on the strength of a 2018 blog, because `missing`
   would assert a control Adobe's current page does not show — that page names only `Sample Size` and
   `Sample`. **The decision, recorded so it cannot be read as an oversight:** no row, because
   `src/tools/descriptions/types.ts` — `ToolControl.control` — requires `control` to be Adobe's name verbatim
   and no Adobe page supplies one; the
   omission and its reason are stated in the data file's `appNotes` instead, which also notes that the
   app has no ring either way — the ring is a cursor and this repo has no cursor registry at all.
   A later pass that finds an Adobe name for the control should add the row;
   this item then closes the way item 1 did. Closest:
   https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html
8. **A tool-preset picker leading the eyedropper's options bar.** The corpus's own table gives every
   bar a leading `tool-preset` (the corpus's own options-bar table in `03-ui-chrome-spec.md`), and tool
   presets are a documented
   Photoshop feature, but the Adobe page that was opened does not establish that a preset picker
   leads this bar. Excluded from the census rather than filed as `missing`.
   Closest: https://helpx.adobe.com/photoshop/using/painting-tools.html
9. **CLOSED — `Shift+I` cycling, and the data file's row is the closure.** This item used to say the
   cycle is documented only outside Adobe: in the consolidated CS3 table and in O'Reilly's _Photoshop
   CS4 Bible_, with the five-tool group confirmed by two independent inventories, and **no Adobe page
   establishing it had been opened.** The claim was already in the data file — the `Shift+I` shortcut
   row names all five tools, Eyedropper, Color Sampler, Ruler, Note and Count — and the thing that was
   missing was corroboration at the level the rest of the file holds. It now has it: `bruceblinn`'s
   consolidated CS3 table states the group **and** the rule in two adjacent lines, "I, Shift-I Eye
   dropper, color sampler, ruler, and count tools" and "Using the Shift key with the letter key will
   cycle through the tools", and `clippingpathstudio` and `offshoreclipping` both put the same
   five-tool group on `I`. All three are already in the data file's `sources`, which is where the
   closure is recorded. The row needs no hedge it did not already carry, and the app's own divergence
   — no `Shift+I` cycle, because the single-tool tile registers `I` twice and no `shift: true` twin —
   was already disclosed in `appNotes`. **Do not re-raise this item.** Closest:
   https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf
10. **Photoshop's default `Sample` value — and the data file no longer claims one.** Two third-party
    sources say the eyedropper samples all layers by default and that this can be narrowed, and
    Adobe's current page enumerates the menu — "All Layers : Sample color from all layers" and
    the rest — **and states no default for it**. The data file's `Sample` row used to say it
    "defaults to sampling every layer" on the strength of the third party alone, which is this
    file's own rule broken: a default is the cheapest claim in the file for anyone to disprove.
    **"Defaults to" has been dropped**; the row now enumerates the menu and says outright that
    Adobe states no default. The app's own default is `sampleAllLayers: false`, which it has to
    be, because the app samples one composited canvas either way.
11. **The Brush bar's tablet-pressure toggles** (`Stylus Pressure Controls Opacity` / `Size`), which
    the corpus's Brush row lists. Not enumerated in the census because the Adobe page that was
    opened does not name them, and the app has no pointer-pressure handling to map them onto in any
    case. Closest: https://helpx.adobe.com/photoshop/using/painting-tools.html
12. **CLOSED this pass — Photoshop's default `Sample Size`, and the claim is removed rather than
    sourced.** This item used to say the data file's `Sample Size` row ended "Default: Point Sample"
    on the strength of one third-party tutorial, and left it in place as "the one remaining unsourced
    default in the `eyedropper` description" with a note to remove it or source it later. Six
    targeted searches for an Adobe statement of the default returned none: Adobe's set-colors page
    enumerates the whole menu and does not say which entry ships selected, and Adobe's tool page does
    not mention it at all. The only sources for it are third-party — `enviragallery` ("By default, the
    Eyedropper tool samples 1 pixel") and `phlearn` ("By default, it's set to 'Point Sample'") — which
    is exactly the shape of claim item 10 removed from the sibling `Sample` row. **The row's detail now
    says outright that Adobe lists the menu without saying which entry ships selected, and that the
    app's own default is Point Sample.** That is the same treatment the `Sample` row got, applied to
    the last remaining unsourced default on the eyedropper side, and it leaves the family with **no**
    unsourced Photoshop default in either record. Closest:
    http://phlearn.com/tutorial/photoshop-basics-how-to-use-the-eyedropper-tool/
13. **NEW — four of the five `Sample` menu values are not verbatim from any Adobe page.** Adobe's
    set-colors page gives the first entry and says nothing further in the text that was read: "Select
    a sampling option from the Sample menu in the Options bar: **All Layers : Sample color from all
    layers.**" The remaining four — Current Layer, Current & Below, All Layers No Adjustments, Current
    and Below No Adjustments — are corroborated by two third parties that agree on the set (an Adobe
    expert's blog, and a reproduction of Adobe's Action Manager enum keys for `eyeDropperSampleSheet`)
    but neither is Adobe publishing the names. I checked Adobe's own VBScript and JavaScript scripting
    references for the enum and **neither dictionary contains `eyeDropperSampleSheet` or
    `eyeDropperSample`**, so there is no Adobe-published enumeration to cite. The data file's row
    therefore names all five, which is right for a reader and honest about the count, and the
    capitalisation of the two No-Adjustments variants is the one part not Adobe-verified. Closest:
    https://qiita.com/yamo74/items/cc9d25b375bdfd020ce9
14. **NEW — that `I` specifically spring-loads, as distinct from the general rule.** Adobe's
    spring-loaded page states the rule for tool shortcut keys without naming the Eyedropper; the
    letter-specific claim rests on an Adobe Community Expert, "The ordinary I-shortcut works the same
    way if you hold the key for a specified time" and "All the tool shortcuts work this way as
    standard". Adequate for a `shortcuts` row whose action is the general rule applied to one letter,
    but it is a community answer and not a documentation page. Closest:
    https://community.adobe.com/t5/photoshop-ecosystem-discussions/how-do-i-change-the-eye-dropper-shortcut/m-p/13376888
15. **NEW — that the temporary Alt/Option eyedropper carries the Eyedropper's current Sample Size.**
    Adobe's painting-tools page establishes the temporary switch; the Sample Size carry-over is
    `phlearn` alone. Kept in `purpose` because it is true and useful, but recorded here so nobody
    reads it as Adobe prose. Closest:
    https://helpx.adobe.com/photoshop/using/painting-tools.html

**Two unsourced defaults were removed rather than listed here, because they are no longer claims.**
The `draw` family's `Opacity` and `Flow` rows both ended "Default: 100%." Adobe says "Opacity of
100 percent is opaque" — a value, not a default — and states no default for Flow at all, so both
sentences are gone from the data file and the rows now say outright that Adobe states no default.
The `Smoothing` row added this pass states the 0–100 range from Adobe's own page and claims no
default, and the sibling `src/tools/descriptions/paint.ts` — the `Smoothing` row's `detail` in the Brush's
`options` — claims "Default 10" on the same control with nothing here to
support it. That is out of this family's scope to change and is flagged for whichever pass owns the
paint family.

## Citation drift corrected in this pass

Two passes have re-derived this file's source citations, and both found drift. The first pass's table
is kept above; the second pass's is here. **Every citation drifted in the same direction: the cited
file grew above the citation and nothing below it moved.** None of these is caught by a `grep` sweep,
because the text at the stale line still reads plausibly — the two `EyedropperToolArea.tsx` lines this
file read as "inside a `return` statement" were, and the end of the `Eyedropper` component in
`Eyedropper.tsx` is a `};`.

The two columns below are **where the stale citation pointed** and **the anchor that replaces it**,
named rather than numbered: reproducing the stale number is the form this migration removes, so the
first column names the unit the drifted line sat inside — or inside the wrong thing — and the drift
itself is what the row records.

### Second pass — Eyedropper

| Where the stale citation pointed                               | The anchor that replaces it                                                                                                                           | What is there                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| the `Eyedropper` component in `Eyedropper.tsx`                 | `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx` — the Sample Size `<select>` in `Eyedropper`                                                 | the `<select>` whose options are the Sample Size list                       |
| `Eyedropper.tsx` — the end of the `Eyedropper` component       | `src/tools/settings.ts` — the `eyedropper` block of `defaultSettings`                                                                                 | `sampleAllLayers: false` — the cited site was a `};`, never a control       |
| `EyedropperToolArea.tsx` — above the component                 | `src/components/Main/EyedropperToolArea.tsx` — `handlePointerDown()`                                                                                  | `handlePointerDown`                                                         |
| `EyedropperToolArea.tsx` — the `getLocalCoords` call           | `src/components/Main/EyedropperToolArea.tsx` — `handlePointerDown()`                                                                                  | `ctx.getImageData(...)` — the read                                          |
| `EyedropperToolArea.tsx` — the sampled-colour arithmetic       | `src/components/Main/EyedropperToolArea.tsx` — `handlePointerDown()`                                                                                  | the `SET_COLOR` / `SET_BACKGROUND_COLOR` dispatch                           |
| `EyedropperToolArea.tsx` — the handler's first guard           | `src/components/Main/EyedropperToolArea.tsx` — `handlePointerDown()`                                                                                  | the `sampleAllLayers` refusal                                               |
| `EyedropperToolArea.tsx` — the end of the handler              | `src/components/Main/EyedropperToolArea.tsx` — the root `<div>` in the `return`                                                                       | `onPointerDown` — the only pointer wiring in the file                       |
| `src/tools/eyedropper.ts` — the module doc comment             | `src/tools/eyedropper.ts` — `EYEDROPPER_SAMPLE_SIZE_OPTIONS` (and `EyedropperSampleSize` for the union)                                               | `EYEDROPPER_SAMPLE_SIZE_OPTIONS`                                            |
| `src/tools/settings.ts` — the `transform` defaults block       | `src/tools/settings.ts` — the `eyedropper` block of `defaultSettings`                                                                                 | the `eyedropper` defaults block                                             |
| `src/tools/settings.ts` — the same defaults block              | `src/tools/settings.ts` — the `eyedropper` block of `defaultSettings`                                                                                 | `sampleAllLayers: false`                                                    |
| `src/tools/toolProcessors.ts` — the doc comment                | `src/tools/toolProcessors.ts` — `PIXEL_FREE_TOOLS`                                                                                                    | `PIXEL_FREE_TOOLS`                                                          |
| `src/tools/toolsMap.ts` — the `pen` map entry                  | `src/tools/toolsMap.ts` — the `eyedropper` map entry                                                                                                  | the `eyedropper` map entry                                                  |
| `AppKeyboardShortcuts.tsx` — an earlier table row              | `src/components/Common/AppKeyboardShortcuts.tsx` — the first `key: 'i'` registration                                                                  | the first `i` registration                                                  |
| `AppKeyboardShortcuts.tsx` — a later table row                 | `src/components/Common/AppKeyboardShortcuts.tsx` — the second `key: 'i'` registration                                                                 | the second `i` registration (under the comment about the single-tool tiles) |
| `useKeyboardEvents.tsx` — **not cited at all**                 | `src/hooks/useKeyboardEvents.tsx` — the `shift` arm of `matchesShortcut()`                                                                            | the `shift` matcher that makes Shift+I fall through — **was not cited**     |
| `HANDOFF.md` §51                                               | `HANDOFF.md` §60                                                                                                                                      | §60; the stale citation was a whole section early                           |
| `EyedropperToolArea.test` — an earlier case                    | `src/components/Main/__tests__/EyedropperToolArea.test.tsx` — the `it('refuses loudly instead of silently ignoring a Sample All Layers value')` title | the test that drives `sampleAllLayers` true                                 |
| `src/tools/__tests__/eyedropper.test.ts` — the defaults case   | `src/tools/__tests__/eyedropper.test.ts` — the `it('seeds the Photoshop defaults: a point sample, and every layer off')` title                        | already right; kept                                                         |
| `src/components/SidebarLeft/SidebarLeft.tsx` — two stale sites | `src/components/SidebarLeft/SidebarLeft.tsx` — the `ToolTooltip` prop and the flyout `<kbd>`                                                          | the two `shortcut` consumers — the **third** pair this file has carried     |

**One row of that table no longer resolves, and must not be followed.** The `HANDOFF.md` §51 -> §60
row pointed at §51, the eyedropper entry. **§51 was deleted** by `4833e740`, and the nearest surviving
section is an unrelated entry, so the pointer is struck rather than followed.
The defect it recorded — no `Sample All Layers` control, a `sampleAllLayers` value refused with a
named error, no sampling ring, no Color Sampler — is still live and still stated in full in
`appNotes`, which is what `docs/TOOLS.md` is generated from.

**The two that were not drift but wrong content.** The `EyedropperToolArea.tsx` site this file cited
as the only dispatch in the file was right in kind but wrong in content: that `dispatch()` is a
**ternary**, `event.altKey ? 'SET_BACKGROUND_COLOR' : 'SET_COLOR'`, so the citation was hiding the
implementation of Photoshop's Alt modifier. And the end of the `Eyedropper` component in
`Eyedropper.tsx` was cited as the app's rendering of a `Sample All Layers` **checkbox** when the bar
renders no such control — a citation that resolved
to a `};` and would have kept reading as true on every later pass. Both are the reason this pass
opened the code rather than re-running `grep`.

### Second pass — Draw

| Where the stale citation pointed                          | The anchor that replaces it                                                                      | What is there                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `Draw.tsx` — the blank line above the component           | `src/components/ToolbarsRight/Draw/Draw.tsx` — `Draw`                                            | the `Draw` component (the stale site is a blank line)          |
| `Draw.tsx` — the preview-size constants                   | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#size-slider` range                          | the Size `<input type="range">`                                |
| `Draw.tsx` — the end of the Opacity control               | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#alpha-slider` range                         | the Opacity `<input type="range">`                             |
| `DrawToolArea.tsx` — inside `handlePointerUp()`           | `src/components/Main/DrawToolArea.tsx` — the `createLayerFromTool(fullArgs)` call in it          | `createLayerFromTool(fullArgs)` — the commit                   |
| `src/tools/toolProcessors.ts` — the `crop` entry above it | `src/tools/toolProcessors.ts` — the `draw` entry in `toolProcessors`                             | `draw: {`                                                      |
| `src/tools/settings.ts` — the `PenSettings` alias         | `src/tools/settings.ts` — `savedDrawPerPen`                                                      | `savedDrawPerPen`                                              |
| `toolbar-mapping.ts` — the tonal group's closing bracket  | `toolbar-mapping.ts` — the Draw tile                                                             | the Draw tile (the stale site closes the tonal group)          |
| `src/tools/brush.ts` — an earlier smoothing helper        | `src/tools/brush.ts` — `smoothStrokePoints`                                                      | `smoothStrokePoints`                                           |
| `src/util/draw.ts` — a doc comment                        | `src/util/draw.ts` — `drawSpray`                                                                 | `drawSpray` (the stale site is a doc comment)                  |
| `Draw.tsx` — the Pen Type label                           | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#pen-type` select                            | the Pen Type select                                            |
| `Draw.tsx` — the top of the Dash/Gap region               | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#dash-size` and `#gap-size` ranges           | the Dash and Gap sliders                                       |
| `Draw.tsx` — the Opacity label                            | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `#alpha-slider` range                         | the Opacity control                                            |
| `Draw.tsx` — the start of the preview block               | `src/components/ToolbarsRight/Draw/Draw.tsx` — the `<canvas ref={previewRef}>`                   | the live preview (the file's last lines)                       |
| `Draw.tsx` — the effect above `handleChange`              | `src/components/ToolbarsRight/Draw/Draw.tsx` — `handleChange`                                    | the `savedDrawPerPen` write                                    |
| `Draw.tsx` — the Size handler                             | `src/components/ToolbarsRight/Draw/Draw.tsx` — `handleSizeChange`                                | `handleSizeChange`                                             |
| `Draw.tsx` — the Opacity handler                          | `src/components/ToolbarsRight/Draw/Draw.tsx` — `handleAlphaChange`                               | `handleAlphaChange`                                            |
| `Draw.tsx` — the `useStore()` call                        | `src/components/ToolbarsRight/Draw/Draw.tsx` — the foreground-colour sync `useEffect()`          | the foreground-colour sync effect                              |
| `Paint.tsx` — the Size label                              | `src/components/ToolbarsRight/Paint/Paint.tsx` — the `${toolName}-mode` select in `PaintToolbar` | the paint bar's working `Mode` select (the stale site is Size) |
| `toolbar-mapping.ts` — the tile above the Brush group     | `toolbar-mapping.ts` — the `{ label: 'Brush Tool', … }` tile                                     | the Brush tile                                                 |

The first pass's table follows, unchanged:

| Where the stale citation pointed                  | The anchor that replaces it                      | What is there                             |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `src/tools/draw.ts` — the args type               | `src/tools/draw.ts` — `PaintToolArgs`            | the `PaintToolArgs` `Omit`                |
| `src/tools/draw.ts` — an earlier renderer line    | `src/tools/draw.ts` — `setupDrawCtx()`           | `ctx.strokeStyle = color`                 |
| `src/tools/draw.ts` — the same region             | `src/tools/draw.ts` — `setupDrawCtx()`           | `ctx.globalAlpha = alpha`                 |
| `src/util/draw.ts` — a doc comment                | `src/util/draw.ts` — `drawSpray`                 | `hexToRgb(args.color)` inside `drawSpray` |
| `src/tools/settings.ts` — the per-pen type alias  | `src/tools/settings.ts` — `savedDrawPerPen`      | the `savedDrawPerPen` record              |
| `src/tools/settings.ts` — the per-pen records     | `src/tools/settings.ts` — `savedDrawPerPen`      | the three per-pen alphas                  |
| `src/tools/settings.ts` — above `defaultSettings` | `src/tools/settings.ts` — `defaultSettings.draw` | the `defaultSettings.draw` block          |

The `draw.ts` drift matters more than the rest, because two of those citations are load-bearing for
this pass: the E4 finding's own evidence is `src/util/draw.ts` — `drawPen()` — plus
`src/tools/draw.ts` — `setupDrawCtx()`, and the table previously cited a different line for the
`globalAlpha` the divergence turns on. A source coordinate in a handoff
is only useful if it still resolves, and a `grep` sweep does not catch this — the text
at the stale site still reads plausibly.

## Incidental observation, not fixed here

`src/tools/draw.ts` — the doc comment above the `composite` field in `DrawToolArgs` — contains a
duplicated `/**`, two consecutive block-comment openers, the
first of which swallows the second as comment text. It parses (JavaScript block comments do not
nest), so nothing fails; the effect is that the `composite` field's doc comment is malformed from
its first line. The surrounding declarations are unaffected, so no reference into this file moves.
Flagged because
this file is load-bearing for the Draw description and for the `PaintToolArgs` derivation, and the
malformed comment is the kind of thing an agent re-deriving a citation from a doc comment would
trip over.
