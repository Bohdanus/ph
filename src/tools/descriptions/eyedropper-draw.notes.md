# Eyedropper and Draw — research notes

Family: `eyedropper`, `draw`. Data: `src/tools/descriptions/eyedropper-draw.ts`. Every `file:line`
below was re-derived against the tree in this worktree, not copied from the research corpus.

## What the corpus already had: nothing

Searched `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/01-photoshop-reference.md` for
`Eyedropper|eyedropper|Draw Tool`. Two hits, neither a section on either tool: line 176 records
`Alt/Option = temporary Eyedropper` as a Brush modifier, and line 624 counts three eyedroppers in
an unrelated list. There is **no Eyedropper Tool section and no Draw Tool section in the corpus**.

`03-ui-chrome-spec.md:175` is the options-bar contents table. It has rows for Move, Rect. Marquee,
Lasso, Magic Wand, Crop, Brush, Pencil, Color Replacement, Blur, Shape, Pen, Horizontal Type and
Adjustments. **Neither the Eyedropper nor the Draw appears as a row**, so the table gave no control
list for this family either. This family is 100% fresh research, on both the Photoshop side and the
control census.

One correction to the brief: the mapping file is `toolbar-mapping.ts` at the **repository root**,
not under `src/`. The test that imports it reaches it as `../../../../toolbar-mapping.ts`. Its line
numbers happen to be exactly the ones the brief names (`:72` and `:96`), so the brief's citations
resolve — but the path in the brief is wrong.

## Eyedropper Tool

### Prose

Photoshop's Eyedropper is a click, not a drag: it reads pixels under the pointer and writes the
result into the app's color controls. A plain click sets the foreground color; Alt-click (Windows) /
Option-click (macOS) sets the background color. Adobe's own page states both halves — "Select the
Eyedropper tool (I)", "Use the Options Bar to customize tool settings, like Sample Size and Sample",
"The sampled color will become the foreground color and be added to your Swatches panel" — and
Adobe's **current** set-colors page states the background half as a rule of the tool, and replaces
the CS4 mirror this file used to lean on: "**Select a new background color by holding Alt (Windows)
or Option (macOS) and clicking the desired area in the image**"
(`https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`).
The Adobe-authored _Photoshop CS5 On Demand_ text says it the same way, and that source is kept.

Sample Size is the footprint, and **the claim here is better sourced than this file used to admit.**
Adobe's current page enumerates the entire menu, and enumerates it with **no Median entries at
all**: "Select a sample size from the Sample Size menu in the Options bar: **Point Sample : Reads
the exact value of the clicked pixel. / 3 by 3 Average , 5 by 5 Average , 11 by 11 Average , 31 by 31
Average , 51 by 51 Average , 101 by 101 Average : Reads the average color value within the selected
pixel area**" (same page as above). So a point sample is one pixel and every other entry is a
neighbourhood mean — which is the distinction the app's own comment on the field is making — and
the full list is Adobe's rather than assembled out of an older mirror plus a blog. The narrowing
that used to be necessary here is gone; see `Unverified` item 1 for what is now closed.

The same page also settles the `Sample` menu's membership: "Select a sampling option from the Sample
menu in the Options bar: **All Layers : Sample color from all layers.**" and so on through Current
Layer, Current & Below and the two No Adjustments variants. **It states no default**, which is the
whole of the problem with that row — see `Unverified` item 10.

Holding Alt/Option from **any** painting tool reaches the Eyedropper temporarily and samples the
foreground color, at the eyedropper's current Sample Size. That is on Adobe's painting-tools page,
not a third-party inference.

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
will cycle through the tools."

### A click that changes no pixel is not an edit

The recovered audit finding is the load-bearing one, and it is **derived from the governing rule
rather than quoted**: a history state comes from a change to pixels, sampling changes only the
application foreground color, so a sample belongs in the same class as a zoom, a panel move or a tool
switch — nothing that records history. A second audit reached the same conclusion from the same
rule.

**No single Adobe sentence stating this was found**, and the two audits' agreement is agreement on a
deduction, not on a quotation, so it is recorded that way in both files. It is stated in `purpose`
as a consequence ("A sample changes no pixel, so it is not an edit and belongs with a zoom or a panel
move rather than with anything that records a history state") and in `appNotes` as what the app
therefore does. It is not dressed as a sourced claim, and it is item 4 in `Unverified`.

The app implements exactly that: `src/components/Main/EyedropperToolArea.tsx:121` is the only
dispatch in the file, and it is a `SET_COLOR`. The reason is written down in the tree at
`src/tools/toolProcessors.ts:69-79` and again at `src/components/Main/EyedropperToolArea.tsx:30-45`,
and both attribute it to Adobe's rule.

### Options bar — control census

| #   | Photoshop control | Status    | App rendering                                                                                                 | Note                                                                                                                                                                                       |
| --- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `Sample Size`     | `partial` | `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:23`, options declared at `src/tools/eyedropper.ts:28` | Wired and behaving like Photoshop's (odd-sided square, centred, clipped at the border, arithmetic mean), but the list is three entries long: Point Sample, 3 by 3 Average, 5 by 5 Average. |
| 2   | `Sample`          | `inert`   | `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:37` (input at `:41`)                                  | Rendered as the older `Sample All Layers` **checkbox**, with `checked={false}`, `disabled` on the DOM node and no change handler, so the sample source cannot be changed at all.           |

**Counts: present 0 · partial 1 · inert 1 · missing 0.** Nothing in this bar is `present` or
`missing`, because Photoshop's eyedropper bar is only these two controls and the app renders both.

Three judgement calls worth stating, because each could reasonably have gone the other way:

- **`Sample` is one row, not two.** `Sample All Layers` and the modern `Sample` dropdown are the
  same control in two forms, and the corpus brief names the checkbox. Counting them separately
  would double-count one Photoshop control. The row carries Adobe's current verbatim name
  (`Sample`, from Adobe's own page) and its `detail` records the historical checkbox form, so the
  census the brief asked for is answered without inflating the count.
- **`Sample` is `inert`, and an earlier pass had this wrong.** It was filed `partial` on the
  reading that `inert` meant "rendered by no component". That is not what the contract says:
  `types.ts` defines `inert` as a control that is "declared or displayed, and nothing is wired
  behind it", and names both qualifying shapes — state in `src/tools/settings.ts` that persists
  and drives nothing, and a label on a placeholder chip no component reads. This control is the
  first shape exactly. It is on screen, permanently unchecked and permanently disabled
  (`Eyedropper.tsx:41`); the field is seeded `false` at `src/tools/settings.ts:204`; and a grep of
  `sampleAllLayers` across `src/` finds no writer — the only `patchToolArgs` call in the bar
  (`Eyedropper.tsx:16`) writes `sampleSize`. Nothing can make the read at
  `src/components/Main/EyedropperToolArea.tsx:63` true in the app, so the settings state persists
  and drives nothing. That is the defect `inert` exists to name, and a `partial` told a reader the
  control diverges when it does not function at all. The defence for the refusal path is at
  `src/components/Main/EyedropperToolArea.tsx:63`, which reports a named reason instead of quietly
  sampling the active layer, and a test drives the field true to prove that path
  (`src/components/Main/__tests__/EyedropperToolArea.test.tsx:291`).
- **The tool-preset picker is not a row.** Every bar in the corpus's own table leads with
  `tool-preset`, and tool presets are a real Photoshop feature, but the Adobe page that was opened
  does not establish that a preset picker leads _this_ bar, so the row would be an unsourced claim.
  It is in `Unverified` instead.

### App-side facts the census depends on

- **No processor, by design.** `src/tools/toolProcessors.ts:80` —
  `export const PIXEL_FREE_TOOLS = ['eyedropper'] as const satisfies readonly ToolName[]`. The
  doc block above it (`:69-79`) states the reason: rasterizes nothing, commits no pixels, records no
  history state. `src/tools/toolsMap.ts:126` is the consequence —
  `eyedropper: { icon: 'eyedropper', toolboxComponent: Eyedropper }`, no `...toolProcessors.eyedropper`
  spread, and the comment at `:124-125` says why.
- **The click.** `src/components/Main/EyedropperToolArea.tsx:57` (`handlePointerDown`) → `:121`
  (`dispatch({ type: 'SET_COLOR', ... })`). Sample All Layers is refused at `:63`. The sample block
  is built and clipped at `:92-98`, read at `:100`, and averaged at `:110-117`. A fully transparent
  center pixel returns without dispatching at `:108`.
- **The accelerator.** `src/toolbar-mapping.ts:57` — `{ label: 'Eyedropper Tool', name: 'eyedropper',
shortcut: 'I' }`, its own single-tool tile. The runtime binding is
  `src/components/Common/AppKeyboardShortcuts.tsx:224` and again at `:348`; the second registration
  is deliberate (the comment at `:344-347` explains that a single-tool tile gets no Shift twin), and
  `src/components/Common/__tests__/AppKeyboardShortcuts.test.tsx:492-503` pins that a shifted `I`
  still selects the eyedropper. **The app therefore has no `Shift+I` cycle and no spring-loaded
  temporary `I`** — both are divergences, and both are stated in `appNotes`. The `Shift+I` row is
  **kept** in `shortcuts`: the binding is real in Photoshop, and this file's rule is to record
  Photoshop's behaviour and disclose the app's divergence in `appNotes` rather than delete the claim.
  An earlier pass of this file asserted here that the divergence was already disclosed when `appNotes`
  did not mention the cycle at all; it does now. The same check applies to the four tools Photoshop
  cycles to — Color Sampler, Ruler, Note and Count are in none of the `ToolName` union
  (`src/contexts/tool-types.ts`), so the group has no members in the app to cycle through.
- Defaults: `sampleSize: 1`, `sampleAllLayers: false` at `src/tools/settings.ts:202-206`, pinned by
  `src/tools/__tests__/eyedropper.test.ts:12-18`. **The app's defaults are not claimed to be
  Photoshop's.** This line previously read "Defaults match Photoshop's", which was a claim about
  Photoshop that nothing sourced — Adobe states the `Sample` menu but no default for it (item 10),
  and states no default for `Sample Size` either. What is true and is what the line now says is
  that the app's two defaults are these values.

### Sources — Eyedropper

- https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html — Adobe. The `I`
  accelerator, the `Sample Size` and `Sample` control names, foreground on click, added to Swatches.
  `webfetch` on this URL returns HTTP 403; the text was read through the live search crawler, which
  is the route the research brief prescribes for `helpx.adobe.com`.
- https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html
  — Adobe, current. The **complete** `Sample Size` menu, with no Median entries in it; the
  `Sample` menu; and the background-color rule, "Select a new background color by holding Alt
  (Windows) or Option (macOS) and clicking the desired area in the image". This is the primary
  citation for the `Sample Size` row and the `Alt` modifier, and it supersedes the CS4 mirrors
  that used to carry both.
- https://helpx.adobe.com/photoshop/using/painting-tools.html — Adobe. Alt/Option held from a
  painting tool reaches the Eyedropper temporarily.
- https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html
  — Adobe. Spring-loaded tool shortcuts: temporary switch on hold, return on release, on by
  default, 200 ms default delay, with the hold-`V`-while-brushing example.
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
  sampling ring.
- https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf — third party (a photographer's
  consolidated CS3 shortcut table). "I, Shift-I Eye dropper, color sampler, ruler, and count tools",
  the letter-selects-the-group / Shift-cycles rule, and `[` / `]` for brush size.
- https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Eyedropper_tool.html — third
  party (course notes). The CS3 sample-size list, and Alt as a temporary eyedropper over the brush,
  pencil, type, gradient, bucket and shape tools.
- https://enviragallery.com/guide-to-the-eyedropper-tool-in-photoshop/ — third party. The sample
  source defaults to every layer, and can be narrowed to active layers only.
- https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html —
  Adobe expert blog (not an Adobe page). The five `Sample` values and the sampling ring toggle.
- https://editpsdfile.com/blog/photoshop-keyboard-shortcuts — third party. "Sample color while
  painting: Hold Alt" in a modern shortcut reference.
- https://www.oreilly.com/library/view/photoshop-r-cs4-bible/9780470345177/9780470345177_tools.html
  — third-party book. Shift plus a tool's letter cycles the tools behind it.
- https://clippingpathstudio.com/photoshop-toolbar/ and
  https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/ — third party. The five-tool
  measurement group on `I`, and the tool/shortcut tables.

## Draw Tool

### What it actually is

**A hard-tipped freehand path tool that rasterizes each stroke onto a new layer.** Not a vector path
or annotation tool, not a distinct painting mode, and not a pen in the Photoshop sense. The chain
that settles it, in order:

1. `src/toolbar-mapping.ts:96` — `[{ label: 'Draw Tool', name: 'draw', shortcut: 'B' }]`, its own
   single-tool tile, in the tonal group after Dodge/Burn.
2. `src/contexts/tool-types.ts:34` — `draw: DrawToolArgs`, and `:2` imports both `DrawToolArgs` and
   `PaintToolArgs`, so the two are separate arg types rather than one shared paint type. The split is
   real: `src/tools/draw.ts:55` defines `PaintToolArgs` as `Omit<DrawToolArgs, 'toolName' |
'smoothing' | 'blendMode'> & PaintSettings`, i.e. the paint tools are the draw args plus required
   paint settings, and `smoothing`/`blendMode` are exactly what they add.
3. `src/tools/draw.ts:6` — `export type PenType = 'pen' | 'pen-dashed' | 'spray';`. Three renderers,
   selected by a dropdown, not a brush tip.
4. `src/util/draw.ts:85-104` — `drawLine` smooths the sampled path once and dispatches: `pen` and
   `pen-dashed` to `drawPen` (`:142`, a `beginPath`/`moveTo`/bezier/`stroke` of the path), `spray`
   to `drawSpray` (`:157`, a radial gradient per sampled point). There are no anchors, no handles and
   no fill, so it is not a path tool; and there is no tip, no hardness and no flow, so it is not a
   brush. **The path is not resampled.** `drawLine` reads `args.points` and hands it to
   `smoothStrokePoints` (`src/tools/brush.ts:101`), which returns _the same array instance_ whenever
   the pull is zero (`:103`) and otherwise emits exactly one output point per input point. For the
   legacy draw tool it always returns the same array: `defaultSettings.draw` (`settings.ts:63-69`)
   carries no `smoothing` key, so the argument is `0`. The raw samples are whatever
   `handlePointerMove` pushed (`DrawToolArea.tsx:103`), and the curve through them is drawn by
   `bezierSmoothedLine` (`src/util/draw.ts:29`, called at `:153`). The data file's `purpose` used to
   say "a drag is resampled as a path, bezier-smoothed, and stroked" — the bezier half is real, the
   resampling half was not, and it has been corrected.
5. `src/tools/toolProcessors.ts:151-157` — `draw: { commit: 'source', creator: true, ... }`. The
   `creator: true` is the decisive flag: **every stroke creates a layer.** Compare `:255-262`
   (`brush`, `commit: 'raster'`, no `creator`) and `:263-` (`pencil`, `commit: 'raster'`), which
   composite onto the active layer. The commit happens at
   `src/components/Main/DrawToolArea.tsx:143` (`createLayerFromTool(fullArgs)`) on pointer-up, with
   the points accumulated at `:93` and `:103` and the bounding box computed at `:134`.
6. `src/components/ToolbarsRight/Draw/Draw.tsx:13` — the options bar. In bar order it renders
   **Pen Type** (select, three options, `:122-131`), **Size** (0.5–500 px, step 0.5, `:142-151`),
   **Dash** and **Gap** (1–100 px each, `:154-194`, rendered only when the pen is `pen-dashed`), and
   **Opacity** (0–100%, `:204-213`), then a live 96×48 stroke preview (`:216-222`). Per-pen settings
   are remembered in `savedDrawPerPen` (`src/tools/settings.ts:32-36`), keyed by `PenType`, written
   by `Draw.tsx:35-42`.

So: a drag becomes a path, the path becomes ink, the ink becomes a layer. It is a **freehand stroke
tool this app owns**, and the phrase is not a hedge.

**The ink is the foreground colour, and that half of the old claim survived re-derivation.** It was
worth checking rather than assuming, because the paint family records the same-sounding claim as
false for Color Replacement. Here it is true, and two independent lines decide it: the bar reads the
store's foreground out of `useStore()` (`Draw.tsx:14`) and writes it into the tool args in an effect
whenever the two disagree (`Draw.tsx:29-33`), and the renderers consume `args.color` —
`ctx.strokeStyle = color` for the two pen types (`src/tools/draw.ts:74`) and
`hexToRgb(args.color)` inside `drawSpray` (`src/util/draw.ts:162`). So `appNotes` and `purpose` keep
the foreground-colour statement and only the resampling clause was cut.

**Two consequences of the one-stroke, one-layer design, which the data file now records.** The
renderers issue a single `beginPath`/`moveTo`/`stroke()` per stroke at the tool's `globalAlpha`
(`src/util/draw.ts:151-154`, `src/tools/draw.ts:77`), so a stroke that crosses itself does not
compound within that stroke, and because every stroke is its own layer (`creator: true`,
`src/tools/toolProcessors.ts:151-153`), a second stroke composites a second semi-transparent layer
over the first rather than adding to the same one. The `Opacity` row's build-up sentence is
Photoshop's, and `appNotes` is where the divergence is stated.

### Modifiers and bracket keys, both absent

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
  absence disclosed in `appNotes` as the selection family discloses its own unbound keys. Nothing in
  `src/` binds a bracket key: there is no `BracketLeft`/`BracketRight` and no `key: '['`
  registration anywhere, and `AppKeyboardShortcuts.tsx` contains no `draw` key at all.

### Photoshop provenance: there is none

**Photoshop has no tool called Draw.** Adobe's painting-tools page covers the Brush, Pencil, Eraser,
Blur, Smudge, Mixer Brush, Color Replacement and the paint bar's Mode/Opacity/Flow/airbrush options,
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

| #   | Brush bar control                        | Status    | App rendering                                                      | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------- | --------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `Brush Preset picker`                    | `missing` | —                                                                  | No tip, no hardness, no presets. The per-pen records in `settings.ts:32-36` are three hardcoded strokes, not a preset system.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | `Size`                                   | `partial` | `src/components/ToolbarsRight/Draw/Draw.tsx:142`, handler `:44-47` | Wired and applied verbatim (`src/tools/draw.ts:74`), but the range diverges at **both** ends: 0.5–500 px, step 0.5, against Photoshop's 1–5000.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3   | `Mode`                                   | `inert`   | declared `src/tools/draw.ts:43`                                    | Declared on the args, set by no Draw-bar control, absent from `defaultSettings.draw` (`settings.ts:63-69`) — **and refused even if set**: `src/contexts/layer-utils.ts:149` returns `source-over` for any `toolName` other than `brush`/`pencil`/`color-replacement`, so a draw stroke's layer is forced to Normal.                                                                                                                                                                                                                                                                |
| 4   | `Opacity`                                | `present` | `src/components/ToolbarsRight/Draw/Draw.tsx:204`, handler `:49-52` | 0–100% on `args.alpha`, applied as `ctx.globalAlpha` (`src/tools/draw.ts:77`). Default 90% for `pen`/`pen-dashed`, 50% for `spray` (`settings.ts:33-35`) against Photoshop's 100% — the data file's `detail` now names both numbers. The build-up behavior Photoshop documents for this control is not reproduced: see the one-stroke, one-layer paragraph above.                                                                                                                                                                                                                  |
| 5   | `Flow`                                   | `missing` | —                                                                  | The app has a single `alpha` and no flow concept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | `Enable airbrush-style build-up effects` | `missing` | —                                                                  | The bar renders Pen Type, Size, Dash, Gap, Opacity and a preview, and nothing else. The `spray` pen is the nearest thing and it diverges twice: it is reached from a Pen Type dropdown rather than a toggle, and it stamps one soft gradient per sampled point along the drag, so it builds while the pointer moves and a held press adds nothing after the single dot it laid. The old `partial` here carried an `appRef` into `Draw.tsx:129`, which is a Pen Type `<option>`, not an airbrush control — a citation to a line that does not contain the control the row is about. |

**Counts: present 1 · partial 2 · inert 1 · missing 3.**

`Size` and the airbrush toggle were both `present`/`partial` on the strength of "it does something
nearby". Neither is that any more. `Size` is `partial` because `types.ts` defines the status as
"its behaviour **or range** diverges", and both of this control's bounds diverge from Photoshop's
1–5000; the sibling paint family files the same control `partial` for the same class of reason. The
airbrush toggle is `missing` because the Draw bar contains no control that answers to it at all, and
the nearest neighbour — the Spray pen — is a different Photoshop control reached a different way.
Its old `detail` was the sharper defect: it ended "Click the button to toggle it", which would have
told a user to click a control that does not exist.

`Mode` is the one row where `inert` and `missing` were genuinely contestable. `inert` was chosen
because the field exists on the args type and is read on the commit path, so the app _has_ the
control and this bar simply does not expose it — which is what `inert` exists to name. It is
reproduced correctly: the app's own paint bar renders a working `Mode` select at
`src/components/ToolbarsRight/Paint/Paint.tsx:168-182`, and the brush family in this same repo
therefore has the control the Draw bar lacks. The qualification recorded here is now settled rather
than open: `types.ts` words `inert` as "declared **or displayed**, and nothing is wired behind it",
and names two qualifying shapes, so a field that is neither persisted in `src/tools/settings.ts`
(`defaultSettings.draw` at `settings.ts:63-69` has neither `blendMode` nor `smoothing`) nor rendered
by this bar still qualifies on the display side — the declared `blendMode` is the paint family's
control, and the blend-mode gate refuses it for this tool anyway
(`src/contexts/layer-utils.ts:149`). The row stays `inert`.

The tablet-pressure toggles that the corpus's Brush row lists are **not** enumerated. The Adobe
page that was opened does not name them, so a row asserting them would be an unsourced claim. They
are in `Unverified`.

App-only controls with no Photoshop counterpart in the paint bar, listed here because they are part
of what the bar actually renders: **Pen Type** (three pens, `Draw.tsx:122-131`), **Dash** and
**Gap** (`Draw.tsx:154-194`), and the live stroke preview (`Draw.tsx:216-222`).

### The `B` badge — and what the `shortcut` field actually does

Two separate facts, and the second is sharper than the first.

**The `shortcut` field on a toolbar entry is display-only.** Its only two consumers in the whole of
`src/` are `src/components/SidebarLeft/SidebarLeft.tsx:258` (handed to `ToolTooltip`) and `:431`
(rendered as `<kbd>` inside the flyout item). Nothing derives a key binding from it. (This file
carried `:209` and `:368` for the two; both had moved, and the pair was re-derived from the
`shortcut` property rather than nudged.)

**One correction to the addendum's framing, verified against the tree.** The app _does_ implement
single-letter tool activation, and it does not implement the spring-loaded _temporary_ switch. The
bindings are a separate hand-written table in `src/components/Common/AppKeyboardShortcuts.tsx`, not
derived from the map: `b` at `:240-245` and `Shift+b` at `:247-251`, `i` at `:224-228` and again at
`:348-353`, and so on. The table's own header (`:9-17`) says the group arrays are "the mapping's
groups, not a guess", which is the intent — but the binding is a hand copy, so the map and the table
can disagree, and here they do. The precise, verifiable statement is therefore not "the letter binds
nothing"; it is **"the letter is taken by the Brush"**.

**`B` is bound to the brush group** — `src/components/Common/AppKeyboardShortcuts.tsx:18`:
`const brushGroup = ['brush', 'pencil', 'color-replacement', 'eraser']` — and `draw` is not in it.
`selectBrushTool` (`:47-56`) resolves a plain `B` to the Brush and a `Shift+B` to the next member of
that group. **A grep of `goToTool(` across `src/` finds no call with `'draw'`**, so no key anywhere
selects this tool. The `B` badged on the Draw Tool is therefore wrong twice over, which is what the
keyboard/UX audit recorded: in Photoshop `B` is the Brush, and in this app the letter is bound to the
Brush as well, leaving the Draw Tool reachable by pointer only. Because no key reaches it, Photoshop's
spring-loaded hold-and-switch cannot reach it either.

The collision the brief asked about is still real and still in the data:
`src/toolbar-mapping.ts:72` (Brush, `'B'`) and `src/toolbar-mapping.ts:96` (Draw, `'B'`), two
different tiles in the same `toolbarMap`. `bruceblinn`'s CS3 table gives `B, Shift-B` to "Brush,
pencil, and color replacement tools", and `thedigitalprocess` says the same in prose: "You can
activate the brush, pencil or replacement brush at any time by pressing the letter B, and cycle
through these tools by pressing Shift+B."

### Sources — Draw

- https://helpx.adobe.com/photoshop/using/painting-tools.html — Adobe. "The Brush tool and the
  Pencil tool work like traditional drawing tools applying color with brush strokes"; the Brush
  Preset picker "lets you temporarily modify the size and hardness of a brush preset"; Mode;
  Opacity; Flow; the airbrush toggle's own description; and Shift-click for a straight line. The
  source for every Brush-bar row in the table above.
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
     lists the menu, not which entry ships selected; the data file's "Default: Point Sample" is
     unverified and is item 10's sibling rather than part of this item.
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
   conclusion from the governing rule. The tree asserts the rule at `src/tools/toolProcessors.ts:73-74`
   and `src/components/Main/EyedropperToolArea.tsx:30-44`, but **no single Adobe sentence stating it
   was found**, and two audits agreeing on a deduction is not a citation. Recorded as a derivation in
   `purpose` and `appNotes`, not as a quote. Closest:
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
7. **`Show Sampling Ring` as a control on the eyedropper's bar in Photoshop 2024–2026.** Two
   sources place it on the CC-era bar, and Adobe's own CS5 help mentions "a color sampler ring for
   the Eyedropper tool", but nothing establishes that the toggle is still there. It was left out of
   the census rather than filed as `missing` on the strength of a 2018 blog. Closest:
   https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html
8. **A tool-preset picker leading the eyedropper's options bar.** The corpus's own table gives every
   bar a leading `tool-preset` (`03-ui-chrome-spec.md:182-194`), and tool presets are a documented
   Photoshop feature, but the Adobe page that was opened does not establish that a preset picker
   leads this bar. Excluded from the census rather than filed as `missing`.
   Closest: https://helpx.adobe.com/photoshop/using/painting-tools.html
9. **`Shift+I` cycling, from an Adobe source.** The cycle rule is documented in the consolidated CS3
   table and in O'Reilly's _Photoshop CS4 Bible_, and the five-tool group is confirmed by two
   independent inventories, so the shortcut is in the data file — but no Adobe page establishing it
   was opened. Closest: https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf
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
12. **Photoshop's default `Sample Size` value, and the `Show Sampling Ring` default.** Added by this
    pass, not by the review, and of exactly the same class as item 10. The data file's `Sample Size`
    row ends "Default: Point Sample." Adobe's current page enumerates the menu and does not say
    which entry ships selected; a third-party tutorial says "By default, it's set to 'Point Sample'",
    which is one source. **The default is left in the data file and is recorded here as the one
    remaining unsourced default in the `eyedropper` description** — a judgement call, since it is a
    conventional first-entry default and the app's own value is 1, but it is the same shape of claim
    that item 10's "defaults to" was and it should be treated as one. Remove it or source it in a
    later pass. Closest:
    http://phlearn.com/tutorial/photoshop-basics-how-to-use-the-eyedropper-tool/

## Incidental observation, not fixed here

`src/tools/draw.ts:15-16` contains a duplicated `/**` — two consecutive block-comment openers, the
first of which swallows the second as comment text. It parses (JavaScript block comments do not
nest), so nothing fails; the effect is that the `composite` field's doc comment is malformed from
its first line. Line numbers are unaffected, so no citation into this file moves. Flagged because
this file is load-bearing for the Draw description and for the `PaintToolArgs` derivation, and the
malformed comment is the kind of thing an agent re-deriving a citation from a doc comment would
trip over.
